package cyvra.mobile.host.service

import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.ApplicationClassification
import cyvra.mobile.core.ApplicationClassificationStatus
import cyvra.mobile.core.ApplicationEnabledState
import cyvra.mobile.core.ApplicationEnumerationCompleteness
import cyvra.mobile.core.ApplicationInventoryEvidence
import cyvra.mobile.core.ApplicationInventoryRecord
import cyvra.mobile.core.ComponentBatteryExtras
import cyvra.mobile.core.ComponentDisplayMetrics
import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.evidence.HostAndroidComponentBridge
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * EW-01 / D-CE-26-01 — Device lifecycle identity contract: the five required contract cases
 * (24 Oct 2026 session handoff §6; canonical work plan EW-01).
 *
 * PRESERVATION NOTE
 * -----------------
 * The pre-existing D-1 red-marker test in [DeviceLifecycleIdentityContractTest]
 * (commit `c831646`, 147 lines) is preserved byte-for-byte in its own file.
 */
class DeviceLifecycleIdentityFiveCaseContractTest {

    private val json = Json { prettyPrint = true }

    private class CapturingAdbRunner(
        private val componentPayloadJson: String? = null,
    ) : ProcessRunner {
        val broadcastCommands = mutableListOf<String>()

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val joined = command.joinToString(" ")
            return when {
                joined.contains("devices -l") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "List of devices attached\nRF8R123456 device product:a52 model:SM_A525F transport_id:1\n",
                    stderr = "",
                )
                joined.contains("getprop") -> {
                    val prop = joined.substringAfter("getprop ").trim()
                    val value = when (prop) {
                        "ro.product.manufacturer" -> "samsung"
                        "ro.product.brand" -> "samsung"
                        "ro.product.model" -> "SM-A525F"
                        "ro.build.version.release" -> "13"
                        "ro.build.version.sdk" -> "33"
                        else -> ""
                    }
                    DefaultProcessExecutionResult(exitCode = 0, stdout = value, stderr = "")
                }
                joined.contains("dumpsys battery") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "  level: 82\n  scale: 100\n  status: 2\n",
                    stderr = "",
                )
                joined.contains("pm list packages co.in.cyvra.mobile") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "package:co.in.cyvra.mobile\n",
                    stderr = "",
                )
                joined.contains("dumpsys package co.in.cyvra.mobile") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "    versionName=0.0.0-g5\n",
                    stderr = "",
                )
                joined.contains("am broadcast") -> {
                    broadcastCommands += joined
                    DefaultProcessExecutionResult(
                        exitCode = 0,
                        stdout = "Broadcast completed: result=0\n",
                        stderr = "",
                    )
                }
                joined.contains("cat /sdcard/Android/data/co.in.cyvra.mobile/files/cyvra-component-evidence.json") -> {
                    if (componentPayloadJson != null) {
                        DefaultProcessExecutionResult(exitCode = 0, stdout = componentPayloadJson, stderr = "")
                    } else {
                        DefaultProcessExecutionResult(exitCode = 1, stdout = "", stderr = "No such file")
                    }
                }
                else -> DefaultProcessExecutionResult(exitCode = 0, stdout = "", stderr = "")
            }
        }
    }

    private fun sampleLicense() = CustomerLicenseRecord(
        licenseId = "LIC-000001",
        serialNumber = "CYVRA15092026SA3F1-1-25",
        customerEmail = "tech@example.com",
        planName = "25 Device Scans",
        deviceScanEntitlement = 25,
        scansUsed = 0,
        scansRemaining = 25,
        status = LicenseEntitlementStatus.ACTIVE,
    )

    private fun samplePayload(
        deviceLifecycleId: String,
        sessionUuid: String,
        packageName: String = "com.example.verifiedapp",
    ): String {
        val payload = AndroidComponentEvidencePayload(
            componentVersion = "0.0.0-g5",
            collectedAt = "2026-10-24T05:30:00Z",
            source = "ANDROID_COMPONENT",
            deviceLifecycleId = deviceLifecycleId,
            sessionUuid = sessionUuid,
            displayMetrics = ComponentDisplayMetrics(
                densityDpi = 420,
                widthPixels = 1080,
                heightPixels = 2400,
                smallestScreenWidthDp = 384,
                xdpi = 420f,
                ydpi = 420f,
            ),
            batteryExtras = ComponentBatteryExtras(
                isPresent = true,
                technology = "Li-ion",
                temperatureDeciCelsius = 300,
                voltageMilliVolts = 4100,
                capacityPercent = 82,
            ),
            runtimePermissions = emptyList(),
            declaredFeatures = emptyList(),
            applicationInventory = ApplicationInventoryEvidence(
                collectedAt = "2026-10-24T05:30:00Z",
                evidenceSource = "ANDROID_COMPONENT",
                collectionMethod = "ANDROID_PACKAGE_MANAGER",
                enumerationCompleteness = ApplicationEnumerationCompleteness.FILTERED,
                applications = listOf(
                    ApplicationInventoryRecord(
                        packageName = packageName,
                        classification = ApplicationClassification.USER_THIRD_PARTY,
                        classificationStatus = ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
                        evidenceSource = "ANDROID_COMPONENT",
                        collectionMethod = "ANDROID_PACKAGE_MANAGER",
                        collectedAt = "2026-10-24T05:30:00Z",
                        uid = 10123L,
                        systemFlag = false,
                        updatedSystemFlag = false,
                        enabledState = ApplicationEnabledState.ENABLED,
                    ),
                ),
            ),
        )
        return json.encodeToString(payload)
    }

    private fun extractBroadcastExtra(command: String, extraName: String): String? {
        val marker = "--es $extraName \""
        if (!command.contains(marker)) return null
        return command.substringAfter(marker).substringBefore("\"")
    }

    @Test
    fun case1_valid_orchestratorEmitsValidCanonicalUuidForDeviceLifecycleIdentity() {
        val runner = CapturingAdbRunner()
        val orchestrator = WorkstationSessionOrchestrator(
            AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = runner),
            HostLicenseService(sampleLicense()),
        )

        orchestrator.executeDiagnostic(
            serial = "RF8R123456",
            operatorId = "operator@cyvoriq.com",
        )

        assertTrue(runner.broadcastCommands.isNotEmpty(), "scan must broadcast evidence collection trigger")
        val broadcast = runner.broadcastCommands.single()
        val broadcastSessionId = extractBroadcastExtra(broadcast, "sessionUuid")
            ?: fail("broadcast missing --es sessionUuid")
        val broadcastLifecycleId = extractBroadcastExtra(broadcast, "deviceLifecycleId")
            ?: fail("broadcast missing --es deviceLifecycleId")

        val parsedLifecycleUuid = runCatching { UUID.fromString(broadcastLifecycleId) }.getOrNull()
            ?: fail(
                "D-1 CONTRACT FAILURE (Case 1 — Valid): broadcast deviceLifecycleId " +
                    "'$broadcastLifecycleId' is not a valid UUID (WorkstationSessionOrchestrator.kt:149,210).",
            )

        assertEquals(
            parsedLifecycleUuid.toString(),
            broadcastLifecycleId,
            "deviceLifecycleId must be in canonical lowercase UUID format",
        )
        assertNotEquals(
            broadcastSessionId,
            broadcastLifecycleId,
            "deviceLifecycleId must not be conflated with sessionUuid (AndroidComponentModels.kt:83)",
        )
    }

    @Test
    fun case2_missing_unattributedUnknownLifecycleFallbackIsRejected() {
        val validSessionUuid = "22222222-3333-4444-8555-666666666666"
        val validLifecycleUuid = "11111111-2222-4333-8444-555555555555"
        val runner = CapturingAdbRunner(
            componentPayloadJson = samplePayload(
                deviceLifecycleId = "unknown-lifecycle",
                sessionUuid = validSessionUuid,
            ),
        )
        val bridge = HostAndroidComponentBridge(
            AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = runner),
            serial = "RF8R123456",
        )

        val result = bridge.triggerEvidenceCollection(
            sessionUuid = validSessionUuid,
            deviceLifecycleId = validLifecycleUuid,
        )

        assertNull(
            result.payload,
            "D-1 CONTRACT FAILURE (Case 2 — Missing): HostAndroidComponentBridge accepted " +
                "a payload whose deviceLifecycleId is the 'unknown-lifecycle' fallback " +
                "(ComponentEvidenceReceiver.kt:35) instead of rejecting missing lifecycle identity.",
        )
    }

    @Test
    fun case3_invalid_malformedNonUuidLifecycleIdentityIsRejected() {
        val validSessionUuid = "22222222-3333-4444-8555-666666666666"
        val malformedLifecycleId = "CYVRA-SESSION-INVALID12345"
        val runner = CapturingAdbRunner(
            componentPayloadJson = samplePayload(
                deviceLifecycleId = malformedLifecycleId,
                sessionUuid = validSessionUuid,
            ),
        )
        val bridge = HostAndroidComponentBridge(
            AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = runner),
            serial = "RF8R123456",
        )

        val result = bridge.triggerEvidenceCollection(
            sessionUuid = validSessionUuid,
            deviceLifecycleId = malformedLifecycleId,
        )

        assertNull(
            result.payload,
            "D-1 CONTRACT FAILURE (Case 3 — Invalid): HostAndroidComponentBridge accepted " +
                "malformed non-UUID deviceLifecycleId '$malformedLifecycleId' without validation.",
        )
    }

    @Test
    fun case4_unregistered_perScanTransientIdentityIsNotUsedAsDeviceLifecycleId() {
        val runner = CapturingAdbRunner()
        val orchestrator = WorkstationSessionOrchestrator(
            AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = runner),
            HostLicenseService(sampleLicense()),
        )

        val firstScan = orchestrator.executeDiagnostic("RF8R123456", "operator@cyvoriq.com")
        val secondScan = orchestrator.executeDiagnostic("RF8R123456", "operator@cyvoriq.com")

        assertEquals(2, runner.broadcastCommands.size, "two scans must issue two broadcasts")
        val firstLifecycleId = extractBroadcastExtra(runner.broadcastCommands[0], "deviceLifecycleId")
            ?: fail("first broadcast missing deviceLifecycleId")
        val secondLifecycleId = extractBroadcastExtra(runner.broadcastCommands[1], "deviceLifecycleId")
            ?: fail("second broadcast missing deviceLifecycleId")

        assertNotEquals(
            firstScan.sessionUuid,
            firstLifecycleId,
            "D-1 CONTRACT FAILURE (Case 4 — Unregistered): first scan passed per-scan " +
                "sessionUuid '${firstScan.sessionUuid}' as deviceLifecycleId instead of a " +
                "registered device_lifecycles UUID.",
        )
        assertEquals(
            firstLifecycleId,
            secondLifecycleId,
            "D-1 CONTRACT FAILURE (Case 4 — Unregistered): two scans of the same device " +
                "emitted different unregistered per-scan deviceLifecycleIds ('$firstLifecycleId' vs '$secondLifecycleId').",
        )
    }

    @Test
    fun case5_mismatchedOwnership_foreignLifecyclePayloadIsNotAttributedToCurrentScan() {
        val foreignOwnerLifecycleId = "99999999-8888-4777-8666-555555555555"
        val foreignOwnerSessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        val runner = CapturingAdbRunner(
            componentPayloadJson = samplePayload(
                deviceLifecycleId = foreignOwnerLifecycleId,
                sessionUuid = foreignOwnerSessionId,
                packageName = "com.foreign.operator.app",
            ),
        )
        val orchestrator = WorkstationSessionOrchestrator(
            AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = runner),
            HostLicenseService(sampleLicense()),
        )

        val result = orchestrator.executeDiagnostic(
            serial = "RF8R123456",
            operatorId = "current-operator@cyvoriq.com",
        )

        val attributedPackages =
            result.evidence.applicationInventory?.applications?.map { it.packageName }.orEmpty()
        assertTrue(
            "com.foreign.operator.app" !in attributedPackages,
            "D-1 CONTRACT FAILURE (Case 5 — Mismatched Ownership): scan for " +
                "'current-operator@cyvoriq.com' (session '${result.sessionUuid}') silently " +
                "accepted component evidence belonging to foreign deviceLifecycleId " +
                "'$foreignOwnerLifecycleId' / session '$foreignOwnerSessionId' and attributed " +
                "foreign package 'com.foreign.operator.app' to the current report.",
        )
    }
}
