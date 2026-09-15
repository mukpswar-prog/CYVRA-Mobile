package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SanitizationWorkflowModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesSanitizationWorkflowSession() {
        val barrier = OperatorPurgeConfirmationBarrier(
            operationId = "PURGE-OP-01",
            step1AcknowledgementChecked = true,
            step2PhraseRequired = "CONFIRM PURGE PURGE-OP-01",
            step2PhraseEntered = "CONFIRM PURGE PURGE-OP-01",
            isBarrierPassed = true,
            authorizedOperatorId = "operator@cyvoriq.com",
            authorizedTimestamp = java.time.Instant.now().toString(),
        )

        val reconnectState = DeviceReconnectionState(
            initialSerial = "PIXEL8-TEST",
            isReconnected = true,
            postResetAdbState = "DEVICE_OOBE",
            setupWizardDetected = true,
            userAccountsRemoved = true,
            screenLockAbsent = true,
        )

        val session = SanitizationWorkflowSession(
            sessionUuid = "SESS-100",
            operationId = "PURGE-OP-01",
            currentStep = SanitizationWorkflowStep.CERTIFICATION_READY,
            deviceIdentifier = "PIXEL8-TEST",
            selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            barrier = barrier,
            reconnectionState = reconnectState,
        )

        val encoded = json.encodeToString(session)
        val decoded = json.decodeFromString<SanitizationWorkflowSession>(encoded)

        assertEquals("PURGE-OP-01", decoded.operationId)
        assertEquals(SanitizationWorkflowStep.CERTIFICATION_READY, decoded.currentStep)
        assertTrue(decoded.barrier.isBarrierPassed)
        assertTrue(decoded.reconnectionState?.setupWizardDetected == true)
    }
}
