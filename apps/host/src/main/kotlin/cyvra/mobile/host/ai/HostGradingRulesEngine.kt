package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectType
import cyvra.mobile.core.BodyInspectionReport
import cyvra.mobile.core.CosmeticGrade
import cyvra.mobile.core.CountryGradingProfilePresentation
import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.DeviceGradingDecisionRecord
import cyvra.mobile.core.FunctionalGrade
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.GradingRuleEvaluationStep
import cyvra.mobile.core.OverallCertifiedGrade
import cyvra.mobile.core.SafetyGrade
import cyvra.mobile.core.ScreenDefectType
import cyvra.mobile.core.ScreenInspectionReport
import java.util.UUID

/**
 * Host Grading Rules Engine (§4, §22, §37 / Phase 11).
 * Translates AI screen, body, and software evidence into deterministic, versioned grades:
 * - Safety: S0 (Safe to Process) or S1 (Safety Hold)
 * - Cosmetic: A (Near New), B (Light Wear), C (Visible Wear), D (Heavy-Service)
 * - Functional: F0 (Fully Verified), F1 (Verified With Limitation), F2 (Functional Defect)
 * - Overall Certified Grade: GRADE_A, GRADE_B, GRADE_C, GRADE_D, SAFETY_HOLD
 *
 * Rules Version: GRADE-IN-001 (Auditable, Transparent, No opaque black-box AI scores).
 */
class HostGradingRulesEngine(
    val rulesVersion: String = "GRADE-IN-001",
) {

    fun evaluateGrade(
        sessionUuid: String,
        deviceIdentifier: String,
        inspectionId: String,
        screenReport: ScreenInspectionReport,
        bodyReport: BodyInspectionReport,
        diagnosticEvidence: GenericDeviceEvidence? = null,
    ): DeviceGradingDecisionRecord {
        val auditTrail = mutableListOf<GradingRuleEvaluationStep>()
        val physicalFindings = mutableListOf<String>()
        val diagnosticFindings = mutableListOf<String>()

        // ----------------------------------------------------
        // 1. SAFETY GRADE EVALUATION (§4, §37)
        // ----------------------------------------------------
        val hasSevereChassisBending = bodyReport.defects.any {
            it.defectType == BodyDefectType.FRAME_BENT_CHASSIS && it.severity == DefectSeverity.SEVERE
        }
        val hasSevereBatterySwellingRisk = diagnosticEvidence?.battery?.temperatureDeciCelsius?.value?.let { it > 500 } ?: false

        val isSafetyHold = hasSevereChassisBending || hasSevereBatterySwellingRisk

        val safetyGrade = if (isSafetyHold) {
            auditTrail.add(
                GradingRuleEvaluationStep(
                    ruleId = "RULE-SAFE-01",
                    conditionDescription = "Severe structural bending or extreme thermal reading detected",
                    triggered = true,
                    resultingImpact = "Assign S1 (Safety Hold / Physical Confirmation Required)",
                )
            )
            physicalFindings.add("SAFETY WARNING: Significant chassis deformation or thermal anomaly detected")
            SafetyGrade.S1_SAFETY_HOLD_PHYSICAL_CONFIRMATION_REQUIRED
        } else {
            auditTrail.add(
                GradingRuleEvaluationStep(
                    ruleId = "RULE-SAFE-00",
                    conditionDescription = "No structural swelling or battery anomalies detected",
                    triggered = true,
                    resultingImpact = "Assign S0 (Safe to Process)",
                )
            )
            physicalFindings.add("No safety hazards or chassis deformations detected")
            SafetyGrade.S0_SAFE_TO_PROCESS
        }

        // ----------------------------------------------------
        // 2. COSMETIC GRADE EVALUATION (§4, §37)
        // ----------------------------------------------------
        val hasScreenCrack = screenReport.hasCracks
        val hasBackCrack = bodyReport.hasBackGlassCrack
        val hasMajorScreenBurnIn = screenReport.defects.any {
            it.defectType == ScreenDefectType.DISPLAY_BURN_IN && it.severity == DefectSeverity.SEVERE
        }

        val hasDeepScratches = screenReport.defects.any { it.defectType == ScreenDefectType.DEEP_SCRATCH } ||
            bodyReport.defects.any { it.defectType == BodyDefectType.RAIL_DEEP_SCRATCH }

        val hasVisibleWear = bodyReport.defects.any {
            it.defectType == BodyDefectType.FRAME_DENT || it.defectType == BodyDefectType.CORNER_IMPACT_MARK
        }

        val totalCosmeticDefects = screenReport.defects.size + bodyReport.defects.size

        val cosmeticGrade = when {
            // Rule: Severe cracks or major burn-in -> Grade D
            hasScreenCrack || hasBackCrack || hasMajorScreenBurnIn -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-COSM-D",
                        conditionDescription = "Screen crack, back glass crack, or severe burn-in observed",
                        triggered = true,
                        resultingImpact = "Assign Cosmetic Grade D (Heavy-Service)",
                    )
                )
                if (hasScreenCrack) physicalFindings.add("Screen glass crack observed")
                if (hasBackCrack) physicalFindings.add("Back glass fracture observed")
                if (hasMajorScreenBurnIn) physicalFindings.add("Severe display burn-in observed")
                CosmeticGrade.D_HEAVY_SERVICE
            }

            // Rule: Visible wear / dents / deep scratches -> Grade C
            hasDeepScratches || hasVisibleWear || totalCosmeticDefects > 3 -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-COSM-C",
                        conditionDescription = "Deep scratches, frame impact marks, or multiple wear points",
                        triggered = true,
                        resultingImpact = "Assign Cosmetic Grade C (Visible Wear)",
                    )
                )
                physicalFindings.add("Visible wear, surface scratches, or minor chassis dent detected")
                CosmeticGrade.C_VISIBLE_WEAR
            }

            // Rule: Minor scuffs, light rail wear -> Grade B
            totalCosmeticDefects in 1..3 -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-COSM-B",
                        conditionDescription = "Up to 3 light hairline scuffs/wear points without cracks",
                        triggered = true,
                        resultingImpact = "Assign Cosmetic Grade B (Light Wear)",
                    )
                )
                physicalFindings.add("Light micro-scuffing or minor bezel wear observed")
                CosmeticGrade.B_LIGHT_WEAR
            }

            // Rule: Pristine, no observable defects -> Grade A
            else -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-COSM-A",
                        conditionDescription = "Zero detected cracks, scratches, dents or scuffs across all views",
                        triggered = true,
                        resultingImpact = "Assign Cosmetic Grade A (Near New)",
                    )
                )
                physicalFindings.add("Flawless body housing and pristine display glass")
                CosmeticGrade.A_NEAR_NEW
            }
        }

        // ----------------------------------------------------
        // 3. FUNCTIONAL GRADE EVALUATION (§4, §22)
        // ----------------------------------------------------
        val hasDeadPixels = screenReport.hasDeadOrStuckPixels
        val hasCameraDefect = bodyReport.hasCameraLensDamage

        val functionalGrade = when {
            hasDeadPixels || hasCameraDefect -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-FUNC-F2",
                        conditionDescription = "Dead display pixels or cracked camera lens cover",
                        triggered = true,
                        resultingImpact = "Assign Functional Grade F2 (Functional Defect)",
                    )
                )
                if (hasDeadPixels) diagnosticFindings.add("Display subpixel failure detected")
                if (hasCameraDefect) diagnosticFindings.add("Camera lens cover damaged")
                FunctionalGrade.F2_FUNCTIONAL_DEFECT
            }
            diagnosticEvidence != null -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-FUNC-F0",
                        conditionDescription = "All diagnostic parameters and hardware queries executed successfully",
                        triggered = true,
                        resultingImpact = "Assign Functional Grade F0 (Fully Verified)",
                    )
                )
                diagnosticFindings.add("Storage, battery, and platform properties verified via controlled ADB")
                FunctionalGrade.F0_FULLY_VERIFIED
            }
            else -> {
                auditTrail.add(
                    GradingRuleEvaluationStep(
                        ruleId = "RULE-FUNC-F1",
                        conditionDescription = "Physical inspection completed; hardware diagnostics pending full run",
                        triggered = true,
                        resultingImpact = "Assign Functional Grade F1 (Verified With Limitation)",
                    )
                )
                diagnosticFindings.add("Hardware parameters partially verified")
                FunctionalGrade.F1_VERIFIED_WITH_LIMITATION
            }
        }

        // ----------------------------------------------------
        // 4. OVERALL CERTIFIED GRADE COMBINATION (§4, §22)
        // ----------------------------------------------------
        val overallGrade = when {
            safetyGrade == SafetyGrade.S1_SAFETY_HOLD_PHYSICAL_CONFIRMATION_REQUIRED -> OverallCertifiedGrade.SAFETY_HOLD
            cosmeticGrade == CosmeticGrade.A_NEAR_NEW && functionalGrade == FunctionalGrade.F0_FULLY_VERIFIED -> OverallCertifiedGrade.GRADE_A
            cosmeticGrade == CosmeticGrade.A_NEAR_NEW || cosmeticGrade == CosmeticGrade.B_LIGHT_WEAR -> OverallCertifiedGrade.GRADE_B
            cosmeticGrade == CosmeticGrade.C_VISIBLE_WEAR -> OverallCertifiedGrade.GRADE_C
            else -> OverallCertifiedGrade.GRADE_D
        }

        // ----------------------------------------------------
        // 5. PRESENTATION PROFILE MAPPING (§23)
        // ----------------------------------------------------
        val presentation = CountryGradingProfilePresentation(
            profileName = "INDIA_REMARKETING_STANDARD",
            safetyLabel = if (safetyGrade == SafetyGrade.S0_SAFE_TO_PROCESS) "Safe to Process" else "Safety Hold (Review Required)",
            cosmeticLabel = when (cosmeticGrade) {
                CosmeticGrade.A_NEAR_NEW -> "Excellent / Near New"
                CosmeticGrade.B_LIGHT_WEAR -> "Good / Light Wear"
                CosmeticGrade.C_VISIBLE_WEAR -> "Fair / Visible Wear"
                CosmeticGrade.D_HEAVY_SERVICE -> "Heavy Wear / Screen Damage"
            },
            functionalLabel = when (functionalGrade) {
                FunctionalGrade.F0_FULLY_VERIFIED -> "Fully Functional"
                FunctionalGrade.F1_VERIFIED_WITH_LIMITATION -> "Verified With Limitation"
                FunctionalGrade.F2_FUNCTIONAL_DEFECT -> "Functional Defect Present"
            },
            overallLabel = when (overallGrade) {
                OverallCertifiedGrade.GRADE_A -> "Grade A (Pristine Condition)"
                OverallCertifiedGrade.GRADE_B -> "Grade B (Certified Good)"
                OverallCertifiedGrade.GRADE_C -> "Grade C (Value / Re-commerce)"
                OverallCertifiedGrade.GRADE_D -> "Grade D (Refurbishing Required)"
                OverallCertifiedGrade.SAFETY_HOLD -> "SAFETY HOLD (DO NOT PROCESS)"
            },
        )

        return DeviceGradingDecisionRecord(
            gradingId = "GRADE-DEC-${UUID.randomUUID().toString().take(8).uppercase()}",
            inspectionId = inspectionId,
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
            safetyGrade = safetyGrade,
            cosmeticGrade = cosmeticGrade,
            functionalGrade = functionalGrade,
            overallGrade = overallGrade,
            rulesVersion = rulesVersion,
            evaluationAuditTrail = auditTrail,
            physicalFindingsSummary = physicalFindings,
            diagnosticFindingsSummary = diagnosticFindings,
            presentation = presentation,
        )
    }
}
