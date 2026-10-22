package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * D-1 / U-1 — device lifecycle identity contract.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * A device lifecycle id is the root of the evidence chain: capability profiles,
 * evidence records, evidence batches, processing sessions and reports all hang off
 * it by foreign key (`database/migrations/0002_sturdy_salo.sql`,
 * `0003_smiling_gideon.sql`). `database/src/schema.ts:302-316` declares the column
 * `uuid("id").primaryKey()`, and `packages/evidence` validates the same shape.
 *
 * A prefixed, truncated random value satisfies neither. This test states the
 * contract the rest of the system already enforces. It does NOT invent an identity
 * authority and does NOT prescribe how a registered identity is obtained — that
 * design choice is Chief Engineer decision D-CE-26-01.
 *
 * EXPECTED OUTCOME AGAINST CURRENT SOURCE
 * ---------------------------------------
 * The first test FAILS. `WorkstationSessionOrchestrator.kt:149` emits
 * `"CYVRA-SESSION-" + UUID.randomUUID().take(12).toUpperCase()`, which is neither a
 * UUID nor a registered `device_lifecycles` key. A red result here is the intended
 * evidence of defect D-1; it must be preserved rather than silenced by weakening the
 * assertion. Do not edit production code to make this pass without D-CE-26-01.
 *
 * SCOPE BOUNDARY
 * --------------
 * Session-scoped correlation ids are a legitimate separate concept. This test makes
 * no claim that sessions should not be correlated — only that a DEVICE identity
 * must be a real registered UUID.
 */
class DeviceLifecycleIdentityContractTest {

    private class MockProcessRunner : ProcessRunner {
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

    private fun orchestrator(): WorkstationSessionOrchestrator = WorkstationSessionOrchestrator(
        AdbClient(adbBinary = File("/opt/mock/adb"), processRunner = MockProcessRunner()),
        HostLicenseService(sampleLicense()),
    )

    /**
     * A session id handed to the license ledger and into the evidence chain must be a
     * real UUID. Anything else cannot be stored in `device_lifecycles.id`, cannot be
     * joined to collected evidence, and cannot attribute a report to a device across
     * sessions.
     */
    @Test
    fun sessionIdentitySatisfiesTheUuidContractTheDatabaseAlreadyRequires() {
        val result = orchestrator().executeDiagnostic(
            serial = "RF8R123456",
            operatorId = "operator@cyvoriq.com",
        )

        val sessionUuid = result.sessionUuid
        assertTrue(sessionUuid.isNotBlank(), "a scan must produce a session identity")

        val parsed = runCatching { UUID.fromString(sessionUuid) }.getOrNull()
            ?: fail(
                "D-1 DEFECT PRESERVED: session identity '$sessionUuid' is not a UUID, but " +
                    "database/src/schema.ts:302-316 declares device_lifecycles.id as a uuid " +
                    "PRIMARY KEY and packages/evidence validates the same shape. The id " +
                    "therefore cannot satisfy the device_lifecycles foreign key " +
                    "(database/migrations/0002_sturdy_salo.sql, 0003_smiling_gideon.sql), so " +
                    "evidence cannot be attributed to a device across sessions. Resolution " +
                    "requires Chief Engineer decision D-CE-26-01 — do not invent an identity " +
                    "authority here.",
            )

        assertTrue(
            parsed.toString() == sessionUuid.lowercase(),
            "a UUID identity must round-trip in canonical lower-case form",
        )
    }

    /**
     * Two scans of the same physical device must not collide. The current format is a
     * prefix plus twelve hex characters — 48 bits — which is both non-canonical and
     * short, so this also guards against a naive "fix" that merely drops the prefix.
     */
    @Test
    fun twoScansOfTheSameDeviceNeverShareAnIdentity() {
        val device = orchestrator()

        val first = device.executeDiagnostic("RF8R123456", "operator@cyvoriq.com")
        val second = device.executeDiagnostic("RF8R123456", "operator@cyvoriq.com")

        assertNotEquals(
            first.sessionUuid,
            second.sessionUuid,
            "a repeated scan of one device must produce distinct session identities",
        )
    }
}
