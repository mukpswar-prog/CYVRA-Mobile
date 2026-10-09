package cyvra.mobile.host.telemetry

import cyvra.mobile.host.engine.PatchSetState
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant

/** Consent scopes. Enumerated — there is no "and related purposes" catch-all. */
@Serializable
enum class ConsentScope {
    @SerialName("ENGINE_STATE")
    ENGINE_STATE,

    @SerialName("CAPABILITY_EVENTS")
    CAPABILITY_EVENTS,

    @SerialName("HOST_LOGS")
    HOST_LOGS,

    /**
     * Recorded for completeness. `TelemetryClient` exposes **no** API to attach device
     * evidence, so granting this scope cannot cause evidence to leave the host: probe
     * fixtures and raw dumps are local build inputs and are never uplinked
     * (`CYVRA_FLEET_TELEMETRY_SPEC.md` §4.7).
     */
    @SerialName("DEVICE_EVIDENCE")
    DEVICE_EVIDENCE,
    ;
}

/** The proof that consent existed (governed §5.4; telemetry spec §6). */
@Serializable
data class ConsentRecord(
    val consentId: String,
    val scopes: Set<ConsentScope> = emptySet(),
    val grantedAt: String,
    val tcsVersion: String,
    val attestationHash: String,
    val withdrawnAt: String? = null,
    val onConnectEnabled: Boolean = true,
    val periodicMinutes: Int = DEFAULT_PERIODIC_MINUTES,
) {
    val isActive: Boolean get() = withdrawnAt == null

    fun has(scope: ConsentScope): Boolean = isActive && scope in scopes

    companion object {
        const val DEFAULT_PERIODIC_MINUTES = 1440
    }
}

/** Outcome enum mirroring the evidence vocabulary (telemetry spec §4.5). */
@Serializable
enum class EventOutcome {
    SUCCESS,
    FAILURE,
    NOT_APPLICABLE,
    NOT_OBSERVABLE,
    RESTRICTED,
    NOT_COLLECTED,
    ;

    companion object {
        /** An observation that could not be made is never recorded as SUCCESS. */
        fun fromEvidence(statusName: String): EventOutcome = when (statusName) {
            "EVIDENCE_BACKED" -> SUCCESS
            "RESTRICTED" -> RESTRICTED
            "NOT_AVAILABLE", "PHYSICAL_VERIFICATION_REQUIRED" -> NOT_OBSERVABLE
            "NOT_APPLICABLE" -> NOT_APPLICABLE
            "NOT_TESTED" -> NOT_COLLECTED
            else -> FAILURE
        }
    }
}

/** A capability challenge event — engine behaviour, never device evidence content. */
@Serializable
data class CapabilityChallengeEvent(
    val eventId: String,
    val plane: String,
    val outcome: EventOutcome,
    /** An engine reason code. Never free text. */
    val reasonCode: String,
    val androidVersion: Int,
    val durationMs: Long = 0,
    val isEmulator: Boolean = false,
    val patchContext: String? = null,
)

/** The Windows host's own log tail, redacted before serialisation. */
@Serializable
data class HostLogEntry(
    val ts: String,
    val level: String,
    val code: String,
    val message: String,
)

/** Envelope. Section keys are an explicit allowlist; an unknown key is dropped. */
@Serializable
data class TelemetryEnvelope(
    val schemaVersion: String = "1.0",
    val messageId: String,
    val sentAt: String,
    val channel: String,
    val consent: ConsentRecord,
    val engine: Map<String, String>,
    val patchSet: Map<String, String>,
    val capabilityEvents: List<CapabilityChallengeEvent> = emptyList(),
    val hostLogs: List<HostLogEntry> = emptyList(),
    /** A **declared absence**: keeps an absent field distinguishable from an uncollected one. */
    val droppedSections: List<String> = emptyList(),
)

/** What the client did with a check-in. */
enum class SendOutcome {
    SENT,
    QUEUED,
    NO_CONSENT,
    WITHDRAWN,
    INVALID_ENDPOINT,
}

/**
 * The uplink channel.
 *
 * Deliberately a bare string channel: the caller supplies already-serialised JSON, so no
 * request object can carry more than the envelope allowlist produced.
 */
fun interface TelemetryTransport {
    /** Returns true when the receiver accepted the message. */
    fun send(json: String): Boolean
}

/**
 * The core-engine destination.
 *
 * Defence in depth for governed §7 / Spec §81: telemetry goes to the core engine and
 * **never** to the Customer Workspace. The real boundary is architectural — this client
 * holds no Workspace credential and no Workspace URL — but a Workspace-shaped destination
 * is rejected here too, so a wiring mistake fails loudly instead of silently exporting
 * engine telemetry to a customer surface.
 *
 * Not a security control on its own: it is a guard against misconfiguration.
 */
class TelemetryEndpoint private constructor(val url: String) {
    companion object {
        private val WORKSPACE_PATH_PREFIXES = listOf(
            "/workspace", "/admin", "/dashboard", "/site", "/licence", "/license", "/api/v1/me",
        )

        fun coreEngine(url: String): TelemetryEndpoint {
            require(url.startsWith("https://")) {
                "telemetry must use TLS: $url"
            }
            val path = url.substringAfter("://", "").substringAfter('/').let { "/$it" }
            val offending = WORKSPACE_PATH_PREFIXES.firstOrNull { path.startsWith(it) }
            require(offending == null) {
                "refusing Workspace destination '$url' — telemetry is core-engine only (governed §7)"
            }
            return TelemetryEndpoint(url)
        }
    }
}

/**
 * Bounded FIFO holding envelopes that could not be sent.
 *
 * Capacity per telemetry spec §8: 64 MiB or 5000 envelopes, whichever first. On overflow
 * the **oldest** entry is dropped and `queue_overflow` is recorded on the next envelope —
 * the queue never blocks inspection work.
 *
 * In-memory in this phase; encrypted-at-rest JSONL persistence is an open item (spec §8
 * mandates OS-keystore encryption) and is deliberately **not** claimed here.
 */
class OfflineQueue(
    private val maxEntries: Int = 5000,
    private val maxBytes: Int = 64 * 1024 * 1024,
) {
    private val entries = ArrayDeque<String>()

    private var totalBytes = 0
    var overflowCount = 0
        private set

    val size: Int get() = entries.size

    fun offer(json: String) {
        val bytes = json.toByteArray(Charsets.UTF_8).size
        entries.addLast(json)
        totalBytes += bytes
        // On overflow the OLDEST entry is dropped, never the newest — the queue must not
        // block inspection work, and it never blocks on a full buffer.
        while (entries.isNotEmpty() && (entries.size > maxEntries || totalBytes > maxBytes)) {
            totalBytes -= entries.removeFirst().toByteArray(Charsets.UTF_8).size
            overflowCount++
        }
    }

    fun drain(): List<String> {
        val drained = entries.toList()
        entries.clear()
        totalBytes = 0
        return drained
    }

    fun purge() {
        entries.clear()
        totalBytes = 0
    }

    fun hasOverflow(): Boolean = overflowCount > 0
}

/**
 * Field uplink client (governed §5.4).
 *
 * Adheres to:
 * - Governed `CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2` §5.4 (on-connect + periodic, consent,
 *   offline queue), §5.5 (telemetry never promotes itself to a patch), §5.6 (telemetry
 *   never changes actuation), §7 (boundary: core engine, never Workspace)
 * - `CYVRA_FLEET_TELEMETRY_SPEC.md` §2 (principles), §4 (payload), §5 (redaction),
 *   §6 (consent), §7 (cadence), §8 (offline queue)
 *
 * **The silence rule.** Absent consent means *absent traffic*, not *empty traffic*: with
 * no active consent the client sends nothing at all — no heartbeat, no metadata-only
 * ping, no empty envelope.
 *
 * **Fail private.** A section that cannot be assembled is dropped and named in
 * `droppedSections`, never passed through raw. Failure modes produce *less* data, never
 * more.
 *
 * **Direction is one-way.** Telemetry informs the core engine; the only input that
 * changes how the customer engine acts is a verified signed patch (§5.6). Nothing
 * received here reaches actuation logic.
 */
class TelemetryClient(
    private val endpoint: TelemetryEndpoint,
    private val transport: TelemetryTransport,
    private val engineVersion: String,
    private val hostId: String,
    private val queue: OfflineQueue = OfflineQueue(),
    private val clock: () -> Instant = { Instant.now() },
) {
    private var consent: ConsentRecord? = null
    private var patchSet: PatchSetState = PatchSetState()
    private var messageCounter = 0L

    private val pendingEvents = mutableListOf<CapabilityChallengeEvent>()
    private val pendingLogs = mutableListOf<HostLogEntry>()

    val isConsented: Boolean get() = consent?.isActive == true

    fun recordConsent(record: ConsentRecord) {
        consent = record
    }

    fun currentConsent(): ConsentRecord? = consent

    fun setPatchSet(state: PatchSetState) {
        patchSet = state
    }

    fun addCapabilityEvent(event: CapabilityChallengeEvent) {
        if (!isConsented) return
        if (consent?.has(ConsentScope.CAPABILITY_EVENTS) != true) return
        pendingEvents += event
    }

    fun addHostLog(entry: HostLogEntry) {
        if (!isConsented) return
        if (consent?.has(ConsentScope.HOST_LOGS) != true) return
        pendingLogs += redactLog(entry)
    }

    /**
     * On-connect check-in (governed §5.4). Fires on engine start when consent is active
     * and the customer enabled it.
     */
    fun onConnect(): SendOutcome {
        val active = consent ?: return SendOutcome.NO_CONSENT
        if (!active.isActive) return SendOutcome.WITHDRAWN
        if (!active.onConnectEnabled) return SendOutcome.NO_CONSENT
        return transmit("ON_CONNECT", active)
    }

    /** Periodic check-in on the configured cadence (default 24 h). */
    fun checkIn(): SendOutcome {
        val active = consent ?: return SendOutcome.NO_CONSENT
        if (!active.isActive) return SendOutcome.WITHDRAWN
        if (active.periodicMinutes <= 0) return SendOutcome.NO_CONSENT
        return transmit("PERIODIC", active)
    }

    /**
     * Consent withdrawal, honoured within one cadence cycle (telemetry spec §6):
     * stop uplink, purge the queue, send the withdrawal notice and nothing else.
     *
     * Withdrawal stops **sharing**, not working — it must not affect the engine's ability
     * to inspect, purge or produce a report.
     */
    fun withdraw(withdrawnAt: Instant = clock()): SendOutcome {
        val current = consent ?: return SendOutcome.NO_CONSENT
        consent = current.copy(withdrawnAt = withdrawnAt.toString())
        queue.purge()
        pendingEvents.clear()
        pendingLogs.clear()

        val notice = TelemetryEnvelope(
            messageId = nextMessageId(),
            sentAt = withdrawnAt.toString(),
            channel = "WITHDRAWAL",
            consent = consent!!,
            engine = emptyMap(),
            patchSet = emptyMap(),
        )
        return if (sendNow(notice)) SendOutcome.SENT else SendOutcome.QUEUED
    }

    /**
     * Removes and returns every queued envelope without sending.
     *
     * Used by retry and by diagnostics; the caller owns what it does with them.
     */
    fun drainQueue(): List<String> = queue.drain()

    private fun transmit(channel: String, active: ConsentRecord): SendOutcome {
        val dropped = mutableListOf<String>()
        val envelope = buildEnvelope(channel, active, dropped)
        return if (sendNow(envelope)) {
            // Only clear what was actually carried.
            if (dropped.none { it == "capability_events" }) pendingEvents.clear()
            if (dropped.none { it == "host_logs" }) pendingLogs.clear()
            SendOutcome.SENT
        } else {
            queue.offer(encode(envelope))
            SendOutcome.QUEUED
        }
    }

    /** Builds the envelope from an explicit section allowlist. */
    private fun buildEnvelope(
        channel: String,
        active: ConsentRecord,
        dropped: MutableList<String>,
    ): TelemetryEnvelope {
        val engine = buildMap {
            put("engine_version", engineVersion)
            put("host_id", hostId)
            put("os_version", System.getProperty("os.name") ?: "unknown")
        }

        val patchSection = try {
            patchSet.reportFields(engineVersion)
        } catch (e: Exception) {
            dropped += "patch_set"
            emptyMap()
        }

        val events = if (active.has(ConsentScope.CAPABILITY_EVENTS)) {
            try {
                pendingEvents.take(MAX_EVENTS)
            } catch (e: Exception) {
                dropped += "capability_events"
                emptyList()
            }
        } else {
            dropped += "capability_events"
            emptyList()
        }

        val logs = if (active.has(ConsentScope.HOST_LOGS)) {
            try {
                pendingLogs.takeLast(MAX_LOG_ENTRIES)
            } catch (e: Exception) {
                dropped += "host_logs"
                emptyList()
            }
        } else {
            dropped += "host_logs"
            emptyList()
        }

        // Declared absence, so a withheld section is never mistaken for an empty one.
        if (queue.hasOverflow()) dropped += "queue_overflow"

        return TelemetryEnvelope(
            messageId = nextMessageId(),
            sentAt = clock().toString(),
            channel = channel,
            consent = active,
            engine = engine,
            patchSet = patchSection,
            capabilityEvents = events,
            hostLogs = logs,
            droppedSections = dropped,
        )
    }

    private fun sendNow(envelope: TelemetryEnvelope): Boolean = try {
        transport.send(encode(envelope))
    } catch (e: Exception) {
        false
    }

    private fun encode(envelope: TelemetryEnvelope): String = try {
        JSON.encodeToString(envelope)
    } catch (e: Exception) {
        // Fail private: an unencodable envelope is dropped, never passed through raw.
        JSON.encodeToString(
            TelemetryEnvelope(
                messageId = envelope.messageId,
                sentAt = envelope.sentAt,
                channel = envelope.channel,
                consent = envelope.consent,
                engine = emptyMap(),
                patchSet = emptyMap(),
                droppedSections = envelope.droppedSections + "serialisation_failed",
            ),
        )
    }

    private fun redactLog(entry: HostLogEntry): HostLogEntry = entry.copy(
        message = entry.message
            .take(MAX_LOG_MESSAGE_CHARS)
            .replace(IdentifierPatterns.IMEI, "[NOT COLLECTED]")
            .replace(IdentifierPatterns.MAC, "[NOT COLLECTED]")
            .replace(IdentifierPatterns.SERIAL, "[NOT COLLECTED]"),
    )

    private fun nextMessageId(): String = "MSG-$hostId-${++messageCounter}"

    companion object {
        const val MAX_EVENTS = 200
        const val MAX_LOG_ENTRIES = 256
        const val MAX_LOG_MESSAGE_CHARS = 4096

        private val JSON = Json { encodeDefaults = true }

        /** Shape-based identifier scrub (telemetry spec §5.2), replaced by a status token. */
        private object IdentifierPatterns {
            val IMEI = Regex("""\b\d{15}\b""")
            val MAC = Regex("""\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b""")
            val SERIAL = Regex("""\b[A-Z0-9]{10,}\b""")
        }
    }
}
