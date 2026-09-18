package cyvra.mobile.host.protocol

import cyvra.mobile.host.transport.AdbBinaryLocator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostProtocolDispatcherTransportTest {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun `GET_PREFLIGHT returns structured preflight result`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-preflight-001",
            command = HostCommand.GET_PREFLIGHT,
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostProtocolV1.VERSION, response.protocolVersion)
        assertEquals("req-preflight-001", response.requestId)
        assertEquals(HostResponseStatus.OK, response.status)
        assertEquals(HostProtocolV1.DEFAULT_HOST_VERSION, response.hostVersion)
        assertNotNull(response.payload["readyToScan"])
        assertNotNull(response.payload["checks"])

        val encoded = json.encodeToString(HostResponse.serializer(), response)
        val decoded = json.decodeFromString(HostResponse.serializer(), encoded)

        assertEquals(response, decoded)
    }

    @Test
    fun `GET_DEVICE_STATE returns structured connection state`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-device-state-001",
            command = HostCommand.GET_DEVICE_STATE,
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostProtocolV1.VERSION, response.protocolVersion)
        assertEquals("req-device-state-001", response.requestId)
        assertEquals(HostResponseStatus.OK, response.status)
        assertEquals(HostProtocolV1.DEFAULT_HOST_VERSION, response.hostVersion)

        assertNotNull(response.payload["connectionState"])
        assertNotNull(response.payload["usbState"])
        assertNotNull(response.payload["adbState"])
        assertNotNull(response.payload["adbAvailable"])
        assertNotNull(response.payload["readyToScan"])
    }
}