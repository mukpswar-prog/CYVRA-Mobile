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
 * Evidence-level installed-application inventory summary embedded in Report 1.
 *
 * Purely descriptive: every value is derived from the reconciled inventory evidence
 * (or, as a fallback, from a single collected source) with no recomputation of
 * classification and no claim stronger than the underlying enumeration completeness.
 * Source provenance (S1 device-side vs S2 authorized host-side) stays distinguishable
 * through the per-source presence, completeness, and provenance counts. Conflicts are
 * preserved as human-readable summaries; raw UID values are deliberately withheld from
 * this user-facing report (they remain in the evidence layer).
 */
@Serializable
data class ApplicationInventoryReportSection(
    /** True when the inventory contains at least one enumerated application record. */
    val inventoryAvailable: Boolean,
    /** Safest aggregate enumeration completeness; never upgraded by this section. */
    val enumerationCompleteness: ApplicationEnumerationCompleteness,
    val totalApplications: Int,
    val preinstalledSystemCount: Int,
    val updatedSystemCount: Int,
    val userThirdPartyCount: Int,
    val unknownClassificationCount: Int,
    val enabledCount: Int,
    val disabledCount: Int,
    val defaultEnabledCount: Int,
    val unknownEnabledStateCount: Int,
    /** S1 = device-side PackageManager collection (source `ANDROID_COMPONENT`). */
    val s1EvidencePresent: Boolean,
    /** S2 = authorized host-side ADB collection (source `ANDROID_ADB`). */
    val s2EvidencePresent: Boolean,
    val s1EnumerationCompleteness: ApplicationEnumerationCompleteness? = null,
    val s2EnumerationCompleteness: ApplicationEnumerationCompleteness? = null,
    val s1OnlyCount: Int = 0,
    val s2OnlyCount: Int = 0,
    val bothCount: Int = 0,
    /** Records observed by S1 (S1_ONLY + BOTH). */
    val s1ProvenanceCount: Int = 0,
    /** Records observed by S2 (S2_ONLY + BOTH). */
    val s2ProvenanceCount: Int = 0,
    /** Distinct collection methods observed across the collected sources (S1 before S2). */
    val collectionMethods: List<String> = emptyList(),
    /** Distinct collection timestamps observed across the collected sources. */
    val collectionTimestamps: List<String> = emptyList(),
    val limitations: List<String> = emptyList(),
    val conflictCount: Int = 0,
    /** Conflict summaries in reconciler order; UID conflict values are withheld. */
    val conflicts: List<String> = emptyList(),
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
    /** Evidence-level application inventory summary; null when no inventory was collected. */
    val applicationInventory: ApplicationInventoryReportSection? = null,
)

/**
 * Explicit lifecycle outcome of the sanitization attempt recorded in the Final Report.
 *
 * Fail-closed: only [EXECUTED_VERIFIED] may ever be presented as sanitization success.
 * An exit code, a dry-run simulation, or an unverified execution never maps to it.
 */
@Serializable
enum class SanitizationLifecycleOutcome {
    /** Execution was explicitly blocked: no sanitization provider executed a destructive operation. */
    BLOCKED_NOT_EXECUTED,
    /** Dry-run/simulated execution only; no destructive operation actually ran. */
    SIMULATED_NOT_EXECUTED,
    /** Execution was attempted and failed; failure/block evidence is preserved. */
    FAILED,
    /** Execution reported success but post-sanitization verification has not passed. */
    EXECUTED_UNVERIFIED,
    /** Execution reported success AND post-sanitization verification passed. The only success outcome. */
    EXECUTED_VERIFIED,
}

/**
 * Final Report: CYVRA Data Sanitization & Verification Certificate (§3, §40, Phase 15).
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
    val postResetAdbState: String = "DEVICE_OOBE",
    val setupWizardConfirmed: Boolean = true,
    val userAccountsRemoved: Boolean = true,
    val limitations: List<String> = emptyList(),
    val integrity: ReportIntegrityRecord? = null,
    /** Reference to the Report 1 (device verification) report this Final Report follows. */
    val verificationReportReference: String? = null,
    /** Evidence provenance carried from Report 1 (collection methods of the collected sources). */
    val evidenceProvenance: List<String> = emptyList(),
    /** Evidence conflicts carried from Report 1 (UID conflict values withheld). */
    val conflicts: List<String> = emptyList(),
    /** Explicit reason sanitization was blocked, failed, or left unverified; null only on success. */
    val blockReason: String? = null,
    /** Fail-closed lifecycle outcome; default records "not executed" for legacy JSON. */
    val lifecycleOutcome: SanitizationLifecycleOutcome = SanitizationLifecycleOutcome.BLOCKED_NOT_EXECUTED,
    /** True ONLY when [lifecycleOutcome] == [SanitizationLifecycleOutcome.EXECUTED_VERIFIED]. */
    val sanitizationSuccessClaimed: Boolean = false,
)

/**
 * Pre-Purge Certified Report: CYVORIQ Certified Device Condition & Diagnostic Report
 * Adheres strictly to Master Workflow §22, §39 (Phase 13), and §41.
 * Combines customer identity, operator, session, device diagnostic results,
 * physical inspection views, AI evidence, human review decisions,
 * safety status, cosmetic & functional grades, and cryptographic integrity digest.
 */
@Serializable
data class CyvoriqCertifiedConditionReport(
    val header: ReportHeader,
    val customerOrganization: String = "CYVORIQ Certified Partner",
    val licenseKey: String = "CYVRA-LIC-ENTERPRISE-G5",
    val deviceIdentity: DeviceIdentityEvidence,
    val diagnosticSummary: List<String> = emptyList(),
    val physicalInspectionViewsAccepted: Int = 6,
    val physicalInspectionTotalViews: Int = 6,
    val physicalFindings: List<String> = emptyList(),
    val gradingDecision: DeviceGradingDecisionRecord,
    val humanReviewSession: HumanReviewSessionRecord? = null,
    val aiModelVersion: String = "CV-MOBILE-001",
    val rulesVersion: String = "GRADE-IN-001",
    val methodologyVersion: String = "CYVORIQ Mobile Physical Inspection Standard v1.0",
    val limitations: List<String> = emptyList(),
    val integrity: ReportIntegrityRecord? = null,
)

/**
 * Derives the Report 1 application-inventory section from collected inventory evidence.
 *
 * Pure and side-effect-free: counts come straight from the reconciled records, the
 * aggregate completeness is the reconciler's safest aggregate (never re-derived, never
 * upgraded), and conflicts are summarized without altering their order. Returns null
 * only when no inventory source at all was collected.
 *
 * Fallback: when a single [primary] source exists without a reconciliation result, its
 * records are counted and attributed to that source's side (S1 for `ANDROID_COMPONENT`,
 * S2 for `ANDROID_ADB`); no reconciliation is invented after the fact.
 */
fun deriveApplicationInventorySection(
    primary: ApplicationInventoryEvidence?,
    reconciled: ReconciledApplicationInventory?,
): ApplicationInventoryReportSection? {
    if (reconciled == null && primary == null) return null

    if (reconciled == null && primary != null) {
        val isS1 = primary.evidenceSource == "ANDROID_COMPONENT"
        return ApplicationInventoryReportSection(
            inventoryAvailable = primary.applications.isNotEmpty(),
            enumerationCompleteness = primary.enumerationCompleteness,
            totalApplications = primary.applications.size,
            preinstalledSystemCount = primary.applications.count {
                it.classification == ApplicationClassification.PREINSTALLED_SYSTEM
            },
            updatedSystemCount = primary.applications.count {
                it.classification == ApplicationClassification.UPDATED_SYSTEM
            },
            userThirdPartyCount = primary.applications.count {
                it.classification == ApplicationClassification.USER_THIRD_PARTY
            },
            unknownClassificationCount = primary.applications.count {
                it.classification == ApplicationClassification.UNKNOWN
            },
            enabledCount = primary.applications.count { it.enabledState == ApplicationEnabledState.ENABLED },
            disabledCount = primary.applications.count { it.enabledState == ApplicationEnabledState.DISABLED },
            defaultEnabledCount = primary.applications.count { it.enabledState == ApplicationEnabledState.DEFAULT },
            unknownEnabledStateCount = primary.applications.count {
                it.enabledState == ApplicationEnabledState.UNKNOWN
            },
            s1EvidencePresent = isS1,
            s2EvidencePresent = !isS1,
            s1EnumerationCompleteness = if (isS1) primary.enumerationCompleteness else null,
            s2EnumerationCompleteness = if (isS1) null else primary.enumerationCompleteness,
            s1OnlyCount = if (isS1) primary.applications.size else 0,
            s2OnlyCount = if (isS1) 0 else primary.applications.size,
            bothCount = 0,
            s1ProvenanceCount = if (isS1) primary.applications.size else 0,
            s2ProvenanceCount = if (isS1) 0 else primary.applications.size,
            collectionMethods = listOf(primary.collectionMethod),
            collectionTimestamps = listOf(primary.collectedAt),
            limitations = primary.limitations,
            conflictCount = 0,
            conflicts = emptyList(),
        )
    }

    val records = reconciled!!.records

    // Distinct collection methods/timestamps in deterministic order: primary source first,
    // then per-record S1 then S2 as they appear in the reconciled (package-name) order.
    val methods = LinkedHashSet<String>()
    val timestamps = LinkedHashSet<String>()
    primary?.let {
        methods.add(it.collectionMethod)
        timestamps.add(it.collectedAt)
    }
    for (record in records) {
        record.s1Record?.let {
            methods.add(it.collectionMethod)
            timestamps.add(it.collectedAt)
        }
        record.s2Record?.let {
            methods.add(it.collectionMethod)
            timestamps.add(it.collectedAt)
        }
    }

    return ApplicationInventoryReportSection(
        inventoryAvailable = records.isNotEmpty(),
        enumerationCompleteness = reconciled.enumerationCompleteness,
        totalApplications = records.size,
        preinstalledSystemCount = records.count {
            it.classification == ApplicationClassification.PREINSTALLED_SYSTEM
        },
        updatedSystemCount = records.count { it.classification == ApplicationClassification.UPDATED_SYSTEM },
        userThirdPartyCount = records.count {
            it.classification == ApplicationClassification.USER_THIRD_PARTY
        },
        unknownClassificationCount = records.count { it.classification == ApplicationClassification.UNKNOWN },
        enabledCount = records.count { it.enabledState == ApplicationEnabledState.ENABLED },
        disabledCount = records.count { it.enabledState == ApplicationEnabledState.DISABLED },
        defaultEnabledCount = records.count { it.enabledState == ApplicationEnabledState.DEFAULT },
        unknownEnabledStateCount = records.count { it.enabledState == ApplicationEnabledState.UNKNOWN },
        s1EvidencePresent = reconciled.s1Completeness != null,
        s2EvidencePresent = reconciled.s2Completeness != null,
        s1EnumerationCompleteness = reconciled.s1Completeness,
        s2EnumerationCompleteness = reconciled.s2Completeness,
        s1OnlyCount = records.count { it.provenance == ApplicationInventoryProvenance.S1_ONLY },
        s2OnlyCount = records.count { it.provenance == ApplicationInventoryProvenance.S2_ONLY },
        bothCount = records.count { it.provenance == ApplicationInventoryProvenance.BOTH },
        s1ProvenanceCount = records.count {
            it.provenance == ApplicationInventoryProvenance.S1_ONLY ||
                it.provenance == ApplicationInventoryProvenance.BOTH
        },
        s2ProvenanceCount = records.count {
            it.provenance == ApplicationInventoryProvenance.S2_ONLY ||
                it.provenance == ApplicationInventoryProvenance.BOTH
        },
        collectionMethods = methods.toList(),
        collectionTimestamps = timestamps.toList(),
        limitations = reconciled.limitations,
        conflictCount = reconciled.conflicts.size,
        conflicts = reconciled.conflicts.map { summarizeApplicationInventoryConflict(it) },
    )
}

/**
 * Human-readable conflict summary for Report 1. Preserves the conflict verbatim except
 * for UID conflicts, whose raw values are deliberately withheld from the user-facing
 * report (the full values remain in the evidence layer's conflict entries).
 */
fun summarizeApplicationInventoryConflict(conflict: ApplicationInventoryConflict): String = when (conflict) {
    is ApplicationInventoryConflict.Classification ->
        "${conflict.packageName}: classification conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.SystemFlag ->
        "${conflict.packageName}: system flag conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.UpdatedSystemFlag ->
        "${conflict.packageName}: updated-system flag conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.EnabledState ->
        "${conflict.packageName}: enabled-state conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.VersionCode ->
        "${conflict.packageName}: version code conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.VersionName ->
        "${conflict.packageName}: version name conflict (S1=${conflict.s1Value}, S2=${conflict.s2Value})"

    is ApplicationInventoryConflict.Uid ->
        "${conflict.packageName}: UID conflict between evidence sources (values withheld from report)"
}

/**
 * Fail-closed lifecycle outcome for the Final Report.
 *
 * Order matters: a simulated dry run is never an execution even if it "succeeded";
 * an explicit BLOCKED status is never an execution; a failed execution is a failure;
 * an execution without a passing post-sanitization verification is never a success.
 * [SanitizationLifecycleOutcome.EXECUTED_VERIFIED] requires BOTH execution success
 * (non-simulated) AND a verification status of VERIFIED or PLATFORM_REPORTED_COMPLETE.
 */
fun deriveSanitizationLifecycleOutcome(
    executionResult: SanitizationExecutionResult,
    verificationResult: VerificationResult,
): SanitizationLifecycleOutcome = when {
    executionResult.executionStatus == "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE" ->
        SanitizationLifecycleOutcome.SIMULATED_NOT_EXECUTED

    executionResult.executionStatus.startsWith("BLOCKED") ->
        SanitizationLifecycleOutcome.BLOCKED_NOT_EXECUTED

    !executionResult.isSuccess ->
        SanitizationLifecycleOutcome.FAILED

    verificationResult.status != SanitizationVerificationStatus.VERIFIED &&
        verificationResult.status != SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE ->
        SanitizationLifecycleOutcome.EXECUTED_UNVERIFIED

    else ->
        SanitizationLifecycleOutcome.EXECUTED_VERIFIED
}

/**
 * Explicit failure/block reason recorded next to the lifecycle outcome; null only when
 * [deriveSanitizationLifecycleOutcome] returned [SanitizationLifecycleOutcome.EXECUTED_VERIFIED].
 */
fun deriveSanitizationBlockReason(
    outcome: SanitizationLifecycleOutcome,
    executionResult: SanitizationExecutionResult,
): String? = when (outcome) {
    SanitizationLifecycleOutcome.BLOCKED_NOT_EXECUTED ->
        executionResult.error ?: "Sanitization execution is blocked: no validated sanitization provider exists for this device target."

    SanitizationLifecycleOutcome.SIMULATED_NOT_EXECUTED ->
        "Dry-run simulation only: no destructive sanitization was executed."

    SanitizationLifecycleOutcome.FAILED ->
        executionResult.error ?: "Sanitization execution failed."

    SanitizationLifecycleOutcome.EXECUTED_UNVERIFIED ->
        "Post-sanitization verification has not passed; sanitization success is not claimed."

    SanitizationLifecycleOutcome.EXECUTED_VERIFIED -> null
}
