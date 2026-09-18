package cyvra.mobile.host.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HostProtocolV1SerializationTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun hostRequest_roundTripsThroughJson() {
        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-001",
            command = HostCommand.GET_DEVICE_STATE,
            payload = buildJsonObject {
                put("includeDetails", true)
            },
        )

        val encoded = json.encodeToString(HostRequest.serializer(), request)
        val decoded = json.decodeFromString(HostRequest.serializer(), encoded)

        assertEquals("1", decoded.protocolVersion)
        assertEquals("req-001", decoded.requestId)
        assertEquals(HostCommand.GET_DEVICE_STATE, decoded.command)
        assertEquals(
            true,
            decoded.payload["includeDetails"]?.toString()?.toBoolean()
        )
    }

    @Test
    fun successfulHostResponse_preservesProtocolEnvelope() {
        val response = HostResponse(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-002",
            status = HostResponseStatus.OK,
            hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
            payload = buildJsonObject {
                put("ready", true)
            },
        )

        val encoded = json.encodeToString(HostResponse.serializer(), response)
        val decoded = json.decodeFromString(HostResponse.serializer(), encoded)

        assertEquals("1", decoded.protocolVersion)
        assertEquals("req-002", decoded.requestId)
        assertEquals(HostResponseStatus.OK, decoded.status)
        assertEquals("0.0.0", decoded.hostVersion)
        assertEquals(
            true,
            decoded.payload["ready"]?.toString()?.toBoolean()
        )
        assertNull(decoded.error)
    }

    @Test
    fun errorHostResponse_preservesStructuredError() {
        val response = HostResponse(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-003",
            status = HostResponseStatus.ERROR,
            hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
            error = HostError(
                code = "UNKNOWN_COMMAND",
                message = "Command is not supported",
            ),
        )

        val encoded = json.encodeToString(HostResponse.serializer(), response)
        val decoded = json.decodeFromString(HostResponse.serializer(), encoded)

        assertEquals("1", decoded.protocolVersion)
        assertEquals("req-003", decoded.requestId)
        assertEquals(HostResponseStatus.ERROR, decoded.status)

        val error = assertNotNull(decoded.error)

        assertEquals("UNKNOWN_COMMAND", error.code)
        assertEquals("Command is not supported", error.message)
    }
}