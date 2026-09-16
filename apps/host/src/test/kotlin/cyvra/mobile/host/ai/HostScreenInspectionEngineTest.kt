package cyvra.mobile.host.ai

import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.DisplayTestPattern
import cyvra.mobile.core.ImageQualityGateResult
import cyvra.mobile.core.ImageQualityStatus
import cyvra.mobile.core.NormalizedBoundingBox
import cyvra.mobile.core.PhysicalInspectionView
import cyvra.mobile.core.PhysicalViewCaptureRecord
import cyvra.mobile.core.ScreenDefectType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostScreenInspectionEngineTest {

    private val engine = HostScreenInspectionEngine()

    private fun sampleFrontCapture() = PhysicalViewCaptureRecord(
        viewId = "VIEW-FRONT-001",
        inspectionId = "INSP-001",
        sessionUuid = "SESS-100",
        deviceIdentifier = "RF8R123456",
        view = PhysicalInspectionView.FRONT,
        imageSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        qualityGate = ImageQualityGateResult(
            status = ImageQualityStatus.PASSED,
            isAcceptableForInference = true,
            score = 0.95,
        ),
    )

    @Test
    fun requiresFrontViewForSurfaceScreenInspection() {
        val backCapture = sampleFrontCapture().copy(view = PhysicalInspectionView.BACK)
        assertFailsWith<IllegalArgumentException> {
            engine.analyzeSurfaceScreenCapture(backCapture)
        }
    }

    @Test
    fun formatsDefectWithLocationSeverityConfidence() {
        val defect = engine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.SCREEN_CRACK,
            location = "UPPER_LEFT_GLASS",
            severity = DefectSeverity.SEVERE,
            confidence = 0.98,
            boundingBox = NormalizedBoundingBox(0.1, 0.1, 0.4, 0.2),
        )

        assertEquals(ScreenDefectType.SCREEN_CRACK, defect.defectType)
        assertEquals("UPPER_LEFT_GLASS", defect.location)
        assertEquals(DefectSeverity.SEVERE, defect.severity)
        assertEquals(0.98, defect.confidence)
        assertEquals("CYVORIQ-ScreenDefect-V1.0", defect.aiModelVersion)
    }

    @Test
    fun executesDisplayPatternTestAndSurfacesDeadPixelOrBurnIn() {
        val deadPixel = engine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.DEAD_PIXEL,
            location = "CENTER_COORDINATE_960_540",
            severity = DefectSeverity.MINOR,
            confidence = 0.95,
        )

        val burnIn = engine.createDefectRecord(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            defectType = ScreenDefectType.DISPLAY_BURN_IN,
            location = "NAVIGATION_BAR_LOWER_STRIP",
            severity = DefectSeverity.MODERATE,
            confidence = 0.88,
        )

        val redTest = engine.executeControlledDisplayTest(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            pattern = DisplayTestPattern.SOLID_RED,
            detectedAnomalies = listOf(deadPixel),
        )

        val whiteTest = engine.executeControlledDisplayTest(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            pattern = DisplayTestPattern.SOLID_WHITE,
            detectedAnomalies = listOf(burnIn),
        )

        assertEquals(DisplayTestPattern.SOLID_RED, redTest.pattern)
        assertEquals(1, redTest.anomaliesFound.size)

        val report = engine.assembleScreenInspectionReport(
            inspectionId = "INSP-001",
            sessionUuid = "SESS-100",
            deviceIdentifier = "RF8R123456",
            surfaceDefects = emptyList(),
            displayTests = listOf(redTest, whiteTest),
        )

        assertFalse(report.hasCracks)
        assertTrue(report.hasDeadOrStuckPixels)
        assertTrue(report.hasBurnIn)
        assertEquals(2, report.defects.size)
    }
}
