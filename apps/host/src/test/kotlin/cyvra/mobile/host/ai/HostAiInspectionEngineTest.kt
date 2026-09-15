package cyvra.mobile.host.ai

import cyvra.mobile.core.ImageQualityStatus
import cyvra.mobile.core.PhysicalInspectionView
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostAiInspectionEngineTest {

    private val engine = HostAiInspectionEngine()

    @Test
    fun qualityGateRejectsLowResolutionAndExcessiveGlare() {
        val dummyBytes = "image-bytes".toByteArray()

        // 1. Rejects low resolution
        val resResult = engine.evaluateQualityGate(dummyBytes, width = 640, height = 480)
        assertEquals(ImageQualityStatus.RESOLUTION_INSUFFICIENT, resResult.status)
        assertFalse(resResult.isAcceptableForInference)

        // 2. Rejects excessive glare
        val glareResult = engine.evaluateQualityGate(dummyBytes, glareScore = 0.55)
        assertEquals(ImageQualityStatus.EXCESSIVE_GLARE, glareResult.status)
        assertFalse(glareResult.isAcceptableForInference)

        // 3. Rejects blur
        val blurResult = engine.evaluateQualityGate(dummyBytes, blurScore = 0.45)
        assertEquals(ImageQualityStatus.BLUR_DETECTED, blurResult.status)
        assertFalse(blurResult.isAcceptableForInference)

        // 4. Passes good capture
        val passResult = engine.evaluateQualityGate(dummyBytes, glareScore = 0.05, blurScore = 0.02)
        assertEquals(ImageQualityStatus.PASSED, passResult.status)
        assertTrue(passResult.isAcceptableForInference)
    }

    @Test
    fun recordsSixViewSequenceAndCalculatesSha256Evidence() {
        var session = engine.startInspection("SESSION-UUID-100", "DEVICE-SERIAL-001")
        assertFalse(session.isCompleteSequence)

        val views = listOf(
            PhysicalInspectionView.FRONT,
            PhysicalInspectionView.BACK,
            PhysicalInspectionView.LEFT_SIDE,
            PhysicalInspectionView.RIGHT_SIDE,
            PhysicalInspectionView.TOP,
            PhysicalInspectionView.BOTTOM,
        )

        val qualityPass = engine.evaluateQualityGate("good-pixels".toByteArray())

        views.forEach { view ->
            val fakeBytes = "view-pixels-for-${view.name}".toByteArray()
            session = engine.recordViewCapture(session, view, fakeBytes, qualityPass)
        }

        assertEquals(6, session.captures.size)
        assertTrue(session.isCompleteSequence, "All 6 views captured, sequence must be complete")
        assertNotNull(session.completedAt)

        // Verify SHA-256 is generated for each view
        session.captures.forEach { capture ->
            assertEquals(64, capture.imageSha256.length, "SHA-256 must be 64 hex characters")
        }
    }
}
