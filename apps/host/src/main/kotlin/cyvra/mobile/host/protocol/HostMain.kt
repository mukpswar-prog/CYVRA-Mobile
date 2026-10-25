package cyvra.mobile.host.protocol

import cyvra.mobile.host.engine.FileBasedPatchStateProvider
import cyvra.mobile.host.service.HostBootstrap
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

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
        runSession(reader, output, dispatcher)
    }

    /**
     * Runs a concurrent JSON-lines host session.
     *
     * Requests targeting different device serials execute in parallel on a worker pool
     * and emit responses as soon as each completes (matched by `requestId`). Requests
     * targeting the same device serial are chained in arrival order unless a scan is
     * already in flight on that serial, in which case a duplicate `RUN_SCAN` is
     * dispatched immediately so it can fail closed with `SCAN_IN_PROGRESS`.
     */
    fun runSession(
        reader: BufferedReader,
        output: BufferedWriter,
        targetDispatcher: HostProtocolDispatcher = dispatcher,
    ) {
        val outputLock = Any()
        val executor = Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "cyvra-host-worker").apply { isDaemon = true }
        }
        val serialChains = ConcurrentHashMap<String, CompletableFuture<Void>>()
        val allFutures = CopyOnWriteArrayList<CompletableFuture<Void>>()

        fun writeResponse(response: HostResponse) {
            val encoded = json.encodeToString(HostResponse.serializer(), response)
            synchronized(outputLock) {
                output.write(encoded)
                output.newLine()
                output.flush()
            }
        }

        try {
            reader.forEachLine { line ->
                if (line.isBlank()) {
                    return@forEachLine
                }

                val parsedRequest = try {
                    json.decodeFromString(HostRequest.serializer(), line)
                } catch (_: Exception) {
                    null
                }

                if (parsedRequest == null) {
                    val errorResp = processLine(line, targetDispatcher)
                    writeResponse(errorResp)
                    return@forEachLine
                }

                val serialKey = (parsedRequest.payload["serial"] as? JsonPrimitive)
                    ?.contentOrNull
                    ?.trim()
                    ?.takeIf { it.isNotEmpty() }
                val queueKey = serialKey ?: "__GLOBAL__"

                val bypassSerialQueue =
                    serialKey != null &&
                        parsedRequest.command == HostCommand.RUN_SCAN &&
                        targetDispatcher.isScanInFlight(serialKey)

                val taskFuture: CompletableFuture<Void> = if (bypassSerialQueue) {
                    CompletableFuture.runAsync(
                        Runnable {
                            val response = targetDispatcher.dispatch(parsedRequest)
                            writeResponse(response)
                        },
                        executor,
                    )
                } else {
                    serialChains.compute(queueKey) { _, previous ->
                        val base = previous ?: CompletableFuture.completedFuture(null)
                        base.handleAsync(
                            { _, _ ->
                                val response = targetDispatcher.dispatch(parsedRequest)
                                writeResponse(response)
                                null as Void?
                            },
                            executor,
                        )
                    }!!
                }
                allFutures.add(taskFuture)
            }

            if (allFutures.isNotEmpty()) {
                CompletableFuture.allOf(*allFutures.toTypedArray()).join()
            }
        } finally {
            executor.shutdown()
        }
    }

    private fun processLine(
        line: String,
        targetDispatcher: HostProtocolDispatcher = dispatcher,
    ): HostResponse {
        return try {
            val request = json.decodeFromString(
                HostRequest.serializer(),
                line
            )

            targetDispatcher.dispatch(request)
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