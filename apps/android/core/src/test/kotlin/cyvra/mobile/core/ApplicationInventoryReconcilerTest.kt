package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure unit tests for the deterministic S1 + S2 application-inventory reconciliation.
 *
 * No hardware, no framework classes, no host transport, no command execution: every test
 * feeds already-collected [ApplicationInventoryEvidence] into [ApplicationInventoryReconciler]
 * and asserts on the reconciled result.
 */
class ApplicationInventoryReconcilerTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    private fun record(
        pkg: String,
        evidenceSource: String = S1_SOURCE,
        collectionMethod: String = S1_METHOD,
        systemFlag: Boolean? = null,
        updatedSystemFlag: Boolean? = null,
        classification: ApplicationClassification = deriveClassification(systemFlag, updatedSystemFlag),
        classificationStatus: ApplicationClassificationStatus =
            deriveClassificationStatus(systemFlag, updatedSystemFlag),
        label: String? = null,
        versionName: String? = null,
        versionCode: Long? = null,
        uid: Long? = null,
        enabledState: ApplicationEnabledState = ApplicationEnabledState.UNKNOWN,
        apiLevel: Int? = 30,
    ) = ApplicationInventoryRecord(
        packageName = pkg,
        classification = classification,
        classificationStatus = classificationStatus,
        evidenceSource = evidenceSource,
        collectionMethod = collectionMethod,
        collectedAt = COLLECTED_AT,
        label = label,
        versionName = versionName,
        versionCode = versionCode,
        uid = uid,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        enabledState = enabledState,
        apiLevel = apiLevel,
    )

    private fun s1Record(
        pkg: String,
        systemFlag: Boolean? = null,
        updatedSystemFlag: Boolean? = null,
        label: String? = null,
        versionName: String? = null,
        versionCode: Long? = null,
        uid: Long? = null,
        enabledState: ApplicationEnabledState = ApplicationEnabledState.UNKNOWN,
    ) = record(
        pkg = pkg,
        evidenceSource = S1_SOURCE,
        collectionMethod = S1_METHOD,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        label = label,
        versionName = versionName,
        versionCode = versionCode,
        uid = uid,
        enabledState = enabledState,
    )

    private fun s2Record(
        pkg: String,
        systemFlag: Boolean? = null,
        updatedSystemFlag: Boolean? = null,
        label: String? = null,
        versionName: String? = null,
        versionCode: Long? = null,
        uid: Long? = null,
        enabledState: ApplicationEnabledState = ApplicationEnabledState.UNKNOWN,
    ) = record(
        pkg = pkg,
        evidenceSource = S2_SOURCE,
        collectionMethod = S2_METHOD,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        label = label,
        versionName = versionName,
        versionCode = versionCode,
        uid = uid,
        enabledState = enabledState,
    )

    private fun s1Evidence(
        completeness: ApplicationEnumerationCompleteness = ApplicationEnumerationCompleteness.FILTERED,
        applications: List<ApplicationInventoryRecord> = emptyList(),
        limitations: List<String> = emptyList(),
    ) = ApplicationInventoryEvidence(
        collectedAt = COLLECTED_AT,
        evidenceSource = S1_SOURCE,
        collectionMethod = S1_METHOD,
        enumerationCompleteness = completeness,
        apiLevel = 30,
        applications = applications,
        limitations = limitations,
    )

    private fun s2Evidence(
        completeness: ApplicationEnumerationCompleteness = ApplicationEnumerationCompleteness.COMPLETE,
        applications: List<ApplicationInventoryRecord> = emptyList(),
        limitations: List<String> = emptyList(),
    ) = ApplicationInventoryEvidence(
        collectedAt = COLLECTED_AT,
        evidenceSource = S2_SOURCE,
        collectionMethod = S2_METHOD,
        enumerationCompleteness = completeness,
        apiLevel = 30,
        applications = applications,
        limitations = limitations,
    )

    private fun recordOf(inventory: ReconciledApplicationInventory, pkg: String): ReconciledApplicationRecord =
        inventory.records.single { it.packageName == pkg }

    private inline fun <reified T : ApplicationInventoryConflict> conflictsOf(
        inventory: ReconciledApplicationInventory,
        pkg: String,
    ): List<T> = inventory.conflicts.filterIsInstance<T>().filter { it.packageName == pkg }

    // ---- 1-2. Single-source reconciliation ------------------------------------------

    @Test
    fun s1OnlyInventoryReconcilesWithS1Provenance() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record("com.example.one", systemFlag = false, updatedSystemFlag = false),
                    s1Record("com.example.two", systemFlag = true, updatedSystemFlag = false),
                ),
                limitations = listOf("Device-side scope limitation."),
            ),
            s2 = null,
        )

        assertEquals(2, inventory.records.size)
        assertTrue(inventory.records.all { it.provenance == ApplicationInventoryProvenance.S1_ONLY })
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.s1Completeness)
        assertNull(inventory.s2Completeness)
        assertEquals(listOf("Device-side scope limitation."), inventory.limitations)
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, recordOf(inventory, "com.example.two").classification)
    }

    @Test
    fun s2OnlyInventoryReconcilesWithS2ProvenanceAndOwnScope() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = null,
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
                limitations = listOf("Host scope limitation."),
            ),
        )

        assertEquals(1, inventory.records.size)
        assertEquals(ApplicationInventoryProvenance.S2_ONLY, inventory.records.single().provenance)
        // Sole enumerating source: the aggregate preserves that source's own scope, never more.
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, inventory.enumerationCompleteness)
        assertNull(inventory.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, inventory.s2Completeness)
        assertEquals(listOf("Host scope limitation."), inventory.limitations)
    }

    // ---- 3-5. Package identity across sources ----------------------------------------

    @Test
    fun identicalPackageInBothSourcesYieldsBothProvenanceWithoutConflict() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record(
                        "com.example.app",
                        systemFlag = true,
                        updatedSystemFlag = false,
                        label = "Example",
                        versionName = "1.0",
                        versionCode = 100L,
                        uid = 10001L,
                        enabledState = ApplicationEnabledState.ENABLED,
                    ),
                ),
            ),
            s2 = s2Evidence(
                applications = listOf(
                    s2Record(
                        "com.example.app",
                        systemFlag = true,
                        updatedSystemFlag = false,
                        versionName = "1.0",
                        versionCode = 100L,
                        uid = 10001L,
                        enabledState = ApplicationEnabledState.ENABLED,
                    ),
                ),
            ),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(ApplicationInventoryProvenance.BOTH, reconciled.provenance)
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, reconciled.classificationStatus)
        assertEquals(ApplicationEnabledState.ENABLED, reconciled.enabledState)
        assertEquals(100L, reconciled.versionCode)
        assertEquals(10001L, reconciled.uid)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun packagePresentOnlyInS1KeepsS1OnlyProvenance() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record("com.example.shared", systemFlag = false, updatedSystemFlag = false),
                    s1Record("com.example.s1only", systemFlag = false, updatedSystemFlag = false),
                ),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.shared", systemFlag = false, updatedSystemFlag = false)),
            ),
        )

        assertEquals(2, inventory.records.size)
        assertEquals(ApplicationInventoryProvenance.S1_ONLY, recordOf(inventory, "com.example.s1only").provenance)
        assertEquals(ApplicationInventoryProvenance.BOTH, recordOf(inventory, "com.example.shared").provenance)
    }

    @Test
    fun packagePresentOnlyInS2KeepsS2OnlyProvenance() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.example.shared", systemFlag = false, updatedSystemFlag = false)),
            ),
            s2 = s2Evidence(
                applications = listOf(
                    s2Record("com.example.shared", systemFlag = false, updatedSystemFlag = false),
                    s2Record("com.example.s2only", systemFlag = false, updatedSystemFlag = false),
                ),
            ),
        )

        assertEquals(2, inventory.records.size)
        assertEquals(ApplicationInventoryProvenance.S2_ONLY, recordOf(inventory, "com.example.s2only").provenance)
        assertEquals(ApplicationInventoryProvenance.BOTH, recordOf(inventory, "com.example.shared").provenance)
    }

    // ---- 6-7. Empty and unavailable sources ------------------------------------------

    @Test
    fun bothSourcesEmptyYieldsNoRecordsAndNoConflicts() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(completeness = ApplicationEnumerationCompleteness.FILTERED),
            s2 = s2Evidence(completeness = ApplicationEnumerationCompleteness.COMPLETE),
        )

        assertEquals(emptyList(), inventory.records)
        assertEquals(emptyList(), inventory.conflicts)
        assertEquals(emptyList(), inventory.limitations)
        // Two sources enumerated: the union of independently scoped enumerations is not COMPLETE.
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.enumerationCompleteness)
    }

    @Test
    fun bothSourcesUnavailableYieldUnavailableAggregate() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(completeness = ApplicationEnumerationCompleteness.UNAVAILABLE),
            s2 = s2Evidence(completeness = ApplicationEnumerationCompleteness.UNAVAILABLE),
        )

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, inventory.enumerationCompleteness)
        assertEquals(emptyList(), inventory.records)
        assertEquals(emptyList(), inventory.conflicts)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, inventory.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, inventory.s2Completeness)
    }

    // ---- 8-10. Classification reconciliation ------------------------------------------

    @Test
    fun classificationAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, reconciled.classificationStatus)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun classificationKnownPlusUnknownPreservesTheKnownValue() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app"))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, reconciled.classificationStatus)
        assertEquals(emptyList(), inventory.conflicts)
        // The source situation stays readable on the embedded records.
        assertEquals(
            ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE,
            reconciled.s2Record!!.classificationStatus,
        )
    }

    @Test
    fun classificationConflictIsPreservedInsteadOfPickingAWinner() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        // Fail-closed canonical value: no winner, contradictory evidence stays visible.
        assertEquals(ApplicationClassification.UNKNOWN, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS, reconciled.classificationStatus)
        // Both observed classifications and the underlying flag disagreement are preserved.
        assertEquals(
            listOf(
                ApplicationInventoryConflict.Classification(
                    packageName = "com.example.app",
                    s1Value = ApplicationClassification.PREINSTALLED_SYSTEM,
                    s2Value = ApplicationClassification.USER_THIRD_PARTY,
                ),
                ApplicationInventoryConflict.SystemFlag(
                    packageName = "com.example.app",
                    s1Value = true,
                    s2Value = false,
                ),
            ),
            inventory.conflicts,
        )
        assertNull(reconciled.systemFlag)
    }

    // ---- 11-15. Raw system flags -------------------------------------------------------

    @Test
    fun systemFlagAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(true, reconciled.systemFlag)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun systemFlagFromOneSideIsPreservedWhenTheOtherIsUnavailable() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = null, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(true, reconciled.systemFlag)
        assertEquals(false, reconciled.updatedSystemFlag)
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, reconciled.classification)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun systemFlagConflictIsPreservedExplicitly() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = null))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = null))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        // Never invents a flag value: conflicting flags canonicalize to null (not false).
        assertNull(reconciled.systemFlag)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.SystemFlag(
                    packageName = "com.example.app",
                    s1Value = true,
                    s2Value = false,
                ),
            ),
            inventory.conflicts,
        )
        assertEquals(ApplicationClassification.UNKNOWN, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS, reconciled.classificationStatus)
    }

    @Test
    fun updatedSystemFlagAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = true, updatedSystemFlag = true))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = true, updatedSystemFlag = true))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(true, reconciled.updatedSystemFlag)
        assertEquals(ApplicationClassification.UPDATED_SYSTEM, reconciled.classification)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun updatedSystemFlagConflictIsPreservedExplicitly() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = null, updatedSystemFlag = true))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = null, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertNull(reconciled.updatedSystemFlag)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.UpdatedSystemFlag(
                    packageName = "com.example.app",
                    s1Value = true,
                    s2Value = false,
                ),
            ),
            inventory.conflicts,
        )
        assertEquals(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS, reconciled.classificationStatus)
    }

    // ---- 16-18. Enabled state ------------------------------------------------------------

    @Test
    fun enabledStateAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", enabledState = ApplicationEnabledState.ENABLED))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", enabledState = ApplicationEnabledState.ENABLED))),
        )

        assertEquals(ApplicationEnabledState.ENABLED, recordOf(inventory, "com.example.app").enabledState)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun enabledUnknownPlusKnownPreservesTheKnownState() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app"))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", enabledState = ApplicationEnabledState.DISABLED))),
        )

        assertEquals(ApplicationEnabledState.DISABLED, recordOf(inventory, "com.example.app").enabledState)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun enabledStateConflictYieldsUnknownWithConflictPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.example.app", enabledState = ApplicationEnabledState.ENABLED)),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.app", enabledState = ApplicationEnabledState.DISABLED)),
            ),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(ApplicationEnabledState.UNKNOWN, reconciled.enabledState)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.EnabledState(
                    packageName = "com.example.app",
                    s1Value = ApplicationEnabledState.ENABLED,
                    s2Value = ApplicationEnabledState.DISABLED,
                ),
            ),
            inventory.conflicts,
        )
    }

    // ---- 19-21. Version reconciliation ----------------------------------------------------

    @Test
    fun versionAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.example.app", versionName = "2.0.0", versionCode = 42L)),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.app", versionName = "2.0.0", versionCode = 42L)),
            ),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals("2.0.0", reconciled.versionName)
        assertEquals(42L, reconciled.versionCode)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun versionFromOneSideIsPreservedWhenTheOtherIsMissing() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", versionCode = 42L))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", versionName = "2.0.0"))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(42L, reconciled.versionCode)
        assertEquals("2.0.0", reconciled.versionName)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun versionConflictIsPreservedExplicitly() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", versionName = "1.0", versionCode = 42L))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", versionName = "2.0", versionCode = 43L))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        // No source is declared authoritative: canonical values fall back to null,
        // both observed values stay in the conflict entries.
        assertNull(reconciled.versionCode)
        assertNull(reconciled.versionName)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.VersionCode(
                    packageName = "com.example.app",
                    s1Value = 42L,
                    s2Value = 43L,
                ),
                ApplicationInventoryConflict.VersionName(
                    packageName = "com.example.app",
                    s1Value = "1.0",
                    s2Value = "2.0",
                ),
            ),
            inventory.conflicts,
        )
    }

    // ---- 22. Label is descriptive only -----------------------------------------------------

    @Test
    fun labelDifferenceDoesNotChangeIdentityOrClassification() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record("com.example.app", systemFlag = false, updatedSystemFlag = false, label = "Messages"),
                ),
            ),
            s2 = s2Evidence(
                applications = listOf(
                    s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false, label = "Messaging"),
                ),
            ),
        )

        // One package, one record: label difference is never an identity conflict.
        assertEquals(1, inventory.records.size)
        val reconciled = recordOf(inventory, "com.example.app")
        assertEquals(ApplicationInventoryProvenance.BOTH, reconciled.provenance)
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, reconciled.classification)
        assertEquals(emptyList(), inventory.conflicts)
        // Deterministic descriptive preference, originals preserved on both source records.
        assertEquals("Messages", reconciled.label)
        assertEquals("Messages", reconciled.s1Record!!.label)
        assertEquals("Messaging", reconciled.s2Record!!.label)
    }

    // ---- 23-25. UID reconciliation ----------------------------------------------------------

    @Test
    fun uidAgreementIsPreserved() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", uid = 10123L))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", uid = 10123L))),
        )

        assertEquals(10123L, recordOf(inventory, "com.example.app").uid)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun uidFromOneSideIsPreservedWhenTheOtherIsMissing() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", uid = 10123L))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app"))),
        )

        assertEquals(10123L, recordOf(inventory, "com.example.app").uid)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun uidConflictIsPreservedExplicitlyWithoutAuthorityClaim() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", uid = 10123L))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", uid = 10234L))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        // UID scopes may legitimately differ between sources: no overwrite, no authority.
        assertNull(reconciled.uid)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.Uid(
                    packageName = "com.example.app",
                    s1Value = 10123L,
                    s2Value = 10234L,
                ),
            ),
            inventory.conflicts,
        )
    }

    // ---- 26. Duplicate package handling ------------------------------------------------------

    @Test
    fun duplicatePackageWithinASourceIsDeduplicatedFirstOccurrenceWins() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record("com.dup.app", uid = 101L),
                    s1Record("com.dup.app", uid = 202L),
                ),
            ),
            s2 = null,
        )

        assertEquals(1, inventory.records.size)
        val reconciled = recordOf(inventory, "com.dup.app")
        assertEquals(101L, reconciled.uid)
        assertEquals(ApplicationInventoryProvenance.S1_ONLY, reconciled.provenance)
    }

    // ---- 27-29. Completeness aggregation -------------------------------------------------------

    @Test
    fun filteredPlusFilteredStaysFiltered() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                completeness = ApplicationEnumerationCompleteness.FILTERED,
                applications = listOf(s1Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
            ),
            s2 = s2Evidence(
                completeness = ApplicationEnumerationCompleteness.FILTERED,
                applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
            ),
        )

        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.s2Completeness)
    }

    @Test
    fun filteredPlusUnavailableKeepsTheFilteredScope() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                completeness = ApplicationEnumerationCompleteness.FILTERED,
                applications = listOf(s1Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
            ),
            s2 = s2Evidence(completeness = ApplicationEnumerationCompleteness.UNAVAILABLE),
        )

        assertEquals(ApplicationEnumerationCompleteness.FILTERED, inventory.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, inventory.s2Completeness)
        // UNAVAILABLE contributes no records; the S1 record is never dropped or fabricated.
        assertEquals(1, inventory.records.size)
        assertEquals(ApplicationInventoryProvenance.S1_ONLY, inventory.records.single().provenance)
    }

    @Test
    fun unavailablePlusAvailableClaimsNoMoreThanTheAvailableSourceScope() {
        val completeScope = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(completeness = ApplicationEnumerationCompleteness.UNAVAILABLE),
            s2 = s2Evidence(
                completeness = ApplicationEnumerationCompleteness.COMPLETE,
                applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
            ),
        )
        // Aggregate equals the sole enumerating source's claim; both source-level values stay visible.
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, completeScope.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, completeScope.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, completeScope.s2Completeness)
        assertEquals(1, completeScope.records.size)

        val filteredScope = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(completeness = ApplicationEnumerationCompleteness.UNAVAILABLE),
            s2 = s2Evidence(
                completeness = ApplicationEnumerationCompleteness.FILTERED,
                applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false)),
            ),
        )
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, filteredScope.enumerationCompleteness)
    }

    // ---- 30. Limitation merging -------------------------------------------------------------------

    @Test
    fun limitationsMergeWithoutDuplicatesInDeterministicOrder() {
        val first = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(limitations = listOf("Device-side scope limitation.", "Device-side visibility limitation.")),
            s2 = s2Evidence(limitations = listOf("Host scope limitation.", "Device-side visibility limitation.")),
        )

        assertEquals(
            listOf(
                "Device-side scope limitation.",
                "Device-side visibility limitation.",
                "Host scope limitation.",
            ),
            first.limitations,
        )
        assertEquals(first.limitations, first.limitations.distinct())
    }

    // ---- 31-32. Determinism --------------------------------------------------------------------------

    @Test
    fun packageOrderingIsDeterministicAndSortedByPackageName() {
        val s1 = s1Evidence(
            applications = listOf(
                s1Record("com.zeta.app", systemFlag = false, updatedSystemFlag = false),
                s1Record("com.alpha.app", systemFlag = false, updatedSystemFlag = false),
            ),
        )
        val s2 = s2Evidence(
            applications = listOf(
                s2Record("com.beta.app", systemFlag = false, updatedSystemFlag = false),
                s2Record("com.alpha.app", systemFlag = false, updatedSystemFlag = false),
            ),
        )

        val first = ApplicationInventoryReconciler.reconcile(s1, s2)
        val second = ApplicationInventoryReconciler.reconcile(s1, s2)

        assertEquals(
            listOf("com.alpha.app", "com.beta.app", "com.zeta.app"),
            first.records.map { it.packageName },
        )
        assertEquals(first, second)
    }

    @Test
    fun limitationOrderingIsDeterministicAcrossRepeatedRuns() {
        val s1 = s1Evidence(limitations = listOf("First source limitation.", "Shared limitation."))
        val s2 = s2Evidence(limitations = listOf("Second source limitation.", "Shared limitation."))

        val first = ApplicationInventoryReconciler.reconcile(s1, s2)
        val second = ApplicationInventoryReconciler.reconcile(s1, s2)

        assertEquals(
            listOf("First source limitation.", "Shared limitation.", "Second source limitation."),
            first.limitations,
        )
        assertEquals(first.limitations, second.limitations)
    }

    // ---- 33. Source provenance is preserved ----------------------------------------------------------

    @Test
    fun embeddedSourceRecordsKeepTheirOriginalProvenance() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(applications = listOf(s1Record("com.example.app", systemFlag = false, updatedSystemFlag = false))),
            s2 = s2Evidence(applications = listOf(s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false))),
        )

        val reconciled = recordOf(inventory, "com.example.app")
        val s1RecordEmbedded = requireNotNull(reconciled.s1Record)
        val s2RecordEmbedded = requireNotNull(reconciled.s2Record)
        assertEquals(S1_SOURCE, s1RecordEmbedded.evidenceSource)
        assertEquals(S1_METHOD, s1RecordEmbedded.collectionMethod)
        assertEquals(COLLECTED_AT, s1RecordEmbedded.collectedAt)
        assertEquals(S2_SOURCE, s2RecordEmbedded.evidenceSource)
        assertEquals(S2_METHOD, s2RecordEmbedded.collectionMethod)
        assertEquals(COLLECTED_AT, s2RecordEmbedded.collectedAt)
        assertEquals(30, s1RecordEmbedded.apiLevel)
        assertEquals(30, s2RecordEmbedded.apiLevel)
    }

    // ---- 34. Inputs are never mutated --------------------------------------------------------------------

    @Test
    fun reconciliationDoesNotMutateItsInputs() {
        val s1 = s1Evidence(
            applications = listOf(
                s1Record("com.example.app", systemFlag = true, updatedSystemFlag = false, uid = 1L),
                s1Record("com.example.other", systemFlag = false, updatedSystemFlag = false, uid = 2L),
            ),
            limitations = listOf("Device-side scope limitation."),
        )
        val s2 = s2Evidence(
            applications = listOf(
                s2Record("com.example.app", systemFlag = false, updatedSystemFlag = false, uid = 3L),
            ),
            limitations = listOf("Host scope limitation."),
        )
        val s1Before = json.encodeToString(s1)
        val s2Before = json.encodeToString(s2)

        ApplicationInventoryReconciler.reconcile(s1, s2)

        assertEquals(s1Before, json.encodeToString(s1))
        assertEquals(s2Before, json.encodeToString(s2))
    }

    // ---- 35. No fabricated completeness -----------------------------------------------------------------------

    @Test
    fun reconciliationNeverFabricatesCompleteState() {
        fun aggregate(
            s1: ApplicationEnumerationCompleteness?,
            s2: ApplicationEnumerationCompleteness?,
        ) = ApplicationInventoryReconciler.reconcile(
            s1 = s1?.let { s1Evidence(completeness = it) },
            s2 = s2?.let { s2Evidence(completeness = it) },
        ).enumerationCompleteness

        // FILTERED is never upgraded by another source being present.
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            aggregate(ApplicationEnumerationCompleteness.FILTERED, ApplicationEnumerationCompleteness.COMPLETE),
        )
        // Two independently scoped enumerations do not become COMPLETE.
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            aggregate(ApplicationEnumerationCompleteness.COMPLETE, ApplicationEnumerationCompleteness.COMPLETE),
        )
        // UNAVAILABLE sources are not empty inventories and never complete.
        assertEquals(
            ApplicationEnumerationCompleteness.UNAVAILABLE,
            aggregate(ApplicationEnumerationCompleteness.UNAVAILABLE, ApplicationEnumerationCompleteness.UNAVAILABLE),
        )
        assertEquals(
            ApplicationEnumerationCompleteness.UNAVAILABLE,
            aggregate(null, null),
        )
        // FILTERED + UNAVAILABLE keeps the enumerating source's FILTERED scope.
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            aggregate(ApplicationEnumerationCompleteness.FILTERED, ApplicationEnumerationCompleteness.UNAVAILABLE),
        )
        // A single FILTERED source stays FILTERED.
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            aggregate(ApplicationEnumerationCompleteness.FILTERED, null),
        )
    }

    // ---- Neither source provided --------------------------------------------------------------------------

    @Test
    fun neitherSourceYieldsUnavailableAndEmptyResult() {
        val inventory = ApplicationInventoryReconciler.reconcile(s1 = null, s2 = null)

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, inventory.enumerationCompleteness)
        assertNull(inventory.s1Completeness)
        assertNull(inventory.s2Completeness)
        assertEquals(emptyList(), inventory.records)
        assertEquals(emptyList(), inventory.conflicts)
        assertEquals(emptyList(), inventory.limitations)
        assertEquals(SCHEMA_VERSION, inventory.schemaVersion)
    }

    // ---- Realistic device scenarios --------------------------------------------------------------------------

    @Test
    fun samsungUpdatedSystemPackageReconcilesToUpdatedSystemFromFlagsOnly() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(
                    s1Record(
                        "com.samsung.android.app.music",
                        systemFlag = true,
                        updatedSystemFlag = true,
                        label = "Samsung Music",
                        versionName = "6.0.00.5",
                        versionCode = 6000005L,
                        uid = 10087L,
                    ),
                ),
            ),
            s2 = s2Evidence(
                applications = listOf(
                    s2Record(
                        "com.samsung.android.app.music",
                        systemFlag = true,
                        updatedSystemFlag = true,
                        versionName = "6.0.00.5",
                        versionCode = 6000005L,
                        uid = 10087L,
                    ),
                ),
            ),
        )

        val reconciled = recordOf(inventory, "com.samsung.android.app.music")
        // UPDATED_SYSTEM comes only from the raw flags both sources observed (code may live
        // under /data/app — path and name are never consulted for classification).
        assertEquals(ApplicationClassification.UPDATED_SYSTEM, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, reconciled.classificationStatus)
        assertEquals(ApplicationInventoryProvenance.BOTH, reconciled.provenance)
        assertEquals(emptyList(), inventory.conflicts)
        // S2 has no labels; the deterministic S1 preference provides the descriptive label.
        assertEquals("Samsung Music", reconciled.label)
    }

    @Test
    fun neutralThirdPartyPackageReconcilesToUserThirdParty() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.example.shoppinglist", systemFlag = false, updatedSystemFlag = false)),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.shoppinglist", systemFlag = false, updatedSystemFlag = false)),
            ),
        )

        val reconciled = recordOf(inventory, "com.example.shoppinglist")
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, reconciled.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, reconciled.classificationStatus)
        assertEquals(emptyList(), inventory.conflicts)
    }

    @Test
    fun vendorLookingPackageNameStaysUserThirdPartyWhenFlagsSaySo() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.samsung.android.helppartner", systemFlag = false, updatedSystemFlag = false)),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.samsung.android.helppartner", systemFlag = false, updatedSystemFlag = false)),
            ),
        )

        // A Samsung/OEM-looking package name never influences classification.
        val reconciled = recordOf(inventory, "com.samsung.android.helppartner")
        assertEquals(ApplicationClassification.USER_THIRD_PARTY, reconciled.classification)
        assertEquals(ApplicationInventoryProvenance.BOTH, reconciled.provenance)
        assertEquals(emptyList(), inventory.conflicts)
    }

    // ---- Conflict ordering and serialization --------------------------------------------------------------------

    @Test
    fun conflictOrderingIsDeterministicFixedFieldOrder() {
        fun conflictedS1() = s1Evidence(
            applications = listOf(
                s1Record(
                    "com.example.app",
                    systemFlag = true,
                    updatedSystemFlag = false,
                    label = "One",
                    versionName = "1.0",
                    versionCode = 42L,
                    uid = 1L,
                    enabledState = ApplicationEnabledState.ENABLED,
                ),
            ),
        )
        fun conflictedS2() = s2Evidence(
            applications = listOf(
                s2Record(
                    "com.example.app",
                    systemFlag = false,
                    updatedSystemFlag = false,
                    label = "Two",
                    versionName = "2.0",
                    versionCode = 43L,
                    uid = 2L,
                    enabledState = ApplicationEnabledState.DISABLED,
                ),
            ),
        )

        val first = ApplicationInventoryReconciler.reconcile(conflictedS1(), conflictedS2())
        val second = ApplicationInventoryReconciler.reconcile(conflictedS1(), conflictedS2())

        assertEquals(
            listOf(
                ApplicationInventoryConflict.Classification(
                    packageName = "com.example.app",
                    s1Value = ApplicationClassification.PREINSTALLED_SYSTEM,
                    s2Value = ApplicationClassification.USER_THIRD_PARTY,
                ),
                ApplicationInventoryConflict.SystemFlag(
                    packageName = "com.example.app",
                    s1Value = true,
                    s2Value = false,
                ),
                ApplicationInventoryConflict.EnabledState(
                    packageName = "com.example.app",
                    s1Value = ApplicationEnabledState.ENABLED,
                    s2Value = ApplicationEnabledState.DISABLED,
                ),
                ApplicationInventoryConflict.VersionCode(
                    packageName = "com.example.app",
                    s1Value = 42L,
                    s2Value = 43L,
                ),
                ApplicationInventoryConflict.VersionName(
                    packageName = "com.example.app",
                    s1Value = "1.0",
                    s2Value = "2.0",
                ),
                ApplicationInventoryConflict.Uid(
                    packageName = "com.example.app",
                    s1Value = 1L,
                    s2Value = 2L,
                ),
            ),
            first.conflicts,
        )
        assertEquals(first, second)
        // Updated-system flag agreed, so it produces no conflict entry.
        assertEquals(0, first.conflicts.filterIsInstance<ApplicationInventoryConflict.UpdatedSystemFlag>().size)
    }

    @Test
    fun reconciledInventoryRoundTripsThroughSerializationWithConflicts() {
        val inventory = ApplicationInventoryReconciler.reconcile(
            s1 = s1Evidence(
                applications = listOf(s1Record("com.example.app", uid = 10123L)),
                limitations = listOf("Device-side scope limitation."),
            ),
            s2 = s2Evidence(
                applications = listOf(s2Record("com.example.app", uid = 10234L)),
                limitations = listOf("Host scope limitation."),
            ),
        )

        val encoded = json.encodeToString(inventory)
        val decoded = json.decodeFromString<ReconciledApplicationInventory>(encoded)

        assertEquals(inventory, decoded)
        assertEquals(
            listOf(
                ApplicationInventoryConflict.Uid(
                    packageName = "com.example.app",
                    s1Value = 10123L,
                    s2Value = 10234L,
                ),
            ),
            decoded.conflicts,
        )
        assertEquals(ApplicationInventoryProvenance.BOTH, decoded.records.single().provenance)
    }

    private companion object {
        const val S1_SOURCE = "ANDROID_COMPONENT"
        const val S1_METHOD = "ANDROID_PACKAGE_MANAGER"
        const val S2_SOURCE = "ANDROID_ADB"
        const val S2_METHOD = "ADB_PM_LIST_PACKAGES"
        const val COLLECTED_AT = "2026-09-28T12:00:00Z"
    }
}
