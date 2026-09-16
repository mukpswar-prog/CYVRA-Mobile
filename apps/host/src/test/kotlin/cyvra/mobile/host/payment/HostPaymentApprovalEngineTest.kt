package cyvra.mobile.host.payment

import cyvra.mobile.core.AdminApprovalDecision
import cyvra.mobile.core.OrderLifecycleStatus
import cyvra.mobile.core.PaymentProviderType
import cyvra.mobile.core.ScanEntitlementPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostPaymentApprovalEngineTest {

    private val engine = HostPaymentApprovalEngine(requireAdminApproval = true)

    @Test
    fun executesFullOrderPaymentApprovalAndEntitlementIssuance() {
        // Step 1: Order created
        val order = engine.createOrder(
            customerEmail = "partner@cyvoriq.com",
            licenseId = "LIC-000001",
            targetPlan = ScanEntitlementPlan.TIER_25,
        )

        assertEquals(OrderLifecycleStatus.PAYMENT_PENDING, order.status)
        assertEquals("LIC-000001", order.licenseId)

        // Step 2: Payment webhook confirmation
        val paymentConfirmedOrder = engine.confirmPayment(
            orderId = order.orderId,
            provider = PaymentProviderType.RAZORPAY,
            providerReference = "pay_live_904128",
            amountMinorUnits = 1250000L,
            signatureVerified = true,
        )

        assertEquals(OrderLifecycleStatus.WAITING_ADMIN_APPROVAL, paymentConfirmedOrder.status)
        assertNotNull(paymentConfirmedOrder.payment)
        assertEquals("pay_live_904128", paymentConfirmedOrder.payment?.providerReference)

        // Step 3: Admin / Staff reviews and approves
        val approvedOrder = engine.processAdminApproval(
            orderId = order.orderId,
            decision = AdminApprovalDecision.APPROVED,
            adminEmail = "ceo@cyvoriq.com",
            notes = "Reconciled with bank settlement batch 2026-09-16",
        )

        assertEquals(OrderLifecycleStatus.APPROVED, approvedOrder.status)
        assertEquals("ceo@cyvoriq.com", approvedOrder.approval?.approvedBy)

        // Step 4: Issue entitlement
        val issuedOrder = engine.issueEntitlement(
            orderId = order.orderId,
            issuedRevision = 2,
            issuedSerialNumber = "CYVRA16092026SA3F1-2-25",
        )

        assertEquals(OrderLifecycleStatus.ENTITLEMENT_ISSUED, issuedOrder.status)
        assertEquals(2, issuedOrder.issuedRevision)
        assertEquals("CYVRA16092026SA3F1-2-25", issuedOrder.issuedSerialNumber)
    }

    @Test
    fun rejectsPaymentConfirmationIfSignatureFails() {
        val order = engine.createOrder(
            customerEmail = "partner@cyvoriq.com",
            licenseId = "LIC-000001",
            targetPlan = ScanEntitlementPlan.TIER_5,
        )

        assertFailsWith<IllegalArgumentException> {
            engine.confirmPayment(
                orderId = order.orderId,
                provider = PaymentProviderType.STRIPE,
                providerReference = "pi_unverified_123",
                amountMinorUnits = 250000L,
                signatureVerified = false,
            )
        }
    }

    @Test
    fun rejectsAdminApprovalIfOrderIsNotInWaitingStatus() {
        val order = engine.createOrder(
            customerEmail = "partner@cyvoriq.com",
            licenseId = "LIC-000001",
            targetPlan = ScanEntitlementPlan.TIER_5,
        )

        // Order is still PAYMENT_PENDING
        assertFailsWith<IllegalArgumentException> {
            engine.processAdminApproval(
                orderId = order.orderId,
                decision = AdminApprovalDecision.APPROVED,
                adminEmail = "ceo@cyvoriq.com",
            )
        }
    }

    @Test
    fun transitionsToRejectedWhenAdminRejectsOrder() {
        val order = engine.createOrder(
            customerEmail = "unknown@external.com",
            licenseId = "LIC-000002",
            targetPlan = ScanEntitlementPlan.TIER_25,
        )

        engine.confirmPayment(
            orderId = order.orderId,
            provider = PaymentProviderType.RAZORPAY,
            providerReference = "pay_suspect_99",
            amountMinorUnits = 1250000L,
            signatureVerified = true,
        )

        val rejected = engine.processAdminApproval(
            orderId = order.orderId,
            decision = AdminApprovalDecision.REJECTED,
            adminEmail = "ceo@cyvoriq.com",
            notes = "Customer failed KYC verification",
        )

        assertEquals(OrderLifecycleStatus.REJECTED, rejected.status)

        // Cannot issue entitlement on REJECTED order
        assertFailsWith<IllegalArgumentException> {
            engine.issueEntitlement(order.orderId, 2, "CYVRA-FAKE-SERIAL")
        }
    }
}
