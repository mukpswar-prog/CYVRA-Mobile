package cyvra.mobile.host.engine

import kotlinx.serialization.json.Json
import java.io.File
import java.nio.file.Files
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Instant
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Security test matrix for CYVRA Automated Key Management Trust Manifests.
 *
 * Verifies RFC 8032 Ed25519 root signatures, payload canonicalization, fail-closed
 * rejection, purpose isolation, revocation filtering, and FileBasedPatchStateProvider integration.
 */
class TrustManifestTest {

    // The private key corresponding to PinnedRootTrust.ROOT_PUBLIC_KEY_BASE64
    private val rootPrivateKeyBase64 = "MC4CAQAwBQYDK2VwBCIEIAt3zKJfzlybCkfRZUNvCW6nh1HiSlQ/xLQyPVwwhGhw"
    private val rootPrivateKey: PrivateKey = KeyFactory.getInstance("Ed25519").generatePrivate(
        PKCS8EncodedKeySpec(Base64.getDecoder().decode(rootPrivateKeyBase64))
    )

    private val operationalKeyPair: KeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val operationalPubBase64: String = Base64.getEncoder().encodeToString(operationalKeyPair.public.encoded)

    private val tempDir: File = Files.createTempDirectory("cyvra-manifest-test").toFile()

    @AfterTest
    fun cleanup() {
        tempDir.deleteRecursively()
    }

    private fun signPayload(payloadJsonText: String, key: PrivateKey = rootPrivateKey): String {
        val element = Json.parseToJsonElement(payloadJsonText)
        val canonicalBytes = PatchVerifier.canonicalize(element).toByteArray(Charsets.UTF_8)
        val signer = Signature.getInstance("Ed25519")
        signer.initSign(key)
        signer.update(canonicalBytes)
        return Base64.getEncoder().encodeToString(signer.sign())
    }

    private fun buildEnvelope(
        payloadJsonText: String,
        rootKeyId: String = PinnedRootTrust.ROOT_KEY_ID,
        signingKey: PrivateKey = rootPrivateKey,
        alg: String = "Ed25519",
        tamperPayload: Boolean = false,
    ): String {
        val signature = signPayload(payloadJsonText, signingKey)
        val finalPayload = if (tamperPayload) {
            payloadJsonText.replace("CYVRA-PATCH-KEY-01", "CYVRA-ATTACKER-KEY")
        } else {
            payloadJsonText
        }
        return """
        {
          "payload": $finalPayload,
          "signature": "$signature",
          "alg": "$alg",
          "rootKeyId": "$rootKeyId"
        }
        """.trimIndent()
    }

    private fun samplePayload(
        version: Int = 1,
        rootKeyId: String = PinnedRootTrust.ROOT_KEY_ID,
        anchorsJson: String = """
        [
          {
            "keyId": "CYVRA-PATCH-KEY-01",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "PATCH_AUTHORITY",
            "status": "ACTIVE",
            "validFrom": "2026-01-01T00:00:00Z",
            "validUntil": "2028-01-01T00:00:00Z",
            "trustedForVerifyOnly": false
          }
        ]
        """.trimIndent(),
    ): String = """
    {
      "manifestVersion": $version,
      "rootKeyId": "$rootKeyId",
      "publishedAt": "2026-10-30T00:00:00Z",
      "anchors": $anchorsJson
    }
    """.trimIndent()

    @Test
    fun validManifestSignedByPinnedRootIsAccepted() {
        val verifier = TrustManifestVerifier(clock = { Instant.parse("2026-10-30T12:00:00Z") })
        val jsonEnvelope = buildEnvelope(samplePayload())

        val result = verifier.verify(jsonEnvelope)
        if (result !is TrustManifestResult.Accepted) {
            throw AssertionError("Expected Accepted, was $result")
        }

        assertEquals(1, result.manifestVersion)
        assertEquals(1, result.anchors.size)
        assertTrue(result.anchors.containsKey("CYVRA-PATCH-KEY-01"))
        assertFalse(result.anchors["CYVRA-PATCH-KEY-01"]!!.trustedForVerifyOnly)
    }

    @Test
    fun manifestSignedByUnknownRogueRootIsRejected() {
        val rogueRootKeyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val verifier = TrustManifestVerifier()
        val jsonEnvelope = buildEnvelope(
            samplePayload(rootKeyId = "ROGUE-ROOT-KEY"),
            rootKeyId = "ROGUE-ROOT-KEY",
            signingKey = rogueRootKeyPair.private,
        )

        val result = verifier.verify(jsonEnvelope)
        assertTrue(result is TrustManifestResult.Rejected)
        assertTrue(result.reason.contains("MANIFEST_UNKNOWN_ROOT_KEY"))
    }

    @Test
    fun tamperedManifestPayloadFailsSignatureVerification() {
        val verifier = TrustManifestVerifier()
        val jsonEnvelope = buildEnvelope(samplePayload(), tamperPayload = true)

        val result = verifier.verify(jsonEnvelope)
        assertTrue(result is TrustManifestResult.Rejected)
        assertTrue(result.reason.contains("MANIFEST_SIGNATURE_INVALID"))
    }

    @Test
    fun unsupportedAlgorithmIsRejected() {
        val verifier = TrustManifestVerifier()
        val jsonEnvelope = buildEnvelope(samplePayload(), alg = "RSA-SHA256")

        val result = verifier.verify(jsonEnvelope)
        assertTrue(result is TrustManifestResult.Rejected)
        assertTrue(result.reason.contains("MANIFEST_UNSUPPORTED_ALG"))
    }

    @Test
    fun purposeSeparationExcludesNonPatchAuthorityKeys() {
        val verifier = TrustManifestVerifier(clock = { Instant.parse("2026-10-30T12:00:00Z") })
        val anchors = """
        [
          {
            "keyId": "CYVRA-REPORT-SIGNER-01",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "REPORT_SIGNING",
            "status": "ACTIVE"
          },
          {
            "keyId": "CYVRA-PATCH-KEY-01",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "PATCH_AUTHORITY",
            "status": "ACTIVE"
          }
        ]
        """.trimIndent()
        val jsonEnvelope = buildEnvelope(samplePayload(anchorsJson = anchors))

        val result = verifier.verify(jsonEnvelope)
        if (result !is TrustManifestResult.Accepted) {
            throw AssertionError("Expected Accepted, was $result")
        }

        assertEquals(1, result.anchors.size, "REPORT_SIGNING key must be excluded from patch authority")
        assertTrue(result.anchors.containsKey("CYVRA-PATCH-KEY-01"))
        assertFalse(result.anchors.containsKey("CYVRA-REPORT-SIGNER-01"))
    }

    @Test
    fun revokedKeyIsFilteredOut() {
        val verifier = TrustManifestVerifier(clock = { Instant.parse("2026-10-30T12:00:00Z") })
        val anchors = """
        [
          {
            "keyId": "CYVRA-REVOKED-KEY",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "PATCH_AUTHORITY",
            "status": "REVOKED"
          }
        ]
        """.trimIndent()
        val jsonEnvelope = buildEnvelope(samplePayload(anchorsJson = anchors))

        val result = verifier.verify(jsonEnvelope)
        if (result !is TrustManifestResult.Accepted) {
            throw AssertionError("Expected Accepted, was $result")
        }

        assertEquals(0, result.anchors.size, "Revoked key must not be populated into anchors")
    }

    @Test
    fun retiredKeyIsMappedToVerifyOnly() {
        val verifier = TrustManifestVerifier(clock = { Instant.parse("2026-10-30T12:00:00Z") })
        val anchors = """
        [
          {
            "keyId": "CYVRA-RETIRED-KEY",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "PATCH_AUTHORITY",
            "status": "RETIRED"
          }
        ]
        """.trimIndent()
        val jsonEnvelope = buildEnvelope(samplePayload(anchorsJson = anchors))

        val result = verifier.verify(jsonEnvelope)
        if (result !is TrustManifestResult.Accepted) {
            throw AssertionError("Expected Accepted, was $result")
        }

        assertEquals(1, result.anchors.size)
        assertTrue(result.anchors["CYVRA-RETIRED-KEY"]!!.trustedForVerifyOnly)
    }

    @Test
    fun expiredKeyIsExcludedFromActiveAnchors() {
        val verifier = TrustManifestVerifier(clock = { Instant.parse("2026-10-30T12:00:00Z") })
        val anchors = """
        [
          {
            "keyId": "CYVRA-EXPIRED-KEY",
            "algorithm": "Ed25519",
            "publicKeyBase64": "$operationalPubBase64",
            "purpose": "PATCH_AUTHORITY",
            "status": "ACTIVE",
            "validUntil": "2026-05-01T00:00:00Z"
          }
        ]
        """.trimIndent()
        val jsonEnvelope = buildEnvelope(samplePayload(anchorsJson = anchors))

        val result = verifier.verify(jsonEnvelope)
        if (result !is TrustManifestResult.Accepted) {
            throw AssertionError("Expected Accepted, was $result")
        }

        assertEquals(0, result.anchors.size, "Expired key must be excluded")
    }

    @Test
    fun fileBasedPatchStateProviderDiscoversAndVerifiesManifest() {
        val patchesDir = File(tempDir, "patches")
        patchesDir.mkdirs()

        val manifestFile = File(patchesDir, "trust-manifest.json")
        manifestFile.writeText(buildEnvelope(samplePayload()), Charsets.UTF_8)

        val provider = FileBasedPatchStateProvider(
            engineVersion = "1.0.0",
            installationRoot = { tempDir.absolutePath },
            clock = { Instant.parse("2026-10-30T12:00:00Z") },
        )

        // Without patches in the corpus, Gate 1 passes because anchors are loaded,
        // and it proceeds to Gate 4 (PATCH_CORPUS_EMPTY)
        val outcome = provider.establish()
        assertTrue(outcome is PatchStateOutcome.Unavailable)
        val reason = (outcome as PatchStateOutcome.Unavailable).reason

        assertEquals(
            "PATCH_CORPUS_EMPTY: the corpus holds no envelope, which is an absence of evidence and is never reported as NO-PATCHES",
            reason,
            "Provider must have resolved trust anchors from manifest and proceeded to corpus check",
        )
    }
}
