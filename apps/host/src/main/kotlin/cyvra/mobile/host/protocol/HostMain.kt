package cyvra.mobile.host.protocol

import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

object HostMain {

    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    private val dispatcher = HostProtocolDispatcher()

    @JvmStatic
    fun main(args: Array<String>) {
        val reader = BufferedReader(
            InputStreamReader(System.`in`, StandardCharsets.UTF_8)
        )

        val output = System.out.bufferedWriter(StandardCharsets.UTF_8)

        reader.forEachLine { line ->
            if (line.isBlank()) {
                return@forEachLine
            }

            val response = processLine(line)

            output.write(
                json.encodeToString(
                    HostResponse.serializer(),
                    response
                )
            )
            output.newLine()
            output.flush()
        }
    }

    private fun processLine(line: String): HostResponse {
        return try {
            val request = json.decodeFromString(
                HostRequest.serializer(),
                line
            )

            dispatcher.dispatch(request)
        } catch (error: SerializationException) {
            HostResponse(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "unknown",
                status = HostResponseStatus.ERROR,
                hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
                error = HostError(
                    code = "INVALID_REQUEST",
                    message = "Request is not valid Host Protocol V1 JSON",
                ),
            )
        } catch (error: IllegalArgumentException) {
            HostResponse(
                protocolVersion = HostProtocolV1.VERSION,
                requestId = "unknown",
                status = HostResponseStatus.ERROR,
                hostVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
                error = HostError(
                    code = "INVALID_REQUEST",
                    message = "Request could not be processed",
                ),
            )
        }
    }
}