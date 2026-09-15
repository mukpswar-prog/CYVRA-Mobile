package cyvra.mobile.host.sanitization

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.DeviceIdentityEvidence
import cyvra.mobile.core.DeviceReconnectionState
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.OperatorPurgeConfirmationBarrier
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.SanitizationVerificationStatus
import cyvra.mobile.core.SanitizationWorkflowSession
import cyvra.mobile.core.SanitizationWorkflowStep
import cyvra.mobile.core.VerificationResult
import java.util.UUID

/**
 * Host-side engine driving the Phase 14 Data Purge & Verification Lifecycle:
 * Pre-scan -> Capability -> 2-Step Authorization -> Method Selection -> Execution -> Reboot -> Reconnect -> Verification
 *
 * Adheres to:
 * - Master Workflow §23 & §40 (Phase 14)
 * - NIST SP 800-88 Rev. 2 guidelines
 * - Safety Invariant: Destructive triggers cannot fire without satisfying 2-step confirmation barrier.
 */
class HostSanitizationWorkflowEngine(
    private val sanitizationProvider: HostSanitizationProvider,
    private val verificationProvider: HostVerificationProvider,
) {

    /**
     * Initializes a new sanitization workflow session bound to pre-scan evidence.
     */
    fun initializeSession(
        sessionUuid: String,
        deviceIdentifier: String,
        capabilityAssessment: DeviceCapabilityAssessment,
    ): SanitizationWorkflowSession {
        val opId = "PURGE-OP-${UUID.randomUUID().toString().take(8).uppercase()}"
        val recommendedMethod = sanitizationProvider.assessCapability(capabilityAssessment)

        return SanitizationWorkflowSession(
            sessionUuid = sessionUuid,
            operationId = opId,
            currentStep = SanitizationWorkflowStep.AUTHORIZATION_REQUIRED,
            deviceIdentifier = deviceIdentifier,
            selectedMethod = recommendedMethod,
            barrier = OperatorPurgeConfirmationBarrier(
                operationId = opId,
                step1AcknowledgementChecked = false,
                step2PhraseRequired = "CONFIRM PURGE $opId",
            ),
        )
    }

    /**
     * Updates Step 1 acknowledgement check.
     */
    fun toggleStep1Acknowledgement(
        session: SanitizationWorkflowSession,
        acknowledged: Boolean,
    ): SanitizationWorkflowSession {
        val updatedBarrier = session.barrier.copy(step1AcknowledgementChecked = acknowledged)
        return session.copy(barrier = updatedBarrier)
    }

    /**
     * Submits Step 2 confirmation phrase and validates the operator barrier.
     */
    fun submitStep2Confirmation(
        session: SanitizationWorkflowSession,
        phrase: String,
        operatorId: String,
    ): SanitizationWorkflowSession {
        val required = session.barrier.step2PhraseRequired
        val matches = phrase.trim() == required.trim()
        val barrierPassed = session.barrier.step1AcknowledgementChecked && matches

        val updatedBarrier = session.barrier.copy(
            step2PhraseEntered = phrase,
            isBarrierPassed = barrierPassed,
            authorizedOperatorId = if (barrierPassed) operatorId else null,
            authorizedTimestamp = if (barrierPassed) java.time.Instant.now().toString() else null,
        )

        return session.copy(
            barrier = updatedBarrier,
            currentStep = if (barrierPassed) SanitizationWorkflowStep.CONFIRMATION_PASSED else session.currentStep,
            failureReason = if (!matches) "Confirmation phrase mismatch" else null,
        )
    }

    /**
     * Selects sanitization method (Platform Factory Reset vs OEM Secure Erase).
     */
    fun selectMethod(
        session: SanitizationWorkflowSession,
        method: SanitizationMethodType,
    ): SanitizationWorkflowSession {
        require(session.barrier.isBarrierPassed) { "Cannot select method before satisfying authorization barrier" }
        return session.copy(
            selectedMethod = method,
            currentStep = SanitizationWorkflowStep.METHOD_SELECTED,
        )
    }

    /**
     * Triggers sanitization execution (controlled ADB trigger or dry-run under G5 freeze).
     */
    fun executePurge(
        session: SanitizationWorkflowSession,
        preRecord: PreSanitizationRecord,
        dryRunOnly: Boolean = true,
    ): SanitizationWorkflowSession {
        if (!session.barrier.isBarrierPassed) {
            return session.copy(
                currentStep = SanitizationWorkflowStep.FAILED,
                failureReason = "Sanitization execution rejected: 2-step operator confirmation barrier not passed",
            )
        }

        // Build validated authorization record
        val authReq = AuthorizationRequirement(
            operationId = session.operationId,
            requiresOperatorConfirmation = true,
            confirmationPhrase = session.barrier.step2PhraseRequired,
            isAuthorized = true,
            authorizedBy = session.barrier.authorizedOperatorId,
            authorizedAt = session.barrier.authorizedTimestamp,
        )

        val executionRecord = preRecord.copy(
            operationId = session.operationId,
            selectedMethod = session.selectedMethod,
            authorization = authReq,
        )

        val result = sanitizationProvider.execute(executionRecord, dryRunOnly = dryRunOnly)

        return if (result.isSuccess) {
            session.copy(
                currentStep = SanitizationWorkflowStep.RECONNECT_AWAITING,
                executionResult = result,
            )
        } else {
            session.copy(
                currentStep = SanitizationWorkflowStep.FAILED,
                executionResult = result,
                failureReason = result.error ?: "Sanitization execution returned failure",
            )
        }
    }

    /**
     * Handles post-reboot reconnect event and performs OOBE / setup wizard verification.
     */
    fun verifyReconnection(
        session: SanitizationWorkflowSession,
        reconnectedSerial: String,
        postRebootEvidence: GenericDeviceEvidence?,
    ): SanitizationWorkflowSession {
        val verification = verificationProvider.verifyPostReset(
            operationId = session.operationId,
            sessionUuid = session.sessionUuid,
            postRebootEvidence = postRebootEvidence,
        )

        val reconnectState = DeviceReconnectionState(
            initialSerial = session.deviceIdentifier,
            isReconnected = postRebootEvidence != null,
            postResetAdbState = if (postRebootEvidence != null) "DEVICE_OOBE" else "DISCONNECTED",
            setupWizardDetected = verification.setupWizardDetected,
            userAccountsRemoved = verification.userDataInaccessible,
            screenLockAbsent = verification.userDataInaccessible,
            reconnectedAt = java.time.Instant.now().toString(),
        )

        val isVerified = verification.status == SanitizationVerificationStatus.VERIFIED ||
                verification.status == SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE

        return session.copy(
            currentStep = if (isVerified) SanitizationWorkflowStep.CERTIFICATION_READY else SanitizationWorkflowStep.POST_RESET_VERIFIED,
            reconnectionState = reconnectState,
            verificationResult = verification,
        )
    }
}
