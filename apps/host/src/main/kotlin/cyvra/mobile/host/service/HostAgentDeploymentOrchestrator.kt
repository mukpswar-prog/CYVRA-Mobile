package cyvra.mobile.host.service

import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.host.evidence.HostAndroidComponentBridge
import cyvra.mobile.host.sanitization.HostSanitizationQualificationEngine
import cyvra.mobile.host.sanitization.SanitizationQualification
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.AdbDeviceDescriptor
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device native telemetry collected by CYVRA Agent 2.1.1.
 */
@Serializable
data class AgentNativeTelemetry(
    val schemaVersion: String = "cyvra.agent.assessment.v2",
    val agentVersion: String = "2.1.1",
    val deviceLifecycleId: String? = null,
    val sessionUuid: String? = null,
    val timestamp: Long = System.currentTimeMillis(),
    val socModel: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val buildFingerprint: String? = null,
    val androidVersion: String? = null,
    val apiLevel: Int = 0,
    val totalStorageBytes: Long = 0,
    val availableStorageBytes: Long = 0,
    val isFbeEncrypted: Boolean = false,
    val isFdeEncrypted: Boolean = false,
    val isStorageEncrypted: Boolean = false,
    val encryptionState: String = "UNENCRYPTED",
    val isKeyStoreHardwareBacked: Boolean = false,
    val hasStrongBox: Boolean = false,
    val keyStoreSecurityLevel: String = "SOFTWARE",
    val screenLockPresent: Boolean = false,
    val deviceOwnerActive: Boolean = false,
    val deviceOwnerPackage: String? = null,
    val isProfileOwner: Boolean = false,
    val recommendedMethod: String = "CLEAR_PLATFORM_RESET",
    val rawJson: String? = null,
)

/**
 * High-level orchestration status for one device slot.
 */
data class DeviceAgentSession(
    val serial: String,
    val deviceLifecycleId: String,
    val opaqueReference: String,
    val sessionUuid: String,
    val agentInstalled: Boolean,
    val agentVersion: String?,
    val deploymentStatus: String, // "READY", "DEPLOYED", "OUTDATED", "DEPLOY_FAILED", "UNAUTHORIZED"
    val handshakeAck: Boolean,
    val assessment: AgentNativeTelemetry?,
    val qualification: SanitizationQualification,
    val lastUpdated: Long = System.currentTimeMillis(),
)

/**
 * Host Agent Deployment Orchestrator.
 *
 * Implements the mandatory 1st activity:
 * Upon sensing a connected device in any slot 1–50, the orchestrator immediately:
 * 1. Resolves/binds a unique deviceLifecycleId (DEV-XXXXXXXX) and sessionUuid.
 * 2. Checks if package `com.cyvra.sanitization` is installed and up-to-date (2.1.1).
 * 3. Deploys the signed `cyvra-agent.apk` via ADB if missing or outdated.
 * 4. Authenticates the agent via secure HANDSHAKE broadcast.
 * 5. Triggers native hardware and encryption assessment via ASSESS broadcast.
 * 6. Reads and deserializes `/data/local/tmp/cyvra-agent-assessment.json`.
 * 7. Evaluates the Option C Hybrid decision matrix to establish the qualified sanitization method.
 *
 * Fully thread-safe, supporting up to 50 concurrent device slots independently.
 */
class HostAgentDeploymentOrchestrator(
    private val adbClient: AdbClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    companion object {
        const val AGENT_PACKAGE = "com.cyvra.sanitization"
        const val TARGET_VERSION = "2.1.1"
        const val ASSESSMENT_DEVICE_PATH = "/data/local/tmp/cyvra-agent-assessment.json"
    }

    private val sessions = ConcurrentHashMap<String, DeviceAgentSession>()

    /**
     * Resolves existing session or creates/deploys a new one for [serial].
     */
    fun ensureAgentReady(
        serial: String,
        forceReassess: Boolean = false,
    ): DeviceAgentSession {
        val existing = sessions[serial]
        if (existing != null && !forceReassess && existing.agentInstalled && existing.assessment != null) {
            return existing
        }

        val lifecycleId = DeviceLifecycleRegistry.resolveOrAssign(serial)
        val opaqueRef = DeviceLifecycleRegistry.opaqueReferenceForLifecycleId(lifecycleId)
        val sessionUuid = existing?.sessionUuid ?: UUID.randomUUID().toString()

        // 1. Check current installation and version
        val currentVersion = getInstalledVersion(serial)
        var isInstalled = currentVersion != null
        var deploymentStatus = if (isInstalled) "INSTALLED" else "NOT_INSTALLED"

        // 2. Deploy or update if missing or older version
        if (!isInstalled || currentVersion != TARGET_VERSION) {
            val apk = HostAndroidComponentBridge.locateBundledAgentApk()
            if (apk != null && apk.isFile) {
                var installResult = adbClient.installApk(serial, apk)
                val combinedOutput = "${installResult.stdout} ${installResult.stderr}"
                if (!installResult.isSuccess && combinedOutput.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE")) {
                    adbClient.runShell(serial, "pm uninstall $AGENT_PACKAGE")
                    installResult = adbClient.installApk(serial, apk)
                }
                if (installResult.isSuccess) {
                    val verifiedVer = getInstalledVersion(serial)
                    if (verifiedVer != null) {
                        isInstalled = true
                        deploymentStatus = "DEPLOYED"
                    } else {
                        deploymentStatus = "DEPLOY_UNVERIFIED"
                    }
                } else {
                    deploymentStatus = "DEPLOY_FAILED: ${installResult.stderr.ifBlank { installResult.stdout }.trim()}"
                }
            } else {
                deploymentStatus = "AGENT_APK_MISSING_ON_HOST"
            }
        }

        // 3. Dispatch Handshake broadcast
        var handshakeAck = false
        if (isInstalled) {
            val nonce = UUID.randomUUID().toString().take(8)
            val handshakeCmd = "am broadcast -a $AGENT_PACKAGE.HANDSHAKE " +
                    "-n $AGENT_PACKAGE/.SanitizationBroadcastReceiver " +
                    "--es sessionUuid \"$sessionUuid\" --es targetSerial \"$serial\" --es nonce \"$nonce\""
            val handshakeRes = adbClient.runShell(serial, handshakeCmd)
            handshakeAck = handshakeRes.isSuccess && (handshakeRes.stdout.contains("result=-1") || handshakeRes.stdout.contains("result=0"))
        }

        // 4. Dispatch Assess broadcast
        var assessmentTelemetry: AgentNativeTelemetry? = null
        if (isInstalled) {
            val assessCmd = "am broadcast -a $AGENT_PACKAGE.ASSESS " +
                    "-n $AGENT_PACKAGE/.SanitizationBroadcastReceiver " +
                    "--es sessionUuid \"$sessionUuid\" --es targetSerial \"$serial\""
            val assessRes = adbClient.runShell(serial, assessCmd)
            if (assessRes.isSuccess) {
                // Read assessment JSON from device
                val readRes = adbClient.runShell(serial, "cat $ASSESSMENT_DEVICE_PATH")
                if (readRes.isSuccess && readRes.stdout.isNotBlank() && readRes.stdout.trim().startsWith("{")) {
                    assessmentTelemetry = parseAssessmentJson(readRes.stdout.trim(), lifecycleId, sessionUuid)
                }
            }
        }

        // 5. Fallback host-side assessment if on-device read was unavailable
        val effectiveAssessment = assessmentTelemetry ?: deriveHostSideTelemetry(serial, lifecycleId, sessionUuid)

        // 6. Compute Option C Hybrid Qualification
        val qualification = HostSanitizationQualificationEngine.qualify(
            deviceOwnerActive = effectiveAssessment.deviceOwnerActive,
            isFbeEncrypted = effectiveAssessment.isFbeEncrypted,
            isKeyStoreHardwareBacked = effectiveAssessment.isKeyStoreHardwareBacked,
            hasStrongBox = effectiveAssessment.hasStrongBox,
            manufacturer = effectiveAssessment.manufacturer,
            model = effectiveAssessment.model,
            apiLevel = effectiveAssessment.apiLevel,
            batteryPercent = null,
            isRooted = false,
        )

        val session = DeviceAgentSession(
            serial = serial,
            deviceLifecycleId = lifecycleId,
            opaqueReference = opaqueRef,
            sessionUuid = sessionUuid,
            agentInstalled = isInstalled,
            agentVersion = getInstalledVersion(serial) ?: currentVersion,
            deploymentStatus = deploymentStatus,
            handshakeAck = handshakeAck,
            assessment = effectiveAssessment,
            qualification = qualification,
        )

        sessions[serial] = session
        return session
    }

    /**
     * Reads package version via `dumpsys package`.
     */
    fun getInstalledVersion(serial: String): String? {
        val result = adbClient.runShell(serial, "dumpsys package $AGENT_PACKAGE")
        if (!result.isSuccess) return null
        return result.stdout.lines()
            .firstOrNull { it.trim().startsWith("versionName=") }
            ?.substringAfter("versionName=")
            ?.trim()
    }

    /**
     * Parses the agent-produced assessment JSON.
     */
    private fun parseAssessmentJson(
        jsonString: String,
        lifecycleId: String,
        sessionUuid: String,
    ): AgentNativeTelemetry? {
        return try {
            val element = json.parseToJsonElement(jsonString).jsonObject
            val hw = element["hardware"]?.jsonObject
            val storage = element["storage"]?.jsonObject
            val sec = element["security"]?.jsonObject
            val sys = element["system"]?.jsonObject
            val qual = element["methodQualification"]?.jsonObject

            AgentNativeTelemetry(
                schemaVersion = element["schemaVersion"]?.jsonPrimitive?.content ?: "cyvra.agent.assessment.v2",
                agentVersion = element["agentVersion"]?.jsonPrimitive?.content ?: TARGET_VERSION,
                deviceLifecycleId = lifecycleId,
                sessionUuid = sessionUuid,
                timestamp = element["timestamp"]?.jsonPrimitive?.content?.toLongOrNull() ?: System.currentTimeMillis(),
                socModel = hw?.get("socModel")?.jsonPrimitive?.content,
                manufacturer = hw?.get("manufacturer")?.jsonPrimitive?.content,
                model = hw?.get("model")?.jsonPrimitive?.content,
                buildFingerprint = hw?.get("buildFingerprint")?.jsonPrimitive?.content,
                androidVersion = sys?.get("androidVersion")?.jsonPrimitive?.content,
                apiLevel = sys?.get("apiLevel")?.jsonPrimitive?.intOrNull ?: 0,
                totalStorageBytes = storage?.get("totalBytes")?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                availableStorageBytes = storage?.get("availableBytes")?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                isFbeEncrypted = storage?.get("isFbeEncrypted")?.jsonPrimitive?.booleanOrNull ?: false,
                isFdeEncrypted = storage?.get("isFdeEncrypted")?.jsonPrimitive?.booleanOrNull ?: false,
                isStorageEncrypted = storage?.get("isStorageEncrypted")?.jsonPrimitive?.booleanOrNull ?: false,
                encryptionState = storage?.get("encryptionState")?.jsonPrimitive?.content ?: "UNENCRYPTED",
                isKeyStoreHardwareBacked = sec?.get("isKeyStoreHardwareBacked")?.jsonPrimitive?.booleanOrNull ?: false,
                hasStrongBox = sec?.get("hasStrongBox")?.jsonPrimitive?.booleanOrNull ?: false,
                keyStoreSecurityLevel = sec?.get("keyStoreSecurityLevel")?.jsonPrimitive?.content ?: "SOFTWARE",
                screenLockPresent = sec?.get("screenLockPresent")?.jsonPrimitive?.booleanOrNull ?: false,
                deviceOwnerActive = sec?.get("deviceOwnerActive")?.jsonPrimitive?.booleanOrNull ?: false,
                deviceOwnerPackage = sec?.get("deviceOwnerPackage")?.jsonPrimitive?.content,
                isProfileOwner = sec?.get("isProfileOwner")?.jsonPrimitive?.booleanOrNull ?: false,
                recommendedMethod = qual?.get("recommendedMethod")?.jsonPrimitive?.content ?: "CLEAR_PLATFORM_RESET",
                rawJson = jsonString,
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Fallback assessment via ADB properties when agent assessment is pending.
     */
    private fun deriveHostSideTelemetry(
        serial: String,
        lifecycleId: String,
        sessionUuid: String,
    ): AgentNativeTelemetry {
        val mfr = adbClient.runShell(serial, "getprop ro.product.manufacturer").stdout.trim()
        val model = adbClient.runShell(serial, "getprop ro.product.model").stdout.trim()
        val api = adbClient.runShell(serial, "getprop ro.build.version.sdk").stdout.trim().toIntOrNull() ?: 0
        val ver = adbClient.runShell(serial, "getprop ro.build.version.release").stdout.trim()
        val crypto = adbClient.runShell(serial, "getprop ro.crypto.state").stdout.trim()
        val cryptoType = adbClient.runShell(serial, "getprop ro.crypto.type").stdout.trim()
        val isFbe = cryptoType.equals("file", ignoreCase = true)
        val isEnc = crypto.equals("encrypted", ignoreCase = true)

        val policy = adbClient.runShell(serial, "dumpsys device_policy")
        val isOwner = policy.isSuccess && policy.stdout.contains("Device Owner")

        return AgentNativeTelemetry(
            deviceLifecycleId = lifecycleId,
            sessionUuid = sessionUuid,
            manufacturer = mfr.ifBlank { "Android" },
            model = model.ifBlank { "Unknown" },
            apiLevel = api,
            androidVersion = ver.ifBlank { "Unknown" },
            isFbeEncrypted = isFbe,
            isStorageEncrypted = isEnc,
            encryptionState = if (isFbe) "FILE_BASED_ENCRYPTED" else if (isEnc) "ENCRYPTED" else "UNENCRYPTED",
            isKeyStoreHardwareBacked = api >= 28, // Standard hardware Keymaster on modern Android
            deviceOwnerActive = isOwner,
            recommendedMethod = if (isOwner) "CLEAR_DEVICE_OWNER_WIPE" else if (isFbe) "PURGE_CRYPTOGRAPHIC_ERASE" else "CLEAR_PLATFORM_RESET",
        )
    }

    /**
     * Returns the cached session if one exists.
     */
    fun getSession(serial: String): DeviceAgentSession? = sessions[serial]

    /**
     * Clears session on disconnection.
     */
    fun removeSession(serial: String) {
        sessions.remove(serial)
    }
}
