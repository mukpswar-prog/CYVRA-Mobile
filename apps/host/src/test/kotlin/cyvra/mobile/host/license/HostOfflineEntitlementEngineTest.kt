package cyvra.mobile.host.license

import cyvra.mobile.core.CustomerLicenseRecord
import cyvra.mobile.core.LicenseEntitlementStatus
import cyvra.mobile.core.OperationSensitivityTier
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostOfflineEntitlementEngineTest {

    private val engine = HostOfflineEntitlementEngine(gracePeriodDurationSeconds = 86400L) // 24h

    private fun createSampleLicense(): CustomerLicenseRecord {
        return CustomerLicenseRecord(
            licenseId = "LIC-000001",
            serialNumber = "CYVRA-XXXX-001",
            customerEmail = "partner@cyvoriq.com",
            customerName = "ABC Partner",
            companyName = "ABC Tech",
            planName = "25 Device Scans",
            deviceScanEntitlement = 25,
            scansUsed = 2,
            scansRemaining = 23,
            revision = 1,
            status = LicenseEntitlementStatus.ACTIVE,
            lastVerifiedAt = Instant.now().toString(),
        )
    }

    @Test
    fun generatesAndVerifiesSignedOfflineCache() {
        val license = createSampleLicense()
        val now = Instant.now()
        val signedCache = engine.createSignedCache(license, verifiedInstant = now)

        assertEquals("LIC-000001", signedCache.licenseId)
        assertEquals(23, signedCache.scansRemainingSnapshot)
        assertTrue(engine.verifyCacheIntegrity(signedCache))
    }

    @Test
    fun detectsTamperedOfflineCacheAndRejectsIntegrity() {
        val license = createSampleLicense()
        val signedCache = engine.createSignedCache(license)

        // Attempt local tampering of remaining scan count (e.g. 23 -> 99)
        val tamperedCache = signedCache.copy(scansRemainingSnapshot = 99)
        assertFalse(engine.verifyCacheIntegrity(tamperedCache))
    }

    @Test
    fun providesGracePeriodAndAllowsOnlyNonDestructiveOperationsWhenOffline() {
        val license = createSampleLicense()
        val verifiedTime = Instant.now()
        val signedCache = engine.createSignedCache(license, verifiedInstant = verifiedTime)

        // Simulate network dropped 2 hours later
        val twoHoursLater = verifiedTime.plusSeconds(7200)
        val health = engine.evaluateHealth(
            currentLicense = license,
            cachedToken = signedCache,
            isNetworkReachable = false,
            now = twoHoursLater,
        )

        // Verifications per §15 & Part G
        assertEquals(LicenseEntitlementStatus.SERVER_UNAVAILABLE, health.status)
        assertFalse(health.isNetworkReachable)
        assertTrue(health.isGracePeriodActive)
        assertEquals(79200L, health.gracePeriodRemainingSeconds)
        assertTrue(health.userFacingMessage.contains("temporarily unavailable"))
        assertFalse(health.userFacingMessage.contains("License invalid"), "Must never report 'invalid' on network drop")

        // Allowed operations: Non-destructive diagnostic only
        assertTrue(engine.isOperationPermitted(health, OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE))
        assertFalse(engine.isOperationPermitted(health, OperationSensitivityTier.DESTRUCTIVE_DATA_PURGE))
        assertFalse(engine.isOperationPermitted(health, OperationSensitivityTier.ENTITLEMENT_EXPANSION_UPGRADE))
    }

    @Test
    fun blocksAllOperationsWhenGracePeriodExpiresOffline() {
        val license = createSampleLicense()
        val verifiedTime = Instant.now()
        val signedCache = engine.createSignedCache(license, verifiedInstant = verifiedTime)

        // 25 hours later (grace period was 24 hours)
        val expiredTime = verifiedTime.plusSeconds(90000)
        val health = engine.evaluateHealth(
            currentLicense = license,
            cachedToken = signedCache,
            isNetworkReachable = false,
            now = expiredTime,
        )

        assertFalse(health.isGracePeriodActive)
        assertEquals(0L, health.gracePeriodRemainingSeconds)
        assertTrue(health.userFacingMessage.contains("expired"))
        assertFalse(engine.isOperationPermitted(health, OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE))
    }

    @Test
    fun allowsAllOperationsWhenOnlineAndActive() {
        val license = createSampleLicense()
        val health = engine.evaluateHealth(
            currentLicense = license,
            cachedToken = null,
            isNetworkReachable = true,
        )

        assertEquals(LicenseEntitlementStatus.ACTIVE, health.status)
        assertTrue(health.isNetworkReachable)
        assertTrue(engine.isOperationPermitted(health, OperationSensitivityTier.READ_ONLY_NON_DESTRUCTIVE))
        assertTrue(engine.isOperationPermitted(health, OperationSensitivityTier.DESTRUCTIVE_DATA_PURGE))
        assertTrue(engine.isOperationPermitted(health, OperationSensitivityTier.ENTITLEMENT_EXPANSION_UPGRADE))
    }
}
