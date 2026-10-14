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

        // PUR-006: the residual application inventory, taken through supported paths.
        // This is what the limitation below used to disclose as never having happened.
        val residual = residualInventory()

        val residualLimitation = if (residual.failureReason == null) {
            "Residual application inventory measured after reset (PUR-006): total, " +
                "third-party and CYVRA package counts taken via supported paths only. " +
                "Account, contact and media counts were NOT taken, because those require " +
                "commands outside the supported set, so user-account removal and " +
                "user-data erasure remain unmeasured by this check."
        } else {
            "Residual application inventory (PUR-006) was NOT measured: " +
                residual.failureReason + ". User-account removal and user-data erasure " +
                "therefore remain unmeasured by this check."
        }

        val baseNotes = if (!lockEstablished) {
            "Post-reset reconnection observed, but screen-lock state was not readable; " +
                "verification cannot proceed from this evidence."
        } else if (consistentWithOobe) {
            "Post-reset reconnection observed with no screen lock present, consistent " +
                "with OOBE. Erasure and account removal were not established by this check."
        } else {
            "Post-reset reconnection observed with a screen lock still present, which " +
                "is NOT consistent with a factory-reset OOBE state."
        }

        // Counts are appended only when they were actually established.
        val notes = if (residual.failureReason == null) {
            baseNotes + " Residual inventory (PUR-006): total=" + residual.totalPackages +
                ", third-party=" + residual.thirdPartyPackages +
                ", cyvra-packages=" + residual.cyvraPackages + "."
        } else {
            baseNotes
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
                residualLimitation,
                "Flash wear-leveling prevents direct physical NAND cell verification without " +
                    "chip desoldering (PUR-007)",
            ),
            assuranceLevel = "OBSERVED_POST_RESET_STATE_ERASURE_NOT_ESTABLISHED",
            notes = notes,
            residualTotalPackages = residual.totalPackages,
            residualThirdPartyPackages = residual.thirdPartyPackages,
            residualCyvraPackages = residual.cyvraPackages,
        )
    }

    private data class ResidualInventory(
        val totalPackages: Int?,
        val thirdPartyPackages: Int?,
        val cyvraPackages: Int?,
        val failureReason: String?,
    )

    /**
     * PUR-006 residual application inventory.
     *
     * Both commands sit inside `HostSecurityAuditEngine.ALLOWED_ADB_PREFIXES`, so the
     * scan adds no capability beyond the ones the product already holds.
     *
     * Every `null` means NOT MEASURED. An enumeration that succeeds but yields no
     * parsable record is reported as not measured rather than as zero, because zero
     * packages would be a claim about the device while an unreadable listing is only a
     * claim about our read.
     */
    private fun residualInventory(): ResidualInventory {
        val all = adbClient.runShell(serial, CMD_LIST_ALL_PACKAGES)
        if (!all.isSuccess) {
            return ResidualInventory(
                null, null, null,
                "package enumeration failed: " +
                    (all.stderr.trim().ifBlank { "exit ${all.exitCode}" }).take(160),
            )
        }
        val total = countPackageLines(all.stdout)
        if (total == 0) {
            return ResidualInventory(
                null, null, null,
                "package enumeration returned no parsable records",
            )
        }

        val thirdParty = adbClient.runShell(serial, CMD_LIST_THIRD_PARTY)
        if (!thirdParty.isSuccess) {
            return ResidualInventory(
                null, null, null,
                "third-party package enumeration failed: " +
                    (thirdParty.stderr.trim().ifBlank { "exit ${thirdParty.exitCode}" }).take(160),
            )
        }

        return ResidualInventory(
            totalPackages = total,
            thirdPartyPackages = countPackageLines(thirdParty.stdout),
            // Counted only. The names are never retained, printed or reported.
            cyvraPackages = countCyvraPackages(all.stdout),
            failureReason = null,
        )
    }

    private fun countPackageLines(stdout: String): Int =
        stdout.lines().count { it.trim().startsWith(PACKAGE_LINE_PREFIX) }

    private fun countCyvraPackages(stdout: String): Int =
        stdout.lines().count {
            it.trim().startsWith(PACKAGE_LINE_PREFIX) && it.contains(CYVRA_TOKEN, ignoreCase = true)
        }

    private companion object {
        const val CMD_LIST_ALL_PACKAGES = "pm list packages"
        const val CMD_LIST_THIRD_PARTY = "pm list packages -3"
        const val PACKAGE_LINE_PREFIX = "package:"
        const val CYVRA_TOKEN = "cyvra"
    }
}
