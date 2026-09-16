package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Operational offline permission boundaries per Master Workflow §15 & Part G.
 * Non-destructive diagnostics/inspections can run under valid offline grace period.
 * Destructive purge and license updates strictly require online server authority.
 */
@Serializable
enum class OperationSensitivityTier {
    READ_ONLY_NON_DESTRUCTIVE,       // Diagnostics, AI Screen/Body Inspection: Allowed offline in grace period
    DESTRUCTIVE_DATA_PURGE,          // Data Purge: Strictly requires online verification
    ENTITLEMENT_EXPANSION_UPGRADE,   // Upgrades: Strictly requires online server verification
}

/**
 * Detailed offline health and policy state.
 */
@Serializable
data class OfflineEntitlementHealth(
    val status: LicenseEntitlementStatus,
    val isNetworkReachable: Boolean,
    val isGracePeriodActive: Boolean,
    val gracePeriodRemainingSeconds: Long,
    val lastOnlineVerificationTime: String,
    val userFacingMessage: String,
    val allowableOperations: List<OperationSensitivityTier> = emptyList(),
)

/**
 * Cryptographically signed offline license token cached on the Windows workstation.
 * Guarantees tamper-evidence: modifying scan counts or expiration dates locally
 * invalidates the token signature (§15, §43).
 */
@Serializable
data class SignedOfflineLicenseCache(
    val licenseId: String,
    val serialNumber: String,
    val revision: Int,
    val customerEmail: String,
    val planName: String,
    val totalScans: Int,
    val scansRemainingSnapshot: Int,
    val verifiedAt: String,
    val graceExpiresAt: String,
    val tokenDigestSha256: String,
    val serverSignature: String,
    val signingAlgorithm: String = "Ed25519",
)
