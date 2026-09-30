package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.transport.AdbBinaryLocator
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Production licence source for an activated workstation.
 *
 * Reads `<cyvra.home>/entitlement.json`, the server-signed snapshot the Rust
 * layer exports at Host spawn and again whenever the entitlement changes, and
 * proves three things before it grants anything:
 *
 *  1. the document is structurally complete;
 *  2. the Ed25519 signature over the payload verifies against the server public
 *     key bundled with the Host, so an edited, truncated or foreign-signed
 *     snapshot is refused;
 *  3. the licence is inside `validUntil` plus the grace limit the server itself
 *     put in the snapshot.
 *
 * Fail-closed by construction: [load] never throws. Every defect - missing
 * home, missing file, unreadable file, bad JSON, wrong schema, bad Base64,
 * bad signature, missing field, broken invariant, past grace - degrades to a
 * denied [LicenseFileResult] with a reason that says exactly what failed, so
 * `GET_LICENSE_STATE` can report the truth instead of an invented entitlement.
 *
 * The signature covers `payload` as an opaque **string**: the exact UTF-8 bytes
 * the server signed. Storing it verbatim is deliberate. Re-serializing the
 * payload on either side would require a canonical JSON scheme, and any
 * mismatch between two independent serializers would deny a paying customer
 * over whitespace. With the signed text stored as-is there is nothing to
 * canonicalize, and any edit - to the payload or to the text itself - fails
 * verification rather than passing with different bytes.
 */
class SignedEntitlementProvider(
    private val homeProvider: () -> String? = {
        System.getProperty(AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY)
    },
    /**
     * The bundled server public key. Injectable so a test can sign fixtures with
     * its own throwaway keypair; production never substitutes it.
     */
    private val publicKeyProvider: () -> PublicKey = { serverPublicKey() },
    private val nowProvider: () -> Instant = Instant::now,
) : LicenseProvider {

    private val json = Json {
        /* A future optional field must not deny a paying customer. */
        ignoreUnknownKeys = true
    }

    override fun load(): LicenseFileResult {
        val home = homeProvider()?.takeIf { it.isNotBlank() }
            ?: return denied(reason = LicenseFileReason.HOME_PROPERTY_MISSING, sourcePath = null)

        val file = File(home, ENTITLEMENT_FILE_NAME)
        val path = file.absolutePath

        val raw = try {
            if (!file.exists()) {
                return denied(reason = LicenseFileReason.FILE_MISSING, sourcePath = path)
            }
            if (!file.isFile) {
                return denied(reason = LicenseFileReason.UNREADABLE, sourcePath = path)
            }
            file.readText()
        } catch (error: Exception) {
            return denied(reason = LicenseFileReason.UNREADABLE, sourcePath = path)
        }

        return verify(raw = stripLeadingBom(raw), sourcePath = path)
    }

    private fun verify(raw: String, sourcePath: String): LicenseFileResult {
        val envelope = json.parseToJsonElementOrNull(raw) as? JsonObject
            ?: return denied(LicenseFileReason.INVALID, sourcePath)

        if ((envelope[KEY_SCHEMA] as? JsonPrimitive)?.contentOrNull != SCHEMA) {
            return denied(LicenseFileReason.INVALID, sourcePath)
        }

        val payloadText = (envelope[KEY_PAYLOAD] as? JsonPrimitive)?.contentOrNull
            ?: return denied(LicenseFileReason.INVALID, sourcePath)
        val signatureText = (envelope[KEY_SIGNATURE] as? JsonPrimitive)?.contentOrNull
            ?: return denied(LicenseFileReason.INVALID, sourcePath)

        if (!verifies(payloadText = payloadText, signatureText = signatureText)) {
            return denied(LicenseFileReason.SIGNATURE_INVALID, sourcePath)
        }

        val payload = json.parseToJsonElementOrNull(payloadText) as? JsonObject
            ?: return denied(LicenseFileReason.INVALID, sourcePath)

        val record = recordOf(payload) ?: return denied(LicenseFileReason.INVALID, sourcePath)
        val offline = offlinePermissionsOf(payload)
            ?: return denied(LicenseFileReason.INVALID, sourcePath)

        val validUntil = instantOf(payload, KEY_VALID_UNTIL)
            ?: return denied(LicenseFileReason.INVALID, sourcePath)
        val serverTime = instantOf(payload, KEY_SERVER_TIME)
            ?: return denied(LicenseFileReason.INVALID, sourcePath)
        val grace = (payload[KEY_GRACE_LIMIT_SECONDS] as? JsonPrimitive)?.longOrNull
            ?: return denied(LicenseFileReason.INVALID, sourcePath)
        if (grace < 0L) return denied(LicenseFileReason.INVALID, sourcePath)
        // A licence already expired when the server signed it is not a licence.
        if (validUntil.isBefore(serverTime)) return denied(LicenseFileReason.EXPIRED, sourcePath)

        val now = nowProvider()
        if (now.isAfter(validUntil.plusSeconds(grace))) {
            return denied(LicenseFileReason.EXPIRED, sourcePath)
        }

        return LicenseFileResult(
            record = record,
            reason = LicenseFileReason.LOADED,
            sourcePath = sourcePath,
            offline = offline,
            graceLimitSeconds = grace,
            cached = true,
        )
    }

    private fun verifies(payloadText: String, signatureText: String): Boolean = try {
        val bytes = Base64.getDecoder().decode(signatureText)
        val verifier = Signature.getInstance(SIGNATURE_ALGORITHM)
        verifier.initVerify(publicKeyProvider())
        verifier.update(payloadText.toByteArray(StandardCharsets.UTF_8))
        verifier.verify(bytes)
    } catch (error: Exception) {
        // Any defect here - unknown algorithm, unusable key, malformed Base64 -
        // is a failed verification, never a passed one.
        false
    }

    private fun recordOf(payload: JsonObject): CustomerLicenseRecord? {
        val licenseId = text(payload, KEY_LICENSE_ID)?.takeIf { it.isNotBlank() } ?: return null
        val serialNumber = text(payload, KEY_SERIAL_NUMBER)?.takeIf { it.isNotBlank() } ?: return null
        val customerEmail = text(payload, KEY_CUSTOMER_EMAIL)?.takeIf { it.isNotBlank() } ?: return null
        val planName = text(payload, KEY_PLAN_NAME)?.takeIf { it.isNotBlank() } ?: return null
        val status = text(payload, KEY_STATUS)?.let { name ->
            LicenseEntitlementStatus.entries.firstOrNull { it.name == name }
        } ?: return null

        val deviceScanEntitlement = int(payload, KEY_DEVICE_SCAN_ENTITLEMENT) ?: return null
        val scansUsed = int(payload, KEY_SCANS_USED) ?: return null
        val scansRemaining = int(payload, KEY_SCANS_REMAINING) ?: return null

        if (deviceScanEntitlement < 0 || scansUsed < 0 || scansRemaining < 0 ||
            scansRemaining > deviceScanEntitlement
        ) {
            return null
        }

        return CustomerLicenseRecord(
            licenseId = licenseId,
            serialNumber = serialNumber,
            customerEmail = customerEmail,
            customerName = text(payload, KEY_CUSTOMER_NAME),
            companyName = text(payload, KEY_COMPANY_NAME),
            planName = planName,
            deviceScanEntitlement = deviceScanEntitlement,
            scansUsed = scansUsed,
            scansRemaining = scansRemaining,
            revision = int(payload, KEY_REVISION) ?: 1,
            status = status,
            validFrom = text(payload, KEY_VALID_FROM),
            validUntil = text(payload, KEY_VALID_UNTIL),
            lastVerifiedAt = text(payload, KEY_SERVER_TIME) ?: "",
        )
    }

    private fun offlinePermissionsOf(payload: JsonObject): OfflinePermissions? {
        val node = payload[KEY_OFFLINE] as? JsonObject ?: return null
        val diagnostics = bool(node, KEY_DIAGNOSTICS) ?: return null
        val sanitizeExecute = bool(node, KEY_SANITIZE_EXECUTE) ?: return null
        val upgrade = bool(node, KEY_UPGRADE) ?: return null
        return OfflinePermissions(
            diagnostics = diagnostics,
            sanitizeExecute = sanitizeExecute,
            upgrade = upgrade,
        )
    }

    private fun stripLeadingBom(raw: String): String =
        if (raw.isNotEmpty() && raw[0] == '\uFEFF') raw.substring(1) else raw

    private fun text(node: JsonObject, key: String): String? =
        (node[key] as? JsonPrimitive)?.contentOrNull

    private fun int(node: JsonObject, key: String): Int? =
        (node[key] as? JsonPrimitive)?.intOrNull

    private fun bool(node: JsonObject, key: String): Boolean? =
        (node[key] as? JsonPrimitive)?.booleanOrNull

    private fun instantOf(node: JsonObject, key: String): Instant? = try {
        text(node, key)?.let(Instant::parse)
    } catch (error: Exception) {
        null
    }

    private fun Json.parseToJsonElementOrNull(raw: String) = try {
        parseToJsonElement(raw)
    } catch (error: Exception) {
        null
    }

    /**
     * The denied entitlement: a record the Host can boot on and an entitlement
     * nobody can spend. `status` is [LicenseEntitlementStatus.UNKNOWN] rather
     * than a fabricated `ACTIVE`, and `lastVerifiedAt` is empty because no
     * verification took place.
     */
    private fun denied(reason: LicenseFileReason, sourcePath: String?): LicenseFileResult =
        LicenseFileResult(
            record = CustomerLicenseRecord(
                licenseId = FileBasedLicenseProvider.UNLICENSED_LICENSE_ID,
                serialNumber = "",
                customerEmail = "",
                planName = FileBasedLicenseProvider.UNLICENSED_PLAN_NAME,
                deviceScanEntitlement = 0,
                scansUsed = 0,
                scansRemaining = 0,
                status = LicenseEntitlementStatus.UNKNOWN,
                lastVerifiedAt = "",
            ),
            reason = reason,
            sourcePath = sourcePath,
            offline = OfflinePermissions.NONE,
            graceLimitSeconds = 0L,
            cached = false,
        )

    companion object {
        const val ENTITLEMENT_FILE_NAME: String = "entitlement.json"
        const val SCHEMA: String = "cyvra.entitlement.v1"
        const val SIGNATURE_ALGORITHM: String = "Ed25519"

        /**
         * The server public key, SPKI/DER, Base64.
         *
         * Only the public half was ever materialized; no private key for it
         * exists in this repository, in this workstation's history, or anywhere
         * else, so nothing running on the client can mint a signature that this
         * provider will accept. The private half lives with the CYVORIQ server.
         *
         * Replaced together with the real activation endpoint when the cloud
         * control plane is wired in.
         */
        const val SERVER_PUBLIC_KEY_B64: String =
            "MCowBQYDK2VwAyEAnfVRu1V0YzDkz9zC1lymY5Tz6TvOE9Lnizs89cbv6Tc="

        private const val KEY_SCHEMA = "schema"
        private const val KEY_PAYLOAD = "payload"
        private const val KEY_SIGNATURE = "signature"

        private const val KEY_LICENSE_ID = "licenseId"
        private const val KEY_SERIAL_NUMBER = "serialNumber"
        private const val KEY_CUSTOMER_EMAIL = "customerEmail"
        private const val KEY_CUSTOMER_NAME = "customerName"
        private const val KEY_COMPANY_NAME = "companyName"
        private const val KEY_PLAN_NAME = "planName"
        private const val KEY_DEVICE_SCAN_ENTITLEMENT = "deviceScanEntitlement"
        private const val KEY_SCANS_USED = "scansUsed"
        private const val KEY_SCANS_REMAINING = "scansRemaining"
        private const val KEY_REVISION = "revision"
        private const val KEY_STATUS = "status"
        private const val KEY_VALID_FROM = "validFrom"
        private const val KEY_VALID_UNTIL = "validUntil"
        private const val KEY_SERVER_TIME = "serverTime"
        private const val KEY_GRACE_LIMIT_SECONDS = "graceLimitSeconds"
        private const val KEY_OFFLINE = "offline"
        private const val KEY_DIAGNOSTICS = "diagnostics"
        private const val KEY_SANITIZE_EXECUTE = "sanitizeExecute"
        private const val KEY_UPGRADE = "upgrade"

        private val decodedPublicKey: PublicKey by lazy {
            KeyFactory.getInstance(SIGNATURE_ALGORITHM)
                .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(SERVER_PUBLIC_KEY_B64)))
        }

        /** The bundled key, decoded once. Never returns null: a broken key is a boot failure. */
        fun serverPublicKey(): PublicKey = decodedPublicKey
    }
}
