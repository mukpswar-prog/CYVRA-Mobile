package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Customer journey milestone stage per Freeze Guide §80.
 */
@Serializable
enum class AcceptanceJourneyStage {
    INSTALL_AND_ACTIVATE,
    CONNECT_DEVICE,
    DIAGNOSE_EVIDENCE,
    AI_PHYSICAL_SCREEN_BODY,
    DETERMINISTIC_GRADING,
    HUMAN_REVIEW_AUDIT,
    GENERATE_CONDITION_REPORT,
    DATA_PURGE_CONFIRMATION,
    POST_RESET_RECONNECT,
    SANITIZATION_VERIFICATION,
    GENERATE_LIFECYCLE_CERTIFICATE,
    PLAN_UPGRADE_HANDOFF,
    COMMERCIAL_ADMIN_APPROVAL,
    SCAN_ACCOUNTING_LEDGER,
    OFFLINE_RESILIENCE_GRACE,
    ZERO_LEAK_SECURITY_AUDIT,
    MULTI_OEM_ADAPTER_MATCH,
    WINDOWS_PACKAGING_STAGING,
}

/**
 * Status of an acceptance milestone check.
 *
 * [NOT_EVALUATED] is the default and the honest starting state: a check has not been
 * performed yet. It is deliberately distinct from [SKIPPED], which records that a check
 * was considered and consciously not run for a stated reason.
 */
@Serializable
enum class AcceptanceStatus {
    PASSED,
    FAILED,
    SKIPPED,
    NOT_EVALUATED,
}

/**
 * Detailed verification item across the 8 Acceptance Categories of §80.
 *
 * The default status is [AcceptanceStatus.NOT_EVALUATED], not [AcceptanceStatus.PASSED].
 * It previously defaulted to PASSED, so any constructor that omitted `status` published a
 * passing check it had never run - a claim issued by omission, which is the hardest kind
 * to notice because no line of code looks like a claim.
 */
@Serializable
data class AcceptanceCheckItem(
    val category: String,
    val checkId: String,
    val title: String,
    val description: String,
    val status: AcceptanceStatus = AcceptanceStatus.NOT_EVALUATED,
    val evidenceDigest: String? = null,
)

/**
 * Full End-to-End System Integration & Acceptance Verification Report (§80 / Phase 23).
 */
@Serializable
data class SystemAcceptanceReport(
    val acceptanceId: String,
    val evaluatedAt: String = java.time.Instant.now().toString(),
    val targetVersion: String = "3.2.2-g5",
    val completedStages: List<AcceptanceJourneyStage> = emptyList(),
    val totalCheckCount: Int,
    val passedCheckCount: Int,
    val failedCheckCount: Int,
    /**
     * Checks that have not been performed. Defaults to 0 for callers that supply every
     * result explicitly; a report with a non-zero value here has not completed its
     * evaluation, and [isSystemAcceptancePassed] cannot be true while it is non-zero.
     */
    val notEvaluatedCount: Int = 0,
    val isSystemAcceptancePassed: Boolean,
    val checks: List<AcceptanceCheckItem> = emptyList(),
    val sha256VerificationSeal: String,
)
