package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectEvidence
import cyvra.mobile.core.BodyDefectType
import cyvra.mobile.core.BodyInspectionRegion
import cyvra.mobile.core.BodyInspectionReport
import cyvra.mobile.core.DefectSeverity
import cyvra.mobile.core.NormalizedBoundingBox
import cyvra.mobile.core.PhysicalInspectionSessionRecord
import cyvra.mobile.core.PhysicalInspectionView
import java.util.UUID

/**
 * Host AI Body Inspection Engine (§36 / Phase 10).
 * Analyzes multi-view physical captures across:
 * - Back glass (cracks, chips, deep scratches)
 * - Main frame and side rails (dents, bending, cosmetic wear, discoloration)
 * - Camera lens cover (scratches, cracks)
 * - Exterior port and grilles (deformations, impact marks)
 *
 * Invariant: Emits (DEFECT, LOCATION, SEVERITY, CONFIDENCE).
 * Does NOT assign a final cosmetic grade yet (reserved for Phase 11).
 */
class HostBodyInspectionEngine {

    /**
     * Factory to instantiate a structured BodyDefectEvidence record.
     */
    fun createDefectRecord(
        inspectionId: String,
        sessionUuid: String,
        region: BodyInspectionRegion,
        defectType: BodyDefectType,
        locationDescription: String,
        severity: DefectSeverity,
        confidence: Double,
        observedInView: PhysicalInspectionView,
        boundingBox: NormalizedBoundingBox? = null,
        imageHash: String? = null,
    ): BodyDefectEvidence {
        return BodyDefectEvidence(
            defectId = "DEFECT-BODY-${UUID.randomUUID().toString().take(8).uppercase()}",
            inspectionId = inspectionId,
            sessionUuid = sessionUuid,
            region = region,
            defectType = defectType,
            locationDescription = locationDescription,
            severity = severity,
            confidence = confidence.coerceIn(0.0, 1.0),
            observedInView = observedInView,
            boundingBox = boundingBox,
            imageHash = imageHash,
        )
    }

    /**
     * Evaluates a physical inspection session across all captured views and compiles the BodyInspectionReport.
     */
    fun evaluateBodyDefects(
        session: PhysicalInspectionSessionRecord,
        observedDefects: List<BodyDefectEvidence> = emptyList(),
    ): BodyInspectionReport {
        val hasBackGlassCrack = observedDefects.any {
            it.defectType == BodyDefectType.BACK_GLASS_CRACK || it.defectType == BodyDefectType.BACK_GLASS_CHIP
        }

        val hasFrameBendingOrDents = observedDefects.any {
            it.defectType == BodyDefectType.FRAME_BENT_CHASSIS || it.defectType == BodyDefectType.FRAME_DENT
        }

        val hasCameraLensDamage = observedDefects.any {
            it.defectType == BodyDefectType.CAMERA_LENS_CRACK || it.defectType == BodyDefectType.CAMERA_LENS_SCRATCH
        }

        val hasPortDeformation = observedDefects.any {
            it.defectType == BodyDefectType.PORT_EXTERIOR_DEFORMATION
        }

        return BodyInspectionReport(
            inspectionId = session.inspectionId,
            sessionUuid = session.sessionUuid,
            deviceIdentifier = session.deviceIdentifier,
            defects = observedDefects,
            hasBackGlassCrack = hasBackGlassCrack,
            hasFrameBendingOrDents = hasFrameBendingOrDents,
            hasCameraLensDamage = hasCameraLensDamage,
            hasPortDeformation = hasPortDeformation,
            totalCosmeticDefectsCount = observedDefects.size,
        )
    }
}
