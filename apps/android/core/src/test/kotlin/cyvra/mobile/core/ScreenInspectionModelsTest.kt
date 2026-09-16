package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ScreenInspectionModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesScreenDefectAndReport() {
        val boundingBox = NormalizedBoundingBox(
            x = 0.15,
            y = 0.20,
            width = 0.30,
            height = 0.05,
        )

        val defect = ScreenDefectEvidence(
            defectId = "DEF-001",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.SCREEN_CRACK,
            location = "UPPER_LEFT_DIAGONAL",
            boundingBox = boundingBox,
            severity = DefectSeverity.SEVERE,
            confidence = 0.96,
        )

        val deadPixelDefect = ScreenDefectEvidence(
            defectId = "DEF-002",
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.DEAD_PIXEL,
            location = "CENTER_DISPLAY",
            severity = DefectSeverity.MINOR,
            confidence = 0.99,
        )

        val displayTest = ControlledDisplayTestRecord(
            testId = "TEST-SOLID-RED-001",
            pattern = DisplayTestPattern.SOLID_RED,
            anomaliesFound = listOf(deadPixelDefect),
        )

        val report = ScreenInspectionReport(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            defects = listOf(defect),
            displayTests = listOf(displayTest),
            hasCracks = true,
            hasDeadOrStuckPixels = true,
            hasBurnIn = false,
        )

        val encoded = json.encodeToString(report)
        val decoded = json.decodeFromString<ScreenInspectionReport>(encoded)

        assertEquals("INSP-001", decoded.inspectionId)
        assertTrue(decoded.hasCracks)
        assertTrue(decoded.hasDeadOrStuckPixels)
        assertEquals(ScreenDefectType.SCREEN_CRACK, decoded.defects[0].defectType)
        assertEquals(DefectSeverity.SEVERE, decoded.defects[0].severity)
        assertEquals(0.96, decoded.defects[0].confidence)
        assertNotNull(decoded.defects[0].boundingBox)
        assertEquals(DisplayTestPattern.SOLID_RED, decoded.displayTests[0].pattern)
    }
}
