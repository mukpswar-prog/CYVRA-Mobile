package cyvra.mobile.host.protocol

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostProtocolDispatcherTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

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
}