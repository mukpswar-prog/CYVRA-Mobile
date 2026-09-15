package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectType
import cyvra.mobile.core.BodyInspectionRegion
import cyvra.mobile.core.BodyInspectionReport
import cyvra.mobile.core.CosmeticGrade
import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.FunctionalGrade
import cyvra.mobile.core.OverallCertifiedGrade
import cyvra.mobile.core.PhysicalInspectionView
import cyvra.mobile.core.SafetyGrade
import cyvra.mobile.core.ScreenDefectType
import cyvra.mobile.core.ScreenInspectionReport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HostGradingRulesEngineTest {

    private val engine = HostGradingRulesEngine("GRADE-IN-001")

    private fun cleanScreenReport() = ScreenInspectionReport(
        inspectionId = "INSP-001",
        sessionUuid = "SESS-100",
        deviceIdentifier = "RF8R123456",
        defects = emptyList(),
        displayTests = emptyList(),
        hasCracks = false,
        hasDeadOrStuckPixels = false,
        hasBurnIn = false,
    )

    private fun cleanBodyReport() = BodyInspectionReport(
        inspectionId = "INSP-001",
        sessionUuid = "SESS-100",
        deviceIdentifier = "RF8R123456",
        defects = emptyList(),
        hasBackGlassCrack = false,
        hasFrameBendingOrDents = false,
        hasCameraLensDamage = false,
        hasPortDeformation = false,
        totalCosmeticDefectsCount = 0,
    )

    @Test
    fun assignsGradeAForPristineDevice() {
        val decision = engine.evaluateGrade(
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            inspectionId = "INSP-001",
            screenReport = cleanScreenReport(),
            bodyReport = cleanBodyReport(),
            diagnosticEvidence = null,
        )

        assertEquals(SafetyGrade.S0_SAFE_TO_PROCESS, decision.safetyGrade)
        assertEquals(CosmeticGrade.A_NEAR_NEW, decision.cosmeticGrade)
        assertEquals("GRADE-IN-001", decision.rulesVersion)
        assertEquals(OverallCertifiedGrade.GRADE_B, decision.overallGrade, "Without full diagnosticEvidence, capped at B")
    }

    @Test
    fun assignsGradeDForScreenCrackOrBackGlassCrack() {
        val screenEngine = HostScreenInspectionEngine()
        val crack = screenEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.SCREEN_CRACK,
            location = "UPPER_GLASS",
            severity = DefectSeverity.SEVERE,
            confidence = 0.98,
        )
        val crackedScreenReport = cleanScreenReport().copy(
            defects = listOf(crack),
            hasCracks = true,
        )

        val decision = engine.evaluateGrade(
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            inspectionId = "INSP-001",
            screenReport = crackedScreenReport,
            bodyReport = cleanBodyReport(),
        )

        assertEquals(CosmeticGrade.D_HEAVY_SERVICE, decision.cosmeticGrade)
        assertEquals(OverallCertifiedGrade.GRADE_D, decision.overallGrade)
        assertTrue(decision.physicalFindingsSummary.any { it.contains("Screen glass crack") })
    }

    @Test
    fun assignsSafetyHoldForSevereChassisBending() {
        val bodyEngine = HostBodyInspectionEngine()
        val bentFrame = bodyEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.MAIN_FRAME,
            defectType = BodyDefectType.FRAME_BENT_CHASSIS,
            locationDescription = "Middle chassis lateral deformation > 4mm",
            severity = DefectSeverity.SEVERE,
            confidence = 0.92,
            observedInView = PhysicalInspectionView.LEFT_SIDE,
        )

        val bentBodyReport = cleanBodyReport().copy(
            defects = listOf(bentFrame),
            hasFrameBendingOrDents = true,
        )

        val decision = engine.evaluateGrade(
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            inspectionId = "INSP-001",
            screenReport = cleanScreenReport(),
            bodyReport = bentBodyReport,
        )

        assertEquals(SafetyGrade.S1_SAFETY_HOLD_PHYSICAL_CONFIRMATION_REQUIRED, decision.safetyGrade)
        assertEquals(OverallCertifiedGrade.SAFETY_HOLD, decision.overallGrade)
        assertTrue(decision.presentation.overallLabel.contains("SAFETY HOLD"))
    }

    @Test
    fun assignsGradeBForMinorScuffsWithoutCracks() {
        val bodyEngine = HostBodyInspectionEngine()
        val scuff = bodyEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.LEFT_RAIL,
            defectType = BodyDefectType.RAIL_COSMETIC_WEAR,
            locationDescription = "Light scuff near SIM tray",
            severity = DefectSeverity.MINOR,
            confidence = 0.89,
            observedInView = PhysicalInspectionView.LEFT_SIDE,
        )

        val scuffedReport = cleanBodyReport().copy(
            defects = listOf(scuff),
            totalCosmeticDefectsCount = 1,
        )

        val decision = engine.evaluateGrade(
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            inspectionId = "INSP-001",
            screenReport = cleanScreenReport(),
            bodyReport = scuffedReport,
        )

        assertEquals(CosmeticGrade.B_LIGHT_WEAR, decision.cosmeticGrade)
        assertEquals(OverallCertifiedGrade.GRADE_B, decision.overallGrade)
        assertEquals("Good / Light Wear", decision.presentation.cosmeticLabel)
    }
}
