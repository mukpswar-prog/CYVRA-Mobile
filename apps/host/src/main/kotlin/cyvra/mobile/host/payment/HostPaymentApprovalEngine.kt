package cyvra.mobile.host.payment

import cyvra.mobile.core.AdminApprovalDecision
import cyvra.mobile.core.AdminApprovalRecord
import cyvra.mobile.core.CommercialOrderRecord
import cyvra.mobile.core.OrderLifecycleStatus
import cyvra.mobile.core.PaymentProviderType
import cyvra.mobile.core.PaymentVerificationRecord
import cyvra.mobile.core.ScanEntitlementPlan
import java.util.UUID

/**
 * Host & Server Commercial Payment & Staff Approval Engine (§10 & §30 / Phase 18).
 * Enforces the strict Early Production commercial flow:
 * 1. Customer initiates order -> CREATED / PAYMENT_PENDING
 * 2. Trusted Payment Gateway confirms webhook -> PAYMENT_CONFIRMED -> WAITING_ADMIN_APPROVAL
 * 3. Nominated Staff/Admin reviews and approves -> APPROVED
 * 4. Server issues new serial and entitlement revision -> ENTITLEMENT_ISSUED
 *
 * Security Invariants:
 * - Desktop client never validates payments locally (§30, §43).
 * - Entitlement cannot be issued directly from PAYMENT_PENDING or REJECTED.
 * - Admin approval is strictly audited with decider identity and timestamp.
 */
class HostPaymentApprovalEngine(
    private val requireAdminApproval: Boolean = true,
) {
    private val orders = mutableMapOf<String, CommercialOrderRecord>()

    fun getOrder(orderId: String): CommercialOrderRecord? = orders[orderId]

    fun listOrders(): List<CommercialOrderRecord> = orders.values.toList()

    /**
     * Step 1: Creates a new commercial upgrade or initial purchase order.
     */
    fun createOrder(
        customerEmail: String,
        licenseId: String,
        targetPlan: ScanEntitlementPlan,
    ): CommercialOrderRecord {
        val orderId = "ORD-${UUID.randomUUID().toString().take(8).uppercase()}"
        val order = CommercialOrderRecord(
            orderId = orderId,
            customerEmail = customerEmail,
            licenseId = licenseId,
            targetPlan = targetPlan,
            status = OrderLifecycleStatus.PAYMENT_PENDING,
        )
        orders[orderId] = order
        return order
    }

    /**
     * Step 2: Server-side payment confirmation from trusted provider webhook.
     */
    fun confirmPayment(
        orderId: String,
        provider: PaymentProviderType,
        providerReference: String,
        amountMinorUnits: Long,
        currency: String = "INR",
        signatureVerified: Boolean = true,
    ): CommercialOrderRecord {
        val existing = orders[orderId] ?: throw IllegalArgumentException("Order $orderId not found")
        require(existing.status == OrderLifecycleStatus.PAYMENT_PENDING || existing.status == OrderLifecycleStatus.CREATED) {
            "Cannot confirm payment on order in state ${existing.status}"
        }
        require(signatureVerified) {
            "Payment confirmation rejected: cryptographic signature verification failed"
        }

        val now = java.time.Instant.now().toString()
        val paymentRecord = PaymentVerificationRecord(
            paymentId = "PAY-${UUID.randomUUID().toString().take(8).uppercase()}",
            provider = provider,
            providerReference = providerReference,
            amountMinorUnits = amountMinorUnits,
            currency = currency,
            verifiedAt = now,
            signatureVerified = true,
        )

        val nextStatus = if (requireAdminApproval) {
            OrderLifecycleStatus.WAITING_ADMIN_APPROVAL
        } else {
            OrderLifecycleStatus.APPROVED
        }

        val updated = existing.copy(
            payment = paymentRecord,
            status = nextStatus,
            updatedAt = now,
        )
        orders[orderId] = updated
        return updated
    }

    /**
     * Step 3: Staff / Admin review and decision (§10, Option B).
     */
    fun processAdminApproval(
        orderId: String,
        decision: AdminApprovalDecision,
        adminEmail: String,
        notes: String? = null,
    ): CommercialOrderRecord {
        val existing = orders[orderId] ?: throw IllegalArgumentException("Order $orderId not found")
        require(existing.status == OrderLifecycleStatus.WAITING_ADMIN_APPROVAL) {
            "Admin approval cannot be processed on order in status ${existing.status} (must be WAITING_ADMIN_APPROVAL)"
        }

        val now = java.time.Instant.now().toString()
        val approvalRecord = AdminApprovalRecord(
            approvalId = "APPR-${UUID.randomUUID().toString().take(8).uppercase()}",
            orderId = orderId,
            decision = decision,
            approvedBy = adminEmail,
            decidedAt = now,
            notes = notes,
        )

        val nextStatus = when (decision) {
            AdminApprovalDecision.APPROVED -> OrderLifecycleStatus.APPROVED
            AdminApprovalDecision.REJECTED -> OrderLifecycleStatus.REJECTED
            AdminApprovalDecision.PENDING -> OrderLifecycleStatus.WAITING_ADMIN_APPROVAL
        }

        val updated = existing.copy(
            approval = approvalRecord,
            status = nextStatus,
            updatedAt = now,
        )
        orders[orderId] = updated
        return updated
    }

    /**
     * Step 4: Server issues entitlement revision and serial number after approval.
     */
    fun issueEntitlement(
        orderId: String,
        issuedRevision: Int,
        issuedSerialNumber: String,
    ): CommercialOrderRecord {
        val existing = orders[orderId] ?: throw IllegalArgumentException("Order $orderId not found")
        require(existing.status == OrderLifecycleStatus.APPROVED) {
            "Entitlement can only be issued for APPROVED orders (current: ${existing.status})"
        }

        val now = java.time.Instant.now().toString()
        val updated = existing.copy(
            status = OrderLifecycleStatus.ENTITLEMENT_ISSUED,
            issuedRevision = issuedRevision,
            issuedSerialNumber = issuedSerialNumber,
            updatedAt = now,
        )
        orders[orderId] = updated
        return updated
    }
}
