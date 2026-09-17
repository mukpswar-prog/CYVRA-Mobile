package cyvra.mobile.host.protocol

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HostProtocolProcessTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun stdinRequests_areDispatchedToStdoutResponses() {
        val input = """
            {"protocolVersion":"1","requestId":"req-process-001","command":"GET_HOST_INFO","payload":{}}
            {"protocolVersion":"1","requestId":"req-process-002","command":"GET_PREFLIGHT","payload":{}}
        """.trimIndent() + "\n"

        val originalIn = System.`in`
        val originalOut = System.out

        val capturedOut = ByteArrayOutputStream()

        try {
            System.setIn(ByteArrayInputStream(input.toByteArray()))
            System.setOut(PrintStream(capturedOut, true, Charsets.UTF_8))

            HostMain.main(emptyArray())
        } finally {
            System.setIn(originalIn)
            System.setOut(originalOut)
        }

        val responses = capturedOut
            .toString(Charsets.UTF_8)
            .lineSequence()
            .filter { it.isNotBlank() }
            .toList()

        assertEquals(2, responses.size)

        val first = json.decodeFromString(
            HostResponse.serializer(),
            responses[0]
        )

        assertEquals("1", first.protocolVersion)
        assertEquals("req-process-001", first.requestId)
        assertEquals(HostResponseStatus.OK, first.status)

        val second = json.decodeFromString(
            HostResponse.serializer(),
            responses[1]
        )

        assertEquals("1", second.protocolVersion)
        assertEquals("req-process-002", second.requestId)
        assertEquals(HostResponseStatus.OK, second.status)
        assertEquals(null, second.error)
        assertTrue(second.payload.containsKey("readyToScan"))
        assertTrue(second.payload.containsKey("checks"))

        assertTrue(
            responses.all { it.trim().startsWith("{") },
            "stdout must contain JSON protocol responses only"
        )
    }
}