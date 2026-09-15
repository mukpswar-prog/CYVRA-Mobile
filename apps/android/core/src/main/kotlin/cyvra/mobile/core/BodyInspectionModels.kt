package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Body regions inspected during multi-view computer vision analysis (§36 / Phase 10).
 */
@Serializable
enum class BodyInspectionRegion {
    BACK_GLASS,
    MAIN_FRAME,
    LEFT_RAIL,
    RIGHT_RAIL,
    TOP_EDGE,
    BOTTOM_EDGE,
    CAMERA_LENS_COVER,
    CHARGING_PORT_EXTERIOR,
    SPEAKER_MIC_GRILLES,
}

/**
 * Body defect classification per §36.
 */
@Serializable
enum class BodyDefectType {
    BACK_GLASS_CRACK,
    BACK_GLASS_CHIP,
    FRAME_DENT,
    FRAME_BENT_CHASSIS,
    RAIL_DEEP_SCRATCH,
    RAIL_COSMETIC_WEAR,
    CORNER_IMPACT_MARK,
    CAMERA_LENS_SCRATCH,
    CAMERA_LENS_CRACK,
    PORT_EXTERIOR_DEFORMATION,
    HOUSING_DISCOLORATION,
}

/**
 * Atomic body defect evidence record conforming to §21 & §36.
 * Emits (DEFECT, LOCATION, SEVERITY, CONFIDENCE).
 * Does NOT assign a final cosmetic grade yet (reserved for Phase 11 Rules Engine).
 */
@Serializable
data class BodyDefectEvidence(
    val defectId: String,
    val inspectionId: String,
    val sessionUuid: String,
    val region: BodyInspectionRegion,
    val defectType: BodyDefectType,
    val locationDescription: String,
    val severity: DefectSeverity,
    val confidence: Double, // 0.0 .. 1.0
    val boundingBox: NormalizedBoundingBox? = null,
    val observedInView: PhysicalInspectionView,
    val aiModelVersion: String = "CYVORIQ-BodyInspection-V1.0",
    val thresholdVersion: String = "2026.09.1",
    val detectedAt: String = java.time.Instant.now().toString(),
    val imageHash: String? = null,
)

/**
 * Comprehensive body inspection bundle derived from the 6/8 view physical captures.
 */
@Serializable
data class BodyInspectionReport(
    val inspectionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val defects: List<BodyDefectEvidence> = emptyList(),
    val hasBackGlassCrack: Boolean = false,
    val hasFrameBendingOrDents: Boolean = false,
    val hasCameraLensDamage: Boolean = false,
    val hasPortDeformation: Boolean = false,
    val totalCosmeticDefectsCount: Int = 0,
    val completedAt: String = java.time.Instant.now().toString(),
)
