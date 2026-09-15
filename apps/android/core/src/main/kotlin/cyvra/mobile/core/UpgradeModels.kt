package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Standard scan entitlement capacity tiers per Master Workflow §12 & §29.
 */
@Serializable
enum class ScanEntitlementPlan(
    val planCode: String,
    val displayName: String,
    val scanCount: Int,
    val description: String,
) {
    TIER_1("PLAN-1", "Single Scan", 1, "Evaluation & single device processing"),
    TIER_3("PLAN-3", "3 Device Scans", 3, "Small batch device processing"),
    TIER_5("PLAN-5", "5 Device Scans", 5, "Standard technician allocation"),
    TIER_7("PLAN-7", "7 Device Scans", 7, "Weekly technician quota"),
    TIER_25("PLAN-25", "25 Device Scans", 25, "Enterprise / high-throughput batch quota"),
}

/**
 * Immutable entitlement revision record preserving upgrade history (§13).
 * Example:
 * Revision 1: 3 scans, used 2, remaining 1, status SUPERSEDED
 * Revision 2: 25 scans, used 2, remaining 23, status ACTIVE
 */
@Serializable
data class EntitlementRevisionRecord(
    val revisionNumber: Int,
    val serialNumber: String,
    val plan: ScanEntitlementPlan,
    val totalScans: Int,
    val carriedOverUsage: Int,
    val scansRemaining: Int,
    val status: LicenseEntitlementStatus,
    val activatedAt: String,
    val supersededAt: String? = null,
    val externalOrderId: String? = null,
)

/**
 * Upgrade request token for web checkout handoff (§12, §31).
 * Desktop app generates this token to hand off to the official authenticated CYVORIQ checkout portal.
 */
@Serializable
data class UpgradeHandoffRequest(
    val requestId: String,
    val licenseId: String,
    val currentSerial: String,
    val currentRevision: Int,
    val targetPlan: ScanEntitlementPlan,
    val customerEmail: String,
    val generatedAt: String = java.time.Instant.now().toString(),
    val handoffUrl: String,
)

/**
 * Ledger entry for device scan accounting (§14).
 * Enforces transaction point: committed when customer starts diagnostic,
 * finalized and debited only when report/certificate is generated.
 */
@Serializable
data class ScanLedgerEntry(
    val transactionId: String,
    val licenseId: String,
    val revisionNumber: Int,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val eventType: ScanCommitStatus,
    val scanSequenceNumber: Int,
    val timestamp: String = java.time.Instant.now().toString(),
    val reportId: String? = null,
    val operatorId: String,
)
