package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Sequential phases of the sanitization lifecycle per Master Workflow §23 & §40 (Phase 14).
 * Flow: Pre-scan -> Capability -> Authorization -> Method -> Purge -> Reboot -> Reconnect -> Verify -> Final Report
 */
@Serializable
enum class SanitizationWorkflowStep {
    PRE_SCAN_VERIFIED,
    CAPABILITY_ASSESSED,
    AUTHORIZATION_REQUIRED,
    CONFIRMATION_PASSED,
    METHOD_SELECTED,
    PURGE_EXECUTING,
    REBOOT_PENDING,
    RECONNECT_AWAITING,
    POST_RESET_VERIFIED,
    CERTIFICATION_READY,
    FAILED,
}

/**
 * 2-Step operator confirmation barrier state.
 * Prevents accidental or unattended destructive triggers.
 */
@Serializable
data class OperatorPurgeConfirmationBarrier(
    val operationId: String,
    val step1AcknowledgementChecked: Boolean = false,
    val step2PhraseRequired: String = "PURGE DEVICE NOW",
    val step2PhraseEntered: String? = null,
    val isBarrierPassed: Boolean = false,
    val authorizedOperatorId: String? = null,
    val authorizedTimestamp: String? = null,
)

/**
 * Reconnection & OOBE / Setup Wizard verification status.
 */
@Serializable
data class DeviceReconnectionState(
    val initialSerial: String,
    val isReconnected: Boolean = false,
    val postResetAdbState: String = "DISCONNECTED",
    val setupWizardDetected: Boolean = false,
    val userAccountsRemoved: Boolean = false,
    val screenLockAbsent: Boolean = false,
    val reconnectedAt: String? = null,
)

/**
 * Complete active Data Purge Workflow Session.
 */
@Serializable
data class SanitizationWorkflowSession(
    val sessionUuid: String,
    val operationId: String,
    val currentStep: SanitizationWorkflowStep,
    val deviceIdentifier: String,
    val selectedMethod: SanitizationMethodType,
    val barrier: OperatorPurgeConfirmationBarrier,
    val executionResult: SanitizationExecutionResult? = null,
    val reconnectionState: DeviceReconnectionState? = null,
    val verificationResult: VerificationResult? = null,
    val failureReason: String? = null,
)
