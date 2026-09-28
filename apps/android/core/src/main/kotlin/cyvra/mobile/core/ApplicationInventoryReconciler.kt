package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Provenance of one reconciled package record: which evidence source(s) contain it.
 *
 * S1 = on-device component collection (source `ANDROID_COMPONENT`);
 * S2 = authorized host-side collection (source `ANDROID_ADB`).
 *
 * Provenance is structural: it is derived from which source records exist on the
 * reconciled record, never encoded into arbitrary strings, so S1-only, S2-only, and
 * both-source records stay distinguishable during an audit.
 */
@Serializable
enum class ApplicationInventoryProvenance {
    /** The package appears only in the S1 (device-side) enumeration. */
    S1_ONLY,

    /** The package appears only in the S2 (authorized host-side) enumeration. */
    S2_ONLY,

    /** The package appears in both enumerations. */
    BOTH,
}

/**
 * One field-level disagreement between the S1 and S2 records of a single package.
 *
 * Conflicts are never resolved silently: the reconciled record carries the fail-closed
 * canonical value for the field, and this entry preserves both observed values verbatim,
 * so the disagreement stays visible and auditable instead of hiding a chosen winner.
 */
@Serializable
sealed interface ApplicationInventoryConflict {
    /** Package whose field disagreed; also the stable ordering key of the conflict list. */
    val packageName: String

    /** The two sources derived different non-UNKNOWN classifications for the package. */
    @Serializable
    data class Classification(
        override val packageName: String,
        val s1Value: ApplicationClassification,
        val s2Value: ApplicationClassification,
    ) : ApplicationInventoryConflict

    /** Both sources observed the raw system flag but disagreed on its value. */
    @Serializable
    data class SystemFlag(
        override val packageName: String,
        val s1Value: Boolean,
        val s2Value: Boolean,
    ) : ApplicationInventoryConflict

    /** Both sources observed the raw updated-system flag but disagreed on its value. */
    @Serializable
    data class UpdatedSystemFlag(
        override val packageName: String,
        val s1Value: Boolean,
        val s2Value: Boolean,
    ) : ApplicationInventoryConflict

    /** Both sources established a known enabled state and the states disagree. */
    @Serializable
    data class EnabledState(
        override val packageName: String,
        val s1Value: ApplicationEnabledState,
        val s2Value: ApplicationEnabledState,
    ) : ApplicationInventoryConflict

    /** Both sources observed a version code and the values disagree. */
    @Serializable
    data class VersionCode(
        override val packageName: String,
        val s1Value: Long,
        val s2Value: Long,
    ) : ApplicationInventoryConflict

    /** Both sources observed a version name and the values disagree. */
    @Serializable
    data class VersionName(
        override val packageName: String,
        val s1Value: String,
        val s2Value: String,
    ) : ApplicationInventoryConflict

    /** Both sources observed a UID and the values disagree. */
    @Serializable
    data class Uid(
        override val packageName: String,
        val s1Value: Long,
        val s2Value: Long,
    ) : ApplicationInventoryConflict
}

/**
 * Canonical, fail-closed record for one package after reconciling S1 and S2 evidence.
 *
 * - Identity is [packageName] only; label, UID, version, and paths are descriptive
 *   metadata and never part of identity.
 * - [s1Record] / [s2Record] embed the original source records verbatim (when present),
 *   so full per-source provenance — source vocabulary, method, timestamp, raw fields —
 *   is preserved without widening the source contract.
 * - Canonical field values never invent evidence: a disagreeing nullable field becomes
 *   null (both observed values live in the matching [ApplicationInventoryConflict]),
 *   an unreadable dimension stays UNKNOWN, and null is never converted to false.
 * - [label] is descriptive only: sources may legitimately differ (locale, profile,
 *   availability), a difference never affects identity or classification, and the
 *   deterministic preference is the S1 value when present, else the S2 value. Both
 *   original labels remain visible on the embedded source records.
 *
 * Deliberately not carried from the sources: collection timestamps and API level.
 * The reconciler generates no timestamps, and those fields remain readable on each
 * embedded source record.
 */
@Serializable
data class ReconciledApplicationRecord(
    val packageName: String,
    val provenance: ApplicationInventoryProvenance,
    val classification: ApplicationClassification,
    val classificationStatus: ApplicationClassificationStatus,
    /** Reconciled raw system flag; null = evidence unavailable or conflicting, never false. */
    val systemFlag: Boolean?,
    /** Reconciled raw updated-system flag; null = evidence unavailable or conflicting, never false. */
    val updatedSystemFlag: Boolean?,
    val enabledState: ApplicationEnabledState,
    val versionCode: Long?,
    val versionName: String?,
    val uid: Long?,
    val label: String?,
    val s1Record: ApplicationInventoryRecord? = null,
    val s2Record: ApplicationInventoryRecord? = null,
)

/**
 * Deterministic reconciliation result over the S1 and S2 application inventories.
 *
 * Completeness semantics (never fabricated, never upgraded):
 * - [enumerationCompleteness] is the safest aggregate. A source that reports UNAVAILABLE
 *   contributes no enumeration and is never treated as an empty-but-valid inventory. When
 *   exactly one source enumerated, its own completeness is preserved as the aggregate
 *   (that source's scope is all the evidence establishes). When both sources enumerated,
 *   the aggregate is FILTERED: their user/visibility scopes are independent and are not
 *   established as comparable, so a cross-source union never claims COMPLETE.
 * - [s1Completeness] / [s2Completeness] keep each source's original completeness
 *   separately (null = that source was not provided), so the aggregate can never hide
 *   what either source actually established.
 * - Records from an UNAVAILABLE source are never fabricated: UNAVAILABLE sources carry
 *   no records to merge.
 *
 * Limitations: [limitations] merges both sources' limitation strings verbatim — S1 order
 * first, then S2 order, duplicates collapsed to first occurrence. No limitation is
 * manufactured by the reconciler, and none is dropped because the other source knows more.
 *
 * Conflicts: [conflicts] is ordered by package name (record order) and, within a package,
 * by a fixed field order (classification, system flag, updated-system flag, enabled state,
 * version code, version name, UID), so identical inputs always produce identical output.
 */
@Serializable
data class ReconciledApplicationInventory(
    val enumerationCompleteness: ApplicationEnumerationCompleteness,
    val s1Completeness: ApplicationEnumerationCompleteness?,
    val s2Completeness: ApplicationEnumerationCompleteness?,
    val records: List<ReconciledApplicationRecord> = emptyList(),
    val conflicts: List<ApplicationInventoryConflict> = emptyList(),
    val limitations: List<String> = emptyList(),
    val schemaVersion: String = SCHEMA_VERSION,
)

/**
 * Deterministic, side-effect-free reconciliation of independently collected S1 (device-side)
 * and S2 (authorized host-side) application inventories into one canonical evidence result.
 *
 * Boundary rules (pure core logic):
 * - Accepts already-collected [ApplicationInventoryEvidence] only. It never runs device
 *   queries, host commands, or shell processes, and it references no platform framework,
 *   transport, orchestration, report, or UI component.
 * - Inputs are never mutated; the same two inputs always produce the same output
 *   (package order, conflict order, and limitation order are all fixed).
 * - No timestamps, random IDs, or environment-dependent values are generated.
 *
 * Reconciliation rules:
 * - Identity: [ApplicationInventoryRecord.packageName] only. Records are deduplicated per
 *   source (first occurrence wins, matching the established enumeration semantics) and
 *   merged across sources by package name. A package in neither source is never fabricated.
 * - Classification: agreement is preserved; a known value plus UNKNOWN preserves the known
 *   value; two different non-UNKNOWN values never pick a winner — the canonical value becomes
 *   UNKNOWN with [ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS] and a
 *   [ApplicationInventoryConflict.Classification] entry preserves both observed values.
 *   Whenever both reconciled raw flags are established and nothing conflicts, classification
 *   is re-derived through the approved pure functions [deriveClassification] /
 *   [deriveClassificationStatus] so the rules are never duplicated here.
 * - Raw flags: both agree → the value; one unavailable → the available value (never
 *   null→false); both available but conflicting → null plus a conflict entry.
 * - Enabled state: same known state → preserved; one UNKNOWN → the known state; two
 *   different known states → UNKNOWN plus a conflict entry (the disagreement is recorded,
 *   never silently converted).
 * - Version and UID: same rules as raw flags — agreement preserved, single-side value
 *   preserved, conflict → null plus a conflict entry (no source is authoritative).
 * - Label: never an identity or classification conflict; deterministic S1-then-S2 preference.
 * - Fail-closed: when a conflict cannot be represented by a canonical value, the safest
 *   representable value is used and the conflict is preserved explicitly. Nothing here
 *   chooses "S1 always wins" or "S2 always wins".
 */
object ApplicationInventoryReconciler {

    /**
     * Reconciles the S1 and S2 inventories. Either input may be null (source not collected);
     * null is not the same as an empty or UNAVAILABLE inventory. Never throws for any
     * combination of inputs and never mutates them.
     */
    fun reconcile(
        s1: ApplicationInventoryEvidence?,
        s2: ApplicationInventoryEvidence?,
    ): ReconciledApplicationInventory {
        val s1ByPackage = indexByPackage(s1)
        val s2ByPackage = indexByPackage(s2)

        // Deterministic ordering: natural package-name order across the union of both sources.
        val packageNames = (s1ByPackage.keys + s2ByPackage.keys).sorted()

        val reconciled = packageNames.map { packageName ->
            reconcileRecord(
                packageName = packageName,
                s1 = s1ByPackage[packageName],
                s2 = s2ByPackage[packageName],
            )
        }

        return ReconciledApplicationInventory(
            enumerationCompleteness = aggregateCompleteness(s1, s2),
            s1Completeness = s1?.enumerationCompleteness,
            s2Completeness = s2?.enumerationCompleteness,
            records = reconciled.map { it.first },
            conflicts = reconciled.flatMap { it.second },
            limitations = mergedLimitations(s1, s2),
        )
    }

    /** Indexes one source's records by package name; the first occurrence of a duplicated
     *  package name wins, matching the established enumeration de-duplication semantics. */
    private fun indexByPackage(
        evidence: ApplicationInventoryEvidence?,
    ): Map<String, ApplicationInventoryRecord> {
        if (evidence == null) return emptyMap()
        val byPackage = LinkedHashMap<String, ApplicationInventoryRecord>(evidence.applications.size)
        for (record in evidence.applications) {
            byPackage.putIfAbsent(record.packageName, record)
        }
        return byPackage
    }

    /** Reconciles one package present in at least one source. Conflicts come back in the
     *  fixed field order defined for the result. */
    private fun reconcileRecord(
        packageName: String,
        s1: ApplicationInventoryRecord?,
        s2: ApplicationInventoryRecord?,
    ): Pair<ReconciledApplicationRecord, List<ApplicationInventoryConflict>> {
        val s1Enabled = s1?.enabledState
        val s2Enabled = s2?.enabledState

        // Nullable fields: agreement preserved, single-side value preserved, conflict → null.
        val (systemFlag, systemFlagConflict) = reconcileField(s1?.systemFlag, s2?.systemFlag) { first, second ->
            ApplicationInventoryConflict.SystemFlag(packageName, first, second)
        }
        val (updatedSystemFlag, updatedSystemFlagConflict) =
            reconcileField(s1?.updatedSystemFlag, s2?.updatedSystemFlag) { first, second ->
                ApplicationInventoryConflict.UpdatedSystemFlag(packageName, first, second)
            }
        val (versionCode, versionCodeConflict) = reconcileField(s1?.versionCode, s2?.versionCode) { first, second ->
            ApplicationInventoryConflict.VersionCode(packageName, first, second)
        }
        val (versionName, versionNameConflict) = reconcileField(s1?.versionName, s2?.versionName) { first, second ->
            ApplicationInventoryConflict.VersionName(packageName, first, second)
        }
        val (uid, uidConflict) = reconcileField(s1?.uid, s2?.uid) { first, second ->
            ApplicationInventoryConflict.Uid(packageName, first, second)
        }

        // Two different non-UNKNOWN classifications: no winner is chosen, the conflict is kept.
        val s1Classification = s1?.classification
        val s2Classification = s2?.classification
        val classificationConflict =
            if (s1Classification != null &&
                s2Classification != null &&
                s1Classification != ApplicationClassification.UNKNOWN &&
                s2Classification != ApplicationClassification.UNKNOWN &&
                s1Classification != s2Classification
            ) {
                ApplicationInventoryConflict.Classification(packageName, s1Classification, s2Classification)
            } else {
                null
            }

        // Two different known enabled states: canonical value becomes UNKNOWN, conflict kept.
        val enabledConflict =
            if (s1Enabled != null &&
                s2Enabled != null &&
                s1Enabled != ApplicationEnabledState.UNKNOWN &&
                s2Enabled != ApplicationEnabledState.UNKNOWN &&
                s1Enabled != s2Enabled
            ) {
                ApplicationInventoryConflict.EnabledState(packageName, s1Enabled, s2Enabled)
            } else {
                null
            }

        val (classification, classificationStatus) = canonicalClassification(
            s1 = s1,
            s2 = s2,
            systemFlag = systemFlag,
            updatedSystemFlag = updatedSystemFlag,
            conflictOccurred = classificationConflict != null ||
                systemFlagConflict != null ||
                updatedSystemFlagConflict != null,
        )

        val enabledState = when {
            enabledConflict != null -> ApplicationEnabledState.UNKNOWN
            s1Enabled != null && s2Enabled != null -> if (s1Enabled != ApplicationEnabledState.UNKNOWN) {
                s1Enabled
            } else {
                s2Enabled
            }
            s1Enabled != null -> s1Enabled
            else -> s2Enabled ?: ApplicationEnabledState.UNKNOWN
        }

        val conflicts = listOfNotNull(
            classificationConflict,
            systemFlagConflict,
            updatedSystemFlagConflict,
            enabledConflict,
            versionCodeConflict,
            versionNameConflict,
            uidConflict,
        )

        val provenance = when {
            s1 != null && s2 != null -> ApplicationInventoryProvenance.BOTH
            s1 != null -> ApplicationInventoryProvenance.S1_ONLY
            else -> ApplicationInventoryProvenance.S2_ONLY
        }

        return ReconciledApplicationRecord(
            packageName = packageName,
            provenance = provenance,
            classification = classification,
            classificationStatus = classificationStatus,
            systemFlag = systemFlag,
            updatedSystemFlag = updatedSystemFlag,
            enabledState = enabledState,
            versionCode = versionCode,
            versionName = versionName,
            uid = uid,
            label = s1?.label ?: s2?.label,
            s1Record = s1,
            s2Record = s2,
        ) to conflicts
    }

    /**
     * Fail-closed canonical classification for one package.
     *
     * Order: (1) any classification or raw-flag conflict → UNKNOWN + UNRESOLVED_AMBIGUOUS;
     * (2) both reconciled flags established → re-derived via the approved pure functions;
     * (3) single source → that source's own classification verbatim; (4) both sources with
     * incomplete flags → preserve the known side, else UNKNOWN with the safest status
     * (ambiguity is never masked by a milder status).
     */
    private fun canonicalClassification(
        s1: ApplicationInventoryRecord?,
        s2: ApplicationInventoryRecord?,
        systemFlag: Boolean?,
        updatedSystemFlag: Boolean?,
        conflictOccurred: Boolean,
    ): Pair<ApplicationClassification, ApplicationClassificationStatus> = when {
        conflictOccurred ->
            ApplicationClassification.UNKNOWN to ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS

        systemFlag != null && updatedSystemFlag != null ->
            deriveClassification(systemFlag, updatedSystemFlag) to
                deriveClassificationStatus(systemFlag, updatedSystemFlag)

        s1 == null && s2 != null -> s2.classification to s2.classificationStatus
        s2 == null && s1 != null -> s1.classification to s1.classificationStatus

        s1 != null && s2 != null -> selectKnownClassification(s1, s2)

        // Neither source record exists (unreachable through the package union); stay fail-closed.
        else -> ApplicationClassification.UNKNOWN to ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE
    }

    /**
     * Selects between two source classifications when their raw flags are incomplete and
     * no conflict occurred: a known value survives an UNKNOWN counterpart; two UNKNOWNs
     * stay UNKNOWN with the safest status of the two.
     */
    private fun selectKnownClassification(
        s1: ApplicationInventoryRecord,
        s2: ApplicationInventoryRecord,
    ): Pair<ApplicationClassification, ApplicationClassificationStatus> {
        val s1Classification = s1.classification
        val s2Classification = s2.classification
        return when {
            s1Classification != ApplicationClassification.UNKNOWN && s1Classification == s2Classification ->
                s1Classification to safestStatus(s1.classificationStatus, s2.classificationStatus)

            s1Classification != ApplicationClassification.UNKNOWN ->
                s1Classification to s1.classificationStatus

            s2Classification != ApplicationClassification.UNKNOWN ->
                s2Classification to s2.classificationStatus

            else ->
                ApplicationClassification.UNKNOWN to safestStatus(s1.classificationStatus, s2.classificationStatus)
        }
    }

    /** Fail-closed status precedence: observed ambiguity > evidence unavailable > direct. */
    private fun safestStatus(
        first: ApplicationClassificationStatus,
        second: ApplicationClassificationStatus,
    ): ApplicationClassificationStatus = when {
        first == ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS ||
            second == ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS ->
            ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS

        first == ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE ||
            second == ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE ->
            ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE

        else -> ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS
    }

    /**
     * Reconciles one nullable field: agreement preserves the value, one unavailable side
     * preserves the available value, two different available values yield null plus a
     * conflict entry (null is never converted to false or any other invented value).
     */
    private fun <T> reconcileField(
        first: T?,
        second: T?,
        conflict: (T, T) -> ApplicationInventoryConflict,
    ): Pair<T?, ApplicationInventoryConflict?> = when {
        first == null -> second to null
        second == null -> first to null
        first == second -> first to null
        else -> null to conflict(first, second)
    }

    /**
     * Safest aggregate completeness. UNAVAILABLE sources contribute no enumeration and are
     * never treated as empty inventories; a sole enumerating source keeps its own scope; two
     * independently scoped enumerations never upgrade to COMPLETE.
     */
    private fun aggregateCompleteness(
        s1: ApplicationInventoryEvidence?,
        s2: ApplicationInventoryEvidence?,
    ): ApplicationEnumerationCompleteness {
        if (s1 == null && s2 == null) return ApplicationEnumerationCompleteness.UNAVAILABLE

        val contributing = listOfNotNull(s1, s2)
            .map { it.enumerationCompleteness }
            .filter { it != ApplicationEnumerationCompleteness.UNAVAILABLE }

        return when {
            contributing.isEmpty() -> ApplicationEnumerationCompleteness.UNAVAILABLE
            contributing.size == 1 -> contributing.first()
            else -> ApplicationEnumerationCompleteness.FILTERED
        }
    }

    /** Merges both sources' limitation strings verbatim: S1 order first, then S2 order,
     *  duplicates collapsed to their first occurrence, nothing added or removed. */
    private fun mergedLimitations(
        s1: ApplicationInventoryEvidence?,
        s2: ApplicationInventoryEvidence?,
    ): List<String> {
        val merged = LinkedHashSet<String>()
        s1?.limitations?.forEach { merged.add(it) }
        s2?.limitations?.forEach { merged.add(it) }
        return merged.toList()
    }
}
