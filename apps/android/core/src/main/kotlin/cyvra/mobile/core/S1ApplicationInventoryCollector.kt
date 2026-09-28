package cyvra.mobile.core

/**
 * Narrow, read-only adapter around the platform package inventory for S1 device-side
 * collection (PackageManager).
 *
 * Architecture boundary (DEVICE_EVIDENCE_ARCHITECTURE §17/§18.4):
 * - This is the ONLY seam between the pure collection logic and Android framework classes,
 *   so the collector stays unit-testable without Android mocks or heavyweight test frameworks.
 * - S1 is independent from S2: implementations must never touch AdbClient, ProcessRunner,
 *   the host protocol, or any workstation component. S1 must work with USB connected,
 *   ADB OFF, ADB unavailable, or no workstation ADB installation at all.
 *
 * Honesty rules for implementations:
 * - `null` means the evidence could not be obtained — never substitute a guess.
 * - Metadata only: package name, platform flags, enabled setting, version, UID, label.
 *   Application content (messages, photos, contacts, accounts, databases, credentials,
 *   tokens, notifications, clipboard, usage history) must never be exposed through this seam.
 */
interface PackageMetadataSource {
    /**
     * Package names visible to this application, in platform enumeration order.
     * Returns null when enumeration itself failed (no partial guesses).
     */
    fun listVisiblePackageNames(): List<String>?

    /**
     * Raw platform metadata for exactly [packageName].
     * Returns null when this package's metadata cannot be read at all; partial availability
     * inside a successful read is represented by null fields on [RawPackageMetadata].
     */
    fun readRawMetadata(packageName: String): RawPackageMetadata?

    /** Device API level at collection time; null when not established. */
    fun deviceApiLevel(): Int?
}

/**
 * Raw PackageManager facts for one package — primitives only, so no Android framework type
 * crosses into `:core`. Null fields mean "evidence unavailable", never "false".
 */
data class RawPackageMetadata(
    /** ApplicationInfo.FLAG_SYSTEM present (null = ApplicationInfo unavailable). */
    val systemFlag: Boolean?,
    /** ApplicationInfo.FLAG_UPDATED_SYSTEM_APP present (null = ApplicationInfo unavailable). */
    val updatedSystemFlag: Boolean?,
    /** Raw PackageManager.COMPONENT_ENABLED_STATE_* value; null when the query failed. */
    val rawEnabledState: Int?,
    val versionName: String?,
    /** PackageInfo.longVersionCode (API 28+ readers); null when not read at this API level. */
    val longVersionCode: Long?,
    /** Legacy PackageInfo.versionCode; null when unavailable. */
    val legacyVersionCode: Long?,
    val uid: Long?,
    /** Application label as descriptive metadata only — never used for classification. */
    val label: String?,
)

/**
 * Platform `PackageManager.COMPONENT_ENABLED_STATE_DEFAULT` (value 0).
 * Stable Android constant, mirrored here so `:core` stays free of Android imports.
 */
const val COMPONENT_ENABLED_STATE_DEFAULT = 0

/** Platform `PackageManager.COMPONENT_ENABLED_STATE_ENABLED` (value 1). */
const val COMPONENT_ENABLED_STATE_ENABLED = 1

/** Platform `PackageManager.COMPONENT_ENABLED_STATE_DISABLED` (value 2). */
const val COMPONENT_ENABLED_STATE_DISABLED = 2

/**
 * Maps the raw `PackageManager.getApplicationEnabledSetting()` result to
 * [ApplicationEnabledState], following only the approved checkpoint mapping:
 *
 * ```
 * COMPONENT_ENABLED_STATE_DEFAULT  -> DEFAULT
 * COMPONENT_ENABLED_STATE_ENABLED  -> ENABLED
 * COMPONENT_ENABLED_STATE_DISABLED -> DISABLED
 * anything else / null / failed    -> UNKNOWN
 * ```
 *
 * Enabled state is an independent dimension from classification. Exceptions, failed
 * queries, and unmapped platform values (for example DISABLED_USER or
 * DISABLED_UNTIL_USED, which the approved mapping does not enumerate) resolve to
 * UNKNOWN — never to ENABLED or DISABLED. Package existence is never used to infer
 * an enabled state.
 */
fun deriveEnabledState(rawEnabledState: Int?): ApplicationEnabledState = when (rawEnabledState) {
    COMPONENT_ENABLED_STATE_DEFAULT -> ApplicationEnabledState.DEFAULT
    COMPONENT_ENABLED_STATE_ENABLED -> ApplicationEnabledState.ENABLED
    COMPONENT_ENABLED_STATE_DISABLED -> ApplicationEnabledState.DISABLED
    else -> ApplicationEnabledState.UNKNOWN
}

/**
 * Strongest available version representation for [apiLevel]:
 * API 28+ prefers `longVersionCode` (falling back to the legacy value only when the
 * platform read did not produce one); API < 28 or unknown API level uses the legacy
 * `versionCode`. Both-absent yields null — version values are never fabricated.
 */
fun resolveVersionCode(
    apiLevel: Int?,
    longVersionCode: Long?,
    legacyVersionCode: Long?,
): Long? = if (apiLevel != null && apiLevel >= 28) {
    longVersionCode ?: legacyVersionCode
} else {
    legacyVersionCode ?: longVersionCode
}

/**
 * S1 device-side installed-application inventory collector (PackageManager).
 *
 * Produces [ApplicationInventoryEvidence] from the platform's own view of installed
 * packages, without ADB, without the host, and without any package-visibility widening
 * (no `<queries>`, no `QUERY_ALL_PACKAGES`).
 *
 * Contract decisions encoded here:
 * - **Classification** comes exclusively from raw ApplicationInfo system flags via the
 *   approved pure functions [deriveClassification] / [deriveClassificationStatus].
 *   Package names, labels, APK paths, code paths, folder locations, installer names,
 *   and OEM strings are never consulted: `com.samsung.*` does not become SYSTEM because
 *   of its name, and `/data/app` does not become third-party when the flags say
 *   UPDATED_SYSTEM.
 * - **Enabled state** comes from the platform enabled-setting via [deriveEnabledState],
 *   independent of classification.
 * - **Completeness** is [ApplicationEnumerationCompleteness.FILTERED] whenever
 *   enumeration succeeds: the APK declares no package-visibility allowlist, so on
 *   Android 11+ the platform filters results to packages visible to this application,
 *   and this collector holds no cross-check that could establish full-set completeness
 *   for the enumeration or for additional Android users/work profiles. A result whose
 *   completeness cannot be established is never reported as COMPLETE. Enumeration
 *   failure or an empty result is [ApplicationEnumerationCompleteness.UNAVAILABLE] and
 *   carries no fabricated records.
 * - **Self-package**: the CYVRA application's own package is retained as normal
 *   PackageManager evidence; no name-based inclusion/exclusion filtering is applied.
 * - **Content boundary**: metadata only (§37) — this collector can never carry messages,
 *   photos, contacts, accounts, databases, credentials, tokens, notification content,
 *   clipboard data, or usage history.
 * - **Fail-closed**: one unreadable package degrades only that record to null fields and
 *   UNKNOWN; an adapter exception never becomes successful evidence and never crashes
 *   the caller (§17: independent collectors).
 *
 * Not wired into orchestration, report generation, or the receiver in this checkpoint —
 * collector + tests only.
 */
class S1ApplicationInventoryCollector(
    private val source: PackageMetadataSource,
    private val collectedAt: String = java.time.Instant.now().toString(),
) {

    /**
     * Collects the installed-application inventory for the user/profile scope visible to
     * this application. Never throws.
     */
    fun collect(): ApplicationInventoryEvidence {
        val limitations = mutableListOf(SCOPE_LIMITATION)

        val apiLevel = try {
            source.deviceApiLevel()
        } catch (e: Exception) {
            null
        }
        if (apiLevel == null) {
            limitations += API_LEVEL_LIMITATION
        }

        val visibleNames = try {
            source.listVisiblePackageNames()
        } catch (e: Exception) {
            null
        }

        if (visibleNames == null) {
            limitations += ENUMERATION_FAILURE_LIMITATION
            return evidence(
                completeness = ApplicationEnumerationCompleteness.UNAVAILABLE,
                applications = emptyList(),
                apiLevel = apiLevel,
                limitations = limitations,
            )
        }

        val uniqueNames = visibleNames.filter { it.isNotBlank() }.distinct()
        if (uniqueNames.isEmpty()) {
            limitations += EMPTY_ENUMERATION_LIMITATION
            return evidence(
                completeness = ApplicationEnumerationCompleteness.UNAVAILABLE,
                applications = emptyList(),
                apiLevel = apiLevel,
                limitations = limitations,
            )
        }

        limitations += VISIBILITY_LIMITATION
        val applications = uniqueNames.map { packageName -> recordFor(packageName, apiLevel) }

        return evidence(
            completeness = ApplicationEnumerationCompleteness.FILTERED,
            applications = applications,
            apiLevel = apiLevel,
            limitations = limitations,
        )
    }

    /**
     * Builds one record. A package whose metadata cannot be read (missing or throwing)
     * keeps its package name with null metadata, UNKNOWN classification, and
     * EVIDENCE_UNAVAILABLE provenance — it never destroys the rest of the enumeration.
     */
    private fun recordFor(packageName: String, apiLevel: Int?): ApplicationInventoryRecord {
        val raw = try {
            source.readRawMetadata(packageName)
        } catch (e: Exception) {
            null
        }

        val systemFlag = raw?.systemFlag
        val updatedSystemFlag = raw?.updatedSystemFlag

        return ApplicationInventoryRecord(
            packageName = packageName,
            classification = deriveClassification(systemFlag, updatedSystemFlag),
            classificationStatus = deriveClassificationStatus(systemFlag, updatedSystemFlag),
            evidenceSource = EVIDENCE_SOURCE,
            collectionMethod = COLLECTION_METHOD,
            collectedAt = collectedAt,
            label = raw?.label,
            versionName = raw?.versionName,
            versionCode = raw?.let { resolveVersionCode(apiLevel, it.longVersionCode, it.legacyVersionCode) },
            uid = raw?.uid,
            systemFlag = systemFlag,
            updatedSystemFlag = updatedSystemFlag,
            enabledState = deriveEnabledState(raw?.rawEnabledState),
            apiLevel = apiLevel,
        )
    }

    private fun evidence(
        completeness: ApplicationEnumerationCompleteness,
        applications: List<ApplicationInventoryRecord>,
        apiLevel: Int?,
        limitations: List<String>,
    ) = ApplicationInventoryEvidence(
        collectedAt = collectedAt,
        evidenceSource = EVIDENCE_SOURCE,
        collectionMethod = COLLECTION_METHOD,
        enumerationCompleteness = completeness,
        apiLevel = apiLevel,
        applications = applications,
        limitations = limitations,
    )

    companion object {
        /** Evidence V2 source vocabulary (DEVICE_EVIDENCE_ARCHITECTURE §5): on-device application evidence. */
        const val EVIDENCE_SOURCE = "ANDROID_COMPONENT"

        /** Stable method identifier (DEVICE_EVIDENCE_ARCHITECTURE §41). */
        const val COLLECTION_METHOD = "ANDROID_PACKAGE_MANAGER"

        internal const val SCOPE_LIMITATION =
            "PackageManager inventory represents the Android user/profile scope visible to " +
                "this application; additional users or work profiles are not independently enumerated."

        internal const val VISIBILITY_LIMITATION =
            "PackageManager enumeration is subject to Android package visibility; " +
                "packages not visible to this application are not enumerated."

        internal const val ENUMERATION_FAILURE_LIMITATION =
            "PackageManager enumeration failed; inventory recorded as UNAVAILABLE."

        internal const val EMPTY_ENUMERATION_LIMITATION =
            "PackageManager enumeration returned no packages; inventory recorded as UNAVAILABLE."

        internal const val API_LEVEL_LIMITATION =
            "Device API level could not be established."
    }
}
