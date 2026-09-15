package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectType
import cyvra.mobile.core.BodyInspectionRegion
import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.ImageQualityGateResult
import cyvra.mobile.core.ImageQualityStatus
import cyvra.mobile.core.NormalizedBoundingBox
import cyvra.mobile.core.PhysicalInspectionSessionRecord
import cyvra.mobile.core.PhysicalInspectionView
import cyvra.mobile.core.PhysicalViewCaptureRecord
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostBodyInspectionEngineTest {

    private val engine = HostBodyInspectionEngine()

    private fun sampleSession(): PhysicalInspectionSessionRecord {
        val qualityPass = ImageQualityGateResult(
            status = ImageQualityStatus.PASSED,
            isAcceptableForInference = true,
            score = 0.95,
        )

        val views = listOf(
            PhysicalInspectionView.FRONT,
            PhysicalInspectionView.BACK,
            PhysicalInspectionView.LEFT_SIDE,
            PhysicalInspectionView.RIGHT_SIDE,
            PhysicalInspectionView.TOP,
            PhysicalInspectionView.BOTTOM,
        )

        val captures = views.map { view ->
            PhysicalViewCaptureRecord(
                viewId = "VIEW-${view.name}-001",
                inspectionId = "INSP-001",
                sessionUuid = "SESS-100",
                deviceIdentifier = "RF8R123456",
                view = view,
                imageSha256 = "dummy-sha256",
                qualityGate = qualityPass,
            )
        }

        return PhysicalInspectionSessionRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            captures = captures,
            isCompleteSequence = true,
        )
    }

    @Test
    fun formatsBodyDefectRecordAccurately() {
        val defect = engine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.BACK_GLASS,
            defectType = BodyDefectType.BACK_GLASS_CRACK,
            locationDescription = "Spider-web impact at center back panel",
            severity = DefectSeverity.SEVERE,
            confidence = 0.97,
            observedInView = PhysicalInspectionView.BACK,
            boundingBox = NormalizedBoundingBox(0.2, 0.3, 0.5, 0.4),
        )

        assertEquals("INSP-001", defect.inspectionId)
        assertEquals(BodyInspectionRegion.BACK_GLASS, defect.region)
        assertEquals(BodyDefectType.BACK_GLASS_CRACK, defect.defectType)
        assertEquals(DefectSeverity.SEVERE, defect.severity)
        assertEquals(0.97, defect.confidence)
        assertEquals("CYVORIQ-BodyInspection-V1.0", defect.aiModelVersion)
        assertNotNull(defect.boundingBox)
    }

    @Test
    fun evaluatesMultipleBodyDefectsAndGeneratesReport() {
        val session = sampleSession()

        val backCrack = engine.createDefectRecord(
            inspectionId = session.inspectionId,
            sessionUuid = session.sessionUuid,
            region = BodyInspectionRegion.BACK_GLASS,
            defectType = BodyDefectType.BACK_GLASS_CRACK,
            locationDescription = "Center back glass fracture",
            severity = DefectSeverity.SEVERE,
            confidence = 0.96,
            observedInView = PhysicalInspectionView.BACK,
        )

        val portDent = engine.createDefectRecord(
            inspectionId = session.inspectionId,
            sessionUuid = session.sessionUuid,
            region = BodyInspectionRegion.CHARGING_PORT_EXTERIOR,
            defectType = BodyDefectType.PORT_EXTERIOR_DEFORMATION,
            locationDescription = "USB-C exterior rim pinched/dented",
            severity = DefectSeverity.MODERATE,
            confidence = 0.89,
            observedInView = PhysicalInspectionView.BOTTOM,
        )

        val report = engine.evaluateBodyDefects(
            session = session,
            observedDefects = listOf(backCrack, portDent),
        )

        assertEquals("INSP-001", report.inspectionId)
        assertEquals(2, report.totalCosmeticDefectsCount)
        assertTrue(report.hasBackGlassCrack)
        assertTrue(report.hasPortDeformation)
        assertFalse(report.hasCameraLensDamage)
        assertFalse(report.hasFrameBendingOrDents)
    }
}
