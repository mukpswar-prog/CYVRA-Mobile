package cyvra.mobile.host.evidence

import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AdbGenericEvidenceProviderTest {

    @Test
    fun collectsCompleteDeviceEvidenceWithoutCrashing() {
        val fakeRunner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            when {
                cmd.contains("getprop ro.product.manufacturer") -> DefaultProcessExecutionResult(0, "samsung\n", "")
                cmd.contains("getprop ro.product.brand") -> DefaultProcessExecutionResult(0, "samsung\n", "")
                cmd.contains("getprop ro.product.model") -> DefaultProcessExecutionResult(0, "SM-A525F\n", "")
                cmd.contains("getprop ro.product.name") -> DefaultProcessExecutionResult(0, "a52\n", "")
                cmd.contains("getprop ro.product.device") -> DefaultProcessExecutionResult(0, "a52\n", "")
                cmd.contains("getprop ro.build.id") -> DefaultProcessExecutionResult(0, "TP1A.220624.014\n", "")
                cmd.contains("getprop ro.build.version.release") -> DefaultProcessExecutionResult(0, "13\n", "")
                cmd.contains("getprop ro.build.version.sdk") -> DefaultProcessExecutionResult(0, "33\n", "")
                cmd.contains("getprop ro.build.version.security_patch") -> DefaultProcessExecutionResult(0, "2023-08-01\n", "")
                cmd.contains("settings get secure android_id") -> DefaultProcessExecutionResult(0, "4a2b8c9d0e1f2a3b\n", "")
                cmd.contains("dumpsys battery") -> DefaultProcessExecutionResult(
                    0,
                    """
                    Current Battery Service state:
                      AC powered: false
                      USB powered: true
                      Wireless powered: false
                      status: 2
                      health: 2
                      present: true
                      level: 82
                      scale: 100
                      temperature: 295
                      technology: Li-ion
                    """.trimIndent(),
                    "",
                )
                cmd.contains("df -k /data") -> DefaultProcessExecutionResult(
                    0,
                    """
                    Filesystem     1K-blocks      Used Available Use% Mounted on
                    /dev/block/dm-5 113700000 45000000  68700000  40% /data
                    """.trimIndent(),
                    "",
                )
                cmd.contains("dumpsys trust") -> DefaultProcessExecutionResult(
                    0,
                    """
                    Device trust state:
                      deviceLocked=true
                      currentUserIsSecure=true
                    """.trimIndent(),
                    "",
                )
                // Stage 1: the security states are now READ, not asserted.
                cmd.contains("settings get global adb_enabled") -> DefaultProcessExecutionResult(0, "1\n", "")
                cmd.contains("ro.boot.verifiedbootstate") -> DefaultProcessExecutionResult(0, "green\n", "")
                cmd.contains("dumpsys device_policy") -> DefaultProcessExecutionResult(
                    0,
                    """
                    Device Owner:
                    Device Owner Id: null
                    Device Admins:
                      com.android.shell
                    """.trimIndent(),
                    "",
                )
                cmd.contains("getprop ro.build.fingerprint") -> DefaultProcessExecutionResult(
                    0, "samsung/a52xx/a52:13/TP1A.220624.014/eng.root:user/release-keys\n", "",
                )
                cmd.contains("ls /storage") -> DefaultProcessExecutionResult(0, "emulated\nself\n", "")
                cmd.contains("sys.boot_completed") -> DefaultProcessExecutionResult(0, "1\n", "")
                else -> DefaultProcessExecutionResult(0, "", "")
            }
        }

        val client = AdbClient(File("mock-adb"), fakeRunner)
        val provider = AdbGenericEvidenceProvider(client, "serial-test", "session-123")

        val evidence = provider.collectAll()

        assertNotNull(evidence)
        assertEquals("session-123", evidence.sessionUuid)

        // Identity
        assertEquals("samsung", evidence.identity.manufacturer.value)
        assertEquals(EvidenceStatus.AVAILABLE, evidence.identity.manufacturer.status)
        assertEquals("SM-A525F", evidence.identity.model.value)
        assertEquals(33, evidence.identity.apiLevel.value)
        assertEquals("4a2b8c9d0e1f2a3b", evidence.identity.platformIdentifier.value)

        // Honesty: No IMEI/serial fabrication
        assertNull(evidence.identity.hardwareSerial.value)
        assertEquals(EvidenceStatus.RESTRICTED, evidence.identity.hardwareSerial.availability)
        assertNull(evidence.identity.imei.value)
        assertEquals(EvidenceStatus.RESTRICTED, evidence.identity.imei.availability)

        // Battery
        assertEquals(82, evidence.battery.levelPercent.value)
        assertTrue(evidence.battery.isCharging.value ?: false)
        assertNull(evidence.battery.stateOfHealthSoh.value)
        assertEquals(EvidenceStatus.RESTRICTED, evidence.battery.stateOfHealthSoh.status)

        // Storage
        assertTrue((evidence.storage.internalTotalBytes.value ?: 0L) > 0L)
        assertTrue((evidence.storage.internalAvailableBytes.value ?: 0L) > 0L)
        // Scoped storage has no shell-visible signal. It used to be hardcoded `true` and
        // stamped AVAILABLE, which also wrote a policy claim into the report narrative.
        assertNull(evidence.storage.scopedStorageEnforced.value)
        assertEquals(EvidenceStatus.NOT_AVAILABLE, evidence.storage.scopedStorageEnforced.status)
        // External storage IS observable; the mock publishes internal volumes only.
        assertEquals(false, evidence.storage.externalStoragePresent.value)
        assertEquals(EvidenceStatus.AVAILABLE, evidence.storage.externalStoragePresent.status)

        // Security - every state below is now read back from the device rather than
        // asserted. The proof is that the expectation follows the device's answer.
        assertTrue(evidence.security.screenLockPresent.value ?: false)
        assertEquals(true, evidence.security.adbEnabled.value)
        assertEquals(true, evidence.security.secureBootEnabled.value)
        assertEquals(false, evidence.security.deviceOwnerActive.value)
        assertNull(evidence.security.knoxClaim.value)
        assertEquals(EvidenceStatus.RESTRICTED, evidence.security.knoxClaim.status)

        // ID-005's fingerprint half binds a report to one specific software image.
        assertEquals(EvidenceStatus.AVAILABLE, evidence.identity.buildFingerprint?.status)
        assertNotNull(evidence.identity.buildFingerprint?.value)

        // BAT-004 was present in `dumpsys battery` output and previously discarded.
        assertEquals(295, evidence.battery.rawTemperatureDeviceUnits?.value)
        assertEquals(EvidenceStatus.AVAILABLE, evidence.battery.rawTemperatureDeviceUnits?.status)

        // Stage 1 extended coverage is gathered and carried on the aggregate.
        val extended = evidence.extended
        assertNotNull(extended)
        assertTrue(extended.parameters.isNotEmpty())
        assertTrue(extended.measuredCount > 0)
        assertTrue(extended.unmeasuredCount > 0)
        assertEquals(EvidenceStatus.AVAILABLE, extended.byId("PERF-004")?.result?.status)
    }

    @Test
    fun handlesCollectorFailuresGracefully() {
        val failingRunner = ProcessRunner { _, _ ->
            DefaultProcessExecutionResult(1, "", "Service command failed")
        }

        val client = AdbClient(File("mock-adb"), failingRunner)
        val provider = AdbGenericEvidenceProvider(client, "serial-test", "session-fail")

        // None of these should throw or crash the scan
        val identity = provider.collectIdentity()
        val battery = provider.collectBattery()
        val storage = provider.collectStorage()
        val security = provider.collectSecurity()

        assertEquals("UNKNOWN", identity.manufacturer.value)
        assertEquals(EvidenceStatus.NOT_AVAILABLE, identity.apiLevel.status)
        assertEquals(EvidenceStatus.ERROR, battery.levelPercent.status)
        assertEquals(EvidenceStatus.NOT_AVAILABLE, storage.internalTotalBytes.status)
        // This line previously read `assertFalse(security.screenLockPresent.value ?: true)`.
        // It passed ONLY because a failed `dumpsys trust` was rewritten to `false` and
        // stamped AVAILABLE. The assertion was therefore pinning the defect rather than
        // testing the product. On failure the honest result is: no value, and a status
        // that explains the absence.
        assertNull(security.screenLockPresent.value)
        assertEquals(EvidenceStatus.ERROR, security.screenLockPresent.status)
        assertNotNull(security.screenLockPresent.reason)
    }

    /**
     * Regression guard for the A-10 / H3 defect raised 12-Oct-2026.
     *
     * `collectSecurity()` used to return `false` stamped AVAILABLE when `dumpsys trust`
     * failed, and returned hardcoded `true`/`false` for secure boot, device owner and USB
     * debugging whatever the device said. That is a measurement the code never took, and
     * one of the three was provably wrong on real hardware.
     *
     * A failed command must report ERROR with the reason attached. A failure must never
     * become a negative finding.
     */
    @Test
    fun neverSubstitutesAValueWhenTheCommandFails() {
        val failingRunner = ProcessRunner { _, _ ->
            DefaultProcessExecutionResult(1, "", "Service command failed")
        }
        val provider = AdbGenericEvidenceProvider(AdbClient(File("mock-adb"), failingRunner), "serial-fail")
        val security = provider.collectSecurity()

        listOf(
            security.screenLockPresent,
            security.secureBootEnabled,
            security.deviceOwnerActive,
            security.adbEnabled,
        ).forEach { field ->
            assertNull(field.value, "a failed command must not yield a value")
            assertEquals(EvidenceStatus.ERROR, field.status, "a failed command must report ERROR")
            assertNotNull(field.reason, "a failed command must say why it failed")
        }

        val storage = provider.collectStorage()
        assertEquals(EvidenceStatus.ERROR, storage.externalStoragePresent.status)
        assertNull(storage.externalStoragePresent.value)
    }

    /**
     * The three states that were fabricated are now genuinely read, so changing the
     * device's answer must change the product's answer. A test that can only pass one
     * way proves a constant; this one proves a measurement.
     */
    @Test
    fun securityStatesFollowTheDeviceRatherThanAConstant() {
        fun providerReturning(verifiedBoot: String, ownerComponent: String?, adbEnabled: String) =
            AdbGenericEvidenceProvider(
                AdbClient(
                    File("mock-adb"),
                    ProcessRunner { command, _ ->
                        val cmd = command.joinToString(" ")
                        when {
                            cmd.contains("ro.boot.verifiedbootstate") -> DefaultProcessExecutionResult(0, "$verifiedBoot\n", "")
                            cmd.contains("dumpsys device_policy") -> DefaultProcessExecutionResult(
                                0,
                                if (ownerComponent != null) "Device Owner: $ownerComponent\n" else "Device Owner:\nDevice Owner Id: null\n",
                                "",
                            )
                            cmd.contains("settings get global adb_enabled") -> DefaultProcessExecutionResult(0, "$adbEnabled\n", "")
                            cmd.contains("dumpsys trust") -> DefaultProcessExecutionResult(0, "deviceLocked=false\ncurrentUserIsSecure=false\n", "")
                            else -> DefaultProcessExecutionResult(0, "", "")
                        }
                    },
                ),
                "serial-variant",
            )

        // A locked, verified, debug-disabled device.
        val locked = providerReturning("green", null, "0").collectSecurity()
        assertEquals(true, locked.secureBootEnabled.value)
        assertEquals(false, locked.deviceOwnerActive.value)
        assertEquals(false, locked.adbEnabled.value)
        assertEquals(false, locked.screenLockPresent.value)

        // An unlocked bootloader with an active device owner and debugging on.
        val unlocked = providerReturning("orange", "com.example.admin/.Owner", "1").collectSecurity()
        assertEquals(false, unlocked.secureBootEnabled.value)
        assertEquals(true, unlocked.deviceOwnerActive.value)
        assertEquals(true, unlocked.adbEnabled.value)
    }
}
