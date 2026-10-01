package cyvra.mobile.host.service

import cyvra.mobile.core.ApplicationInventoryEvidence
import cyvra.mobile.core.ApplicationInventoryReconciler
import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.DeviceVerificationReport
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.HostWorkstationConnectionStatus
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationCertificateReport
import cyvra.mobile.core.SanitizationEligibility
import cyvra.mobile.core.SanitizationExecutionResult
import cyvra.mobile.core.SanitizationWorkflowSession
import cyvra.mobile.core.SanitizationWorkflowStep
import cyvra.mobile.core.VerificationResult
import cyvra.mobile.core.WorkstationDeviceDescriptor
import cyvra.mobile.core.deriveSanitizationEligibility
import cyvra.mobile.host.evidence.AdbApplicationInventoryProvider
import cyvra.mobile.host.evidence.AdbGenericEvidenceProvider
import cyvra.mobile.host.evidence.HostCapabilityCoordinator
import cyvra.mobile.host.report.HostReportEngine
import cyvra.mobile.host.sanitization.HostSanitizationProvider
import cyvra.mobile.host.sanitization.HostSanitizationWorkflowEngine
import cyvra.mobile.host.sanitization.HostVerificationProvider
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.ConnectionDiagnosticSnapshot
import cyvra.mobile.host.transport.ConnectionStateMachine
import java.util.UUID

/**
 * Result bundle for an executed diagnostic scan.
 */
data class WorkstationDiagnosticExecutionResult(
    val sessionUuid: String,
    val deviceDescriptor: WorkstationDeviceDescriptor,
    val evidence: GenericDeviceEvidence,
    val capabilityAssessment: DeviceCapabilityAssessment,
    val report: DeviceVerificationReport,
    val reportJson: String,
    val reportMarkdown: String,
    val updatedLicense: CustomerLicenseRecord,
)

/**
 * Sanitization lifecycle start: eligibility decision plus the workflow session
 * (only when eligible). The session carries the required confirmation phrase the
 * operator must type back, so the 2-step barrier is genuinely operator-driven.
 */
data class SanitizationLifecycleStart(
    val eligibility: SanitizationEligibility,
    /** Null when ineligible: no workflow session may start without passing the gate. */
    val session: SanitizationWorkflowSession?,
    val report1: DeviceVerificationReport?,
    val preRecord: PreSanitizationRecord?,
    /** Target serial locked at start; the completion step must present the same target. */
    val targetSerial: String,
)

/**
 * Result of the integrated sanitization lifecycle (start + completion).
 *
 * Fail-closed: [successClaimed] can only be true when the Final Report's lifecycle
 * outcome is EXECUTED_VERIFIED (execution success AND passing post-sanitization
 * verification). Null execution/verification/report fields mean those stages never
 * ran — the reason is preserved verbatim in [blockReasons] (and, once execution has
 * been attempted, inside the Final Report itself as lifecycleOutcome/blockReason).
 */
data class WorkstationSanitizationLifecycleResult(
    val eligibility: SanitizationEligibility,
    /** Null when the lifecycle never started (eligibility gate). */
    val session: SanitizationWorkflowSession?,
    /** Null when execution never ran (eligibility/target/confirmation block). */
    val executionResult: SanitizationExecutionResult?,
    /** Null when post-sanitization verification never ran. */
    val verificationResult: VerificationResult?,
    /** Null when no execution attempt exists to record (pre-execution block). */
    val finalReport: SanitizationCertificateReport?,
    val finalReportJson: String?,
    val finalReportMarkdown: String?,
    val successClaimed: Boolean,
    val blockReasons: List<String> = emptyList(),
)

/**
 * Workstation Session Orchestrator connecting USB/ADB transport, Device State Machine,
 * Diagnostic Collection, and License Accounting (C2 + C3 + C4 / Phases 3, 6, 7).
 */
class WorkstationSessionOrchestrator(
    private val adbClient: AdbClient,
    private val licenseService: HostLicenseService,
    private val connectionStateMachine: ConnectionStateMachine = ConnectionStateMachine(),
    private val reportEngine: HostReportEngine = HostReportEngine(),
) {

    /**
     * Polls current USB and ADB state and maps to a user-friendly device descriptor.
     */
    fun pollDeviceState(usbConnected: Boolean): WorkstationDeviceDescriptor {
        val devices = adbClient.listDevices()
        val diagnostic = connectionStateMachine.evaluate(
            usbConnected = usbConnected,
            adbClientAvailable = true,
            discoveredDevices = devices,
        )

        val primaryDevice = devices.firstOrNull()

        val status = when {
            !usbConnected -> HostWorkstationConnectionStatus.DISCONNECTED
            primaryDevice == null -> HostWorkstationConnectionStatus.USB_DETECTED
            primaryDevice.state == "unauthorized" -> HostWorkstationConnectionStatus.ADB_UNAUTHORIZED
            primaryDevice.state == "offline" -> HostWorkstationConnectionStatus.ADB_OFFLINE
            primaryDevice.state == "device" -> HostWorkstationConnectionStatus.READY_TO_SCAN
            else -> HostWorkstationConnectionStatus.USB_DETECTED
        }

        return WorkstationDeviceDescriptor(
            serial = primaryDevice?.serial ?: "NONE",
            manufacturer = primaryDevice?.model?.substringBefore("_") ?: "Android",
            model = primaryDevice?.model ?: "Unknown Device",
            connectionStatus = status,
            usbState = diagnostic.usbState.name,
            adbState = diagnostic.adbState.name,
            operatorGuidance = diagnostic.operatorActionRequired,
        )
    }

    /**
     * Executes Advanced Diagnostic on the connected device (C4 / Phase 7).
     * Non-destructive: queries device parameters via controlled ADB and generates Report 1.
     *
     * Application inventory integration:
     * - [deviceSideInventory] is the S1 device-side inventory (collected by the device-side
     *   PackageManager collector, independent of ADB). It may be supplied when ADB is off;
     *   S1 evidence is never gated on ADB availability.
     * - The S2 authorized-ADB inventory is attempted only as enrichment when [serial] is
     *   known; any failure degrades to "S2 not collected" and never fails the scan.
     * - Both sources are reconciled through [ApplicationInventoryReconciler]; provenance,
     *   completeness, limitations, and conflicts are preserved into [GenericDeviceEvidence]
     *   (reconciliation is null only when no source was collected at all).
     */
    fun executeDiagnostic(
        serial: String,
        operatorId: String,
        deviceSideInventory: ApplicationInventoryEvidence? = null,
    ): WorkstationDiagnosticExecutionResult {
        val sessionUuid = "CYVRA-SESSION-${UUID.randomUUID().toString().take(12).uppercase()}"

        /*
         * 1. Reserve the scan as a committed-pending transaction.
         *
         * The balance is deliberately untouched: §14 makes RUN_SCAN a
         * reservation, not a purchase. Only a certificate that actually
         * exists may cost the customer a scan, and that happens in
         * `HostProtocolDispatcher.finalReportResponse`, not here.
         */
        licenseService.commitScanForSession(sessionUuid, serial)

        return try {
            collectReservedDiagnostic(sessionUuid, serial, operatorId, deviceSideInventory)
        } catch (error: Throwable) {
            /*
             * Evidence collection, assessment or report generation failed, so
             * this session will never reach a certificate. Release the
             * reservation instead of leaving it pending forever - that is what
             * makes "an abandoned scan is not debited" a state the ledger can
             * point at rather than merely an event that did not occur.
             */
            licenseService.abandonScan(sessionUuid)
            throw error
        }
    }

    /** The work done *inside* a reserved scan session. */
    private fun collectReservedDiagnostic(
        sessionUuid: String,
        serial: String,
        operatorId: String,
        deviceSideInventory: ApplicationInventoryEvidence?,
    ): WorkstationDiagnosticExecutionResult {
        // 2. Collect evidence via generic ADB provider
        val evidenceProvider = AdbGenericEvidenceProvider(adbClient, serial, sessionUuid)
        val genericEvidence = evidenceProvider.collectAll()
        val profile = evidenceProvider.getCapabilityProfile()

        // 2b. Application inventory: S2 authorized-ADB enrichment (optional, never required),
        //     then deterministic S1+S2 reconciliation. ADB being off/unauthorized/failing
        //     only means S2 contributes nothing — S1 evidence is unaffected.
        val adbInventory = try {
            if (serial.isBlank()) null else AdbApplicationInventoryProvider(adbClient, serial).collect()
        } catch (e: Exception) {
            null
        }
        val reconciledInventory =
            if (deviceSideInventory == null && adbInventory == null) {
                null
            } else {
                ApplicationInventoryReconciler.reconcile(deviceSideInventory, adbInventory)
            }
        val evidence = genericEvidence.copy(
            applicationInventory = deviceSideInventory ?: adbInventory,
            reconciledApplicationInventory = reconciledInventory,
        )

        // 3. Coordinate capability assessment
        val capabilityCoordinator = HostCapabilityCoordinator(adbClient)
        val capabilityAssessment = capabilityCoordinator.assessConnectedDevice(
            serial = serial,
            profile = profile,
            evidence = evidence,
        )

        // 4. Generate Report 1 with SHA-256 tamper-evident digest
        val reportId = "CYVRA-R1-${java.time.Year.now().value}-${UUID.randomUUID().toString().take(6).uppercase()}"
        val report = reportEngine.generateVerificationReport(
            reportId = reportId,
            operatorId = operatorId,
            evidence = evidence,
            assessment = capabilityAssessment,
        )
        val reportJson = reportEngine.exportToJson(report)
        val reportMarkdown = reportEngine.renderMarkdown(report)

        /*
         * 5. Nothing is spent here.
         *
         * §14 makes RUN_SCAN a *reservation*, not a purchase: the transaction is
         * committed-pending and the entitlement balance is untouched, because a
         * report that is never delivered, a scan the operator abandons, or a
         * session whose Final Report is never generated must not have cost the
         * customer anything. The debit happens in finalReportResponse, at the
         * moment a certificate actually exists, and nowhere earlier.
         *
         * `updatedLicense` therefore reports the balance as it still stands.
         * Returning the pre-debit figure is not cosmetic: RUN_SCAN's response
         * carries it, and a workstation that claimed to have spent a scan on a
         * report it had not yet written would be reporting a transaction that
         * had not happened.
         */
        val updatedLicense = licenseService.getLicense()

        val descriptor = WorkstationDeviceDescriptor(
            serial = serial,
            manufacturer = evidence.identity.manufacturer.value,
            model = evidence.identity.model.value,
            androidVersion = evidence.identity.androidVersion.value,
            apiLevel = evidence.identity.apiLevel.value,
            connectionStatus = HostWorkstationConnectionStatus.READY_TO_SCAN,
            usbState = "USB_CONNECTED",
            adbState = "ADB_READY",
            activeSessionUuid = sessionUuid,
        )

        return WorkstationDiagnosticExecutionResult(
            sessionUuid = sessionUuid,
            deviceDescriptor = descriptor,
            evidence = evidence,
            capabilityAssessment = capabilityAssessment,
            report = report,
            reportJson = reportJson,
            reportMarkdown = reportMarkdown,
            updatedLicense = updatedLicense,
        )
    }

    /**
     * Starts the sanitization lifecycle at the eligibility boundary (DEVICE VERIFIED +
     * PRE-SANITIZATION EVIDENCE). Ineligible starts return no session, so no later step
     * (confirmation, execution, verification, Final Report) can be reached without
     * passing the gate. The returned session locks [targetSerial] and carries the
     * confirmation phrase the operator must type back in [completeSanitizationLifecycle].
     */
    fun startSanitizationLifecycle(
        report1: DeviceVerificationReport?,
        preRecord: PreSanitizationRecord?,
        targetSerial: String,
    ): SanitizationLifecycleStart {
        val eligibility = deriveSanitizationEligibility(report1, preRecord)
        val session = if (eligibility.isEligible && report1 != null && preRecord != null) {
            sanitizationWorkflowEngine(targetSerial).initializeSession(
                sessionUuid = report1.header.sessionUuid,
                deviceIdentifier = targetSerial,
                capabilityAssessment = report1.capabilityAssessment,
            )
        } else {
            null
        }

        return SanitizationLifecycleStart(
            eligibility = eligibility,
            session = session,
            report1 = report1,
            preRecord = preRecord,
            targetSerial = targetSerial,
        )
    }

    /**
     * Completes the sanitization lifecycle after operator input:
     * TARGET LOCK -> 2-step OPERATOR CONFIRMATION (existing state machine) ->
     * EXECUTION (explicitly blocked in this build — no validated destructive provider) ->
     * POST-SANITIZATION VERIFICATION (honest status) -> FINAL REPORT (gated).
     *
     * Safety invariants enforced here:
     * - Target lock: [reconnectedTargetSerial] must equal the target locked at start.
     * - The existing confirmation barrier must pass before any execution attempt.
     * - Execution never runs dry-run simulation: it records explicit
     *   BLOCKED/NOT_IMPLEMENTED evidence instead of issuing any destructive command.
     * - The Final Report never claims success without passing post-sanitization
     *   verification (gate lives in [HostReportEngine.generateSanitizationCertificate]).
     */
    fun completeSanitizationLifecycle(
        start: SanitizationLifecycleStart,
        operatorId: String,
        operatorAcknowledged: Boolean,
        operatorConfirmationPhrase: String,
        reconnectedTargetSerial: String,
        postRebootEvidence: GenericDeviceEvidence? = null,
    ): WorkstationSanitizationLifecycleResult {
        val report1 = start.report1
        val preRecord = start.preRecord
        val startedSession = start.session

        if (!start.eligibility.isEligible || report1 == null || preRecord == null || startedSession == null) {
            return WorkstationSanitizationLifecycleResult(
                eligibility = start.eligibility,
                session = null,
                executionResult = null,
                verificationResult = null,
                finalReport = null,
                finalReportJson = null,
                finalReportMarkdown = null,
                successClaimed = false,
                blockReasons = start.eligibility.blockReasons,
            )
        }

        // TARGET LOCK: the target presented for execution must be the locked target.
        if (reconnectedTargetSerial != start.targetSerial) {
            val blockReason =
                "TARGET_MISMATCH: presented target '$reconnectedTargetSerial' does not match the locked sanitization target."
            return WorkstationSanitizationLifecycleResult(
                eligibility = start.eligibility,
                session = startedSession.copy(
                    currentStep = SanitizationWorkflowStep.FAILED,
                    failureReason = blockReason,
                ),
                executionResult = null,
                verificationResult = null,
                finalReport = null,
                finalReportJson = null,
                finalReportMarkdown = null,
                successClaimed = false,
                blockReasons = listOf(blockReason),
            )
        }

        val engine = sanitizationWorkflowEngine(start.targetSerial)

        // OPERATOR CONFIRMATION: existing 2-step barrier, driven by explicit operator input.
        var session = engine.toggleStep1Acknowledgement(startedSession, operatorAcknowledged)
        session = engine.submitStep2Confirmation(session, operatorConfirmationPhrase, operatorId)
        if (!session.barrier.isBarrierPassed) {
            val blockReason = "OPERATOR_CONFIRMATION_FAILED: 2-step operator confirmation barrier not passed."
            return WorkstationSanitizationLifecycleResult(
                eligibility = start.eligibility,
                session = session.copy(
                    currentStep = SanitizationWorkflowStep.FAILED,
                    failureReason = blockReason,
                ),
                executionResult = null,
                verificationResult = null,
                finalReport = null,
                finalReportJson = null,
                finalReportMarkdown = null,
                successClaimed = false,
                blockReasons = listOf(blockReason),
            )
        }

        session = engine.selectMethod(session, session.selectedMethod)

        // EXECUTION: dryRunOnly = false reaches the provider's explicit BLOCKED path —
        // the build cannot issue a destructive command and records honest block evidence.
        session = engine.executePurge(session, preRecord, dryRunOnly = false)

        val executionResult = session.executionResult
        if (executionResult == null) {
            val blockReason = "EXECUTION_EVIDENCE_MISSING: sanitization execution produced no evidence record."
            return WorkstationSanitizationLifecycleResult(
                eligibility = start.eligibility,
                session = session.copy(
                    currentStep = SanitizationWorkflowStep.FAILED,
                    failureReason = blockReason,
                ),
                executionResult = null,
                verificationResult = null,
                finalReport = null,
                finalReportJson = null,
                finalReportMarkdown = null,
                successClaimed = false,
                blockReasons = listOf(blockReason),
            )
        }

        // POST-SANITIZATION VERIFICATION: honest status; never assumed to pass.
        val verificationResult = HostVerificationProvider(adbClient, start.targetSerial).verifyPostReset(
            operationId = executionResult.operationId,
            sessionUuid = session.sessionUuid,
            postRebootEvidence = postRebootEvidence,
        )
        session = session.copy(verificationResult = verificationResult)

        // FINAL REPORT: lifecycle outcome + success claim derived fail-closed inside
        // the report engine; Report 1 reference, provenance, and conflicts are carried over.
        val inventorySection = report1.applicationInventory
        val finalReport = reportEngine.generateSanitizationCertificate(
            certificateId = "CYVRA-CERT-${java.time.Year.now().value}-${UUID.randomUUID().toString().take(6).uppercase()}",
            operatorId = operatorId,
            preRecord = preRecord,
            executionResult = executionResult,
            verificationResult = verificationResult,
            limitations = listOf(
                "Integrated engineering build: sanitization lifecycle outcome is recorded " +
                    "explicitly in lifecycleOutcome; success is claimed only after passing " +
                    "post-sanitization verification.",
            ),
            verificationReportReference = report1.header.reportId,
            evidenceProvenance = inventorySection?.collectionMethods?.distinct() ?: emptyList(),
            conflicts = inventorySection?.conflicts ?: emptyList(),
        )

        return WorkstationSanitizationLifecycleResult(
            eligibility = start.eligibility,
            session = session,
            executionResult = executionResult,
            verificationResult = verificationResult,
            finalReport = finalReport,
            finalReportJson = reportEngine.exportToJson(finalReport),
            finalReportMarkdown = reportEngine.renderMarkdown(finalReport),
            successClaimed = finalReport.sanitizationSuccessClaimed,
            blockReasons = listOfNotNull(finalReport.blockReason),
        )
    }

    /** Builds the sanitization workflow engine bound to the locked target serial. */
    private fun sanitizationWorkflowEngine(serial: String): HostSanitizationWorkflowEngine =
        HostSanitizationWorkflowEngine(
            sanitizationProvider = HostSanitizationProvider(adbClient, serial),
            verificationProvider = HostVerificationProvider(adbClient, serial),
        )
}
