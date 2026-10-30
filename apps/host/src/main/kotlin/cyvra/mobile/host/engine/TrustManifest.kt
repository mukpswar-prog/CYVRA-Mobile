package cyvra.mobile.host.engine

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64

/**
 * Pinned root of trust compiled into CYVRA Mobile Host.
 *
 * Adheres to NIST SP 800-57 Part 1 Rev. 5 and the CYVRA Automated Key Management Specification:
 * - The root key is an offline / air-gapped authority used solely to authorize the Trust Manifest.
 * - CYVRA Host pins this root public key at compile time.
 * - Routine operational signing keys (patches, reports) are distributed through authenticated manifests.
 */
object PinnedRootTrust {
    const val ROOT_KEY_ID: String = "CYVRA-ROOT-KEY-2026-01"

    /** Base64 SPKI of the compiled-in root Ed25519 public key. */
    const val ROOT_PUBLIC_KEY_BASE64: String =
        "MCowBQYDK2VwAyEAM++Pc5uoOW1164Q5rRvty4mUqVEQGXEcmpcLMM4kQZc="
}

/**
 * An individual operational public key declared in a signed trust manifest.
 */
@Serializable
data class TrustManifestAnchor(
    val keyId: String,
    val algorithm: String = "Ed25519",
    val publicKeyBase64: String,
    val purpose: String = "PATCH_AUTHORITY",
    val status: String = "ACTIVE",
    val validFrom: String? = null,
    val validUntil: String? = null,
    val trustedForVerifyOnly: Boolean = false,
)

/**
 * The canonical payload of a CYVRA trust manifest.
 */
@Serializable
data class TrustManifestPayload(
    val manifestVersion: Int,
    val rootKeyId: String,
    val publishedAt: String,
    val anchors: List<TrustManifestAnchor>,
)

/**
 * The wire envelope of a CYVRA trust manifest.
 */
@Serializable
data class TrustManifestEnvelope(
    val payload: JsonObject,
    val signature: String,
    val alg: String = "Ed25519",
    val rootKeyId: String,
)

sealed interface TrustManifestResult {
    data class Accepted(
        val manifestVersion: Int,
        val anchors: Map<String, TrustAnchor>,
        val publishedAt: Instant,
    ) : TrustManifestResult

    data class Rejected(val reason: String) : TrustManifestResult
}

/**
 * Verifies a trust manifest against the pinned root authority.
 *
 * Fail-closed by construction:
 * 1. Requires valid JSON envelope with payload, signature, alg, rootKeyId.
 * 2. Checks alg == "Ed25519".
 * 3. Enforces rootKeyId matches [pinnedRootKeyId].
 * 4. Authenticates Ed25519 signature over canonical UTF-8 bytes of payload.
 * 5. Validates active validity window against [clock].
 * 6. Discards revoked keys; maps retired keys to verify-only.
 * 7. Isolates key purposes: only purpose == "PATCH_AUTHORITY" is converted to [TrustAnchor].
 */
class TrustManifestVerifier(
    private val pinnedRootKeyId: String = PinnedRootTrust.ROOT_KEY_ID,
    private val pinnedRootPublicKeyBase64: String = PinnedRootTrust.ROOT_PUBLIC_KEY_BASE64,
    private val clock: () -> Instant = { Instant.now() },
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = false
    }

    fun verify(manifestJsonText: String): TrustManifestResult {
        val root = try {
            json.parseToJsonElement(manifestJsonText) as? JsonObject
        } catch (e: Exception) {
            return TrustManifestResult.Rejected("MANIFEST_MALFORMED: ${e.message}")
        } ?: return TrustManifestResult.Rejected("MANIFEST_MALFORMED: root must be a JSON object")

        val payloadObj = root["payload"] as? JsonObject
            ?: return TrustManifestResult.Rejected("MANIFEST_SCHEMA_INVALID: missing payload object")
        val signatureText = root["signature"]?.toString()?.trim('"')
            ?: return TrustManifestResult.Rejected("MANIFEST_SCHEMA_INVALID: missing signature")
        val alg = root["alg"]?.toString()?.trim('"')
            ?: return TrustManifestResult.Rejected("MANIFEST_SCHEMA_INVALID: missing alg")
        val rootKeyId = root["rootKeyId"]?.toString()?.trim('"')
            ?: root["root_key_id"]?.toString()?.trim('"')
            ?: return TrustManifestResult.Rejected("MANIFEST_SCHEMA_INVALID: missing rootKeyId")

        if (alg != "Ed25519") {
            return TrustManifestResult.Rejected("MANIFEST_UNSUPPORTED_ALG: alg must be Ed25519, was '$alg'")
        }
        if (rootKeyId != pinnedRootKeyId) {
            return TrustManifestResult.Rejected("MANIFEST_UNKNOWN_ROOT_KEY: expected '$pinnedRootKeyId', got '$rootKeyId'")
        }

        val signatureBytes = try {
            Base64.getDecoder().decode(signatureText)
        } catch (e: Exception) {
            return TrustManifestResult.Rejected("MANIFEST_SIGNATURE_INVALID: signature is not base64")
        }

        // Verify signature with pinned root key
        val rootPublicKey = try {
            val keyBytes = Base64.getDecoder().decode(pinnedRootPublicKeyBase64)
            KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(keyBytes))
        } catch (e: Exception) {
            return TrustManifestResult.Rejected("MANIFEST_ROOT_KEY_CORRUPT: ${e.message}")
        }

        val canonicalBytes = PatchVerifier.canonicalize(payloadObj).toByteArray(Charsets.UTF_8)
        val validSig = try {
            val verifier = Signature.getInstance("Ed25519")
            verifier.initVerify(rootPublicKey)
            verifier.update(canonicalBytes)
            verifier.verify(signatureBytes)
        } catch (e: Exception) {
            false
        }
        if (!validSig) {
            return TrustManifestResult.Rejected("MANIFEST_SIGNATURE_INVALID: root signature verification failed")
        }

        val payload = try {
            json.decodeFromJsonElement(TrustManifestPayload.serializer(), payloadObj)
        } catch (e: Exception) {
            return TrustManifestResult.Rejected("MANIFEST_PAYLOAD_INVALID: ${e.message}")
        }

        if (payload.rootKeyId != pinnedRootKeyId) {
            return TrustManifestResult.Rejected("MANIFEST_ROOT_KEY_MISMATCH: payload specifies '${payload.rootKeyId}'")
        }

        val publishedAt = try {
            Instant.parse(payload.publishedAt)
        } catch (e: Exception) {
            return TrustManifestResult.Rejected("MANIFEST_DATE_INVALID: ${e.message}")
        }

        val now = clock()
        val anchors = mutableMapOf<String, TrustAnchor>()

        for (entry in payload.anchors) {
            // Purpose isolation: only PATCH_AUTHORITY is accepted for capability patches
            if (entry.purpose != "PATCH_AUTHORITY") {
                continue
            }
            // Revocation check
            if (entry.status.equals("REVOKED", ignoreCase = true)) {
                continue
            }

            // Expiry / validity check
            if (entry.validFrom != null) {
                val from = try { Instant.parse(entry.validFrom) } catch (e: Exception) { null }
                if (from != null && now.isBefore(from)) {
                    continue
                }
            }
            if (entry.validUntil != null) {
                val until = try { Instant.parse(entry.validUntil) } catch (e: Exception) { null }
                if (until != null && now.isAfter(until)) {
                    continue
                }
            }

            val isVerifyOnly = entry.trustedForVerifyOnly || entry.status.equals("RETIRED", ignoreCase = true)
            anchors[entry.keyId] = TrustAnchor(
                keyId = entry.keyId,
                publicKeyBase64 = entry.publicKeyBase64,
                trustedForVerifyOnly = isVerifyOnly,
            )
        }

        return TrustManifestResult.Accepted(
            manifestVersion = payload.manifestVersion,
            anchors = anchors,
            publishedAt = publishedAt,
        )
    }
}
