package cyvra.mobile.host.oem

import cyvra.mobile.core.OemFamily
import cyvra.mobile.core.OemSecuritySuite
import cyvra.mobile.core.SanitizationMethodType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostMultiOemAdapterRegistryTest {

    private val registry = HostMultiOemAdapterRegistry()

    @Test
    fun resolvesSamsungGalaxyAdapterCorrectly() {
        val adapter = registry.resolveOemAdapter("Samsung", "Galaxy S21 (SM-G991B)")
        assertTrue(adapter is SamsungGalaxyOemAdapter)

        val profile = registry.getDeviceProfile(
            manufacturer = "Samsung",
            model = "Galaxy S21",
            apiLevel = 34,
            buildProps = mapOf("ro.boot.warranty_bit" to "0x0", "ro.build.version.oneui" to "One UI 6.1"),
        )

        assertEquals(OemFamily.SAMSUNG, profile.oemFamily)
        assertEquals(OemSecuritySuite.SAMSUNG_KNOX, profile.securitySuite)
        assertTrue(profile.isKnoxSupported)
        assertEquals("0x0", profile.knoxWarrantyBitState)
        assertEquals("One UI 6.1", profile.customSkinName)
        assertTrue(profile.supportedResetMethods.contains(SanitizationMethodType.PURGE_OEM_SECURE_ERASE))
    }

    @Test
    fun resolvesXiaomiHyperOsAdapterCorrectly() {
        val adapter = registry.resolveOemAdapter("Xiaomi", "Redmi Note 13 Pro")
        assertTrue(adapter is XiaomiHyperOsOemAdapter)

        val profile = registry.getDeviceProfile(
            manufacturer = "Xiaomi",
            model = "Redmi Note 13 Pro",
            apiLevel = 34,
            buildProps = mapOf("ro.miui.ui.version.name" to "HyperOS 1.0"),
        )

        assertEquals(OemFamily.XIAOMI_REDMI_POCO, profile.oemFamily)
        assertEquals(OemSecuritySuite.XIAOMI_TEE, profile.securitySuite)
        assertFalse(profile.isKnoxSupported)
        assertNull(profile.knoxWarrantyBitState)
        assertEquals("HyperOS 1.0", profile.customSkinName)
    }

    @Test
    fun resolvesOnePlusOppoAdapterCorrectly() {
        val adapter = registry.resolveOemAdapter("OnePlus", "OnePlus 12")
        assertTrue(adapter is OnePlusOppoOemAdapter)

        val profile = registry.getDeviceProfile(
            manufacturer = "OnePlus",
            model = "OnePlus 12",
            apiLevel = 34,
            buildProps = mapOf("ro.build.version.opporom" to "OxygenOS 14.0"),
        )

        assertEquals(OemFamily.ONEPLUS, profile.oemFamily)
        assertEquals(OemSecuritySuite.OPPO_OESTORE, profile.securitySuite)
        assertEquals("OxygenOS 14.0", profile.customSkinName)
    }

    @Test
    fun resolvesMotorolaThinkShieldAdapterCorrectly() {
        val adapter = registry.resolveOemAdapter("motorola", "Moto G54 5G")
        assertTrue(adapter is MotorolaThinkShieldOemAdapter)

        val profile = registry.getDeviceProfile(
            manufacturer = "motorola",
            model = "Moto G54 5G",
            apiLevel = 34,
        )

        assertEquals(OemFamily.MOTOROLA, profile.oemFamily)
        assertEquals(OemSecuritySuite.MOTO_THINKSHIELD, profile.securitySuite)
        assertEquals("MyUX / Hello UI", profile.customSkinName)
    }

    @Test
    fun fallsBackToGenericAndroidAdapterForUnknownManufacturer() {
        val adapter = registry.resolveOemAdapter("UnknownBrand", "GenericPhone")
        assertTrue(adapter is GenericAndroidOemAdapter)

        val profile = registry.getDeviceProfile(
            manufacturer = "UnknownBrand",
            model = "GenericPhone",
            apiLevel = 31,
        )

        assertEquals(OemFamily.UNKNOWN_GENERIC, profile.oemFamily)
        assertEquals(OemSecuritySuite.STANDARD_ANDROID_KEYSTORE, profile.securitySuite)
        assertNull(registry.resolveAdapter("UnknownBrand", "GenericPhone"))
        assertFalse(registry.isSupportedOem("UnknownBrand"))
    }
}
