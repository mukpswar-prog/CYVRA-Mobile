package cyvra.mobile.host.engine

import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Fail-closed verification tests: every rejection path in the contract's §6 ordered
 * checklist is exercised, plus the two ways the patch must be retained-but-inert.
 */
class PatchVerifierTest {

    private val keyPair: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val spkiBase64: String = Base64.getEncoder().encodeToString(keyPair.public.encoded)

    private val now: Instant = Instant.parse("2026-10-09T00:00:00Z")
    private val device = DeviceProfile(manufacturer = "samsung", model = "SM-A107F", apiLevel = 31)

    private fun anchors(vararg ids: String): Map<String, TrustAnchor> =
        ids.associateWith { TrustAnchor(keyId = it, publicKeyBase64 = spkiBase64) }

    private fun verifier(
        engineVersion: String = "1.0.0",
        trustAnchors: Map<String, TrustAnchor> = anchors("test-key"),
        knownRows: () -> Set<String> = { setOf("CON-001", "WIFI-001") },
    ) = PatchVerifier(
        engineVersion = engineVersion,
        trustAnchors = trustAnchors,
        knownMatrixRows = knownRows,
        clock = { now },
    )

    private fun payloadJson(
        engineMin: String = "1.0.0",
        matrixRows: String = """["CON-001"]""",
        patchId: String = "PATCH-ADB-20261009-1",
        validFrom: String? = null,
        validUntil: String? = null,
        oemScope: String = """{"manufacturer":"samsung","models":["SM-A107F"],"android_min":30,"android_max":34,"skins":[]}""",
        overrides: String = "[]",
    ): String = buildString {
        append("{")
        append("\"schema_version\":\"1.0\",")
        append("\"patch_id\":\"$patchId\",")
        append("\"engine_min_version\":\"$engineMin\",")
        append("\"matrix_rows\":$matrixRows,")
        append("\"oem_scope\":$oemScope,")
        append("\"evidence_refs\":[\"adb_devices.txt\"],")
        append("\"created_by\":\"test\",")
        append("\"approved_by\":\"test\",")
        append("\"created_at\":\"2026-10-01T00:00:00Z\",")
        if (validFrom != null) append("\"valid_from\":\"$validFrom\",")
        if (validUntil != null) append("\"valid_until\":\"$validUntil\",")
        append("\"procedure_overrides\":$overrides")
        append("}")
    }

    /** Signs [payloadToSign] but ships [payloadInEnvelope], so tampering is a clean delta. */
    private fun envelope(
        payloadToSign: String = payloadJson(),
        payloadInEnvelope: String = payloadToSign,
        keyId: String = "test-key",
        extraEnvelopeField: String = "",
    ): String {
        val canonical = PatchVerifier.canonicalize(Json.parseToJsonElement(payloadToSign))
        val signature = Signature.getInstance("Ed25519").run {
            initSign(keyPair.private)
            update(canonical.toByteArray(Charsets.UTF_8))
            Base64.getEncoder().encodeToString(sign())
        }
        return """{"payload":$payloadInEnvelope,"signature":"$signature","alg":"Ed25519","key_id":"$keyId"$extraEnvelopeField}"""
    }

    /**
     * Asserts a rejection, supplying a device so that the ordered checklist actually
     * reaches the step under test — scope (step 7) legitimately short-circuits everything
     * after it when no device is in scope.
     */
    private fun rejected(bytes: ByteArray, verifier: PatchVerifier = verifier()): PatchRejectReason {
        val result = verifier.verify(bytes, device = device)
        assertIs<PatchVerificationResult.Rejected>(result, "expected a rejection, got $result")
        return result.reason
    }

    // ---------------------------------------------------------------- happy path

    @Test
    fun acceptsAWellFormedSignedInScopePatch() {
        val result = verifier().verify(envelope().toByteArray(Charsets.UTF_8), device = device)
        assertIs<PatchVerificationResult.Accepted>(result)
        assertEquals("PATCH-ADB-20261009-1", result.patch.patchId)
        assertEquals("test-key", result.patch.keyId)
        assertEquals("1.0.0", result.patch.engineMinVersion)
        assertEquals(listOf("CON-001"), result.patch.matrixRows)
    }

    @Test
    fun canonicalisationSortsKeysAndDropsWhitespace() {
        val canonical = PatchVerifier.canonicalize(Json.parseToJsonElement("""{"b":1,"a":{"z":true,"m":[2,1]}}"""))
        assertEquals("""{"a":{"m":[2,1],"z":true},"b":1}""", canonical)
    }

    // --------------------------------------------------------- rejection paths

    @Test
    fun rejectsATamperedPayload() {
        val signed = payloadJson()
        val tampered = signed.replace("CON-001", "WIFI-001")
        assertEquals(PatchRejectReason.PATCH_SIGNATURE_INVALID, rejected(envelope(signed, tampered).toByteArray()))
    }

    @Test
    fun rejectsAnUnrecognisedOrRetiredKey() {
        assertEquals(
            PatchRejectReason.PATCH_UNKNOWN_KEY,
            rejected(envelope(keyId = "someone-elses-key").toByteArray()),
        )

        val retired = mapOf("test-key" to TrustAnchor("test-key", spkiBase64, trustedForVerifyOnly = true))
        assertEquals(
            PatchRejectReason.PATCH_UNKNOWN_KEY,
            rejected(envelope().toByteArray(), verifier(trustAnchors = retired)),
            "a verify-only key must not authorise a new patch",
        )
    }

    @Test
    fun rejectsAPatchAboveTheEngineFloor() {
        val bytes = envelope(payloadJson(engineMin = "2.0.0")).toByteArray()
        assertEquals(PatchRejectReason.PATCH_ENGINE_TOO_OLD, rejected(bytes, verifier(engineVersion = "1.0.0")))
    }

    @Test
    fun rejectsOutsideTheValidityWindow() {
        val expired = envelope(payloadJson(validUntil = "2026-10-01T00:00:00Z")).toByteArray()
        assertEquals(PatchRejectReason.PATCH_EXPIRED, rejected(expired))

        val future = envelope(payloadJson(validFrom = "2027-01-01T00:00:00Z")).toByteArray()
        assertEquals(PatchRejectReason.PATCH_NOT_YET_VALID, rejected(future))
    }

    @Test
    fun rejectsRowIdsThatTheMatrixCannotResolve() {
        val bytes = envelope(payloadJson(matrixRows = """["NOT-A-REAL-ROW"]""")).toByteArray()
        assertEquals(PatchRejectReason.PATCH_ROW_UNKNOWN, rejected(bytes))
    }

    @Test
    fun rejectsAPurgePathWithoutOwnershipAttestation() {
        val purge = payloadJson(overrides = """[{"procedure_id":"PUR-DO-WIPE","action":"wipe"}]""")
        val bytes = envelope(purge).toByteArray()

        assertEquals(PatchRejectReason.PATCH_AUTHORISATION_REQUIRED, rejected(bytes))

        val attested = verifier().verify(bytes, ownershipAttestationPresent = true, device = device)
        assertIs<PatchVerificationResult.Accepted>(attested, "with attestation the same patch verifies")
    }

    @Test
    fun rejectsMalformedInputBeforeTouchingAnyOtherStep() {
        assertEquals(
            PatchRejectReason.PATCH_MALFORMED,
            rejected(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + envelope().toByteArray()),
        )
        assertEquals(
            PatchRejectReason.PATCH_MALFORMED,
            rejected("\"just a string\"".toByteArray()),
        )
        assertEquals(
            PatchRejectReason.PATCH_SCHEMA_INVALID,
            rejected(envelope(extraEnvelopeField = ",\"unsigned_field\":\"nope\"").toByteArray()),
        )
        assertEquals(
            PatchRejectReason.PATCH_SCHEMA_INVALID,
            rejected("""{"payload":{},"signature":"","alg":"Ed25519","key_id":"test-key"}""".toByteArray()),
        )
    }

    @Test
    fun rejectsAnUnconfiguredVerifierEntirely() {
        // No compiled anchors, no row vocabulary: nothing can ever verify. Fail-closed by
        // construction rather than permissive by default.
        val bare = PatchVerifier(engineVersion = "1.0.0")
        val result = bare.verify(envelope().toByteArray(), device = device)
        assertIs<PatchVerificationResult.Rejected>(result)
        assertEquals(PatchRejectReason.PATCH_UNKNOWN_KEY, result.reason)
    }

    // ------------------------------------------- retained but inert, not rejected

    @Test
    fun recordsOutOfScopeAsNotApplicableRatherThanAFailure() {
        val other = DeviceProfile(manufacturer = "google", model = "Pixel 8", apiLevel = 33)
        val result = verifier().verify(envelope().toByteArray(), device = other)
        assertIs<PatchVerificationResult.NotApplicable>(result)
        assertEquals("PATCH-ADB-20261009-1", result.patchId)
        assertTrue(result.payloadSha256.length == 64, "hash is still recorded so retention is auditable")
    }

    @Test
    fun recordsMissingDeviceProfileAsNotApplicableRatherThanGuessing() {
        val result = verifier().verify(envelope().toByteArray(), device = null)
        assertIs<PatchVerificationResult.NotApplicable>(result)
    }

    // ------------------------------------------------------- patch-set record

    @Test
    fun patchSetStartsHonestAndCarriesAllFiveReportFields() {
        val fields = PatchSetState().reportFields("1.0.0")
        assertEquals("NO-PATCHES", fields["patch_set_version"])
        assertEquals("NO-PATCHES", fields["patch_set_mode"])
        assertEquals("1.0.0", fields["engine_version"])
        assertTrue(fields.containsKey("patch_set_hash"))
        assertTrue(fields.containsKey("applied_patch_count"))
    }

    @Test
    fun applyingThenRollingBackKeepsHistoryAndMode() {
        val accepted = verifier().verify(envelope().toByteArray(), device = device)
        assertIs<PatchVerificationResult.Accepted>(accepted)

        val applied = PatchSetState().with(accepted.patch, now)
        assertEquals(PatchSetMode.SIGNED_CURRENT, applied.mode)
        assertTrue(applied.version != "NO-PATCHES" && applied.version.endsWith("-1"), "got ${applied.version}")
        assertEquals(1, applied.appliedPatches.size)
        assertTrue(applied.hash.isNotBlank())

        val rolled = applied.rollback("corrupt guest response", now)
        assertEquals(PatchSetMode.SIGNED_ROLLED_BACK, rolled.mode)
        assertEquals("corrupt guest response", rolled.rollbackReason)
        assertNotNullRollback(rolled)
        assertEquals(1, rolled.appliedPatches.size, "rollback marks history, it does not delete it")
        assertTrue(rolled.appliedPatches.first().rolledBackAt != null)
    }

    private fun assertNotNullRollback(state: PatchSetState) {
        assertTrue(state.appliedPatches.all { it.rolledBackAt != null }, "every entry must show its rollback")
    }
}
