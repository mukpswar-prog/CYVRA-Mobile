package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Sanitization method classification per NIST SP 800-88 Rev. 2.
 */
@Serializable
enum class SanitizationMethodType {
    CLEAR_PLATFORM_RESET,          // Standard Android platform factory reset / data wipe
    CLEAR_DEVICE_OWNER_WIPE,       // Device Policy Manager wipe (requires active Device Owner)
    PURGE_CRYPTOGRAPHIC_ERASE,     // Cryptographic key destruction (hardware-backed)
    PURGE_OEM_SECURE_ERASE,        // OEM proprietary block erase / eMMC-UFS sanitize command
    UNSUPPORTED_METHOD,
}

/**
 * Authorization requirement state before executing any destructive operation (§28).
 */
@Serializable
data class AuthorizationRequirement(
    val operationId: String,
    val requiresOperatorConfirmation: Boolean,
    val confirmationPhrase: String,
    val isAuthorized: Boolean = false,
    val authorizedBy: String? = null,
    val authorizedAt: String? = null,
    val reason: String? = null,
)

/**
 * Pre-sanitization immutable service record snapshot (§34).
 * Must be persisted before initiating reset or reboot.
 */
@Serializable
data class PreSanitizationRecord(
    val operationId: String,
    val sessionUuid: String,
    val timestamp: String = java.time.Instant.now().toString(),
    val identity: DeviceIdentityEvidence,
    val storageSnapshot: StorageEvidence,
    val batterySnapshot: BatteryEvidence,
    val selectedMethod: SanitizationMethodType,
    val capabilityAssessment: DeviceCapabilityAssessment,
    val authorization: AuthorizationRequirement,
    val operatorId: String,
    val applicationVersion: String = "0.0.0-g5",
    val expectedReboot: Boolean = true,
)

/**
 * Execution status of the sanitization operation (§30).
 * G5 remains non-destructive (dry run or simulated platform trigger) until physical device testing.
 */
@Serializable
data class SanitizationExecutionResult(
    val operationId: String,
    val method: SanitizationMethodType,
    val executedAt: String = java.time.Instant.now().toString(),
    val isSuccess: Boolean,
    val executionStatus: String, // e.g. "SIMULATED_SUCCESS_G5", "TRIGGERED_REBOOT_PENDING", "FAILED"
    val rawResponse: String? = null,
    val error: String? = null,
)

/**
 * Explicit verification states per Freeze Guide §36.
 * Binary PASS/FAIL is forbidden.
 */
@Serializable
enum class SanitizationVerificationStatus {
    VERIFIED,
    PARTIALLY_VERIFIED,
    PLATFORM_REPORTED_COMPLETE,
    REQUIRES_EXTERNAL_VERIFICATION,
    FAILED,
    UNKNOWN,
}

/**
 * Post-sanitization verification record (§35, §36).
 */
@Serializable
data class VerificationResult(
    val operationId: String,
    val sessionUuid: String,
    val verifiedAt: String = java.time.Instant.now().toString(),
    val status: SanitizationVerificationStatus,
    val postResetStateDetected: Boolean,
    val userDataInaccessible: Boolean,
    val setupWizardDetected: Boolean,
    val limitations: List<String> = emptyList(),
    val assuranceLevel: String, // e.g. "NIST_SP_800_88_REV2_CLEAR", "PLATFORM_REPORTED_FACTORY_RESET"
    val notes: String? = null,
)

/**
 * Core interface for Sanitization Providers (§28).
 */
interface SanitizationProvider {
    fun assessCapability(assessment: DeviceCapabilityAssessment): SanitizationMethodType
    fun requestAuthorization(operationId: String, method: SanitizationMethodType): AuthorizationRequirement
    fun execute(
        preRecord: PreSanitizationRecord,
        dryRunOnly: Boolean = true,
    ): SanitizationExecutionResult
}

/**
 * Core interface for Verification Providers (§35).
 */
interface VerificationProvider {
    fun verifyPostReset(
        operationId: String,
        sessionUuid: String,
        postRebootEvidence: GenericDeviceEvidence?,
    ): VerificationResult
}

/**
 * Eligibility decision for starting the sanitization lifecycle (fail-closed).
 * [isEligible] is true only when every mandatory precondition holds; [blockReasons]
 * records every unmet precondition verbatim so the block is auditable.
 */
@Serializable
data class SanitizationEligibility(
    val isEligible: Boolean,
    val blockReasons: List<String> = emptyList(),
)

/**
 * Pure eligibility gate for the sanitization lifecycle:
 * DEVICE VERIFIED (Report 1 exists with integrity) + PRE-SANITIZATION EVIDENCE
 * present + evidence bound to the same session + target identity consistent.
 *
 * Fail-closed: every missing or mismatched precondition adds a block reason and the
 * result is ineligible when any precondition is unmet. Nothing is fabricated: a null
 * input is a missing precondition, never an implied pass.
 */
fun deriveSanitizationEligibility(
    verificationReport: DeviceVerificationReport?,
    preRecord: PreSanitizationRecord?,
): SanitizationEligibility {
    val blockReasons = mutableListOf<String>()

    if (verificationReport == null) {
        blockReasons.add(
            "DEVICE_NOT_VERIFIED: Report 1 device verification report is required before sanitization can begin.",
        )
    } else if (verificationReport.integrity == null) {
        blockReasons.add(
            "REPORT_1_INTEGRITY_MISSING: Report 1 carries no integrity digest; verification evidence is incomplete.",
        )
    }

    if (preRecord == null) {
        blockReasons.add(
            "PRE_SANITIZATION_EVIDENCE_MISSING: pre-sanitization evidence record is required before sanitization can begin.",
        )
    } else if (verificationReport != null && preRecord.sessionUuid != verificationReport.header.sessionUuid) {
        blockReasons.add(
            "TARGET_SESSION_MISMATCH: pre-sanitization evidence belongs to a different session than Report 1.",
        )
    }

    if (verificationReport != null && preRecord != null) {
        val reportModel = verificationReport.deviceIdentity.model.value
        val preRecordModel = preRecord.identity.model.value
        if (reportModel != null && preRecordModel != null && reportModel != preRecordModel) {
            blockReasons.add(
                "TARGET_IDENTITY_MISMATCH: pre-sanitization evidence identifies a different device target than Report 1.",
            )
        }
    }

    return SanitizationEligibility(
        isEligible = blockReasons.isEmpty(),
        blockReasons = blockReasons,
    )
}
