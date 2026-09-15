package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.EntitlementRevisionRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import cyvra.mobile.core.ScanEntitlementPlan
import cyvra.mobile.core.ScanLedgerEntry
import cyvra.mobile.core.UpgradeHandoffRequest
import java.util.UUID

/**
 * Host Upgrade Flow & Scan Accounting Engine (§11, §12, §13, §14 / Phase 17).
 *
 * Core Guarantees:
 * 1. Decoupled Upgrade: Modifies scan capacity via official checkout handoff; does not touch software updates.
 * 2. Immutable License Identity: Internal license_id is strictly preserved across revisions.
 * 3. Usage Preservation: Carried-over usage is strictly maintained across new plans.
 * 4. Transactional Accounting: Commits at diagnostic start; debits only upon verified completion.
 */
class HostUpgradeAccountingEngine(
    initialLicense: CustomerLicenseRecord,
    initialPlan: ScanEntitlementPlan = ScanEntitlementPlan.TIER_3,
    private val checkoutPortalBaseUrl: String = "https://www.cyvoriq.co.in/checkout/upgrade",
) {
    var currentLicense: CustomerLicenseRecord = initialLicense
        private set

    private val revisions = mutableListOf<EntitlementRevisionRecord>()
    private val ledger = mutableListOf<ScanLedgerEntry>()

    init {
        // Initialize Revision 1
        revisions.add(
            EntitlementRevisionRecord(
                revisionNumber = currentLicense.revision,
                serialNumber = currentLicense.serialNumber,
                plan = initialPlan,
                totalScans = currentLicense.deviceScanEntitlement,
                carriedOverUsage = currentLicense.scansUsed,
                scansRemaining = currentLicense.scansRemaining,
                status = currentLicense.status,
                activatedAt = currentLicense.lastVerifiedAt,
            )
        )
    }

    /**
     * Returns an immutable snapshot of all historical and current entitlement revisions.
     */
    fun getRevisionHistory(): List<EntitlementRevisionRecord> = revisions.toList()

    /**
     * Returns an immutable snapshot of the scan accounting ledger.
     */
    fun getScanLedger(): List<ScanLedgerEntry> = ledger.toList()

    /**
     * Creates an authenticated web checkout handoff request (§12, §31).
     */
    fun createUpgradeHandoff(
        targetPlan: ScanEntitlementPlan,
        customerEmail: String,
    ): UpgradeHandoffRequest {
        val reqId = "UPG-REQ-${UUID.randomUUID().toString().take(8).uppercase()}"
        val handoffUrl = "$checkoutPortalBaseUrl?reqId=$reqId&licenseId=${currentLicense.licenseId}&plan=${targetPlan.planCode}&rev=${currentLicense.revision}"

        return UpgradeHandoffRequest(
            requestId = reqId,
            licenseId = currentLicense.licenseId,
            currentSerial = currentLicense.serialNumber,
            currentRevision = currentLicense.revision,
            targetPlan = targetPlan,
            customerEmail = customerEmail,
            handoffUrl = handoffUrl,
        )
    }

    /**
     * Applies a confirmed upgrade order from the server (§12, §13).
     * Retains immutable license_id, marks previous revision as SUPERSEDED,
     * carries over existing used scans, and activates the new revision.
     */
    fun applyUpgradeRevision(
        newPlan: ScanEntitlementPlan,
        newSerialNumber: String,
        externalOrderId: String,
    ): CustomerLicenseRecord {
        require(newPlan.scanCount >= currentLicense.scansUsed) {
            "New plan (${newPlan.scanCount} scans) cannot be smaller than already consumed scans (${currentLicense.scansUsed})"
        }

        val previousRevisionIndex = revisions.indexOfLast { it.status == LicenseEntitlementStatus.ACTIVE }
        val now = java.time.Instant.now().toString()

        if (previousRevisionIndex >= 0) {
            val prev = revisions[previousRevisionIndex]
            revisions[previousRevisionIndex] = prev.copy(
                status = LicenseEntitlementStatus.SUPERSEDED,
                supersededAt = now,
            )
        }

        val nextRevisionNumber = currentLicense.revision + 1
        val remaining = newPlan.scanCount - currentLicense.scansUsed

        val newRevision = EntitlementRevisionRecord(
            revisionNumber = nextRevisionNumber,
            serialNumber = newSerialNumber,
            plan = newPlan,
            totalScans = newPlan.scanCount,
            carriedOverUsage = currentLicense.scansUsed,
            scansRemaining = remaining,
            status = LicenseEntitlementStatus.ACTIVE,
            activatedAt = now,
            externalOrderId = externalOrderId,
        )
        revisions.add(newRevision)

        currentLicense = currentLicense.copy(
            serialNumber = newSerialNumber,
            planName = newPlan.displayName,
            deviceScanEntitlement = newPlan.scanCount,
            scansRemaining = remaining,
            revision = nextRevisionNumber,
            status = LicenseEntitlementStatus.ACTIVE,
            lastVerifiedAt = now,
        )

        return currentLicense
    }

    /**
     * Commits a scan transaction at diagnostic start (§14).
     * Prevents scan deduction if connection drops before processing.
     */
    fun commitScanTransaction(
        sessionUuid: String,
        deviceIdentifier: String,
        operatorId: String,
    ): ScanLedgerEntry {
        check(currentLicense.scansRemaining > 0) {
            "Scan commitment rejected: zero scans remaining in current entitlement"
        }
        check(currentLicense.status == LicenseEntitlementStatus.ACTIVE) {
            "Scan commitment rejected: license status is ${currentLicense.status}"
        }

        val txId = "TX-SCAN-${UUID.randomUUID().toString().take(8).uppercase()}"
        val entry = ScanLedgerEntry(
            transactionId = txId,
            licenseId = currentLicense.licenseId,
            revisionNumber = currentLicense.revision,
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
            eventType = ScanCommitStatus.COMMITTED,
            scanSequenceNumber = currentLicense.scansUsed + 1,
            operatorId = operatorId,
        )
        ledger.add(entry)
        return entry
    }

    /**
     * Finalizes and debits the scan once condition or purge report is verified (§14).
     */
    fun finalizeScanDebit(
        transactionId: String,
        reportId: String,
        operatorId: String,
    ): CustomerLicenseRecord {
        val entryIndex = ledger.indexOfFirst { it.transactionId == transactionId && it.eventType == ScanCommitStatus.COMMITTED }
        check(entryIndex >= 0) {
            "Cannot debit: committed transaction $transactionId not found"
        }

        val committedEntry = ledger[entryIndex]
        val debitEntry = committedEntry.copy(
            eventType = ScanCommitStatus.VERIFIED_AND_DEBITED,
            reportId = reportId,
            operatorId = operatorId,
            timestamp = java.time.Instant.now().toString(),
        )
        ledger.add(debitEntry)

        val newUsed = currentLicense.scansUsed + 1
        val newRemaining = (currentLicense.deviceScanEntitlement - newUsed).coerceAtLeast(0)

        currentLicense = currentLicense.copy(
            scansUsed = newUsed,
            scansRemaining = newRemaining,
            lastVerifiedAt = java.time.Instant.now().toString(),
        )

        return currentLicense
    }

    /**
     * Cancels a committed scan if pre-flight inspection is aborted by the operator (§14).
     */
    fun cancelCommittedScan(
        transactionId: String,
        operatorId: String,
    ) {
        val entryIndex = ledger.indexOfFirst { it.transactionId == transactionId && it.eventType == ScanCommitStatus.COMMITTED }
        check(entryIndex >= 0) {
            "Cannot cancel: committed transaction $transactionId not found"
        }

        val committedEntry = ledger[entryIndex]
        val cancelEntry = committedEntry.copy(
            eventType = ScanCommitStatus.CANCELLED_PRE_FLIGHT,
            operatorId = operatorId,
            timestamp = java.time.Instant.now().toString(),
        )
        ledger.add(cancelEntry)
    }
}
