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
 *
 * Every method that reads or moves mutable state is [`@Synchronized`][kotlin.jvm.Synchronized].
 * The Host reads JSON-lines on a single stdin/stdout pair and normally handles
 * one request at a time, but idempotency that only holds *because* requests
 * happen to be sequential is not idempotency - it is an accident. Guarding the
 * check-and-set here is what makes "a scan is never debited twice" true even
 * if a second request is ever dispatched while the first is still settling.
 */
class HostLicenseService(
    private var currentRecord: CustomerLicenseRecord,
) {
    private val transactions = mutableListOf<DeviceScanTransaction>()

    @Synchronized
    fun getLicense(): CustomerLicenseRecord {
        return currentRecord
    }

    /**
     * A snapshot of every transaction this service holds, settled or not.
     *
     * Read-only by construction: callers get copies, so the journal cannot be
     * rewritten from outside. Exposed so tests can assert the *absence* of a
     * pending reservation, which is otherwise unobservable from the balance.
     */
    @Synchronized
    fun allTransactions(): List<DeviceScanTransaction> = transactions.toList()

    /**
     * Simulates or executes entitlement refresh against the CYVRA server.
     * In offline/unreachable conditions, safely falls back to cached grace period.
     */
    @Synchronized
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
    @Synchronized
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
     *
     * Creates a **committed-pending** transaction: the entitlement is reserved,
     * not spent. Nothing here decrements [CustomerLicenseRecord.scansUsed] or
     * [CustomerLicenseRecord.scansRemaining], because a scan that later fails
     * or is abandoned must never have cost the customer anything.
     *
     * Prevents accidental double-burning or premature decrement.
     */
    @Synchronized
    fun commitScanForSession(sessionUuid: String, deviceIdentifier: String): DeviceScanTransaction {
        /*
         * Availability, not balance.
         *
         * A reservation does not move the balance (§14), so a workstation that
         * never asks for a certificate would otherwise be able to reserve an
         * unlimited number of scans it has not paid for. Counting unsettled
         * reservations keeps "not yet debited" a *bounded* state rather than an
         * escape hatch: the customer's entitlement still reads 25, but only
         * 25 outstanding scans can be held at once.
         */
        val unsettled = transactions.count { it.status == ScanCommitStatus.COMMITTED }
        check(currentRecord.scansRemaining - unsettled > 0) {
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
     * Marks a committed transaction abandoned, so it is never settled.
     *
     * Called when a scan fails or the operator walks away mid-flight. The
     * transaction stays on the list as [ScanCommitStatus.CANCELLED_PRE_FLIGHT]
     * - a reservation that was released is still part of the audit history, and
     * dropping it would hide that a scan had been attempted at all.
     */
    @Synchronized
    fun abandonScan(sessionUuid: String) {
        val index = transactions.indexOfFirst {
            it.sessionUuid == sessionUuid && it.status == ScanCommitStatus.COMMITTED
        }
        if (index < 0) return
        val tx = transactions[index]
        transactions[index] = tx.copy(status = ScanCommitStatus.CANCELLED_PRE_FLIGHT)
    }

    /**
     * The transaction committed for [sessionUuid], whatever its status.
     *
     * Exposed for tests and diagnostics: the ledger's claim that a scan was
     * committed, and the service's own record, must be the same object.
     */
    @Synchronized
    fun transactionFor(sessionUuid: String): DeviceScanTransaction? =
        transactions.lastOrNull { it.sessionUuid == sessionUuid }

    /**
     * Settles the committed transaction for [sessionUuid] by spending exactly
     * one scan - **idempotently** (§14).
     *
     * The second and later calls for the same session return the record
     * unchanged. GET_FINAL_REPORT is a *read* of a certificate that already
     * exists, so an operator who fetches it twice, or a client that retries a
     * timed-out request, must not be charged twice. Idempotency lives here
     * rather than at the call site precisely so that every caller gets it for
     * free and none can forget it.
     *
     * Returns `true` when this call performed the debit and `false` when the
     * session was already settled or had no pending transaction to settle.
     */
    @Synchronized
    fun debitForSession(sessionUuid: String): Boolean {
        val index = transactions.indexOfFirst { it.sessionUuid == sessionUuid }
        // No committed transaction for this session: nothing was reserved, so
        // nothing may be spent. A report reached without a scan is a bug in the
        // caller, never a licence to debit.
        if (index < 0) return false

        val tx = transactions[index]
        if (tx.status != ScanCommitStatus.COMMITTED) return false

        /*
         * The entitlement floor. The reservation guard in `commitScanForSession`
         * makes this unreachable in ordinary operation, but a floor that only
         * holds in ordinary operation is not a floor: should an upgrade
         * revision ever shrink the entitlement underneath a held reservation,
         * the choice is between charging the customer for more than they bought
         * and forgoing a scan. Forgoing costs the vendor a scan; overcharging
         * costs the customer a contract. The vendor takes the hit.
         */
        if (currentRecord.scansUsed >= currentRecord.deviceScanEntitlement) return false

        transactions[index] = tx.copy(status = ScanCommitStatus.VERIFIED_AND_DEBITED)

        currentRecord = currentRecord.copy(
            scansUsed = currentRecord.scansUsed + 1,
            scansRemaining = (currentRecord.deviceScanEntitlement - (currentRecord.scansUsed + 1)).coerceAtLeast(0),
        )
        return true
    }

    /**
     * Finalizes scan consumption once diagnostic/purge report is verified.
     *
     * Retained for the transaction-id call sites; [debitForSession] is the
     * session-keyed form the protocol uses. Settling an already-settled
     * transaction is a no-op for the same reason: the debit is idempotent.
     */
    @Synchronized
    fun finalizeScanDebit(transactionId: String): CustomerLicenseRecord {
        val index = transactions.indexOfFirst { it.transactionId == transactionId }
        check(index >= 0) { "Transaction $transactionId not found" }

        val tx = transactions[index]
        if (tx.status == ScanCommitStatus.VERIFIED_AND_DEBITED) return currentRecord

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
