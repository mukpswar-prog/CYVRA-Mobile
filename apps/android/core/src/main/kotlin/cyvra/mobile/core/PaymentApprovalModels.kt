package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Commercial order lifecycle status per Master Workflow §30 (Phase 18).
 * Flow:
 * CREATED -> PAYMENT_PENDING -> PAYMENT_CONFIRMED -> WAITING_ADMIN_APPROVAL -> APPROVED -> ENTITLEMENT_ISSUED
 * Terminal failure states: CANCELLED, REFUNDED, REJECTED
 */
@Serializable
enum class OrderLifecycleStatus {
    CREATED,
    PAYMENT_PENDING,
    PAYMENT_CONFIRMED,
    WAITING_ADMIN_APPROVAL,
    APPROVED,
    ENTITLEMENT_ISSUED,
    CANCELLED,
    REFUNDED,
    REJECTED,
}

/**
 * Staff / Admin Approval lifecycle per Master Workflow §10 & §30.
 */
@Serializable
enum class AdminApprovalDecision {
    PENDING,
    APPROVED,
    REJECTED,
}

/**
 * Payment provider reference / verification status.
 * Desktop app NEVER declares "Payment Successful" on its own authority (§30, §43).
 * Verification is strictly server-authoritative via trusted provider webhooks/signatures.
 */
@Serializable
enum class PaymentProviderType {
    RAZORPAY,
    STRIPE,
    BANK_WIRE_TRANSFER,
    INTERNAL_TEST_GATEWAY,
}

@Serializable
data class PaymentVerificationRecord(
    val paymentId: String,
    val provider: PaymentProviderType,
    val providerReference: String,
    val amountMinorUnits: Long,          // e.g. 500000 for ₹5,000.00
    val currency: String = "INR",
    val verifiedAt: String,
    val signatureVerified: Boolean = true,
)

/**
 * Full Order record representing an entitlement expansion or initial purchase.
 */
@Serializable
data class CommercialOrderRecord(
    val orderId: String,
    val customerEmail: String,
    val licenseId: String,
    val targetPlan: ScanEntitlementPlan,
    val status: OrderLifecycleStatus,
    val payment: PaymentVerificationRecord? = null,
    val approval: AdminApprovalRecord? = null,
    val issuedRevision: Int? = null,
    val issuedSerialNumber: String? = null,
    val createdAt: String = java.time.Instant.now().toString(),
    val updatedAt: String = java.time.Instant.now().toString(),
)

/**
 * Staff approval audit record.
 * Required for Option B (Payment Confirmed -> Admin Approval -> Entitlement Activation).
 */
@Serializable
data class AdminApprovalRecord(
    val approvalId: String,
    val orderId: String,
    val decision: AdminApprovalDecision,
    val approvedBy: String,              // e.g. ceo@cyvoriq.com or nominated staff
    val decidedAt: String = java.time.Instant.now().toString(),
    val notes: String? = null,
)
