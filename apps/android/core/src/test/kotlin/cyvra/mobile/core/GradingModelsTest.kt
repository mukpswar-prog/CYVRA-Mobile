package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GradingModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesGradingDecisionRecord() {
        val presentation = CountryGradingProfilePresentation(
            profileName = "INDIA_REMARKETING_STANDARD",
            safetyLabel = "Safe to Process",
            cosmeticLabel = "Good / Light Wear",
            functionalLabel = "Fully Functional",
            overallLabel = "Grade B (Certified Good)",
        )

        val step = GradingRuleEvaluationStep(
            ruleId = "RULE-COSM-B",
            conditionDescription = "Up to 3 light hairline scuffs/wear points without cracks",
            triggered = true,
            resultingImpact = "Assign Cosmetic Grade B",
        )

        val record = DeviceGradingDecisionRecord(
            gradingId = "GRADE-DEC-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            safetyGrade = SafetyGrade.S0_SAFE_TO_PROCESS,
            cosmeticGrade = CosmeticGrade.B_LIGHT_WEAR,
            functionalGrade = FunctionalGrade.F0_FULLY_VERIFIED,
            overallGrade = OverallCertifiedGrade.GRADE_B,
            rulesVersion = "GRADE-IN-001",
            evaluationAuditTrail = listOf(step),
            physicalFindingsSummary = listOf("2 light frame scratches", "no visible screen crack"),
            diagnosticFindingsSummary = listOf("Display, storage, and battery verified"),
            presentation = presentation,
        )

        val encoded = json.encodeToString(record)
        val decoded = json.decodeFromString<DeviceGradingDecisionRecord>(encoded)

        assertEquals("GRADE-DEC-001", decoded.gradingId)
        assertEquals(SafetyGrade.S0_SAFE_TO_PROCESS, decoded.safetyGrade)
        assertEquals(CosmeticGrade.B_LIGHT_WEAR, decoded.cosmeticGrade)
        assertEquals(FunctionalGrade.F0_FULLY_VERIFIED, decoded.functionalGrade)
        assertEquals(OverallCertifiedGrade.GRADE_B, decoded.overallGrade)
        assertEquals("GRADE-IN-001", decoded.rulesVersion)
        assertEquals(1, decoded.evaluationAuditTrail.size)
        assertTrue(decoded.evaluationAuditTrail[0].triggered)
    }
}
