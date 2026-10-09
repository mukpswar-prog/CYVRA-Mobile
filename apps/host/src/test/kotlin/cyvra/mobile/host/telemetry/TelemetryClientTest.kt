package cyvra.mobile.host.telemetry

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TelemetryClientTest {

    private class RecordingTransport(var fail: Boolean = false) : TelemetryTransport {
        val sent = mutableListOf<String>()

        override fun send(json: String): Boolean {
            if (fail) return false
            sent += json
            return true
        }
    }

    private val transport = RecordingTransport()
    private val endpoint = TelemetryEndpoint.coreEngine("https://telemetry.cyvra.example/v1/ingest")

    private val fullConsent = ConsentRecord(
        consentId = "C-1",
        scopes = setOf(
            ConsentScope.ENGINE_STATE,
            ConsentScope.CAPABILITY_EVENTS,
            ConsentScope.HOST_LOGS,
        ),
        grantedAt = "2026-10-09T00:00:00Z",
        tcsVersion = "2026.1",
        attestationHash = "a".repeat(64),
    )

    private fun client(): TelemetryClient = TelemetryClient(
        endpoint = endpoint,
        transport = transport,
        engineVersion = "1.0.0",
        hostId = "HOST-TEST",
    )

    // ------------------------------------------------------------ silence rule

    @Test
    fun withoutConsentNothingIsEverSent() {
        val telemetry = client()
        telemetry.addCapabilityEvent(
            CapabilityChallengeEvent("E1", "P3", EventOutcome.SUCCESS, "OK", 31),
        )

        assertEquals(SendOutcome.NO_CONSENT, telemetry.onConnect())
        assertEquals(SendOutcome.NO_CONSENT, telemetry.checkIn())
        assertTrue(transport.sent.isEmpty(), "absent consent means absent traffic, not empty traffic")
        assertTrue(!telemetry.isConsented)
    }

    @Test
    fun withdrawnConsentStopsUplinkAfterTheNotice() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent)
        assertEquals(SendOutcome.SENT, telemetry.onConnect())
        assertEquals(1, transport.sent.size)

        telemetry.withdraw()
        assertTrue(!telemetry.isConsented)
        assertEquals(2, transport.sent.size, "withdrawal sends exactly one notice")

        assertEquals(SendOutcome.WITHDRAWN, telemetry.checkIn())
        assertEquals(2, transport.sent.size, "no further traffic after withdrawal")
    }

    @Test
    fun withdrawalPurgesTheOfflineQueue() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent)
        transport.fail = true
        assertEquals(SendOutcome.QUEUED, telemetry.checkIn())

        telemetry.withdraw()
        transport.fail = false
        assertEquals(SendOutcome.WITHDRAWN, telemetry.checkIn())
        assertTrue(transport.sent.size <= 1, "a purged queue must not be replayed")
    }

    // ---------------------------------------------------------------- payload

    @Test
    fun onConnectCarriesEngineAndPatchSetVersions() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent)
        telemetry.setPatchSet(
            cyvra.mobile.host.engine.PatchSetState(
                version = "2026.10.09-1",
                hash = "abc",
                mode = cyvra.mobile.host.engine.PatchSetMode.SIGNED_CURRENT,
            ),
        )
        assertEquals(SendOutcome.SENT, telemetry.onConnect())

        val payload = transport.sent.single()
        assertTrue(payload.contains("\"engine_version\":\"1.0.0\""), payload)
        assertTrue(payload.contains("\"patch_set_version\":\"2026.10.09-1\""), payload)
        assertTrue(payload.contains("\"patch_set_mode\":\"SIGNED-CURRENT\""), payload)
        assertTrue(payload.contains("\"channel\":\"ON_CONNECT\""), payload)
    }

    @Test
    fun engineStateAloneCarriesNoEventOrLogSections() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent.copy(scopes = setOf(ConsentScope.ENGINE_STATE)))
        telemetry.addCapabilityEvent(
            CapabilityChallengeEvent("E1", "P3", EventOutcome.SUCCESS, "OK", 31),
        )
        telemetry.addHostLog(HostLogEntry("2026-10-09T00:00:00Z", "INFO", "E-1", "started"))

        assertEquals(SendOutcome.SENT, telemetry.checkIn())
        val payload = transport.sent.single()
        assertTrue(payload.contains("\"capabilityEvents\":[]"), payload)
        assertTrue(payload.contains("\"hostLogs\":[]"), payload)
        assertTrue(payload.contains("capability_events"), "a withheld section must be declared absent")
        assertTrue(payload.contains("host_logs"), "a withheld section must be declared absent")
    }

    @Test
    fun hostLogIdentifiersAreReplacedByStatusTokensNotBlanks() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent)
        telemetry.addHostLog(
            HostLogEntry(
                ts = "2026-10-09T00:00:00Z",
                level = "INFO",
                code = "E-1",
                message = "device 351234567890123 on 00:11:22:33:44:55",
            ),
        )
        assertEquals(SendOutcome.SENT, telemetry.checkIn())

        val payload = transport.sent.single()
        assertTrue(!payload.contains("351234567890123"), "an IMEI-shaped literal must not leave the host")
        assertTrue(!payload.contains("00:11:22:33:44:55"), "a MAC-shaped literal must not leave the host")
        assertTrue(payload.contains("[NOT COLLECTED]"), "replaced by a status token, never blanked")
    }

    @Test
    fun endpointGuardRejectsInsecureAndWorkspaceShapedDestinations() {
        assertRequires { TelemetryEndpoint.coreEngine("http://telemetry.cyvra.example/ingest") }
        assertRequires { TelemetryEndpoint.coreEngine("https://app.cyvra.example/workspace/report") }
        assertRequires { TelemetryEndpoint.coreEngine("https://app.cyvra.example/admin/telemetry") }
        assertRequires { TelemetryEndpoint.coreEngine("https://app.cyvra.example/licence/status") }
    }

    // ------------------------------------------------------------- queue

    @Test
    fun failedSendIsQueuedRatherThanLost() {
        val telemetry = client()
        telemetry.recordConsent(fullConsent)
        transport.fail = true
        assertEquals(SendOutcome.QUEUED, telemetry.checkIn())

        transport.fail = false
        val drained = telemetry.drainQueue()
        assertEquals(1, drained.size)
        assertTrue(drained.single().contains("PERIODIC"), drained.single())
    }

    @Test
    fun overflowDropsOldestEntryAndRecordsIt() {
        val queue = OfflineQueue(maxEntries = 3)
        repeat(5) { queue.offer("""{"n":$it}""") }
        assertEquals(3, queue.size, "bounded FIFO must not grow without limit")
        assertEquals(2, queue.overflowCount)
        assertTrue(queue.hasOverflow())
    }

    private inline fun assertRequires(block: () -> Unit) {
        val thrown = runCatching(block).exceptionOrNull()
        assertTrue(thrown is IllegalArgumentException, "expected IAE, got $thrown")
    }
}
