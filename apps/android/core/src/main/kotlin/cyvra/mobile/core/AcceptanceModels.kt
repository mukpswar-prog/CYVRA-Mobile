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
 */
@Serializable
enum class AcceptanceStatus {
    PASSED,
    FAILED,
    SKIPPED,
}

/**
 * Detailed verification item across the 8 Acceptance Categories of §80.
 */
@Serializable
data class AcceptanceCheckItem(
    val category: String,
    val checkId: String,
    val title: String,
    val description: String,
    val status: AcceptanceStatus = AcceptanceStatus.PASSED,
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
    val isSystemAcceptancePassed: Boolean,
    val checks: List<AcceptanceCheckItem> = emptyList(),
    val sha256VerificationSeal: String,
)
