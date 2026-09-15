package cyvra.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CapabilityAssessmentEngineTest {

    @Test
    fun assessesStandardConsumerDeviceHonestyInvariants() {
        val engine = StandardCapabilityAssessmentEngine()

        val profile = CapabilityProfile(
            manufacturer = "Samsung",
            brand = "samsung",
            model = "SM-S918B",
            product = "dm3q",
            device = "dm3q",
            fingerprint = "samsung/dm3q/dm3q:14/UP1A.231005.007/S918BXXU3BWJM:user/release-keys",
            androidRelease = "14",
            sdkInt = 34,
            accessLevel = "L2_HOST_ADB",
            usbState = "USB_CONNECTED_DATA",
            adbState = "ADB_AUTHORIZED",
        )

        val assessment = engine.assess(profile, null)

        assertEquals("Samsung", assessment.manufacturer)
        assertEquals("SM-S918B", assessment.model)
        assertEquals(34, assessment.apiLevel)
        assertFalse(assessment.isOemAdapterAvailable)
        assertNull(assessment.resolvedOemAdapter)
        assertTrue(assessment.isPostPurgeVerificationRequired)
        assertEquals("PLATFORM_FACTORY_RESET", assessment.recommendedPurgeAction)

        // Verify Device Owner wipe is NOT assumed available (§32)
        val doWipe = assessment.capabilities.first { it.capabilityKey == "DEVICE_OWNER_WIPE" }
        assertFalse(doWipe.isAvailable)
        assertEquals(CapabilityStatus.REQUIRES_DEVICE_OWNER, doWipe.status)

        // Verify Battery SOH is NOT asserted as an ordinary platform capability (§18, §21)
        val soh = assessment.capabilities.first { it.capabilityKey == "BATTERY_SOH_METRIC" }
        assertFalse(soh.isAvailable)
        assertEquals(CapabilityStatus.REQUIRES_OEM_SERVICE, soh.status)

        // Verify Telephony IMEI / Serial access is marked restricted (§20)
        val telephony = assessment.capabilities.first { it.capabilityKey == "HARDWARE_IDENTIFIERS_TELEPHONY" }
        assertFalse(telephony.isAvailable)
        assertEquals(CapabilityStatus.REQUIRES_PERMISSION, telephony.status)

        // Verify OEM proprietary wipe is unavailable without adapter (§9, §29)
        val oemErase = assessment.capabilities.first { it.capabilityKey == "OEM_PROPRIETARY_SECURE_ERASE" }
        assertFalse(oemErase.isAvailable)
        assertEquals(CapabilityStatus.REQUIRES_OEM_SERVICE, oemErase.status)

        // Verify Platform Factory Reset is available with ADB ready
        val reset = assessment.capabilities.first { it.capabilityKey == "PLATFORM_FACTORY_RESET" }
        assertTrue(reset.isAvailable)
        assertEquals(CapabilityStatus.SUPPORTED, reset.status)
    }

    @Test
    fun handlesCustomVerifiedOemResolver() {
        val customResolver = object : OemCapabilityResolver {
            override fun resolveAdapter(manufacturer: String, model: String): String? {
                return if (manufacturer.equals("samsung", ignoreCase = true)) "SamsungVerifiedAdapter" else null
            }

            override fun isSupportedOem(manufacturer: String): Boolean {
                return manufacturer.equals("samsung", ignoreCase = true)
            }
        }

        val engine = StandardCapabilityAssessmentEngine(customResolver)

        val profile = CapabilityProfile(
            manufacturer = "Samsung",
            brand = "samsung",
            model = "SM-G991B",
            sdkInt = 33,
            accessLevel = "L2_HOST_ADB",
            adbState = "ADB_AUTHORIZED",
        )

        val assessment = engine.assess(profile, null)
        assertTrue(assessment.isOemAdapterAvailable)
        assertEquals("SamsungVerifiedAdapter", assessment.resolvedOemAdapter)

        val oemErase = assessment.capabilities.first { it.capabilityKey == "OEM_PROPRIETARY_SECURE_ERASE" }
        assertTrue(oemErase.isAvailable)
        assertEquals(CapabilityStatus.SUPPORTED, oemErase.status)
    }

    @Test
    fun unAuthorizedAdbBlocksResetAction() {
        val engine = StandardCapabilityAssessmentEngine()

        val profile = CapabilityProfile(
            manufacturer = "Google",
            brand = "google",
            model = "Pixel 8",
            sdkInt = 34,
            accessLevel = "L1_USB_ONLY",
            usbState = "USB_CONNECTED_DATA",
            adbState = "ADB_UNAUTHORIZED",
        )

        val assessment = engine.assess(profile, null)
        assertEquals("NONE_AUTHORIZATION_REQUIRED", assessment.recommendedPurgeAction)

        val reset = assessment.capabilities.first { it.capabilityKey == "PLATFORM_FACTORY_RESET" }
        assertFalse(reset.isAvailable)
        assertEquals(CapabilityStatus.REQUIRES_PERMISSION, reset.status)
    }
}
