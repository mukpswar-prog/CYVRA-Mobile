package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Screen defect categories per Master Workflow §35 (Phase 9).
 */
@Serializable
enum class ScreenDefectType {
    SCREEN_CRACK,
    SCREEN_CHIP,
    DEEP_SCRATCH,
    HAIRLINE_SCRATCH,
    DEAD_PIXEL,
    STUCK_PIXEL,
    DISPLAY_BURN_IN,
    BACKLIGHT_BLEED_UNIFORMITY,
}

/**
 * Defect severity scaling.
 */
@Serializable
enum class DefectSeverity {
    MINOR,
    MODERATE,
    SEVERE,
    CRITICAL,
}

/**
 * Normalized 2D bounding box (0.0 to 1.0 relative to display coordinates).
 */
@Serializable
data class NormalizedBoundingBox(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
)

/**
 * Atomic screen defect evidence record conforming to §21 & §35.
 * Contains: Defect, Location, Severity, Confidence.
 * Does NOT assign a final cosmetic grade yet (reserved for Phase 11 Rules Engine).
 */
@Serializable
data class ScreenDefectEvidence(
    val defectId: String,
    val inspectionId: String,
    val sessionUuid: String,
    val defectType: ScreenDefectType,
    val location: String,
    val boundingBox: NormalizedBoundingBox? = null,
    val severity: DefectSeverity,
    val confidence: Double, // 0.0 .. 1.0
    val aiModelVersion: String = "CYVORIQ-ScreenDefect-V1.0",
    val thresholdVersion: String = "2026.09.1",
    val detectedAt: String = java.time.Instant.now().toString(),
    val imageHash: String? = null,
)

/**
 * Supported display test patterns for controlled visual evaluation.
 */
@Serializable
enum class DisplayTestPattern {
    SOLID_RED,
    SOLID_GREEN,
    SOLID_BLUE,
    SOLID_WHITE,
    SOLID_BLACK,
}

/**
 * Record of a controlled display pattern test (e.g. RGB/White/Black screens).
 */
@Serializable
data class ControlledDisplayTestRecord(
    val testId: String,
    val pattern: DisplayTestPattern,
    val executedVia: String = "CONTROLLED_SCREEN_PATTERN",
    val anomaliesFound: List<ScreenDefectEvidence> = emptyList(),
    val executedAt: String = java.time.Instant.now().toString(),
)

/**
 * Complete screen inspection evidence bundle.
 */
@Serializable
data class ScreenInspectionReport(
    val inspectionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val defects: List<ScreenDefectEvidence> = emptyList(),
    val displayTests: List<ControlledDisplayTestRecord> = emptyList(),
    val hasCracks: Boolean = false,
    val hasDeadOrStuckPixels: Boolean = false,
    val hasBurnIn: Boolean = false,
    val completedAt: String = java.time.Instant.now().toString(),
)
