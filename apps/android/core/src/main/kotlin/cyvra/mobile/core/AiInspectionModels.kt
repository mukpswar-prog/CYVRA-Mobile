package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Standard 6-view physical inspection capture sequence (§18, §34 / Phase 8).
 */
@Serializable
enum class PhysicalInspectionView {
    FRONT,
    BACK,
    LEFT_SIDE,
    RIGHT_SIDE,
    TOP,
    BOTTOM,
    CORNER_OBLIQUE,
}

/**
 * Image Quality Gate status flags (§19).
 * AI must never evaluate a degraded or compromised capture.
 */
@Serializable
enum class ImageQualityStatus {
    PASSED,
    BLUR_DETECTED,
    EXCESSIVE_GLARE,
    POOR_LIGHTING,
    INCORRECT_ORIENTATION,
    DEVICE_OBSTRUCTED,
    DEVICE_OUT_OF_FRAME,
    RESOLUTION_INSUFFICIENT,
}

/**
 * Quality evaluation result for a single view capture.
 */
@Serializable
data class ImageQualityGateResult(
    val status: ImageQualityStatus,
    val isAcceptableForInference: Boolean,
    val score: Double, // 0.0 - 1.0
    val operatorFeedback: String? = null,
)

/**
 * Raw physical image evidence record (§21).
 * Hashed with SHA-256 for cryptographic tamper evidence.
 */
@Serializable
data class PhysicalViewCaptureRecord(
    val viewId: String,
    val inspectionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val view: PhysicalInspectionView,
    val capturedAt: String = java.time.Instant.now().toString(),
    val imageSha256: String,
    val imageResolution: String = "1920x1080",
    val qualityGate: ImageQualityGateResult,
    val rawImageUri: String? = null,
)

/**
 * Complete inspection session bundle (V0).
 */
@Serializable
data class PhysicalInspectionSessionRecord(
    val inspectionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val startedAt: String = java.time.Instant.now().toString(),
    val completedAt: String? = null,
    val captures: List<PhysicalViewCaptureRecord> = emptyList(),
    val isCompleteSequence: Boolean = false,
    val methodology: String = "CYVORIQ Mobile Physical Inspection Standard v1.0",
)
