package cyvra.mobile.host.service

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.DeviceVerificationReport
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.HostWorkstationConnectionStatus
import cyvra.mobile.core.WorkstationDeviceDescriptor
import cyvra.mobile.host.evidence.AdbGenericEvidenceProvider
import cyvra.mobile.host.evidence.HostCapabilityCoordinator
import cyvra.mobile.host.report.HostReportEngine
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
     */
    fun executeDiagnostic(
        serial: String,
        operatorId: String,
    ): WorkstationDiagnosticExecutionResult {
        val sessionUuid = "CYVRA-SESSION-${UUID.randomUUID().toString().take(12).uppercase()}"

        // 1. Transactionally commit scan entitlement
        val tx = licenseService.commitScanForSession(sessionUuid, serial)

        // 2. Collect evidence via generic ADB provider
        val evidenceProvider = AdbGenericEvidenceProvider(adbClient, serial, sessionUuid)
        val genericEvidence = evidenceProvider.collectAll()
        val profile = evidenceProvider.getCapabilityProfile()

        // 3. Coordinate capability assessment
        val capabilityCoordinator = HostCapabilityCoordinator(adbClient)
        val capabilityAssessment = capabilityCoordinator.assessConnectedDevice(
            serial = serial,
            profile = profile,
            evidence = genericEvidence,
        )

        // 4. Generate Report 1 with SHA-256 tamper-evident digest
        val reportId = "CYVRA-R1-${java.time.Year.now().value}-${UUID.randomUUID().toString().take(6).uppercase()}"
        val report = reportEngine.generateVerificationReport(
            reportId = reportId,
            operatorId = operatorId,
            evidence = genericEvidence,
            assessment = capabilityAssessment,
        )
        val reportJson = reportEngine.exportToJson(report)
        val reportMarkdown = reportEngine.renderMarkdown(report)

        // 5. Finalize scan consumption upon successful report creation
        val updatedLicense = licenseService.finalizeScanDebit(tx.transactionId)

        val descriptor = WorkstationDeviceDescriptor(
            serial = serial,
            manufacturer = genericEvidence.identity.manufacturer.value,
            model = genericEvidence.identity.model.value,
            androidVersion = genericEvidence.identity.androidVersion.value,
            apiLevel = genericEvidence.identity.apiLevel.value,
            connectionStatus = HostWorkstationConnectionStatus.READY_TO_SCAN,
            usbState = "USB_CONNECTED",
            adbState = "ADB_READY",
            activeSessionUuid = sessionUuid,
        )

        return WorkstationDiagnosticExecutionResult(
            sessionUuid = sessionUuid,
            deviceDescriptor = descriptor,
            evidence = genericEvidence,
            capabilityAssessment = capabilityAssessment,
            report = report,
            reportJson = reportJson,
            reportMarkdown = reportMarkdown,
            updatedLicense = updatedLicense,
        )
    }
}
