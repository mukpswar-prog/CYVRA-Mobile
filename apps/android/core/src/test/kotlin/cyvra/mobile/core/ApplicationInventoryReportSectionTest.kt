package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for the pure Report 1 application-inventory derivation and the fail-closed
 * Final Report sanitization lifecycle outcome functions.
 */
class ApplicationInventoryReportSectionTest {

    private val s1CollectedAt = "2026-09-28T09:00:00Z"
    private val s2CollectedAt = "2026-09-28T09:05:00Z"

    private fun record(
        packageName: String,
        evidenceSource: String,
        collectionMethod: String,
        collectedAt: String,
        classification: ApplicationClassification,
        classificationStatus: ApplicationClassificationStatus,
        systemFlag: Boolean? = null,
        updatedSystemFlag: Boolean? = null,
        enabledState: ApplicationEnabledState = ApplicationEnabledState.UNKNOWN,
        versionCode: Long? = null,
        versionName: String? = null,
        uid: Long? = null,
        label: String? = null,
    ) = ApplicationInventoryRecord(
        packageName = packageName,
        classification = classification,
        classificationStatus = classificationStatus,
        evidenceSource = evidenceSource,
        collectionMethod = collectionMethod,
        collectedAt = collectedAt,
        label = label,
        versionName = versionName,
        versionCode = versionCode,
        uid = uid,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        enabledState = enabledState,
    )

    private fun s1Record(
        packageName: String,
        classification: ApplicationClassification,
        systemFlag: Boolean?,
        updatedSystemFlag: Boolean?,
        enabledState: ApplicationEnabledState,
        uid: Long? = null,
    ) = record(
        packageName = packageName,
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        collectedAt = s1CollectedAt,
        classification = classification,
        classificationStatus = ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        enabledState = enabledState,
        uid = uid,
    )

    private fun s2Record(
        packageName: String,
        classification: ApplicationClassification,
        systemFlag: Boolean?,
        updatedSystemFlag: Boolean?,
        enabledState: ApplicationEnabledState,
        uid: Long? = null,
    ) = record(
        packageName = packageName,
        evidenceSource = "ANDROID_ADB",
        collectionMethod = "ADB_PM_LIST_PACKAGES",
        collectedAt = s2CollectedAt,
        classification = classification,
        classificationStatus = ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        enabledState = enabledState,
        uid = uid,
    )

    private fun evidence(
        evidenceSource: String,
        collectionMethod: String,
        collectedAt: String,
        completeness: ApplicationEnumerationCompleteness,
        applications: List<ApplicationInventoryRecord>,
        limitations: List<String> = emptyList(),
    ) = ApplicationInventoryEvidence(
        collectedAt = collectedAt,
        evidenceSource = evidenceSource,
        collectionMethod = collectionMethod,
        enumerationCompleteness = completeness,
        applications = applications,
        limitations = limitations,
    )

    /**
     * Realistic two-source fixture:
     * - com.android.settings: both sources, flags agree (system), classification PREINSTALLED.
     * - com.shared.app: both sources, flags disagree -> classification conflict + flag conflict,
     *   enabled states disagree -> enabled conflict.
     * - com.device.only: S1 only.
     * - com.thirdparty.app: S2 only.
     */
    private fun s1Fixture() = evidence(
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        collectedAt = s1CollectedAt,
        completeness = ApplicationEnumerationCompleteness.FILTERED,
        applications = listOf(
            s1Record(
                "com.android.settings",
                ApplicationClassification.PREINSTALLED_SYSTEM,
                systemFlag = true,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.DEFAULT,
                uid = 1000,
            ),
            s1Record(
                "com.shared.app",
                ApplicationClassification.PREINSTALLED_SYSTEM,
                systemFlag = true,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.ENABLED,
                uid = 1001,
            ),
            s1Record(
                "com.device.only",
                ApplicationClassification.PREINSTALLED_SYSTEM,
                systemFlag = true,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.DISABLED,
                uid = 1002,
            ),
        ),
        limitations = listOf("Device-side enumeration is visibility-filtered."),
    )

    private fun s2Fixture() = evidence(
        evidenceSource = "ANDROID_ADB",
        collectionMethod = "ADB_PM_LIST_PACKAGES",
        collectedAt = s2CollectedAt,
        completeness = ApplicationEnumerationCompleteness.COMPLETE,
        applications = listOf(
            s2Record(
                "com.android.settings",
                ApplicationClassification.PREINSTALLED_SYSTEM,
                systemFlag = true,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.DEFAULT,
                uid = 1000,
            ),
            s2Record(
                "com.shared.app",
                ApplicationClassification.USER_THIRD_PARTY,
                systemFlag = false,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.DISABLED,
                uid = 1001,
            ),
            s2Record(
                "com.thirdparty.app",
                ApplicationClassification.USER_THIRD_PARTY,
                systemFlag = false,
                updatedSystemFlag = false,
                enabledState = ApplicationEnabledState.UNKNOWN,
                uid = 1003,
            ),
        ),
        limitations = listOf("Host-side enumeration scope is the ADB-visible package set."),
    )

    // ---------------------------------------------------------------
    // Section derivation from reconciled inventory
    // ---------------------------------------------------------------

    @Test
    fun sectionIsNullWhenNoInventoryWasCollected() {
        assertNull(deriveApplicationInventorySection(primary = null, reconciled = null))
    }

    @Test
    fun sectionCountsRecordsFromReconciledInventory() {
        val reconciled = ApplicationInventoryReconciler.reconcile(s1Fixture(), s2Fixture())
        val section = deriveApplicationInventorySection(
            primary = s1Fixture(),
            reconciled = reconciled,
        )

        assertNotNull(section)
        assertTrue(section.inventoryAvailable)
        assertEquals(4, section.totalApplications)
        assertEquals(2, section.preinstalledSystemCount)
        assertEquals(0, section.updatedSystemCount)
        assertEquals(1, section.userThirdPartyCount)
        assertEquals(1, section.unknownClassificationCount)

        // Every record lands in exactly one enabled-state bucket.
        assertEquals(
            section.totalApplications,
            section.enabledCount + section.disabledCount + section.defaultEnabledCount +
                section.unknownEnabledStateCount,
        )
        // com.shared.app (conflicting states) and com.thirdparty.app (S2-only unknown).
        assertEquals(2, section.unknownEnabledStateCount)

        // Provenance breakdown.
        assertEquals(1, section.s1OnlyCount)
        assertEquals(1, section.s2OnlyCount)
        assertEquals(2, section.bothCount)
        assertEquals(3, section.s1ProvenanceCount)
        assertEquals(3, section.s2ProvenanceCount)
        assertTrue(section.s1EvidencePresent)
        assertTrue(section.s2EvidencePresent)
    }

    @Test
    fun sectionKeepsFilteredCompletenessWithoutUpgrade() {
        val reconciled = ApplicationInventoryReconciler.reconcile(s1Fixture(), s2Fixture())
        val section = deriveApplicationInventorySection(s1Fixture(), reconciled)

        assertNotNull(section)
        // Even with one COMPLETE source, both-scoped enumeration stays FILTERED.
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, section.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, section.s1EnumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, section.s2EnumerationCompleteness)
    }

    @Test
    fun sectionCollectsMethodsTimestampsAndMergedLimitations() {
        val reconciled = ApplicationInventoryReconciler.reconcile(s1Fixture(), s2Fixture())
        val section = deriveApplicationInventorySection(s1Fixture(), reconciled)

        assertNotNull(section)
        assertEquals(
            listOf("ANDROID_PACKAGE_MANAGER", "ADB_PM_LIST_PACKAGES"),
            section.collectionMethods,
        )
        assertEquals(listOf(s1CollectedAt, s2CollectedAt), section.collectionTimestamps)
        assertEquals(
            listOf(
                "Device-side enumeration is visibility-filtered.",
                "Host-side enumeration scope is the ADB-visible package set.",
            ),
            section.limitations,
        )
    }

    @Test
    fun sectionSummarizesConflictsWithoutWithholdingAnythingButUid() {
        val reconciled = ApplicationInventoryReconciler.reconcile(s1Fixture(), s2Fixture())
        val section = deriveApplicationInventorySection(s1Fixture(), reconciled)

        assertNotNull(section)
        assertEquals(reconciled.conflicts.size, section.conflictCount)
        assertTrue(section.conflictCount >= 3) // classification + system flag + enabled state
        assertTrue(section.conflicts.any { it == "com.shared.app: classification conflict " +
            "(S1=PREINSTALLED_SYSTEM, S2=USER_THIRD_PARTY)" })
        assertTrue(section.conflicts.any { it.contains("com.shared.app: system flag conflict") })
        assertTrue(section.conflicts.any { it.contains("com.shared.app: enabled-state conflict") })
        assertTrue(section.conflicts.none { it.contains("com.shared.app: UID conflict") })
    }

    @Test
    fun uidConflictSummaryWithholdsRawUidValues() {
        val s1 = evidence(
            evidenceSource = "ANDROID_COMPONENT",
            collectionMethod = "ANDROID_PACKAGE_MANAGER",
            collectedAt = s1CollectedAt,
            completeness = ApplicationEnumerationCompleteness.FILTERED,
            applications = listOf(
                s1Record(
                    "com.uid.conflict",
                    ApplicationClassification.PREINSTALLED_SYSTEM,
                    systemFlag = true,
                    updatedSystemFlag = false,
                    enabledState = ApplicationEnabledState.DEFAULT,
                    uid = 10042,
                ),
            ),
        )
        val s2 = evidence(
            evidenceSource = "ANDROID_ADB",
            collectionMethod = "ADB_PM_LIST_PACKAGES",
            collectedAt = s2CollectedAt,
            completeness = ApplicationEnumerationCompleteness.COMPLETE,
            applications = listOf(
                s2Record(
                    "com.uid.conflict",
                    ApplicationClassification.PREINSTALLED_SYSTEM,
                    systemFlag = true,
                    updatedSystemFlag = false,
                    enabledState = ApplicationEnabledState.DEFAULT,
                    uid = 10043,
                ),
            ),
        )

        val reconciled = ApplicationInventoryReconciler.reconcile(s1, s2)
        val section = deriveApplicationInventorySection(s1, reconciled)

        assertNotNull(section)
        assertEquals(1, section.conflictCount)
        val summary = section.conflicts.single()
        assertTrue(summary.contains("UID conflict"))
        assertFalse(summary.contains("10042"))
        assertFalse(summary.contains("10043"))
    }

    // ---------------------------------------------------------------
    // Single-source fallback (no reconciler output available)
    // ---------------------------------------------------------------

    @Test
    fun fallbackAttributesSingleSourceWithoutInventingReconciliation() {
        val section = deriveApplicationInventorySection(primary = s1Fixture(), reconciled = null)

        assertNotNull(section)
        assertEquals(3, section.totalApplications)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, section.enumerationCompleteness)
        assertTrue(section.s1EvidencePresent)
        assertFalse(section.s2EvidencePresent)
        assertEquals(3, section.s1OnlyCount)
        assertEquals(0, section.s2OnlyCount)
        assertEquals(0, section.bothCount)
        assertEquals(listOf("ANDROID_PACKAGE_MANAGER"), section.collectionMethods)
        assertEquals(listOf(s1CollectedAt), section.collectionTimestamps)
        assertEquals(0, section.conflictCount)
    }

    @Test
    fun fallbackAttributesS2PrimaryToS2Side() {
        val section = deriveApplicationInventorySection(primary = s2Fixture(), reconciled = null)

        assertNotNull(section)
        assertFalse(section.s1EvidencePresent)
        assertTrue(section.s2EvidencePresent)
        assertEquals(3, section.s2OnlyCount)
        assertEquals(0, section.s1OnlyCount)
    }

    @Test
    fun sectionSerializesAndDeserializes() {
        val reconciled = ApplicationInventoryReconciler.reconcile(s1Fixture(), s2Fixture())
        val section = deriveApplicationInventorySection(s1Fixture(), reconciled)
        assertNotNull(section)

        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(section)
        val decoded = json.decodeFromString<ApplicationInventoryReportSection>(serialized)

        assertEquals(section, decoded)
        assertTrue(serialized.contains("applicationInventory") || serialized.contains("totalApplications"))
    }

    // ---------------------------------------------------------------
    // Fail-closed Final Report lifecycle outcome
    // ---------------------------------------------------------------

    private fun execution(isSuccess: Boolean, status: String, error: String? = null) =
        SanitizationExecutionResult(
            operationId = "PURGE-OP-TEST",
            method = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            isSuccess = isSuccess,
            executionStatus = status,
            error = error,
        )

    private fun verification(status: SanitizationVerificationStatus) = VerificationResult(
        operationId = "PURGE-OP-TEST",
        sessionUuid = "SESS-TEST",
        status = status,
        postResetStateDetected = false,
        userDataInaccessible = false,
        setupWizardDetected = false,
        assuranceLevel = "NONE",
    )

    @Test
    fun simulatedDryRunIsNeverTreatedAsExecution() {
        val outcome = deriveSanitizationLifecycleOutcome(
            execution(isSuccess = true, status = "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE"),
            verification(SanitizationVerificationStatus.VERIFIED),
        )
        assertEquals(SanitizationLifecycleOutcome.SIMULATED_NOT_EXECUTED, outcome)
        assertNotNull(deriveSanitizationBlockReason(outcome, execution(true, "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE")))
    }

    @Test
    fun blockedExecutionIsNeverTreatedAsExecution() {
        val exec = execution(
            isSuccess = false,
            status = "BLOCKED_NOT_IMPLEMENTED",
            error = "no validated provider",
        )
        val outcome = deriveSanitizationLifecycleOutcome(exec, verification(SanitizationVerificationStatus.VERIFIED))
        assertEquals(SanitizationLifecycleOutcome.BLOCKED_NOT_EXECUTED, outcome)
        assertEquals("no validated provider", deriveSanitizationBlockReason(outcome, exec))
    }

    @Test
    fun failedExecutionProducesFailureOutcome() {
        val exec = execution(isSuccess = false, status = "FAILED_UNAUTHORIZED", error = "missing authorization")
        val outcome = deriveSanitizationLifecycleOutcome(exec, verification(SanitizationVerificationStatus.VERIFIED))
        assertEquals(SanitizationLifecycleOutcome.FAILED, outcome)
        assertEquals("missing authorization", deriveSanitizationBlockReason(outcome, exec))
    }

    @Test
    fun executionWithoutPassingVerificationNeverClaimsSuccess() {
        val exec = execution(isSuccess = true, status = "TRIGGERED_REBOOT_PENDING")
        val unverifiedStatuses = listOf(
            SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION,
            SanitizationVerificationStatus.PARTIALLY_VERIFIED,
            SanitizationVerificationStatus.FAILED,
            SanitizationVerificationStatus.UNKNOWN,
        )
        unverifiedStatuses.forEach { status ->
            val outcome = deriveSanitizationLifecycleOutcome(exec, verification(status))
            assertEquals(SanitizationLifecycleOutcome.EXECUTED_UNVERIFIED, outcome, "status=$status")
            assertNotNull(deriveSanitizationBlockReason(outcome, exec))
        }
    }

    @Test
    fun successRequiresBothExecutionAndPassingVerification() {
        val exec = execution(isSuccess = true, status = "TRIGGERED_REBOOT_PENDING")

        listOf(
            SanitizationVerificationStatus.VERIFIED,
            SanitizationVerificationStatus.PLATFORM_REPORTED_COMPLETE,
        ).forEach { status ->
            val outcome = deriveSanitizationLifecycleOutcome(exec, verification(status))
            assertEquals(SanitizationLifecycleOutcome.EXECUTED_VERIFIED, outcome, "status=$status")
            assertNull(deriveSanitizationBlockReason(outcome, exec))
        }
    }
}
