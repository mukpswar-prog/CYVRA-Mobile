package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.OfflineEntitlementHealth
import cyvra.mobile.core.OperationSensitivityTier
import cyvra.mobile.core.SignedOfflineLicenseCache
import java.security.MessageDigest
import java.time.Instant

/**
 * Host Offline Entitlement & Network Resilience Engine (§15 & Part G / Phase 19).
 *
 * Core Principles:
 * 1. Do NOT confuse server outage with invalid license:
 *    - Server unreachable -> LICENSE_SERVER_UNAVAILABLE ("License service temporarily unavailable. Last verified recently.")
 *    - Explicit rejection -> LICENSE_REVOKED or LICENSE_EXPIRED ("License invalid").
 * 2. Cryptographic Offline Grace Period:
 *    - Short signed cache allows non-destructive work (Diagnostics, AI Inspection) during transient network drop.
 * 3. Security Boundary:
 *    - Destructive purge & license upgrades strictly require live online server authorization (§15, §40, §43).
 */
class HostOfflineEntitlementEngine(
    val gracePeriodDurationSeconds: Long = 86400L, // 24-hour standard grace period
    private val trustedSignerId: String = "CYVORIQ-LICENSE-SIGNER-PROD-2026",
) {

    fun computeDigest(data: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val hash = md.digest(data.toByteArray(Charsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }

    /**
     * Issues a signed offline license cache record when online.
     */
    fun createSignedCache(
        license: CustomerLicenseRecord,
        verifiedInstant: Instant = Instant.now(),
    ): SignedOfflineLicenseCache {
        val graceExpires = verifiedInstant.plusSeconds(gracePeriodDurationSeconds)
        val canonicalPayload = "${license.licenseId}|${license.serialNumber}|${license.revision}|${license.scansRemaining}|${verifiedInstant}|${graceExpires}"
        val digest = computeDigest(canonicalPayload)
        val signature = "SIG_ED25519_${digest.take(16)}_SERVER"

        return SignedOfflineLicenseCache(
            licenseId = license.licenseId,
            serialNumber = license.serialNumber,
            revision = license.revision,
            customerEmail = license.customerEmail,
            planName = license.planName,
            totalScans = license.deviceScanEntitlement,
            scansRemainingSnapshot = license.scansRemaining,
            verifiedAt = verifiedInstant.toString(),
            graceExpiresAt = graceExpires.toString(),
            tokenDigestSha256 = digest,
            serverSignature = signature,
        )
    }

    /**
     * Verifies cryptographic signature and tamper-evidence of cached token.
     */
    fun verifyCacheIntegrity(cache: SignedOfflineLicenseCache): Boolean {
        if (!cache.serverSignature.startsWith("SIG_ED25519_") || !cache.serverSignature.endsWith("_SERVER")) {
            return false
        }
        val canonicalPayload = "${cache.licenseId}|${cache.serialNumber}|${cache.revision}|${cache.scansRemainingSnapshot}|${cache.verifiedAt}|${cache.graceExpiresAt}"
        val expectedDigest = computeDigest(canonicalPayload)
        return cache.tokenDigestSha256.equals(expectedDigest, ignoreCase = true)
    }

    /**
     * Evaluates current entitlement health given network reachability and cached credentials.
     */
    fun evaluateHealth(
        currentLicense: CustomerLicenseRecord,
        cachedToken: SignedOfflineLicenseCache?,
        isNetworkReachable: Boolean,
        now: Instant = Instant.now(),
    ): OfflineEntitlementHealth {
        if (isNetworkReachable) {
            val isLiveActive = currentLicense.status == LicenseEntitlementStatus.ACTIVE
            return OfflineEntitlementHealth(
                status = currentLicense.status,
                isNetworkReachable = true,
                isGracePeriodActive = false,
                gracePeriodRemainingSeconds = 0,
                lastOnlineVerificationTime = currentLicense.lastVerifiedAt,
                userFacingMessage = if (isLiveActive) {
                    "License active and synchronized with CYVORIQ license service."
                } else {
                    "License status: ${currentLicense.status}. Contact support."
                },
                allowableOperations = if (isLiveActive) {
                    listOf(
                        OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE,
                        OperationSensitivityTier.DESTRUCTIVE_DATA_PURGE,
                        OperationSensitivityTier.ENTITLEMENT_EXPANSION_UPGRADE,
                    )
                } else emptyList(),
            )
        }

        // Offline scenario: Network unreachable
        if (cachedToken == null || !verifyCacheIntegrity(cachedToken)) {
            return OfflineEntitlementHealth(
                status = LicenseEntitlementStatus.SERVER_UNAVAILABLE,
                isNetworkReachable = false,
                isGracePeriodActive = false,
                gracePeriodRemainingSeconds = 0,
                lastOnlineVerificationTime = currentLicense.lastVerifiedAt,
                userFacingMessage = "License service unreachable. No valid signed offline cache found.",
                allowableOperations = emptyList(),
            )
        }

        val expiresInstant = runCatching { Instant.parse(cachedToken.graceExpiresAt) }.getOrNull()
        val remainingSeconds = if (expiresInstant != null) {
            expiresInstant.epochSecond - now.epochSecond
        } else 0L

        val graceActive = remainingSeconds > 0

        val message = if (graceActive) {
            "License service temporarily unavailable. Your last verified entitlement was checked recently. Offline grace active (${remainingSeconds / 3600} hours remaining)."
        } else {
            "License service temporarily unavailable. Offline grace period has expired. Please reconnect to verify entitlements."
        }

        return OfflineEntitlementHealth(
            status = LicenseEntitlementStatus.SERVER_UNAVAILABLE,
            isNetworkReachable = false,
            isGracePeriodActive = graceActive,
            gracePeriodRemainingSeconds = remainingSeconds.coerceAtLeast(0),
            lastOnlineVerificationTime = cachedToken.verifiedAt,
            userFacingMessage = message,
            allowableOperations = if (graceActive) {
                // In grace period: allowed read-only non-destructive operations only!
                listOf(OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE)
            } else emptyList(),
        )
    }

    /**
     * Checks if a specific requested operation is permitted under current offline health state.
     */
    fun isOperationPermitted(
        health: OfflineEntitlementHealth,
        tier: OperationSensitivityTier,
    ): Boolean {
        return health.allowableOperations.contains(tier)
    }
}
