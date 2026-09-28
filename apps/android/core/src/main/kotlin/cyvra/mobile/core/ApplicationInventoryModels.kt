package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Installed-application classification (approved classification model).
 *
 * Derived ONLY from the raw platform system flags preserved on
 * [ApplicationInventoryRecord.systemFlag] / [ApplicationInventoryRecord.updatedSystemFlag],
 * so classification stays auditable. Never derived from package-name prefixes, OEM names,
 * folder paths, APK paths alone, or installer names alone.
 *
 * UNKNOWN is an honest outcome per DEVICE_EVIDENCE_ARCHITECTURE §1:
 * unavailable is not failure; unknown is not false.
 */
@Serializable
enum class ApplicationClassification {
    /** [ApplicationInfo.FLAG_SYSTEM] present, [ApplicationInfo.FLAG_UPDATED_SYSTEM_APP] absent. */
    PREINSTALLED_SYSTEM,

    /** FLAG_SYSTEM and FLAG_UPDATED_SYSTEM_APP both present (system app updated after provisioning). */
    UPDATED_SYSTEM,

    /** Neither system flag present (installed after device provisioning). */
    USER_THIRD_PARTY,

    /** Required flag evidence is unavailable, ambiguous, or otherwise insufficient. */
    UNKNOWN,
}

/**
 * How the classification was established (provenance).
 * An inferred or unresolved classification must never be represented as
 * [DIRECT_PLATFORM_FLAGS].
 */
@Serializable
enum class ApplicationClassificationStatus {
    /** Raw platform system flags were observed directly and are unambiguous. */
    DIRECT_PLATFORM_FLAGS,

    /** Required classification evidence could not be obtained (filtered, restricted, or query failure). */
    EVIDENCE_UNAVAILABLE,

    /** Evidence exists but is contradictory or otherwise insufficient to resolve. */
    UNRESOLVED_AMBIGUOUS,
}

/**
 * Honesty dimension for one enumeration run. A filtered PackageManager result must never
 * silently become [COMPLETE]; [UNAVAILABLE] is not failure and carries no fabricated records.
 */
@Serializable
enum class ApplicationEnumerationCompleteness {
    /** The enumeration represents the full installed-package set visible to its source. */
    COMPLETE,

    /** Platform package-visibility filtering truncated the result. */
    FILTERED,

    /** No enumeration could be obtained. */
    UNAVAILABLE,
}

/** Enabled state of an installed application (platform enabled-setting semantics). */
@Serializable
enum class ApplicationEnabledState {
    /** Explicitly enabled. */
    ENABLED,

    /** Explicitly disabled (including user-disabled). */
    DISABLED,

    /** Resolved from the application manifest default (not explicitly enabled/disabled). */
    DEFAULT,

    /** Enabled state could not be determined. */
    UNKNOWN,
}

/**
 * Pure derivation from raw platform system flags to [ApplicationClassification].
 *
 * Both flags are required for any non-UNKNOWN outcome; contradictory flags
 * (`systemFlag = false` with `updatedSystemFlag = true`) resolve to UNKNOWN.
 * No package-name, OEM, path, or installer heuristics are used.
 */
fun deriveClassification(
    systemFlag: Boolean?,
    updatedSystemFlag: Boolean?,
): ApplicationClassification = when {
    systemFlag == null || updatedSystemFlag == null -> ApplicationClassification.UNKNOWN
    systemFlag && updatedSystemFlag -> ApplicationClassification.UPDATED_SYSTEM
    systemFlag && !updatedSystemFlag -> ApplicationClassification.PREINSTALLED_SYSTEM
    !systemFlag && !updatedSystemFlag -> ApplicationClassification.USER_THIRD_PARTY
    else -> ApplicationClassification.UNKNOWN
}

/**
 * Provenance of [deriveClassification], guaranteed by construction:
 * missing evidence yields [ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE],
 * contradictory evidence yields [ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS],
 * and only directly observed unambiguous flags yield
 * [ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS].
 */
fun deriveClassificationStatus(
    systemFlag: Boolean?,
    updatedSystemFlag: Boolean?,
): ApplicationClassificationStatus = when {
    systemFlag == null || updatedSystemFlag == null -> ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE
    systemFlag || systemFlag == updatedSystemFlag -> ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS
    else -> ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS
}

/**
 * Metadata record for ONE installed application.
 *
 * Application metadata only — never application content. This model must never carry
 * messages, photos, contacts, accounts, application databases, credentials, tokens,
 * notification content, clipboard data, or usage/behavior history (§37 privacy boundary).
 *
 * Required provenance fields follow the §8 evidence-identity rule (source, method,
 * collectedAt, schemaVersion bound to the record); optional device metadata stays
 * nullable so absent evidence is represented as absent, never guessed.
 */
@Serializable
data class ApplicationInventoryRecord(
    val packageName: String,
    val classification: ApplicationClassification,
    val classificationStatus: ApplicationClassificationStatus,
    val evidenceSource: String,
    val collectionMethod: String,
    val collectedAt: String,
    val schemaVersion: String = SCHEMA_VERSION,
    val label: String? = null,
    val versionName: String? = null,
    /** longVersionCode (API 28+) or widened versionCode on older API levels; null when unavailable. */
    val versionCode: Long? = null,
    /** Application UID where legitimately established by the evidence source; null when unavailable. */
    val uid: Long? = null,
    /** Raw ApplicationInfo.FLAG_SYSTEM; null = evidence unavailable, never silently false. */
    val systemFlag: Boolean? = null,
    /** Raw ApplicationInfo.FLAG_UPDATED_SYSTEM_APP; null = evidence unavailable, never silently false. */
    val updatedSystemFlag: Boolean? = null,
    val enabledState: ApplicationEnabledState = ApplicationEnabledState.UNKNOWN,
    /** Device API level at collection time; null when not established. */
    val apiLevel: Int? = null,
)

/**
 * Application-inventory evidence record for one enumeration run.
 *
 * Additive and backward-compatible: [GenericDeviceEvidence] carries this as a default-null
 * field, so existing evidence serialization and every current producer remain unchanged
 * until a dedicated collector populates it.
 *
 * [enumerationCompleteness] carries the honesty dimension: a filtered result must never
 * silently become COMPLETE, and UNAVAILABLE is a valid outcome that carries no fabricated
 * records (§17: one missing collector is a limitation, not a scan failure).
 *
 * Domain note: an application-inventory evidence domain/testId is intentionally NOT added
 * to the frozen V1 vocabulary (`REPORT_DOMAINS`, `s1-catalog.v1.json`, test IDs) here.
 * That expansion belongs to the future Evidence V2 schema freeze (REQ-EVD-003) and must
 * not widen V1 in place (DEVICE_EVIDENCE_ARCHITECTURE §49).
 */
@Serializable
data class ApplicationInventoryEvidence(
    val collectedAt: String,
    val evidenceSource: String,
    val collectionMethod: String,
    val enumerationCompleteness: ApplicationEnumerationCompleteness,
    val schemaVersion: String = SCHEMA_VERSION,
    val apiLevel: Int? = null,
    val applications: List<ApplicationInventoryRecord> = emptyList(),
    val limitations: List<String> = emptyList(),
)
