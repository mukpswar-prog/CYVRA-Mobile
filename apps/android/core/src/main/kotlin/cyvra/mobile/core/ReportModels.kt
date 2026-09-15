package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Coverage labels per GUIDELINE.md §3 (Coverage labels: COMPLETE / LIMITED / PARTIAL).
 * Not arbitrary quality grades.
 */
@Serializable
enum class ReportCoverageLabel {
    COMPLETE,
    LIMITED,
    PARTIAL,
}

/**
 * Metadata shared across all generated reports.
 */
@Serializable
data class ReportHeader(
    val reportId: String,               // e.g. CYVRA-R1-2026-XXXXX or CYVRA-CERT-2026-XXXXX
    val reportTitle: String,
    val generatedAt: String = java.time.Instant.now().toString(),
    val applicationVersion: String = "0.0.0-g5",
    val operatorId: String,
    val sessionUuid: String,
    val organization: String = "CYVORIQ Solutions",
)

/**
 * Integrity block containing SHA-256 digest calculated over the core report contents.
 */
@Serializable
data class ReportIntegrityRecord(
    val algorithm: String = "SHA-256",
    val contentDigest: String,
    val signatureBlockPresent: Boolean = false,
)

/**
 * Report 1: CYVRA Device Verification Report (§3, §40).
 * Pre-sanitization condition report documenting physical and logical status,
 * identity, battery, storage allocations, security status, and capability assessments.
 */
@Serializable
data class DeviceVerificationReport(
    val header: ReportHeader,
    val coverage: ReportCoverageLabel,
    val deviceIdentity: DeviceIdentityEvidence,
    val batterySnapshot: BatteryEvidence,
    val storageSnapshot: StorageEvidence,
    val securitySnapshot: SecurityEvidence,
    val capabilityAssessment: DeviceCapabilityAssessment,
    val componentEvidence: AndroidComponentEvidencePayload? = null,
    val limitations: List<String> = emptyList(),
    val integrity: ReportIntegrityRecord? = null,
)

/**
 * Final Report: CYVRA Data Sanitization & Verification Certificate (§3, §40).
 * Complete tamper-evident record combining pre-purge identity snapshot,
 * operator authorization, execution timestamp, method specifics,
 * post-reboot verification evidence, and NIST SP 800-88 Rev. 2 assurance declarations.
 */
@Serializable
data class SanitizationCertificateReport(
    val header: ReportHeader,
    val preSanitizationRecord: PreSanitizationRecord,
    val executionResult: SanitizationExecutionResult,
    val verificationResult: VerificationResult,
    val nistStandardReference: String = "NIST SP 800-88 Rev. 2",
    val assuranceDeclaration: String,
    val limitations: List<String> = emptyList(),
    val integrity: ReportIntegrityRecord? = null,
)
