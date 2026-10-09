package com.cyvra.sanitization

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device-admin component for the wipe proof.
 *
 * PROOF OF CONCEPT. This class exists so that the operator can run
 * `dpm set-device-owner` against a test device and then prove that a purge is
 * verifiable end to end. It is not a sanitization implementation and must not be
 * confused with one: it performs a factory reset, which governed §29 treats as one
 * sanitization *method* whose verification contract is not yet ratified.
 *
 * Adheres to:
 * - Governed `CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2` §2 (P4 consent gate: install +
 *   device-owner enrolment)
 * - `CYVRA_CAPABILITY_MATRIX_V1.md` §4 row 22 (Sanitization, PUR-DO-WIPE,
 *   `CONDITIONAL`) and §6 (non-interactive reset is RESTRICTED)
 *
 * Side-effect policy: [onEnabled] and [onDisabled] **log only**. Enrolment is a
 * human-in-the-loop step performed over adb; the agent must never react to becoming
 * device owner beyond recording that it happened. Nothing here is triggered by a
 * lifecycle callback.
 */
class SanitizationAdmin : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "device owner enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "device owner disabled")
    }

    /**
     * Erases every user on this device, including internal storage.
     *
     * The flags argument is `0` deliberately: `WIPE_EXTERNAL_STORAGE` is not set and
     * `WIPE_RESET_PROTECTION_DATA` is not set, so this is a factory reset and nothing
     * more — it does not touch removable media and does not alter bootloader state.
     *
     * There is no confirmation step and no undo. This returns before the wipe completes;
     * the device is already committed the moment the call is made.
     */
    fun triggerWipe(context: Context) {
        Log.w(TAG, "wipe requested - no confirmation, no undo")
        val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        manager.wipeData(0)
    }

    companion object {
        private const val TAG = "CyvraSanitization"

        /** The admin component, needed by `dpm set-device-owner`. */
        fun component(context: Context) =
            android.content.ComponentName(context, SanitizationAdmin::class.java)
    }
}
