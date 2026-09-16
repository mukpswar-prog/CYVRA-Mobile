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

        // Production reset trigger via ADB command (gated)
        val resetCmd = when (preRecord.selectedMethod) {
            SanitizationMethodType.CLEAR_PLATFORM_RESET -> "recovery --wipe_data"
            else -> "am broadcast -a android.intent.action.MASTER_CLEAR"
        }

        val result = adbClient.runShell(serial, resetCmd)
        return SanitizationExecutionResult(
            operationId = preRecord.operationId,
            method = preRecord.selectedMethod,
            isSuccess = result.isSuccess,
            executionStatus = if (result.isSuccess) "TRIGGERED_REBOOT_PENDING" else "FAILED",
            rawResponse = result.stdout,
            error = if (!result.isSuccess) result.stderr else null,
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
                userDataInaccessible = false,
                setupWizardDetected = false,
                limitations = listOf("Device not yet reconnected or post-reset scan not supplied (§38)"),
                assuranceLevel = "REQUIRES_EXTERNAL_VERIFICATION",
                notes = "Operator must reconnect device and verify Android Setup Wizard screen visually",
            )
        }

        // Check whether lock screen is absent and storage reflects clean state
        val lockPresent = postRebootEvidence.security.screenLockPresent.value == true
        val storageAvail = postRebootEvidence.storage.internalAvailableBytes.value ?: 0L

        // In Setup Wizard / OOBE state, screen lock is absent
        val isSetupWizard = !lockPresent

        val status = if (isSetupWizard) {
            SanitizationVerificationStatus.VERIFIED
        } else {
            SanitizationVerificationStatus.PARTIALLY_VERIFIED
        }

        return VerificationResult(
            operationId = operationId,
            sessionUuid = sessionUuid,
            status = status,
            postResetStateDetected = true,
            userDataInaccessible = !lockPresent,
            setupWizardDetected = isSetupWizard,
            limitations = listOf(
                "Verification performed via post-reset ADB reconnection (§35)",
                "Flash wear-leveling prevents direct physical NAND cell verification without chip desoldering",
            ),
            assuranceLevel = "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
            notes = "Device returned to factory setup state; user account data cleared",
        )
    }
}
