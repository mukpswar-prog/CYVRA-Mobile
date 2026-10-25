package cyvra.mobile.host.evidence

import cyvra.mobile.core.AndroidComponentBridge
import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.AndroidComponentExecutionResult
import cyvra.mobile.host.transport.AdbClient
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Host-side implementation of [AndroidComponentBridge] using controlled ADB transport.
 * Communicates with the optional supporting APK (`co.in.cyvra.mobile`) on the device.
 * Follows Freeze Guide §2, §5, §19, and §48:
 * - APK is an optional supporting component, NOT the sole scanner.
 * - Source is explicitly preserved as "ANDROID_COMPONENT".
 * - If APK is missing or not installed, the bridge reports `isInstalled = false` gracefully
 *   without crashing the host or halting ADB generic evidence collection.
 */
class HostAndroidComponentBridge(
    private val adbClient: AdbClient,
    private val serial: String,
    private val packageName: String = DEFAULT_PACKAGE_NAME,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : AndroidComponentBridge {

    companion object {
        const val DEFAULT_PACKAGE_NAME = "co.in.cyvra.mobile"
        const val COMPONENT_RECEIVER_ACTION = "co.in.cyvra.mobile.COLLECT_EVIDENCE"
        const val COMPONENT_DATA_PATH = "/sdcard/Android/data/co.in.cyvra.mobile/files/cyvra-component-evidence.json"

        internal fun isCanonicalUuid(value: String): Boolean {
            if (value.isBlank()) return false
            val parsed = runCatching { UUID.fromString(value) }.getOrNull() ?: return false
            return parsed.toString() == value
        }
    }

    override fun checkInstalled(): Boolean {
        val result = adbClient.runShell(serial, "pm list packages $packageName")
        if (!result.isSuccess) return false
        return result.stdout.lines().any { it.trim() == "package:$packageName" }
    }

    /**
     * Live agent installation reconciliation across USB port disconnects/reconnects.
     *
     * Never assumes prior installation state: queries `pm list packages` live on [serial],
     * and if the CYVRA Android Component is absent (e.g. uninstalled before reconnecting
     * on USB Port 2/3/4) and a bundled APK is available on the workstation, deploys it via
     * `adb -s <serial> install -r <apk>`.
     */
    fun ensureInstalledOrDeploy(explicitApkFile: java.io.File? = locateBundledAgentApk()): Pair<Boolean, String> {
        if (checkInstalled()) {
            return true to "INSTALLED"
        }
        val apk = explicitApkFile?.takeIf { it.isFile }
            ?: return false to "NOT_INSTALLED_NO_BUNDLED_APK"
        val installResult = adbClient.installApk(serial, apk)
        if (!installResult.isSuccess) {
            return false to "DEPLOY_FAILED: ${installResult.stderr.ifBlank { installResult.stdout }.trim()}"
        }
        return if (checkInstalled()) {
            true to "DEPLOYED"
        } else {
            false to "DEPLOY_UNVERIFIED"
        }
    }

    private fun locateBundledAgentApk(): java.io.File? {
        val prop = System.getProperty("cyvra.agent.apk")?.trim()?.takeIf { it.isNotEmpty() }
        if (prop != null) {
            val f = java.io.File(prop)
            if (f.isFile) return f
        }
        val env = System.getenv("CYVRA_AGENT_APK")?.trim()?.takeIf { it.isNotEmpty() }
        if (env != null) {
            val f = java.io.File(env)
            if (f.isFile) return f
        }
        val home = System.getProperty("cyvra.home")?.trim()?.takeIf { it.isNotEmpty() }
        if (home != null) {
            val candidates = listOf(
                java.io.File(home, "resources/cyvra-agent.apk"),
                java.io.File(home, "agent/cyvra-agent.apk"),
                java.io.File(home, "cyvra-agent.apk"),
            )
            candidates.firstOrNull { it.isFile }?.let { return it }
        }
        return null
    }

    override fun getComponentVersion(): String? {
        val result = adbClient.runShell(serial, "dumpsys package $packageName")
        if (!result.isSuccess) return null
        return result.stdout.lines()
            .firstOrNull { it.trim().startsWith("versionName=") }
            ?.substringAfter("versionName=")
            ?.trim()
    }

    /**
     * Executes evidence collection on the Android Component.
     * 1. Checks installation.
     * 2. Broadcasts the trigger intent with session UUID and deviceLifecycleId.
     * 3. Pulls or reads the component-generated JSON.
     * 4. Deserializes into [AndroidComponentEvidencePayload] with source "ANDROID_COMPONENT".
     */
    override fun triggerEvidenceCollection(
        sessionUuid: String,
        deviceLifecycleId: String,
    ): AndroidComponentExecutionResult {
        if (!checkInstalled()) {
            return AndroidComponentExecutionResult(
                isInstalled = false,
                isExecutable = false,
                error = "CYVRA Android Component ($packageName) is not installed on device",
            )
        }

        val version = getComponentVersion()

        // Send broadcast or start activity with explicit extras
        val triggerCmd = "am broadcast -a $COMPONENT_RECEIVER_ACTION -n $packageName/.ComponentEvidenceReceiver " +
                "--es sessionUuid \"$sessionUuid\" --es deviceLifecycleId \"$deviceLifecycleId\""

        val triggerResult = adbClient.runShell(serial, triggerCmd)

        // Read the output JSON generated by the component
        val readResult = adbClient.runShell(serial, "cat $COMPONENT_DATA_PATH")
        if (!readResult.isSuccess || readResult.stdout.isBlank()) {
            return AndroidComponentExecutionResult(
                isInstalled = true,
                packageVersion = version,
                isExecutable = triggerResult.isSuccess,
                error = "Android Component triggered but evidence output could not be read: ${readResult.stderr.ifBlank { "File absent" }}",
            )
        }

        return try {
            val payload = json.decodeFromString<AndroidComponentEvidencePayload>(readResult.stdout.trim())
            when {
                !isCanonicalUuid(deviceLifecycleId) || !isCanonicalUuid(payload.deviceLifecycleId) ->
                    AndroidComponentExecutionResult(
                        isInstalled = true,
                        packageVersion = version,
                        isExecutable = true,
                        payload = null,
                        error = "Android Component evidence rejected: invalid or missing deviceLifecycleId '${payload.deviceLifecycleId}'",
                    )
                !isCanonicalUuid(sessionUuid) || !isCanonicalUuid(payload.sessionUuid) ->
                    AndroidComponentExecutionResult(
                        isInstalled = true,
                        packageVersion = version,
                        isExecutable = true,
                        payload = null,
                        error = "Android Component evidence rejected: invalid or missing sessionUuid '${payload.sessionUuid}'",
                    )
                payload.deviceLifecycleId != deviceLifecycleId || payload.sessionUuid != sessionUuid ->
                    AndroidComponentExecutionResult(
                        isInstalled = true,
                        packageVersion = version,
                        isExecutable = true,
                        payload = null,
                        error = "Android Component evidence rejected: lifecycle/session ownership mismatch " +
                            "(expected lifecycle=$deviceLifecycleId session=$sessionUuid, " +
                            "got lifecycle=${payload.deviceLifecycleId} session=${payload.sessionUuid})",
                    )
                else ->
                    AndroidComponentExecutionResult(
                        isInstalled = true,
                        packageVersion = version,
                        isExecutable = true,
                        payload = payload,
                    )
            }
        } catch (e: Exception) {
            AndroidComponentExecutionResult(
                isInstalled = true,
                packageVersion = version,
                isExecutable = true,
                error = "Failed to parse Android Component evidence JSON: ${e.message}",
            )
        }
    }
}
