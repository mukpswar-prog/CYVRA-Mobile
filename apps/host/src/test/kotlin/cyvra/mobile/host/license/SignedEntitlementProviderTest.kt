package cyvra.mobile.host.license

import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.protocol.HostCommand
import cyvra.mobile.host.protocol.HostProtocolDispatcher
import cyvra.mobile.host.protocol.HostProtocolV1
import cyvra.mobile.host.protocol.HostRequest
import cyvra.mobile.host.protocol.HostResponseStatus
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Fail-closed guarantees for the production entitlement loader.
 *
 * Every case asserts the *record* is still usable, because `HostLicenseService`
 * requires one, and every failure asserts a specific reason, because the reason
 * is what `GET_LICENSE_STATE` puts on the wire for support to read.
 *
 * Signing uses a keypair generated inside the test process. The bundled server
 * public key has no private half anywhere, so it cannot be used to make a
 * fixture - which is exactly why the provider's key is injectable here.
 */
class SignedEntitlementProviderTest {

    private val serverKey: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val impostorKey: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()

    private val serverTime: Instant = Instant.parse("2026-09-30T10:00:00Z")
    private val validUntil: Instant = Instant.parse("2027-09-30T10:00:00Z")

    private fun tempHome(): File = Files.createTempDirectory("cyvra-entitlement").toFile()

    private fun payloadText(
        validUntil: Instant = this.validUntil,
        graceLimitSeconds: Long = 86_400L,
        diagnostics: Boolean = true,
        sanitizeExecute: Boolean = true,
        upgrade: Boolean = true,
        status: String = LicenseEntitlementStatus.ACTIVE.name,
    ): String = """
        {
          "licenseId": "LIC-MOB-2026-00124",
          "serialNumber": "CYVRA15092026SA3F1-1-25",
          "customerEmail": "customer@example.com",
          "planName": "25 Device Scans",
          "deviceScanEntitlement": 25,
          "scansUsed": 8,
          "scansRemaining": 17,
          "revision": 2,
          "status": "$status",
          "validUntil": "${validUntil}",
          "serverTime": "$serverTime",
          "graceLimitSeconds": $graceLimitSeconds,
          "offline": {
            "diagnostics": $diagnostics,
            "sanitizeExecute": $sanitizeExecute,
            "upgrade": $upgrade
          }
        }
    """.trimIndent()

    private fun sign(signer: KeyPair, text: String): String {
        val signature = Signature.getInstance(SignedEntitlementProvider.SIGNATURE_ALGORITHM)
        signature.initSign(signer.private)
        signature.update(text.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(signature.sign())
    }

    private fun envelope(
        payloadText: String,
        signer: KeyPair = serverKey,
        debits: JsonArray? = null,
    ): String = buildJsonObject {
        put("schema", SignedEntitlementProvider.SCHEMA)
        put("issuedAt", serverTime.toString())
        put("payload", payloadText)
        put("signature", sign(signer, payloadText))
        if (debits != null) put("debits", debits)
    }.toString()

    private val genesis = "0".repeat(64)

    /**
     * A well-formed settlement journal for [subjects], chained exactly the way
     * the Rust writer chains it: dense `seq` from 1, `prev` of the first entry
     * on genesis, each `prev` the `hash` of its predecessor.
     */
    private fun chain(vararg subjects: String): JsonArray = run {
        var prev = genesis
        JsonArray(subjects.mapIndexed { index, subject ->
            val hash = "hash-${index + 1}"
            val entry = buildJsonObject {
                put("seq", index + 1)
                put("at", "2026-09-30T11:00:${index.toString().padStart(2, '0')}Z")
                put("subject", subject)
                put("prev", prev)
                put("hash", hash)
            }
            prev = hash
            entry
        })
    }

    private fun entry(
        seq: Int,
        subject: String,
        prev: String,
        hash: String,
    ): JsonObject = buildJsonObject {
        put("seq", seq)
        put("at", "2026-09-30T11:00:00Z")
        put("subject", subject)
        put("prev", prev)
        put("hash", hash)
    }

    private fun writeEntitlement(home: File, body: String): File {
        home.mkdirs()
        val file = File(home, SignedEntitlementProvider.ENTITLEMENT_FILE_NAME)
        file.writeText(body)
        return file
    }

    private fun providerAt(
        home: File?,
        now: Instant = serverTime,
        publicKey: java.security.PublicKey = serverKey.public,
    ): SignedEntitlementProvider = SignedEntitlementProvider(
        homeProvider = { home?.absolutePath },
        publicKeyProvider = { publicKey },
        nowProvider = { now },
    )

    private fun request(command: HostCommand, requestId: String) = HostRequest(
        protocolVersion = HostProtocolV1.VERSION,
        requestId = requestId,
        command = command,
    )

    // ------------------------------------------------------------------
    // Valid signature
    // ------------------------------------------------------------------

    @Test
    fun `a correctly signed snapshot loads and reports the entitlement it was signed with`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText()))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
        assertTrue(result.cached, "a snapshot is always cached data, never a live answer")
        assertEquals("LIC-MOB-2026-00124", result.record.licenseId)
        assertEquals(17, result.record.scansRemaining)
        assertEquals(LicenseEntitlementStatus.ACTIVE, result.record.status)
        assertEquals(86_400L, result.graceLimitSeconds)
        assertTrue(result.offline.sanitizeExecute)
        assertEquals(OfflinePermissions(
            diagnostics = true,
            sanitizeExecute = true,
            upgrade = true,
        ), result.offline)
    }

    @Test
    fun `the offline permissions come from the snapshot and nowhere else`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(sanitizeExecute = false, upgrade = false)))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.offline.diagnostics, "diagnostics stay available under the snapshot")
        assertFalse(result.offline.sanitizeExecute, "destructive purge is the server's decision")
        assertFalse(result.offline.upgrade, "upgrade is the server's decision")
    }

    // ------------------------------------------------------------------
    // Missing file
    // ------------------------------------------------------------------

    @Test
    fun `a workstation with no entitlement file is not licensed and says so`() {
        val home = tempHome()

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.FILE_MISSING, result.reason)
        assertFalse(result.isLicensed)
        assertFalse(result.cached)
        assertEquals(OfflinePermissions.NONE, result.offline)
        assertEquals(0, result.record.scansRemaining)
        assertEquals(LicenseEntitlementStatus.UNKNOWN, result.record.status)
    }

    @Test
    fun `an unset cyvra home fails closed before any file is considered`() {
        val result = providerAt(home = null).load()

        assertEquals(LicenseFileReason.HOME_PROPERTY_MISSING, result.reason)
        assertFalse(result.isLicensed)
    }

    // ------------------------------------------------------------------
    // Tampered / corrupt
    // ------------------------------------------------------------------

    @Test
    fun `an edited payload fails signature verification`() {
        val home = tempHome()
        val signed = payloadText()
        val edited = payloadText(graceLimitSeconds = 31_536_000L)
            .replace("\"scansRemaining\": 17", "\"scansRemaining\": 25")

        // The envelope still carries the signature over the *original* text; only
        // the payload was changed, which is the tampering this must catch.
        writeEntitlement(
            home,
            buildJsonObject {
                put("schema", SignedEntitlementProvider.SCHEMA)
                put("issuedAt", serverTime.toString())
                put("payload", edited)
                put("signature", sign(serverKey, signed))
            }.toString(),
        )

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.SIGNATURE_INVALID, result.reason)
        assertFalse(result.isLicensed, "a tampered snapshot must never entitle anybody")
        assertEquals(0, result.record.scansRemaining)
    }

    @Test
    fun `a snapshot signed by another key is refused`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(), signer = impostorKey))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.SIGNATURE_INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `a structurally broken envelope is refused before any signature work`() {
        val home = tempHome()
        writeEntitlement(home, "{ not json at all")

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `a snapshot carrying the wrong schema is refused`() {
        val home = tempHome()
        val text = payloadText()
        writeEntitlement(
            home,
            buildJsonObject {
                put("schema", "cyvra.entitlement.v0")
                put("payload", text)
                put("signature", sign(serverKey, text))
            }.toString(),
        )

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `an entitlement whose invariant range is impossible is refused`() {
        val home = tempHome()
        val text = payloadText().replace(
            "\"scansRemaining\": 17",
            "\"scansRemaining\": 99",
        )
        writeEntitlement(home, envelope(text))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    // ------------------------------------------------------------------
    // Expiry and grace
    // ------------------------------------------------------------------

    @Test
    fun `a snapshot inside its licence term loads`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText()))

        val result = providerAt(home, now = serverTime.plusSeconds(3_600L)).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
    }

    @Test
    fun `a snapshot inside the server-granted grace still loads and stays restricted`() {
        val home = tempHome()
        writeEntitlement(
            home,
            envelope(payloadText(
                validUntil = Instant.parse("2026-09-30T11:00:00Z"),
                graceLimitSeconds = 86_400L,
                sanitizeExecute = false,
                upgrade = false,
            )),
        )

        // Two hours after the licence term ended: inside the 24h grace.
        val result = providerAt(home, now = Instant.parse("2026-09-30T13:00:00Z")).load()

        assertEquals(LicenseFileReason.LOADED, result.reason, result.reason.name)
        assertTrue(result.isLicensed, "the server granted a grace window; it must be honoured")
        assertTrue(result.offline.diagnostics)
        assertFalse(result.offline.sanitizeExecute, "grace never unlocks destructive purge")
        assertFalse(result.offline.upgrade)
    }

    @Test
    fun `a snapshot past its grace limit fails closed as expired`() {
        val home = tempHome()
        writeEntitlement(
            home,
            envelope(payloadText(
                validUntil = Instant.parse("2026-09-30T11:00:00Z"),
                graceLimitSeconds = 3_600L,
            )),
        )

        // One second past validUntil + grace.
        val result = providerAt(home, now = Instant.parse("2026-09-30T12:00:01Z")).load()

        assertEquals(LicenseFileReason.EXPIRED, result.reason)
        assertFalse(result.isLicensed, "an expired snapshot must not entitle anybody")
        assertEquals(OfflinePermissions.NONE, result.offline)
        assertEquals(0, result.record.scansRemaining)
    }

    @Test
    fun `a licence the server signed as already expired is refused`() {
        val home = tempHome()
        writeEntitlement(
            home,
            envelope(payloadText(
                validUntil = Instant.parse("2026-09-01T00:00:00Z"),
                graceLimitSeconds = 86_400L,
            )),
        )

        val result = providerAt(home, now = serverTime).load()

        assertEquals(LicenseFileReason.EXPIRED, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `a negative grace limit is refused rather than silently widened`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(graceLimitSeconds = -1L)))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    // ------------------------------------------------------------------
    // Host-side enforcement of the snapshot flags
    // ------------------------------------------------------------------

    @Test
    fun `destructive sanitization is refused while the snapshot locks it`() {
        val restricted = resultWith(sanitizeExecute = false)
        val dispatcher = HostProtocolDispatcher(licenseResultProvider = { restricted })

        val response = dispatcher.dispatch(request(HostCommand.SANITIZE_EXECUTE, "req-offline-001"))

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("SANITIZE_LOCKED_OFFLINE", response.error?.code)
        assertTrue(
            response.error!!.message.contains("cached entitlement"),
            "the refusal must be plain language, not an internal detail",
        )
    }

    @Test
    fun `diagnostics are refused when the snapshot does not permit them`() {
        val noDiagnostics = resultWith(diagnostics = false)
        val dispatcher = HostProtocolDispatcher(licenseResultProvider = { noDiagnostics })

        val response = dispatcher.dispatch(request(HostCommand.RUN_SCAN, "req-offline-002"))

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("DIAGNOSTICS_LOCKED_OFFLINE", response.error?.code)
    }

    @Test
    fun `an unrestricted snapshot changes nothing in the existing command path`() {
        val unrestricted = resultWith(
            diagnostics = true,
            sanitizeExecute = true,
            upgrade = true,
        )
        val dispatcher = HostProtocolDispatcher(licenseResultProvider = { unrestricted })

        // No session has been started, so the pre-existing refusal - not the new
        // offline one - must be what comes back.
        val response = dispatcher.dispatch(request(HostCommand.SANITIZE_EXECUTE, "req-offline-003"))

        assertEquals(HostResponseStatus.ERROR, response.status)
        assertEquals("NO_SANITIZE_SESSION", response.error?.code)
    }

    // ------------------------------------------------------------------
    // §14 settlement journal (the envelope-level `debits` array)
    // ------------------------------------------------------------------

    private fun rawEnvelope(payloadText: String, debits: JsonElement): String = buildJsonObject {
        put("schema", SignedEntitlementProvider.SCHEMA)
        put("issuedAt", serverTime.toString())
        put("payload", payloadText)
        put("signature", sign(serverKey, payloadText))
        put("debits", debits)
    }.toString()

    @Test
    fun `settles recorded beside the signed payload reduce the balance without touching the grant`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(), debits = chain("CERT-A", "CERT-B")))

        val result = providerAt(home).load()

        // The signature covers `payload` only and `payload` is byte-identical to
        // what was signed, so verification is unaffected by the journal's
        // presence - which is the entire reason the journal lives outside it.
        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertTrue(result.isLicensed)
        assertEquals(15, result.record.scansRemaining)
        assertEquals(10, result.record.scansUsed)
        assertEquals(
            25,
            result.record.scansUsed + result.record.scansRemaining,
            "the entitlement is still the one the server signed for",
        )
    }

    @Test
    fun `an absent or empty journal leaves the signed grant exactly as issued`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(), debits = JsonArray(emptyList())))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.LOADED, result.reason)
        assertEquals(8, result.record.scansUsed)
        assertEquals(17, result.record.scansRemaining)
    }

    @Test
    fun `more settlements than the grant allows clamp the balance instead of going negative`() {
        val home = tempHome()
        val many = (1..20).map { "CERT-$it" }.toTypedArray()
        writeEntitlement(home, envelope(payloadText(), debits = chain(*many)))

        val result = providerAt(home).load()

        assertEquals(0, result.record.scansRemaining, "the floor is zero, never below")
        assertEquals(25, result.record.scansUsed, "used is derived, so it cannot exceed the grant")
    }

    @Test
    fun `a journal that is not an array is refused rather than silently skipped`() {
        val home = tempHome()
        writeEntitlement(home, rawEnvelope(payloadText(), JsonPrimitive("garbage")))

        val result = providerAt(home).load()

        // Skipping it would hand back every scan it described, so an unreadable
        // journal fails the whole check rather than being treated as "no spend".
        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `an entry missing a field is refused rather than partially applied`() {
        val home = tempHome()
        val truncated = JsonArray(
            listOf(
                buildJsonObject {
                    put("seq", 1)
                    put("at", "2026-09-30T11:00:00Z")
                    put("subject", "CERT-A")
                    put("prev", genesis)
                    // `hash` deliberately absent
                },
            ),
        )
        writeEntitlement(home, rawEnvelope(payloadText(), truncated))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `the same certificate twice in a journal is refused as a double charge`() {
        val home = tempHome()
        writeEntitlement(home, envelope(payloadText(), debits = chain("CERT-A", "CERT-A")))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `a gap in the sequence is refused`() {
        val home = tempHome()
        val gapped = JsonArray(
            listOf(
                entry(seq = 1, subject = "CERT-A", prev = genesis, hash = "hash-1"),
                entry(seq = 3, subject = "CERT-C", prev = "hash-1", hash = "hash-3"),
            ),
        )
        writeEntitlement(home, rawEnvelope(payloadText(), gapped))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    @Test
    fun `a broken chain is refused`() {
        val home = tempHome()
        val broken = JsonArray(
            listOf(
                entry(seq = 1, subject = "CERT-A", prev = genesis, hash = "hash-1"),
                // Names genesis instead of its predecessor: an entry spliced in.
                entry(seq = 2, subject = "CERT-B", prev = genesis, hash = "hash-2"),
            ),
        )
        writeEntitlement(home, rawEnvelope(payloadText(), broken))

        val result = providerAt(home).load()

        assertEquals(LicenseFileReason.INVALID, result.reason)
        assertFalse(result.isLicensed)
    }

    private fun resultWith(
        diagnostics: Boolean = true,
        sanitizeExecute: Boolean = true,
        upgrade: Boolean = true,
    ): LicenseFileResult = LicenseFileResult(
        record = cyvra.mobile.core.CustomerLicenseRecord(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA15092026SA3F1-1-25",
            customerEmail = "customer@example.com",
            planName = "25 Device Scans",
            deviceScanEntitlement = 25,
            scansUsed = 8,
            scansRemaining = 17,
            status = LicenseEntitlementStatus.ACTIVE,
        ),
        reason = LicenseFileReason.LOADED,
        sourcePath = "/installation/resources/entitlement.json",
        offline = OfflinePermissions(
            diagnostics = diagnostics,
            sanitizeExecute = sanitizeExecute,
            upgrade = upgrade,
        ),
        graceLimitSeconds = 86_400L,
        cached = true,
    )
}
