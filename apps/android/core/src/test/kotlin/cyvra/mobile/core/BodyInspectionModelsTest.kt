package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class BodyInspectionModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesBodyDefectAndReport() {
        val boundingBox = NormalizedBoundingBox(
            x = 0.70,
            y = 0.15,
            width = 0.20,
            height = 0.10,
        )

        val cameraDefect = BodyDefectEvidence(
            defectId = "DEF-BODY-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.CAMERA_LENS_COVER,
            defectType = BodyDefectType.CAMERA_LENS_SCRATCH,
            locationDescription = "Secondary telephoto glass surface",
            severity = DefectSeverity.MINOR,
            confidence = 0.94,
            boundingBox = boundingBox,
            observedInView = PhysicalInspectionView.BACK,
        )

        val frameDefect = BodyDefectEvidence(
            defectId = "DEF-BODY-002",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            region = BodyInspectionRegion.MAIN_FRAME,
            defectType = BodyDefectType.FRAME_DENT,
            locationDescription = "Bottom-right chassis corner impact",
            severity = DefectSeverity.MODERATE,
            confidence = 0.91,
            observedInView = PhysicalInspectionView.BOTTOM,
        )

        val report = BodyInspectionReport(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            defects = listOf(cameraDefect, frameDefect),
            hasBackGlassCrack = false,
            hasFrameBendingOrDents = true,
            hasCameraLensDamage = true,
            hasPortDeformation = false,
            totalCosmeticDefectsCount = 2,
        )

        val encoded = json.encodeToString(report)
        val decoded = json.decodeFromString<BodyInspectionReport>(encoded)

        assertEquals("INSP-001", decoded.inspectionId)
        assertEquals(2, decoded.defects.size)
        assertTrue(decoded.hasFrameBendingOrDents)
        assertTrue(decoded.hasCameraLensDamage)
        assertEquals(BodyInspectionRegion.CAMERA_LENS_COVER, decoded.defects[0].region)
        assertEquals(BodyDefectType.FRAME_DENT, decoded.defects[1].defectType)
        assertEquals(DefectSeverity.MODERATE, decoded.defects[1].severity)
        assertNotNull(decoded.defects[0].boundingBox)
    }
}
