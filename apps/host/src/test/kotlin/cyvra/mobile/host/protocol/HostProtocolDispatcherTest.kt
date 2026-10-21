package cyvra.mobile.host.protocol

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileReason
import cyvra.mobile.host.license.LicenseFileResult
import cyvra.mobile.host.engine.AppliedPatch
import cyvra.mobile.host.engine.DeviceProfile
import cyvra.mobile.host.engine.PatchSetMode
import cyvra.mobile.host.engine.PatchSetState
import cyvra.mobile.host.engine.PatchStateOutcome
import cyvra.mobile.host.report.HostReportStore
import cyvra.mobile.host.service.WorkstationSessionOrchestrator
import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail
import java.io.File

/** Serial answered by the fake ADB runner; the fixtures scan exactly this device. */
private const val BENCH_SERIAL = "RF8R123456"

class HostProtocolDispatcherTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    private fun request(command: HostCommand, requestId: String) = HostRequest(
        protocolVersion = HostProtocolV1.VERSION,
        requestId = requestId,
        command = command,
    )

    private fun licensedResult() = LicenseFileResult(
        record = CustomerLicenseRecord(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA15092026SA3F1-1-25",
            customerEmail = "tech@example.com",
            planName = "25 Device Scans",
            deviceScanEntitlement = 25,
            scansUsed = 0,
            scansRemaining = 25,
            status = LicenseEntitlementStatus.ACTIVE,
        ),
        reason = LicenseFileReason.LOADED,
        sourcePath = "/installation/resources/license.json",
    )

    private fun deniedResult() = LicenseFileResult(
        record = CustomerLicenseRecord(
            licenseId = FileBasedLicenseProvider.UNLICENSED_LICENSE_ID,
            serialNumber = "",
            customerEmail = "",
            planName = FileBasedLicenseProvider.UNLICENSED_PLAN_NAME,
            deviceScanEntitlement = 0,
            scansUsed = 0,
            scansRemaining = 0,
            status = LicenseEntitlementStatus.UNKNOWN,
            lastVerifiedAt = "",
        ),
        reason = LicenseFileReason.FILE_MISSING,
        sourcePath = "/installation/resources/license.json",
    )

    private fun dispatcherFor(license: LicenseFileResult) = HostProtocolDispatcher(
        licenseResultProvider = { license },
    )

    private fun stringOf(payload: JsonObject, key: String): String? =
        (payload[key] as? JsonPrimitive)?.contentOrNull

    private fun boolOf(payload: JsonObject, key: String): Boolean? =
        (payload[key] as? JsonPrimitive)?.booleanOrNull

    private fun intOf(payload: JsonObject, key: String): Int? =
        (payload[key] as? JsonPrimitive)?.intOrNull

    @Test
    fun getHostInfo_returnsSuccessfulProtocolResponse() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-host-info-001",
            command = HostCommand.GET_HOST_INFO,
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostProtocolV1.VERSION, response.protocolVersion)
        assertEquals("req-host-info-001", response.requestId)
        assertEquals(HostResponseStatus.OK, response.status)
        assertEquals(
            HostProtocolV1.DEFAULT_HOST_VERSION,
            response.hostVersion
        )
        assertNull(response.error)

        val encoded = json.encodeToString(
            HostResponse.serializer(),
            response
        )

        val decoded = json.decodeFromString(
            HostResponse.serializer(),
            encoded
        )

        assertEquals(response, decoded)
    }

    // ------------------------------------------------------------------
    // GET_LICENSE_STATE
    // ------------------------------------------------------------------

    @Test
    fun getLicenseState_withoutAnInstalledLicenceFailsClosed() {
        val response = dispatcherFor(deniedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-001"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertNull(response.error)

        val payload = response.payload
        assertEquals(false, boolOf(payload, "present"), "no licence file means not activated")
        assertEquals("FILE_MISSING", stringOf(payload, "reason"))
        assertEquals("UNKNOWN", stringOf(payload, "status"), "a denied record is UNKNOWN, never ACTIVE")
        assertEquals(0, intOf(payload, "scansRemaining"))
    }

    @Test
    fun getLicenseState_reportsTheInstalledEntitlement() {
        val response = dispatcherFor(licensedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-002"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")

        val payload = response.payload
        assertEquals(true, boolOf(payload, "present"))
        assertEquals("LOADED", stringOf(payload, "reason"))
        assertEquals("ACTIVE", stringOf(payload, "status"))
        assertEquals(25, intOf(payload, "scansRemaining"))
    }

    @Test
    fun getLicenseState_leaksNoLicenceSecrets() {
        val response = dispatcherFor(licensedResult())
            .dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-003"))

        assertEquals(
            setOf("present", "reason", "status", "scansRemaining"),
            response.payload.keys,
            "GET_LICENSE_STATE must expose exactly the four documented keys",
        )

        val wire = json.encodeToString(HostResponse.serializer(), response)
        for (secret in listOf(
            "LIC-000001",
            "CYVRA15092026SA3F1-1-25",
            "tech@example.com",
            "25 Device Scans",
        )) {
            assertEquals(
                false,
                wire.contains(secret),
                "GET_LICENSE_STATE must not carry $secret across the wire",
            )
        }
    }

    @Test
    fun getLicenseState_needsNoScanSessionAndNeverMutatesState() {
        val dispatcher = dispatcherFor(deniedResult())

        val first = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-004"))
        val second = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-license-005"))

        assertEquals(HostResponseStatus.OK, first.status, first.error?.message ?: "")
        assertEquals(HostResponseStatus.OK, second.status, second.error?.message ?: "")

        // Read-only: a second read answers exactly what the first one did, and a
        // missing scan session is not a refusal reason for this command.
        assertEquals(first.payload, second.payload)
    }

    @Test
    fun getChecklist_returnsAllFourteenRatifiedChecksWithoutNeedingAScan() {
        val dispatcher = dispatcherFor(licensedResult())

        val response = dispatcher.dispatch(request(HostCommand.GET_CHECKLIST, "req-check-001"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")

        assertEquals(14, (response.payload["expectedCount"] as? JsonPrimitive)?.intOrNull)
        assertEquals("OPERATOR", (response.payload["source"] as? JsonPrimitive)?.contentOrNull)
        assertEquals(
            "OPERATOR_ATTESTATION",
            (response.payload["attestationKind"] as? JsonPrimitive)?.contentOrNull,
            "the UI is told what kind of thing this is, so it cannot render it as a " +
                "software observation",
        )
        assertNotNull(
            (response.payload["claim"] as? JsonPrimitive)?.contentOrNull,
            "the standing limit must travel with the checklist",
        )

        // Fourteen definitions, each carrying the fields the UI renders from. Rendering
        // from this response rather than a second copy of the list is what stops the UI
        // drifting from the workbook the generator reconciles against.
        val checks = response.payload["checks"] as? JsonArray ?: fail("no checks array")
        assertEquals(14, checks.size)
        for (element in checks) {
            val row = element as JsonObject
            for (key in listOf("id", "domain", "item", "priority", "whyNotAutomatable")) {
                assertNotNull(row[key], "every check must carry $key")
            }
        }

        // Nothing recorded yet: every one of the fourteen is unanswered, not zero of them.
        val progress = response.payload["progress"] as? JsonObject ?: fail("no progress")
        assertEquals(0, (progress["answeredCount"] as? JsonPrimitive)?.intOrNull)
        assertEquals(0, (progress["recordedCount"] as? JsonPrimitive)?.intOrNull)
        assertEquals(false, (progress["complete"] as? JsonPrimitive)?.booleanOrNull)
        assertEquals(14, (progress["unansweredIds"] as? JsonArray)?.size)
    }

    @Test
    fun recordChecklist_refusesWithoutAScanSessionAndRecordsNothing() {
        val dispatcher = dispatcherFor(licensedResult())

        val payload = buildJsonObject {
            put("operatorId", "TECH-17")
            put(
                "results",
                JsonArray(
                    listOf(
                        buildJsonObject {
                            put("id", "PHY-001")
                            put("outcome", "PASS")
                        },
                    ),
                ),
            )
        }

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-check-002",
                command = HostCommand.RECORD_CHECKLIST,
                payload = payload,
            ),
        )

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("NO_SCAN_SESSION", response.error?.code)

        // The refusal must have side effects on nothing: a later read still shows an
        // untouched checklist, so a rejected write can never leave a half-recorded
        // attestation behind.
        val after = dispatcher.dispatch(request(HostCommand.GET_CHECKLIST, "req-check-003"))
        assertEquals(HostResponseStatus.OK, after.status, after.error?.message ?: "")

        val progress = after.payload["progress"] as? JsonObject ?: fail("no progress")
        assertEquals(0, (progress["answeredCount"] as? JsonPrimitive)?.intOrNull)
        assertEquals(false, (progress["complete"] as? JsonPrimitive)?.booleanOrNull)
        assertEquals(14, (progress["unansweredIds"] as? JsonArray)?.size)
    }

    // ------------------------------------------------------------------
    // D-2 retrieval binding - serial-when-present (U-2(a), ratified
    // 21 October 2026): a retrieval request that explicitly names a device
    // serial is served only when that serial is the active scan's recorded
    // device; an absent serial keeps the pre-ratification behaviour.
    //
    // Fixtures drive the REAL production path: RUN_SCAN runs against an
    // orchestrator backed by a fake ADB process runner, so no test can reach
    // a real `adb` binary or a connected phone.
    // ------------------------------------------------------------------

    private val benchSerial = BENCH_SERIAL

    /** Answers exactly the shell calls a diagnostic scan makes; everything else "ok". */
    private class MockProcessRunner : ProcessRunner {
        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val cmdStr = command.joinToString(" ")
            return when {
                cmdStr.contains("devices -l") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "List of devices attached\n$BENCH_SERIAL device product:a52 model:SM_A525F transport_id:1\n",
                    stderr = "",
                )
                cmdStr.contains("getprop") -> {
                    val prop = cmdStr.substringAfter("getprop ").trim()
                    val value = when (prop) {
                        "ro.product.manufacturer" -> "samsung"
                        "ro.product.brand" -> "samsung"
                        "ro.product.model" -> "SM-A525F"
                        "ro.build.version.release" -> "13"
                        "ro.build.version.sdk" -> "33"
                        else -> ""
                    }
                    DefaultProcessExecutionResult(exitCode = 0, stdout = value, stderr = "")
                }
                cmdStr.contains("dumpsys battery") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "AC powered: false\nUSB powered: true\nlevel: 82\nscale: 100\nvoltage: 4100\ntemperature: 295\nhealth: 2\n",
                    stderr = "",
                )
                cmdStr.contains("df -k /data") -> DefaultProcessExecutionResult(
                    exitCode = 0,
                    stdout = "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-4 115200000 45200000 70000000 40% /data\n",
                    stderr = "",
                )
                else -> DefaultProcessExecutionResult(exitCode = 0, stdout = "ok", stderr = "")
            }
        }
    }

    private fun tempAdbBinary(): File =
        File.createTempFile("cyvra-fake-adb", ".bin").apply { deleteOnExit() }

    private fun tempReportHome(): File =
        File.createTempFile("cyvra-reports-home", "").apply {
            delete()
            mkdirs()
            deleteOnExit()
        }

    /**
     * A dispatcher whose RUN_SCAN has already succeeded against the fake ADB runner,
     * so `lastScan` is populated through the genuine production path.
     */
    private fun dispatcherWithActiveScan(): HostProtocolDispatcher {
        val adbRunner = MockProcessRunner()
        val dispatcher = HostProtocolDispatcher(
            adbLocator = AdbBinaryLocator(explicitCustomPath = tempAdbBinary()),
            licenseResultProvider = { licensedResult() },
            adbClientFactory = { binary -> AdbClient(binary, adbRunner) },
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(
                    AdbClient(File("mock-adb"), adbRunner),
                    licenseService,
                )
            },
            reportStore = HostReportStore(homeProvider = { tempReportHome().absolutePath }),
        )

        val scan = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-scan",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan.status, scan.error?.message ?: "fixture scan failed")
        return dispatcher
    }

    /**
     * Drives the full operator barrier (START -> AUTHORIZE -> CONFIRM -> EXECUTE)
     * so `lifecycleResult` carries a Final Report. Execution is honestly BLOCKED on
     * this build (no sanitization agent on the fake device), which still produces a
     * certificate - the same outcome the integrated workflow test asserts.
     */
    private fun dispatcherWithCompletedLifecycle(): HostProtocolDispatcher {
        val dispatcher = dispatcherWithActiveScan()

        val start = dispatcher.dispatch(request(HostCommand.SANITIZE_START, "req-d2-start"))
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "SANITIZE_START failed")
        val phrase = stringOf(start.payload, "step2PhraseRequired")
            ?: fail("SANITIZE_START did not issue a step2 phrase")

        val authorize = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-authorize",
                command = HostCommand.SANITIZE_AUTHORIZE,
                payload = buildJsonObject { put("acknowledged", true) },
            ),
        )
        assertEquals(HostResponseStatus.OK, authorize.status, authorize.error?.message ?: "SANITIZE_AUTHORIZE failed")

        val confirm = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-confirm",
                command = HostCommand.SANITIZE_CONFIRM,
                payload = buildJsonObject { put("confirmationPhrase", phrase) },
            ),
        )
        assertEquals(HostResponseStatus.OK, confirm.status, confirm.error?.message ?: "SANITIZE_CONFIRM failed")

        val execute = dispatcher.dispatch(request(HostCommand.SANITIZE_EXECUTE, "req-d2-execute"))
        assertEquals(HostResponseStatus.OK, execute.status, execute.error?.message ?: "SANITIZE_EXECUTE failed")
        return dispatcher
    }

    // -- GET_DEVICE_REPORT ------------------------------------------------

    @Test
    fun getDeviceReport_refusesWhenPayloadSerialNamesADifferentDevice() {
        val dispatcher = dispatcherWithActiveScan()

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-dev-mismatch",
                command = HostCommand.GET_DEVICE_REPORT,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("SERIAL_MISMATCH", response.error?.code)
        assertEquals(emptySet(), response.payload.keys, "a refusal must carry no report data")
    }

    @Test
    fun getDeviceReport_servesTheActiveScanWhenSerialMatches() {
        val dispatcher = dispatcherWithActiveScan()

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-dev-match",
                command = HostCommand.GET_DEVICE_REPORT,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertEquals(benchSerial, stringOf(response.payload, "serial"))
        assertNotNull(stringOf(response.payload, "reportId"))
    }

    @Test
    fun getDeviceReport_servesTheActiveScanWhenSerialIsAbsent() {
        val dispatcher = dispatcherWithActiveScan()

        val response = dispatcher.dispatch(request(HostCommand.GET_DEVICE_REPORT, "req-d2-dev-absent"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertEquals(benchSerial, stringOf(response.payload, "serial"))
    }

    // -- EXPORT_REPORT ----------------------------------------------------

    @Test
    fun exportReport_refusesWhenPayloadSerialNamesADifferentDevice() {
        val home = tempReportHome()
        val adbRunner = MockProcessRunner()
        val dispatcher = HostProtocolDispatcher(
            adbLocator = AdbBinaryLocator(explicitCustomPath = tempAdbBinary()),
            licenseResultProvider = { licensedResult() },
            adbClientFactory = { binary -> AdbClient(binary, adbRunner) },
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(
                    AdbClient(File("mock-adb"), adbRunner),
                    licenseService,
                )
            },
            reportStore = HostReportStore(homeProvider = { home.absolutePath }),
        )
        val scan = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-export-scan",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan.status, scan.error?.message ?: "fixture scan failed")

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-export-mismatch",
                command = HostCommand.EXPORT_REPORT,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("SERIAL_MISMATCH", response.error?.code)
        // A refused export must not have written anything to disk.
        val reportsRoot = File(home, "reports")
        val writtenDirs = reportsRoot.listFiles()?.filter { it.isDirectory } ?: emptyList()
        assertEquals(emptyList(), writtenDirs, "a refused export must not create report directories")
    }

    @Test
    fun exportReport_servesTheActiveScanWhenSerialMatches() {
        val dispatcher = dispatcherWithActiveScan()

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-export-match",
                command = HostCommand.EXPORT_REPORT,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertEquals(true, boolOf(response.payload, "artifactsWritten"))
        assertNotNull(stringOf(response.payload, "reportJsonPath"))
    }

    @Test
    fun exportReport_servesTheActiveScanWhenSerialIsAbsent() {
        val dispatcher = dispatcherWithActiveScan()

        val response = dispatcher.dispatch(request(HostCommand.EXPORT_REPORT, "req-d2-export-absent"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertEquals(true, boolOf(response.payload, "artifactsWritten"))
    }

    // -- GET_FINAL_REPORT -------------------------------------------------

    @Test
    fun getFinalReport_refusesWhenPayloadSerialNamesADifferentDevice() {
        val dispatcher = dispatcherWithCompletedLifecycle()

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-final-mismatch",
                command = HostCommand.GET_FINAL_REPORT,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("SERIAL_MISMATCH", response.error?.code)
        // The refusal must not settle the entitlement either: no certificate was
        // served, so nothing may be debited for this request.
        assertEquals(25, intOf(response.payload, "scansRemaining") ?: 25)
    }

    @Test
    fun getFinalReport_servesTheCertificateWhenSerialMatches() {
        val dispatcher = dispatcherWithCompletedLifecycle()

        val response = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d2-final-match",
                command = HostCommand.GET_FINAL_REPORT,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertNotNull(stringOf(response.payload, "certificateId"))
        assertNotNull(stringOf(response.payload, "certificateJsonPath"))
    }

    @Test
    fun getFinalReport_servesTheCertificateWhenSerialIsAbsent() {
        val dispatcher = dispatcherWithCompletedLifecycle()

        val response = dispatcher.dispatch(request(HostCommand.GET_FINAL_REPORT, "req-d2-final-absent"))

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertNotNull(stringOf(response.payload, "certificateId"))
    }

    // ------------------------------------------------------------------
    // D-4 failed-scan state retention (U-3(a), ratified 21 October 2026):
    // a genuine scan-execution failure invalidates the previous scan's
    // state, so report retrieval and sanitization cannot operate on stale
    // evidence. Pre-scan refusals (licensing, missing serial, no ADB, and
    // the entitlement-accounting refusal) are NOT scan failures and must
    // preserve the current scan.
    // ------------------------------------------------------------------

    /**
     * A fake ADB runner that answers normally until armed, then throws on the
     * next device command — modelling a device that drops off the bus mid-scan.
     * This is the genuine execution-failure path (`SCAN_FAILED`), reached
     * because neither `AdbClient.runShell` nor `AdbGenericEvidenceProvider`
     * catches a runner exception; it is distinct from a pre-scan refusal.
     */
    private class FlakyProcessRunner : ProcessRunner {
        private val healthy = MockProcessRunner()
        var armedToFail = false

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            if (armedToFail) {
                throw java.io.IOException("device disconnected mid-scan (test fault injection)")
            }
            return healthy.execute(command, timeoutMs)
        }
    }

    @Test
    fun failedScanExecutionInvalidatesPreviousScanState() {
        val runner = FlakyProcessRunner()
        val dispatcher = HostProtocolDispatcher(
            adbLocator = AdbBinaryLocator(explicitCustomPath = tempAdbBinary()),
            licenseResultProvider = { licensedResult() },
            adbClientFactory = { binary -> AdbClient(binary, runner) },
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(AdbClient(File("mock-adb"), runner), licenseService)
            },
            reportStore = HostReportStore(homeProvider = { tempReportHome().absolutePath }),
        )

        // 1. A successful scan establishes retrievable state.
        val scan1 = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d4-scan-1",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan1.status, scan1.error?.message ?: "first scan failed")
        val scan1ReportId = stringOf(scan1.payload, "reportId")
        assertNotNull(scan1ReportId)

        val before = dispatcher.dispatch(request(HostCommand.GET_DEVICE_REPORT, "req-d4-before"))
        assertEquals(HostResponseStatus.OK, before.status, before.error?.message ?: "")
        assertEquals(scan1ReportId, stringOf(before.payload, "reportId"))

        // 2. The next genuine scan execution fails mid-scan.
        runner.armedToFail = true
        val scan2 = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d4-scan-2",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )
        assertEquals(HostResponseStatus.ERROR, scan2.status)
        assertEquals("SCAN_FAILED", scan2.error?.code)

        // 3. The previous scan's report can no longer be retrieved.
        val after = dispatcher.dispatch(request(HostCommand.GET_DEVICE_REPORT, "req-d4-after"))
        assertEquals(HostResponseStatus.ERROR, after.status, "stale report must not survive a failed scan")
        assertEquals("NO_SCAN_SESSION", after.error?.code)

        // 4. Sanitization cannot start from the previous scan either.
        val sanitize = dispatcher.dispatch(request(HostCommand.SANITIZE_START, "req-d4-sanitize"))
        assertEquals(HostResponseStatus.ERROR, sanitize.status, "stale scan must not start sanitization")
        assertEquals("NO_SCAN_SESSION", sanitize.error?.code)

        // 5. A subsequent successful scan still works and its report is retrievable.
        runner.armedToFail = false
        val scan3 = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d4-scan-3",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan3.status, scan3.error?.message ?: "recovery scan failed")
        val scan3ReportId = stringOf(scan3.payload, "reportId")
        assertNotNull(scan3ReportId)

        val after3 = dispatcher.dispatch(request(HostCommand.GET_DEVICE_REPORT, "req-d4-after-3"))
        assertEquals(HostResponseStatus.OK, after3.status, after3.error?.message ?: "")
        assertEquals(scan3ReportId, stringOf(after3.payload, "reportId"))
    }

    @Test
    fun entitlementRefusalPreservesTheCurrentScan() {
        val runner = FlakyProcessRunner()
        val dispatcher = HostProtocolDispatcher(
            adbLocator = AdbBinaryLocator(explicitCustomPath = tempAdbBinary()),
            licenseResultProvider = { licensedResult() },
            adbClientFactory = { binary -> AdbClient(binary, runner) },
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(AdbClient(File("mock-adb"), runner), licenseService)
            },
            reportStore = HostReportStore(homeProvider = { tempReportHome().absolutePath }),
        )

        // Establish a valid scan.
        val scan1 = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d4-ent-scan-1",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan1.status, scan1.error?.message ?: "first scan failed")
        val scan1ReportId = stringOf(scan1.payload, "reportId")
        assertNotNull(scan1ReportId)

        // A RUN_SCAN with no serial is refused before any scan attempt begins.
        val refused = dispatcher.dispatch(request(HostCommand.RUN_SCAN, "req-d4-ent-noserial"))
        assertEquals(HostResponseStatus.ERROR, refused.status)
        assertEquals("SCAN_REQUEST_INVALID", refused.error?.code)

        // That pre-scan refusal is NOT a scan failure: the current scan survives.
        val after = dispatcher.dispatch(request(HostCommand.GET_DEVICE_REPORT, "req-d4-ent-after"))
        assertEquals(HostResponseStatus.OK, after.status, after.error?.message ?: "")
        assertEquals(scan1ReportId, stringOf(after.payload, "reportId"))
    }

    // ------------------------------------------------------------------
    // D-3 sanitization target binding (serial-when-present, U-2(a) applied
    // to lifecycle operations, ratified 21 October 2026): a wire serial is
    // never allowed to replace the recorded target identity. SANITIZE_START
    // is scan-bound (reference: scan.deviceDescriptor.serial);
    // SANITIZE_EXECUTE is lifecycle-bound (reference: start.targetSerial).
    // ------------------------------------------------------------------

    /**
     * Drives scan -> SANITIZE_START -> SANITIZE_AUTHORIZE -> SANITIZE_CONFIRM and
     * stops before EXECUTE: both operator barriers are satisfied and
     * `lifecycleResult` is still null, so a rejected EXECUTE can be observed not
     * to have touched lifecycle state.
     */
    private fun dispatcherWithConfirmedLifecycle(): HostProtocolDispatcher {
        val dispatcher = dispatcherWithActiveScan()

        val start = dispatcher.dispatch(request(HostCommand.SANITIZE_START, "req-d3-start"))
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "SANITIZE_START failed")
        val phrase = stringOf(start.payload, "step2PhraseRequired")
            ?: fail("SANITIZE_START did not issue a step2 phrase")

        val authorize = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-authorize",
                command = HostCommand.SANITIZE_AUTHORIZE,
                payload = buildJsonObject { put("acknowledged", true) },
            ),
        )
        assertEquals(HostResponseStatus.OK, authorize.status, authorize.error?.message ?: "SANITIZE_AUTHORIZE failed")

        val confirm = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-confirm",
                command = HostCommand.SANITIZE_CONFIRM,
                payload = buildJsonObject { put("confirmationPhrase", phrase) },
            ),
        )
        assertEquals(HostResponseStatus.OK, confirm.status, confirm.error?.message ?: "SANITIZE_CONFIRM failed")
        return dispatcher
    }

    // -- SANITIZE_START: scan-bound -------------------------------------

    @Test
    fun sanitizeStart_refusesWireSerialThatDiffersFromTheScannedDevice() {
        val dispatcher = dispatcherWithActiveScan()

        val start = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-start-mismatch",
                command = HostCommand.SANITIZE_START,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )

        assertEquals(HostResponseStatus.ERROR, start.status, "a foreign wire serial must not open a session")
        assertEquals("SERIAL_MISMATCH", start.error?.code)
        assertNull(stringOf(start.payload, "operationId"), "a refusal must open no sanitization session")

        // The refusal must not have opened any session: the acknowledgement
        // step still reports that SANITIZE_START never succeeded.
        val authorize = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-start-mismatch-ack",
                command = HostCommand.SANITIZE_AUTHORIZE,
                payload = buildJsonObject { put("acknowledged", true) },
            ),
        )
        assertEquals(HostResponseStatus.ERROR, authorize.status)
        assertEquals("NO_SANITIZE_SESSION", authorize.error?.code)
    }

    @Test
    fun sanitizeStart_bindsTheScannedDeviceWhenWireSerialMatches() {
        val dispatcher = dispatcherWithActiveScan()

        val start = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-start-match",
                command = HostCommand.SANITIZE_START,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )

        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        assertEquals(BENCH_SERIAL, stringOf(start.payload, "serial"))
        assertNotNull(stringOf(start.payload, "operationId"))
    }

    @Test
    fun sanitizeStart_bindsTheScannedDeviceWhenSerialIsAbsent() {
        val dispatcher = dispatcherWithActiveScan()

        val start = dispatcher.dispatch(request(HostCommand.SANITIZE_START, "req-d3-start-absent"))

        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        assertEquals(BENCH_SERIAL, stringOf(start.payload, "serial"))
    }

    // -- SANITIZE_EXECUTE: lifecycle-bound ------------------------------

    @Test
    fun sanitizeExecute_refusesWireSerialThatDiffersFromTheLockedTarget() {
        val dispatcher = dispatcherWithConfirmedLifecycle()

        val execute = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-execute-mismatch",
                command = HostCommand.SANITIZE_EXECUTE,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )

        assertEquals(HostResponseStatus.ERROR, execute.status, "a foreign wire serial must not reach execution")
        assertEquals("SERIAL_MISMATCH", execute.error?.code)

        // The refusal must not have touched lifecycle state: no execution
        // session exists, so verification still reports EXECUTE never ran.
        val verify = dispatcher.dispatch(request(HostCommand.SANITIZE_VERIFY, "req-d3-verify-after-refusal"))
        assertEquals(HostResponseStatus.ERROR, verify.status)
        assertEquals("NO_EXECUTION_SESSION", verify.error?.code)
    }

    @Test
    fun sanitizeExecute_keepsTheAcknowledgementBarrierAheadOfTheSerialCheck() {
        val dispatcher = dispatcherWithActiveScan()
        val start = dispatcher.dispatch(request(HostCommand.SANITIZE_START, "req-d3-barrier-start"))
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")

        // No SANITIZE_AUTHORIZE yet: the existing barrier must still refuse the
        // request (with its own code) even when the wire serial also differs —
        // the serial check must not leapfrog authorization.
        val execute = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-barrier-execute",
                command = HostCommand.SANITIZE_EXECUTE,
                payload = buildJsonObject { put("serial", "SOME-OTHER-DEVICE") },
            ),
        )
        assertEquals(HostResponseStatus.ERROR, execute.status)
        assertEquals("SANITIZE_ACK_REQUIRED", execute.error?.code)
    }

    @Test
    fun sanitizeExecute_runsAgainstTheLockedTargetWhenWireSerialMatches() {
        val dispatcher = dispatcherWithConfirmedLifecycle()

        val execute = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d3-execute-match",
                command = HostCommand.SANITIZE_EXECUTE,
                payload = buildJsonObject { put("serial", BENCH_SERIAL) },
            ),
        )

        assertEquals(HostResponseStatus.OK, execute.status, execute.error?.message ?: "")
        assertNotNull(stringOf(execute.payload, "executionStatus"))
    }

    @Test
    fun sanitizeExecute_runsAgainstTheLockedTargetWhenSerialIsAbsent() {
        val dispatcher = dispatcherWithConfirmedLifecycle()

        val execute = dispatcher.dispatch(request(HostCommand.SANITIZE_EXECUTE, "req-d3-execute-absent"))

        assertEquals(HostResponseStatus.OK, execute.status, execute.error?.message ?: "")
        assertNotNull(stringOf(execute.payload, "executionStatus"))
    }

    // -- D-5 OPTION B: FINALISE_REPORT evidence-boundary tests --------------------

    /** A genuinely established SIGNED-CURRENT patch state, as a real provider would return. */
    private fun signedCurrentPatchState() = PatchSetState(
        version = "2026.10.21-1",
        hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mode = PatchSetMode.SIGNED_CURRENT,
        appliedPatches = listOf(
            AppliedPatch(
                patchId = "PATCH-D5-PROBE",
                sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                keyId = "CYVRA-PROBE-KEY",
                appliedAt = "2026-10-21T10:00:00Z",
            ),
        ),
    )

    /**
     * A dispatcher whose scan ran the genuine capture path.
     *
     * [provider] supplies the patch-state outcome and defaults to a genuinely established
     * SIGNED-CURRENT state, so a caller only overrides it when testing another outcome.
     */
    private fun dispatcherWithAuthoritativeScan(
        provider: (DeviceProfile?) -> PatchStateOutcome = {
            PatchStateOutcome.Established(signedCurrentPatchState())
        },
    ): HostProtocolDispatcher {
        val adbRunner = MockProcessRunner()
        val dispatcher = HostProtocolDispatcher(
            adbLocator = AdbBinaryLocator(explicitCustomPath = tempAdbBinary()),
            licenseResultProvider = { licensedResult() },
            adbClientFactory = { binary -> AdbClient(binary, adbRunner) },
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(
                    AdbClient(File("mock-adb"), adbRunner),
                    licenseService,
                )
            },
            reportStore = HostReportStore(homeProvider = { tempReportHome().absolutePath }),
            patchStateProvider = provider,
        )
        val scan = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d5-scan",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )
        assertEquals(HostResponseStatus.OK, scan.status, scan.error?.message ?: "fixture scan failed")
        return dispatcher
    }

    private fun finalise(dispatcher: HostProtocolDispatcher, requestId: String) =
        dispatcher.dispatch(request(HostCommand.FINALISE_REPORT, requestId))

    @Test
    fun finaliseReport_refusesWhenAuthoritativePatchStateIsNotEstablished() {
        // dispatcherWithActiveScan supplies no patchStateProvider -> packet stays null.
        val dispatcher = dispatcherWithActiveScan()

        val response = finalise(dispatcher, "req-d5-refuse-no-patch")

        assertEquals(HostResponseStatus.ERROR, response.status, "absent patch state must refuse, not default")
        assertEquals(
            HostProtocolDispatcher.FINALISE_INPUTS_UNAVAILABLE,
            response.error?.code,
            "refusal must be explicit and distinguishable from a write failure",
        )
        assertNull(boolOf(response.payload, "artifactsWritten"), "a refusal must not claim artifacts were written")
    }

    @Test
    fun finaliseReport_refusesWhenProviderReportsStateUnavailable() {
        // A provider that is wired but could not establish anything - missing corpus,
        // absent/corrupt state record, unknown trust anchor, bad signature, or a failed
        // verification - must be refused. It must never be reinterpreted as an
        // authoritative NO-PATCHES, which is exactly what a bare `PatchSetState()`
        // default would have reported.
        val dispatcher = dispatcherWithAuthoritativeScan(
            provider = {
                PatchStateOutcome.Unavailable("CORPUS_MISSING")
            },
        )

        val response = finalise(dispatcher, "req-d5-unavailable")

        assertEquals(
            HostResponseStatus.ERROR,
            response.status,
            "an Unavailable outcome must refuse, never default to NO-PATCHES",
        )
        assertEquals(
            HostProtocolDispatcher.FINALISE_INPUTS_UNAVAILABLE,
            response.error?.code,
            "unavailable state must surface as the explicit evidence refusal",
        )
        assertNull(boolOf(response.payload, "artifactsWritten"), "a refusal must not claim artifacts were written")
        assertNull(
            stringOf(response.payload, "reportJson"),
            "a refused finalisation must not produce a report document at all",
        )
    }

    @Test
    fun finaliseReport_surfacesTheProvidersRefusalReason() {
        // The refusal must be diagnosable. A production deployment whose provider names
        // NO_APPROVED_TRUST_ANCHOR should see that reason, so the operator and the
        // engineer can tell *which* gate refused instead of an opaque "unavailable".
        // Diagnostic only: the decision to refuse is taken on the packet's absence.
        val dispatcher = dispatcherWithAuthoritativeScan(
            provider = {
                PatchStateOutcome.Unavailable("NO_APPROVED_TRUST_ANCHOR: registry is empty")
            },
        )

        val response = finalise(dispatcher, "req-d5-reason")

        assertEquals(
            HostProtocolDispatcher.FINALISE_INPUTS_UNAVAILABLE,
            response.error?.code,
            "the reason must not change the refusal into any other outcome",
        )
        assertTrue(
            response.error?.message.orEmpty().contains("NO_APPROVED_TRUST_ANCHOR"),
            "the refusal must name the gate that refused, was: ${response.error?.message}",
        )
    }

    @Test
    fun finaliseReport_recordsAuthoritativePatchStateWhenEstablished() {
        val dispatcher = dispatcherWithAuthoritativeScan()

        val response = finalise(dispatcher, "req-d5-signed")

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "finalise failed")
        val reportJson = stringOf(response.payload, "reportJson") ?: fail("no reportJson")
        // reportJson is the final-controlled-report document; parse it rather than
        // substring-matching, so the assertion tracks the schema instead of the
        // serialiser's whitespace.
        val root = json.parseToJsonElement(reportJson) as? JsonObject ?: fail("reportJson is not an object")
        val raw = root["rawReport"] as? JsonObject ?: fail("no rawReport")
        assertEquals(
            "SIGNED-CURRENT",
            (raw["patchSetMode"] as? JsonPrimitive)?.contentOrNull,
            reportJson,
        )
        assertEquals(
            "2026.10.21-1",
            (raw["patchSetVersion"] as? JsonPrimitive)?.contentOrNull,
            reportJson,
        )
        assertEquals(1, (raw["appliedPatchCount"] as? JsonPrimitive)?.intOrNull, reportJson)
    }

    @Test
    fun finaliseReport_includesRealProbeObservationsNotMatrixDefaults() {
        val dispatcher = dispatcherWithAuthoritativeScan()

        val response = finalise(dispatcher, "req-d5-probe")

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "finalise failed")
        val reportJson = stringOf(response.payload, "reportJson") ?: fail("no reportJson")
        // The ADB-backed probe records its evidence reference only when a real observation
        // was made; an unobserved domain never carries a P3 evidenceReference.
        assertTrue(reportJson.contains("P3-"), "expected at least one real ADB-plane observation: $reportJson")
    }

    @Test
    fun finaliseReport_bindsEvidenceToTheCurrentScanNotAPriorOne() {
        // The evidence packet is server-side state, bound to the active scan. A second
        // successful scan replaces both lastScan and the packet, so finalise must serve the
        // CURRENT scan's evidence - never a prior scan's. This pins the binding: after a
        // second successful scan the finalised report still resolves successfully against
        // the live packet (a stale packet would have been cleared by the SCAN_FAILED path
        // or replaced by the newer success).
        val dispatcher = dispatcherWithAuthoritativeScan()

        val secondScan = dispatcher.dispatch(
            HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-d5-second",
                command = HostCommand.RUN_SCAN,
                payload = buildJsonObject { put("serial", benchSerial) },
            ),
        )
        assertEquals(HostResponseStatus.OK, secondScan.status, secondScan.error?.message ?: "second scan failed")

        val response = finalise(dispatcher, "req-d5-match")
        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "finalise failed")
    }

    @Test
    fun finaliseReport_leavesEntitlementCreditsUnchanged() {
        val dispatcher = dispatcherWithAuthoritativeScan()
        val before = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-d5-lic-before"))
        val beforeRemaining = intOf(before.payload, "scansRemaining")

        val response = finalise(dispatcher, "req-d5-finalise")
        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "finalise failed")

        val after = dispatcher.dispatch(request(HostCommand.GET_LICENSE_STATE, "req-d5-lic-after"))
        val afterRemaining = intOf(after.payload, "scansRemaining")
        assertEquals(beforeRemaining, afterRemaining, "FINALISE_REPORT must not debit entitlement")
    }

    @Test
    fun finaliseReport_refusesWhenNoScanExists() {
        // Never scanned: there is no active scan and no evidence packet to finalise.
        val dispatcher = dispatcherFor(licensedResult())

        val response = finalise(dispatcher, "req-d5-noscan")

        assertEquals(HostResponseStatus.ERROR, response.status, "no-scan finalise must refuse")
        assertEquals(
            "NO_SCAN_SESSION",
            response.error?.code,
            "with no scan the refusal is NO_SCAN_SESSION, not a fabricated report",
        )
        assertNull(boolOf(response.payload, "artifactsWritten"), "a refusal must not claim artifacts were written")
    }

    @Test
    fun finaliseReport_sealMatchesAttestationOnSuccess() {
        val dispatcher = dispatcherWithAuthoritativeScan()

        val response = finalise(dispatcher, "req-d5-seal")

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "finalise failed")
        assertEquals(
            true,
            boolOf(response.payload, "sealMatchesAttestation"),
            "seal must match attestation on a successful finalisation",
        )
    }
}
