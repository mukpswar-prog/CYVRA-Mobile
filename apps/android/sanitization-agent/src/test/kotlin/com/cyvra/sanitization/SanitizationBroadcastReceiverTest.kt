package com.cyvra.sanitization

import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit test suite for [SanitizationBroadcastReceiver] on the JVM.
 * Proves the two-step ARM -> WIPE protocol, 256-bit token entropy requirement,
 * session/operation/serial/fingerprint binding, replay protection, and fail-closed
 * security rules without requiring a real device or Robolectric.
 */
class SanitizationBroadcastReceiverTest {

    private val validTokenA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
    private val validTokenB = "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f"
    private val syntheticSerial = "TEST_DEVICE_SERIAL_0001"
    private val syntheticFingerprint = "vendor/testdevice/test:14/UP1A.231005.007/1001:user/release-keys"

    @BeforeTest
    fun setUp() {
        SanitizationBroadcastReceiver.disarm()
    }

    @Test
    fun armWithValidHighEntropyTokenTransitionsToArmedState() {
        val receiver = SanitizationBroadcastReceiver()
        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            currentTimeMs = 1000L,
        )

        assertEquals(DispatchResult.ARMED, result)
        assertTrue(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))
    }

    @Test
    fun armWithBlankOrLowEntropyTokenFailsClosed() {
        val receiver = SanitizationBroadcastReceiver()
        val blankResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "",
            currentTimeMs = 1000L,
        )
        assertEquals(DispatchResult.REJECTED_TOKEN_MISMATCH, blankResult)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))

        val shortResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = "short-token-1234",
            currentTimeMs = 1000L,
        )
        assertEquals(DispatchResult.REJECTED_TOKEN_WEAK, shortResult)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 1000L))
    }

    @Test
    fun twoStepArmAndWipeWithMatchingTokenExecutesWipe() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })

        val armResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            currentTimeMs = 10_000L,
        )
        assertEquals(DispatchResult.ARMED, armResult)

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
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
            token = validTokenA,
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenB,
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

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            currentTimeMs = 10_000L,
        )

        // TTL is 60,000ms. At 70,001ms it has elapsed 60,001ms
        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
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

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            currentTimeMs = 1000L,
        )
        val firstWipe = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
            currentTimeMs = 2000L,
        )
        assertEquals(DispatchResult.WIPED, firstWipe)
        assertEquals(1, wipeCalls)

        val secondWipe = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
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
            token = validTokenA,
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
    fun armAndWipeWithFullDeviceFingerprintAndSessionBindingSucceeds() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(
            onWipe = { wipeCalls++ },
            deviceBuildFingerprintProvider = { syntheticFingerprint },
        )
        val sessionUuid = "session-uuid-777"
        val operationId = "op-999"

        val armResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            sessionUuid = sessionUuid,
            targetSerial = syntheticSerial,
            operationId = operationId,
            targetBuildFingerprint = syntheticFingerprint,
            currentTimeMs = 10_000L,
        )
        assertEquals(DispatchResult.ARMED, armResult)

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
            sessionUuid = sessionUuid,
            targetSerial = syntheticSerial,
            operationId = operationId,
            targetBuildFingerprint = syntheticFingerprint,
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.WIPED, wipeResult)
        assertEquals(1, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))
    }

    @Test
    fun wipeWithSessionOrOperationMismatchFailsClosedAndDisarms() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(onWipe = { wipeCalls++ })

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = syntheticSerial,
            operationId = "expected-op-id",
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
            sessionUuid = "tampered-session-uuid",
            targetSerial = syntheticSerial,
            operationId = "expected-op-id",
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.REJECTED_SESSION_MISMATCH, wipeResult)
        assertEquals(0, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = syntheticSerial,
            operationId = "expected-op-id",
            currentTimeMs = 20_000L,
        )
        val opMismatchResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = syntheticSerial,
            operationId = "tampered-op-id",
            currentTimeMs = 25_000L,
        )
        assertEquals(DispatchResult.REJECTED_OPERATION_MISMATCH, opMismatchResult)
        assertEquals(0, wipeCalls)
    }

    @Test
    fun wipeWithSerialOrBuildFingerprintMismatchFailsClosedAndDisarms() {
        var wipeCalls = 0
        val receiver = SanitizationBroadcastReceiver(
            onWipe = { wipeCalls++ },
            deviceBuildFingerprintProvider = { syntheticFingerprint },
        )

        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = syntheticSerial,
            currentTimeMs = 10_000L,
        )

        val wipeResult = receiver.dispatch(
            action = SanitizationBroadcastReceiver.WIPE_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = "WRONG_DEVICE_SERIAL",
            currentTimeMs = 15_000L,
        )
        assertEquals(DispatchResult.REJECTED_SERIAL_MISMATCH, wipeResult)
        assertEquals(0, wipeCalls)
        assertFalse(SanitizationBroadcastReceiver.isArmed(currentTimeMs = 15_000L))

        val wrongDeviceArm = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
            sessionUuid = "expected-session-uuid",
            targetSerial = syntheticSerial,
            targetBuildFingerprint = "othervendor/wrongphone/wrong:14/BUILD/1:user/release-keys",
            currentTimeMs = 20_000L,
        )
        assertEquals(DispatchResult.REJECTED_FINGERPRINT_MISMATCH, wrongDeviceArm)
        assertEquals(0, wipeCalls)
    }

    @Test
    fun explicitDisarmActionClearsArmedState() {
        val receiver = SanitizationBroadcastReceiver()
        receiver.dispatch(
            action = SanitizationBroadcastReceiver.ARM_ACTION,
            token = validTokenA,
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
        assertEquals("com.cyvra.sanitization.HANDSHAKE", SanitizationBroadcastReceiver.HANDSHAKE_ACTION)
        assertEquals("com.cyvra.sanitization.ASSESS", SanitizationBroadcastReceiver.ASSESS_ACTION)
        assertEquals("com.cyvra.sanitization.ARM", SanitizationBroadcastReceiver.ARM_ACTION)
        assertEquals("com.cyvra.sanitization.WIPE", SanitizationBroadcastReceiver.WIPE_ACTION)
        assertEquals("com.cyvra.sanitization.DISARM", SanitizationBroadcastReceiver.DISARM_ACTION)
        assertTrue(SanitizationBroadcastReceiver.isHandshakeAction(SanitizationBroadcastReceiver.HANDSHAKE_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isAssessAction(SanitizationBroadcastReceiver.ASSESS_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isWipeAction(SanitizationBroadcastReceiver.WIPE_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isArmAction(SanitizationBroadcastReceiver.ARM_ACTION))
        assertTrue(SanitizationBroadcastReceiver.isDisarmAction(SanitizationBroadcastReceiver.DISARM_ACTION))
        assertFalse(SanitizationBroadcastReceiver.isHandshakeAction(null))
        assertFalse(SanitizationBroadcastReceiver.isAssessAction(null))
        assertFalse(SanitizationBroadcastReceiver.isWipeAction(null))
        assertFalse(SanitizationBroadcastReceiver.isArmAction(null))
        assertFalse(SanitizationBroadcastReceiver.isDisarmAction(null))
    }

    @Test
    fun handshakeActionReturnsReadyWithAgentVersion() {
        val receiver = SanitizationBroadcastReceiver()
        var writtenFile: String? = null
        var writtenData: String? = null
        var resultData: String? = null

        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.HANDSHAKE_ACTION,
            sessionUuid = "test-session-1234",
            currentTimeMs = 5000L,
            writeOutput = { file, data ->
                writtenFile = file
                writtenData = data
            },
            onResultData = { data ->
                resultData = data
            }
        )

        assertEquals(DispatchResult.HANDSHAKE_ACK, result)
        assertEquals("cyvra-agent-handshake.json", writtenFile)
        assertTrue(writtenData.orEmpty().contains("\"status\":\"READY\""))
        assertTrue(writtenData.orEmpty().contains("\"agentVersion\":\"2.1.1\""))
        assertTrue(writtenData.orEmpty().contains("\"sessionUuid\":\"test-session-1234\""))
        assertEquals(writtenData, resultData)
    }

    @Test
    fun assessActionReturnsStructuredAssessmentJson() {
        val receiver = SanitizationBroadcastReceiver()
        var writtenFile: String? = null
        var writtenData: String? = null
        var resultData: String? = null

        val mockJson = "{\"schemaVersion\":\"cyvra.agent.assessment.v2\",\"agentVersion\":\"2.1.1\",\"methodQualification\":{\"recommendedMethod\":\"CLEAR_DEVICE_OWNER_WIPE\"}}"

        val result = receiver.dispatch(
            action = SanitizationBroadcastReceiver.ASSESS_ACTION,
            sessionUuid = "test-session-5678",
            currentTimeMs = 6000L,
            assessmentCollector = { mockJson },
            writeOutput = { file, data ->
                writtenFile = file
                writtenData = data
            },
            onResultData = { data ->
                resultData = data
            }
        )

        assertEquals(DispatchResult.ASSESSED, result)
        assertEquals("cyvra-agent-assessment.json", writtenFile)
        assertEquals(mockJson, writtenData)
        assertEquals(mockJson, resultData)
    }
}
