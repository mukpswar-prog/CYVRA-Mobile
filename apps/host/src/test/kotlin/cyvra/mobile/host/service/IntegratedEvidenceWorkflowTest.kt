package cyvra.mobile.host.service

import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.ApplicationClassification
import cyvra.mobile.core.ApplicationClassificationStatus
import cyvra.mobile.core.ApplicationEnabledState
import cyvra.mobile.core.ApplicationEnumerationCompleteness
import cyvra.mobile.core.ApplicationInventoryEvidence
import cyvra.mobile.core.ApplicationInventoryRecord
import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.ComponentBatteryExtras
import cyvra.mobile.core.ComponentDisplayMetrics
import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.core.HostWorkstationConnectionStatus
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.SanitizationLifecycleOutcome
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.SanitizationVerificationStatus
import cyvra.mobile.core.SanitizationWorkflowStep
import cyvra.mobile.core.VerificationResult
import cyvra.mobile.host.evidence.AdbApplicationInventoryProvider
import cyvra.mobile.host.evidence.HostAndroidComponentBridge
import cyvra.mobile.host.report.HostReportEngine
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * End-to-end integration tests for the first integrated engineering application path:
 *
 * USB/device verification -> S1 (device-side) + S2 (authorized ADB) inventory ->
 * ApplicationInventoryReconciler -> GenericDeviceEvidence -> Report 1 ->
 * sanitization eligibility/state machine -> Final Report (gated success).
 *
 * Scenarios: USB + ADB OFF, USB + ADB ON, S1 independence from ADB, S2 enrichment,
 * provenance/conflict/completeness survival into Report 1, and the fail-closed
 * sanitization lifecycle (blocked execution can never yield a success claim).
 */
class IntegratedEvidenceWorkflowTest {

    companion object {
        private const val SERIAL = "RF8R123456"
        private const val OPERATOR = "operator@cyvoriq.com"
    }

    /**
     * Deterministic fake ADB. When [adbAuthorized] is false every command fails
     * (ADB OFF/unavailable); when true it answers device, generic evidence, and
     * authorized inventory commands from fixed fixtures.
     */
    private class IntegratedAdbRunner(private val adbAuthorized: Boolean) : ProcessRunner {

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val joined = command.joinToString(" ")
            if (joined.contains("devices -l")) {
                return if (adbAuthorized) {
                    DefaultProcessExecutionResult(
                        0,
                        "List of devices attached\n$SERIAL device product:a10s model:SM_A107F transport_id:1\n",
                        "",
                    )
                } else {
                    DefaultProcessExecutionResult(1, "", "adb: device not found")
                }
            }
            if (!adbAuthorized) {
                return DefaultProcessExecutionResult(1, "", "adb unavailable")
            }

            val shell = joined.substringAfter(" shell ", missingDelimiterValue = "")
            return when {
                shell.startsWith("getprop ") -> {
                    val value = when (shell.removePrefix("getprop ")) {
                        "ro.product.manufacturer" -> "samsung"
                        "ro.product.brand" -> "samsung"
                        "ro.product.model" -> "SM-A107F"
                        "ro.product.device" -> "a10s"
                        "ro.product.name" -> "a10sxxx"
                        "ro.build.version.release" -> "11"
                        "ro.build.version.sdk" -> "30"
                        "ro.build.id" -> "RP1A.201005.001"
                        "ro.build.version.security_patch" -> "2023-08-01"
                        else -> ""
                    }
                    DefaultProcessExecutionResult(0, value, "")
                }

                shell.startsWith("settings get") -> DefaultProcessExecutionResult(0, "null", "")
                shell.contains("dumpsys battery") -> DefaultProcessExecutionResult(
                    0,
                    "AC powered: false\nUSB powered: true\nlevel: 82\nscale: 100\n" +
                        "voltage: 4100\ntemperature: 295\nhealth: 2\n",
                    "",
                )

                shell.startsWith("df -k") -> DefaultProcessExecutionResult(
                    0,
                    "Filesystem 1K-blocks Used Available Use% Mounted on\n" +
                        "/dev/block/dm-4 115200000 45200000 70000000 40% /data\n",
                    "",
                )

                shell == AdbApplicationInventoryProvider.CMD_API_LEVEL ->
                    DefaultProcessExecutionResult(0, "30\n", "")

                shell == AdbApplicationInventoryProvider.CMD_LIST_ALL -> DefaultProcessExecutionResult(
                    0,
                    "package:com.android.settings uid:1000\n" +
                        "package:com.shared.app uid:1001\n" +
                        "package:com.thirdparty.app uid:10123\n",
                    "",
                )

                shell == AdbApplicationInventoryProvider.CMD_LIST_DISABLED ->
                    DefaultProcessExecutionResult(0, "package:com.shared.app\n", "")

                shell == AdbApplicationInventoryProvider.CMD_LIST_ENABLED ->
                    DefaultProcessExecutionResult(0, "", "")

                shell.startsWith("dumpsys package ") -> DefaultProcessExecutionResult(
                    0,
                    dumpsysFor(shell.removePrefix("dumpsys package ")),
                    "",
                )

                else -> DefaultProcessExecutionResult(0, "ok", "")
            }
        }

        /** Modern dumpsys block; only com.android.settings carries the SYSTEM flag. */
        fun dumpsysFor(pkg: String): String {
            val flags = if (pkg == "com.android.settings") {
                "SYSTEM HAS_CODE ALLOW_BACKUP"
            } else {
                "HAS_CODE ALLOW_BACKUP"
            }
            return """
                Package [$pkg] (deadbeef):
                  userId=1000
                  codePath=/data/app/$pkg
                  versionCode=30 minSdk=26 targetSdk=34
                  versionName=1.0
                  flags=[$flags]
                  privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE ]
                  firstInstallTime=2021-08-01T10:00:00
            """.trimIndent() + "\n"
        }
    }

    private fun sampleLicense() = CustomerLicenseRecord(
        licenseId = "LIC-000001",
        serialNumber = "CYVRA15092026SA3F1-1-25",
        customerEmail = "tech@example.com",
        planName = "25 Device Scans",
        deviceScanEntitlement = 25,
        scansUsed = 0,
        scansRemaining = 25,
        status = LicenseEntitlementStatus.ACTIVE,
    )

    private fun orchestrator(runner: ProcessRunner): WorkstationSessionOrchestrator =
        WorkstationSessionOrchestrator(
            adbClient = AdbClient(File("/mock/adb"), runner),
            licenseService = HostLicenseService(sampleLicense()),
        )

    /**
     * S1 device-side inventory fixture (as collected on-device by the PackageManager
     * collector): visibility-filtered completeness, system flags observed directly.
     */
    private fun s1Evidence() = ApplicationInventoryEvidence(
        collectedAt = "2026-09-28T08:00:00Z",
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        enumerationCompleteness = ApplicationEnumerationCompleteness.FILTERED,
        applications = listOf(
            s1Record("com.android.settings", ApplicationEnabledState.DEFAULT, uid = 1000),
            s1Record("com.shared.app", ApplicationEnabledState.ENABLED, uid = 1001),
            s1Record("com.device.only", ApplicationEnabledState.DISABLED, uid = 1002),
        ),
        limitations = listOf("Device-side enumeration is visibility-filtered."),
    )

    private fun s1Record(
        packageName: String,
        enabledState: ApplicationEnabledState,
        uid: Long,
    ) = ApplicationInventoryRecord(
        packageName = packageName,
        classification = ApplicationClassification.PREINSTALLED_SYSTEM,
        classificationStatus = ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        collectedAt = "2026-09-28T08:00:00Z",
        uid = uid,
        systemFlag = true,
        updatedSystemFlag = false,
        enabledState = enabledState,
    )

    private fun diagnostic(
        adbAuthorized: Boolean,
        deviceSideInventory: ApplicationInventoryEvidence?,
    ): Pair<WorkstationSessionOrchestrator, WorkstationDiagnosticExecutionResult> {
        val orchestrator = orchestrator(IntegratedAdbRunner(adbAuthorized))
        val result = orchestrator.executeDiagnostic(
            serial = SERIAL,
            operatorId = OPERATOR,
            deviceSideInventory = deviceSideInventory,
        )
        return orchestrator to result
    }

    private fun preRecordFor(result: WorkstationDiagnosticExecutionResult) = PreSanitizationRecord(
        operationId = "PURGE-OP-E2E",
        sessionUuid = result.report.header.sessionUuid,
        identity = result.report.deviceIdentity,
        storageSnapshot = result.report.storageSnapshot,
        batterySnapshot = result.report.batterySnapshot,
        selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
        capabilityAssessment = result.report.capabilityAssessment,
        authorization = AuthorizationRequirement(
            operationId = "PURGE-OP-E2E",
            requiresOperatorConfirmation = true,
            confirmationPhrase = "CONFIRM PURGE PURGE-OP-E2E",
            isAuthorized = true,
            authorizedBy = OPERATOR,
        ),
        operatorId = OPERATOR,
    )

    /**
     * ADB fake with the CYVRA Android Component installed on the device, answering the
     * bridge exactly as the phone does. Everything not specific to the component is
     * answered by [IntegratedAdbRunner], so S2 and the generic evidence are unchanged.
     */
    private class ComponentInstalledAdbRunner(
        adbAuthorized: Boolean,
        private val componentEvidenceJson: String,
    ) : ProcessRunner {
        private val base = IntegratedAdbRunner(adbAuthorized)

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val shell = command.joinToString(" ")
                .substringAfter(" shell ", missingDelimiterValue = "")
            return when {
                shell.startsWith("pm list packages ${HostAndroidComponentBridge.DEFAULT_PACKAGE_NAME}") ->
                    DefaultProcessExecutionResult(
                        0,
                        "package:${HostAndroidComponentBridge.DEFAULT_PACKAGE_NAME}\n",
                        "",
                    )

                shell.startsWith("dumpsys package ${HostAndroidComponentBridge.DEFAULT_PACKAGE_NAME}") ->
                    DefaultProcessExecutionResult(0, "    versionName=0.0.1-poc\n", "")

                shell.startsWith("am broadcast") ->
                    DefaultProcessExecutionResult(0, "Broadcast completed: result=0\n", "")

                shell.startsWith("cat ${HostAndroidComponentBridge.COMPONENT_DATA_PATH}") ->
                    DefaultProcessExecutionResult(0, componentEvidenceJson, "")

                else -> base.execute(command, timeoutMs)
            }
        }
    }

    /**
     * A component payload shaped exactly as the on-device receiver writes it, carrying an
     * S1 inventory. It is authored by the fixture, never by the host — the host's job is
     * to read it, not to construct one.
     */
    private fun componentPayloadWith(inventory: ApplicationInventoryEvidence?) =
        AndroidComponentEvidencePayload(
            componentVersion = "0.0.1-poc",
            deviceLifecycleId = "lifecycle-fixture",
            sessionUuid = "session-fixture",
            displayMetrics = ComponentDisplayMetrics(420, 1080, 2340, 384, 420f, 420f),
            batteryExtras = ComponentBatteryExtras(
                isPresent = true,
                technology = "Li-poly",
                temperatureDeciCelsius = 310,
                voltageMilliVolts = 4050,
                capacityPercent = 78,
            ),
            runtimePermissions = emptyList(),
            declaredFeatures = emptyList(),
            applicationInventory = inventory,
        )

    // ---------------------------------------------------------------
    // WP-3b. The host obtains S1 from the device itself.
    // ---------------------------------------------------------------

    /**
     * The host obtains the device-side inventory without being handed one.
     *
     * `deviceSideInventory` is deliberately left at its default of null. The component is
     * installed, so the host triggers it over the ADB transport it already owns and reads
     * the inventory back. Before this package the parameter was the only route, so S1 was
     * always null in a real scan — that is the wiring gap WP-3b closes.
     */
    @Test
    fun hostCollectsTheS1InventoryFromTheDeviceWithoutBeingHandedOne() {
        val runner = ComponentInstalledAdbRunner(
            adbAuthorized = true,
            componentEvidenceJson = Json { encodeDefaults = true }
                .encodeToString(componentPayloadWith(s1Evidence())),
        )

        val result = orchestrator(runner)
            .executeDiagnostic(serial = SERIAL, operatorId = OPERATOR)

        val inventory = assertNotNull(
            result.evidence.applicationInventory,
            "the host must obtain S1 from the device rather than waiting to be handed it",
        )
        assertEquals("ANDROID_COMPONENT", inventory.evidenceSource)
        assertEquals("ANDROID_PACKAGE_MANAGER", inventory.collectionMethod)
        assertEquals(3, inventory.applications.size)
        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            inventory.enumerationCompleteness,
            "S1 completeness must survive unchanged, never promoted to COMPLETE",
        )

        // Reconciliation still ran, now against the S1 the host collected itself.
        assertNotNull(result.evidence.reconciledApplicationInventory)
    }

    /**
     * Fail-closed: a workstation without the component installed must still scan. The
     * bridge failing to find the APK contributes nothing and breaks nothing — S2 still
     * supplies the inventory, and the report is produced as before.
     */
    @Test
    fun scanStillSucceedsWhenTheComponentIsNotInstalled() {
        val result = orchestrator(IntegratedAdbRunner(adbAuthorized = true))
            .executeDiagnostic(serial = SERIAL, operatorId = OPERATOR)

        assertNotNull(result.report, "absence of the optional component must never fail a scan")

        val inventory = assertNotNull(result.evidence.applicationInventory)
        assertNotEquals(
            "ANDROID_COMPONENT",
            inventory.evidenceSource,
            "with no component on the device, nothing may be attributed to it",
        )
    }

    // ---------------------------------------------------------------
    // 1. USB + ADB OFF (S1 must still run; S2 must not be required)
    // ---------------------------------------------------------------

    @Test
    fun usbWithAdbOffKeepsS1EvidenceAndProducesReport1() {
        val runner = IntegratedAdbRunner(adbAuthorized = false)
        val orchestrator = orchestrator(runner)

        // FSB-003 device-state semantics are untouched: USB seen, no ADB device.
        val descriptor = orchestrator.pollDeviceState(usbConnected = true)
        assertEquals(HostWorkstationConnectionStatus.USB_DETECTED, descriptor.connectionStatus)

        val result = orchestrator.executeDiagnostic(
            serial = SERIAL,
            operatorId = OPERATOR,
            deviceSideInventory = s1Evidence(),
        )

        // The scan itself succeeds: inventory never fails the workflow because ADB is off.
        assertNotNull(result.report)
        assertNotNull(result.report.integrity)

        // S1-only evidence reaches GenericDeviceEvidence (and stays the primary inventory).
        val s1 = assertNotNull(result.evidence.applicationInventory)
        assertEquals("ANDROID_COMPONENT", s1.evidenceSource)
        assertEquals(3, s1.applications.size)

        // Reconciliation ran with an unavailable S2: S1 scope survives untouched.
        val reconciled = assertNotNull(result.evidence.reconciledApplicationInventory)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, reconciled.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, reconciled.s2Completeness)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, reconciled.enumerationCompleteness)
        assertEquals(3, reconciled.records.size)
        assertTrue(reconciled.limitations.isNotEmpty())

        // Report 1 carries the inventory section (FILTERED never silently becomes COMPLETE).
        val section = assertNotNull(result.report.applicationInventory)
        assertTrue(section.inventoryAvailable)
        assertEquals(3, section.totalApplications)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, section.enumerationCompleteness)
        assertTrue(section.s1EvidencePresent)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, section.s2EnumerationCompleteness)
        assertTrue(result.reportJson.contains("applicationInventory"))
        assertTrue(result.reportMarkdown.contains("Application Inventory"))
    }

    // ---------------------------------------------------------------
    // 2. USB + ADB ON (S1 + S2 reconciled, provenance/limits/conflicts preserved)
    // ---------------------------------------------------------------

    @Test
    fun usbWithAdbOnReconcilesBothSourcesIntoEvidenceAndReport1() {
        val (_, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())

        // S2 enrichment is present and complete for its own scope.
        val reconciled = assertNotNull(result.evidence.reconciledApplicationInventory)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, reconciled.s1Completeness)
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, reconciled.s2Completeness)
        // Both enumerated -> aggregate is FILTERED: scopes are never merged into COMPLETE.
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, reconciled.enumerationCompleteness)

        // Provenance: S1+S2 union with S1-only, S2-only, and BOTH records preserved.
        assertEquals(4, reconciled.records.size)
        assertEquals(2, reconciled.records.count { it.provenance.name == "BOTH" })
        assertEquals(1, reconciled.records.count { it.provenance.name == "S1_ONLY" })
        assertEquals(1, reconciled.records.count { it.provenance.name == "S2_ONLY" })

        // Conflicts are preserved explicitly (never silently resolved).
        assertTrue(reconciled.conflicts.isNotEmpty())

        // Report 1: inventory available, deterministic counts, FILTERED preserved.
        val section = assertNotNull(result.report.applicationInventory)
        assertTrue(section.inventoryAvailable)
        assertEquals(4, section.totalApplications)
        assertEquals(2, section.preinstalledSystemCount)
        assertEquals(0, section.updatedSystemCount)
        assertEquals(1, section.userThirdPartyCount)
        assertEquals(1, section.unknownClassificationCount)
        assertEquals(
            section.totalApplications,
            section.enabledCount + section.disabledCount + section.defaultEnabledCount +
                section.unknownEnabledStateCount,
        )
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, section.enumerationCompleteness)
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, section.s2EnumerationCompleteness)

        // Provenance survives into Report 1 with S1 and S2 clearly distinguished.
        assertTrue(section.s1EvidencePresent)
        assertTrue(section.s2EvidencePresent)
        assertEquals(3, section.s1ProvenanceCount)
        assertEquals(3, section.s2ProvenanceCount)
        assertEquals(1, section.s1OnlyCount)
        assertEquals(1, section.s2OnlyCount)
        assertEquals(2, section.bothCount)

        // Collection methods and timestamps are exposed (record-level S2 method reflects
        // the dumpsys-enriched enumeration actually used for the records).
        assertEquals(
            listOf("ANDROID_PACKAGE_MANAGER", "ADB_PM_LIST_PACKAGES_DUMPSYS_PACKAGE"),
            section.collectionMethods,
        )
        assertEquals(2, section.collectionTimestamps.size)

        // Conflicts survive into Report 1 JSON as explicit summaries.
        assertTrue(section.conflicts.any { it.contains("com.shared.app: classification conflict") })
        assertTrue(result.reportJson.contains("classification conflict"))
        assertTrue(section.limitations.isNotEmpty())
    }

    // ---------------------------------------------------------------
    // 3-5. S1 independence, S2 enrichment (report-level assertions above)
    // ---------------------------------------------------------------

    @Test
    fun s1OnlyInventoryIsNotDestroyedByFailedS2Collection() {
        val (_, result) = diagnostic(adbAuthorized = false, deviceSideInventory = s1Evidence())

        val reconciled = assertNotNull(result.evidence.reconciledApplicationInventory)
        // S2 attempted and unavailable; S1 evidence is fully intact.
        assertEquals(3, reconciled.records.size)
        assertTrue(reconciled.records.all { it.s1Record != null })
        assertEquals(3, reconciled.records.count { it.s2Record == null })
        assertFalse(reconciled.limitations.isEmpty())
    }

    @Test
    fun absentInventoryMeansNoSectionAndNoFabrication() {
        val (_, result) = diagnostic(adbAuthorized = false, deviceSideInventory = null)

        // No S1 supplied and S2 unavailable-with-no-records: reconciliation still exists
        // (S2 was attempted) but never fabricates records or upgrades completeness.
        val reconciled = assertNotNull(result.evidence.reconciledApplicationInventory)
        assertEquals(0, reconciled.records.size)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, reconciled.enumerationCompleteness)

        val section = assertNotNull(result.report.applicationInventory)
        assertFalse(section.inventoryAvailable)
        assertEquals(0, section.totalApplications)
        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, section.enumerationCompleteness)
    }

    // ---------------------------------------------------------------
    // 11-12. Sanitization eligibility gates
    // ---------------------------------------------------------------

    @Test
    fun sanitizationCannotBeginBeforeDeviceVerification() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())
        val preRecord = preRecordFor(result)

        val start = orchestrator.startSanitizationLifecycle(
            report1 = null,
            preRecord = preRecord,
            targetSerial = SERIAL,
        )
        assertFalse(start.eligibility.isEligible)
        assertNull(start.session)
        assertTrue(start.eligibility.blockReasons.any { it.contains("DEVICE_NOT_VERIFIED") })

        val completion = orchestrator.completeSanitizationLifecycle(
            start = start,
            operatorId = OPERATOR,
            operatorAcknowledged = true,
            operatorConfirmationPhrase = "CONFIRM PURGE ANYTHING",
            reconnectedTargetSerial = SERIAL,
        )
        assertFalse(completion.successClaimed)
        assertNull(completion.session)
        assertNull(completion.executionResult)
        assertNull(completion.finalReport)
        assertTrue(completion.blockReasons.isNotEmpty())
    }

    @Test
    fun sanitizationCannotBeginWithoutPreSanitizationEvidence() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())

        val start = orchestrator.startSanitizationLifecycle(
            report1 = result.report,
            preRecord = null,
            targetSerial = SERIAL,
        )
        assertFalse(start.eligibility.isEligible)
        assertNull(start.session)
        assertTrue(start.eligibility.blockReasons.any { it.contains("PRE_SANITIZATION_EVIDENCE_MISSING") })
    }

    @Test
    fun sanitizationEligibilityRejectsSessionTargetAndIntegrityMismatches() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())
        val preRecord = preRecordFor(result)

        val sessionMismatch = orchestrator.startSanitizationLifecycle(
            report1 = result.report,
            preRecord = preRecord.copy(sessionUuid = "OTHER-SESSION"),
            targetSerial = SERIAL,
        )
        assertFalse(sessionMismatch.eligibility.isEligible)
        assertTrue(sessionMismatch.eligibility.blockReasons.any { it.contains("TARGET_SESSION_MISMATCH") })

        val identityMismatch = orchestrator.startSanitizationLifecycle(
            report1 = result.report,
            preRecord = preRecord.copy(
                identity = result.report.deviceIdentity.copy(
                    model = EvidenceFieldResult("SM-OTHER", EvidenceStatus.AVAILABLE, "ADB"),
                ),
            ),
            targetSerial = SERIAL,
        )
        assertFalse(identityMismatch.eligibility.isEligible)
        assertTrue(identityMismatch.eligibility.blockReasons.any { it.contains("TARGET_IDENTITY_MISMATCH") })

        val missingIntegrity = orchestrator.startSanitizationLifecycle(
            report1 = result.report.copy(integrity = null),
            preRecord = preRecord,
            targetSerial = SERIAL,
        )
        assertFalse(missingIntegrity.eligibility.isEligible)
        assertTrue(missingIntegrity.eligibility.blockReasons.any { it.contains("REPORT_1_INTEGRITY_MISSING") })
    }

    // ---------------------------------------------------------------
    // 13-14. Blocked sanitization produces failure/block evidence,
    //        and success is never claimed without passing verification
    // ---------------------------------------------------------------

    @Test
    fun blockedSanitizationLifecycleProducesHonestFinalReport() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())
        val preRecord = preRecordFor(result)

        val start = orchestrator.startSanitizationLifecycle(
            report1 = result.report,
            preRecord = preRecord,
            targetSerial = SERIAL,
        )
        assertTrue(start.eligibility.isEligible)
        val startedSession = assertNotNull(start.session)
        val phrase = startedSession.barrier.step2PhraseRequired

        val completion = orchestrator.completeSanitizationLifecycle(
            start = start,
            operatorId = OPERATOR,
            operatorAcknowledged = true,
            operatorConfirmationPhrase = phrase,
            reconnectedTargetSerial = SERIAL,
        )

        // Execution was explicitly BLOCKED — no enrolled CYVRA sanitization agent exists on this target, and purge on this build is agent-based.
        val execution = assertNotNull(completion.executionResult)
        assertFalse(execution.isSuccess)
        assertEquals("BLOCKED_NOT_ELIGIBLE", execution.executionStatus)
        assertEquals(SanitizationWorkflowStep.FAILED, assertNotNull(completion.session).currentStep)

        // Post-sanitization verification honestly reports external verification required.
        val verification = assertNotNull(completion.verificationResult)
        assertEquals(
            SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION,
            verification.status,
        )

        // Final Report records that sanitization was NOT executed; success is not claimed.
        val finalReport = assertNotNull(completion.finalReport)
        assertEquals(SanitizationLifecycleOutcome.BLOCKED_NOT_EXECUTED, finalReport.lifecycleOutcome)
        assertFalse(finalReport.sanitizationSuccessClaimed)
        assertFalse(completion.successClaimed)
        assertNotNull(finalReport.blockReason)

        // Report 1 reference, evidence provenance, and conflicts are preserved.
        assertEquals(result.report.header.reportId, finalReport.verificationReportReference)
        assertTrue(finalReport.evidenceProvenance.contains("ANDROID_PACKAGE_MANAGER"))
        assertTrue(finalReport.conflicts.isNotEmpty())
        assertTrue(finalReport.preSanitizationRecord.sessionUuid.isNotEmpty())

        val json = assertNotNull(completion.finalReportJson)
        assertTrue(json.contains("BLOCKED_NOT_ELIGIBLE"))
        assertTrue(json.contains("lifecycleOutcome"))
        assertFalse(json.contains("SANITIZATION SUCCESS"))

        val markdown = assertNotNull(completion.finalReportMarkdown)
        assertTrue(markdown.contains("Sanitization Success Claimed:** false"))
    }

    // ---------------------------------------------------------------
    // 15. Final Report success requires passing post-sanitization verification
    // ---------------------------------------------------------------

    @Test
    fun finalReportSuccessRequiresPassingPostSanitizationVerification() {
        val (orchestrator, result) = diagnostic(adbAuthorized = false, deviceSideInventory = s1Evidence())
        val engine = HostReportEngine()
        val preRecord = preRecordFor(result)

        fun verification(status: SanitizationVerificationStatus) = VerificationResult(
            operationId = preRecord.operationId,
            sessionUuid = preRecord.sessionUuid,
            status = status,
            postResetStateDetected = status == SanitizationVerificationStatus.VERIFIED,
            userDataInaccessible = status == SanitizationVerificationStatus.VERIFIED,
            setupWizardDetected = status == SanitizationVerificationStatus.VERIFIED,
            assuranceLevel = "OBSERVED_POST_RESET_STATE_ERASURE_NOT_ESTABLISHED",
        )

        val executed = SanitizationExecutionResult(
            operationId = preRecord.operationId,
            method = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            isSuccess = true,
            executionStatus = "TRIGGERED_REBOOT_PENDING",
        )

        // Execution success + passing verification -> the only success outcome.
        val verifiedCert = engine.generateSanitizationCertificate(
            certificateId = "CYVRA-CERT-TEST-001",
            operatorId = OPERATOR,
            preRecord = preRecord,
            executionResult = executed,
            verificationResult = verification(SanitizationVerificationStatus.VERIFIED),
        )
        assertEquals(SanitizationLifecycleOutcome.EXECUTED_VERIFIED, verifiedCert.lifecycleOutcome)
        assertTrue(verifiedCert.sanitizationSuccessClaimed)
        assertNull(verifiedCert.blockReason)

        // Execution success WITHOUT passing verification -> success is not claimed.
        listOf(
            SanitizationVerificationStatus.REQUIRES_EXTERNAL_VERIFICATION,
            SanitizationVerificationStatus.PARTIALLY_VERIFIED,
            SanitizationVerificationStatus.FAILED,
        ).forEach { status ->
            val cert = engine.generateSanitizationCertificate(
                certificateId = "CYVRA-CERT-TEST-002",
                operatorId = OPERATOR,
                preRecord = preRecord,
                executionResult = executed,
                verificationResult = verification(status),
            )
            assertEquals(SanitizationLifecycleOutcome.EXECUTED_UNVERIFIED, cert.lifecycleOutcome, "status=$status")
            assertFalse(cert.sanitizationSuccessClaimed, "status=$status")
            assertNotNull(cert.blockReason)
        }

        // A simulated dry run can never become success even with a passing verification.
        val simulatedCert = engine.generateSanitizationCertificate(
            certificateId = "CYVRA-CERT-TEST-003",
            operatorId = OPERATOR,
            preRecord = preRecord,
            executionResult = executed.copy(executionStatus = "SIMULATED_SUCCESS_G5_NON_DESTRUCTIVE"),
            verificationResult = verification(SanitizationVerificationStatus.VERIFIED),
        )
        assertEquals(SanitizationLifecycleOutcome.SIMULATED_NOT_EXECUTED, simulatedCert.lifecycleOutcome)
        assertFalse(simulatedCert.sanitizationSuccessClaimed)

        // Sanity: orchestrator dependency wiring stayed intact for the lifecycle above.
        assertNotNull(orchestrator)
    }

    // ---------------------------------------------------------------
    // Target lock and operator-confirmation barriers on completion
    // ---------------------------------------------------------------

    @Test
    fun completionRequiresTheSameLockedTarget() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())
        val preRecord = preRecordFor(result)
        val start = orchestrator.startSanitizationLifecycle(result.report, preRecord, SERIAL)
        assertTrue(start.eligibility.isEligible)
        val phrase = assertNotNull(start.session).barrier.step2PhraseRequired

        val completion = orchestrator.completeSanitizationLifecycle(
            start = start,
            operatorId = OPERATOR,
            operatorAcknowledged = true,
            operatorConfirmationPhrase = phrase,
            reconnectedTargetSerial = "DIFFERENT-SERIAL",
        )
        assertNull(completion.executionResult)
        assertNull(completion.finalReport)
        assertFalse(completion.successClaimed)
        assertTrue(completion.blockReasons.any { it.contains("TARGET_MISMATCH") })
        assertEquals(SanitizationWorkflowStep.FAILED, assertNotNull(completion.session).currentStep)
    }

    @Test
    fun completionRequiresTheOperatorConfirmationBarrier() {
        val (orchestrator, result) = diagnostic(adbAuthorized = true, deviceSideInventory = s1Evidence())
        val preRecord = preRecordFor(result)
        val start = orchestrator.startSanitizationLifecycle(result.report, preRecord, SERIAL)
        assertTrue(start.eligibility.isEligible)

        val completion = orchestrator.completeSanitizationLifecycle(
            start = start,
            operatorId = OPERATOR,
            operatorAcknowledged = true,
            operatorConfirmationPhrase = "WRONG PHRASE",
            reconnectedTargetSerial = SERIAL,
        )
        assertNull(completion.executionResult)
        assertNull(completion.finalReport)
        assertFalse(completion.successClaimed)
        assertTrue(completion.blockReasons.any { it.contains("OPERATOR_CONFIRMATION_FAILED") })
    }
}
