package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Invariant security categories governed by Master Workflow §43 (Absolute Rules).
 */
@Serializable
enum class SecurityAuditCategory {
    PRIVATE_KEY_PROTECTION,         // Invariant: Zero private signing keys in desktop app or repo
    PAYMENT_SECRET_ISOLATION,       // Invariant: Desktop never holds payment gateway API secrets
    ADMIN_CREDENTIAL_ISOLATION,     // Invariant: No hardcoded administrative authority in client
    IDENTIFIER_INTEGRITY,           // Invariant: No fabrication of restricted IMEI/serial/MAC
    ADB_COMMAND_SAFETY,             // Invariant: Zero shell injection or unauthorized root escalation
    UPDATE_SIGNATURE_ENFORCEMENT,   // Invariant: Never execute unsigned update packages
    CLIENT_ENTITLEMENT_DISTINCTION, // Invariant: Entitlement logic is server-authoritative
}

/**
 * Compliance evaluation outcome for a security invariant audit rule.
 */
@Serializable
enum class SecurityAuditStatus {
    PASSED,
    FAILED,
    WARNING,
}

/**
 * Individual audit finding checking client codebase and runtime configuration.
 */
@Serializable
data class SecurityAuditFinding(
    val ruleId: String,
    val category: SecurityAuditCategory,
    val description: String,
    val status: SecurityAuditStatus,
    val details: String,
    val remediation: String? = null,
)

/**
 * Complete zero-leak security audit certificate for the workstation host.
 */
@Serializable
data class SecurityAuditReport(
    val auditId: String,
    val evaluatedAt: String = java.time.Instant.now().toString(),
    val workstationEnvironment: String = "Windows 10/11 x64 Architecture",
    val findings: List<SecurityAuditFinding>,
    val totalRulesChecked: Int,
    val totalPassed: Int,
    val totalViolations: Int,
    val isZeroLeakVerified: Boolean,
    val complianceSealDigestSha256: String,
)
