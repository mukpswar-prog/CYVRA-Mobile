package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.host.transport.AdbBinaryLocator
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * Why a licence file did (or did not) yield an entitlement.
 *
 * This is deliberately separate from [LicenseEntitlementStatus]: the record's status
 * describes the entitlement itself, while the reason describes whether the workstation
 * was able to establish one at all.
 */
enum class LicenseFileReason {
    /** The file was read and every mandatory field and invariant held. */
    LOADED,

    /** `cyvra.home` is unset or blank, so the licence directory is unknown. */
    HOME_PROPERTY_MISSING,

    /** `<cyvra.home>/license.json` does not exist. */
    FILE_MISSING,

    /** The path exists but could not be read as a file (directory, permissions, IO error). */
    UNREADABLE,

    /** The content is not a structurally complete, internally consistent record. */
    INVALID,

    /**
     * The document is well-formed but the server signature does not verify
     * against the bundled public key: edited, truncated, or signed by another key.
     */
    SIGNATURE_INVALID,

    /**
     * The snapshot verifies but the licence is past `validUntil` plus its grace
     * limit, so the cached entitlement may no longer be relied on.
     */
    EXPIRED,
}

/**
 * Outcome of a licence load.
 *
 * Always carries a usable record so the Host can boot; only [reason] tells the caller
 * whether that record actually entitles anyone to scan.
 */
data class LicenseFileResult(
    val record: CustomerLicenseRecord,
    val reason: LicenseFileReason,
    val sourcePath: String?,
    /**
     * Server-authoritative permissions that apply while the entitlement is being
     * served from a cached snapshot. Read out of the signed snapshot by
     * [SignedEntitlementProvider]; the `license.json` test/dev seam has no
     * snapshot, so it keeps the unrestricted default.
     */
    val offline: OfflinePermissions = OfflinePermissions.UNRESTRICTED,
    /**
     * How long past `validUntil` the snapshot may still be relied on, in seconds.
     * Zero means the server granted no grace at all.
     */
    val graceLimitSeconds: Long = 0L,
    /**
     * True when this answer rests on a cached snapshot rather than on a live
     * server round-trip. Used for provenance: offline data must never be
     * presented to an operator as if it had just been confirmed.
     */
    val cached: Boolean = false,
) {
    /** True only when a file was read and validated. Anything else is fail-closed. */
    val isLicensed: Boolean
        get() = reason == LicenseFileReason.LOADED
}

/**
 * Production licence source for the workstation installation (P2).
 *
 * Reads `<cyvra.home>/license.json`, where `cyvra.home` is the installation root the
 * workstation already passes to the JVM as `-Dcyvra.home=` (the same constant ADB
 * resolution uses, so the two can never drift apart).
 *
 * Fail-closed by construction: [load] never throws and always returns a record, so a
 * missing, unreadable or corrupt file degrades to a denied entitlement instead of
 * preventing startup. Callers must branch on [LicenseFileResult.reason] rather than on
 * the record alone, because the denied record reports `scansRemaining = 0` and would
 * otherwise surface the misleading message "no remaining scan entitlements" to an
 * operator who simply has no licence file installed yet.
 */
class FileBasedLicenseProvider(
    private val homeProvider: () -> String? = {
        System.getProperty(AdbBinaryLocator.INSTALLATION_ROOT_PROPERTY)
    },
) : LicenseProvider {

    private val json = Json {
        /*
         * The file is written by the CYVRA API. A future optional field must not deny
         * a paying customer, so unknown keys are tolerated; the mandatory fields and
         * invariants checked below still make an incomplete document fail closed.
         */
        ignoreUnknownKeys = true
    }

    override fun load(): LicenseFileResult {
        val home = homeProvider()?.takeIf { it.isNotBlank() }
            ?: return denied(reason = LicenseFileReason.HOME_PROPERTY_MISSING, sourcePath = null)

        val file = File(home, LICENSE_FILE_NAME)
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

        val record = decodeAndValidate(stripLeadingBom(raw))
            ?: return denied(reason = LicenseFileReason.INVALID, sourcePath = path)

        return LicenseFileResult(
            record = record,
            reason = LicenseFileReason.LOADED,
            sourcePath = path,
        )
    }

    /**
     * Windows writers (PowerShell, Notepad, .NET) emit a UTF-8 byte order mark, which
     * RFC 8259 allows readers to ignore. Without this, a perfectly valid licence saved
     * by Windows tooling would fail JSON parsing and be falsely denied.
     */
    private fun stripLeadingBom(raw: String): String =
        if (raw.isNotEmpty() && raw[0] == '\uFEFF') raw.substring(1) else raw

    private fun decodeAndValidate(raw: String): CustomerLicenseRecord? {
        val element = try {
            json.parseToJsonElement(raw)
        } catch (error: Exception) {
            return null
        }

        val obj = element as? JsonObject ?: return null

        /*
         * Require exactly the model's no-default fields. Any conforming encoder emits
         * them regardless of `encodeDefaults`, so this rejects an incomplete document
         * without ever rejecting a legitimately written one.
         */
        if (MANDATORY_KEYS.any { it !in obj }) {
            return null
        }

        val record = try {
            json.decodeFromString(CustomerLicenseRecord.serializer(), raw)
        } catch (error: Exception) {
            return null
        }

        return if (holdsInvariants(record)) record else null
    }

    /**
     * Post-decode sanity checks. The arithmetic in `HostLicenseService` can only ever
     * produce these ranges, so a file violating them is malformed rather than merely
     * unusual, and must not be granted an entitlement.
     */
    private fun holdsInvariants(record: CustomerLicenseRecord): Boolean =
        record.licenseId.isNotBlank() &&
            record.serialNumber.isNotBlank() &&
            record.customerEmail.isNotBlank() &&
            record.planName.isNotBlank() &&
            record.deviceScanEntitlement >= 0 &&
            record.scansUsed >= 0 &&
            record.scansRemaining >= 0 &&
            record.scansRemaining <= record.deviceScanEntitlement

    /**
     * The denied entitlement. It is valid enough to hand to `HostLicenseService` and to
     * boot the Host with, and worthless enough that no scan can ever be committed.
     *
     * `status` is [LicenseEntitlementStatus.UNKNOWN] rather than a fabricated `ACTIVE`:
     * the truth is that the workstation could not establish a licence state.
     * `lastVerifiedAt` is empty because no verification took place - the model's
     * `Instant.now()` default would falsely imply the licence had just been checked.
     */
    private fun denied(reason: LicenseFileReason, sourcePath: String?): LicenseFileResult =
        LicenseFileResult(
            record = CustomerLicenseRecord(
                licenseId = UNLICENSED_LICENSE_ID,
                serialNumber = "",
                customerEmail = "",
                planName = UNLICENSED_PLAN_NAME,
                deviceScanEntitlement = 0,
                scansUsed = 0,
                scansRemaining = 0,
                status = LicenseEntitlementStatus.UNKNOWN,
                lastVerifiedAt = "",
            ),
            reason = reason,
            sourcePath = sourcePath,
        )

    companion object {
        const val LICENSE_FILE_NAME: String = "license.json"
        const val UNLICENSED_LICENSE_ID: String = "UNLICENSED"
        const val UNLICENSED_PLAN_NAME: String = "No licence installed"

        private val MANDATORY_KEYS = listOf(
            "licenseId",
            "serialNumber",
            "customerEmail",
            "planName",
            "deviceScanEntitlement",
            "scansUsed",
            "scansRemaining",
        )
    }
}
