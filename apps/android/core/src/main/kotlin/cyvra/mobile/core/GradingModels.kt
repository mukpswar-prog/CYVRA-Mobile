package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Safety grade assessment (§4, §22, §37 / Phase 11).
 * AI/Software must NOT claim healthy battery if physical danger is suspected.
 */
@Serializable
enum class SafetyGrade {
    S0_SAFE_TO_PROCESS,
    S1_SAFETY_HOLD_PHYSICAL_CONFIRMATION_REQUIRED,
}

/**
 * Cosmetic grade classification (§4, §22).
 * A = Near New, B = Light Wear, C = Visible Wear, D = Heavy-Service.
 */
@Serializable
enum class CosmeticGrade {
    A_NEAR_NEW,
    B_LIGHT_WEAR,
    C_VISIBLE_WEAR,
    D_HEAVY_SERVICE,
}

/**
 * Functional verification grade (§4, §22).
 * F0 = Fully Verified, F1 = Verified With Limitation, F2 = Functional Defect.
 */
@Serializable
enum class FunctionalGrade {
    F0_FULLY_VERIFIED,
    F1_VERIFIED_WITH_LIMITATION,
    F2_FUNCTIONAL_DEFECT,
}

/**
 * Combined overall certified grade result (§4, §22).
 */
@Serializable
enum class OverallCertifiedGrade {
    GRADE_A,
    GRADE_B,
    GRADE_C,
    GRADE_D,
    SAFETY_HOLD,
}

/**
 * Presentation profile mapping (§23) for country or business channel.
 * Underlying core evidence is preserved; only the display labels adjust.
 */
@Serializable
data class CountryGradingProfilePresentation(
    val profileName: String = "INDIA_REMARKETING_STANDARD",
    val safetyLabel: String,
    val cosmeticLabel: String,
    val functionalLabel: String,
    val overallLabel: String,
)

/**
 * Atomic rule evaluation step explaining why a specific grade was assigned.
 */
@Serializable
data class GradingRuleEvaluationStep(
    val ruleId: String,
    val conditionDescription: String,
    val triggered: Boolean,
    val resultingImpact: String,
)

/**
 * Complete, deterministic grading decision bundle adhering to Master Workflow §22 & §37.
 */
@Serializable
data class DeviceGradingDecisionRecord(
    val gradingId: String,
    val inspectionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val safetyGrade: SafetyGrade,
    val cosmeticGrade: CosmeticGrade,
    val functionalGrade: FunctionalGrade,
    val overallGrade: OverallCertifiedGrade,
    val rulesVersion: String = "GRADE-IN-001",
    val methodology: String = "CYVORIQ Mobile Physical Inspection Standard v1.0",
    val evaluationAuditTrail: List<GradingRuleEvaluationStep> = emptyList(),
    val physicalFindingsSummary: List<String> = emptyList(),
    val diagnosticFindingsSummary: List<String> = emptyList(),
    val presentation: CountryGradingProfilePresentation,
    val gradedAt: String = java.time.Instant.now().toString(),
)
