package com.cyvra.sanitization

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Proves the receiver's rule on the JVM: the commissioned action reaches the wipe call
 * exactly once, and nothing else reaches it at all.
 *
 * The real wipe path is never exercised here — the injected seam replaces it — so no
 * test in this suite can touch a [android.app.admin.DevicePolicyManager].
 */
class SanitizationBroadcastReceiverTest {

    @Test
    fun theCommissionedActionTriggersTheWipeCall() {
        var calls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { calls++ })

        receiver.dispatch(SanitizationBroadcastReceiver.WIPE_ACTION)

        assertEquals(1, calls, "the commissioned action must reach the wipe call exactly once")
    }

    @Test
    fun anyOtherActionTriggersNothing() {
        var calls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { calls++ })

        receiver.dispatch("android.intent.action.BOOT_COMPLETED")
        receiver.dispatch("android.intent.action.ACTION_SHUTDOWN")
        receiver.dispatch("com.cyvra.sanitization.WIPE_EXTRA")
        receiver.dispatch("com.cyvra.sanitization.wipe")
        receiver.dispatch("")
        receiver.dispatch(null)

        assertEquals(0, calls, "only the exact action may wipe — no prefix, no case folding")
    }

    @Test
    fun theActionConstantMatchesWhatTheManifestFiltersOn() {
        assertEquals("com.cyvra.sanitization.WIPE", SanitizationBroadcastReceiver.WIPE_ACTION)
        assertEquals(true, SanitizationBroadcastReceiver.isWipeAction(SanitizationBroadcastReceiver.WIPE_ACTION))
        assertEquals(false, SanitizationBroadcastReceiver.isWipeAction("com.cyvra.sanitization.WIPE2"))
        assertEquals(false, SanitizationBroadcastReceiver.isWipeAction(null))
    }

    @Test
    fun theInjectedSeamReplacesRatherThanAddsToTheRealWipePath() {
        var injected = 0
        var real = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { injected++ })

        receiver.dispatch(SanitizationBroadcastReceiver.WIPE_ACTION, realWipe = { real++ })

        assertEquals(1, injected)
        assertEquals(0, real, "a unit test must never reach the real wipe path")
    }

    @Test
    fun dispatchIsSafeWhenNoWipePathIsAvailable() {
        // No injected seam and no real path: the rule still resolves without throwing.
        SanitizationBroadcastReceiver()
            .dispatch(SanitizationBroadcastReceiver.WIPE_ACTION)
    }
}
