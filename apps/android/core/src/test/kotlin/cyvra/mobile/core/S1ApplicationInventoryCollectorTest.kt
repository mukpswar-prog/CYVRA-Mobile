package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Unit tests for the S1 device-side PackageManager application-inventory collector.
 *
 * The collector is exercised through the narrow [PackageMetadataSource] seam with a
 * deterministic fake, following the project's existing abstraction/test style — no
 * Android framework mocks, no new test dependencies, no hardware, no ADB.
 */
class S1ApplicationInventoryCollectorTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }
    private val collectedAt = "2026-09-28T10:00:00Z"

    private class FakePackageMetadataSource(
        private val names: List<String>? = emptyList(),
        private val throwOnEnumerate: Boolean = false,
        private val metadataByPackage: Map<String, RawPackageMetadata> = emptyMap(),
        private val throwOnMetadataFor: Set<String> = emptySet(),
        private val apiLevel: Int? = 30,
        private val throwOnApiLevel: Boolean = false,
    ) : PackageMetadataSource {
        override fun listVisiblePackageNames(): List<String>? {
            if (throwOnEnumerate) throw IllegalStateException("package manager unavailable")
            return names
        }

        override fun readRawMetadata(packageName: String): RawPackageMetadata? {
            if (packageName in throwOnMetadataFor) {
                throw IllegalStateException("unreadable package metadata: $packageName")
            }
            return metadataByPackage[packageName]
        }

        override fun deviceApiLevel(): Int? {
            if (throwOnApiLevel) throw IllegalStateException("api level unavailable")
            return apiLevel
        }
    }

    private fun raw(
        systemFlag: Boolean? = false,
        updatedSystemFlag: Boolean? = false,
        rawEnabledState: Int? = COMPONENT_ENABLED_STATE_ENABLED,
        versionName: String? = "1.0.0",
        longVersionCode: Long? = null,
        legacyVersionCode: Long? = 100L,
        uid: Long? = 10089L,
        label: String? = "Example App",
    ) = RawPackageMetadata(
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        rawEnabledState = rawEnabledState,
        versionName = versionName,
        longVersionCode = longVersionCode,
        legacyVersionCode = legacyVersionCode,
        uid = uid,
        label = label,
    )

    private fun collect(
        names: List<String>?,
        metadata: Map<String, RawPackageMetadata> = emptyMap(),
        throwOnMetadataFor: Set<String> = emptySet(),
        apiLevel: Int? = 30,
        throwOnEnumerate: Boolean = false,
    ): ApplicationInventoryEvidence = S1ApplicationInventoryCollector(
        source = FakePackageMetadataSource(
            names = names,
            throwOnEnumerate = throwOnEnumerate,
            metadataByPackage = metadata,
            throwOnMetadataFor = throwOnMetadataFor,
            apiLevel = apiLevel,
        ),
        collectedAt = collectedAt,
    ).collect()

    // ---- 1. System application classification ------------------------------------

    @Test
    fun systemApplicationClassificationFromPlatformFlags() {
        val evidence = collect(
            names = listOf("com.android.settings"),
            metadata = mapOf("com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false)),
        )

        val record = evidence.applications.single()
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
    }

    // ---- 2. Third-party application classification -------------------------------

    @Test
    fun thirdPartyApplicationClassificationFromPlatformFlags() {
        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw(systemFlag = false, updatedSystemFlag = false)),
        )

        val record = evidence.applications.single()
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
    }

    // ---- 3. Updated system application classification ----------------------------

    @Test
    fun updatedSystemApplicationClassificationFromPlatformFlags() {
        val evidence = collect(
            names = listOf("com.vendor.camera"),
            metadata = mapOf(
                "com.vendor.camera" to raw(systemFlag = true, updatedSystemFlag = true),
            ),
        )

        val record = evidence.applications.single()
        assertEquals(ApplicationClassification.UPDATED_SYSTEM, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
        assertEquals(true, record.systemFlag)
        assertEquals(true, record.updatedSystemFlag)
    }

    // ---- 4. Neutral package name cannot affect classification --------------------

    @Test
    fun neutralPackageNameCannotAffectClassification() {
        val evidence = collect(
            names = listOf("org.example.notes", "org.opensource.tool"),
            metadata = mapOf(
                // Neutral name carrying system flags must stay SYSTEM: name never demotes.
                "org.example.notes" to raw(systemFlag = true, updatedSystemFlag = false),
                "org.opensource.tool" to raw(systemFlag = false, updatedSystemFlag = false),
            ),
        )

        val byName = evidence.applications.associateBy { it.packageName }
        assertEquals(
            ApplicationClassification.PREINSTALLED_SYSTEM,
            byName.getValue("org.example.notes").classification,
        )
        assertEquals(
            ApplicationClassification.USER_THIRD_PARTY,
            byName.getValue("org.opensource.tool").classification,
        )
    }

    // ---- 5. Vendor-looking package name cannot affect classification -------------

    @Test
    fun vendorLookingPackageNameCannotAffectClassification() {
        val evidence = collect(
            names = listOf("com.samsung.android.camera", "com.google.android.gms"),
            metadata = mapOf(
                // Vendor-looking name without system flags must stay third-party: name never promotes.
                "com.samsung.android.camera" to raw(systemFlag = false, updatedSystemFlag = false),
                // Vendor-looking name with system flags stays classified by flags alone.
                "com.google.android.gms" to raw(systemFlag = true, updatedSystemFlag = true),
            ),
        )

        val byName = evidence.applications.associateBy { it.packageName }
        assertEquals(
            ApplicationClassification.USER_THIRD_PARTY,
            byName.getValue("com.samsung.android.camera").classification,
        )
        assertEquals(
            ApplicationClassification.UPDATED_SYSTEM,
            byName.getValue("com.google.android.gms").classification,
        )
    }

    // ---- 6-9. Raw flag preservation ----------------------------------------------

    @Test
    fun systemFlagTrueIsPreservedRaw() {
        val record = collect(
            names = listOf("com.android.settings"),
            metadata = mapOf("com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false)),
        ).applications.single()

        assertEquals(true, record.systemFlag)
        assertEquals(false, record.updatedSystemFlag)
    }

    @Test
    fun systemFlagFalseIsExplicitNotMissing() {
        val record = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw(systemFlag = false, updatedSystemFlag = false)),
        ).applications.single()

        // False is an authoritative absence of the flag, distinct from null.
        assertEquals(false, record.systemFlag)
        assertEquals(false, record.updatedSystemFlag)
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            record.classificationStatus,
        )
    }

    @Test
    fun updatedSystemFlagTrueIsPreservedRaw() {
        val record = collect(
            names = listOf("com.vendor.camera"),
            metadata = mapOf("com.vendor.camera" to raw(systemFlag = true, updatedSystemFlag = true)),
        ).applications.single()

        assertEquals(true, record.updatedSystemFlag)
        assertEquals(ApplicationClassification.UPDATED_SYSTEM, record.classification)
    }

    @Test
    fun updatedSystemFlagFalseIsExplicitNotMissing() {
        val record = collect(
            names = listOf("com.android.settings"),
            metadata = mapOf("com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false)),
        ).applications.single()

        assertEquals(false, record.updatedSystemFlag)
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
    }

    // ---- 10. Null / unavailable flags --------------------------------------------

    @Test
    fun nullFlagsYieldUnknownAndNeverFalse() {
        val evidence = collect(
            names = listOf("pkg.unreadable.a", "pkg.unreadable.b"),
            metadata = mapOf(
                "pkg.unreadable.a" to raw(systemFlag = null, updatedSystemFlag = null),
                "pkg.unreadable.b" to raw(systemFlag = null, updatedSystemFlag = false),
            ),
        )

        val a = evidence.applications.first { it.packageName == "pkg.unreadable.a" }
        assertNull(a.systemFlag)
        assertNull(a.updatedSystemFlag)
        assertEquals(ApplicationClassification.UNKNOWN, a.classification)
        assertEquals(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE, a.classificationStatus)

        // Partial availability keeps the known half and still refuses to classify.
        val b = evidence.applications.first { it.packageName == "pkg.unreadable.b" }
        assertNull(b.systemFlag)
        assertEquals(false, b.updatedSystemFlag)
        assertEquals(ApplicationClassification.UNKNOWN, b.classification)
        assertEquals(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE, b.classificationStatus)
    }

    // ---- 11-13. Enabled / disabled / default -------------------------------------

    @Test
    fun enabledStateEnabled() {
        val record = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf(
                "org.example.userapp" to raw(rawEnabledState = COMPONENT_ENABLED_STATE_ENABLED),
            ),
        ).applications.single()

        assertEquals(ApplicationEnabledState.ENABLED, record.enabledState)
    }

    @Test
    fun enabledStateDisabled() {
        val record = collect(
            names = listOf("com.android.settings"),
            metadata = mapOf(
                "com.android.settings" to raw(rawEnabledState = COMPONENT_ENABLED_STATE_DISABLED),
            ),
        ).applications.single()

        assertEquals(ApplicationEnabledState.DISABLED, record.enabledState)
    }

    @Test
    fun enabledStateDefault() {
        val record = collect(
            names = listOf("com.android.systemui"),
            metadata = mapOf(
                "com.android.systemui" to raw(rawEnabledState = COMPONENT_ENABLED_STATE_DEFAULT),
            ),
        ).applications.single()

        assertEquals(ApplicationEnabledState.DEFAULT, record.enabledState)
    }

    // ---- 14. Unknown / error enabled state ---------------------------------------

    @Test
    fun unknownEnabledStateOnFailureOrUnmappedValue() {
        val evidence = collect(
            names = listOf("pkg.no.metadata", "pkg.unmapped.state"),
            metadata = mapOf(
                // Metadata read failed entirely -> no enabled evidence at all.
                "pkg.unmapped.state" to raw(rawEnabledState = 99),
            ),
        )

        val noMetadata = evidence.applications.first { it.packageName == "pkg.no.metadata" }
        assertEquals(ApplicationEnabledState.UNKNOWN, noMetadata.enabledState)

        val unmapped = evidence.applications.first { it.packageName == "pkg.unmapped.state" }
        assertEquals(ApplicationEnabledState.UNKNOWN, unmapped.enabledState)
    }

    // ---- 15. UID capture ----------------------------------------------------------

    @Test
    fun uidCapturedWhenAvailable() {
        val evidence = collect(
            names = listOf("org.example.userapp", "pkg.no.uid"),
            metadata = mapOf(
                "org.example.userapp" to raw(uid = 10089L),
                "pkg.no.uid" to raw(uid = null),
            ),
        )

        val byName = evidence.applications.associateBy { it.packageName }
        assertEquals(10089L, byName.getValue("org.example.userapp").uid)
        assertNull(byName.getValue("pkg.no.uid").uid)
    }

    // ---- 16. Version on supported API level --------------------------------------

    @Test
    fun versionCapturedOnSupportedApiLevel() {
        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf(
                "org.example.userapp" to raw(
                    longVersionCode = 3000000001L,
                    legacyVersionCode = 1L,
                    versionName = "3.0.1",
                ),
            ),
            apiLevel = 30,
        )

        val record = evidence.applications.single()
        assertEquals(3000000001L, record.versionCode)
        assertEquals("3.0.1", record.versionName)
        assertEquals(30, record.apiLevel)
        assertEquals(30, evidence.apiLevel)
    }

    // ---- 17. Legacy version handling ----------------------------------------------

    @Test
    fun legacyVersionHandlingOnPre28ApiLevel() {
        val evidence = collect(
            names = listOf("org.example.legacy"),
            metadata = mapOf(
                "org.example.legacy" to raw(
                    // API 26/27 devices never produce longVersionCode; legacy is authoritative.
                    longVersionCode = null,
                    legacyVersionCode = 10203L,
                ),
            ),
            apiLevel = 26,
        )

        val record = evidence.applications.single()
        assertEquals(10203L, record.versionCode)
        assertEquals(26, record.apiLevel)
    }

    // ---- 18. Empty enumeration ----------------------------------------------------

    @Test
    fun emptyEnumerationIsUnavailableWithoutFabricatedRecords() {
        val evidence = collect(names = emptyList())

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, evidence.enumerationCompleteness)
        assertTrue(evidence.applications.isEmpty())
        assertEquals(
            listOf(
                S1ApplicationInventoryCollector.SCOPE_LIMITATION,
                S1ApplicationInventoryCollector.EMPTY_ENUMERATION_LIMITATION,
            ),
            evidence.limitations,
        )
    }

    // ---- 19. PackageManager failure -----------------------------------------------

    @Test
    fun packageManagerEnumerationFailureIsUnavailable() {
        val failed = collect(names = null)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, failed.enumerationCompleteness)
        assertTrue(failed.applications.isEmpty())
        assertTrue(failed.limitations.contains(S1ApplicationInventoryCollector.ENUMERATION_FAILURE_LIMITATION))

        // An adapter exception must never become successful evidence, nor crash the caller.
        val thrown = collect(names = null, throwOnEnumerate = true)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, thrown.enumerationCompleteness)
        assertTrue(thrown.applications.isEmpty())
        assertTrue(thrown.limitations.contains(S1ApplicationInventoryCollector.ENUMERATION_FAILURE_LIMITATION))
    }

    // ---- 20. Visibility / filtered completeness ------------------------------------

    @Test
    fun visibilityLimitedEnumerationIsAlwaysFiltered() {
        val evidence = collect(
            names = listOf("com.android.settings", "org.example.userapp"),
            metadata = mapOf(
                "com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false),
                "org.example.userapp" to raw(systemFlag = false, updatedSystemFlag = false),
            ),
        )

        assertEquals(ApplicationEnumerationCompleteness.FILTERED, evidence.enumerationCompleteness)
        assertNotEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
        assertTrue(
            evidence.limitations.contains(S1ApplicationInventoryCollector.VISIBILITY_LIMITATION),
        )
        assertEquals(2, evidence.applications.size)
    }

    // ---- 21. Multi-user / work-profile limitation ---------------------------------

    @Test
    fun multiUserScopeLimitationNeverRepresentedAsComplete() {
        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
        )

        assertNotEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
        assertEquals(
            listOf(
                S1ApplicationInventoryCollector.SCOPE_LIMITATION,
                S1ApplicationInventoryCollector.VISIBILITY_LIMITATION,
            ),
            evidence.limitations,
        )
        assertTrue(
            S1ApplicationInventoryCollector.SCOPE_LIMITATION.contains("user/profile scope"),
        )
    }

    // ---- 22. Self-package behavior -------------------------------------------------

    @Test
    fun selfPackageRetainedAsNormalEvidence() {
        val selfPackage = "co.in.cyvra.mobile"
        val evidence = collect(
            names = listOf(selfPackage, "com.android.settings"),
            metadata = mapOf(
                selfPackage to raw(systemFlag = false, updatedSystemFlag = false),
                "com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false),
            ),
        )

        // Contract: no name-based inclusion/exclusion filtering — the CYVRA package is
        // normal PackageManager evidence, classified exactly like any other package.
        assertEquals(2, evidence.applications.size)
        val self = evidence.applications.single { it.packageName == selfPackage }
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, self.classification)
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            self.classificationStatus,
        )
    }

    // ---- 23. One bad package does not destroy valid evidence -----------------------

    @Test
    fun unreadablePackageMetadataDestroysOnlyThatRecord() {
        val evidence = collect(
            names = listOf("com.android.settings", "pkg.throwing", "pkg.missing"),
            metadata = mapOf(
                "com.android.settings" to raw(systemFlag = true, updatedSystemFlag = false),
                // "pkg.missing" -> adapter returns null; "pkg.throwing" -> adapter throws.
            ),
            throwOnMetadataFor = setOf("pkg.throwing"),
        )

        assertEquals(3, evidence.applications.size)
        val healthy = evidence.applications.first { it.packageName == "com.android.settings" }
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, healthy.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, healthy.classificationStatus)

        for (badName in listOf("pkg.throwing", "pkg.missing")) {
            val degraded = evidence.applications.first { it.packageName == badName }
            assertNull(degraded.systemFlag)
            assertNull(degraded.updatedSystemFlag)
            assertEquals(ApplicationClassification.UNKNOWN, degraded.classification)
            assertEquals(
                ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE,
                degraded.classificationStatus,
            )
            assertEquals(ApplicationEnabledState.UNKNOWN, degraded.enabledState)
            assertNull(degraded.versionCode)
        }

        // The enumeration itself survived: still FILTERED, never degraded to a crash,
        // never inflated to COMPLETE.
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, evidence.enumerationCompleteness)
    }

    // ---- 24. No application content is collected -----------------------------------

    @Test
    fun recordsExposeOnlyApplicationMetadataNeverContent() {
        val record = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
        ).applications.single()

        val recordKeys = json.parseToJsonElement(json.encodeToString(record)).jsonObject.keys
        assertEquals(
            setOf(
                "packageName",
                "classification",
                "classificationStatus",
                "evidenceSource",
                "collectionMethod",
                "collectedAt",
                "schemaVersion",
                "label",
                "versionName",
                "versionCode",
                "uid",
                "systemFlag",
                "updatedSystemFlag",
                "enabledState",
                "apiLevel",
            ),
            recordKeys,
        )

        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
        )
        val evidenceKeys = json.parseToJsonElement(json.encodeToString(evidence)).jsonObject.keys
        assertEquals(
            setOf(
                "collectedAt",
                "evidenceSource",
                "collectionMethod",
                "enumerationCompleteness",
                "schemaVersion",
                "apiLevel",
                "applications",
                "limitations",
            ),
            evidenceKeys,
        )
    }

    // ---- 25. Existing model JSON compatibility -------------------------------------

    @Test
    fun inventoryModelJsonCompatibilityRemainsIntact() {
        // (a) Collector output round-trips unchanged.
        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw(systemFlag = false, updatedSystemFlag = false)),
        )
        val decoded = json.decodeFromString<ApplicationInventoryEvidence>(json.encodeToString(evidence))
        assertEquals(evidence, decoded)
        assertEquals(SCHEMA_VERSION, decoded.schemaVersion)
        assertEquals("1.0.0", SCHEMA_VERSION)

        // (b) Previously-produced minimal record JSON still decodes with safe defaults.
        val legacyMinimalRecord =
            """
            {
              "packageName": "com.example.minimal",
              "classification": "UNKNOWN",
              "classificationStatus": "EVIDENCE_UNAVAILABLE",
              "evidenceSource": "ANDROID_COMPONENT",
              "collectionMethod": "ANDROID_PACKAGE_MANAGER",
              "collectedAt": "2026-09-27T10:00:00Z"
            }
            """.trimIndent()
        val record = json.decodeFromString<ApplicationInventoryRecord>(legacyMinimalRecord)
        assertEquals(SCHEMA_VERSION, record.schemaVersion)
        assertNull(record.uid)
        assertNull(record.systemFlag)
        assertNull(record.updatedSystemFlag)
        assertEquals(ApplicationEnabledState.UNKNOWN, record.enabledState)

        // (c) Previously-produced minimal evidence JSON still decodes with safe defaults.
        val legacyMinimalEvidence =
            """
            {
              "collectedAt": "2026-09-27T10:00:00Z",
              "evidenceSource": "ANDROID_COMPONENT",
              "collectionMethod": "ANDROID_PACKAGE_MANAGER",
              "enumerationCompleteness": "UNAVAILABLE"
            }
            """.trimIndent()
        val inventory = json.decodeFromString<ApplicationInventoryEvidence>(legacyMinimalEvidence)
        assertEquals(SCHEMA_VERSION, inventory.schemaVersion)
        assertTrue(inventory.applications.isEmpty())
        assertTrue(inventory.limitations.isEmpty())
    }

    // ---- Provenance vocabulary -----------------------------------------------------

    @Test
    fun provenanceMatchesArchitectureVocabulary() {
        val evidence = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
        )

        assertEquals("ANDROID_COMPONENT", S1ApplicationInventoryCollector.EVIDENCE_SOURCE)
        assertEquals("ANDROID_PACKAGE_MANAGER", S1ApplicationInventoryCollector.COLLECTION_METHOD)
        assertEquals("ANDROID_COMPONENT", evidence.evidenceSource)
        assertEquals("ANDROID_PACKAGE_MANAGER", evidence.collectionMethod)
        assertEquals("ANDROID_COMPONENT", evidence.applications.single().evidenceSource)
        assertEquals("ANDROID_PACKAGE_MANAGER", evidence.applications.single().collectionMethod)
        assertEquals(collectedAt, evidence.collectedAt)
        assertEquals(collectedAt, evidence.applications.single().collectedAt)
    }

    // ---- Classification x enabled state independence --------------------------------

    @Test
    fun classificationAndEnabledStateAreIndependentDimensions() {
        val evidence = collect(
            names = listOf("com.android.disabled.system", "org.example.enabled.user"),
            metadata = mapOf(
                "com.android.disabled.system" to raw(
                    systemFlag = true,
                    updatedSystemFlag = false,
                    rawEnabledState = COMPONENT_ENABLED_STATE_DISABLED,
                ),
                "org.example.enabled.user" to raw(
                    systemFlag = false,
                    updatedSystemFlag = false,
                    rawEnabledState = COMPONENT_ENABLED_STATE_ENABLED,
                ),
            ),
        )

        val byName = evidence.applications.associateBy { it.packageName }
        val disabledSystem = byName.getValue("com.android.disabled.system")
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, disabledSystem.classification)
        assertEquals(ApplicationEnabledState.DISABLED, disabledSystem.enabledState)

        val enabledUser = byName.getValue("org.example.enabled.user")
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, enabledUser.classification)
        assertEquals(ApplicationEnabledState.ENABLED, enabledUser.enabledState)
    }

    // ---- API level propagation -------------------------------------------------------

    @Test
    fun apiLevelPropagationAndHonestAbsence() {
        val established = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
            apiLevel = 30,
        )
        assertEquals(30, established.apiLevel)
        assertEquals(30, established.applications.single().apiLevel)

        val missing = collect(
            names = listOf("org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
            apiLevel = null,
        )
        assertNull(missing.apiLevel)
        assertNull(missing.applications.single().apiLevel)
        assertTrue(missing.limitations.contains(S1ApplicationInventoryCollector.API_LEVEL_LIMITATION))
    }

    // ---- Duplicate enumeration entries ------------------------------------------------

    @Test
    fun duplicateEnumerationEntriesProduceOneRecord() {
        val evidence = collect(
            names = listOf("org.example.userapp", "org.example.userapp"),
            metadata = mapOf("org.example.userapp" to raw()),
        )

        assertEquals(1, evidence.applications.size)
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            evidence.enumerationCompleteness,
        )
    }
}
