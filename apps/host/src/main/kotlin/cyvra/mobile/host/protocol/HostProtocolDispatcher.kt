package cyvra.mobile.host.protocol

import cyvra.mobile.host.transport.AdbBinaryLocator
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.ConnectionStateMachine
import cyvra.mobile.host.transport.HostPreflightVerifier
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
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
            val adbBinary = adbLocator.locate()
                ?: return errorResponse(
                    request = request,
                    code = "ADB_NOT_FOUND",
                    message = "ADB binary could not be located by the Host ADB locator",
                )

            val adbClient = AdbClient(adbBinary)
            val discoveredDevices = adbClient.listDevices()

            /*
             * The current Host transport layer does not independently expose
             * physical USB detection. Therefore do not fabricate USB state.
             *
             * A discovered ADB device proves an ADB-visible connection.
             * With no discovered device, we conservatively evaluate the
             * connection as having no confirmed USB/ADB device.
             */
            val usbConnected = discoveredDevices.isNotEmpty()

            val snapshot = connectionStateMachine.evaluate(
                usbConnected = usbConnected,
                adbClientAvailable = true,
                discoveredDevices = discoveredDevices,
            )

            val payload = buildJsonObject {
                put("connectionState", snapshot.connectionState.name)
                put("usbState", snapshot.usbState.name)
                put("adbState", snapshot.adbState.name)
                put("adbAvailable", snapshot.adbAvailable)
                put("readyToScan", snapshot.readyToScan)
                put("statusMessage", snapshot.statusMessage)

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