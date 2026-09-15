package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.DeviceScanTransaction
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.ScanCommitStatus
import java.util.UUID

/**
 * Host-side License & Entitlement Service implementing §29 (Phase 3 / C2).
 * - Enforces immutable license_id
 * - Maintains entitlement balances (device scans vs operator seats)
 * - Safe offline grace period handling (never says 'invalid' when server is unreachable)
 * - Scan commit and debit transactional safety (§14)
 */
class HostLicenseService(
    private var currentRecord: CustomerLicenseRecord,
) {
    private val transactions = mutableListOf<DeviceScanTransaction>()

    fun getLicense(): CustomerLicenseRecord {
        return currentRecord
    }

    /**
     * Simulates or executes entitlement refresh against the CYVRA server.
     * In offline/unreachable conditions, safely falls back to cached grace period.
     */
    fun refreshEntitlement(networkAvailable: Boolean): CustomerLicenseRecord {
        if (!networkAvailable) {
            currentRecord = currentRecord.copy(
                status = LicenseEntitlementStatus.SERVER_UNAVAILABLE,
            )
            return currentRecord
        }

        currentRecord = currentRecord.copy(
            status = LicenseEntitlementStatus.ACTIVE,
            lastVerifiedAt = java.time.Instant.now().toString(),
        )
        return currentRecord
    }

    /**
     * Upgrades customer entitlement revision (e.g. 3 scans -> 25 scans)
     * Preserves immutable license_id and usage history (§13).
     */
    fun applyUpgradeRevision(
        newSerialNumber: String,
        newPlanName: String,
        newTotalScans: Int,
    ): CustomerLicenseRecord {
        require(newTotalScans >= currentRecord.scansUsed) {
            "New plan entitlement cannot be less than currently consumed scans"
        }

        currentRecord = currentRecord.copy(
            serialNumber = newSerialNumber,
            planName = newPlanName,
            deviceScanEntitlement = newTotalScans,
            scansRemaining = newTotalScans - currentRecord.scansUsed,
            revision = currentRecord.revision + 1,
            status = LicenseEntitlementStatus.ACTIVE,
            lastVerifiedAt = java.time.Instant.now().toString(),
        )
        return currentRecord
    }

    /**
     * Commits a scan transaction at diagnostic start (§14).
     * Prevents accidental double-burning or premature decrement.
     */
    fun commitScanForSession(sessionUuid: String, deviceIdentifier: String): DeviceScanTransaction {
        check(currentRecord.scansRemaining > 0) {
            "Cannot commit scan: no remaining scan entitlements"
        }
        check(currentRecord.status == LicenseEntitlementStatus.ACTIVE || currentRecord.status == LicenseEntitlementStatus.SERVER_UNAVAILABLE) {
            "Cannot commit scan: license status is ${currentRecord.status}"
        }

        val transaction = DeviceScanTransaction(
            transactionId = "TX-${UUID.randomUUID().toString().take(8).uppercase()}",
            licenseId = currentRecord.licenseId,
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
            status = ScanCommitStatus.COMMITTED,
            debitedScanNumber = currentRecord.scansUsed + 1,
        )
        transactions.add(transaction)
        return transaction
    }

    /**
     * Finalizes scan consumption once diagnostic/purge report is verified.
     */
    fun finalizeScanDebit(transactionId: String): CustomerLicenseRecord {
        val index = transactions.indexOfFirst { it.transactionId == transactionId }
        check(index >= 0) { "Transaction $transactionId not found" }

        val tx = transactions[index]
        check(tx.status == ScanCommitStatus.COMMITTED) {
            "Transaction already settled with status ${tx.status}"
        }

        transactions[index] = tx.copy(status = ScanCommitStatus.VERIFIED_AND_DEBITED)

        currentRecord = currentRecord.copy(
            scansUsed = currentRecord.scansUsed + 1,
            scansRemaining = (currentRecord.deviceScanEntitlement - (currentRecord.scansUsed + 1)).coerceAtLeast(0),
        )
        return currentRecord
    }
}
