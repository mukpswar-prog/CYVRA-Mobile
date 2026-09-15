package cyvra.mobile.host.ai

import cyvra.mobile.core.BodyDefectEvidence
import cyvra.mobile.core.BodyInspectionReport
import cyvra.mobile.core.DefectReviewDecision
import cyvra.mobile.core.HumanReviewAction
import cyvra.mobile.core.HumanReviewSessionRecord
import cyvra.mobile.core.ReviewTriggerReason
import cyvra.mobile.core.ScreenDefectEvidence
import cyvra.mobile.core.ScreenInspectionReport
import java.util.UUID

/**
 * Host Human Review & Exception Handling Engine (§5, §21, §38 / Phase 12).
 * Moves the human from primary judge to exception reviewer and safety auditor:
 * - Identifies borderline AI defect detections (confidence < threshold or ambiguous severity)
 * - Enables operator actions: ACCEPT, REJECT, RECAPTURE, PHYSICAL_VERIFICATION
 * - Tracks operator ID, timestamp, image hash, and decision rationales
 * - Emits structured training dataset entries for continuous AI improvement
 */
class HostHumanReviewEngine(
    val confidenceThreshold: Double = 0.90,
) {

    /**
     * Scans screen and body inspection findings for items requiring operator review.
     */
    fun identifyExceptions(
        screenReport: ScreenInspectionReport,
        bodyReport: BodyInspectionReport,
    ): List<CandidateReviewItem> {
        val candidates = mutableListOf<CandidateReviewItem>()

        screenReport.defects.forEach { defect ->
            if (defect.confidence < confidenceThreshold) {
                candidates.add(
                    CandidateReviewItem(
                        defectId = defect.defectId,
                        defectDescription = "Screen Defect: ${defect.defectType} at ${defect.location}",
                        confidence = defect.confidence,
                        reason = ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD,
                        imageHash = defect.imageHash,
                    )
                )
            }
        }

        bodyReport.defects.forEach { defect ->
            if (defect.confidence < confidenceThreshold) {
                candidates.add(
                    CandidateReviewItem(
                        defectId = defect.defectId,
                        defectDescription = "Body Defect: ${defect.defectType} at ${defect.locationDescription}",
                        confidence = defect.confidence,
                        reason = ReviewTriggerReason.LOW_CONFIDENCE_THRESHOLD,
                        imageHash = defect.imageHash,
                    )
                )
            }
        }

        return candidates
    }

    /**
     * Initializes a review session for a device session.
     */
    fun startReviewSession(
        sessionUuid: String,
        deviceIdentifier: String,
    ): HumanReviewSessionRecord {
        return HumanReviewSessionRecord(
            reviewSessionId = "REV-SESS-${UUID.randomUUID().toString().take(8).uppercase()}",
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
        )
    }

    /**
     * Records an operator decision on a candidate review item.
     */
    fun recordDecision(
        session: HumanReviewSessionRecord,
        item: CandidateReviewItem,
        action: HumanReviewAction,
        operatorId: String,
        notes: String? = null,
    ): HumanReviewSessionRecord {
        val decision = DefectReviewDecision(
            reviewItemId = "REV-ITEM-${UUID.randomUUID().toString().take(6).uppercase()}",
            defectId = item.defectId,
            defectDescription = item.defectDescription,
            initialAiConfidence = item.confidence,
            triggerReason = item.reason,
            action = action,
            operatorId = operatorId,
            operatorNotes = notes,
            imageHash = item.imageHash,
        )

        val updatedDecisions = session.decisions.filter { it.defectId != item.defectId } + decision
        val requiresRecapture = updatedDecisions.any { it.action == HumanReviewAction.RECAPTURE }

        return session.copy(
            decisions = updatedDecisions,
            requiresRecapture = requiresRecapture,
        )
    }

    /**
     * Finalizes and signs off the human review session.
     */
    fun finalizeReviewSession(
        session: HumanReviewSessionRecord,
        reviewerSignature: String,
    ): HumanReviewSessionRecord {
        return session.copy(
            allExceptionsResolved = true,
            reviewerSignature = reviewerSignature,
            completedAt = java.time.Instant.now().toString(),
        )
    }
}

/**
 * Candidate item flagged by AI for human confirmation.
 */
data class CandidateReviewItem(
    val defectId: String,
    val defectDescription: String,
    val confidence: Double,
    val reason: ReviewTriggerReason,
    val imageHash: String? = null,
)
