package cyvra.mobile.host.protocol

import cyvra.mobile.core.AuthorizationRequirement
import cyvra.mobile.core.PreSanitizationRecord
import cyvra.mobile.core.SanitizationMethodType
import cyvra.mobile.core.TechnicianCheckOutcome
import cyvra.mobile.core.TechnicianCheckResult
import cyvra.mobile.core.TechnicianChecklistCatalog
import cyvra.mobile.core.TechnicianChecklistRecord
import cyvra.mobile.core.WorkstationDeviceDescriptor
import cyvra.mobile.host.engine.CapabilityMatrixLoader
import cyvra.mobile.host.engine.CapabilityResult
import cyvra.mobile.host.engine.DeviceProfile
import cyvra.mobile.host.engine.MatrixLoadResult
import cyvra.mobile.host.engine.PatchSetState
import cyvra.mobile.host.engine.PatchStateOutcome
import cyvra.mobile.host.engine.Plane
import cyvra.mobile.host.engine.ReportFinaliser
import cyvra.mobile.host.engine.ReportGenerator
import cyvra.mobile.host.evidence.HostAndroidComponentBridge
import cyvra.mobile.host.license.LicenseFileResult
import cyvra.mobile.host.license.LicenseProvider
import cyvra.mobile.host.license.SignedEntitlementProvider
import cyvra.mobile.host.report.HostPdfReportWriter
import cyvra.mobile.host.report.HostReportEngine
import cyvra.mobile.host.report.HostReportStore
import cyvra.mobile.host.report.WrittenPdfArtifact
import cyvra.mobile.host.service.ConcurrencyAdmissionOutcome
import cyvra.mobile.host.service.HostBootstrap
import cyvra.mobile.host.service.HostLicenseService
import cyvra.mobile.host.service.SanitizationLifecycleStart
import cyvra.mobile.host.service.WorkstationDiagnosticExecutionResult
import cyvra.mobile.host.service.WorkstationSanitizationLifecycleResult
import cyvra.mobile.host.service.WorkstationSessionOrchestrator
import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.AdbDeviceDescriptor
import cyvra.mobile.host.transport.ConnectionStateMachine
import cyvra.mobile.host.transport.HostPreflightVerifier
import cyvra.mobile.host.transport.AdbTransport
import cyvra.mobile.host.transport.ProbeOutcome
import cyvra.mobile.host.transport.ProbeResult
import cyvra.mobile.host.transport.TransportManager
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put

class HostProtocolDispatcher(
    private val preflightVerifier: HostPreflightVerifier = HostPreflightVerifier(),
    private val adbLocator: AdbBinaryLocator = AdbBinaryLocator(),
    /**
     * Builds the ADB client used by the read-only device commands.
     *
     * Indirection, not behaviour: production always builds a real [AdbClient]. A test
     * supplies one backed by a fake process runner, so no test path can reach a real
     * `adb` binary or a connected phone.
     */
    private val adbClientFactory: (java.io.File) -> AdbClient = { binary -> AdbClient(binary) },
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
    /**
     * Establishes the authoritative applied patch state for a completed scan.
     *
     * A production deployment wires [cyvra.mobile.host.engine.FileBasedPatchStateProvider],
     * which reads the signed patch corpus from the read-only installation root, verifies it
     * through [cyvra.mobile.host.engine.PatchVerifier] against governed build-time trust
     * anchors (contract §3), and reconciles it against the applied-state record. Until that
     * subsystem can establish an authoritative state the default seam is **null**: it
     * establishes nothing, so [FINALISE_REPORT] refuses rather than substituting the
     * default empty state. An interface existing is not authority.
     *
     * The live [DeviceProfile] of the scan being recorded is passed in, so contract §6
     * step 7 can resolve `oem_scope` against the actual device. Without it every patch is
     * legitimately NOT APPLICABLE and no applied record could ever be reconciled.
     *
     * The return type is deliberately [PatchStateOutcome] and not a bare [PatchSetState].
     * [PatchSetState]'s own default *is* `NO-PATCHES`, so a provider that merely failed to
     * find a corpus could otherwise hand back that default and have it reported as an
     * authoritative claim. Contract §8 requires `patch_set_mode` to be "never blank, never
     * inferred"; forcing a positive [PatchStateOutcome.Established] makes the permissive
     * fallback structurally impossible rather than a convention to be remembered.
     *
     * [PatchStateOutcome] itself lives in the engine layer, next to [PatchSetState] and
     * [cyvra.mobile.host.engine.FileBasedPatchStateProvider]: patch-state vocabulary
     * belongs to the engine, and this protocol layer consumes it.
     */
    private val patchStateProvider: ((DeviceProfile?) -> PatchStateOutcome)? = null,
    private val pdfReportWriter: HostPdfReportWriter = HostPdfReportWriter(),
) {
    /**
     * Immutable evidence captured once for the completed scan currently held in [lastScan].
     *
     * D-5 (Option B): a controlled final report must carry the actual probe results and
     * the authoritative patch state that belonged to *this* completed scan/session. The
     * packet is created at scan success, bound to that scan's `sessionUuid`, invalidated
     * whenever the scan is (see the `SCAN_FAILED` path), and never silently regenerated at
     * finalisation. If authoritative patch state cannot be established the packet is null
     * and finalisation refuses.
     */
    private data class ScanEvidencePacket(
        val sessionUuid: String,
        val probeResults: List<ProbeResult>,
        val patchState: PatchSetState,
    )

    private val json = Json {
        encodeDefaults = true
    }

    /*
     * P2 workflow state.
     *
     * The Host is a single long-lived process reading JSON-lines on stdin, so one
     * dispatcher instance serves the whole operator session. Session state is indexed
     * per device serial (`D-CE-26-03`) so up to 50 connected phones can be scanned,
     * inspected, finalised, verified, and sanitized independently without overwriting
     * one another, while `activeSerial` preserves single-device fallback when a caller
     * omits `payload.serial`.
     *
     * A successful RUN_SCAN on a device clears every sanitization field for that device:
     * a new scan invalidates that device's previous report, so its prior eligibility gate,
     * target lock and confirmation can never carry over onto fresh evidence.
     */
    private class DeviceSessionState(
        var lastScan: WorkstationDiagnosticExecutionResult? = null,
        var scanEvidence: ScanEvidencePacket? = null,
        var patchStateRefusalReason: String? = null,
        var lifecycleStart: SanitizationLifecycleStart? = null,
        var operatorAcknowledged: Boolean? = null,
        var operatorConfirmationPhrase: String? = null,
        var lifecycleResult: WorkstationSanitizationLifecycleResult? = null,
        var checklistRecord: TechnicianChecklistRecord? = null,
        var hwScanPdfArtifact: WrittenPdfArtifact? = null,
        var appScanPdfArtifact: WrittenPdfArtifact? = null,
        var sanitizationAuditPdfArtifact: WrittenPdfArtifact? = null,
        var sanitizedDisconnected: Boolean = false,
    ) {
        fun resetSanitizationState(keepStart: Boolean = false) {
            operatorAcknowledged = null
            operatorConfirmationPhrase = null
            lifecycleResult = null
            sanitizationAuditPdfArtifact = null
            if (!keepStart) {
                lifecycleStart = null
            }
        }
    }

    private val deviceSessions = java.util.concurrent.ConcurrentHashMap<String, DeviceSessionState>()

    @Volatile
    private var activeSerial: String? = null

    fun isScanInFlight(serial: String): Boolean = licenseService.isScanInFlight(serial)

    fun activeConcurrentScanCount(): Int = licenseService.activeConcurrentScanCount()

    private fun sessionFor(request: HostRequest): DeviceSessionState? {
        val requested = request.stringPayload(KEY_SERIAL)
        if (requested != null) {
            deviceSessions[requested]?.let { return it }
        }
        return activeSerial?.let { deviceSessions[it] }
    }

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

    /**
     * The one AdbClient for the resolved binary, built through [adbClientFactory] so the
     * orchestrator and the D-5 probe capture share a single client (and therefore a single
     * process runner). Building a second client for capture would bypass a factory that
     * supplies a custom runner.
     */
    private var cachedAdbClient: AdbClient? = null

    @Synchronized
    private fun adbClientFor(adbBinary: java.io.File): AdbClient {
        cachedAdbClient?.let { return it }
        val built = adbClientFactory(adbBinary)
        cachedAdbClient = built
        return built
    }

    fun dispatch(request: HostRequest): HostResponse {
        return when (request.command) {
            HostCommand.GET_HOST_INFO -> hostInfoResponse(request)
            HostCommand.GET_PREFLIGHT -> preflightResponse(request)
            HostCommand.GET_DEVICE_STATE -> deviceStateResponse(request)
            HostCommand.GET_LICENSE_STATE -> licenseStateResponse(request)
            HostCommand.GET_CONNECTED_DEVICES -> connectedDevicesResponse(request)
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
            HostCommand.FINALISE_REPORT -> finaliseReportResponse(request)
            HostCommand.GET_CHECKLIST -> getChecklistResponse(request)
            HostCommand.RECORD_CHECKLIST -> recordChecklistResponse(request)
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
                ?.let { adbClientFactory(it).listDevices() }
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

    /**
     * GET_LICENSE_STATE reports the entitlement the workstation actually has.
     *
     * Read-only and fail-closed: `present` is true only when a [LicenseProvider]
     * read, verified and validated `<cyvra.home>/entitlement.json`. This command cannot
     * activate anything - it is the Host stating what it found on disk, so a missing or
     * corrupt file, or one whose server signature does not verify, answers
     * `FILE_MISSING` / `SIGNATURE_INVALID` / `UNKNOWN` / `0` rather than a fabricated
     * activation.
     *
     * No secrets cross the wire: `licenseId`, `serialNumber`, `customerEmail` and
     * `planName` stay inside the Host. The four keys below are the whole surface.
     *
     * `status` and `scansRemaining` are read from [licenseService], which is seeded from
     * this very provider record, so before any scan they are byte-identical to the
     * provider's values and afterwards they report the balance actually debited rather
     * than a stale pre-scan figure.
     */
    private fun licenseStateResponse(request: HostRequest): HostResponse {
        val file = licenseResult
        val record = licenseService.getLicense()

        return okResponse(
            request,
            buildJsonObject {
                put("present", file.isLicensed)
                put("reason", file.reason.name)
                put("status", record.status.name)
                put("scansRemaining", record.scansRemaining)
            },
        )
    }

    /**
     * GET_CONNECTED_DEVICES lists every phone this workstation currently sees over ADB.
     *
     * Read-only: it runs `adb devices -l` and, for phones ADB has already authorized, one
     * unprivileged `getprop ro.product.manufacturer`. Nothing is written to a device and no
     * session is started.
     *
     * Honesty rules this response is built around:
     *
     *  - `model` and `make` are only emitted when ADB actually returned them; a phone whose
     *    manufacturer could not be read simply has no `make` key, and the caller renders
     *    "Not reported" rather than a guess.
     *  - `imei` is never emitted. Reading an IMEI needs privileged Android permissions this
     *    workstation does not hold, so every entry carries `imeiReason` instead.
     *  - `portOrLocation` is never emitted: the Windows truth this build has (SetupAPI
     *    device-instance enumeration) exposes only a native PnP instance id, which the
     *    workstation deliberately never puts on the wire, and no new USB parsing was added
     *    for this command.
     *  - `state` is ADB's own verdict. `unauthorized` and `disconnected` are reported as
     *    themselves and can never be read as ready.
     */
    private fun connectedDevicesResponse(request: HostRequest): HostResponse {
        return try {
            val adbBinary = adbLocator.locate()

            if (adbBinary == null) {
                /*
                 * Not an error and not an empty phone list: "no ADB component" is a
                 * different fact from "no phone attached", so the caller is told which
                 * one it is rather than being left to infer it from an empty array.
                 */
                return okResponse(
                    request,
                    buildJsonObject {
                        put("adbAvailable", false)
                        put("devices", JsonArray(emptyList()))
                    },
                )
            }

            val client = adbClientFactory(adbBinary)
            val devices = client.listDevices()
            val probeAgent = (request.payload["probeAgent"] as? JsonPrimitive)?.booleanOrNull == true
            val deployAgent = (request.payload["deployAgent"] as? JsonPrimitive)?.booleanOrNull == true
            val targetSerial = request.stringPayload(KEY_SERIAL)

            okResponse(
                request,
                buildJsonObject {
                    put("adbAvailable", true)
                    put(
                        "devices",
                        JsonArray(devices.map { descriptor ->
                            connectedDevice(
                                client = client,
                                descriptor = descriptor,
                                probeAgent = probeAgent && (targetSerial == null || targetSerial == descriptor.serial),
                                deployAgent = deployAgent && (targetSerial == null || targetSerial == descriptor.serial),
                            )
                        }),
                    )
                },
            )
        } catch (error: Exception) {
            errorResponse(
                request = request,
                code = "CONNECTED_DEVICES_FAILED",
                message = error.message ?: "Could not list connected devices",
            )
        }
    }

    /** One device row, built only from values this Host actually read. */
    private fun connectedDevice(
        client: AdbClient,
        descriptor: AdbDeviceDescriptor,
        probeAgent: Boolean = false,
        deployAgent: Boolean = false,
    ): JsonObject = buildJsonObject {
        put("transport", transportOf(descriptor.serial))
        put("serial", descriptor.serial)
        put("state", connectedDeviceState(descriptor.state))

        descriptor.model?.takeIf { it.isNotBlank() }?.let { put("model", it) }

        manufacturerOf(client, descriptor)?.let { put("make", it) }

        if ((probeAgent || deployAgent) && descriptor.state == "device") {
            val bridge = HostAndroidComponentBridge(client, descriptor.serial)
            val (installed, status) = if (deployAgent) {
                bridge.ensureInstalledOrDeploy()
            } else {
                val present = bridge.checkInstalled()
                present to if (present) "INSTALLED" else "NOT_INSTALLED"
            }
            put("agentInstalled", installed)
            put("agentStatus", status)
            put("deviceLifecycleId", WorkstationSessionOrchestrator.deviceLifecycleIdFor(descriptor.serial))
        }

        put("imeiReason", IMEI_REASON)
    }

    /**
     * Transport domain of a serial, taken from ADB's own serial grammar so an emulator or
     * a network attachment is never labelled USB. USB is the only transport the Windows
     * inspection plane of this build observes, which is why an unrecognised serial is USB.
     */
    private fun transportOf(serial: String): String = when {
        serial.startsWith("emulator-", ignoreCase = true) -> "EMULATOR"
        serial.contains(':') && serial.substringAfterLast(':').toIntOrNull() != null -> "NETWORK"
        else -> "USB"
    }

    /** Maps ADB's state column onto the four states the operator view understands. */
    private fun connectedDeviceState(adbState: String): String = when (adbState.lowercase()) {
        "device" -> "authorized"
        "unauthorized" -> "unauthorized"
        "offline" -> "disconnected"
        else -> "detected"
    }

    /**
     * Manufacturer as ADB's host reports it for an authorized phone.
     *
     * Returns `null` - and the key is omitted - whenever the value is not genuinely there:
     * an unprivileged shell cannot run on a phone that has not authorized this computer,
     * and Android answers `null` for an unset property. `null` is never rendered as a
     * manufacturer.
     */
    private fun manufacturerOf(client: AdbClient, descriptor: AdbDeviceDescriptor): String? {
        if (descriptor.state != "device") return null

        val result = client.runShell(descriptor.serial, "getprop ro.product.manufacturer")
        if (!result.isSuccess) return null

        return result.stdout
            .trim()
            .takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }
    }

    // ------------------------------------------------------------------
    // P2 workflow commands: scan -> reports -> sanitization lifecycle
    // ------------------------------------------------------------------

    /**
     * RUN_SCAN routes to `WorkstationSessionOrchestrator.executeDiagnostic`.
     *
     * The licence is checked before anything else: a denied [cyvra.mobile.host.license.LicenseProvider]
     * result refuses the scan with `LICENSE_REQUIRED` carrying the reason, rather than
     * letting entitlement accounting throw a misleading "no scans remaining" later.
     */
    private fun runScanResponse(request: HostRequest): HostResponse {
        val license = licenseResult
        if (!license.isLicensed) {
            return errorResponse(
                request = request,
                code = LICENSE_REQUIRED,
                // Names the file the activated product actually reads. `license.json`
                // is the test/dev seam only, so pointing an operator at it would be
                // an instruction that can never be satisfied on a shipped build.
                message = "Scan refused: no usable licence is installed " +
                    "(reason=${license.reason}). Install a valid " +
                    "${SignedEntitlementProvider.ENTITLEMENT_FILE_NAME} in the installation " +
                    "root to enable scanning.",
            )
        }

        /*
         * Server-authoritative offline rule, read from the signed snapshot and
         * enforced here rather than in the UI. The snapshot decides; a
         * workstation running on a cached entitlement cannot widen its own
         * permissions. With no snapshot restricting it (the test/dev seam) this
         * is true and the branch never fires.
         */
        if (!license.offline.diagnostics) {
            return errorResponse(
                request = request,
                code = "DIAGNOSTICS_LOCKED_OFFLINE",
                message = "Refused: this workstation is running on a cached entitlement " +
                    "that does not permit diagnostics. Reconnect to CYVORIQ so the " +
                    "licence can be refreshed, then try again.",
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

        val admission = licenseService.tryAcquireConcurrentScanSlot(serial, request.requestId)
        if (admission is ConcurrencyAdmissionOutcome.Refused) {
            return errorResponse(
                request = request,
                code = admission.code,
                message = admission.message,
            )
        }

        return try {
            // Release any superseded unsettled reservation held by a prior un-sanitized scan on this same serial
            deviceSessions[serial]?.lastScan?.sessionUuid?.let { priorSessionUuid ->
                licenseService.abandonScan(priorSessionUuid)
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
                /*
                 * U-3(a): a genuine scan-execution failure invalidates the previous
                 * scan's evidence. `executeDiagnostic` has already abandoned the
                 * failed reservation; clearing the stale scan here stops report
                 * retrieval and sanitization from operating on a report the current
                 * attempt did not produce. The entitlement-refusal path above
                 * (IllegalStateException -> SCAN_REFUSED) fires before any scan work
                 * begins and deliberately preserves the current scan.
                 */
                deviceSessions.remove(serial)
                if (activeSerial == serial) {
                    activeSerial = deviceSessions.keys().asSequence().lastOrNull()
                }
                return errorResponse(
                    request = request,
                    code = "SCAN_FAILED",
                    message = error.message ?: "Diagnostic scan failed",
                )
            }

            val probeResults = probeCapture(serial)
            val patchStateOutcome = if (probeResults == null) {
                null
            } else {
                patchStateProvider?.invoke(deviceProfileFor(result.deviceDescriptor))
                    ?: PatchStateOutcome.Unavailable("NO_PATCH_STATE_PROVIDER")
            }
            val capturedEvidence = if (probeResults != null && patchStateOutcome is PatchStateOutcome.Established) {
                ScanEvidencePacket(result.sessionUuid, probeResults, patchStateOutcome.state)
            } else {
                null
            }
            val refusalReason = when {
                probeResults == null -> "no probe results were captured for this scan"
                patchStateOutcome is PatchStateOutcome.Unavailable -> patchStateOutcome.reason
                else -> null
            }
            val deviceLifecycleId = WorkstationSessionOrchestrator.deviceLifecycleIdFor(serial)
            val hwPdf = runCatching {
                pdfReportWriter.writeHardwareScanPdf(
                    serial = serial,
                    deviceLifecycleId = deviceLifecycleId,
                    scan = result,
                    checklist = null,
                )
            }.getOrNull()

            deviceSessions[serial] = DeviceSessionState(
                lastScan = result,
                scanEvidence = capturedEvidence,
                patchStateRefusalReason = refusalReason,
                hwScanPdfArtifact = hwPdf,
            )
            activeSerial = serial

            val section = result.report.applicationInventory
            okResponse(
                request,
                buildJsonObject {
                    put("scanStatus", "COMPLETED")
                    put("sessionUuid", result.sessionUuid)
                    put("deviceLifecycleId", deviceLifecycleId)
                    put("reportId", result.report.header.reportId)
                    put(KEY_SERIAL, serial)
                    put(KEY_OPERATOR_ID, operatorId)
                    put("scansRemaining", result.updatedLicense.scansRemaining)
                    put("maxConcurrentScans", licenseService.maxConcurrentScansAllowed())
                    put("inventoryAvailable", section?.inventoryAvailable ?: false)
                    put("enumerationCompleteness", section?.enumerationCompleteness?.name ?: "UNAVAILABLE")
                    put("hwReportGenerated", hwPdf != null)
                    hwPdf?.let {
                        put("pdfPath", it.pdfPath)
                        put("pdfFileName", it.fileName)
                        put("pdfSha256", it.pdfSha256)
                    }
                },
            )
        } finally {
            licenseService.releaseConcurrentScanSlot(serial)
        }
    }

    /** GET_DEVICE_REPORT returns Report 1 exactly as it was generated by the scan. */
    private fun deviceReportResponse(request: HostRequest): HostResponse {
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "GET_DEVICE_REPORT")
        // Serial-when-present (U-2(a)): a named serial must match the resolved scan's device.
        serialOwnershipRefusal(request, "GET_DEVICE_REPORT", scan.deviceDescriptor.serial)
            ?.let { return it }
        val reportObject = json.parseToJsonElement(scan.reportJson) as? JsonObject
            ?: return errorResponse(
                request = request,
                code = "REPORT_UNAVAILABLE",
                message = "Report 1 did not encode as a JSON object",
            )

        val deviceLifecycleId = WorkstationSessionOrchestrator.deviceLifecycleIdFor(scan.deviceDescriptor.serial)
        val forceNewPdf = (request.payload["forceNewPdf"] as? JsonPrimitive)?.booleanOrNull == true
        val hwPdf = runCatching {
            val existing = state.hwScanPdfArtifact
            if (existing != null && existing.sessionUuid == scan.sessionUuid && !forceNewPdf) {
                existing
            } else {
                pdfReportWriter.writeHardwareScanPdf(
                    serial = scan.deviceDescriptor.serial,
                    deviceLifecycleId = deviceLifecycleId,
                    scan = scan,
                    checklist = state.checklistRecord,
                ).also { state.hwScanPdfArtifact = it }
            }
        }.getOrNull()

        return okResponse(
            request,
            buildJsonObject {
                put("reportId", scan.report.header.reportId)
                put("sessionUuid", scan.report.header.sessionUuid)
                put("deviceLifecycleId", deviceLifecycleId)
                put(KEY_SERIAL, scan.deviceDescriptor.serial)
                put("report", reportObject)
                put("reportMarkdown", scan.reportMarkdown)
                put("jsonSha256", reportEngine.computeSha256(scan.reportJson))
                put("hwReportGenerated", hwPdf != null)
                hwPdf?.let {
                    put("pdfPath", it.pdfPath)
                    put("pdfFileName", it.fileName)
                    put("pdfSha256", it.pdfSha256)
                }
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
     *
     * Ownership follows the same serial-when-present rule as GET_DEVICE_REPORT: a
     * request naming a different serial is refused with SERIAL_MISMATCH before any
     * inventory is built, so an inventory can never be attributed to the wrong device.
     */
    private fun applicationInventoryResponse(request: HostRequest): HostResponse {
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "GET_APPLICATION_INVENTORY")
        // Serial-when-present (U-2(a)): a named serial must match the resolved scan's device.
        serialOwnershipRefusal(request, "GET_APPLICATION_INVENTORY", scan.deviceDescriptor.serial)
            ?.let { return it }
        val section = scan.report.applicationInventory
        val deviceLifecycleId = WorkstationSessionOrchestrator.deviceLifecycleIdFor(scan.deviceDescriptor.serial)
        val forceNewPdf = (request.payload["forceNewPdf"] as? JsonPrimitive)?.booleanOrNull == true
        val appPdf = runCatching {
            val existing = state.appScanPdfArtifact
            if (existing != null && existing.sessionUuid == scan.sessionUuid && !forceNewPdf) {
                existing
            } else {
                pdfReportWriter.writeAppScanPdf(
                    serial = scan.deviceDescriptor.serial,
                    deviceLifecycleId = deviceLifecycleId,
                    scan = scan,
                ).also { state.appScanPdfArtifact = it }
            }
        }.getOrNull()

        return okResponse(
            request,
            buildJsonObject {
                put(KEY_SERIAL, scan.deviceDescriptor.serial)
                put("sessionUuid", scan.sessionUuid)
                put("deviceLifecycleId", deviceLifecycleId)
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
                put("appReportGenerated", appPdf != null)
                appPdf?.let {
                    put("pdfPath", it.pdfPath)
                    put("pdfFileName", it.fileName)
                    put("pdfSha256", it.pdfSha256)
                }
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
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "EXPORT_REPORT")
        // Serial-when-present (U-2(a)): a named serial must match the resolved scan's device.
        serialOwnershipRefusal(request, "EXPORT_REPORT", scan.deviceDescriptor.serial)
            ?.let { return it }
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

        val deviceLifecycleId = WorkstationSessionOrchestrator.deviceLifecycleIdFor(scan.deviceDescriptor.serial)
        val requestedType = request.stringPayload("reportType")?.uppercase()
        val hwPdf = runCatching {
            if (requestedType == HostPdfReportWriter.TYPE_APP_SCAN) {
                state.hwScanPdfArtifact
            } else {
                state.hwScanPdfArtifact?.takeIf { it.sessionUuid == scan.sessionUuid }
                    ?: pdfReportWriter.writeHardwareScanPdf(
                        serial = scan.deviceDescriptor.serial,
                        deviceLifecycleId = deviceLifecycleId,
                        scan = scan,
                        checklist = state.checklistRecord,
                    ).also { state.hwScanPdfArtifact = it }
            }
        }.getOrNull()
        val appPdf = runCatching {
            if (requestedType == HostPdfReportWriter.TYPE_HW_SCAN) {
                state.appScanPdfArtifact
            } else {
                state.appScanPdfArtifact?.takeIf { it.sessionUuid == scan.sessionUuid }
                    ?: pdfReportWriter.writeAppScanPdf(
                        serial = scan.deviceDescriptor.serial,
                        deviceLifecycleId = deviceLifecycleId,
                        scan = scan,
                    ).also { state.appScanPdfArtifact = it }
            }
        }.getOrNull()
        val primaryPdf = when (requestedType) {
            HostPdfReportWriter.TYPE_APP_SCAN -> appPdf
            else -> hwPdf ?: appPdf
        }

        return okResponse(
            request,
            buildJsonObject {
                put("reportId", scan.report.header.reportId)
                put(KEY_SERIAL, scan.deviceDescriptor.serial)
                put("sessionUuid", scan.sessionUuid)
                put("deviceLifecycleId", deviceLifecycleId)
                put("format", "json+markdown+pdf")
                put("reportJson", jsonContent)
                put("reportMarkdown", markdownContent)
                put("reportJsonPath", written.jsonPath)
                put("reportMarkdownPath", written.markdownPath)
                put("manifestPath", written.manifestPath)
                primaryPdf?.let {
                    put("pdfPath", it.pdfPath)
                    put("pdfFileName", it.fileName)
                    put("pdfSha256", it.pdfSha256)
                }
                hwPdf?.let { put("hwPdfPath", it.pdfPath) }
                appPdf?.let { put("appPdfPath", it.pdfPath) }
                put("artifactsWritten", true)
                put(
                    "manifest",
                    buildJsonObject {
                        put("algorithm", "SHA-256")
                        put("jsonSha256", written.jsonSha256)
                        put("markdownSha256", written.markdownSha256)
                        primaryPdf?.let { put("pdfSha256", it.pdfSha256) }
                    },
                )
            },
        )
    }

    /**
     * FINALISE_REPORT runs the ratified V3 §7 chain — normalise → operator authorisation
     * → seal → final controlled report — entirely inside this Host.
     *
     * The raw report is built here from the capability matrix on disk and the applied
     * patch set: the same inputs Report 1 is derived from. Nothing report-shaped is read
     * off the wire, so a caller can never hand the Host a report of its own to seal.
     *
     * **It spends nothing.** No device is written to and no sanitization lifecycle starts,
     * so there is no entitlement to debit — finalising is not a scan and not a
     * certificate. The operator named here is the person releasing the artifact; they are
     * not asserting anything about the device, and the report keeps every honest status
     * the raw artifact recorded.
     */
    private fun finaliseReportResponse(request: HostRequest): HostResponse {
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "FINALISE_REPORT")
        serialOwnershipRefusal(request, "FINALISE_REPORT", scan.deviceDescriptor.serial)
            ?.let { return it }
        /*
         * D-5 (Option B): a controlled final report must carry the actual probe results
         * and the authoritative patch state belonging to THIS completed scan. When the
         * packet is absent, its session does not match the active scan, its patch state
         * was never authoritatively established, or no probe results were captured, we
         * refuse here - before any report artifact is written - rather than silently
         * regenerating a default/empty report and presenting it as controlled evidence.
         */
        val evidence = state.scanEvidence
        if (evidence == null || evidence.sessionUuid != scan.sessionUuid || evidence.probeResults.isEmpty()) {
            val reason = when {
                evidence != null && evidence.sessionUuid != scan.sessionUuid ->
                    "the captured evidence belongs to a different session"
                evidence != null && evidence.probeResults.isEmpty() ->
                    "no probe results were captured for this scan"
                else -> state.patchStateRefusalReason ?: "authoritative patch state was not established"
            }
            return errorResponse(
                request = request,
                code = FINALISE_INPUTS_UNAVAILABLE,
                message = "Authoritative scan evidence (probe results and applied patch state) " +
                    "is unavailable for this completed scan: $reason",
            )
        }
        val operatorId = request.stringPayload(KEY_OPERATOR_ID) ?: scan.report.header.operatorId

        val finalised = try {
            val generator = ReportGenerator(
                loader = CapabilityMatrixLoader(),
                engineVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
            )
            ReportFinaliser().finalise(
                generator.generate(evidence.probeResults, evidence.patchState),
                operatorId,
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = REPORT_WRITE_FAILED,
                message = error.message ?: "The report could not be finalised",
            )
        }

        val reportId = "CYVRA-FCR-${java.time.Year.now().value}-" +
            java.util.UUID.randomUUID().toString().take(6).uppercase()
        val jsonContent = ReportFinaliser().toJson(finalised)

        val written = try {
            reportStore.writeReport(
                reportId = reportId,
                jsonContent = jsonContent,
                markdownContent = finalised.provenance.joinToString("\n"),
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = REPORT_WRITE_FAILED,
                message = error.message ?: "Final controlled report could not be written to disk",
            )
        }

        val zip = try {
            ReportFinaliser().writeZip(
                finalised,
                java.io.File(written.jsonPath).parentFile?.let { dir ->
                    java.io.File(dir, "$reportId.zip")
                } ?: java.io.File("$reportId.zip"),
            )
        } catch (error: Exception) {
            return errorResponse(
                request = request,
                code = REPORT_WRITE_FAILED,
                message = error.message ?: "Final controlled report archive could not be written",
            )
        }

        return okResponse(
            request,
            buildJsonObject {
                put("reportId", reportId)
                put("status", ReportFinaliser.STATUS_FINAL)
                put("schemaVersion", finalised.schemaVersion)
                put("finalisedAt", finalised.finalisedAt)
                put("operatorId", finalised.authorisation.operatorId)
                put("decision", finalised.authorisation.decision)
                put("algorithm", finalised.seal.algorithm)
                put("sealDigest", finalised.seal.digest)
                put("attestationDigest", finalised.authorisation.attestationDigestSha256)
                put("sealMatchesAttestation", finalised.seal.digest == finalised.authorisation.attestationDigestSha256)
                put("reportJson", jsonContent)
                put("reportJsonPath", written.jsonPath)
                put("manifestPath", written.manifestPath)
                put("zipPath", zip.absolutePath)
                put("provenance", JsonArray(finalised.provenance.map { JsonPrimitive(it) }))
                put("artifactsWritten", true)
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
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "SANITIZE_START")
        val orchestrator = cachedOrchestrator
            ?: return noScanError(request, "SANITIZE_START")

        val operatorId = request.stringPayload(KEY_OPERATOR_ID)
            ?: scan.report.header.operatorId
        // Serial-when-present (D-3, U-2(a)): this operation is scan-bound, so the
        // serial recorded on the active scan is authoritative. A differing wire
        // serial is refused; it can never rebind the session to a device the scan
        // did not observe. Absent/matching serial keeps the established behaviour.
        serialOwnershipRefusal(request, "SANITIZE_START", scan.deviceDescriptor.serial)
            ?.let { return it }
        val targetSerial = scan.deviceDescriptor.serial

        val requireScanReports = (request.payload["requireScanReports"] as? JsonPrimitive)?.booleanOrNull == true
        if (requireScanReports) {
            val hwReady = state.hwScanPdfArtifact?.sessionUuid == scan.sessionUuid
            val appReady = state.appScanPdfArtifact?.sessionUuid == scan.sessionUuid
            if (!hwReady || !appReady) {
                return errorResponse(
                    request = request,
                    code = "PRE_SANITIZATION_REPORTS_REQUIRED",
                    message = "Sanitization refused for device '$targetSerial': both H/W Scan Report and App Scan Report " +
                        "must be generated and verified for session '${scan.sessionUuid}' before sanitization can begin " +
                        "(hwReport=$hwReady, appReport=$appReady).",
                )
            }
        }

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

        state.lifecycleStart = aligned
        state.resetSanitizationState(keepStart = true)

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

    /**
     * SANITIZE_AUTHORIZE is the single supported authorization/execution protocol entry point
     * after SANITIZE_START and report validation (while preserving step-1 compatibility when
     * invoked with only `acknowledged` by legacy step-by-step tests).
     *
     * When `consolidated = true` or `confirmationPhrase` is provided in the payload:
     * 1. Enforces strict `serial` ownership (`SERIAL_MISMATCH` on cross-device mismatch).
     * 2. Enforces that both H/W Scan Report and App Scan Report exist for this device and session
     *    (unless `requireScanReports == false`).
     * 3. Verifies both step-1 `acknowledged == true` and step-2 `confirmationPhrase`.
     * 4. Executes the hardware-gated purge AND internal post-wipe verification (`verifyPostReset`).
     * 5. Generates the per-operation Sanitization Audit Report PDF in `Downloads/CYVRA/`.
     * 6. Disconnects/closes the active workflow session (`sanitizedDisconnected = true`).
     */
    private fun sanitizeAuthorizeResponse(request: HostRequest): HostResponse {
        val state = sessionFor(request)
        if (state?.sanitizedDisconnected == true) {
            return errorResponse(
                request = request,
                code = "DEVICE_SESSION_DISCONNECTED",
                message = "The sanitization lifecycle for device '${state.lastScan?.deviceDescriptor?.serial ?: ""}' has already concluded and its session is closed. A new diagnostic scan must be completed before authorizing another sanitization.",
            )
        }
        val start = state?.lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_AUTHORIZE",
            )
        serialOwnershipRefusal(request, "SANITIZE_AUTHORIZE", start.targetSerial)
            ?.let { return it }
        val session = start.session ?: return notEligibleError(request, state)

        val acknowledged = (request.payload[KEY_ACKNOWLEDGED] as? JsonPrimitive)?.booleanOrNull
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_REQUEST_INVALID",
                message = "SANITIZE_AUTHORIZE requires payload.acknowledged (boolean)",
            )

        state.operatorAcknowledged = acknowledged
        // A new acknowledgement invalidates any phrase recorded against the previous one.
        state.operatorConfirmationPhrase = null

        val consolidated = (request.payload["consolidated"] as? JsonPrimitive)?.booleanOrNull == true ||
            request.stringPayload(KEY_CONFIRMATION_PHRASE) != null

        if (!consolidated) {
            return okResponse(
                request,
                buildJsonObject {
                    put("step", "STEP1_ACKNOWLEDGEMENT_RECORDED")
                    put(KEY_SERIAL, start.targetSerial)
                    put("acknowledged", acknowledged)
                    put("operationId", session.operationId)
                    put("step2PhraseRequired", session.barrier.step2PhraseRequired)
                },
            )
        }

        // Consolidated single-entry-point sanitization execution + internal verification
        val offlineLicense = licenseResult
        if (offlineLicense.isLicensed && !offlineLicense.offline.sanitizeExecute) {
            return errorResponse(
                request = request,
                code = "SANITIZE_LOCKED_OFFLINE",
                message = "Refused: destructive sanitization is not allowed while this " +
                    "workstation is running on a cached entitlement. Reconnect to CYVORIQ " +
                    "so the licence can be confirmed, then try again.",
            )
        }

        val scan = state.lastScan ?: return noScanError(request, "SANITIZE_AUTHORIZE")
        val requireScanReports = (request.payload["requireScanReports"] as? JsonPrimitive)?.booleanOrNull != false
        if (requireScanReports) {
            val hwReady = state.hwScanPdfArtifact?.sessionUuid == scan.sessionUuid
            val appReady = state.appScanPdfArtifact?.sessionUuid == scan.sessionUuid
            if (!hwReady || !appReady) {
                return errorResponse(
                    request = request,
                    code = "PRE_SANITIZATION_REPORTS_REQUIRED",
                    message = "Sanitization refused for device '${start.targetSerial}': both H/W Scan Report and App Scan Report " +
                        "must be generated and verified for session '${scan.sessionUuid}' before sanitization can be authorized " +
                        "(hwReport=$hwReady, appReport=$appReady).",
                )
            }
        }

        if (!acknowledged) {
            return errorResponse(
                request = request,
                code = "SANITIZE_ACK_REQUIRED",
                message = "Refused: step 1 acknowledgement must be true to authorize sanitization",
            )
        }

        val phrase = request.stringPayload(KEY_CONFIRMATION_PHRASE)
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_PHRASE_REQUIRED",
                message = "SANITIZE_AUTHORIZE (consolidated) requires payload.confirmationPhrase",
            )

        val requiredPhrase = session.barrier.step2PhraseRequired
        if (phrase.trim() != requiredPhrase.trim()) {
            return errorResponse(
                request = request,
                code = "SANITIZE_PHRASE_MISMATCH",
                message = "Confirmation phrase does not match the phrase issued by SANITIZE_START for '${start.targetSerial}'",
            )
        }

        state.operatorConfirmationPhrase = phrase

        val orchestrator = cachedOrchestrator
            ?: return errorResponse(
                request = request,
                code = "ADB_UNAVAILABLE",
                message = "Refused: no workstation session is attached to this command",
            )

        val targetSerial = start.targetSerial
        val operatorId = request.stringPayload(KEY_OPERATOR_ID)
            ?: start.preRecord?.operatorId
            ?: DEFAULT_OPERATOR_ID

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

        state.lifecycleResult = result

        val execution = result.executionResult
            ?: return errorResponse(
                request = request,
                code = "SANITIZE_EXECUTION_REFUSED",
                message = result.blockReasons.joinToString("; ").ifBlank {
                    "Sanitization execution was refused before any destructive step"
                },
            )

        val deviceLifecycleId = WorkstationSessionOrchestrator.deviceLifecycleIdFor(targetSerial)
        val auditPdf = runCatching {
            pdfReportWriter.writeSanitizationAuditPdf(
                serial = targetSerial,
                deviceLifecycleId = deviceLifecycleId,
                sessionUuid = scan.sessionUuid,
                verificationReportId = scan.report.header.reportId,
                lifecycleResult = result,
                operatorId = operatorId,
            ).also { state.sanitizationAuditPdfArtifact = it }
        }.getOrNull()

        val certificate = result.finalReport
        val certificateJson = result.finalReportJson
        val certificateMarkdown = result.finalReportMarkdown.orEmpty()
        val storedCertificate = if (certificate != null && certificateJson != null) {
            runCatching {
                reportStore.writeCertificate(
                    certificateId = certificate.header.reportId,
                    jsonContent = certificateJson,
                    markdownContent = certificateMarkdown,
                )
            }.getOrNull()
        } else {
            null
        }

        val debitApplied = licenseService.debitForSession(scan.sessionUuid)
        state.sanitizedDisconnected = true

        val verification = result.verificationResult
        return okResponse(
            request,
            buildJsonObject {
                put("workflowMode", "CONSOLIDATED_SANITIZE_AUTHORIZE")
                put("step", "CONSOLIDATED_SANITIZE_AUTHORIZED_AND_VERIFIED")
                put(KEY_SERIAL, targetSerial)
                put("sessionUuid", scan.sessionUuid)
                put("deviceLifecycleId", deviceLifecycleId)
                put("operationId", execution.operationId)
                put("acknowledged", true)
                put("phraseAccepted", true)
                put("executionStatus", execution.executionStatus)
                put("executionSuccess", execution.isSuccess)
                put("sanitizationAuditReportGenerated", auditPdf != null)
                put("lifecycleOutcome", certificate?.lifecycleOutcome?.name ?: "NOT_RECORDED")
                put("verificationStatus", verification?.status?.name ?: "NOT_RUN")
                put("status", verification?.status?.name ?: "NOT_RUN")
                put("postResetStateDetected", verification?.postResetStateDetected ?: false)
                put(
                    "userDataInaccessible",
                    verification?.userDataInaccessible?.let { JsonPrimitive(it) } ?: JsonNull,
                )
                put("setupWizardDetected", verification?.setupWizardDetected ?: false)
                put("assuranceLevel", verification?.assuranceLevel ?: "REQUIRES_EXTERNAL_VERIFICATION")
                put("limitations", stringArray(verification?.limitations))
                put("successClaimed", result.successClaimed)
                put("sanitizationSuccessClaimed", result.successClaimed)
                put("finalReportAvailable", certificate != null)
                put("certificateId", certificate?.header?.reportId ?: "")
                put("debitApplied", debitApplied)
                put("scansRemaining", licenseService.getLicense().scansRemaining)
                put("sessionDisconnected", true)
                put("blockReasons", stringArray(result.blockReasons))
                put("decision", "D-1 OUTCOME B: destructive trigger remains hardware-gated")
                auditPdf?.let {
                    put("pdfPath", it.pdfPath)
                    put("pdfFileName", it.fileName)
                    put("pdfSha256", it.pdfSha256)
                }
                storedCertificate?.let {
                    put("certificateJsonPath", it.jsonPath)
                    put("certificateMarkdownPath", it.markdownPath)
                    put("manifestPath", it.manifestPath)
                }
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
        val state = sessionFor(request)
        val start = state?.lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_CONFIRM",
            )
        serialOwnershipRefusal(request, "SANITIZE_CONFIRM", start.targetSerial)
            ?.let { return it }
        val session = start.session ?: return notEligibleError(request, state)

        if (state.operatorAcknowledged != true) {
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

        state.operatorConfirmationPhrase = phrase
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
     * Execution runs the real provider path (PUR-004, agent-based route). It answers
     * `TRIGGERED_AGENT_BASED_REBOOT_PENDING` when the CYVRA sanitization agent is
     * installed and enrolled as device owner, and a blocked status when it is not.
     * A blocked answer is a correct outcome rather than a failure: it means this
     * device has no purge method available to this build, and the response says so
     * instead of issuing a command that could not have worked.
     *
     * Delivery of the trigger is never erasure, and nothing here may be read as
     * claiming any. See HostDestructiveWipeProvider and verification (PUR-005).
     */
    private fun sanitizeExecuteResponse(request: HostRequest): HostResponse {
        val offlineLicense = licenseResult
        if (offlineLicense.isLicensed && !offlineLicense.offline.sanitizeExecute) {
            return errorResponse(
                request = request,
                code = "SANITIZE_LOCKED_OFFLINE",
                message = "Refused: destructive sanitization is not allowed while this " +
                    "workstation is running on a cached entitlement. Reconnect to CYVORIQ " +
                    "so the licence can be confirmed, then try again.",
            )
        }

        val state = sessionFor(request)
        val start = state?.lifecycleStart
            ?: return errorResponse(
                request = request,
                code = "NO_SANITIZE_SESSION",
                message = "SANITIZE_START must succeed before SANITIZE_EXECUTE",
            )
        if (start.session == null) return notEligibleError(request, state)

        if (state.operatorAcknowledged != true) {
            return errorResponse(
                request = request,
                code = "SANITIZE_ACK_REQUIRED",
                message = "Refused: step 1 acknowledgement has not been recorded",
            )
        }

        val phrase = state.operatorConfirmationPhrase
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

        // Serial-when-present (D-3, U-2(a)): this operation is lifecycle-bound, so
        // the target locked at SANITIZE_START is authoritative. A differing wire
        // serial is refused before it can reach the destructive call — it can never
        // substitute the execution target. Absent/matching serial is unchanged.
        serialOwnershipRefusal(request, "SANITIZE_EXECUTE", start.targetSerial)
            ?.let { return it }
        val targetSerial = start.targetSerial
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

        state.lifecycleResult = result

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
        val state = sessionFor(request)
        val result = state?.lifecycleResult
            ?: return errorResponse(
                request = request,
                code = "NO_EXECUTION_SESSION",
                message = "SANITIZE_EXECUTE must succeed before SANITIZE_VERIFY",
            )
        serialOwnershipRefusal(request, "SANITIZE_VERIFY", state.lastScan?.deviceDescriptor?.serial)
            ?.let { return it }
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
                // Tri-state. null means NOT ESTABLISHED and must not be coerced into a
                // boolean, because both false and true would be a claim about the device.
                put(
                    "userDataInaccessible",
                    verification.userDataInaccessible?.let { JsonPrimitive(it) } ?: JsonNull,
                )
                put("setupWizardDetected", verification.setupWizardDetected)
                // PUR-006 residual inventory. null means NOT MEASURED and must not be
                // coerced to 0: zero packages would be a claim about the device, while
                // an unestablished count is only a claim about our knowledge.
                put(
                    "residualTotalPackages",
                    verification.residualTotalPackages?.let { JsonPrimitive(it) } ?: JsonNull,
                )
                put(
                    "residualThirdPartyPackages",
                    verification.residualThirdPartyPackages?.let { JsonPrimitive(it) } ?: JsonNull,
                )
                put(
                    "residualCyvraPackages",
                    verification.residualCyvraPackages?.let { JsonPrimitive(it) } ?: JsonNull,
                )
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
        val state = sessionFor(request)
        val result = state?.lifecycleResult
            ?: return errorResponse(
                request = request,
                code = "NO_EXECUTION_SESSION",
                message = "SANITIZE_EXECUTE must succeed before GET_FINAL_REPORT",
            )
        // Serial-when-present (U-2(a)): ownership is judged against the resolved scan's
        // recorded serial — never the lifecycle result (which carries no serial) and
        // never a client-supplied reference value.
        serialOwnershipRefusal(request, "GET_FINAL_REPORT", state.lastScan?.deviceDescriptor?.serial)
            ?.let { return it }
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

        val sessionUuid = state.lastScan?.sessionUuid
        val debitApplied = sessionUuid != null && licenseService.debitForSession(sessionUuid)
        val targetSerial = state.lastScan?.deviceDescriptor?.serial ?: ""
        val deviceLifecycleId = if (targetSerial.isNotBlank()) {
            WorkstationSessionOrchestrator.deviceLifecycleIdFor(targetSerial)
        } else {
            ""
        }
        val auditPdf = runCatching {
            val existing = state.sanitizationAuditPdfArtifact
            if (existing != null && existing.sessionUuid == sessionUuid) {
                existing
            } else if (targetSerial.isNotBlank() && sessionUuid != null) {
                pdfReportWriter.writeSanitizationAuditPdf(
                    serial = targetSerial,
                    deviceLifecycleId = deviceLifecycleId,
                    sessionUuid = sessionUuid,
                    verificationReportId = certificate.verificationReportReference ?: "",
                    lifecycleResult = result,
                    operatorId = certificate.header.operatorId,
                ).also { state.sanitizationAuditPdfArtifact = it }
            } else {
                null
            }
        }.getOrNull()

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
                auditPdf?.let {
                    put("pdfPath", it.pdfPath)
                    put("pdfFileName", it.fileName)
                    put("pdfSha256", it.pdfSha256)
                }
                put("artifactsWritten", true)
                put("debitApplied", debitApplied)
                put("scansRemaining", licenseService.getLicense().scansRemaining)
                put(
                    "manifest",
                    buildJsonObject {
                        put("algorithm", "SHA-256")
                        put("jsonSha256", written.jsonSha256)
                        put("markdownSha256", written.markdownSha256)
                        auditPdf?.let { put("pdfSha256", it.pdfSha256) }
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
    @Synchronized
    private fun orchestratorFor(adbBinary: java.io.File): WorkstationSessionOrchestrator {
        cachedOrchestrator?.let { return it }
        val built = orchestratorFactory(adbBinary, licenseService)
        cachedOrchestrator = built
        return built
    }

    /**
     * The live device identity of the scan being recorded, for contract §6 step 7.
     *
     * Returns null when the descriptor did not carry every field `oem_scope` matching
     * needs. A partial identity is not guessed at: with no profile the verifier records
     * every patch as NOT APPLICABLE, which is conservative and cannot assert scope that
     * was never observed.
     */
    private fun deviceProfileFor(descriptor: WorkstationDeviceDescriptor): DeviceProfile? {
        val manufacturer = descriptor.manufacturer?.takeIf { it.isNotBlank() } ?: return null
        val model = descriptor.model?.takeIf { it.isNotBlank() } ?: return null
        val apiLevel = descriptor.apiLevel ?: return null
        return DeviceProfile(
            manufacturer = manufacturer,
            model = model,
            apiLevel = apiLevel,
        )
    }

    /**
     * Runs the probe suite once for the scan that just completed, over the capability
     * matrix's real domain rows, and returns one [ProbeResult] per domain.
     *
     * Only production sources are wired. The ADB plane (P3) is backed by the real
     * [AdbClient] already resolved for the scan. The USB/PnP (P1), WPD/MTP (P2) and
     * companion (P4) planes have no production platform adapter in this repository, so
     * they are deliberately NOT registered: `TransportManager` records each of their
     * domains as an honest `TRANSPORT_NOT_REGISTERED` refusal. A refused or unavailable
     * plane is never simulated as a successful observation.
     *
     * Returns null when the matrix cannot be loaded, so no evidence is captured from a
     * matrix the engine would itself treat as unusable.
     */
    private fun probeCapture(serial: String): List<ProbeResult>? {
        val matrixLoader = CapabilityMatrixLoader()
        val matrix = (matrixLoader.load() as? MatrixLoadResult.Loaded)?.matrix ?: return null
        val adbBinary = adbLocator.locate()
        if (adbBinary == null) {
            // No ADB binary resolved: no plane can answer. Record an honest refusal per
            // domain rather than fabricating an observation or capturing nothing.
            return matrix.rows.map { domain ->
                ProbeResult(
                    domain = domain.domain,
                    plane = Plane.ADB,
                    outcome = ProbeOutcome.NOT_OBSERVABLE,
                    result = CapabilityResult.NOT_AVAILABLE,
                    reasonCode = "ADB_BINARY_UNRESOLVED",
                )
            }
        }
        val transportManager = TransportManager(
            loader = matrixLoader,
            transports = listOf(AdbTransport(adbClientFor(adbBinary)) { serial }),
        )
        return matrix.rows.map { transportManager.probe(it.domain) }
    }

    private fun getChecklistResponse(request: HostRequest): HostResponse {
        val requestedSerial = request.stringPayload(KEY_SERIAL)
        val record = if (requestedSerial != null) {
            deviceSessions[requestedSerial]?.checklistRecord
        } else {
            activeSerial?.let { deviceSessions[it]?.checklistRecord }
        }
        return okResponse(
            request,
            buildJsonObject {
                put("expectedCount", TechnicianChecklistCatalog.expectedCount)
                put("source", TechnicianCheckResult.OPERATOR_SOURCE)
                put("attestationKind", "OPERATOR_ATTESTATION")
                put(
                    "claim",
                    "These checks are performed by a person. The product records what they " +
                        "found and never presents it as a software observation.",
                )
                put(
                    "checks",
                    JsonArray(
                        TechnicianChecklistCatalog.all.map { check ->
                            buildJsonObject {
                                put("id", check.id)
                                put("domain", check.domain)
                                put("item", check.item)
                                put("priority", check.priority)
                                put("whyNotAutomatable", check.whyNotAutomatable)
                            }
                        },
                    ),
                )
                put("outcomes", stringArray(TechnicianCheckOutcome.entries.map { it.name }))
                put("progress", checklistProgress(record))
            },
        )
    }

    /**
     * RECORD_CHECKLIST — a technician's answers, authored and bound to this session.
     *
     * Every refusal below is a refusal rather than a silent drop. An unknown id would let
     * a client invent a check the workbook never ratified; an outcome outside the four
     * would let it answer with something the report has no vocabulary for. Both are
     * rejected with the reason, because a checklist that quietly loses rows is
     * indistinguishable from one that was never worked.
     */
    private fun recordChecklistResponse(request: HostRequest): HostResponse {
        val state = sessionFor(request)
        val scan = state?.lastScan ?: return noScanError(request, "RECORD_CHECKLIST")
        serialOwnershipRefusal(request, "RECORD_CHECKLIST", scan.deviceDescriptor.serial)
            ?.let { return it }

        val operatorId = request.stringPayload(KEY_OPERATOR_ID)
            ?: scan.report.header.operatorId
        val recordedAt = java.time.Instant.now().toString()

        val results = request.payload["results"] as? JsonArray
            ?: return rejectedResponse(request, ChecklistRecorder.malformed)

        val identity = scan.report.deviceIdentity
        val deviceIdentifier = listOfNotNull(identity.brand.value, identity.model.value)
            .joinToString(" ")
            .ifBlank { "unknown-device" }

        val submission = ChecklistRecorder.apply(
            existing = state.checklistRecord,
            results = results,
            operatorId = operatorId,
            sessionUuid = scan.report.header.sessionUuid,
            deviceIdentifier = deviceIdentifier,
            recordedAt = recordedAt,
        )

        val rejected = submission as? ChecklistSubmission.Rejected
        if (rejected != null) {
            return rejectedResponse(request, rejected)
        }

        val updated = (submission as ChecklistSubmission.Accepted).record
        state.checklistRecord = updated

        return okResponse(
            request,
            buildJsonObject {
                put("checklistId", updated.checklistId)
                put("sessionUuid", updated.sessionUuid)
                put("deviceIdentifier", updated.deviceIdentifier)
                put("source", TechnicianCheckResult.OPERATOR_SOURCE)
                put("recordedAt", recordedAt)
                put(
                    "results",
                    JsonArray(
                        updated.results.map { result ->
                            buildJsonObject {
                                put("id", result.id)
                                put("outcome", result.outcome.name)
                                put("operatorId", result.operatorId)
                                put("observedAt", result.observedAt)
                                result.note?.let { put("note", it) }
                            }
                        },
                    ),
                )
                put("progress", checklistProgress(updated))
            },
        )
    }

    /**
     * Turns a [ChecklistSubmission.Rejected] into a wire error without restating its code
     * or message. Both the transport-level check and the recorder funnel through here so
     * an error code has exactly one spelling.
     */
    private fun rejectedResponse(
        request: HostRequest,
        rejection: ChecklistSubmission.Rejected,
    ): HostResponse = errorResponse(
        request = request,
        code = rejection.code,
        message = rejection.message,
    )

    /**
     * Progress object shared by both commands.
     *
     * `unansweredIds` is what keeps incompleteness visible: a checklist opened but not
     * finished must never read like one that was finished with everything passing. When
     * nothing has been recorded yet, every id is unanswered rather than zero of them.
     */
    private fun checklistProgress(record: TechnicianChecklistRecord?): JsonObject {
        val expected = TechnicianChecklistCatalog.ids
        val unanswered = record?.unansweredIds(expected) ?: expected
        return buildJsonObject {
            put("hasSession", record != null)
            put("expectedCount", expected.size)
            put("answeredCount", record?.answeredCount ?: 0)
            put("recordedCount", record?.recordedCount ?: 0)
            put("complete", record?.isComplete(expected) ?: false)
            put("unansweredIds", stringArray(unanswered))
        }
    }

    private fun noScanError(request: HostRequest, command: String): HostResponse =
        errorResponse(
            request = request,
            code = "NO_SCAN_SESSION",
            message = "$command requires a completed scan; this session holds no RUN_SCAN result",
        )

    /**
     * Serial-when-present ownership rule (U-2(a), ratified 21 October 2026).
     *
     * A retrieval request that explicitly names a device serial must never be
     * answered from a different device's active scan: a present-but-different
     * serial is refused with `SERIAL_MISMATCH`. An absent serial is NOT a
     * mismatch — the single-session workstation UI sends no serial today, and
     * that behaviour is deliberately preserved, not silently changed.
     *
     * [activeSerial] is the serial recorded on the active scan itself; a request
     * that names a serial while no scan records one cannot be verified against
     * anything and is refused rather than served blind.
     */
    private fun serialOwnershipRefusal(
        request: HostRequest,
        command: String,
        activeSerial: String?,
    ): HostResponse? {
        val requested = request.stringPayload(KEY_SERIAL) ?: return null
        if (activeSerial == null || requested != activeSerial) {
            return errorResponse(
                request = request,
                code = "SERIAL_MISMATCH",
                message = "$command refused: payload.serial '$requested' does not match the " +
                    "active scan's device" +
                    (activeSerial?.let { " ('$it')." } ?: "; no active scan records one."),
            )
        }
        return null
    }

    private fun notEligibleError(request: HostRequest, state: DeviceSessionState?): HostResponse {
        val reasons = state?.lifecycleStart?.eligibility?.blockReasons
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

        /**
         * Refusal code returned when authoritative scan evidence (actual probe results and
         * the applied patch state) is unavailable for the completed scan at FINALISE_REPORT.
         *
         * A controlled final report may never silently substitute an empty probe list or the
         * default patch state, so the absence is surfaced as an explicit refusal instead.
         */
        const val FINALISE_INPUTS_UNAVAILABLE: String = "FINALISE_INPUTS_UNAVAILABLE"

        /**
         * The `imeiReason` every connected-device row carries.
         *
         * Reading an IMEI needs privileged Android permissions this workstation does not
         * hold, so the field is stated as a limitation rather than left blank or filled in.
         */
        private const val IMEI_REASON: String =
            "IMEI is not readable over this phone connection on this build; it is never guessed."

        private const val KEY_SERIAL = "serial"
        private const val KEY_OPERATOR_ID = "operatorId"
        private const val KEY_DEVICE_SIDE_INVENTORY = "deviceSideInventory"
        private const val KEY_ACKNOWLEDGED = "acknowledged"
        private const val KEY_CONFIRMATION_PHRASE = "confirmationPhrase"
        private const val DEFAULT_OPERATOR_ID = "unspecified-operator"
        private const val PLACEHOLDER_OPERATION_ID = "PURGE-OP-PENDING"
    }
}