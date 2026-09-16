package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OfflineEntitlementModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesSignedOfflineLicenseCache() {
        val cache = SignedOfflineLicenseCache(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA16092026SA3F1-1-25",
            revision = 1,
            customerEmail = "partner@cyvoriq.com",
            planName = "25 Device Scans",
            totalScans = 25,
            scansRemainingSnapshot = 23,
            verifiedAt = "2026-09-16T10:00:00Z",
            graceExpiresAt = "2026-09-17T10:00:00Z",
            tokenDigestSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            serverSignature = "SIG_ED25519_abcdef0123_SERVER",
        )

        val encoded = json.encodeToString(cache)
        val decoded = json.decodeFromString<SignedOfflineLicenseCache>(encoded)

        assertEquals("LIC-000001", decoded.licenseId)
        assertEquals(23, decoded.scansRemainingSnapshot)
        assertTrue(decoded.serverSignature.startsWith("SIG_ED25519_"))
    }

    @Test
    fun serializesAndDeserializesOfflineEntitlementHealth() {
        val health = OfflineEntitlementHealth(
            status = LicenseEntitlementStatus.SERVER_UNAVAILABLE,
            isNetworkReachable = false,
            isGracePeriodActive = true,
            gracePeriodRemainingSeconds = 72000L,
            lastOnlineVerificationTime = "2026-09-16T10:00:00Z",
            userFacingMessage = "License service temporarily unavailable. Offline grace active.",
            allowableOperations = listOf(OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE),
        )

        val encoded = json.encodeToString(health)
        val decoded = json.decodeFromString<OfflineEntitlementHealth>(encoded)

        assertEquals(LicenseEntitlementStatus.SERVER_UNAVAILABLE, decoded.status)
        assertTrue(decoded.isGracePeriodActive)
        assertEquals(1, decoded.allowableOperations.size)
        assertEquals(OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE, decoded.allowableOperations[0])
    }
}
