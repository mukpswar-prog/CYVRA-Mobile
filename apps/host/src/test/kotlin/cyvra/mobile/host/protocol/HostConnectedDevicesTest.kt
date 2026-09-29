package cyvra.mobile.host.protocol

import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import java.nio.file.Files
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Wire-level coverage for the read-only `GET_CONNECTED_DEVICES` command.
 *
 * FAKE ADB ONLY: every process invocation is served by [FakeAdbRunner], and the binary the
 * dispatcher resolves is a zero-byte stub inside a temp directory, so no code path in this
 * test can reach a real `adb` process or a connected device.
 *
 * The fixture deliberately spans every state the operator table distinguishes - authorized,
 * unauthorized, disconnected and detected - because the honesty rules only hold if each one
 * is reported as itself.
 */
class HostConnectedDevicesTest {

    companion object {
        private const val AUTHORIZED_SERIAL = "RF8R123456"
        private const val UNAUTHORIZED_SERIAL = "RF8M111111"
        private const val OFFLINE_SERIAL = "RF8M222222"
        private const val AUTHORISING_SERIAL = "RF8M333333"
        private const val EMULATOR_SERIAL = "emulator-5554"
        private const val NETWORK_SERIAL = "192.168.1.42:5555"

        private const val DEVICE_LIST_FIXTURE =
            "List of devices attached\n" +
                "RF8R123456 device product:a10s model:SM_A107F transport_id:1\n" +
                "RF8M111111 unauthorized transport_id:2\n" +
                "RF8M222222 offline transport_id:3\n" +
                "RF8M333333 authorizing transport_id:4\n"

        private const val MIXED_TRANSPORT_FIXTURE =
            "List of devices attached\n" +
                "RF8R123456 device model:SM_A107F transport_id:1\n" +
                "emulator-5554 device model:sdk_gphone64 transport_id:2\n" +
                "192.168.1.42:5555 device model:SM_A107F transport_id:3\n"
    }

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    /**
     * Serves `adb devices -l` and the one property this command reads. Every command it is
     * asked to run is recorded, so a test can prove the command stayed read-only.
     */
    private class FakeAdbRunner(
        private val deviceList: String = DEVICE_LIST_FIXTURE,
    ) : ProcessRunner {

        val commands = mutableListOf<List<String>>()

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            commands += command
            val joined = command.joinToString(" ")

            if (joined.contains("devices -l")) {
                return DefaultProcessExecutionResult(0, deviceList, "")
            }

            val shell = joined.substringAfter(" shell ", missingDelimiterValue = "")

            return when {
                shell.startsWith("getprop ro.product.manufacturer") ->
                    DefaultProcessExecutionResult(0, "samsung\n", "")

                else -> DefaultProcessExecutionResult(1, "", "unsupported command")
            }
        }
    }

    /** Resolves a real `File` inside a temp dir without ever executing it. */
    private fun stubLocator(): AdbBinaryLocator {
        val root = Files.createTempDirectory("cyvra-connected-devices").toFile()
        val tools = File(root, "platform-tools")
        tools.mkdirs()
        File(tools, if (isWindows()) "adb.exe" else "adb").writeText("stub")
        return AdbBinaryLocator(installationRootProvider = { root.absolutePath })
    }

    private fun isWindows(): Boolean =
        System.getProperty("os.name")?.lowercase()?.contains("win") == true

    private fun dispatcher(
        runner: ProcessRunner = FakeAdbRunner(),
        withAdb: Boolean = true,
    ): HostProtocolDispatcher =
        HostProtocolDispatcher(
            adbLocator = if (withAdb) {
                stubLocator()
            } else {
                AdbBinaryLocator(installationRootProvider = { null }, environmentProvider = { null })
            },
            adbClientFactory = { binary -> AdbClient(binary, runner) },
        )

    private fun request() = HostRequest(
        protocolVersion = HostProtocolV1.VERSION,
        requestId = "req-connected-devices-001",
        command = HostCommand.GET_CONNECTED_DEVICES,
    )

    private fun devicesPayload(response: HostResponse): List<JsonObject> {
        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")

        val payload = response.payload
        assertTrue(payload.jsonObject.containsKey("devices"), "payload must carry devices")

        return payload.jsonObject["devices"]!!.jsonArray.map { it.jsonObject }
    }

    private fun adbAvailable(response: HostResponse): Boolean? =
        (response.payload.jsonObject["adbAvailable"] as? JsonPrimitive)?.booleanOrNull

    private fun field(entry: JsonObject, key: String): String? =
        entry[key]?.let { (it as? JsonPrimitive)?.contentOrNull }

    private fun bySerial(devices: List<JsonObject>): Map<String?, JsonObject> =
        devices.associateBy { field(it, "serial") }

    // ------------------------------------------------------------------
    // Contents
    // ------------------------------------------------------------------

    @Test
    fun `GET_CONNECTED_DEVICES lists every phone ADB reports`() {
        val response = dispatcher().dispatch(request())
        val devices = devicesPayload(response)

        assertEquals(4, devices.size)
        assertEquals(true, adbAvailable(response), "the ADB component must report that it answered")

        val rows = bySerial(devices)

        val authorized = assertNotNull(rows[AUTHORIZED_SERIAL])
        assertEquals("authorized", field(authorized, "state"))
        assertEquals("USB", field(authorized, "transport"))
        assertEquals("SM_A107F", field(authorized, "model"))
        assertEquals("samsung", field(authorized, "make"))

        val unauthorized = assertNotNull(rows[UNAUTHORIZED_SERIAL])
        assertEquals("unauthorized", field(unauthorized, "state"))
        assertEquals("USB", field(unauthorized, "transport"))

        val disconnected = assertNotNull(rows[OFFLINE_SERIAL])
        assertEquals("disconnected", field(disconnected, "state"))

        val detected = assertNotNull(rows[AUTHORISING_SERIAL])
        assertEquals("detected", field(detected, "state"))
    }

    @Test
    fun `an unauthorized phone never reports a manufacturer this workstation could not read`() {
        val rows = bySerial(devicesPayload(dispatcher().dispatch(request())))

        val unauthorized = assertNotNull(rows[UNAUTHORIZED_SERIAL])
        assertFalse(unauthorized.containsKey("make"), "make must be absent, never guessed")
        assertFalse(unauthorized.containsKey("model"), "ADB reported no model for this entry")

        assertEquals("samsung", field(assertNotNull(rows[AUTHORIZED_SERIAL]), "make"))
    }

    @Test
    fun `no entry ever carries an IMEI`() {
        val devices = devicesPayload(dispatcher().dispatch(request()))

        assertEquals(4, devices.size)
        devices.forEach { entry ->
            val serial = field(entry, "serial")

            assertFalse(entry.containsKey("imei"), "an IMEI was invented for $serial")

            val reason = assertNotNull(
                entry["imeiReason"],
                "$serial must state why there is no IMEI",
            ).jsonPrimitive.contentOrNull

            assertTrue(!reason.isNullOrBlank(), "$serial must not carry an empty imeiReason")
        }
    }

    @Test
    fun `portOrLocation is absent because the Windows truth does not provide one`() {
        devicesPayload(dispatcher().dispatch(request())).forEach { entry ->
            assertFalse(
                entry.containsKey("portOrLocation"),
                "the Windows USB truth exposes only a PnP instance id, which must never " +
                    "reach the wire as a port or location (${field(entry, "serial")})",
            )
        }
    }

    // ------------------------------------------------------------------
    // Transport derivation
    // ------------------------------------------------------------------

    @Test
    fun `transport is derived from ADB's serial grammar, never assumed to be USB`() {
        val rows = bySerial(
            devicesPayload(dispatcher(runner = FakeAdbRunner(MIXED_TRANSPORT_FIXTURE)).dispatch(request())),
        )

        assertEquals("USB", field(assertNotNull(rows[AUTHORIZED_SERIAL]), "transport"))
        assertEquals("EMULATOR", field(assertNotNull(rows[EMULATOR_SERIAL]), "transport"))
        assertEquals("NETWORK", field(assertNotNull(rows[NETWORK_SERIAL]), "transport"))
    }

    // ------------------------------------------------------------------
    // Read-only guarantee
    // ------------------------------------------------------------------

    @Test
    fun `the command only ever reads`() {
        val runner = FakeAdbRunner()
        dispatcher(runner = runner).dispatch(request())

        assertTrue(runner.commands.isNotEmpty(), "the fake ADB should have been invoked")

        runner.commands.forEach { command ->
            val joined = command.joinToString(" ")
            assertTrue(
                joined.contains("devices -l") ||
                    joined.contains("getprop ro.product.manufacturer"),
                "GET_CONNECTED_DEVICES ran an unexpected command: $joined",
            )
        }
    }

    // ------------------------------------------------------------------
    // Honesty of the absence of ADB itself
    // ------------------------------------------------------------------

    @Test
    fun `a workstation without an ADB component says so instead of reporting no phones`() {
        val response = dispatcher(withAdb = false).dispatch(request())

        assertEquals(HostResponseStatus.OK, response.status, response.error?.message ?: "")
        assertEquals(false, adbAvailable(response))
        assertEquals(0, response.payload.jsonObject["devices"]!!.jsonArray.size)
    }

    // ------------------------------------------------------------------
    // Wire format
    // ------------------------------------------------------------------

    @Test
    fun `the response round-trips as the single JSON line HostMain writes`() {
        val response = dispatcher().dispatch(request())

        val encoded = json.encodeToString(HostResponse.serializer(), response)
        val decoded = json.decodeFromString(HostResponse.serializer(), encoded)

        assertEquals(response, decoded)
        assertFalse(encoded.contains('\n'), "a response must be exactly one JSON line")

        val line = json.parseToJsonElement(encoded).jsonObject
        assertEquals(HostProtocolV1.VERSION, field(line, "protocolVersion"))
        assertEquals("req-connected-devices-001", field(line, "requestId"))
        assertEquals("OK", field(line, "status"))
        assertTrue(
            line["error"] == null || line["error"] is JsonNull,
            "a successful listing carries no error",
        )
    }
}
