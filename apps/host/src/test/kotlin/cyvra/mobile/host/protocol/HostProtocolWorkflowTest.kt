package cyvra.mobile.host.protocol

import cyvra.mobile.core.ApplicationClassification
import cyvra.mobile.core.ApplicationClassificationStatus
import cyvra.mobile.core.ApplicationEnabledState
import cyvra.mobile.core.ApplicationEnumerationCompleteness
import cyvra.mobile.core.ApplicationInventoryEvidence
import cyvra.mobile.core.ApplicationInventoryRecord
import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.evidence.AdbApplicationInventoryProvider
import cyvra.mobile.host.license.FileBasedLicenseProvider
import cyvra.mobile.host.license.LicenseFileReason
import cyvra.mobile.host.license.LicenseFileResult
import cyvra.mobile.host.report.HostReportEngine
import cyvra.mobile.host.report.HostReportStore
import cyvra.mobile.host.report.ReportWriteException
import cyvra.mobile.host.service.HostLicenseService
import cyvra.mobile.host.service.WorkstationSessionOrchestrator
import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import java.nio.file.Files
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * P2 wire-level round trips for the ten new workflow commands.
 *
 * FAKE ADB ONLY: the scanner is handed a `File` that resolves inside a temp directory
 * and every process invocation is served by [FakeAdbRunner]. The dispatcher receives an
 * orchestrator factory that ignores the installed binary entirely, so no code path in
 * these tests can reach a real `adb` process or a connected device.
 *
 * Requests and responses are encoded to and decoded from a single JSON line each time,
 * exactly as `HostMain` writes them, so these assertions cover the JSON-lines envelope
 * as well as the workflow itself.
 */
class HostProtocolWorkflowTest {

    companion object {
        private const val SERIAL = "RF8R123456"
        private const val OPERATOR = "operator@cyvoriq.com"
        private const val JSON = "JSON"
    }

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    private val reportEngine = HostReportEngine()

    // ------------------------------------------------------------------
    // Fake ADB
    // ------------------------------------------------------------------

    /** Serves device, evidence and inventory commands from fixed fixtures. */
    private class FakeAdbRunner : ProcessRunner {

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val joined = command.joinToString(" ")

            if (joined.contains("devices -l")) {
                return DefaultProcessExecutionResult(
                    0,
                    "List of devices attached\n$SERIAL device product:a10s model:SM_A107F transport_id:1\n",
                    "",
                )
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

        private fun dumpsysFor(pkg: String): String {
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

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private fun licensedRecord() = CustomerLicenseRecord(
        licenseId = "LIC-000001",
        serialNumber = "CYVRA15092026SA3F1-1-25",
        customerEmail = "tech@example.com",
        planName = "25 Device Scans",
        deviceScanEntitlement = 25,
        scansUsed = 0,
        scansRemaining = 25,
        status = LicenseEntitlementStatus.ACTIVE,
    )

    private fun licensedResult() = LicenseFileResult(
        record = licensedRecord(),
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
        sourcePath = null,
    )

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

    /** Resolves a real `File` inside a temp dir without ever executing it. */
    private fun fakeBinaryLocator(): AdbBinaryLocator {
        val root = Files.createTempDirectory("cyvra-p2-locator").toFile()
        val tools = File(root, "platform-tools")
        tools.mkdirs()
        val binary = File(tools, if (isWindows()) "adb.exe" else "adb")
        binary.writeText("stub")
        return AdbBinaryLocator(installationRootProvider = { root.absolutePath })
    }

    private fun isWindows(): Boolean =
        System.getProperty("os.name")?.lowercase()?.contains("win") == true

    /**
     * Builds a dispatcher whose orchestrator is backed by [FakeAdbRunner]. The binary the
     * dispatcher resolves is deliberately discarded so nothing can reach a real device.
     *
     * [reportStore] defaults to a fail-closed store with no installation root, so a test
     * that never exports cannot write anywhere by accident. [Session] supplies a temporary
     * home for the tests that do.
     */
    private fun dispatcher(
        license: LicenseFileResult = licensedResult(),
        withAdb: Boolean = true,
        reportStore: HostReportStore = HostReportStore(
            reportEngine = reportEngine,
            homeProvider = { null },
        ),
    ): HostProtocolDispatcher =
        HostProtocolDispatcher(
            licenseResultProvider = { license },
            adbLocator = if (withAdb) fakeBinaryLocator() else AdbBinaryLocator(
                installationRootProvider = { null },
                environmentProvider = { null },
            ),
            orchestratorFactory = { _, licenseService ->
                WorkstationSessionOrchestrator(
                    adbClient = AdbClient(File("/mock/adb"), FakeAdbRunner()),
                    licenseService = licenseService,
                )
            },
            reportEngine = reportEngine,
            reportStore = reportStore,
        )

    // ------------------------------------------------------------------
    // JSON-lines session
    // ------------------------------------------------------------------

    /**
     * One operator session. Every exchange is encoded to a single line, decoded back, and
     * then dispatched, so the transcript is the literal wire traffic.
     *
     * [artifactHome] plays the role of `<cyvra.home>`: every artifact this session exports
     * is written underneath it, which lets tests assert against real files on disk instead
     * of trusting the paths echoed back over the wire.
     */
    private inner class Session(
        license: LicenseFileResult = licensedResult(),
        withAdb: Boolean = true,
        val artifactHome: File? = Files.createTempDirectory("cyvra-artifact-home").toFile(),
    ) {
        private val host = dispatcher(
            license = license,
            withAdb = withAdb,
            reportStore = HostReportStore(
                reportEngine = reportEngine,
                homeProvider = { artifactHome?.absolutePath },
            ),
        )

        val transcript = mutableListOf<String>()

        private var counter = 0

        fun send(command: HostCommand, payload: JsonObject = buildJsonObject { }): HostResponse {
            counter += 1
            val request = HostRequest(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "req-%03d".format(counter),
                command = command,
                payload = payload,
            )

            val requestLine = json.encodeToString(HostRequest.serializer(), request)
            transcript += "> $requestLine"

            val response = host.dispatch(
                json.decodeFromString(HostRequest.serializer(), requestLine),
            )

            val responseLine = json.encodeToString(HostResponse.serializer(), response)
            transcript += "< $responseLine"

            // The wire is line-oriented: a response must never span more than one line.
            assertEquals(
                1,
                responseLine.lines().size,
                "a response must be exactly one JSON line",
            )
            return response
        }

        fun scan(): HostResponse {
            val sideInventory = json.parseToJsonElement(
                json.encodeToString(ApplicationInventoryEvidence.serializer(), s1Evidence()),
            )
            val response = send(
                HostCommand.RUN_SCAN,
                buildJsonObject {
                    put("serial", SERIAL)
                    put("operatorId", OPERATOR)
                    put("deviceSideInventory", sideInventory)
                },
            )
            assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
            return response
        }

        fun printTranscript() {
            println("\n=== P2 JSON-LINES SESSION TRANSCRIPT (${transcript.size} lines) ===")
            transcript.forEach { println(it) }
            println("=== END TRANSCRIPT ===\n")
        }
    }

    private fun str(response: HostResponse, key: String): String? =
        (response.payload[key] as? JsonPrimitive)?.contentOrNull

    private fun bool(response: HostResponse, key: String): Boolean? =
        (response.payload[key] as? JsonPrimitive)?.booleanOrNull

    private fun int(response: HostResponse, key: String): Int? =
        (response.payload[key] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()

    /**
     * Independent SHA-256 over raw file bytes, deliberately not going through
     * [HostReportEngine], so a manifest can only pass if it describes what was written.
     */
    private fun sha256Of(bytes: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }

    private fun obj(response: HostResponse, key: String): JsonObject? =
        response.payload[key] as? JsonObject

    private fun list(response: HostResponse, key: String): List<String> =
        (response.payload[key] as? kotlinx.serialization.json.JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            .orEmpty()

    private fun assertError(
        response: HostResponse,
        code: String,
        because: String = "expected a structured refusal",
    ) {
        assertEquals(
            HostResponseStatus.ERROR,
            response.status,
            "$because - got: ${response.error?.message ?: "status=${response.status}"}",
        )
        assertEquals(code, response.error?.code, because)
    }

    // ------------------------------------------------------------------
    // 1. Full report transcript
    // ------------------------------------------------------------------

    @Test
    fun fullReportTranscript_roundTripsOverJsonLines() {
        val session = Session()

        // --- RUN_SCAN -------------------------------------------------
        val scan = session.scan()
        assertEquals("COMPLETED", str(scan, "scanStatus"))
        val reportId = assertNotNull(str(scan, "reportId"))
        assertEquals(SERIAL, str(scan, "serial"))
        assertEquals(24, int(scan, "scansRemaining"))
        assertEquals(HostResponseStatus.OK, scan.status)

        // --- GET_DEVICE_REPORT ---------------------------------------
        val report = session.send(HostCommand.GET_DEVICE_REPORT)
        assertEquals(HostResponseStatus.OK, report.status, report.error?.message ?: "")
        assertEquals(reportId, str(report, "reportId"))
        assertEquals(SERIAL, str(report, "serial"))
        val reportObject = assertNotNull(obj(report, "report"))
        assertTrue(reportObject.containsKey("header"), "Report 1 must arrive as a structured object")
        assertTrue(str(report, "reportMarkdown").orEmpty().contains("CYVRA"), "markdown report missing")
        // Raw UID values live in the evidence layer only and must never reach Report 1.
        assertFalse(
            json.encodeToString(JsonObject.serializer(), reportObject).contains("\"uid\""),
            "raw UID must be withheld from Report 1",
        )

        // --- GET_APPLICATION_INVENTORY -------------------------------
        val inventory = session.send(HostCommand.GET_APPLICATION_INVENTORY)
        assertEquals(HostResponseStatus.OK, inventory.status, inventory.error?.message ?: "")
        assertEquals(true, bool(inventory, "inventoryAvailable"))
        assertEquals(4, int(inventory, "totalApplications"))
        assertEquals("FILTERED", str(inventory, "enumerationCompleteness"))
        assertEquals(true, bool(inventory, "s1EvidencePresent"))
        assertEquals(true, bool(inventory, "s2EvidencePresent"))
        // FILTERED must survive: two scopes never merge into COMPLETE.
        assertEquals("COMPLETE", str(inventory, "s2EnumerationCompleteness"))
        assertTrue(list(inventory, "conflicts").isNotEmpty(), "conflicts must be preserved")
        assertTrue(list(inventory, "limitations").isNotEmpty(), "limitations must be preserved")
        // Raw UID values are withheld from the user-facing report.
        assertEquals(true, bool(inventory, "rawUidWithheld"))
        val serialized = json.encodeToString(HostResponse.serializer(), inventory)
        assertFalse(serialized.contains("\"uid\""), "raw UID must never reach the wire")

        // --- EXPORT_REPORT -------------------------------------------
        val export = session.send(HostCommand.EXPORT_REPORT)
        assertEquals(HostResponseStatus.OK, export.status, export.error?.message ?: "")
        val manifest = assertNotNull(obj(export, "manifest"))
        assertEquals("SHA-256", (manifest["algorithm"] as? JsonPrimitive)?.contentOrNull)

        val exportedJson = assertNotNull(str(export, "reportJson"))
        val exportedMarkdown = assertNotNull(str(export, "reportMarkdown"))
        assertFalse(
            exportedJson.contains("\"uid\""),
            "raw UID must be withheld from the exported Report 1",
        )
        assertEquals(
            reportEngine.computeSha256(exportedJson),
            (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
            "json digest must match the exported bytes",
        )
        assertEquals(
            reportEngine.computeSha256(exportedMarkdown),
            (manifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
            "markdown digest must match the exported bytes",
        )
        assertEquals(
            reportObject,
            json.parseToJsonElement(exportedJson),
            "GET_DEVICE_REPORT and EXPORT_REPORT must carry the same Report 1",
        )

        // P3: absolute paths to the persisted artifacts travel with the content.
        val jsonPath = assertNotNull(str(export, "reportJsonPath"))
        val markdownPath = assertNotNull(str(export, "reportMarkdownPath"))
        val manifestPath = assertNotNull(str(export, "manifestPath"))
        listOf(jsonPath, markdownPath, manifestPath).forEach { path ->
            assertTrue(File(path).isAbsolute, "artifact path must be absolute: $path")
        }
        assertEquals(true, bool(export, "artifactsWritten"))

        session.printTranscript()
    }

    // ------------------------------------------------------------------
    // 1b. P3: artifact persistence under <cyvra.home>
    // ------------------------------------------------------------------

    /** Drives gate -> acknowledgement -> phrase -> execution, then reads the certificate. */
    private fun driveSanitizationToExecution(session: Session): HostResponse {
        val start = session.send(HostCommand.SANITIZE_START)
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        val phrase = assertNotNull(str(start, "step2PhraseRequired"))

        assertEquals(
            HostResponseStatus.OK,
            session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject { put("acknowledged", true) }).status,
        )
        assertEquals(
            HostResponseStatus.OK,
            session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject {
                put("confirmationPhrase", phrase)
            }).status,
        )
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.SANITIZE_EXECUTE).status)

        return session.send(HostCommand.GET_FINAL_REPORT)
    }

    /**
     * Asserts one artifact directory holds the expected files, that they are exactly the
     * content the wire carried, and that `manifest.json` describes their bytes.
     */
    private fun assertArtifactDirectory(
        directory: File,
        home: File,
        jsonFileName: String,
        markdownFileName: String,
        response: HostResponse,
        responseJsonKey: String,
        responseMarkdownKey: String,
    ) {
        assertTrue(directory.isDirectory, "artifact directory was not created: $directory")
        assertTrue(
            directory.canonicalFile.toPath().startsWith(home.canonicalFile.toPath()),
            "artifacts must stay inside cyvra.home: $directory is outside $home",
        )

        val jsonFile = File(assertNotNull(str(response, "${responseJsonKey}Path")))
        val markdownFile = File(assertNotNull(str(response, "${responseMarkdownKey}Path")))
        val manifestFile = File(assertNotNull(str(response, "manifestPath")))

        listOf(jsonFile, markdownFile, manifestFile).forEach { file ->
            assertTrue(file.isAbsolute, "path must be absolute: $file")
            assertTrue(file.isFile, "file was not written: $file")
            assertEquals(
                directory.canonicalFile,
                file.parentFile.canonicalFile,
                "file must be written into $directory",
            )
        }

        assertEquals(jsonFileName, jsonFile.name)
        assertEquals(markdownFileName, markdownFile.name)
        assertEquals(HostReportStore.MANIFEST_FILE_NAME, manifestFile.name)

        // The bytes on disk are exactly the bytes the response carried - no re-encoding.
        assertEquals(assertNotNull(str(response, responseJsonKey)), jsonFile.readText(Charsets.UTF_8))
        assertEquals(assertNotNull(str(response, responseMarkdownKey)), markdownFile.readText(Charsets.UTF_8))

        // manifest.json digests, verified against an independent hash of the file bytes.
        val manifest = json.parseToJsonElement(manifestFile.readText(Charsets.UTF_8)) as JsonObject
        assertEquals("SHA-256", (manifest["algorithm"] as? JsonPrimitive)?.contentOrNull)
        assertEquals(sha256Of(jsonFile.readBytes()), (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
            "manifest.json digest must match the bytes of ${jsonFile.name}")
        assertEquals(sha256Of(markdownFile.readBytes()), (manifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
            "manifest.json digest must match the bytes of ${markdownFile.name}")

        // ...and must agree with what the JSON-lines payload reported.
        val responseManifest = assertNotNull(obj(response, "manifest"))
        assertEquals(
            (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
            (responseManifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
        )
        assertEquals(
            (manifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
            (responseManifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
        )
    }

    @Test
    fun exportReport_writesReportArtifactsIntoTemporaryCyvraHome() {
        val session = Session()
        session.scan()

        val export = session.send(HostCommand.EXPORT_REPORT)
        assertEquals(HostResponseStatus.OK, export.status, export.error?.message ?: "")

        val home = assertNotNull(session.artifactHome, "session must own a temporary cyvra.home")
        val reportId = assertNotNull(str(export, "reportId"))

        assertArtifactDirectory(
            directory = File(home, HostReportStore.REPORTS_DIRECTORY).resolve(reportId),
            home = home,
            jsonFileName = HostReportStore.REPORT_JSON,
            markdownFileName = HostReportStore.REPORT_MARKDOWN,
            response = export,
            responseJsonKey = "reportJson",
            responseMarkdownKey = "reportMarkdown",
        )

        assertEquals(true, bool(export, "artifactsWritten"))
        assertTrue(home.isDirectory, "cyvra.home must exist")
    }

    @Test
    fun finalReport_writesCertificateArtifactsIntoTemporaryCyvraHome() {
        val session = Session()
        session.scan()

        val finalReport = driveSanitizationToExecution(session)
        assertEquals(HostResponseStatus.OK, finalReport.status, finalReport.error?.message ?: "")

        val home = assertNotNull(session.artifactHome, "session must own a temporary cyvra.home")
        val certificateId = assertNotNull(str(finalReport, "certificateId"))

        assertArtifactDirectory(
            directory = File(home, HostReportStore.CERTIFICATES_DIRECTORY).resolve(certificateId),
            home = home,
            jsonFileName = HostReportStore.CERTIFICATE_JSON,
            markdownFileName = HostReportStore.CERTIFICATE_MARKDOWN,
            response = finalReport,
            responseJsonKey = "certificateJson",
            responseMarkdownKey = "certificateMarkdown",
        )

        assertEquals(true, bool(finalReport, "artifactsWritten"))
        // Persistence must not change what the certificate says.
        assertEquals(false, bool(finalReport, "sanitizationSuccessClaimed"))
        assertFalse(
            File(assertNotNull(str(finalReport, "certificateJsonPath"))).readText(Charsets.UTF_8)
                .contains("SANITIZATION SUCCESS"),
            "writing to disk must never turn a blocked lifecycle into a success claim",
        )
    }

    @Test
    fun exportReport_withoutCyvraHomeFailsGracefullyAndHostKeepsServing() {
        val session = Session(artifactHome = null)
        session.scan()

        val export = session.send(HostCommand.EXPORT_REPORT)
        assertError(export, HostProtocolDispatcher.REPORT_WRITE_FAILED)
        val message = assertNotNull(export.error?.message)
        assertTrue(
            message.contains(AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY),
            "the refusal must name the missing property, got: $message",
        )

        // The Host survives and the report is still fully readable in memory.
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.GET_DEVICE_REPORT).status)
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.GET_APPLICATION_INVENTORY).status)

        // The certificate path refuses on the write, while the lifecycle itself already ran.
        val finalReport = driveSanitizationToExecution(session)
        assertError(finalReport, HostProtocolDispatcher.REPORT_WRITE_FAILED)

        // Verification and reports are unaffected - the process never died.
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.SANITIZE_VERIFY).status)
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.GET_DEVICE_REPORT).status)
    }

    @Test
    fun reportStore_refusesUnsafeArtifactIdentifiers() {
        val home = Files.createTempDirectory("cyvra-unsafe-home").toFile()
        val store = HostReportStore(reportEngine = reportEngine, homeProvider = { home.absolutePath })

        val error = assertFailsWith<ReportWriteException> {
            store.writeReport("../escaped", "{}", "# report")
        }
        assertTrue(
            error.message.orEmpty().contains("unsafe"),
            "refusal must explain the unsafe identifier, got: ${error.message}",
        )
        assertFalse(File(home, "escaped").exists(), "nothing may escape cyvra.home")

        // A missing home is a refusal too, never an exception out of the protocol loop.
        val missingHome = HostReportStore(
            reportEngine = reportEngine,
            homeProvider = { null },
        )
        val missing = assertFailsWith<ReportWriteException> {
            missingHome.writeReport("CYVRA-R1-2026-ABCDEF", "{}", "# report")
        }
        assertTrue(
            missing.message.orEmpty().contains(AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY),
            "refusal must name the missing property, got: ${missing.message}",
        )
    }

    // ------------------------------------------------------------------
    // 2. Licence gate
    // ------------------------------------------------------------------

    @Test
    fun runScan_withoutLicenceRefusesWithLicenseRequired() {
        val session = Session(license = deniedResult())

        val response = session.send(HostCommand.RUN_SCAN, buildJsonObject { put("serial", SERIAL) })

        assertError(response, HostProtocolDispatcher.LICENSE_REQUIRED)
        val message = assertNotNull(response.error?.message)
        assertTrue(
            message.contains("FILE_MISSING"),
            "the operator message must carry the LicenseFileReason, got: $message",
        )
        assertTrue(message.contains("license.json"), "message must name the missing file")

        // The refusal must leave no scan behind, so no report command can answer.
        assertError(session.send(HostCommand.GET_DEVICE_REPORT), "NO_SCAN_SESSION")
    }

    @Test
    fun runScan_withoutAdbRefusesWithoutTouchingAnyDevice() {
        val session = Session(withAdb = false)

        val response = session.send(HostCommand.RUN_SCAN, buildJsonObject { put("serial", SERIAL) })

        assertError(response, "ADB_UNAVAILABLE")
    }

    @Test
    fun runScan_requiresSerial() {
        val session = Session()

        assertError(session.send(HostCommand.RUN_SCAN), "SCAN_REQUEST_INVALID")
    }

    // ------------------------------------------------------------------
    // 3. Commands refuse before a scan exists
    // ------------------------------------------------------------------

    @Test
    fun reportAndSanitizationCommands_refuseBeforeAnyScan() {
        val session = Session()

        listOf(
            HostCommand.GET_DEVICE_REPORT,
            HostCommand.GET_APPLICATION_INVENTORY,
            HostCommand.EXPORT_REPORT,
            HostCommand.SANITIZE_START,
        ).forEach { command ->
            assertError(session.send(command), "NO_SCAN_SESSION")
        }

        // Nothing was consumed: entitlement accounting only moves on a successful scan.
        val scan = session.scan()
        assertEquals(24, int(scan, "scansRemaining"))
    }

    // ------------------------------------------------------------------
    // 4. Sanitization refusal paths (gate -> session -> lock -> ack -> phrase)
    // ------------------------------------------------------------------

    @Test
    fun sanitization_refusesEveryStepThatHasNotHappenedYet() {
        val session = Session()
        session.scan()

        // No gate opened yet: every later step is unreachable.
        assertError(session.send(HostCommand.SANITIZE_AUTHORIZE), "NO_SANITIZE_SESSION")
        assertError(session.send(HostCommand.SANITIZE_CONFIRM), "NO_SANITIZE_SESSION")
        assertError(session.send(HostCommand.SANITIZE_EXECUTE), "NO_SANITIZE_SESSION")
        assertError(session.send(HostCommand.SANITIZE_VERIFY), "NO_EXECUTION_SESSION")
        assertError(session.send(HostCommand.GET_FINAL_REPORT), "NO_EXECUTION_SESSION")

        // Gate opens.
        val start = session.send(HostCommand.SANITIZE_START)
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        assertEquals(true, bool(start, "eligible"))
        val phrase = assertNotNull(str(start, "step2PhraseRequired"))

        // Step 1 not recorded yet -> confirmation and execution both refuse.
        assertError(session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject {
            put("confirmationPhrase", phrase)
        }), "SANITIZE_ACK_REQUIRED")
        assertError(session.send(HostCommand.SANITIZE_EXECUTE), "SANITIZE_ACK_REQUIRED")

        // Record step 1, but send the wrong phrase.
        val authorize = session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject {
            put("acknowledged", true)
        })
        assertEquals(HostResponseStatus.OK, authorize.status, authorize.error?.message ?: "")

        assertError(session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject {
            put("confirmationPhrase", "CONFIRM PURGE SOMETHING-ELSE")
        }), "SANITIZE_PHRASE_MISMATCH")

        // Right acknowledgement, but the phrase was never accepted.
        assertError(session.send(HostCommand.SANITIZE_EXECUTE), "SANITIZE_PHRASE_REQUIRED")

        // Declining step 1 keeps execution refused even with the correct phrase.
        session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject { put("acknowledged", false) })
        assertError(
            session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject { put("confirmationPhrase", phrase) }),
            "SANITIZE_ACK_REQUIRED",
            "a declined acknowledgement must not be bypassed",
        )
        assertError(
            session.send(HostCommand.SANITIZE_EXECUTE),
            "SANITIZE_ACK_REQUIRED",
            "execution must stay refused after a declined acknowledgement",
        )

        session.printTranscript()
    }

    @Test
    fun sanitization_executeWithoutStartIsRefused() {
        val session = Session()
        session.scan()

        // Jumping straight at the destructive command never works.
        assertError(session.send(HostCommand.SANITIZE_EXECUTE), "NO_SANITIZE_SESSION")
    }

    // ------------------------------------------------------------------
    // 5. Full sanitization transcript (D-1 OUTCOME B)
    // ------------------------------------------------------------------

    @Test
    fun fullSanitizationTranscript_blocksExecutionAndNeverClaimsSuccess() {
        val session = Session()
        session.scan()

        val start = session.send(HostCommand.SANITIZE_START)
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        assertEquals(true, bool(start, "eligible"))
        val phrase = assertNotNull(str(start, "step2PhraseRequired"))
        assertTrue(phrase.startsWith("CONFIRM PURGE "), "phrase must be issued by the gate")

        val authorize = session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject {
            put("acknowledged", true)
        })
        assertEquals(HostResponseStatus.OK, authorize.status, authorize.error?.message ?: "")

        val confirm = session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject {
            put("confirmationPhrase", phrase)
        })
        assertEquals(HostResponseStatus.OK, confirm.status, confirm.error?.message ?: "")

        // DECISION D-1 / OUTCOME B: this is the expected, correct result.
        val execute = session.send(HostCommand.SANITIZE_EXECUTE)
        assertEquals(HostResponseStatus.OK, execute.status, execute.error?.message ?: "")
        assertEquals("BLOCKED_NOT_IMPLEMENTED", str(execute, "executionStatus"))
        assertEquals(false, bool(execute, "executionSuccess"))
        assertEquals("BLOCKED_NOT_EXECUTED", str(execute, "lifecycleOutcome"))
        assertEquals(false, bool(execute, "successClaimed"))
        assertEquals(true, bool(execute, "finalReportAvailable"))
        assertTrue(str(execute, "decision").orEmpty().contains("D-1"))

        val verify = session.send(HostCommand.SANITIZE_VERIFY)
        assertEquals(HostResponseStatus.OK, verify.status, verify.error?.message ?: "")
        assertEquals("REQUIRES_EXTERNAL_VERIFICATION", str(verify, "status"))
        assertEquals(false, bool(verify, "successClaimed"))

        val finalReport = session.send(HostCommand.GET_FINAL_REPORT)
        assertEquals(HostResponseStatus.OK, finalReport.status, finalReport.error?.message ?: "")
        assertEquals("BLOCKED_NOT_EXECUTED", str(finalReport, "lifecycleOutcome"))
        assertEquals(false, bool(finalReport, "sanitizationSuccessClaimed"))
        assertTrue(str(finalReport, "certificateId").orEmpty().startsWith("CYVRA-CERT"))
        assertNotNull(obj(finalReport, "certificate"))
        val manifest = assertNotNull(obj(finalReport, "manifest"))
        assertEquals(
            reportEngine.computeSha256(assertNotNull(str(finalReport, "certificateJson"))),
            (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
        )

        // The certificate itself must never contain a success claim.
        val certificateJson = assertNotNull(str(finalReport, "certificateJson"))
        assertFalse(certificateJson.contains("SANITIZATION SUCCESS"))
        assertTrue(certificateJson.contains("BLOCKED_NOT_IMPLEMENTED"))

        session.printTranscript()
    }

    // ------------------------------------------------------------------
    // 5b. P4: full sanitization lifecycle, end to end over JSON-lines
    // ------------------------------------------------------------------

    /**
     * P4 end-to-end proof of the sanitization state machine on the JSON-lines wire.
     *
     * Six commands in order, each succeeding only because the one before it ran, ending
     * with the certificate written to a temporary `<cyvra.home>` and its manifest verified
     * against the bytes on disk.
     *
     * The lifecycle is *expected* to end blocked (decision D-1, OUTCOME B): the destructive
     * trigger stays hardware-gated until validated on the physical device. Nothing here
     * fakes a successful sanitization - the point is that the protocol, the certificate
     * generator and the disk writer all report that blocked outcome honestly.
     */
    @Test
    fun sanitizationLifecycleE2E_blockedCertificateIsHonestAndPersistedOnDisk() {
        val session = Session()
        val scan = session.scan()
        val scanRequestId = scan.requestId

        // --- 1. SANITIZE_START: eligibility gate opens -------------------
        val start = session.send(HostCommand.SANITIZE_START)
        assertEquals(HostProtocolV1.VERSION, start.protocolVersion, "envelope protocol version")
        assertTrue(start.requestId.startsWith("req-"), "envelope must echo a request id")
        assertNotEquals(scanRequestId, start.requestId, "each command needs its own request id")
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        assertNull(start.error, "an eligible start must not carry an error")
        assertEquals(true, bool(start, "eligible"))
        assertEquals(SERIAL, str(start, "serial"))
        assertEquals("AUTHORIZATION_REQUIRED", str(start, "currentStep"))
        assertEquals(true, bool(start, "step1AcknowledgementRequired"))
        val operationId = assertNotNull(str(start, "operationId"))
        val phrase = assertNotNull(str(start, "step2PhraseRequired"))
        assertTrue(operationId.startsWith("PURGE-OP-"), "the gate must mint an operation id")
        assertEquals("CONFIRM PURGE $operationId", phrase, "the phrase must derive from the operation id")

        // --- 2. SANITIZE_AUTHORIZE: step 1 acknowledged ------------------
        val authorize = session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject {
            put("acknowledged", true)
        })
        assertEquals(HostResponseStatus.OK, authorize.status, authorize.error?.message ?: "")
        assertNull(authorize.error)
        assertEquals("STEP1_ACKNOWLEDGEMENT_RECORDED", str(authorize, "step"))
        assertEquals(true, bool(authorize, "acknowledged"))
        assertEquals(operationId, str(authorize, "operationId"))
        assertEquals(phrase, str(authorize, "step2PhraseRequired"), "the phrase must not change mid-gate")

        // --- 3. SANITIZE_CONFIRM: step 2 phrase accepted -----------------
        val confirm = session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject {
            put("confirmationPhrase", phrase)
        })
        assertEquals(HostResponseStatus.OK, confirm.status, confirm.error?.message ?: "")
        assertNull(confirm.error)
        assertEquals("STEP2_PHRASE_ACCEPTED", str(confirm, "step"))
        assertEquals(true, bool(confirm, "phraseAccepted"))
        assertEquals(operationId, str(confirm, "operationId"))

        // --- 4. SANITIZE_EXECUTE: D-1 OUTCOME B, blocked yet answered OK -
        val execute = session.send(HostCommand.SANITIZE_EXECUTE)
        assertEquals(HostResponseStatus.OK, execute.status, execute.error?.message ?: "")
        assertNull(execute.error)
        assertEquals("BLOCKED_NOT_IMPLEMENTED", str(execute, "executionStatus"))
        assertEquals(false, bool(execute, "executionSuccess"))
        assertEquals("BLOCKED_NOT_EXECUTED", str(execute, "lifecycleOutcome"))
        assertEquals("REQUIRES_EXTERNAL_VERIFICATION", str(execute, "verificationStatus"))
        assertEquals(false, bool(execute, "successClaimed"))
        assertEquals(true, bool(execute, "finalReportAvailable"))
        assertEquals(operationId, str(execute, "operationId"))
        assertTrue(list(execute, "blockReasons").isNotEmpty(), "a blocked run must say why it blocked")
        assertTrue(str(execute, "decision").orEmpty().contains("D-1"), "decision D-1 must be visible")

        // --- 5. SANITIZE_VERIFY: honest external verification ------------
        val verify = session.send(HostCommand.SANITIZE_VERIFY)
        assertEquals(HostResponseStatus.OK, verify.status, verify.error?.message ?: "")
        assertNull(verify.error)
        assertEquals("REQUIRES_EXTERNAL_VERIFICATION", str(verify, "status"))
        assertEquals("REQUIRES_EXTERNAL_VERIFICATION", str(verify, "assuranceLevel"))
        assertEquals(false, bool(verify, "postResetStateDetected"))
        assertEquals(false, bool(verify, "userDataInaccessible"))
        assertEquals(false, bool(verify, "setupWizardDetected"))
        assertEquals(false, bool(verify, "successClaimed"))
        assertTrue(list(verify, "limitations").isNotEmpty(), "assurance must carry its limitations")

        // --- 6. GET_FINAL_REPORT: certificate written to disk ------------
        val finalReport = session.send(HostCommand.GET_FINAL_REPORT)
        assertEquals(HostResponseStatus.OK, finalReport.status, finalReport.error?.message ?: "")
        assertNull(finalReport.error)
        val certificateId = assertNotNull(str(finalReport, "certificateId"))
        assertTrue(certificateId.startsWith("CYVRA-CERT"), "certificate id shape")
        assertEquals("BLOCKED_NOT_EXECUTED", str(finalReport, "lifecycleOutcome"))
        assertEquals(false, bool(finalReport, "sanitizationSuccessClaimed"))
        assertEquals(true, bool(finalReport, "artifactsWritten"))
        assertEquals(
            str(scan, "reportId"),
            str(finalReport, "verificationReportReference"),
            "the certificate must reference the Report 1 this session produced",
        )
        val responseCertificate = assertNotNull(obj(finalReport, "certificate"))

        // --- 7. The certificate is really on disk ------------------------
        val home = assertNotNull(session.artifactHome, "session must own a temporary cyvra.home")
        val directory = File(home, HostReportStore.CERTIFICATES_DIRECTORY).resolve(certificateId)
        assertTrue(directory.isDirectory, "certificate directory was not created: $directory")
        assertTrue(
            directory.canonicalFile.toPath().startsWith(home.canonicalFile.toPath()),
            "the certificate must stay inside cyvra.home",
        )

        val certificateFile = File(assertNotNull(str(finalReport, "certificateJsonPath")))
        val markdownFile = File(assertNotNull(str(finalReport, "certificateMarkdownPath")))
        val manifestFile = File(assertNotNull(str(finalReport, "manifestPath")))

        listOf(certificateFile, markdownFile, manifestFile).forEach { file ->
            assertTrue(file.isAbsolute, "path must be absolute: $file")
            assertTrue(file.isFile, "file was not written: $file")
            assertEquals(directory.canonicalFile, file.parentFile.canonicalFile, "file must live in $directory")
        }
        assertEquals(HostReportStore.CERTIFICATE_JSON, certificateFile.name)
        assertEquals(HostReportStore.CERTIFICATE_MARKDOWN, markdownFile.name)
        assertEquals(HostReportStore.MANIFEST_FILE_NAME, manifestFile.name)

        // Bytes on disk are exactly the bytes the wire carried - no re-encoding.
        val storedJson = certificateFile.readText(Charsets.UTF_8)
        val storedMarkdown = markdownFile.readText(Charsets.UTF_8)
        assertEquals(assertNotNull(str(finalReport, "certificateJson")), storedJson)
        assertEquals(assertNotNull(str(finalReport, "certificateMarkdown")), storedMarkdown)
        assertTrue(storedMarkdown.isNotBlank(), "the markdown certificate must not be empty")

        // manifest.json hashes, checked against an independent digest of the stored bytes.
        val manifest = json.parseToJsonElement(manifestFile.readText(Charsets.UTF_8)) as JsonObject
        assertEquals(certificateId, (manifest["artifactId"] as? JsonPrimitive)?.contentOrNull)
        assertEquals("SHA-256", (manifest["algorithm"] as? JsonPrimitive)?.contentOrNull)
        assertEquals(HostReportStore.CERTIFICATE_JSON, (manifest["jsonFile"] as? JsonPrimitive)?.contentOrNull)
        assertEquals(HostReportStore.CERTIFICATE_MARKDOWN, (manifest["markdownFile"] as? JsonPrimitive)?.contentOrNull)
        assertEquals(
            sha256Of(certificateFile.readBytes()),
            (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
            "manifest.json digest must match the bytes of ${certificateFile.name}",
        )
        assertEquals(
            sha256Of(markdownFile.readBytes()),
            (manifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
            "manifest.json digest must match the bytes of ${markdownFile.name}",
        )

        // ...and they must agree with the digests the JSON-lines payload reported.
        val responseManifest = assertNotNull(obj(finalReport, "manifest"))
        assertEquals(
            (manifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
            (responseManifest["jsonSha256"] as? JsonPrimitive)?.contentOrNull,
        )
        assertEquals(
            (manifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
            (responseManifest["markdownSha256"] as? JsonPrimitive)?.contentOrNull,
        )

        // The stored certificate parses back to exactly what the wire returned.
        val storedCertificate = json.parseToJsonElement(storedJson) as JsonObject
        assertEquals(responseCertificate, storedCertificate)

        // --- 8. The stored certificate reads as blocked, never as success -
        assertEquals(
            false,
            (storedCertificate["sanitizationSuccessClaimed"] as? JsonPrimitive)?.booleanOrNull,
            "the persisted certificate must not claim sanitization success",
        )
        assertEquals(
            "BLOCKED_NOT_EXECUTED",
            (storedCertificate["lifecycleOutcome"] as? JsonPrimitive)?.contentOrNull,
        )
        assertFalse(
            storedJson.contains("SANITIZATION SUCCESS"),
            "a blocked lifecycle must never be written as SANITIZATION SUCCESS",
        )
        assertFalse(
            storedMarkdown.contains("SANITIZATION SUCCESS"),
            "a blocked lifecycle must never be written as SANITIZATION SUCCESS (markdown)",
        )
        assertTrue(
            storedJson.contains("BLOCKED_NOT_IMPLEMENTED"),
            "the certificate must record the blocked execution status",
        )

        // --- 9. The literal wire traffic carried this lifecycle, in order -
        val wireCommands = session.transcript
            .filter { it.startsWith(">") }
            .map { line ->
                val request = json.parseToJsonElement(line.removePrefix("> ").trim()) as JsonObject
                (request["command"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            }
        assertEquals(
            listOf(
                "RUN_SCAN",
                "SANITIZE_START",
                "SANITIZE_AUTHORIZE",
                "SANITIZE_CONFIRM",
                "SANITIZE_EXECUTE",
                "SANITIZE_VERIFY",
                "GET_FINAL_REPORT",
            ),
            wireCommands,
            "the wire traffic must carry the lifecycle in order",
        )

        // Every exchange stayed a single JSON line, exactly as the protocol promises.
        session.transcript.filter { it.startsWith("<") }.forEach { line ->
            assertEquals(1, line.lines().size, "a response must be exactly one JSON line: $line")
        }

        session.printTranscript()
    }

    // ------------------------------------------------------------------
    // 6. A new scan invalidates the previous sanitization state
    // ------------------------------------------------------------------

    @Test
    fun newScanInvalidatesThePreviousSanitizationGate() {
        val session = Session()
        session.scan()

        val start = session.send(HostCommand.SANITIZE_START)
        assertEquals(HostResponseStatus.OK, start.status, start.error?.message ?: "")
        val phrase = assertNotNull(str(start, "step2PhraseRequired"))

        session.send(HostCommand.SANITIZE_AUTHORIZE, buildJsonObject { put("acknowledged", true) })
        session.send(HostCommand.SANITIZE_CONFIRM, buildJsonObject { put("confirmationPhrase", phrase) })

        // Fresh evidence -> the old gate, lock and phrase must all be gone.
        session.scan()

        assertError(
            session.send(HostCommand.SANITIZE_AUTHORIZE),
            "NO_SANITIZE_SESSION",
            "a new scan must invalidate the previous gate",
        )
        assertError(session.send(HostCommand.SANITIZE_EXECUTE), "NO_SANITIZE_SESSION")
        assertError(session.send(HostCommand.SANITIZE_VERIFY), "NO_EXECUTION_SESSION")
        assertError(session.send(HostCommand.GET_FINAL_REPORT), "NO_EXECUTION_SESSION")

        // Reports belong to the new scan and still work.
        assertEquals(HostResponseStatus.OK, session.send(HostCommand.GET_DEVICE_REPORT).status)
    }

    // ------------------------------------------------------------------
    // 7. New commands over the real JSON-lines process boundary
    // ------------------------------------------------------------------

    @Test
    fun newCommands_reachTheProcessAsPureJsonLines() {
        val originalIn = System.`in`
        val originalOut = System.out
        val capturedOut = java.io.ByteArrayOutputStream()

        // No licence, no cyvra.home, no ADB: every command fails closed. The point is
        // that each answer is a single valid JSON line on stdout, nothing else.
        val input = listOf(
            HostCommand.RUN_SCAN,
            HostCommand.GET_DEVICE_REPORT,
            HostCommand.GET_APPLICATION_INVENTORY,
            HostCommand.EXPORT_REPORT,
            HostCommand.SANITIZE_START,
            HostCommand.SANITIZE_AUTHORIZE,
            HostCommand.SANITIZE_CONFIRM,
            HostCommand.SANITIZE_EXECUTE,
            HostCommand.SANITIZE_VERIFY,
            HostCommand.GET_FINAL_REPORT,
        ).mapIndexed { index, command ->
            json.encodeToString(
                HostRequest.serializer(),
                HostRequest(
                    protocolVersion = HostProtocolV1.VERSION,
                    requestId = "req-proc-%02d".format(index + 1),
                    command = command,
                    payload = buildJsonObject { put("serial", SERIAL) },
                ),
            )
        }.joinToString("\n") + "\n"

        try {
            System.setIn(java.io.ByteArrayInputStream(input.toByteArray(Charsets.UTF_8)))
            System.setOut(java.io.PrintStream(capturedOut, true, Charsets.UTF_8))
            HostMain.main(emptyArray())
        } finally {
            System.setIn(originalIn)
            System.setOut(originalOut)
        }

        val lines = capturedOut.toString(Charsets.UTF_8).lineSequence().filter { it.isNotBlank() }.toList()
        assertEquals(10, lines.size, "each request must produce exactly one response line")

        val seen = mutableListOf<String>()
        lines.forEach { line ->
            assertTrue(line.trim().startsWith("{"), "stdout must be JSON only: $line")
            val response = json.decodeFromString(HostResponse.serializer(), line)
            assertEquals(HostResponseStatus.ERROR, response.status, "fail-closed expected for: $line")
            assertNotNull(response.error, "every refusal must carry a structured error")
            seen += response.error.code
        }

        // The workflow refuses in order rather than answering out of sequence.
        assertEquals(
            listOf(
                HostProtocolDispatcher.LICENSE_REQUIRED,
                "NO_SCAN_SESSION",
                "NO_SCAN_SESSION",
                "NO_SCAN_SESSION",
                "NO_SCAN_SESSION",
                "NO_SANITIZE_SESSION",
                "NO_SANITIZE_SESSION",
                "NO_SANITIZE_SESSION",
                "NO_EXECUTION_SESSION",
                "NO_EXECUTION_SESSION",
            ),
            seen,
        )
    }

    @Test
    fun responsesCarryTheProtocolEnvelope() {
        val session = Session()
        val response = session.send(HostCommand.GET_HOST_INFO)

        assertEquals(HostProtocolV1.VERSION, response.protocolVersion)
        assertEquals("req-001", response.requestId)
        assertEquals(HostResponseStatus.OK, response.status)
        assertNull(response.error)
    }
}
