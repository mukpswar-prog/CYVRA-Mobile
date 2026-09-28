package cyvra.mobile.host.protocol

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileResult
import cyvra.mobile.host.report.HostReportEngine
import cyvra.mobile.host.report.HostReportStore
import cyvra.mobile.host.service.HostBootstrap
import cyvra.mobile.host.service.HostLicenseService
import cyvra.mobile.host.service.SanitizationLifecycleStart
import cyvra.mobile.host.service.WorkstationDiagnosticExecutionResult
import cyvra.mobile.host.service.WorkstationSanitizationLifecycleResult
import cyvra.mobile.host.service.WorkstationSessionOrchestrator
import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.ConnectionStateMachine
import cyvra.mobile.host.transport.HostPreflightVerifier
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put

class HostProtocolDispatcher(
    private val preflightVerifier: HostPreflightVerifier = HostPreflightVerifier(),
    private val adbLocator: AdbBinaryLocator = AdbBinaryLocator(),
    private val connectionStateMachine: ConnectionStateMachine = ConnectionStateMachine(),
    private val licenseResultProvider: () -> LicenseFileResult = { HostBootstrap.licenseResult },
    private val orchestratorFactory: (java.io.File, HostLicenseService) -> WorkstationSessionOrchestrator =
        { binary, licenseService ->
            WorkstationSessionOrchestrator(AdbClient(binary), licenseService)
        },
    private val reportEngine: HostReportEngine = HostReportEngine(),
    /**
     * Persists exported artifacts. Shares [reportEngine] by default so the digests echoed
     * on the wire and the digests stored in `manifest.json` are always the same bytes.
     */
    private val reportStore: HostReportStore = HostReportStore(reportEngine = reportEngine),
) {

    private val json = Json {
        encodeDefaults = true
    }

    /*
     * P2 workflow state.
     *
     * The Host is a single long-lived process reading JSON-lines on stdin, so one
     * dispatcher instance serves the whole operator session. These fields are the
     * server-side half of the workflow: a later command can only succeed because an
     * earlier one actually ran. Nothing here is supplied by the client, so no step can
     * be reached by asserting that it already happened.
     *
     * A successful RUN_SCAN clears every sanitization field: a new scan invalidates the
     * previous report, so the prior eligibility gate, target lock and confirmation can
     * never carry over onto fresh evidence.
     */
    private var lastScan: WorkstationDiagnosticExecutionResult? = null
    private var lifecycleStart: SanitizationLifecycleStart? = null
    private var operatorAcknowledged: Boolean? = null
    private var operatorConfirmationPhrase: String? = null
    private var lifecycleResult: WorkstationSanitizationLifecycleResult? = null

    /** Licence state, resolved once so the reason a scan is refused never shifts mid-session. */
    private val licenseResult: LicenseFileResult by lazy { licenseResultProvider() }

    /**
     * Entitlement accounting lives for the whole process, so consecutive scans debit a
     * single balance rather than starting from a fresh record each time.
     */
    private val licenseService: HostLicenseService by lazy {
        HostLicenseService(licenseResult.record)
    }

    private var cachedOrchestrator: WorkstationSessionOrchestrator? = null

    fun dispatch(request: HostRequest): HostResponse {
        return when (request.command) {
            HostCommand.GET_HOST_INFO -> hostInfoResponse(request)
            HostCommand.GET_PREFLIGHT -> preflightResponse(request)
            HostCommand.GET_DEVICE_STATE -> deviceStateResponse(request)
            HostCommand.RUN_SCAN -> runScanResponse(request)
            HostCommand.GET_DEVICE_REPORT -> deviceReportResponse(request)
            HostCommand.GET_APPLICATION_INVENTORY -> applicationInventoryResponse(request)
            HostCommand.EXPORT_REPORT -> exportReportResponse(request)
            HostCommand.SANITIZE_START -> sanitizeStartResponse(request)
            HostCommand.SANITIZE_AUTHORIZE -> sanitizeAuthorizeResponse(request)
            HostCommand.SANITIZE_CONFIRM -> sanitizeConfirmResponse(request)
            HostCommand.SANITIZE_EXECUTE -> sanitizeExecuteResponse(request)
            HostCommand.SANITIZE_VERIFY -> sanitizeVerifyResponse(request)
            HostCommand.GET_FINAL_REPORT -> finalReportResponse(request)
        }
    }

    private fun hostInfoResponse(request: HostRequest): HostResponse {
        return HostResponse(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = request.requestId,
            status = HostResponseStatus.OK,
            hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
        )
    }

    private fun preflightResponse(request: HostRequest): HostResponse {
        return try {
            val result = preflightVerifier.runPreflight()

            HostResponse(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = request.requestId,
                status = HostResponseStatus.OK,
                hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
                payload = run {
                    val encoded = json.encodeToJsonElement(result)
                    encoded as? JsonObject
                        ?: throw IllegalStateException(
                            "Preflight result did not encode as a JSON object"
                        )
                },
            )
        } catch (error: Exception) {
            errorResponse(
                request = request,
                code = "PREFLIGHT_FAILED",
                message = error.message ?: "Host preflight failed",
            )
        }
    }

    private fun deviceStateResponse(request: HostRequest): HostResponse {
        return try {
            /*
             * Physical USB truth arrives from the Rust Windows USB plane
             * (SetupAPI present-device enumeration) via the request
             * payload. The Host must not infer physical USB state from
             * ADB device discovery (FSB-003; canonical guideline 8.3).
             */
            val usbConnected =
                (request.payload["usbConnected"] as? JsonPrimitive)?.booleanOrNull
                    ?: return errorResponse(
                        request = request,
                        code = "USB_STATE_MISSING",
                        message = "GET_DEVICE_STATE requires payload.usbConnected " +
                            "from the Rust Windows USB plane",
                    )

            val usbObservationState =
                (request.payload["usbObservationState"] as? JsonPrimitive)?.contentOrNull
                    ?: return errorResponse(
                        request = request,
                        code = "USB_STATE_MISSING",
                        message = "GET_DEVICE_STATE requires payload.usbObservationState " +
                            "from the Rust Windows USB plane",
                    )

            /*
             * A Windows API failure must never be presented as proof
             * that no device is attached (transport architecture 3.3).
             */
            when (usbObservationState) {
                "USB_OBSERVATION_UNKNOWN" -> {
                    return errorResponse(
                        request = request,
                        code = "USB_OBSERVATION_UNKNOWN",
                        message = "Windows USB observation failed; " +
                            "absence of a device cannot be asserted",
                    )
                }

                "USB_PRESENT", "USB_NOT_PRESENT" -> Unit

                else -> {
                    return errorResponse(
                        request = request,
                        code = "USB_STATE_INVALID",
                        message = "Unrecognized usbObservationState: $usbObservationState",
                    )
                }
            }

            /*
             * ADB discovery refines ADB state only. A missing ADB
             * binary degrades to "ADB unavailable" instead of failing
             * the request: USB state must remain answerable without ADB.
             */
            val adbBinary = adbLocator.locate()
            val discoveredDevices = adbBinary
                ?.let { AdbClient(it).listDevices() }
                .orEmpty()

            val snapshot = connectionStateMachine.evaluate(
                usbConnected = usbConnected,
                adbClientAvailable = adbBinary != null,
                discoveredDevices = discoveredDevices,
            )

            val payload = buildJsonObject {
                put("connectionState", snapshot.connectionState.name)
                put("usbState", snapshot.usbState.name)
                put("adbState", snapshot.adbState.name)
                put("adbAvailable", snapshot.adbAvailable)
                put("readyToScan", snapshot.readyToScan)
                put("statusMessage", snapshot.statusMessage)
                put("usbObservationState", usbObservationState)

                snapshot.operatorActionRequired?.let {
                    put("operatorActionRequired", it)
                }

                snapshot.deviceDescriptor?.let { descriptor ->
                    put(
                        "device",
                        json.encodeToJsonElement(descriptor)
                    )
                }
            }

            HostResponse(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = request.requestId,
                status = HostResponseStatus.OK,
                hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
                payload = payload,
            )
        } catch (error: Exception) {
            errorResponse(
                request = request,
                code = "DEVICE_STATE_FAILED",
                message = error.message ?: "Device state evaluation failed",
            )
        }
    }

    // ------------------------------------------------------------------
    // P2 workflow commands: scan -> reports -> sanitization lifecycle
    // ------------------------------------------------------------------

    /**
     * RUN_SCAN routes to `WorkstationSessionOrchestrator.executeDiagnostic`.
     *
     * The licence is checked before anything else: a denied [FileBasedLicenseProvider]
     * result refuses the scan with `LICENSE_REQUIRED` carrying the reason, rather than
     * letting entitlement accounting throw a misleading "no scans remaining" later.
     */
    private fun runScanResponse(request: HostRequest): HostResponse {
        val license = licenseResult
        if (!license.isLicensed) {
            return errorResponse(
                request = request,
                code = LICENSE_REQUIRED,
                message = "Scan refused: no usable licence is installed " +
                    "(reason=${license.reason}). Install a valid " +
                    "${FileBasedLicenseProvider.LICENSE_FILE_NAME} in the installation " +
                    "root to enable scanning.",
            )
        }

        val serial = request.stringPayload(KEY_SERIAL)
            ?: return errorResponse(
                request = request,
                code = "SCAN_REQUEST_INVALID",
                message = "RUN_SCAN requires payload.serial",
            )
        val operatorId = request.stringPayload(KEY_OPERATOR_ID) ?: DEFAULT_OPERATOR_ID

        val adbBinary = adbLocator.locate()
            ?: return errorResponse(
                request = request,
                code = "ADB_UNAVAILABLE",
                message = "RUN_SCAN requires an ADB binary and none was resolved on this machine",
            )

        val sideInventory = when (val element = request.objectPayload(KEY_DEVICE_SIDE_INVENTORY)) {
            null -> null
            else -> try {
                json.decodeFromString(
                    cyvra.mobile.core.ApplicationInventoryEvidence.serializer(),
                    element.toString(),
                )
            } catch (error: Exception) {
                return errorResponse(
                    request = request,
                    code = "SCAN_REQUEST_INVALID",
                    message = "payload.deviceSideInventory is not a valid S1 inventory document",
                )
            }
        }

        val result = try {
            orchestratorFor(adbBinary).executeDiagnostic(
                serial = serial,
                operatorId = operatorId,
                deviceSideInventory = sideInventory,
            )
        } catch (error: IllegalStateException) {
            return errorResponse(
                request = request,
                code = "SCAN_REFUSED",
                message = error.message ?: "Scan refused by entitlement accounting",
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = "SCAN_FAILED",
                message = error.message ?: "Diagnostic scan failed",
            )
        }

        lastScan = result
        resetSanitizationState()

        val section = result.report.applicationInventory
        return okResponse(
            request,
            buildJsonObject {
                put("scanStatus", "COMPLETED")
                put("sessionUuid", result.sessionUuid)
                put("reportId", result.report.header.reportId)
                put(KEY_SERIAL, serial)
                put(KEY_OPERATOR_ID, operatorId)
                put("scansRemaining", result.updatedLicense.scansRemaining)
                put("inventoryAvailable", section?.inventoryAvailable ?: false)
                put("enumerationCompleteness", section?.enumerationCompleteness?.name ?: "UNAVAILABLE")
            },
        )
    }

    /** GET_DEVICE_REPORT returns Report 1 exactly as it was generated by the scan. */
    private fun deviceReportResponse(request: HostRequest): HostResponse {
        val scan = lastScan ?: return noScanError(request, "GET_DEVICE_REPORT")
        val reportObject = json.parseToJsonElement(scan.reportJson) as? JsonObject
            ?: return errorResponse(
                request = request,
                code = "REPORT_UNAVAILABLE",
                message = "Report 1 did not encode as a JSON object",
            )

        return okResponse(
            request,
            buildJsonObject {
                put("reportId", scan.report.header.reportId)
                put("sessionUuid", scan.report.header.sessionUuid)
                put(KEY_SERIAL, scan.deviceDescriptor.serial)
                put("report", reportObject)
                put("reportMarkdown", scan.reportMarkdown)
                put("jsonSha256", reportEngine.computeSha256(scan.reportJson))
            },
        )
    }

    /**
     * GET_APPLICATION_INVENTORY returns the S1/S2 inventory summary and completeness.
     *
     * Deliberately limited to the Report 1 inventory section: raw application records
     * carry device UIDs, and raw UID values are withheld from the user-facing report.
     * Completeness is reported verbatim - FILTERED never becomes COMPLETE here, and an
     * unavailable source stays UNAVAILABLE rather than being dropped.
     */
    private fun applicationInventoryResponse(request: HostRequest): HostResponse {
        val scan = lastScan ?: return noScanError(request, "GET_APPLICATION_INVENTORY")
        val section = scan.report.applicationInventory

        return okResponse(
            request,
            buildJsonObject {
                put("inventoryAvailable", section?.inventoryAvailable ?: false)
                put("totalApplications", section?.totalApplications ?: 0)
                put("enumerationCompleteness", section?.enumerationCompleteness?.name ?: "UNAVAILABLE")
                put("s1EvidencePresent", section?.s1EvidencePresent ?: false)
                put("s2EvidencePresent", section?.s2EvidencePresent ?: false)
                section?.s1EnumerationCompleteness?.let { put("s1EnumerationCompleteness", it.name) }
                section?.s2EnumerationCompleteness?.let { put("s2EnumerationCompleteness", it.name) }
                put("preinstalledSystemCount", section?.preinstalledSystemCount ?: 0)
                put("updatedSystemCount", section?.updatedSystemCount ?: 0)
                put("userThirdPartyCount", section?.userThirdPartyCount ?: 0)
                put("unknownClassificationCount", section?.unknownClassificationCount ?: 0)
                put("enabledCount", section?.enabledCount ?: 0)
                put("disabledCount", section?.disabledCount ?: 0)
                put("defaultEnabledCount", section?.defaultEnabledCount ?: 0)
                put("unknownEnabledStateCount", section?.unknownEnabledStateCount ?: 0)
                put("s1OnlyCount", section?.s1OnlyCount ?: 0)
                put("s2OnlyCount", section?.s2OnlyCount ?: 0)
                put("bothCount", section?.bothCount ?: 0)
                put("s1ProvenanceCount", section?.s1ProvenanceCount ?: 0)
                put("s2ProvenanceCount", section?.s2ProvenanceCount ?: 0)
                put("conflictCount", section?.conflictCount ?: 0)
                put("collectionMethods", stringArray(section?.collectionMethods))
                put("conflicts", stringArray(section?.conflicts))
                put("limitations", stringArray(section?.limitations))
                put("rawUidWithheld", true)
            },
        )
    }

    /**
     * EXPORT_REPORT returns Report 1 in both formats and persists it under
     * `<cyvra.home>/reports/<reportId>/`.
     *
     * Report generation is untouched: the strings handed to the store are exactly the ones
     * already returned here, so the file on disk and the payload on the wire agree.
     */
    private fun exportReportResponse(request: HostRequest): HostResponse {
        val scan = lastScan ?: return noScanError(request, "EXPORT_REPORT")
        val jsonContent = scan.reportJson
        val markdownContent = scan.reportMarkdown

        val written = try {
            reportStore.writeReport(
                reportId = scan.report.header.reportId,
                jsonContent = jsonContent,
                markdownContent = markdownContent,
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = REPORT_WRITE_FAILED,
                message = error.message ?: "Report artifacts could not be written to disk",
            )
        }

        return okResponse(
            request,
            buildJsonObject {
                put("reportId", scan.report.header.reportId)
                put("format", "json+markdown")
                put("reportJson", jsonContent)
                put("reportMarkdown", markdownContent)
                put("reportJsonPath", written.jsonPath)
                put("reportMarkdownPath", written.markdownPath)
                put("manifestPath", written.manifestPath)
                put("artifactsWritten", true)
                put(
                    "manifest",
                    buildJsonObject {
                        put("algorithm", "SHA-256")
                        put("jsonSha256", written.jsonSha256)
                        put("markdownSha256", written.markdownSha256)
                    },
                )
            },
        )
    }

    /**
     * SANITIZE_START opens the eligibility gate.
     *
     * The pre-record is derived entirely from the Report 1 this Host just produced.
     * Identity, storage, battery and capability evidence are never taken from the wire:
     * accepting them would let a caller assert a device the scan never observed.
     *
     * `isAuthorized` stays false here. Authorization exists only once the operator
     * passes the 2-step barrier, at which point `executePurge` derives the authorized
     * record from the barrier itself.
     */
    private fun sanitizeStartResponse(request: HostRequest): HostResponse {
        val scan = lastScan ?: return noScanError(request, "SANITIZE_START")
        val orchestrator = cachedOrchestrator
            ?: return noScanError(request, "SANITIZE_START")

        val operatorId = request.stringPayload(KEY_OPERATOR_ID)
            ?: scan.report.header.operatorId
        val targetSerial = request.stringPayload(KEY_SERIAL) ?: scan.deviceDescriptor.serial

        val preRecord = PreSanitizationRecord(
            operationId = PLACEHOLDER_OPERATION_ID,
            sessionUuid = scan.report.header.sessionUuid,
            identity = scan.report.deviceIdentity,
            storageSnapshot = scan.report.storageSnapshot,
            batterySnapshot = scan.report.batterySnapshot,
            selectedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
            capabilityAssessment = scan.report.capabilityAssessment,
            authorization = AuthorizationRequirement(
                operationId = PLACEHOLDER_OPERATION_ID,
                requiresOperatorConfirmation = true,
                confirmationPhrase = "",
                isAuthorized = false,
                reason = "Pre-record captured before operator confirmation; " +
                    "authorization is granted only by the 2-step barrier.",
            ),
            operatorId = operatorId,
        )

        val started = orchestrator.startSanitizationLifecycle(
            report1 = scan.report,
            preRecord = preRecord,
            targetSerial = targetSerial,
        )

        /*
         * Align the pre-record with the session the gate just opened. Eligibility
         * inspects only session, identity and integrity - never these fields - and
         * `executePurge` overwrites them again at execution, so this keeps the Final
         * Report's pre-record consistent with the operation that actually ran.
         */
        val session = started.session
        val aligned = if (session != null) {
            started.copy(
                preRecord = preRecord.copy(
                    operationId = session.operationId,
                    selectedMethod = session.selectedMethod,
                    authorization = preRecord.authorization.copy(
                        operationId = session.operationId,
                        confirmationPhrase = session.barrier.step2PhraseRequired,
                    ),
                ),
            )
        } else {
            started
        }

        lifecycleStart = aligned
        resetSanitizationState(keepStart = true)

        if (!aligned.eligibility.isEligible || session == null) {
            val reasons = aligned.eligibility.blockReasons
            return errorResponse(
                request = request,
                code = "SANITIZE_NOT_ELIGIBLE",
                message = reasons.joinToString("; ").ifBlank {
                    "Sanitization cannot begin for this report"
                },
            )
        }

        return okResponse(
            request,
            buildJsonObject {
                put("eligible", true)
                put(KEY_SERIAL, aligned.targetSerial)
                put("operationId", session.operationId)
                put("currentStep", session.currentStep.name)
                put("step1AcknowledgementRequired", true)
                put("step2PhraseRequired", session.barrier.step2PhraseRequired)
            },
        )
    }

    /** SANITIZE_AUTHORIZE records step 1 of the 2-step operator barrier. */
    private fun sanitizeAuthorizeResponse(request: HostRequest): HostResponse {
        val start = lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_AUTHORIZE",
            )
        val session = start.session ?: return notEligibleError(request)

        val acknowledged = (request.payload[KEY_ACKNOWLEDGED] as? JsonPrimitive)?.booleanOrNull
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_REQUEST_INVALID",
                message = "SANITIZE_AUTHORIZE requires payload.acknowledged (boolean)",
            )

        operatorAcknowledged = acknowledged
        // A new acknowledgement invalidates any phrase recorded against the previous one.
        operatorConfirmationPhrase = null

        return okResponse(
            request,
            buildJsonObject {
                put("step", "STEP1_ACKNOWLEDGEMENT_RECORDED")
                put("acknowledged", acknowledged)
                put("operationId", session.operationId)
                put("step2PhraseRequired", session.barrier.step2PhraseRequired)
            },
        )
    }

    /**
     * SANITIZE_CONFIRM records step 2: the typed confirmation phrase.
     *
     * The phrase is validated against the one issued by SANITIZE_START, so a mismatch
     * is refused here instead of silently reaching the execution step.
     */
    private fun sanitizeConfirmResponse(request: HostRequest): HostResponse {
        val start = lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_CONFIRM",
            )
        val session = start.session ?: return notEligibleError(request)

        if (operatorAcknowledged != true) {
            return errorResponse(
                request = request,
                code = "SANITIZE_ACK_REQUIRED",
                message = "Step 1 acknowledgement must be recorded before the confirmation phrase is accepted",
            )
        }

        val phrase = request.stringPayload(KEY_CONFIRMATION_PHRASE)
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_REQUEST_INVALID",
                message = "SANITIZE_CONFIRM requires payload.confirmationPhrase",
            )

        val required = session.barrier.step2PhraseRequired
        if (phrase.trim() != required.trim()) {
            return errorResponse(
                request = request,
                code = "SANITIZE_PHRASE_MISMATCH",
                message = "Confirmation phrase does not match the phrase issued by SANITIZE_START",
            )
        }

        operatorConfirmationPhrase = phrase
        return okResponse(
            request,
            buildJsonObject {
                put("step", "STEP2_PHRASE_ACCEPTED")
                put("operationId", session.operationId)
                put("phraseAccepted", true)
            },
        )
    }

    /**
     * SANITIZE_EXECUTE completes the lifecycle behind the gate, target lock and phrase.
     *
     * Execution runs the real provider path, which in this build answers
     * `BLOCKED_NOT_IMPLEMENTED` (decision D-1, OUTCOME B). That is the correct result:
     * the destructive trigger stays hardware-gated until validated on the physical
     * device, and the response reports it as the honest outcome rather than an error.
     */
    private fun sanitizeExecuteResponse(request: HostRequest): HostResponse {
        val start = lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_EXECUTE",
            )
        if (start.session == null) return notEligibleError(request)

        if (operatorAcknowledged != true) {
            return errorResponse(
                request = request,
                code = "SANITIZE_ACK_REQUIRED",
                message = "Refused: step 1 acknowledgement has not been recorded",
            )
        }

        val phrase = operatorConfirmationPhrase
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_PHRASE_REQUIRED",
                message = "Refused: SANITIZE_CONFIRM has not accepted the typed confirmation phrase",
            )

        val orchestrator = cachedOrchestrator
            ?: return errorResponse(
                request = request,
                code = "ADB_UNAVAILABLE",
                message = "Refused: no workstation session is attached to this command",
            )

        val targetSerial = request.stringPayload(KEY_SERIAL) ?: start.targetSerial
        val operatorId = start.preRecord?.operatorId ?: DEFAULT_OPERATOR_ID

        val result = try {
            orchestrator.completeSanitizationLifecycle(
                start = start,
                operatorId = operatorId,
                operatorAcknowledged = true,
                operatorConfirmationPhrase = phrase,
                reconnectedTargetSerial = targetSerial,
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = "SANITIZE_EXECUTION_FAILED",
                message = error.message ?: "Sanitization execution failed",
            )
        }

        lifecycleResult = result

        val execution = result.executionResult
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_EXECUTION_REFUSED",
                message = result.blockReasons.joinToString("; ").ifBlank {
                    "Sanitization execution was refused before any destructive step"
                },
            )

        return okResponse(
            request,
            buildJsonObject {
                put("executionStatus", execution.executionStatus)
                put("executionSuccess", execution.isSuccess)
                put("operationId", execution.operationId)
                put(
                    "lifecycleOutcome",
                    result.finalReport?.lifecycleOutcome?.name ?: "NOT_RECORDED",
                )
                put(
                    "verificationStatus",
                    result.verificationResult?.status?.name ?: "NOT_RUN",
                )
                put("successClaimed", result.successClaimed)
                put("finalReportAvailable", result.finalReport != null)
                put("blockReasons", stringArray(result.blockReasons))
                put("decision", "D-1 OUTCOME B: destructive trigger remains hardware-gated")
            },
        )
    }

    /** SANITIZE_VERIFY reports the post-reset verification actually performed. */
    private fun sanitizeVerifyResponse(request: HostRequest): HostResponse {
        val result = lifecycleResult
            ?: return errorResponse(
                request = request,
                code = "NO_EXECUTION_SESSION",
                message = "SANITIZE_EXECUTE must succeed before SANITIZE_VERIFY",
            )
        val verification = result.verificationResult
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_VERIFY_UNAVAILABLE",
                message = "No post-sanitization verification result exists for this session",
            )

        return okResponse(
            request,
            buildJsonObject {
                put("status", verification.status.name)
                put("postResetStateDetected", verification.postResetStateDetected)
                put("userDataInaccessible", verification.userDataInaccessible)
                put("setupWizardDetected", verification.setupWizardDetected)
                put("assuranceLevel", verification.assuranceLevel)
                put("limitations", stringArray(verification.limitations))
                put("successClaimed", result.successClaimed)
            },
        )
    }

    /**
     * GET_FINAL_REPORT returns the sanitization certificate with a SHA-256 manifest and
     * persists it under `<cyvra.home>/certificates/<certificateId>/`.
     */
    private fun finalReportResponse(request: HostRequest): HostResponse {
        val result = lifecycleResult
            ?: return errorResponse(
                request = request,
                code = "NO_EXECUTION_SESSION",
                message = "SANITIZE_EXECUTE must succeed before GET_FINAL_REPORT",
            )
        val certificate = result.finalReport
            ?: return errorResponse(
                request = request,
                code = "FINAL_REPORT_UNAVAILABLE",
                message = "No Final Report exists: " +
                    result.blockReasons.joinToString("; ").ifBlank {
                        "the lifecycle did not reach an execution attempt"
                    },
            )
        val certificateJson = result.finalReportJson
            ?: return errorResponse(
                request = request,
                code = "FINAL_REPORT_UNAVAILABLE",
                message = "Final Report could not be serialized",
            )
        val certificateMarkdown = result.finalReportMarkdown.orEmpty()
        val certificateObject = json.parseToJsonElement(certificateJson) as? JsonObject
            ?: return errorResponse(
                request = request,
                code = "FINAL_REPORT_UNAVAILABLE",
                message = "Final Report did not encode as a JSON object",
            )

        val written = try {
            reportStore.writeCertificate(
                certificateId = certificate.header.reportId,
                jsonContent = certificateJson,
                markdownContent = certificateMarkdown,
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = REPORT_WRITE_FAILED,
                message = error.message ?: "Certificate artifacts could not be written to disk",
            )
        }

        return okResponse(
            request,
            buildJsonObject {
                put("certificateId", certificate.header.reportId)
                put("lifecycleOutcome", certificate.lifecycleOutcome.name)
                put("sanitizationSuccessClaimed", certificate.sanitizationSuccessClaimed)
                put("blockReason", certificate.blockReason ?: "")
                put("verificationReportReference", certificate.verificationReportReference)
                put("certificate", certificateObject)
                put("certificateJson", certificateJson)
                put("certificateMarkdown", certificateMarkdown)
                put("certificateJsonPath", written.jsonPath)
                put("certificateMarkdownPath", written.markdownPath)
                put("manifestPath", written.manifestPath)
                put("artifactsWritten", true)
                put(
                    "manifest",
                    buildJsonObject {
                        put("algorithm", "SHA-256")
                        put("jsonSha256", written.jsonSha256)
                        put("markdownSha256", written.markdownSha256)
                    },
                )
            },
        )
    }

    // ------------------------------------------------------------------
    // Workflow helpers
    // ------------------------------------------------------------------

    /**
     * Resolves (once) the orchestrator that owns entitlement accounting for this session.
     *
     * The installation root is passed through rather than an already-built [AdbClient],
     * so a test can supply a fake process runner and never construct a client capable of
     * reaching a real device.
     */
    private fun orchestratorFor(adbBinary: java.io.File): WorkstationSessionOrchestrator {
        cachedOrchestrator?.let { return it }
        val built = orchestratorFactory(adbBinary, licenseService)
        cachedOrchestrator = built
        return built
    }

    /**
     * Clears every sanitization field. Called on a new scan (fresh evidence invalidates
     * a prior gate) and on SANITIZE_START (a restart reopens the gate from step 1).
     */
    private fun resetSanitizationState(keepStart: Boolean = false) {
        operatorAcknowledged = null
        operatorConfirmationPhrase = null
        lifecycleResult = null
        if (!keepStart) {
            lifecycleStart = null
        }
    }

    private fun noScanError(request: HostRequest, command: String): HostResponse =
        errorResponse(
            request = request,
            code = "NO_SCAN_SESSION",
            message = "$command requires a completed scan; this session holds no RUN_SCAN result",
        )

    private fun notEligibleError(request: HostRequest): HostResponse {
        val reasons = lifecycleStart?.eligibility?.blockReasons
        return errorResponse(
            request = request,
            code = "SANITIZE_NOT_ELIGIBLE",
            message = reasons?.joinToString("; ").orEmpty().ifBlank {
                "Sanitization is not eligible for this report"
            },
        )
    }

    private fun okResponse(request: HostRequest, payload: JsonObject): HostResponse =
        HostResponse(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = request.requestId,
            status = HostResponseStatus.OK,
            hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
            payload = payload,
        )

    private fun HostRequest.stringPayload(key: String): String? =
        (payload[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun HostRequest.objectPayload(key: String): JsonObject? = payload[key] as? JsonObject

    private fun stringArray(values: List<String>?): JsonArray =
        JsonArray((values ?: emptyList()).map { JsonPrimitive(it) })

    private fun errorResponse(
        request: HostRequest,
        code: String,
        message: String,
    ): HostResponse {
        return HostResponse(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = request.requestId,
            status = HostResponseStatus.ERROR,
            hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
            payload = JsonObject(emptyMap()),
            error = HostError(
                code = code,
                message = message,
            ),
        )
    }

    companion object {
        /** Refusal code returned when the installed licence cannot entitle a scan. */
        const val LICENSE_REQUIRED: String = "LICENSE_REQUIRED"

        /** Refusal code returned when generated artifacts cannot be written to disk. */
        const val REPORT_WRITE_FAILED: String = "REPORT_WRITE_FAILED"

        private const val KEY_SERIAL = "serial"
        private const val KEY_OPERATOR_ID = "operatorId"
        private const val KEY_DEVICE_SIDE_INVENTORY = "deviceSideInventory"
        private const val KEY_ACKNOWLEDGED = "acknowledged"
        private const val KEY_CONFIRMATION_PHRASE = "confirmationPhrase"
        private const val DEFAULT_OPERATOR_ID = "unspecified-operator"
        private const val PLACEHOLDER_OPERATION_ID = "PURGE-OP-PENDING"
    }
}