package cyvra.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EvidenceModelsTest {

    @Test
    fun evidenceStatusHonestyValues() {
        assertEquals(7, EvidenceStatus.entries.size)
        assertTrue(EvidenceStatus.entries.contains(EvidenceStatus.AVAILABLE))
        assertTrue(EvidenceStatus.entries.contains(EvidenceStatus.RESTRICTED))
        assertTrue(EvidenceStatus.entries.contains(EvidenceStatus.PERMISSION_REQUIRED))
        assertTrue(EvidenceStatus.entries.contains(EvidenceStatus.UNSUPPORTED_API))
    }

    @Test
    fun defaultOemResolverReturnsUnsupportedUntilVerifiedHardwareExists() {
        val resolver = DefaultOemCapabilityResolver()
        assertFalse(resolver.isSupportedOem("samsung"))
        assertFalse(resolver.isSupportedOem("xiaomi"))
        assertNull(resolver.resolveAdapter("samsung", "SM-A525F"))
    }

    @Test
    fun identityEvidenceMaintainsHonestyInvariants() {
        val identity = DeviceIdentityEvidence(
            manufacturer = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            brand = EvidenceFieldResult("samsung", EvidenceStatus.AVAILABLE, "ADB"),
            model = EvidenceFieldResult("SM-A525F", EvidenceStatus.AVAILABLE, "ADB"),
            device = EvidenceFieldResult("a52", EvidenceStatus.AVAILABLE, "ADB"),
            product = EvidenceFieldResult("a52", EvidenceStatus.AVAILABLE, "ADB"),
            buildId = EvidenceFieldResult("TP1A.220624.014", EvidenceStatus.AVAILABLE, "ADB"),
            androidVersion = EvidenceFieldResult("13", EvidenceStatus.AVAILABLE, "ADB"),
            apiLevel = EvidenceFieldResult(33, EvidenceStatus.AVAILABLE, "ADB"),
            securityPatch = EvidenceFieldResult("2023-08-01", EvidenceStatus.AVAILABLE, "ADB"),
            platformIdentifier = EvidenceFieldResult("android-id-test", EvidenceStatus.AVAILABLE, "ADB"),
            hardwareSerial = DeviceIdentifierRecord(
                identifierType = "HARDWARE_SERIAL",
                value = null,
                source = "ADB",
                scope = "DEVICE",
                availability = EvidenceStatus.RESTRICTED,
                reason = "Hardware serial restricted",
            ),
            imei = DeviceIdentifierRecord(
                identifierType = "IMEI",
                value = null,
                source = "ADB",
                scope = "DEVICE",
                availability = EvidenceStatus.RESTRICTED,
                reason = "IMEI restricted without privileged carrier access",
            ),
        )

        assertEquals("samsung", identity.manufacturer.value)
        assertEquals(EvidenceStatus.AVAILABLE, identity.manufacturer.status)
        assertNull(identity.imei.value)
        assertEquals(EvidenceStatus.RESTRICTED, identity.imei.availability)
        assertNull(identity.hardwareSerial.value)
        assertEquals(EvidenceStatus.RESTRICTED, identity.hardwareSerial.availability)
    }

    @Test
    fun genericDeviceEvidenceSerializesAndIntegrates() {
        val generic = GenericDeviceEvidence(
            sessionUuid = "test-session-uuid",
            collectedAt = "2026-09-14T15:00:00Z",
            identity = DeviceIdentityEvidence(
                manufacturer = EvidenceFieldResult("Google", EvidenceStatus.AVAILABLE, "ADB"),
                brand = EvidenceFieldResult("google", EvidenceStatus.AVAILABLE, "ADB"),
                model = EvidenceFieldResult("Pixel 7", EvidenceStatus.AVAILABLE, "ADB"),
                device = EvidenceFieldResult("panther", EvidenceStatus.AVAILABLE, "ADB"),
                product = EvidenceFieldResult("panther", EvidenceStatus.AVAILABLE, "ADB"),
                buildId = EvidenceFieldResult("TQ3A.230901.001", EvidenceStatus.AVAILABLE, "ADB"),
                androidVersion = EvidenceFieldResult("14", EvidenceStatus.AVAILABLE, "ADB"),
                apiLevel = EvidenceFieldResult(34, EvidenceStatus.AVAILABLE, "ADB"),
                securityPatch = EvidenceFieldResult("2023-09-01", EvidenceStatus.AVAILABLE, "ADB"),
                platformIdentifier = EvidenceFieldResult("pixel-id", EvidenceStatus.AVAILABLE, "ADB"),
                hardwareSerial = DeviceIdentifierRecord("HARDWARE_SERIAL", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED),
                imei = DeviceIdentifierRecord("IMEI", null, "ADB", "DEVICE", EvidenceStatus.RESTRICTED),
            ),
            battery = BatteryEvidence(
                levelPercent = EvidenceFieldResult(85, EvidenceStatus.AVAILABLE, "ADB"),
                isCharging = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                health = EvidenceFieldResult("GOOD", EvidenceStatus.AVAILABLE, "ADB"),
                stateOfHealthSoh = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB", "Restricted SOH"),
            ),
            storage = StorageEvidence(
                internalTotalBytes = EvidenceFieldResult(128_000_000_000L, EvidenceStatus.AVAILABLE, "ADB"),
                internalAvailableBytes = EvidenceFieldResult(64_000_000_000L, EvidenceStatus.AVAILABLE, "ADB"),
                externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            ),
            security = SecurityEvidence(
                screenLockPresent = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
                adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
                knoxClaim = EvidenceFieldResult(null, EvidenceStatus.RESTRICTED, "ADB", "Not enterprise licensed"),
            ),
        )

        assertNotNull(generic.sessionUuid)
        assertEquals("Google", generic.identity.manufacturer.value)
        assertEquals(85, generic.battery.levelPercent.value)
        assertTrue(generic.storage.scopedStorageEnforced.value ?: false)
        assertTrue(generic.security.screenLockPresent.value ?: false)
        assertNull(generic.security.knoxClaim.value)
    }
}
