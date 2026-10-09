package com.cyvra.sanitization

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Entry point for the wipe proof: turns the [WIPE_ACTION] broadcast into a wipe call.
 *
 * PROOF OF CONCEPT — see README.md. This receiver is exported and unguarded by design;
 * that is what lets an operator drive the proof from `adb shell am broadcast`, and it is
 * also why this APK must never be installed anywhere that matters.
 *
 * Testability: [onReceive] is a thin adapter over [dispatch], which contains the entire
 * decision and carries no Android types in its testable path. That lets the JVM unit test
 * prove "the right action triggers the wipe call, and nothing else does" without a device
 * and without Robolectric.
 */
class SanitizationBroadcastReceiver(
    /**
     * Test seam. When set it replaces the real wipe path, so no unit test can ever
     * reach [SanitizationAdmin.triggerWipe].
     */
    private val onWipe: (() -> Unit)? = null,
) : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        dispatch(intent.action, realWipe = { SanitizationAdmin().triggerWipe(context) })
    }

    /**
     * The whole rule: exactly [WIPE_ACTION] triggers a wipe, and nothing else does.
     *
     * @param realWipe the production wipe path, supplied by [onReceive] so that this
     *   function stays free of Android types under test.
     */
    internal fun dispatch(action: String?, realWipe: (() -> Unit)? = null) {
        if (action != WIPE_ACTION) return
        val injected = onWipe
        if (injected != null) {
            injected()
        } else {
            realWipe?.invoke()
        }
    }

    companion object {
        const val WIPE_ACTION = "com.cyvra.sanitization.WIPE"

        /** Exposed so the manifest and this class cannot drift apart unnoticed. */
        fun isWipeAction(action: String?): Boolean = action == WIPE_ACTION
    }
}
