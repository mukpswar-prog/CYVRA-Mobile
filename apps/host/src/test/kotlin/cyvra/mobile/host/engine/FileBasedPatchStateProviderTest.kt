package cyvra.mobile.host.engine

import java.io.File
import java.nio.file.Files
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Tests for [FileBasedPatchStateProvider].
 *
 * **Every cryptographic key here is generated inside the test.** It is passed to the
 * provider's `trustAnchors` constructor parameter and never touches
 * [PatchTrustAnchors], which is the production registry and is pinned empty by
 * [productionTrustAnchorRegistryIsEmpiricallyEmpty]. A test key that could reach the
 * production registry would let whoever generated its private half authoritatively assert
 * the applied patch set of a customer's device.
 *
 * These tests prove the *gates* behave fail-closed. They are not evidence that D-5's
 * production report finalisation works: no approved anchor exists, so the corpus and
 * reconciliation paths below are reachable only because a test supplies the anchor.
 */
class FileBasedPatchStateProviderTest {

    private val keyPair: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val spkiBase64: String = Base64.getEncoder().encodeToString(keyPair.public.encoded)

    private val now: Instant = Instant.parse("2026-10-09T00:00:00Z")
    private val device = DeviceProfile(manufacturer = "samsung", model = "SM-A107F", apiLevel = 31)

    private val installationRoot: File = Files.createTempDirectory("cyvra-patch-corpus").toFile()

    private val corpusDirectory: File
        get() = File(installationRoot, FileBasedPatchStateProvider.PATCH_CORPUS_DIRECTORY)

    @AfterTest
    fun removeInstallationRoot() {
        installationRoot.deleteRecursively()
    }

    // ---------------------------------------------------------------- helpers

    private fun anchors(vararg ids: String): Map<String, TrustAnchor> =
        ids.associateWith { TrustAnchor(keyId = it, publicKeyBase64 = spkiBase64) }

    private fun canonicalOf(payload: String): String =
        PatchVerifier.canonicalize(Json.parseToJsonElement(payload))

    private fun payloadJson(
        patchId: String = "PATCH-ADB-20261009-1",
        matrixRows: String = """["CON-001"]""",
        oemScope: String =
            """{"manufacturer":"samsung","models":["SM-A107F"],"android_min":30,"android_max":34,"skins":[]}""",
    ): String = """{"schema_version":"1.0","patch_id":"$patchId","engine_min_version":"1.0.0","matrix_rows":$matrixRows,"oem_scope":$oemScope,"evidence_refs":["adb_devices.txt"],"created_by":"test","approved_by":"test","created_at":"2026-10-01T00:00:00Z","procedure_overrides":[]}"""

    /** Signs [payloadToSign] but ships [payloadInEnvelope], so tampering is a clean delta. */
    private fun envelope(
        payloadToSign: String = payloadJson(),
        payloadInEnvelope: String = payloadToSign,
        keyId: String = "test-key",
    ): String {
        val signature = Signature.getInstance("Ed25519").run {
            initSign(keyPair.private)
            update(canonicalOf(payloadToSign).toByteArray(Charsets.UTF_8))
            Base64.getEncoder().encodeToString(sign())
        }
        return """{"payload":$payloadInEnvelope,"signature":"$signature","alg":"Ed25519","key_id":"$keyId"}"""
    }

    private fun writeCorpusEntry(name: String, contents: String) {
        corpusDirectory.mkdirs()
        File(corpusDirectory, name).writeText(contents, Charsets.UTF_8)
    }

    /** A [PatchSetState] that names exactly [payload] as applied, and is internally consistent. */
    private fun appliedStateFor(payload: String = payloadJson(), patchId: String = "PATCH-ADB-20261009-1"): PatchSetState {
        val record = AppliedPatch(
            patchId = patchId,
            sha256 = PatchVerifier.sha256Hex(canonicalOf(payload).toByteArray(Charsets.UTF_8)),
            keyId = "test-key",
            appliedAt = now.toString(),
        )
        return PatchSetState(
            version = "2026.10.09-1",
            hash = PatchSetState.computeHash(listOf(record)),
            mode = PatchSetMode.SIGNED_CURRENT,
            appliedPatches = listOf(record),
        )
    }

    private fun provider(
        trustAnchors: Map<String, TrustAnchor> = anchors("test-key"),
        appliedStateSource: AppliedPatchStateSource = NoGovernedAppliedStateSource,
    ) = FileBasedPatchStateProvider(
        engineVersion = "1.0.0",
        installationRoot = { installationRoot.absolutePath },
        matrixLoader = CapabilityMatrixLoader(),
        trustAnchors = trustAnchors,
        appliedStateSource = appliedStateSource,
        clock = { now },
    )

    private fun refusal(outcome: PatchStateOutcome): String =
        (outcome as? PatchStateOutcome.Unavailable)?.reason ?: fail("expected Unavailable, was $outcome")

    private fun establishedState(outcome: PatchStateOutcome): PatchSetState =
        (outcome as? PatchStateOutcome.Established)?.state ?: fail("expected Established, was $outcome")

    // ------------------------------------------------------ production posture

    @Test
    fun productionTrustAnchorRegistryIsEmpiricallyEmpty() {
        // Guards the production registry against a fixture or illustrative key being
        // added to it. Contract 9.1 records custody as open, so no approved key exists.
        assertTrue(
            PatchTrustAnchors.ALL.isEmpty(),
            "PatchTrustAnchors.ALL must stay empty until a named custodian issues a real key",
        )
    }

    @Test
    fun productionAppliedStateSourceRefusesRatherThanGuessing() {
        // Contract 6 step 11 requires an applied-state record; no format is governed and
        // no apply lifecycle writes one, so the production source must refuse.
        assertTrue(
            NoGovernedAppliedStateSource.read() is PatchStateOutcome.Unavailable,
            "the production applied-state source must never synthesise a patch set",
        )
    }

    // ------------------------------------------------------------- gate 1: anchors

    @Test
    fun refusesWhenNoTrustAnchorIsApprovedBeforeReadingTheFilesystem() {
        // Production today: empty registry, and no corpus to look at either. The anchor
        // gate must fire first, so the message names the governing blocker.
        val reason = refusal(provider(trustAnchors = emptyMap()).establish(device))

        assertTrue(reason.startsWith("NO_APPROVED_TRUST_ANCHOR"), "was: $reason")
    }

    @Test
    fun refusesAnEnvelopeSignedByAnUnknownKeyId() {
        writeCorpusEntry("rogue.json", envelope(keyId = "rogue-key"))

        val reason = refusal(provider().establish(device))

        assertTrue(reason.contains("PATCH_UNKNOWN_KEY"), "was: $reason")
    }

    // -------------------------------------------------------------- gate 2/3/4: corpus

    @Test
    fun refusesWhenTheInstallationRootIsNotSupplied() {
        val provider = FileBasedPatchStateProvider(
            engineVersion = "1.0.0",
            installationRoot = { null },
            matrixLoader = CapabilityMatrixLoader(),
            trustAnchors = anchors("test-key"),
            appliedStateSource = NoGovernedAppliedStateSource,
            clock = { now },
        )

        val reason = refusal(provider.establish(device))

        assertTrue(reason.startsWith("INSTALL_ROOT_UNSET"), "was: $reason")
    }

    @Test
    fun refusesWhenTheCorpusDirectoryIsMissing() {
        // No `patches/` directory at all: absence of evidence, not an empty patch set.
        val reason = refusal(provider().establish(device))

        assertTrue(reason.startsWith("PATCH_CORPUS_MISSING"), "was: $reason")
    }

    @Test
    fun refusesAnEmptyCorpusRatherThanReportingNoPatches() {
        corpusDirectory.mkdirs()

        val reason = refusal(provider().establish(device))

        assertTrue(reason.startsWith("PATCH_CORPUS_EMPTY"), "was: $reason")
        assertTrue(reason.contains("NO-PATCHES"), "must name the claim it refuses to make: $reason")
    }

    // ------------------------------------------------------- gate 5: verification

    @Test
    fun refusesATamperedPayload() {
        val signed = payloadJson()
        writeCorpusEntry(
            "tampered.json",
            envelope(payloadToSign = signed, payloadInEnvelope = signed.replace("CON-001", "WIFI-001")),
        )

        val reason = refusal(provider().establish(device))

        assertTrue(reason.contains("PATCH_SIGNATURE_INVALID"), "was: $reason")
    }

    @Test
    fun refusesAMalformedEnvelope() {
        writeCorpusEntry("garbage.json", "this is not a JSON envelope")

        val reason = refusal(provider().establish(device))

        assertTrue(reason.contains("PATCH_MALFORMED"), "was: $reason")
    }

    @Test
    fun refusesWhenOneEnvelopeInTheCorpusFailsVerification() {
        writeCorpusEntry("01-good.json", envelope(payloadToSign = payloadJson(patchId = "PATCH-ADB-20261009-1")))
        writeCorpusEntry("02-bad.json", "{not json}")

        val reason = refusal(provider().establish(device))

        assertTrue(reason.contains("PATCH_MALFORMED"), "was: $reason")
    }

    // ------------------------------------------------- gate 5: matrix-row resolution

    /** Writes one corpus envelope whose `matrix_rows` is exactly [rows], then establishes. */
    private fun establishWithRows(rows: String): PatchStateOutcome {
        corpusDirectory.mkdirs()
        File(corpusDirectory, "01-row.json").writeText(
            envelope(payloadToSign = payloadJson(matrixRows = rows)),
            Charsets.UTF_8,
        )
        return provider(
            appliedStateSource = AppliedPatchStateSource { PatchStateOutcome.Established(PatchSetState()) },
        ).establish(device)
    }

    @Test
    fun resolvesARatifiedRowByItsStableBareId() {
        // The matrix prints `CON-001 **[S]**`, but the marker is ratification status and
        // the id is `CON-001`. Resolving here proves step 8 accepted it.
        val state = establishedState(establishWithRows("""["CON-001"]"""))

        assertEquals(PatchSetMode.NO_PATCHES, state.mode, "the row resolved, so the corpus verified")
    }

    @Test
    fun resolvesAProvisionalRowByTheSameStableBareId() {
        // `SEC-001` is still `[P]`. Its id does not change when it is ratified, so a
        // patch may name it today and keep resolving afterwards.
        val state = establishedState(establishWithRows("""["SEC-001"]"""))

        assertEquals(PatchSetMode.NO_PATCHES, state.mode, "a provisional row resolves by its bare id")
    }

    @Test
    fun rejectsAMatrixRowThatStillCarriesTheRatificationMarker() {
        // Resolving against the marked form would silently accept two spellings of one
        // row and break the moment the row was ratified. `PATCH_ROW_UNKNOWN` must stand.
        val reason = refusal(establishWithRows("""["CON-001 [S]"]"""))

        assertTrue(reason.contains("PATCH_ROW_UNKNOWN"), "was: $reason")
    }

    @Test
    fun rejectsTheIllustrativeRowIdsQuotedFromTheSchemaExample() {
        // Schema §5.1 labels its payload "EXAMPLE ONLY"; §9.3 defers the real vocabulary
        // to the capability matrix, which contains no such row.
        val reason = refusal(establishWithRows("""["ADB-GETPROP-READ", "ADB-DUMPSYS-BATTERY"]"""))

        assertTrue(reason.contains("PATCH_ROW_UNKNOWN"), "was: $reason")
    }

    @Test
    fun rejectsAMatrixRowTheMatrixCannotResolve() {
        val reason = refusal(establishWithRows("""["NOPE-999"]"""))

        assertTrue(reason.contains("PATCH_ROW_UNKNOWN"), "was: $reason")
    }

    // -------------------------------------------------- gate 6: application evidence

    @Test
    fun refusesWhenNoAppliedStateRecordCanBeReadEvenThoughTheCorpusVerifies() {
        writeCorpusEntry("01-good.json", envelope())
        val source = AppliedPatchStateSource { PatchStateOutcome.Unavailable("STATE_RECORD_MISSING") }

        val reason = refusal(provider(appliedStateSource = source).establish(device))

        assertEquals("STATE_RECORD_MISSING", reason, "the source's reason must be surfaced verbatim")
    }

    // --------------------------------------------------------- gate 7: reconciliation

    @Test
    fun refusesAnAppliedRecordNamingAPatchTheCorpusDidNotVerify() {
        writeCorpusEntry("01-good.json", envelope())
        val source = AppliedPatchStateSource {
            PatchStateOutcome.Established(appliedStateFor(patchId = "PATCH-ADB-20261009-9"))
        }

        val reason = refusal(provider(appliedStateSource = source).establish(device))

        assertTrue(reason.startsWith("APPLIED_PATCH_NOT_IN_VERIFIED_CORPUS"), "was: $reason")
    }

    @Test
    fun refusesAnAppliedRecordWhoseHashDoesNotMatchItsOwnContents() {
        writeCorpusEntry("01-good.json", envelope())
        val tampered = appliedStateFor().copy(hash = "0".repeat(64))
        val source = AppliedPatchStateSource { PatchStateOutcome.Established(tampered) }

        val reason = refusal(provider(appliedStateSource = source).establish(device))

        assertTrue(reason.startsWith("APPLIED_STATE_INCONSISTENT"), "was: $reason")
    }

    @Test
    fun refusesARollbackClaimThatCarriesNoRollbackReason() {
        writeCorpusEntry("01-good.json", envelope())
        val rolledBackWithoutReason = appliedStateFor().copy(
            mode = PatchSetMode.SIGNED_ROLLED_BACK,
            rollbackReason = null,
        )
        val source = AppliedPatchStateSource { PatchStateOutcome.Established(rolledBackWithoutReason) }

        val reason = refusal(provider(appliedStateSource = source).establish(device))

        assertTrue(reason.startsWith("APPLIED_STATE_INCONSISTENT"), "was: $reason")
    }

    // ------------------------------------------------------------- establishment

    @Test
    fun establishesStateWhenTheCorpusVerifiesAndTheRecordReconciles() {
        val payload = payloadJson()
        writeCorpusEntry("01-good.json", envelope(payloadToSign = payload))
        val source = AppliedPatchStateSource { PatchStateOutcome.Established(appliedStateFor(payload)) }

        val state = establishedState(provider(appliedStateSource = source).establish(device))

        assertEquals(PatchSetMode.SIGNED_CURRENT, state.mode)
        assertEquals("PATCH-ADB-20261009-1", state.appliedPatches.single().patchId)
    }

    @Test
    fun establishesAnAuthoritativeEmptySetOnlyWhenTheRecordPositivelySaysSo() {
        // The corpus holds a valid, in-scope patch, but the applied record states nothing
        // is applied. That is a genuine, record-backed NO-PATCHES - the one case contract
        // §8 permits - and is distinct from every refusal above.
        writeCorpusEntry("01-good.json", envelope())
        val source = AppliedPatchStateSource { PatchStateOutcome.Established(PatchSetState()) }

        val state = establishedState(provider(appliedStateSource = source).establish(device))

        assertEquals(PatchSetMode.NO_PATCHES, state.mode)
        assertEquals("NO-PATCHES", state.version)
    }

    @Test
    fun recordsAnOutOfScopePatchAsInertRatherThanAsAFailure() {
        // Contract §6.7 / Spec §82: a signed patch scoped to another OEM is retained and
        // exerts no effect. It must not reject the corpus, and it must not be applied.
        val otherScope = payloadJson(
            oemScope = """{"manufacturer":"google","models":["Pixel 8"],"android_min":30,"android_max":34,"skins":[]}""",
        )
        writeCorpusEntry("01-other-oem.json", envelope(payloadToSign = otherScope))
        val source = AppliedPatchStateSource { PatchStateOutcome.Established(PatchSetState()) }

        val state = establishedState(provider(appliedStateSource = source).establish(device))

        assertEquals(PatchSetMode.NO_PATCHES, state.mode)
    }
}
