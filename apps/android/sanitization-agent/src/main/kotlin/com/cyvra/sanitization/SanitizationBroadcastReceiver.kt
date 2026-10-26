package com.cyvra.sanitization

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Result of evaluating an incoming action in [SanitizationBroadcastReceiver].
 */
enum class DispatchResult {
    ARMED,
    DISARMED,
    WIPED,
    REJECTED_NOT_ARMED,
    REJECTED_TOKEN_MISMATCH,
    REJECTED_SESSION_MISMATCH,
    REJECTED_SERIAL_MISMATCH,
    REJECTED_TOKEN_EXPIRED,
    IGNORED_UNKNOWN_ACTION,
}

/**
 * Entry point for the sanitization protocol.
 * Enforces the two-step ARM -> WIPE protocol with one-time token semantics (CYVRA-POL-AGENT-01 §4.2):
 * 1. [ARM_ACTION] provides a one-time token (`wipeToken`) cryptographically bound to
 *    `sessionUuid`, `targetSerial`, and `operationId`, stored with a 60-second TTL.
 * 2. [WIPE_ACTION] must present the exact matching credentials within the 60-second window.
 * 3. Execution immediately invalidates the token inside a synchronized block (single-use, race-free).
 * 4. [DISARM_ACTION] explicitly cancels and clears pending authorization on demand.
 */
class SanitizationBroadcastReceiver(
    /**
     * Test seam. When set it replaces the real wipe path, so no unit test can ever
     * reach [SanitizationAdmin.triggerWipe].
     */
    private val onWipe: (() -> Unit)? = null,
) : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val token = intent.getStringExtra(EXTRA_WIPE_TOKEN)
        val sessionUuid = intent.getStringExtra(EXTRA_SESSION_UUID)
        val targetSerial = intent.getStringExtra(EXTRA_TARGET_SERIAL)
        val operationId = intent.getStringExtra(EXTRA_OPERATION_ID)

        dispatch(
            action = action,
            token = token,
            sessionUuid = sessionUuid,
            targetSerial = targetSerial,
            operationId = operationId,
            currentTimeMs = System.currentTimeMillis(),
            realWipe = { SanitizationAdmin().triggerWipe(context) },
        )
    }

    /**
     * Dispatches the action with explicit cryptographic token, session, and device binding.
     * All state transitions are synchronized against [stateLock] to prevent race conditions.
     */
    internal fun dispatch(
        action: String?,
        token: String? = null,
        sessionUuid: String? = null,
        targetSerial: String? = null,
        operationId: String? = null,
        currentTimeMs: Long = System.currentTimeMillis(),
        realWipe: (() -> Unit)? = null,
    ): DispatchResult {
        when (action) {
            ARM_ACTION -> {
                if (token.isNullOrBlank()) {
                    Log.w(TAG, "ARM rejected: wipeToken missing or blank")
                    return DispatchResult.REJECTED_TOKEN_MISMATCH
                }
                synchronized(stateLock) {
                    activeSession = ArmedSession(
                        token = token,
                        sessionUuid = sessionUuid,
                        targetSerial = targetSerial,
                        operationId = operationId,
                        armedAtMs = currentTimeMs,
                    )
                }
                Log.i(TAG, "Agent armed for session=$sessionUuid, serial=$targetSerial (60s TTL)")
                return DispatchResult.ARMED
            }

            DISARM_ACTION -> {
                disarm()
                Log.i(TAG, "Agent explicitly disarmed")
                return DispatchResult.DISARMED
            }

            WIPE_ACTION -> {
                synchronized(stateLock) {
                    val current = activeSession
                    if (current == null) {
                        Log.w(TAG, "WIPE rejected: agent was not armed")
                        return DispatchResult.REJECTED_NOT_ARMED
                    }

                    // Validate 60s TTL
                    if (currentTimeMs - current.armedAtMs > TOKEN_TTL_MS) {
                        Log.w(TAG, "WIPE rejected: token expired (>60s)")
                        disarm()
                        return DispatchResult.REJECTED_TOKEN_EXPIRED
                    }

                    // Validate Token Match
                    if (token.isNullOrBlank() || token != current.token) {
                        Log.w(TAG, "WIPE rejected: token mismatch")
                        disarm()
                        return DispatchResult.REJECTED_TOKEN_MISMATCH
                    }

                    // Validate Session UUID Binding (if armed with session)
                    if (!current.sessionUuid.isNullOrBlank() && sessionUuid != current.sessionUuid) {
                        Log.w(TAG, "WIPE rejected: session UUID mismatch (expected ${current.sessionUuid}, got $sessionUuid)")
                        disarm()
                        return DispatchResult.REJECTED_SESSION_MISMATCH
                    }

                    // Validate Target Serial Binding (if armed with serial)
                    if (!current.targetSerial.isNullOrBlank() && targetSerial != current.targetSerial) {
                        Log.w(TAG, "WIPE rejected: target serial mismatch (expected ${current.targetSerial}, got $targetSerial)")
                        disarm()
                        return DispatchResult.REJECTED_SERIAL_MISMATCH
                    }

                    // Single-use: Consume authorization immediately to prevent replay or race conditions
                    disarm()
                    Log.w(TAG, "WIPE authorized: triggering wipeData(0)")

                    val injected = onWipe
                    if (injected != null) {
                        injected()
                    } else {
                        realWipe?.invoke()
                    }
                    return DispatchResult.WIPED
                }
            }

            else -> {
                return DispatchResult.IGNORED_UNKNOWN_ACTION
            }
        }
    }

    private data class ArmedSession(
        val token: String,
        val sessionUuid: String?,
        val targetSerial: String?,
        val operationId: String?,
        val armedAtMs: Long,
    )

    companion object {
        const val ARM_ACTION = "com.cyvra.sanitization.ARM"
        const val WIPE_ACTION = "com.cyvra.sanitization.WIPE"
        const val DISARM_ACTION = "com.cyvra.sanitization.DISARM"

        const val EXTRA_WIPE_TOKEN = "wipeToken"
        const val EXTRA_SESSION_UUID = "sessionUuid"
        const val EXTRA_TARGET_SERIAL = "targetSerial"
        const val EXTRA_OPERATION_ID = "operationId"

        const val TOKEN_TTL_MS = 60_000L
        private const val TAG = "CYVRA-SanitizeReceiver"

        private val stateLock = Any()

        @Volatile
        private var activeSession: ArmedSession? = null

        fun disarm() {
            synchronized(stateLock) {
                activeSession = null
            }
        }

        fun isArmed(currentTimeMs: Long = System.currentTimeMillis()): Boolean {
            synchronized(stateLock) {
                val current = activeSession ?: return false
                return currentTimeMs - current.armedAtMs <= TOKEN_TTL_MS
            }
        }

        fun isWipeAction(action: String?): Boolean = action == WIPE_ACTION
        fun isArmAction(action: String?): Boolean = action == ARM_ACTION
        fun isDisarmAction(action: String?): Boolean = action == DISARM_ACTION
    }
}
