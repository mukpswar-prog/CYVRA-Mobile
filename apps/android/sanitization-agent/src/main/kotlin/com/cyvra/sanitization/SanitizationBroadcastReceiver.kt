package com.cyvra.sanitization

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Result of evaluating an incoming action in [SanitizationBroadcastReceiver].
 */
enum class DispatchResult {
    ARMED,
    DISARMED,
    WIPED,
    HANDSHAKE_ACK,
    ASSESSED,
    REJECTED_NOT_ARMED,
    REJECTED_TOKEN_MISMATCH,
    REJECTED_TOKEN_WEAK,
    REJECTED_SESSION_MISMATCH,
    REJECTED_OPERATION_MISMATCH,
    REJECTED_SERIAL_MISMATCH,
    REJECTED_FINGERPRINT_MISMATCH,
    REJECTED_TOKEN_EXPIRED,
    IGNORED_UNKNOWN_ACTION,
}

/**
 * Hardened entry point for the CYVRA sanitization protocol.
 *
 * Protected at the Android OS framework level by `android.permission.DUMP` (restricting
 * external broadcast senders strictly to `com.android.shell` / privileged system UIDs)
 * and inside the receiver by the two-step ARM -> WIPE protocol:
 * 1. [ARM_ACTION] requires a high-entropy one-time token (`wipeToken`, >= [MIN_TOKEN_LENGTH] chars)
 *    bound to `sessionUuid`, `targetSerial`, `operationId`, and optional `targetBuildFingerprint`
 *    with a strict 60-second TTL.
 * 2. [WIPE_ACTION] must present the exact matching credentials within the 60-second window and
 *    verifies target device build fingerprint immediately before destructive execution.
 * 3. Execution immediately invalidates the token inside a synchronized block (single-use, race-free).
 * 4. Raw device serials and tokens are never written to Android logcat.
 */
class SanitizationBroadcastReceiver(
    /**
     * Test seam. When set it replaces the real wipe path, so no unit test can ever
     * reach [SanitizationAdmin.triggerWipe].
     */
    private val onWipe: (() -> Unit)? = null,
    /**
     * Device build fingerprint supplier (defaults to [Build.FINGERPRINT] on Android hardware;
     * injectable in JVM unit tests).
     */
    private val deviceBuildFingerprintProvider: () -> String? = { Build.FINGERPRINT },
) : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val token = intent.getStringExtra(EXTRA_WIPE_TOKEN)
        val sessionUuid = intent.getStringExtra(EXTRA_SESSION_UUID)
        val targetSerial = intent.getStringExtra(EXTRA_TARGET_SERIAL)
        val operationId = intent.getStringExtra(EXTRA_OPERATION_ID)
        val targetBuildFingerprint = intent.getStringExtra(EXTRA_TARGET_BUILD_FINGERPRINT)

        dispatch(
            action = action,
            token = token,
            sessionUuid = sessionUuid,
            targetSerial = targetSerial,
            operationId = operationId,
            targetBuildFingerprint = targetBuildFingerprint,
            currentTimeMs = System.currentTimeMillis(),
            realWipe = { SanitizationAdmin().triggerWipe(context) },
            assessmentCollector = { AgentAssessmentCollector(context).collectAssessment(sessionUuid).toString() },
            writeOutput = { filename, content ->
                try {
                    val file = java.io.File("/data/local/tmp", filename)
                    file.writeText(content)
                } catch (_: Throwable) {
                    try {
                        val file = java.io.File(context.cacheDir, filename)
                        file.writeText(content)
                    } catch (_: Throwable) {}
                }
            },
            onResultData = { data ->
                try {
                    setResultData(data)
                } catch (_: Throwable) {}
            },
        )
    }

    /**
     * Dispatches the action with explicit cryptographic token, session, operation, and device binding.
     * All state transitions are synchronized against [stateLock] to prevent race conditions.
     */
    internal fun dispatch(
        action: String?,
        token: String? = null,
        sessionUuid: String? = null,
        targetSerial: String? = null,
        operationId: String? = null,
        targetBuildFingerprint: String? = null,
        currentTimeMs: Long = System.currentTimeMillis(),
        realWipe: (() -> Unit)? = null,
        assessmentCollector: (() -> String)? = null,
        writeOutput: ((String, String) -> Unit)? = null,
        onResultData: ((String) -> Unit)? = null,
    ): DispatchResult {
        when (action) {
            HANDSHAKE_ACTION -> {
                val payload = """{"status":"READY","agentVersion":"2.1.1","agentPackage":"com.cyvra.sanitization","sessionUuid":"${sessionUuid ?: "UNBOUND"}","timestampMs":$currentTimeMs}"""
                writeOutput?.invoke("cyvra-agent-handshake.json", payload)
                onResultData?.invoke(payload)
                Log.i(TAG, "HANDSHAKE acknowledged for session=${sessionUuid ?: "unbound"}")
                return DispatchResult.HANDSHAKE_ACK
            }

            ASSESS_ACTION -> {
                val payload = assessmentCollector?.invoke() ?: "{}"
                writeOutput?.invoke("cyvra-agent-assessment.json", payload)
                onResultData?.invoke(payload)
                Log.i(TAG, "ASSESSMENT generated for session=${sessionUuid ?: "unbound"}")
                return DispatchResult.ASSESSED
            }

            ARM_ACTION -> {
                if (token.isNullOrBlank()) {
                    Log.w(TAG, "ARM rejected: wipeToken missing or blank")
                    return DispatchResult.REJECTED_TOKEN_MISMATCH
                }
                if (token.trim().length < MIN_TOKEN_LENGTH) {
                    Log.w(TAG, "ARM rejected: wipeToken below minimum cryptographic length")
                    return DispatchResult.REJECTED_TOKEN_WEAK
                }
                if (!targetBuildFingerprint.isNullOrBlank()) {
                    val actualFp = deviceBuildFingerprintProvider()?.trim().orEmpty()
                    if (actualFp.isNotEmpty() && actualFp != targetBuildFingerprint.trim()) {
                        Log.w(TAG, "ARM rejected: target hardware build fingerprint mismatch")
                        return DispatchResult.REJECTED_FINGERPRINT_MISMATCH
                    }
                }
                synchronized(stateLock) {
                    activeSession = ArmedSession(
                        token = token,
                        sessionUuid = sessionUuid,
                        targetSerial = targetSerial,
                        operationId = operationId,
                        targetBuildFingerprint = targetBuildFingerprint,
                        armedAtMs = currentTimeMs,
                    )
                }
                Log.i(TAG, "Agent armed for session=${sessionUuid ?: "unspecified"}, op=${operationId ?: "unspecified"} (60s TTL)")
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

                    // Validate Session UUID Binding
                    if (!current.sessionUuid.isNullOrBlank() && sessionUuid != current.sessionUuid) {
                        Log.w(TAG, "WIPE rejected: session UUID mismatch")
                        disarm()
                        return DispatchResult.REJECTED_SESSION_MISMATCH
                    }

                    // Validate Operation ID Binding
                    if (!current.operationId.isNullOrBlank() && operationId != current.operationId) {
                        Log.w(TAG, "WIPE rejected: operation ID mismatch")
                        disarm()
                        return DispatchResult.REJECTED_OPERATION_MISMATCH
                    }

                    // Validate Target Serial Binding (never log raw serials)
                    if (!current.targetSerial.isNullOrBlank() && targetSerial != current.targetSerial) {
                        Log.w(TAG, "WIPE rejected: target device identity mismatch")
                        disarm()
                        return DispatchResult.REJECTED_SERIAL_MISMATCH
                    }

                    // Enforce target-device hardware build fingerprint check immediately before wipe
                    val expectedFp = current.targetBuildFingerprint?.takeIf { it.isNotBlank() }
                        ?: targetBuildFingerprint?.takeIf { it.isNotBlank() }
                    if (expectedFp != null) {
                        if (!targetBuildFingerprint.isNullOrBlank() && targetBuildFingerprint != expectedFp) {
                            Log.w(TAG, "WIPE rejected: wipe broadcast fingerprint differs from armed target")
                            disarm()
                            return DispatchResult.REJECTED_FINGERPRINT_MISMATCH
                        }
                        val actualFp = deviceBuildFingerprintProvider()?.trim().orEmpty()
                        if (actualFp.isNotEmpty() && actualFp != expectedFp.trim()) {
                            Log.w(TAG, "WIPE rejected: live device build fingerprint does not match target")
                            disarm()
                            return DispatchResult.REJECTED_FINGERPRINT_MISMATCH
                        }
                    }

                    // Single-use: Consume authorization immediately to prevent replay or race conditions
                    disarm()
                    Log.w(TAG, "WIPE authorized for session=${current.sessionUuid ?: "unspecified"}: triggering wipeData(0)")

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
        val targetBuildFingerprint: String?,
        val armedAtMs: Long,
    )

    companion object {
        const val HANDSHAKE_ACTION = "com.cyvra.sanitization.HANDSHAKE"
        const val ASSESS_ACTION = "com.cyvra.sanitization.ASSESS"
        const val ARM_ACTION = "com.cyvra.sanitization.ARM"
        const val WIPE_ACTION = "com.cyvra.sanitization.WIPE"
        const val DISARM_ACTION = "com.cyvra.sanitization.DISARM"

        const val EXTRA_WIPE_TOKEN = "wipeToken"
        const val EXTRA_SESSION_UUID = "sessionUuid"
        const val EXTRA_TARGET_SERIAL = "targetSerial"
        const val EXTRA_OPERATION_ID = "operationId"
        const val EXTRA_TARGET_BUILD_FINGERPRINT = "targetBuildFingerprint"

        const val MIN_TOKEN_LENGTH = 32
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

        fun isHandshakeAction(action: String?): Boolean = action == HANDSHAKE_ACTION
        fun isAssessAction(action: String?): Boolean = action == ASSESS_ACTION
        fun isWipeAction(action: String?): Boolean = action == WIPE_ACTION
        fun isArmAction(action: String?): Boolean = action == ARM_ACTION
        fun isDisarmAction(action: String?): Boolean = action == DISARM_ACTION
    }
}
