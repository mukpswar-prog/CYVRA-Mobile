package com.cyvra.sanitization

import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit test suite for [SanitizationBroadcastReceiver] on the JVM.
 * Proves the two-step ARM -> WIPE protocol, one-time token semantics, replay protection,
 * and fail-closed security rules without requiring a real device or Robolectric.
 */
class SanitizationBroadcastReceiverTest {

    @BeforeTest
    fun setUp() {
        SanitizationBroadcastReceiver.disarm()
    }

    @Test
    fun armWithValidTokenTransitionsToArmedState() {
        val receiver = SanitizationBroadcastReceiver()
        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "token-uuid-1234",
            currentTimeMs = 1000L,
        )

        assertEquals(DispatchResult.ARMED, result)
        assertTrue(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))
    }

    @Test
    fun armWithBlankTokenFailsClosed() {
        val receiver = SanitizationBroadcastReceiver()
        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "",
            currentTimeMs = 1000L,
        )

        assertEquals(DispatchResult.REJECTED_TOKEN_MISMATCH, result)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))
    }

    @Test
    fun twoStepArmAndWipeWithMatchingTokenExecutesWipe() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "secure-one-time-token-999"

        val armResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            currentTimeMs = 10_000L,
        )
        assertEquals(DispatchResult.ARMED, armResult)

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.WIPED, wipeResult)
        assertEquals(1, wipeCalls, "Wipe must execute exactly once upon valid token presentation")
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L), "Token must be consumed")
    }

    @Test
    fun wipeWithMismatchedTokenFailsClosedAndDisarms() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "token-original",
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = "token-attacker-tampered",
            currentTimeMs = 15_000L,
        )

        assertEquals(DispatchResult.REJECTED_TOKEN_MISMATCH, wipeResult)
        assertEquals(0, wipeCalls, "Mismatched token must never trigger wipe")
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L), "Agent must disarm on tampering")
    }

    @Test
    fun wipeWithExpiredTokenFailsClosed() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "token-will-expire"

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            currentTimeMs = 10_000L,
        )

        // TTL is 60,000ms. At 70,001ms it has elapsed 60,001ms
        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            currentTimeMs = 70_001L,
        )

        assertEquals(DispatchResult.REJECTED_TOKEN_EXPIRED, wipeResult)
        assertEquals(0, wipeCalls, "Expired token must never trigger wipe")
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 70_001L), "Agent must disarm upon expiration")
    }

    @Test
    fun replayAttackIsBlockedBecauseTokenIsConsumedOnFirstUse() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "single-use-token-abc"

        // First execution succeeds
        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            currentTimeMs = 1000L,
        )
        val firstWipe = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            currentTimeMs = 2000L,
        )
        assertEquals(DispatchResult.WIPED, firstWipe)
        assertEquals(1, wipeCalls)

        // Second execution with replayed token must fail
        val secondWipe = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            currentTimeMs = 3000L,
        )
        assertEquals(DispatchResult.REJECTED_NOT_ARMED, secondWipe)
        assertEquals(1, wipeCalls, "Replay must not trigger second wipe")
    }

    @Test
    fun wipeTokenProvidedWhenNeverArmedFailsClosed() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })

        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = "unarmed-token",
            currentTimeMs = 1000L,
        )

        assertEquals(DispatchResult.REJECTED_NOT_ARMED, result)
        assertEquals(0, wipeCalls)
    }

    @Test
    fun anyOtherActionTriggersNothing() {
        var calls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { calls++ })

        assertEquals(DispatchResult.IGNORED_UNKNOWN_ACTION, receiver.dispatch("android.intent.action.BOOT_COMPLETED"))
        assertEquals(DispatchResult.IGNORED_UNKNOWN_ACTION, receiver.dispatch("android.intent.action.ACTION_SHUTDOWN"))
        assertEquals(DispatchResult.IGNORED_UNKNOWN_ACTION, receiver.dispatch("com.cyvra.sanitization.WIPE_EXTRA"))
        assertEquals(DispatchResult.IGNORED_UNKNOWN_ACTION, receiver.dispatch(""))
        assertEquals(DispatchResult.IGNORED_UNKNOWN_ACTION, receiver.dispatch(null))

        assertEquals(0, calls, "Only commissioned action may trigger wipe")
    }

    @Test
    fun armAndWipeWithDeviceAndSessionBindingSucceeds() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "secure-bound-token-456"
        val sessionUuid = "session-uuid-777"
        val targetSerial = "R9BN3015NQJ"
        val operationId = "op-999"

        val armResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            sessionUuid = sessionUuid,
            targetSerial = targetSerial,
            operationId = operationId,
            currentTimeMs = 10_000L,
        )
        assertEquals(DispatchResult.ARMED, armResult)

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            sessionUuid = sessionUuid,
            targetSerial = targetSerial,
            operationId = operationId,
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.WIPED, wipeResult)
        assertEquals(1, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))
    }

    @Test
    fun wipeWithSessionMismatchFailsClosedAndDisarms() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "secure-bound-token-456"

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            sessionUuid = "expected-session-uuid",
            targetSerial = "R9BN3015NQJ",
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            sessionUuid = "tampered-session-uuid",
            targetSerial = "R9BN3015NQJ",
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.REJECTED_SESSION_MISMATCH, wipeResult)
        assertEquals(0, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))
    }

    @Test
    fun wipeWithSerialMismatchFailsClosedAndDisarms() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })
        val token = "secure-bound-token-456"

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = token,
            sessionUuid = "expected-session-uuid",
            targetSerial = "R9BN3015NQJ",
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = token,
            sessionUuid = "expected-session-uuid",
            targetSerial = "WRONG_DEVICE_SERIAL",
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.REJECTED_SERIAL_MISMATCH, wipeResult)
        assertEquals(0, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))
    }

    @Test
    fun explicitDisarmActionClearsArmedState() {
        val receiver = SanitizationBroadcastReceiver()
        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "token-to-disarm",
            currentTimeMs = 1000L,
        )
        assertTrue(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))

        val disarmResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.DISARM_ACTION,
            currentTimeMs = 2000L,
        )
        assertEquals(DispatchResult.DISARMED, disarmResult)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 2000L))
    }

    @Test
    fun actionConstantsMatchManifestIntentFilter() {
        assertEquals("com.cyvra.sanitization.ARM", SanitizationBroadcastReceiver.ARM_ACTION)
        assertEquals("com.cyvra.sanitization.WIPE", SanitizationBroadcastReceiver.WIPE_ACTION)
        assertEquals("com.cyvra.sanitization.DISARM", SanitizationBroadcastReceiver.DISARM_ACTION)
        assertTrue(SanitizationBroadcastReceiver.isWipeAction(SanitizationBroadcastReceiver.WIPE_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isArmAction(SanitizationBroadcastReceiver.ARM_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isDisarmAction(SanitizationBroadcastReceiver.DISARM_ACTION))
        assertFalse(SanitizationBroadcastReceiver.isWipeAction(null))
        assertFalse(SanitizationBroadcastReceiver.isArmAction(null))
        assertFalse(SanitizationBroadcastReceiver.isDisarmAction(null))
    }
}
