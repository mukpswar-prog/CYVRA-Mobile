package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class HostLicenseServiceTest {

    private fun sampleLicense() = CustomerLicenseRecord(
        licenseId = "LIC-000001",
        serialNumber = "CYVRA15092026SA3F1-1-3",
        customerEmail = "test@customer.com",
        customerName = "Ramesh Kumar",
        companyName = "Kumar Refurbishing",
        planName = "3 Device Scans",
        deviceScanEntitlement = 3,
        scansUsed = 1,
        scansRemaining = 2,
        revision = 1,
        status = LicenseEntitlementStatus.ACTIVE,
    )

    @Test
    fun preservesImmutableLicenseIdAcrossUpgrades() {
        val service = HostLicenseService(sampleLicense())

        // Upgrade plan from 3 to 25 scans
        val upgraded = service.applyUpgradeRevision(
            newSerialNumber = "CYVRA15092026SA3F1-1-25",
            newPlanName = "25 Device Scans",
            newTotalScans = 25,
        )

        assertEquals("LIC-000001", upgraded.licenseId, "License ID must remain unchanged")
        assertEquals(2, upgraded.revision, "Revision incremented")
        assertEquals(25, upgraded.deviceScanEntitlement)
        assertEquals(1, upgraded.scansUsed, "Previous usage preserved")
        assertEquals(24, upgraded.scansRemaining, "25 - 1 = 24 remaining")
    }

    @Test
    fun transactionalScanCommitAndDebit() {
        val service = HostLicenseService(sampleLicense())

        // 1. Commit scan at diagnostic start
        val tx = service.commitScanForSession("SESSION-UUID-1234", "RF8R123456")
        assertEquals(ScanCommitStatus.COMMITTED, tx.status)
        assertEquals(2, tx.debitedScanNumber)

        // Balance not yet deducted before completion
        assertEquals(2, service.getLicense().scansRemaining)

        // 2. Finalize scan on report generation
        val finalLicense = service.finalizeScanDebit(tx.transactionId)
        assertEquals(2, finalLicense.scansUsed)
        assertEquals(1, finalLicense.scansRemaining)
    }

    @Test
    fun handlesOfflineServerUnavailableGracefully() {
        val service = HostLicenseService(sampleLicense())
        val offline = service.refreshEntitlement(networkAvailable = false)

        assertEquals(LicenseEntitlementStatus.SERVER_UNAVAILABLE, offline.status)
        assertEquals(2, offline.scansRemaining)
    }

    @Test
    fun preventsScanCommitWhenBalanceIsZero() {
        val emptyLicense = sampleLicense().copy(scansUsed = 3, scansRemaining = 0)
        val service = HostLicenseService(emptyLicense)

        assertFailsWith<IllegalStateException> {
            service.commitScanForSession("SESSION-UUID-EMPTY", "DEV-1")
        }
    }
}
