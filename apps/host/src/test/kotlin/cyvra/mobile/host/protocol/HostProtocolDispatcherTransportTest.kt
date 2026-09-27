package cyvra.mobile.host.protocol

import cyvra.mobile.host.transport.AdbBinaryLocator
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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
            payload = buildJsonObject {
                put("usbConnected", false)
                put("usbObservationState", "USB_NOT_PRESENT")
            },
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
        assertNotNull(response.payload["usbObservationState"])
    }

    @Test
    fun `GET_DEVICE_STATE reports native USB truth independent of ADB discovery`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-device-state-002",
            command = HostCommand.GET_DEVICE_STATE,
            payload = buildJsonObject {
                put("usbConnected", true)
                put("usbObservationState", "USB_PRESENT")
            },
        )

        val response = dispatcher.dispatch(request)

        // FSB-003 regression: native USB truth must never be
        // overridden by ADB device discovery.
        assertEquals(HostResponseStatus.OK, response.status)
        assertEquals(
            "USB_CONNECTED",
            response.payload["usbState"]?.jsonPrimitive?.content,
        )
        assertNotEquals(
            "NO_DEVICE",
            response.payload["connectionState"]?.jsonPrimitive?.content,
        )
        assertEquals(
            "USB_PRESENT",
            response.payload["usbObservationState"]?.jsonPrimitive?.content,
        )
    }

    @Test
    fun `GET_DEVICE_STATE fails closed when native USB state is absent`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-device-state-003",
            command = HostCommand.GET_DEVICE_STATE,
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("USB_STATE_MISSING", response.error?.code)
        assertNull(response.payload["connectionState"])
    }

    @Test
    fun `GET_DEVICE_STATE never presents an unknown USB observation as absence`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-device-state-004",
            command = HostCommand.GET_DEVICE_STATE,
            payload = buildJsonObject {
                put("usbConnected", false)
                put("usbObservationState", "USB_OBSERVATION_UNKNOWN")
            },
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("USB_OBSERVATION_UNKNOWN", response.error?.code)
        assertNull(response.payload["connectionState"])
    }

    @Test
    fun `GET_DEVICE_STATE rejects an unrecognized observation state`() {
        val dispatcher = HostProtocolDispatcher()

        val request = HostRequest(
            protocolVersion = HostProtocolV1.VERSION,
            requestId = "req-device-state-005",
            command = HostCommand.GET_DEVICE_STATE,
            payload = buildJsonObject {
                put("usbConnected", false)
                put("usbObservationState", "NOT_A_REAL_STATE")
            },
        )

        val response = dispatcher.dispatch(request)

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("USB_STATE_INVALID", response.error?.code)
    }
}