package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class PaymentApprovalModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesCommercialOrderRecord() {
        val payment = PaymentVerificationRecord(
            paymentId = "PAY-001",
            provider = PaymentProviderType.RAZORPAY,
            providerReference = "pay_Nabc123456",
            amountMinorUnits = 500000L,
            currency = "INR",
            verifiedAt = "2026-09-16T10:00:00Z",
            signatureVerified = true,
        )

        val approval = AdminApprovalRecord(
            approvalId = "APPR-001",
            orderId = "ORD-001",
            decision = AdminApprovalDecision.APPROVED,
            approvedBy = "ceo@cyvoriq.com",
            decidedAt = "2026-09-16T10:05:00Z",
            notes = "Corporate tier approved after payment reconciliation",
        )

        val order = CommercialOrderRecord(
            orderId = "ORD-001",
            customerEmail = "partner@cyvoriq.com",
            licenseId = "LIC-000001",
            targetPlan = ScanEntitlementPlan.TIER_25,
            status = OrderLifecycleStatus.ENTITLEMENT_ISSUED,
            payment = payment,
            approval = approval,
            issuedRevision = 2,
            issuedSerialNumber = "CYVRA16092026SA3F1-2-25",
        )

        val encoded = json.encodeToString(order)
        val decoded = json.decodeFromString<CommercialOrderRecord>(encoded)

        assertEquals("ORD-001", decoded.orderId)
        assertEquals(ScanEntitlementPlan.TIER_25, decoded.targetPlan)
        assertEquals(OrderLifecycleStatus.ENTITLEMENT_ISSUED, decoded.status)
        assertNotNull(decoded.payment)
        assertEquals(PaymentProviderType.RAZORPAY, decoded.payment.provider)
        assertEquals(AdminApprovalDecision.APPROVED, decoded.approval?.decision)
        assertEquals("ceo@cyvoriq.com", decoded.approval?.approvedBy)
        assertEquals(2, decoded.issuedRevision)
        assertTrue(decoded.issuedSerialNumber?.startsWith("CYVRA") == true)
    }
}
