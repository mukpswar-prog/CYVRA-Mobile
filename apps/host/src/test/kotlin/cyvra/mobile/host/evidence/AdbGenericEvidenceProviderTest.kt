package cyvra.mobile.host.evidence

import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
        assertTrue(evidence.storage.scopedStorageEnforced.value ?: false)

        // Security
        assertTrue(evidence.security.screenLockPresent.value ?: false)
        assertTrue(evidence.security.adbEnabled.value ?: false)
        assertNull(evidence.security.knoxClaim.value)
        assertEquals(EvidenceStatus.RESTRICTED, evidence.security.knoxClaim.status)
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
        assertFalse(security.screenLockPresent.value ?: true)
    }
}
