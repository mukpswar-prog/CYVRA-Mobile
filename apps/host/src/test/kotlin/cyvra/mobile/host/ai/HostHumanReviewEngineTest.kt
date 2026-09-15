package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectType
import cyvra.mobile.core.BodyInspectionRegion
import cyvra.mobile.core.BodyInspectionReport
import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.HumanReviewAction
import cyvra.mobile.core.PhysicalInspectionView
import cyvra.mobile.core.ReviewTriggerReason
import cyvra.mobile.core.ScreenDefectType
import cyvra.mobile.core.ScreenInspectionReport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostHumanReviewEngineTest {

    private val engine = HostHumanReviewEngine(confidenceThreshold = 0.90)

    @Test
    fun identifiesLowConfidenceDefectsAsReviewCandidates() {
        val screenEngine = HostScreenInspectionEngine()
        val highConfidenceDefect = screenEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.SCREEN_CRACK,
            location = "UPPER_GLASS",
            severity = DefectSeverity.SEVERE,
            confidence = 0.98,
        )

        val lowConfidenceDefect = screenEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.HAIRLINE_SCRATCH,
            location = "LOWER_BEZEL",
            severity = DefectSeverity.MINOR,
            confidence = 0.81, // < 0.90 threshold
        )

        val screenReport = ScreenInspectionReport(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            defects = listOf(highConfidenceDefect, lowConfidenceDefect),
        )

        val bodyEngine = HostBodyInspectionEngine()
        val borderlineBodyDefect = bodyEngine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.BACK_GLASS,
            defectType = BodyDefectType.BACK_GLASS_CRACK,
            locationDescription = "Possible hairline fissure",
            severity = DefectSeverity.MODERATE,
            confidence = 0.82, // < 0.90 threshold
            observedInView = PhysicalInspectionView.BACK,
        )

        val bodyReport = BodyInspectionReport(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            defects = listOf(borderlineBodyDefect),
        )

        val candidates = engine.identifyExceptions(screenReport, bodyReport)

        assertEquals(2, candidates.size)
        assertEquals(ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD, candidates[0].reason)
        assertEquals(0.81, candidates[0].confidence)
        assertEquals(0.82, candidates[1].confidence)
    }

    @Test
    fun recordsReviewDecisionsAndFinalizesAuditTrail() {
        var session = engine.startReviewSession("SESS-100", "RF8R123456")

        val candidate = CandidateReviewItem(
            defectId = "DEFECT-001",
            defectDescription = "Possible Back Glass Crack (82% confidence)",
            confidence = 0.82,
            reason = ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD,
        )

        session = engine.recordDecision(
            session = session,
            item = candidate,
            action = HumanReviewAction.ACCEPT,
            operatorId = "operator@cyvoriq.com",
            notes = "Physical inspection confirms defect present under station lamp",
        )

        assertEquals(1, session.decisions.size)
        assertEquals(HumanReviewAction.ACCEPT, session.decisions[0].action)
        assertFalse(session.requiresRecapture)

        val finalized = engine.finalizeReviewSession(session, "TECH-SIGN-992")
        assertTrue(finalized.allExceptionsResolved)
        assertEquals("TECH-SIGN-992", finalized.reviewerSignature)
    }
}
