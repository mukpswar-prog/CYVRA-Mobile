package cyvra.mobile.host.protocol

import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.ConnectionStateMachine
import cyvra.mobile.host.transport.HostPreflightVerifier
import kotlinx.serialization.json.Json
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
) {

    private val json = Json {
        encodeDefaults = true
    }

    fun dispatch(request: HostRequest): HostResponse {
        return when (request.command) {
            HostCommand.GET_HOST_INFO -> hostInfoResponse(request)
            HostCommand.GET_PREFLIGHT -> preflightResponse(request)
            HostCommand.GET_DEVICE_STATE -> deviceStateResponse(request)
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
}