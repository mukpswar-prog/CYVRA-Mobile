package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Human Review operator action decisions per Master Workflow §21 & §38 (Phase 12).
 */
@Serializable
enum class HumanReviewAction {
    ACCEPT,
    REJECT,
    RECAPTURE,
    PHYSICAL_VERIFICATION,
}

/**
 * Review requirement trigger rationale.
 */
@Serializable
enum class ReviewTriggerReason {
    LOW_CONFIDENCE_THRESHOLD,
    BORDERLINE_DEFECT,
    SAFETY_HOLD_WARNING,
    CONFLICTING_VIEWS,
    OPERATOR_MANUAL_FLAG,
}

/**
 * Single reviewed defect entry with operator decision and notes.
 */
@Serializable
data class DefectReviewDecision(
    val reviewItemId: String,
    val defectId: String,
    val defectDescription: String,
    val initialAiConfidence: Double,
    val triggerReason: ReviewTriggerReason,
    val action: HumanReviewAction,
    val operatorId: String,
    val operatorNotes: String? = null,
    val decidedAt: String = java.time.Instant.now().toString(),
    val imageHash: String? = null,
)

/**
 * Complete human review session record bound to the device session.
 * Essential for auditability, ISO/NIST compliance, and generating model improvement datasets.
 */
@Serializable
data class HumanReviewSessionRecord(
    val reviewSessionId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val decisions: List<DefectReviewDecision> = emptyList(),
    val allExceptionsResolved: Boolean = false,
    val requiresRecapture: Boolean = false,
    val reviewerSignature: String? = null,
    val completedAt: String? = null,
)
