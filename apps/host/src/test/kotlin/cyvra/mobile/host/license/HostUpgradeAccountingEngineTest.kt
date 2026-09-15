package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import cyvra.mobile.core.ScanEntitlementPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HostUpgradeAccountingEngineTest {

    private fun createSampleLicense(
        usedScans: Int = 2,
        totalScans: Int = 3,
        status: LicenseEntitlementStatus = LicenseEntitlementStatus.ACTIVE,
    ): CustomerLicenseRecord {
        return CustomerLicenseRecord(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA-XXXX-001",
            customerEmail = "partner@cyvoriq.com",
            customerName = "ABC Partner",
            companyName = "ABC Technologies",
            planName = "3 Device Scans",
            deviceScanEntitlement = totalScans,
            scansUsed = usedScans,
            scansRemaining = totalScans - usedScans,
            revision = 1,
            status = status,
        )
    }

    @Test
    fun generatesAuthenticatedUpgradeHandoffUrl() {
        val license = createSampleLicense(usedScans = 2, totalScans = 3)
        val engine = HostUpgradeAccountingEngine(license, ScanEntitlementPlan.TIER_3)

        val handoff = engine.createUpgradeHandoff(
            targetPlan = ScanEntitlementPlan.TIER_25,
            customerEmail = "partner@cyvoriq.com",
        )

        assertEquals("LIC-000001", handoff.licenseId)
        assertEquals(ScanEntitlementPlan.TIER_25, handoff.targetPlan)
        assertTrue(handoff.handoffUrl.contains("plan=PLAN-25"))
        assertTrue(handoff.handoffUrl.contains("licenseId=LIC-000001"))
    }

    @Test
    fun appliesUpgradeRevisionCarryingOverUsedScansAndPreservingLicenseId() {
        // Initial state: Plan 3 scans, used 2, remaining 1
        val initialLicense = createSampleLicense(usedScans = 2, totalScans = 3)
        val engine = HostUpgradeAccountingEngine(initialLicense, ScanEntitlementPlan.TIER_3)

        assertEquals(1, engine.getRevisionHistory().size)
        assertEquals(LicenseEntitlementStatus.ACTIVE, engine.getRevisionHistory()[0].status)

        // Upgrade: Customer upgrades to Tier 25 scans
        val upgradedLicense = engine.applyUpgradeRevision(
            newPlan = ScanEntitlementPlan.TIER_25,
            newSerialNumber = "CYVRA-XXXX-002",
            externalOrderId = "ORD-CYVRA-2026-90412",
        )

        // Verifications per §13
        assertEquals("LIC-000001", upgradedLicense.licenseId, "Immutable license_id must be preserved")
        assertEquals(2, upgradedLicense.revision, "Revision number must increment")
        assertEquals(25, upgradedLicense.deviceScanEntitlement)
        assertEquals(2, upgradedLicense.scansUsed, "Carried-over usage must be retained")
        assertEquals(23, upgradedLicense.scansRemaining, "25 - 2 = 23 scans remaining")
        assertEquals("CYVRA-XXXX-002", upgradedLicense.serialNumber)

        val history = engine.getRevisionHistory()
        assertEquals(2, history.size)
        assertEquals(LicenseEntitlementStatus.SUPERSEDED, history[0].status, "Revision 1 marked SUPERSEDED")
        assertEquals(LicenseEntitlementStatus.ACTIVE, history[1].status, "Revision 2 is ACTIVE")
        assertEquals(2, history[1].carriedOverUsage)
        assertEquals(23, history[1].scansRemaining)
    }

    @Test
    fun rejectsUpgradeIfTargetPlanIsSmallerThanConsumedScans() {
        val initialLicense = createSampleLicense(usedScans = 5, totalScans = 7)
        val engine = HostUpgradeAccountingEngine(initialLicense, ScanEntitlementPlan.TIER_7)

        assertFailsWith<IllegalArgumentException> {
            // Cannot upgrade/downgrade to Tier 3 when 5 scans are already used
            engine.applyUpgradeRevision(
                newPlan = ScanEntitlementPlan.TIER_3,
                newSerialNumber = "CYVRA-INVALID-002",
                externalOrderId = "ORD-ERR-001",
            )
        }
    }

    @Test
    fun commitsScanAtDiagnosticStartAndDebitsOnReportCompletion() {
        val initialLicense = createSampleLicense(usedScans = 1, totalScans = 3)
        val engine = HostUpgradeAccountingEngine(initialLicense, ScanEntitlementPlan.TIER_3)

        assertEquals(2, engine.currentLicense.scansRemaining)

        // Step 1: Customer clicks START diagnostic -> Commit transaction
        val tx = engine.commitScanTransaction(
            sessionUuid = "SESS-20260915-001",
            deviceIdentifier = "RF8R123456",
            operatorId = "operator@cyvoriq.com",
        )

        assertEquals(ScanCommitStatus.COMMITTED, tx.eventType)
        assertEquals(2, tx.scanSequenceNumber)

        // Step 2: Diagnostic & inspection finishes -> debit transaction
        val debitedLicense = engine.finalizeScanDebit(
            transactionId = tx.transactionId,
            reportId = "CYVRA-REPORT-001",
            operatorId = "operator@cyvoriq.com",
        )

        assertEquals(2, debitedLicense.scansUsed)
        assertEquals(1, debitedLicense.scansRemaining)

        val ledger = engine.getScanLedger()
        assertEquals(2, ledger.size)
        assertEquals(ScanCommitStatus.COMMITTED, ledger[0].eventType)
        assertEquals(ScanCommitStatus.VERIFIED_AND_DEBITED, ledger[1].eventType)
    }

    @Test
    fun cancelsCommittedScanWhenPreFlightAborted() {
        val initialLicense = createSampleLicense(usedScans = 1, totalScans = 3)
        val engine = HostUpgradeAccountingEngine(initialLicense, ScanEntitlementPlan.TIER_3)

        val tx = engine.commitScanTransaction(
            sessionUuid = "SESS-20260915-001",
            deviceIdentifier = "RF8R123456",
            operatorId = "operator@cyvoriq.com",
        )

        engine.cancelCommittedScan(tx.transactionId, "operator@cyvoriq.com")

        val ledger = engine.getScanLedger()
        assertEquals(2, ledger.size)
        assertEquals(ScanCommitStatus.CANCELLED_PRE_FLIGHT, ledger[1].eventType)
        assertEquals(1, engine.currentLicense.scansUsed, "Usage must not increment on aborted pre-flight")
    }
}
