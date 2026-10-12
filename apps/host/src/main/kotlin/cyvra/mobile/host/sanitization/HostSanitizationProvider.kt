package cyvra.mobile.host.sanitization

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.SanitizationProvider
import cyvra.mobile.core.SanitizationVerificationStatus
import cyvra.mobile.core.VerificationProvider
import cyvra.mobile.core.VerificationResult
import cyvra.mobile.host.transport.AdbClient

/**
 * Host-side implementation of [SanitizationProvider] adhering to:
 * - NIST SP 800-88 Rev. 2 guidelines
 * - Freeze Guide §27–§36
 * - G5 Non-destructive law: destructive operations default to dry-run or simulated execution
 *   until physical hardware validation.
 */
class HostSanitizationProvider(
    private val adbClient: AdbClient,
    private val serial: String,
) : SanitizationProvider {

    override fun assessCapability(assessment: DeviceCapabilityAssessment): SanitizationMethodType {
        val oemProprietary = assessment.capabilities.firstOrNull { it.capabilityKey == "OEM_PROPRIETARY_SECURE_ERASE" }
        if (oemProprietary?.isAvailable == true) {
            return SanitizationMethodType.PURGE_OEM_SECURE_ERASE
        }

        val doWipe = assessment.capabilities.firstOrNull { it.capabilityKey == "DEVICE_OWNER_WIPE" }
        if (doWipe?.isAvailable == true) {
            return SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE
        }

        val platformReset = assessment.capabilities.firstOrNull { it.capabilityKey == "PLATFORM_FACTORY_RESET" }
        if (platformReset?.isAvailable == true) {
            return SanitizationMethodType.CLEAR_PLATFORM_RESET
        }

        return SanitizationMethodType.UNSUPPORTED_METHOD
    }

    override fun requestAuthorization(
        operationId: String,
        method: SanitizationMethodType,
    ): AuthorizationRequirement {
        return AuthorizationRequirement(
            operationId = operationId,
            requiresOperatorConfirmation = true,
            confirmationPhrase = "AUTHORIZE $operationId",
            isAuthorized = false,
            reason = "Awaiting explicit operator confirmation before destructive trigger (§28)",
        )
    }

    override fun execute(
        preRecord: PreSanitizationRecord,
        dryRunOnly: Boolean,
    ): SanitizationExecutionResult {
        if (!preRecord.authorization.isAuthorized) {
            return SanitizationExecutionResult(
                operationId = preRecord.operationId,
                method = preRecord.selectedMethod,
                isSuccess = false,
                executionStatus = "FAILED_UNAUTHORIZED",
                error = "Cannot execute sanitization: operator authorization missing or invalid (§28)",
            )
        }

        // G5 Safety Rule: Non-destructive execution
        if (dryRunOnly) {
            return SanitizationExecutionResult(
                operationId = preRecord.operationId,
                method = preRecord.selectedMethod,
                isSuccess = true,
                executionStatus = "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE",
                rawResponse = "Dry run completed safely under G5 engineering freeze",
            )
        }

        // OUTCOME B (integrated engineering build): real sanitization execution is
        // explicitly BLOCKED/NOT_IMPLEMENTED. No validated, device-target-verified
        // destructive provider exists for the supported targets yet, so no destructive
        // command may be issued. The system therefore cannot generate a successful
        // sanitization result: this path records honest block evidence instead of
        // firing a generic or unverified wipe command. A future evidence-grade
        // provider plugs in here behind the eligibility gate and target lock.
        return SanitizationExecutionResult(
            operationId = preRecord.operationId,
            method = preRecord.selectedMethod,
            isSuccess = false,
            executionStatus = "BLOCKED_NOT_IMPLEMENTED",
            rawResponse = null,
            error = "Sanitization execution is blocked: no validated sanitization provider " +
                "exists for this device target (engineering build; see eligibility gate).",
        )
    }
}

/**
 * Host-side post-reset verification provider (§35, §36).
 */
class HostVerificationProvider(
    private val adbClient: AdbClient,
    private val serial: String,
) : VerificationProvider {

    override fun verifyPostReset(
        operationId: String,
        sessionUuid: String,
        postRebootEvidence: GenericDeviceEvidence?,
    ): VerificationResult {
        if (postRebootEvidence == null) {
            return VerificationResult(
                operationId = operationId,
                sessionUuid = sessionUuid,
                status = SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION,
                postResetStateDetected = false,
                // null = NOT ESTABLISHED. This branch has no post-reboot evidence at all,
                // so claiming `false` would be a claim about the device made from silence.
                userDataInaccessible = null,
                setupWizardDetected = false,
                limitations = listOf("Device not yet reconnected or post-reset scan not supplied (§38)"),
                assuranceLevel = "REQUIRES_EXTERNAL_VERIFICATION",
                notes = "Operator must reconnect device and verify Android Setup Wizard screen visually",
            )
        }

        // What was actually observed: the screen-lock state, and nothing more.
        val lockValue = postRebootEvidence.security.screenLockPresent.value
        val lockEstablished = lockValue != null
        val lockPresent = lockValue == true

        // A device in OOBE has no screen lock. So does a device whose owner never set
        // one. The two are indistinguishable from this observation alone, so absence of a
        // lock is recorded as CONSISTENT with a reset rather than as proof of one. The
        // previous code treated it as proof, returned VERIFIED, and stamped an assurance
        // level citing NIST SP 800-88 - asserting a standard this product has not
        // executed, derived from a single boolean.
        val consistentWithOobe = lockEstablished && !lockPresent

        val status = if (lockEstablished) {
            SanitizationVerificationStatus.PARTIALLY_VERIFIED
        } else {
            SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION
        }

        return VerificationResult(
            operationId = operationId,
            sessionUuid = sessionUuid,
            status = status,
            postResetStateDetected = true,
            // NOT established. See VerificationResult.userDataInaccessible: this product
            // does not measure user-data accessibility, so it reports no answer rather
            // than inferring one from the lock screen.
            userDataInaccessible = null,
            setupWizardDetected = consistentWithOobe,
            limitations = listOf(
                "Verification performed via post-reset ADB reconnection (§35)",
                "Screen-lock absence is consistent with a post-reset OOBE state but does " +
                    "not establish erasure: a device whose owner never set a lock presents " +
                    "identically, so this check cannot distinguish the two.",
                "User-account removal and user-data erasure were NOT measured - no account, " +
                    "contact or media count was taken after the reset. These require a " +
                    "residual-data scan (PUR-006).",
                "Flash wear-leveling prevents direct physical NAND cell verification without " +
                    "chip desoldering (PUR-007)",
            ),
            assuranceLevel = "OBSERVED_POST_RESET_STATE_ERASURE_NOT_ESTABLISHED",
            notes = if (!lockEstablished) {
                "Post-reset reconnection observed, but screen-lock state was not readable; " +
                    "verification cannot proceed from this evidence."
            } else if (consistentWithOobe) {
                "Post-reset reconnection observed with no screen lock present, consistent " +
                    "with OOBE. Erasure and account removal were not established by this check."
            } else {
                "Post-reset reconnection observed with a screen lock still present, which " +
                    "is NOT consistent with a factory-reset OOBE state."
            },
        )
    }
}
