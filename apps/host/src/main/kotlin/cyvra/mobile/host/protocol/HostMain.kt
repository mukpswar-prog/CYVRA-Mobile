package cyvra.mobile.host.protocol

import cyvra.mobile.host.engine.FileBasedPatchStateProvider
import cyvra.mobile.host.service.HostBootstrap
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

    /**
     * The production patch-state provider.
     *
     * Wired rather than left null so a real scan exercises the actual contract §3/§6
     * gates and refuses with a precise, diagnosable reason instead of the generic
     * `NO_PATCH_STATE_PROVIDER`. Today [FileBasedPatchStateProvider] cannot establish an
     * authoritative state at all — [cyvra.mobile.host.engine.PatchTrustAnchors.ALL] is
     * empty (custody is open item §9.1) and no applied-state record format is governed —
     * so every production `FINALISE_REPORT` after a real scan still refuses. That refusal
     * is the correct behaviour, not a defect to route around.
     */
    private val patchStateProvider = FileBasedPatchStateProvider(
        engineVersion = HostProtocolV1.DEFAULT_HOST_VERSION,
    )::establish

    private val dispatcher = HostProtocolDispatcher(
        patchStateProvider = patchStateProvider,
    )

    @JvmStatic
    fun main(args: Array<String>) {
        /*
         * Read the production licence exactly once, at boot. The loader is
         * fail-closed and cannot throw, so an absent or corrupt license.json
         * degrades the Host to a denied entitlement rather than preventing it
         * from starting and answering the protocol.
         */
        System.err.println(HostBootstrap.describeLicenseState())

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