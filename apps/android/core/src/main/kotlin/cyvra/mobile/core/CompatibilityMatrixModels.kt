package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Capability levels per Freeze Guide §42 & TEST_MATRIX.md:
 * A — Launch / Connect
 * B — Generic Evidence
 * C — Extended Evidence
 * D — Sanitization Capability Assessment
 * E — Sanitization Execution
 * F — Verification
 *
 * Binary "COMPATIBLE / INCOMPATIBLE" or "PASS / FAIL" for an entire device is forbidden.
 */
@Serializable
enum class CompatibilityTierLevel {
    LEVEL_A_LAUNCH_CONNECT,
    LEVEL_B_GENERIC_EVIDENCE,
    LEVEL_C_EXTENDED_EVIDENCE,
    LEVEL_D_SANITIZATION_ASSESSMENT,
    LEVEL_E_SANITIZATION_EXECUTION,
    LEVEL_F_POST_RESET_VERIFICATION,
}

/**
 * Status for an individual compatibility level per §42.
 */
@Serializable
enum class TierAssessmentResult {
    PASS,
    PARTIAL,
    UNSUPPORTED,
    REQUIRES_AUTHORIZATION,
    NOT_APPLICABLE,
}

/**
 * Detailed evaluation item for a single capability tier.
 */
@Serializable
data class TierEvaluationItem(
    val tier: CompatibilityTierLevel,
    val result: TierAssessmentResult,
    val details: String,
)

/**
 * Recognized OEM families from freeze matrix (§41, TEST_MATRIX.md).
 */
@Serializable
enum class OemFamily {
    SAMSUNG,
    XIAOMI_REDMI_POCO,
    MOTOROLA,
    ONEPLUS,
    OPPO_REALME,
    VIVO,
    GOOGLE_PIXEL,
    NOTHING,
    UNKNOWN_GENERIC,
}

/**
 * Multi-OEM device compatibility record (§41, §42).
 */
@Serializable
data class DeviceCompatibilityRecord(
    val manufacturer: String,
    val model: String,
    val oemFamily: OemFamily,
    val apiLevel: Int,
    val androidVersion: String,
    val evaluatedAt: String = java.time.Instant.now().toString(),
    val isSupportedOsVersion: Boolean, // Android 8 (API 26) through Android 16 (API 36)
    val tierEvaluations: List<TierEvaluationItem>,
    val overallSummary: String,
    val limitations: List<String> = emptyList(),
)

/**
 * Evaluates device compatibility per §41 and §42 without binary simplification.
 */
object CompatibilityMatrixEvaluator {

    val MIN_SUPPORTED_API = 26 // Android 8.0 Oreo
    val MAX_SUPPORTED_API = 36 // Android 16 Baklava

    fun identifyOemFamily(manufacturer: String): OemFamily {
        val normalized = manufacturer.trim().lowercase()
        return when {
            normalized.contains("samsung") -> OemFamily.SAMSUNG
            normalized.contains("xiaomi") || normalized.contains("redmi") || normalized.contains("poco") -> OemFamily.XIAOMI_REDMI_POCO
            normalized.contains("motorola") || normalized.contains("moto") -> OemFamily.MOTOROLA
            normalized.contains("oneplus") -> OemFamily.ONEPLUS
            normalized.contains("oppo") || normalized.contains("realme") -> OemFamily.OPPO_REALME
            normalized.contains("vivo") || normalized.contains("iqoo") -> OemFamily.VIVO
            normalized.contains("google") -> OemFamily.GOOGLE_PIXEL
            normalized.contains("nothing") -> OemFamily.NOTHING
            else -> OemFamily.UNKNOWN_GENERIC
        }
    }

    fun evaluateDevice(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        androidVersion: String,
        isUsbConnected: Boolean,
        isAdbAuthorized: Boolean,
        hasEvidence: Boolean = false,
        hasComponentEvidence: Boolean = false,
        isSanitizationAuthorized: Boolean = false,
        isPostResetVerified: Boolean = false,
    ): DeviceCompatibilityRecord {
        val oemFamily = identifyOemFamily(manufacturer)
        val isSupportedOs = apiLevel in MIN_SUPPORTED_API..MAX_SUPPORTED_API
        val evaluations = mutableListOf<TierEvaluationItem>()
        val limitations = mutableListOf<String>()

        if (!isSupportedOs) {
            limitations.add("API level $apiLevel is outside tested matrix ($MIN_SUPPORTED_API..$MAX_SUPPORTED_API)")
        }

        // Level A: Launch / Connect
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_A_LAUNCH_CONNECT,
                result = when {
                    !isUsbConnected -> TierAssessmentResult.REQUIRES_AUTHORIZATION
                    isAdbAuthorized -> TierAssessmentResult.PASS
                    else -> TierAssessmentResult.PARTIAL
                },
                details = if (isAdbAuthorized) "USB and ADB transport active" else "USB connected, ADB authorization required",
            ),
        )

        // Level B: Generic Evidence
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_B_GENERIC_EVIDENCE,
                result = when {
                    hasEvidence -> TierAssessmentResult.PASS
                    isAdbAuthorized -> TierAssessmentResult.PASS
                    else -> TierAssessmentResult.REQUIRES_AUTHORIZATION
                },
                details = if (isAdbAuthorized || hasEvidence) "Generic ADB identity/storage/battery available" else "Awaiting transport authorization",
            ),
        )

        // Level C: Extended Evidence (supporting component / sensors)
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_C_EXTENDED_EVIDENCE,
                result = if (hasComponentEvidence) TierAssessmentResult.PASS else TierAssessmentResult.PARTIAL,
                details = if (hasComponentEvidence) "Android Component active with display/sensor metrics" else "Standard generic telemetry only",
            ),
        )

        // Level D: Sanitization Capability Assessment
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_D_SANITIZATION_ASSESSMENT,
                result = if (isSupportedOs) TierAssessmentResult.PASS else TierAssessmentResult.PARTIAL,
                details = "Platform reset and NIST capability mapping ready",
            ),
        )

        // Level E: Sanitization Execution
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_E_SANITIZATION_EXECUTION,
                result = when {
                    !isAdbAuthorized -> TierAssessmentResult.REQUIRES_AUTHORIZATION
                    !isSanitizationAuthorized -> TierAssessmentResult.REQUIRES_AUTHORIZATION
                    else -> TierAssessmentResult.PASS
                },
                details = if (isSanitizationAuthorized) "Authorized for execution" else "Operator confirmation required (§28)",
            ),
        )

        // Level F: Verification
        evaluations.add(
            TierEvaluationItem(
                tier = CompatibilityTierLevel.LEVEL_F_POST_RESET_VERIFICATION,
                result = if (isPostResetVerified) TierAssessmentResult.PASS else TierAssessmentResult.NOT_APPLICABLE,
                details = if (isPostResetVerified) "Post-reset verified via reconnect" else "Awaiting post-reset lifecycle",
            ),
        )

        val passCount = evaluations.count { it.result == TierAssessmentResult.PASS }
        val summary = "Tiers: $passCount/${evaluations.size} PASS on ${oemFamily.name} (API $apiLevel)"

        return DeviceCompatibilityRecord(
            manufacturer = manufacturer,
            model = model,
            oemFamily = oemFamily,
            apiLevel = apiLevel,
            androidVersion = androidVersion,
            isSupportedOsVersion = isSupportedOs,
            tierEvaluations = evaluations,
            overallSummary = summary,
            limitations = limitations,
        )
    }
}
