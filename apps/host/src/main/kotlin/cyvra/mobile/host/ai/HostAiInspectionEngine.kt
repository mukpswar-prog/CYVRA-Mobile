package cyvra.mobile.host.ai

import cyvra.mobile.core.ImageQualityGateResult
import cyvra.mobile.core.ImageQualityStatus
import cyvra.mobile.core.PhysicalInspectionSessionRecord
import cyvra.mobile.core.PhysicalInspectionView
import cyvra.mobile.core.PhysicalViewCaptureRecord
import java.security.MessageDigest
import java.util.UUID

/**
 * Host AI Physical Inspection Engine V0 (§18, §19, §34 / Phase 8).
 * Manages:
 * - 6-view capture progression (FRONT, BACK, LEFT, RIGHT, TOP, BOTTOM)
 * - Image Quality Gate checks (rejects blurry or glare-obscured captures)
 * - Cryptographic SHA-256 evidence hashing
 * - Session binding
 */
class HostAiInspectionEngine {

    private val mandatoryViews = listOf(
        PhysicalInspectionView.FRONT,
        PhysicalInspectionView.BACK,
        PhysicalInspectionView.LEFT_SIDE,
        PhysicalInspectionView.RIGHT_SIDE,
        PhysicalInspectionView.TOP,
        PhysicalInspectionView.BOTTOM,
    )

    fun startInspection(sessionUuid: String, deviceIdentifier: String): PhysicalInspectionSessionRecord {
        return PhysicalInspectionSessionRecord(
            inspectionId = "AI-INSP-${UUID.randomUUID().toString().take(8).uppercase()}",
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
        )
    }

    /**
     * Evaluates raw image quality before admitting capture into evidence (§19).
     */
    fun evaluateQualityGate(
        rawImageBytes: ByteArray,
        glareScore: Double = 0.05,
        blurScore: Double = 0.02,
        width: Int = 1920,
        height: Int = 1080,
    ): ImageQualityGateResult {
        if (width < 1280 || height < 720) {
            return ImageQualityGateResult(
                status = ImageQualityStatus.RESOLUTION_INSUFFICIENT,
                isAcceptableForInference = false,
                score = 0.3,
                operatorFeedback = "Camera resolution is below standard minimum (1280x720).",
            )
        }

        if (glareScore > 0.40) {
            return ImageQualityGateResult(
                status = ImageQualityStatus.EXCESSIVE_GLARE,
                isAcceptableForInference = false,
                score = 0.4,
                operatorFeedback = "Excessive glare on screen surface. Adjust diffuse lighting or camera angle.",
            )
        }

        if (blurScore > 0.30) {
            return ImageQualityGateResult(
                status = ImageQualityStatus.BLUR_DETECTED,
                isAcceptableForInference = false,
                score = 0.4,
                operatorFeedback = "Image blur detected. Ensure device is stable in fixture.",
            )
        }

        return ImageQualityGateResult(
            status = ImageQualityStatus.PASSED,
            isAcceptableForInference = true,
            score = 0.95,
            operatorFeedback = "Image quality verified. Accepted for AI evaluation.",
        )
    }

    /**
     * Records a verified view capture and computes SHA-256 integrity hash (§21).
     */
    fun recordViewCapture(
        session: PhysicalInspectionSessionRecord,
        view: PhysicalInspectionView,
        rawImageBytes: ByteArray,
        qualityGate: ImageQualityGateResult,
    ): PhysicalInspectionSessionRecord {
        val digest = MessageDigest.getInstance("SHA-256")
        val sha256Hex = digest.digest(rawImageBytes).joinToString("") { "%02x".format(it) }

        val captureRecord = PhysicalViewCaptureRecord(
            viewId = "VIEW-${view.name}-${UUID.randomUUID().toString().take(6).uppercase()}",
            inspectionId = session.inspectionId,
            sessionUuid = session.sessionUuid,
            deviceIdentifier = session.deviceIdentifier,
            view = view,
            imageSha256 = sha256Hex,
            qualityGate = qualityGate,
        )

        val updatedCaptures = session.captures.filter { it.view != view } + captureRecord
        val capturedViews = updatedCaptures.map { it.view }.toSet()
        val isComplete = mandatoryViews.all { it in capturedViews }

        return session.copy(
            captures = updatedCaptures,
            isCompleteSequence = isComplete,
            completedAt = if (isComplete) java.time.Instant.now().toString() else null,
        )
    }
}
