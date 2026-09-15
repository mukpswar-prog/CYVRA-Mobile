package cyvra.mobile.host.report

import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.DeviceVerificationReport
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.ReportCoverageLabel
import cyvra.mobile.core.ReportHeader
import cyvra.mobile.core.ReportIntegrityRecord
import cyvra.mobile.core.SanitizationCertificateReport
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.VerificationResult
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest

/**
 * Host report generator and exporter supporting:
 * - Report 1: CYVRA Device Verification Report (pre-sanitization)
 * - Final Report: CYVRA Data Sanitization & Verification Certificate
 * - JSON and formatted Markdown/Text representations
 * - Cryptographic SHA-256 integrity calculation (§2)
 */
class HostReportEngine(
    private val json: Json = Json { prettyPrint = true; encodeDefaults = true },
) {

    /**
     * Calculates SHA-256 hex string over the provided raw content.
     */
    fun computeSha256(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(content.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * Builds Report 1: CYVRA Device Verification Report.
     */
    fun generateVerificationReport(
        reportId: String,
        operatorId: String,
        evidence: GenericDeviceEvidence,
        assessment: DeviceCapabilityAssessment,
        componentEvidence: AndroidComponentEvidencePayload? = null,
        limitations: List<String> = emptyList(),
    ): DeviceVerificationReport {
        val header = ReportHeader(
            reportId = reportId,
            reportTitle = "CYVRA Device Verification Report",
            operatorId = operatorId,
            sessionUuid = evidence.sessionUuid,
        )

        // Assess coverage label per GUIDELINE §3
        val coverage = when {
            componentEvidence != null -> ReportCoverageLabel.COMPLETE
            evidence.identity.manufacturer.value != null && evidence.storage.internalTotalBytes.value != null -> ReportCoverageLabel.PARTIAL
            else -> ReportCoverageLabel.LIMITED
        }

        val baseReport = DeviceVerificationReport(
            header = header,
            coverage = coverage,
            deviceIdentity = evidence.identity,
            batterySnapshot = evidence.battery,
            storageSnapshot = evidence.storage,
            securitySnapshot = evidence.security,
            capabilityAssessment = assessment,
            componentEvidence = componentEvidence,
            limitations = limitations + listOf(
                "Honesty invariant: unavailable metrics recorded as RESTRICTED/NOT_AVAILABLE without guessing or fabrication (§37).",
            ),
            integrity = null,
        )

        // Calculate cryptographic digest over serialized base report
        val digest = computeSha256(json.encodeToString(baseReport))
        return baseReport.copy(
            integrity = ReportIntegrityRecord(
                algorithm = "SHA-256",
                contentDigest = digest,
            )
        )
    }

    /**
     * Builds Final Report: CYVRA Data Sanitization & Verification Certificate.
     */
    fun generateSanitizationCertificate(
        certificateId: String,
        operatorId: String,
        preRecord: PreSanitizationRecord,
        executionResult: SanitizationExecutionResult,
        verificationResult: VerificationResult,
        limitations: List<String> = emptyList(),
    ): SanitizationCertificateReport {
        val header = ReportHeader(
            reportId = certificateId,
            reportTitle = "CYVRA Data Sanitization & Verification Certificate",
            operatorId = operatorId,
            sessionUuid = preRecord.sessionUuid,
        )

        val baseReport = SanitizationCertificateReport(
            header = header,
            preSanitizationRecord = preRecord,
            executionResult = executionResult,
            verificationResult = verificationResult,
            nistStandardReference = "NIST SP 800-88 Rev. 2",
            assuranceDeclaration = verificationResult.assuranceLevel,
            limitations = limitations + verificationResult.limitations,
            integrity = null,
        )

        val digest = computeSha256(json.encodeToString(baseReport))
        return baseReport.copy(
            integrity = ReportIntegrityRecord(
                algorithm = "SHA-256",
                contentDigest = digest,
            )
        )
    }

    /**
     * Serializes Report 1 to formatted JSON string.
     */
    fun exportToJson(report: DeviceVerificationReport): String = json.encodeToString(report)

    /**
     * Serializes Sanitization Certificate to formatted JSON string.
     */
    fun exportToJson(report: SanitizationCertificateReport): String = json.encodeToString(report)

    /**
     * Renders human-readable markdown summary for Report 1.
     */
    fun renderMarkdown(report: DeviceVerificationReport): String {
        val id = report.deviceIdentity
        return buildString {
            appendLine("# ${report.header.reportTitle}")
            appendLine("### Report ID: ${report.header.reportId}")
            appendLine("- **Generated At:** ${report.header.generatedAt}")
            appendLine("- **Operator ID:** ${report.header.operatorId}")
            appendLine("- **Session UUID:** ${report.header.sessionUuid}")
            appendLine("- **Coverage Level:** ${report.coverage}")
            appendLine()
            appendLine("## 1. Device Identification")
            appendLine("- **Manufacturer:** ${id.manufacturer.value ?: "RESTRICTED"}")
            appendLine("- **Model:** ${id.model.value ?: "RESTRICTED"}")
            appendLine("- **Android Version:** ${id.androidVersion.value ?: "RESTRICTED"} (API ${id.apiLevel.value ?: 0})")
            appendLine("- **Build ID:** ${id.buildId.value ?: "RESTRICTED"}")
            appendLine("- **Security Patch:** ${id.securityPatch.value ?: "RESTRICTED"}")
            appendLine("- **Hardware Serial:** ${id.hardwareSerial.value ?: "[RESTRICTED - ${id.hardwareSerial.reason}]"}")
            appendLine("- **IMEI:** ${id.imei.value ?: "[RESTRICTED - ${id.imei.reason}]"}")
            appendLine()
            appendLine("## 2. Capability & Sanitization Readiness")
            appendLine("- **Recommended Action:** ${report.capabilityAssessment.recommendedPurgeAction}")
            appendLine("- **Post-Purge Verification Required:** ${report.capabilityAssessment.isPostPurgeVerificationRequired}")
            appendLine()
            appendLine("## 3. Cryptographic Verification")
            appendLine("- **Algorithm:** ${report.integrity?.algorithm ?: "NONE"}")
            appendLine("- **SHA-256 Digest:** `${report.integrity?.contentDigest ?: "UNHASHED"}`")
        }
    }

    /**
     * Renders human-readable markdown summary for Final Sanitization Certificate.
     */
    fun renderMarkdown(report: SanitizationCertificateReport): String {
        return buildString {
            appendLine("# ${report.header.reportTitle}")
            appendLine("### Certificate ID: ${report.header.reportId}")
            appendLine("- **Generated At:** ${report.header.generatedAt}")
            appendLine("- **Operator ID:** ${report.header.operatorId}")
            appendLine("- **Standard Reference:** ${report.nistStandardReference}")
            appendLine("- **Assurance Declaration:** ${report.assuranceDeclaration}")
            appendLine()
            appendLine("## 1. Sanitization Execution")
            appendLine("- **Operation ID:** ${report.preSanitizationRecord.operationId}")
            appendLine("- **Selected Method:** ${report.preSanitizationRecord.selectedMethod}")
            appendLine("- **Execution Status:** ${report.executionResult.executionStatus}")
            appendLine("- **Execution Timestamp:** ${report.executionResult.executedAt}")
            appendLine("- **Authorized By:** ${report.preSanitizationRecord.authorization.authorizedBy ?: "None"}")
            appendLine()
            appendLine("## 2. Post-Reset Verification")
            appendLine("- **Verification Status:** ${report.verificationResult.status}")
            appendLine("- **Setup Wizard Detected:** ${report.verificationResult.setupWizardDetected}")
            appendLine("- **User Data Inaccessible:** ${report.verificationResult.userDataInaccessible}")
            appendLine()
            appendLine("## 3. Limitations & Disclaimers")
            report.limitations.forEach { appendLine("- $it") }
            appendLine()
            appendLine("## 4. Cryptographic Verification")
            appendLine("- **Algorithm:** ${report.integrity?.algorithm ?: "NONE"}")
            appendLine("- **SHA-256 Digest:** `${report.integrity?.contentDigest ?: "UNHASHED"}`")
        }
    }
}
