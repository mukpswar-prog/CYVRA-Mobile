package cyvra.mobile.host.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64

/**
 * Rejection reasons, exactly as named by
 * `docs/CYVRA_CAPABILITY_PATCH_SCHEMA.md` §6–§7.
 *
 * Verification is fail-closed: any of these rejects the **whole** patch. There is no
 * partial acceptance, no "apply what verified", and no fallback to unsigned behaviour.
 */
enum class PatchRejectReason {
    PATCH_MALFORMED,
    PATCH_SCHEMA_INVALID,
    PATCH_UNKNOWN_KEY,
    PATCH_SIGNATURE_INVALID,
    PATCH_ENGINE_TOO_OLD,
    PATCH_NOT_YET_VALID,
    PATCH_EXPIRED,
    PATCH_ROW_UNKNOWN,
    PATCH_PRECONDITION_UNMET,
    PATCH_AUTHORISATION_REQUIRED,
    PATCH_ID_REUSE,
}

/** A public key compiled into the engine at governed build time. No network key fetch. */
data class TrustAnchor(
    val keyId: String,
    /** Base64 of an X.509 SubjectPublicKeyInfo, or of a raw 32-byte Ed25519 key. */
    val publicKeyBase64: String,
    /** Retained only to verify historical reports; cannot authorise a new patch. */
    val trustedForVerifyOnly: Boolean = false,
)

/** The live device identity used for `oem_scope` matching. */
data class DeviceProfile(
    val manufacturer: String,
    val model: String,
    val apiLevel: Int,
)

/** `oem_scope` of a patch, matched against the live device. */
data class OemScope(
    val manufacturer: String,
    val models: List<String>,
    val androidMin: Int,
    val androidMax: Int,
    val skins: List<String>,
) {
    fun matches(manufacturer: String, model: String, apiLevel: Int): Boolean {
        if (!this.manufacturer.equals(manufacturer, ignoreCase = true)) return false
        if (models.isNotEmpty() && models.none { it.equals(model, ignoreCase = true) }) return false
        if (apiLevel < androidMin || apiLevel > androidMax) return false
        return true
    }
}

/** A patch that passed every verification step. */
data class VerifiedPatch(
    val patchId: String,
    val keyId: String,
    val payload: JsonObject,
    val payloadSha256: String,
    val engineMinVersion: String,
    val matrixRows: List<String>,
    val procedureOverrides: List<JsonObject>,
    val oemScope: OemScope,
) {
    /** True when any override touches a purge, reset or wipe path (contract §6.9). */
    val touchesAuthorisationGate: Boolean
        get() = procedureOverrides.any { override ->
            val id = override.string("procedure_id").orEmpty().uppercase()
            val action = override.string("action").orEmpty().uppercase()
            GATE_KEYWORDS.any { id.contains(it) || action.contains(it) }
        }

    private companion object {
        val GATE_KEYWORDS = listOf("PUR", "WIPE", "RESET", "ERASE")
    }
}

/** One applied patch, recorded for the report (contract §8). */
data class AppliedPatch(
    val patchId: String,
    val sha256: String,
    val keyId: String,
    val appliedAt: String,
    val rolledBackAt: String? = null,
)

enum class PatchSetMode {
    SIGNED_CURRENT,
    SIGNED_ROLLED_BACK,
    NO_PATCHES,
    ;

    /** The report spelling required by contract §8. Never blank, never inferred. */
    val wireName: String
        get() = when (this) {
            SIGNED_CURRENT -> "SIGNED-CURRENT"
            SIGNED_ROLLED_BACK -> "SIGNED-ROLLED-BACK"
            NO_PATCHES -> "NO-PATCHES"
        }
}

/**
 * The applied patch set.
 *
 * The scalar fields here are the governed §5.3 reproducibility invariant: engine version
 * plus patch-set version are recorded in **every** report. A report missing them is
 * invalid and must not be presented as final.
 *
 * An empty set is a legitimate, reportable state — an engine running with no patches is
 * not a broken engine, and must not be reported as one.
 */
data class PatchSetState(
    val version: String = "NO-PATCHES",
    val hash: String = EMPTY_SET_HASH,
    val mode: PatchSetMode = PatchSetMode.NO_PATCHES,
    val appliedPatches: List<AppliedPatch> = emptyList(),
    val rollbackReason: String? = null,
) {
    /** Scalar report fields. `applied_patches[]` is emitted by ReportGenerator. */
    fun reportFields(engineVersion: String): Map<String, String> = mapOf(
        "engine_version" to engineVersion,
        "patch_set_version" to version,
        "patch_set_hash" to hash,
        "patch_set_mode" to mode.wireName,
        "applied_patch_count" to appliedPatches.count { it.rolledBackAt == null }.toString(),
    )

    /** Applies one verified patch, regenerating the version and hash. */
    fun with(patch: VerifiedPatch, now: Instant): PatchSetState {
        val next = appliedPatches + AppliedPatch(
            patchId = patch.patchId,
            sha256 = patch.payloadSha256,
            keyId = patch.keyId,
            appliedAt = now.toString(),
        )
        return PatchSetState(
            version = nextVersion(next.size, now),
            hash = computeHash(next),
            mode = PatchSetMode.SIGNED_CURRENT,
            appliedPatches = next,
            rollbackReason = null,
        )
    }

    /**
     * Rollback keeps history: entries are marked with `rolled_back_at`, never deleted,
     * so the report can show the rollback rather than hiding it.
     *
     * Rollback is executed by a signed rollback patch or by restoring the retained
     * last-known-good **signed** set. An unsigned revert is not permitted.
     */
    fun rollback(reason: String, now: Instant): PatchSetState {
        val stamp = now.toString()
        val next = appliedPatches.map { entry ->
            if (entry.rolledBackAt == null) entry.copy(rolledBackAt = stamp) else entry
        }
        return PatchSetState(
            version = nextVersion(next.size + 1, now),
            hash = computeHash(next.filter { it.rolledBackAt == null }),
            mode = PatchSetMode.SIGNED_ROLLED_BACK,
            appliedPatches = next,
            rollbackReason = reason,
        )
    }

    companion object {
        /**
         * sha256 over the empty concatenation: the honest hash of an empty set.
         *
         * An empty set is a legitimate state, so the field carries a real digest rather
         * than a blank — a report field must never be blank (Spec §86).
         */
        val EMPTY_SET_HASH: String = sha256Hex(ByteArray(0))

        /** Monotonic `YYYY.MM.DD-<n>`, matching the format in contract §8. */
        fun nextVersion(size: Int, now: Instant): String {
            val date = now.toString().take(10).replace('-', '.')
            return "$date-$size"
        }

        /** sha256 over the sorted concatenation of the applied payload hashes. */
        fun computeHash(applied: List<AppliedPatch>): String {
            val joined = applied.map { it.sha256 }.sorted().joinToString("")
            return sha256Hex(joined.toByteArray(Charsets.UTF_8))
        }

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256")
                .digest(bytes)
                .joinToString("") { "%02x".format(it) }
    }
}

/** Outcome of verifying one envelope. */
sealed interface PatchVerificationResult {
    /** Every ordered step passed; the patch may be applied to the staged set. */
    data class Accepted(val patch: VerifiedPatch) : PatchVerificationResult

    /**
     * Verification failed. The caller MUST halt the patched operation and report
     * [reason] in honest language — and must never convert a verifier failure into a
     * verdict about the customer's device (Spec §82).
     */
    data class Rejected(
        val reason: PatchRejectReason,
        val detail: String,
    ) : PatchVerificationResult

    /**
     * The patch is valid and signed but out of scope for this device. Retained, exerts
     * no effect, and recorded as **NOT APPLICABLE** — never as a pass and never as a
     * failure (Spec §82, contract §6.7).
     */
    data class NotApplicable(
        val patchId: String,
        val payloadSha256: String,
        val reason: String,
    ) : PatchVerificationResult
}

/**
 * Engine-side verification of a signed capability patch.
 *
 * Adheres to:
 * - Governed `CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2` §5.2 (patch form), §5.3 (execute only
 *   signed patches + reproducibility), §5.6 (no runtime self-modification)
 * - `CYVRA_CAPABILITY_PATCH_SCHEMA.md` §3 (signature model), §6 (ordered fail-closed
 *   verification), §7 (rejection and rollback), §8 (report versioning fields)
 *
 * Structural expression of §5.6: this verifier is a pure function over bytes. It holds
 * no network client, writes no persistent state, and cannot mutate its own trust
 * anchors — so no patch can alter verification logic, trust anchors, or the
 * authorisation gate. The verifier itself is not patchable.
 *
 * Fail-closed by construction: [knownMatrixRows] defaults to an empty vocabulary, so an
 * unconfigured verifier rejects every patch at step 8 rather than applying rows it
 * cannot resolve.
 *
 * @param engineVersion this engine's semver; compared against `engine_min_version`.
 * @param trustAnchors compiled-in public keys keyed by `key_id`.
 * @param knownMatrixRows supplies the matrix's row ids for step 8.
 * @param clock injected so validity-window checks are deterministic under test.
 */
class PatchVerifier(
    private val engineVersion: String,
    private val trustAnchors: Map<String, TrustAnchor> = emptyMap(),
    private val knownMatrixRows: () -> Set<String> = { emptySet() },
    private val clock: () -> Instant = { Instant.now() },
) {
    /**
     * Runs contract §6's steps in order. Every step MUST pass; any failure rejects the
     * whole patch — there is no partial acceptance.
     *
     * @param ownershipAttestationPresent step 9's gate. A patch can never grant this.
     * @param device the live device for step 7. Absent → NOT APPLICABLE, because scope
     *   cannot be confirmed and applying would be a guess.
     */
    fun verify(
        envelopeBytes: ByteArray,
        ownershipAttestationPresent: Boolean = false,
        device: DeviceProfile? = null,
    ): PatchVerificationResult {
        // 1. READ — strict UTF-8, no BOM, no trailing data.
        if (hasBom(envelopeBytes)) {
            return reject(PatchRejectReason.PATCH_MALFORMED, "byte order mark present")
        }
        val text = decodeStrictUtf8(envelopeBytes)
            ?: return reject(PatchRejectReason.PATCH_MALFORMED, "input is not well-formed UTF-8")

        val root = try {
            PARSE_JSON.parseToJsonElement(text)
        } catch (e: Exception) {
            return reject(PatchRejectReason.PATCH_MALFORMED, "trailing or unparsable data: ${e.message}")
        } as? JsonObject
            ?: return reject(PatchRejectReason.PATCH_MALFORMED, "envelope is not a JSON object")

        // 2. STRUCTURE — the envelope carries only payload, signature, alg, key_id.
        val unexpected = root.keys - ENVELOPE_KEYS
        if (unexpected.isNotEmpty()) {
            return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "unknown envelope keys: $unexpected")
        }
        val payload = root["payload"] as? JsonObject
            ?: return reject(PatchRejectReason.PATCH_MALFORMED, "missing payload object")
        val signatureText = root.string("signature")
            ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "missing signature")
        val alg = root.string("alg")
            ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "missing alg")
        if (alg != ALGORITHM) {
            return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "alg must be $ALGORITHM, was '$alg'")
        }
        val keyId = root.string("key_id")
            ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "missing key_id")

        validatePayload(payload)?.let { return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, it) }

        val signatureBytes = try {
            Base64.getDecoder().decode(signatureText)
        } catch (e: IllegalArgumentException) {
            return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "signature is not base64")
        }

        // 3. KEY — resolve against the compiled trust anchor. No network fetch.
        val anchor = trustAnchors[keyId]
            ?: return reject(PatchRejectReason.PATCH_UNKNOWN_KEY, "unrecognised key_id '$keyId'")
        if (anchor.trustedForVerifyOnly) {
            return reject(
                PatchRejectReason.PATCH_UNKNOWN_KEY,
                "key '$keyId' is trusted for verify only and cannot authorise a new patch",
            )
        }
        val publicKey = decodePublicKey(anchor.publicKeyBase64)
            ?: return reject(
                PatchRejectReason.PATCH_SCHEMA_INVALID,
                "trust anchor '$keyId' is not a usable Ed25519 key",
            )

        // 4. SIGNATURE — canonical bytes of payload only; signature is never inside it.
        val canonical = canonicalize(payload).toByteArray(Charsets.UTF_8)
        val verified = try {
            val signer = Signature.getInstance(ALGORITHM)
            signer.initVerify(publicKey)
            signer.update(canonical)
            signer.verify(signatureBytes)
        } catch (e: Exception) {
            false
        }
        if (!verified) {
            return reject(PatchRejectReason.PATCH_SIGNATURE_INVALID, "ed25519 signature does not verify")
        }

        // 5. ENGINE FLOOR — no partial interpretation of a patch we are too old for.
        val minVersion = payload.string("engine_min_version")!!
        val min = SemVer.parse(minVersion)
            ?: return reject(
                PatchRejectReason.PATCH_SCHEMA_INVALID,
                "engine_min_version '$minVersion' is not semver MAJOR.MINOR.PATCH",
            )
        val self = SemVer.parse(engineVersion)
            ?: return reject(
                PatchRejectReason.PATCH_SCHEMA_INVALID,
                "engine version '$engineVersion' is not semver MAJOR.MINOR.PATCH",
            )
        if (self < min) {
            return reject(
                PatchRejectReason.PATCH_ENGINE_TOO_OLD,
                "patch requires engine >= $minVersion, engine is $engineVersion",
            )
        }

        // 6. VALIDITY WINDOW — absent means the condition does not apply.
        val now = clock()
        val validFromRaw = payload.string("valid_from")
        if (validFromRaw != null) {
            val validFrom = parseInstant(validFromRaw)
                ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "valid_from is not RFC 3339")
            if (now < validFrom) {
                return reject(PatchRejectReason.PATCH_NOT_YET_VALID, "valid_from $validFrom is in the future")
            }
        }
        val validUntilRaw = payload.string("valid_until")
        if (validUntilRaw != null) {
            val validUntil = parseInstant(validUntilRaw)
                ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "valid_until is not RFC 3339")
            if (now > validUntil) {
                return reject(PatchRejectReason.PATCH_EXPIRED, "valid_until $validUntil has passed")
            }
        }

        val patchId = payload.string("patch_id")!!
        val payloadSha = sha256Hex(canonical)

        // 7. SCOPE MATCH — a non-match is NOT APPLICABLE, not an error.
        val scope = parseOemScope(payload["oem_scope"] as? JsonObject)
            ?: return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "missing or malformed oem_scope")
        if (device == null) {
            return PatchVerificationResult.NotApplicable(
                patchId = patchId,
                payloadSha256 = payloadSha,
                reason = "no device profile supplied; oem_scope cannot be confirmed",
            )
        }
        if (!scope.matches(device.manufacturer, device.model, device.apiLevel)) {
            return PatchVerificationResult.NotApplicable(
                patchId = patchId,
                payloadSha256 = payloadSha,
                reason = "oem_scope does not match ${device.manufacturer}/${device.model}/api${device.apiLevel}",
            )
        }

        // 8. ROW RESOLUTION — unknown id rejects; no matrix means nothing resolves.
        val rows = payload.stringArray("matrix_rows")
        if (rows.isEmpty()) {
            return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "matrix_rows must contain at least one id")
        }
        val known = knownMatrixRows()
        val unknown = rows.filterNot { it in known }
        if (unknown.isNotEmpty()) {
            return reject(PatchRejectReason.PATCH_ROW_UNKNOWN, "unresolvable matrix rows: $unknown")
        }

        val overrides = when (val element = payload["procedure_overrides"]) {
            null -> emptyList()
            is JsonArray -> element.filterIsInstance<JsonObject>()
            else -> return reject(PatchRejectReason.PATCH_SCHEMA_INVALID, "procedure_overrides must be an array")
        }

        // 9. AUTHORISATION GATE — a patch can never grant authorisation.
        val candidate = VerifiedPatch(
            patchId = patchId,
            keyId = keyId,
            payload = payload,
            payloadSha256 = payloadSha,
            engineMinVersion = minVersion,
            matrixRows = rows,
            procedureOverrides = overrides,
            oemScope = scope,
        )
        if (candidate.touchesAuthorisationGate && !ownershipAttestationPresent) {
            return reject(
                PatchRejectReason.PATCH_AUTHORISATION_REQUIRED,
                "patch touches a purge path; ownership attestation required",
            )
        }

        // 10/11 — atomic staging and recording are the caller's PatchSetState transition.
        return PatchVerificationResult.Accepted(candidate)
    }

    private fun reject(reason: PatchRejectReason, detail: String) =
        PatchVerificationResult.Rejected(reason, detail)

    /** Structural validation against contract §5. Returns null when valid. */
    private fun validatePayload(payload: JsonObject): String? {
        REQUIRED_PAYLOAD_FIELDS.forEach { field ->
            val value = payload[field]
            if (value == null || value is JsonNull) return "missing required field '$field'"
        }
        if (payload.string("schema_version") != SCHEMA_VERSION) {
            return "schema_version must be '$SCHEMA_VERSION'"
        }
        val patchId = payload.string("patch_id")
            ?: return "patch_id must be a string"
        if (!PATCH_ID.matches(patchId)) {
            return "patch_id '$patchId' does not match PATCH-<scope>-<YYYYMMDD>-<seq>"
        }
        payload.stringArray("evidence_refs").let { refs ->
            if (refs.isEmpty()) return "evidence_refs must contain at least one resolvable reference"
        }
        return null
    }

    private fun parseOemScope(element: JsonObject?): OemScope? {
        if (element == null) return null
        val manufacturer = element.string("manufacturer") ?: return null
        val min = element["android_min"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
        val max = element["android_max"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
        return OemScope(
            manufacturer = manufacturer,
            models = element.stringArray("models"),
            androidMin = min,
            androidMax = max,
            skins = element.stringArray("skins"),
        )
    }

    companion object {
        const val ALGORITHM = "Ed25519"
        const val SCHEMA_VERSION = "1.0"

        private val ENVELOPE_KEYS = setOf("payload", "signature", "alg", "key_id")

        private val REQUIRED_PAYLOAD_FIELDS = listOf(
            "schema_version", "patch_id", "engine_min_version", "matrix_rows",
            "oem_scope", "evidence_refs", "created_by", "approved_by", "created_at",
        )

        private val PATCH_ID = Regex("""PATCH-[A-Za-z0-9-]+-\d{8}-\d+""")

        private val PARSE_JSON = kotlinx.serialization.json.Json { ignoreUnknownKeys = false }

        /** X.509 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key. */
        private val RAW_KEY_PREFIX = byteArrayOf(
            0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00,
        )

        internal fun hasBom(bytes: ByteArray): Boolean =
            bytes.size >= 3 &&
                bytes[0] == 0xEF.toByte() &&
                bytes[1] == 0xBB.toByte() &&
                bytes[2] == 0xBF.toByte()

        internal fun decodeStrictUtf8(bytes: ByteArray): String? = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (e: CharacterCodingException) {
            null
        }

        internal fun decodePublicKey(base64: String): PublicKey? = try {
            val decoded = Base64.getDecoder().decode(base64)
            val spki = if (decoded.size == 32) RAW_KEY_PREFIX + decoded else decoded
            KeyFactory.getInstance(ALGORITHM).generatePublic(X509EncodedKeySpec(spki))
        } catch (e: Exception) {
            null
        }

        internal fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256")
                .digest(bytes)
                .joinToString("") { "%02x".format(it) }

        /**
         * Canonicalisation per contract §3: UTF-8, object keys sorted lexicographically by
         * code point, no insignificant whitespace, strings minimal-escaped, numbers in
         * shortest round-trip form, arrays left in document order.
         *
         * This is the byte sequence that was signed — recomputed here rather than trusted
         * from the document, which is the whole point of the detached-signature design.
         */
        internal fun canonicalize(element: JsonElement): String = buildString { writeElement(element) }

        private fun StringBuilder.writeElement(element: JsonElement) {
            when (element) {
                is JsonObject -> {
                    append('{')
                    element.keys.sorted().forEachIndexed { index, key ->
                        if (index > 0) append(',')
                        writeString(key)
                        append(':')
                        writeElement(element.getValue(key))
                    }
                    append('}')
                }
                is JsonArray -> {
                    append('[')
                    element.forEachIndexed { index, child ->
                        if (index > 0) append(',')
                        writeElement(child)
                    }
                    append(']')
                }
                is JsonNull -> append("null")
                is JsonPrimitive -> if (element.isString) writeString(element.content) else append(element.content)
            }
        }

        private fun StringBuilder.writeString(value: String) {
            append('"')
            for (ch in value) {
                when {
                    ch == '"' -> append("\\\"")
                    ch == '\\' -> append("\\\\")
                    ch == '\n' -> append("\\n")
                    ch == '\r' -> append("\\r")
                    ch == '\t' -> append("\\t")
                    ch.code < 0x20 -> append("\\u%04x".format(ch.code))
                    else -> append(ch)
                }
            }
            append('"')
        }

        internal fun parseInstant(raw: String): Instant? = try {
            Instant.parse(raw)
        } catch (e: Exception) {
            null
        }
    }
}

/** Strict semver `MAJOR.MINOR.PATCH`. Pre-release/build metadata is rejected, not guessed. */
internal data class SemVer(
    val major: Int,
    val minor: Int,
    val patch: Int,
) : Comparable<SemVer> {
    override fun compareTo(other: SemVer): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch })

    companion object {
        fun parse(raw: String): SemVer? {
            if (raw.contains('-') || raw.contains('+')) return null
            val parts = raw.trim().split('.')
            if (parts.size != 3) return null
            val numbers = parts.map { it.toIntOrNull() ?: return null }
            if (numbers.any { it < 0 }) return null
            return SemVer(numbers[0], numbers[1], numbers[2])
        }
    }
}

/** Reads a string field, or null when absent or not a string. */
internal fun JsonObject.string(key: String): String? {
    val element = this[key] as? JsonPrimitive ?: return null
    return if (element.isString) element.content else null
}

/** Reads a string array field, or an empty list when absent. */
internal fun JsonObject.stringArray(key: String): List<String> {
    val element = this[key] as? JsonArray ?: return emptyList()
    return element.mapNotNull { child ->
        val primitive = child as? JsonPrimitive ?: return@mapNotNull null
        if (primitive.isString) primitive.content else null
    }
}
