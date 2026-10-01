package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.HostWorkstationConnectionStatus
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class WorkstationSessionOrchestratorTest {

    private class MockProcessRunner : ProcessRunner {
        var lastCommand: List<String> = emptyList()

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            lastCommand = command
            val cmdStr = command.joinToString(" ")

            return when {
                cmdStr.contains("devices -l") -> {
                    DefaultProcessExecutionResult(
                        exitCode = 0,
                        stdout = "List of devices attached\nRF8R123456 device product:a52 model:SM_A525F transport_id:1\n",
                        stderr = "",
                    )
                }
                cmdStr.contains("getprop") -> {
                    val prop = cmdStr.substringAfter("getprop ").trim()
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
                cmdStr.contains("dumpsys battery") -> {
                    val batteryOutput = "AC powered: false\nUSB powered: true\nlevel: 82\nscale: 100\nvoltage: 4100\ntemperature: 295\nhealth: 2\n"
                    DefaultProcessExecutionResult(exitCode = 0, stdout = batteryOutput, stderr = "")
                }
                cmdStr.contains("df -k /data") -> {
                    val dfOutput = "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-4 115200000 45200000 70000000 40% /data\n"
                    DefaultProcessExecutionResult(exitCode = 0, stdout = dfOutput, stderr = "")
                }
                else -> DefaultProcessExecutionResult(exitCode = 0, stdout = "ok", stderr = "")
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

    @Test
    fun pollsDeviceStatusAccurately() {
        val mockRunner = MockProcessRunner()
        val adbClient = AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = mockRunner)
        val licenseService = HostLicenseService(sampleLicense())
        val orchestrator = WorkstationSessionOrchestrator(adbClient, licenseService)

        val descriptor = orchestrator.pollDeviceState(usbConnected = true)
        assertEquals("RF8R123456", descriptor.serial)
        assertEquals(HostWorkstationConnectionStatus.READY_TO_SCAN, descriptor.connectionStatus)
    }

    @Test
    fun executeDiagnosticReservesAScanWithoutSpendingIt() {
        val mockRunner = MockProcessRunner()
        val adbClient = AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = mockRunner)
        val licenseService = HostLicenseService(sampleLicense())
        val orchestrator = WorkstationSessionOrchestrator(adbClient, licenseService)

        val result = orchestrator.executeDiagnostic(
            serial = "RF8R123456",
            operatorId = "operator@cyvoriq.com",
        )

        assertNotNull(result.sessionUuid)
        assertEquals("samsung", result.evidence.identity.manufacturer.value)
        assertEquals("SM-A525F", result.evidence.identity.model.value)
        assertEquals(82, result.evidence.battery.levelPercent.value)

        /*
         * §14: RUN_SCAN is a reservation, not a purchase. Nothing has been
         * written to disk for this session yet, so nothing has been spent.
         */
        assertEquals(0, result.updatedLicense.scansUsed)
        assertEquals(25, result.updatedLicense.scansRemaining)

        val reservation = assertNotNull(
            licenseService.transactionFor(result.sessionUuid),
            "a committed-pending transaction must exist for the session",
        )
        assertEquals(
            ScanCommitStatus.COMMITTED,
            reservation.status,
            "the transaction must still be pending after the scan",
        )

        // Settling happens when a certificate exists, and is idempotent.
        assertTrue(licenseService.debitForSession(result.sessionUuid))
        assertEquals(1, licenseService.getLicense().scansUsed)
        assertEquals(24, licenseService.getLicense().scansRemaining)

        // Fetching the same certificate again must never charge twice.
        assertFalse(licenseService.debitForSession(result.sessionUuid))
        assertEquals(1, licenseService.getLicense().scansUsed)
        assertEquals(24, licenseService.getLicense().scansRemaining)

        // Report contains valid SHA-256 integrity digest
        assertNotNull(result.report.integrity)
        assertTrue(result.report.integrity!!.contentDigest.isNotEmpty())
        assertTrue(result.reportMarkdown.contains("CYVRA Device Verification Report"))
    }

    @Test
    fun aScanThatFailsLeavesNoSettleableReservationBehind() {
        // A runner that answers nothing: evidence collection cannot complete,
        // so the diagnostic exits before any report exists.
        val adbClient = AdbClient(
            adbBinary = File("/opt/mock/adb"),
            processRunner = object : ProcessRunner {
                override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult =
                    DefaultProcessExecutionResult(exitCode = 1, stdout = "", stderr = "no device")
            },
        )
        val licenseService = HostLicenseService(sampleLicense())
        val orchestrator = WorkstationSessionOrchestrator(adbClient, licenseService)

        val outcome = runCatching {
            orchestrator.executeDiagnostic(
                serial = "RF8R123456",
                operatorId = "operator@cyvoriq.com",
            )
        }

        // The reservation must be released on the way out of a failed scan.
        // Left pending, it would be a transaction nobody could settle and
        // nobody could see - the accounting equivalent of a ghost.
        if (outcome.isFailure) {
            assertTrue(
                licenseService.allTransactions().none {
                    it.status == ScanCommitStatus.COMMITTED
                },
                "a failed scan must release its reservation",
            )
        }

        // Either way, no certificate was produced, so nothing was spent.
        assertEquals(0, licenseService.getLicense().scansUsed)
        assertEquals(25, licenseService.getLicense().scansRemaining)
    }

    @Test
    fun anAbandonedReservationCannotBeSettledLater() {
        val licenseService = HostLicenseService(sampleLicense())

        licenseService.commitScanForSession("CYVRA-SESSION-ABANDON1", "RF8R123456")
        licenseService.abandonScan("CYVRA-SESSION-ABANDON1")

        assertEquals(
            ScanCommitStatus.CANCELLED_PRE_FLIGHT,
            licenseService.transactionFor("CYVRA-SESSION-ABANDON1")?.status,
            "an abandoned scan must stay on the books as released, not vanish",
        )
        assertFalse(
            licenseService.debitForSession("CYVRA-SESSION-ABANDON1"),
            "a released reservation must never be chargeable",
        )
        assertEquals(0, licenseService.getLicense().scansUsed)
        assertEquals(25, licenseService.getLicense().scansRemaining)
    }
}
