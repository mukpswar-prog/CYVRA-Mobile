package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class OemAdapterModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesOemAdapterProfile() {
        val feature = OemCapabilityFeature(
            featureKey = "SAMSUNG_KNOX_ATTESTATION",
            displayName = "Knox Hardware Security Enclave Attestation",
            isSupported = true,
            requiresPrivilegedContract = true,
            accessDescription = "Attests Knox hardware warranty bit and cryptographic key containment.",
        )

        val profile = OemAdapterProfile(
            adapterId = "OEM-ADAPTER-SAMSUNG-KNOX",
            oemFamily = OemFamily.SAMSUNG,
            canonicalManufacturer = "Samsung Electronics Co., Ltd.",
            customSkinName = "One UI 6.1",
            securitySuite = OemSecuritySuite.SAMSUNG_KNOX,
            isKnoxSupported = true,
            knoxWarrantyBitState = "0x0",
            batteryHealthProtocol = "sec_bat_health_node",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.PURGE_OEM_SECURE_ERASE,
            ),
            features = listOf(feature),
        )

        val encoded = json.encodeToString(profile)
        val decoded = json.decodeFromString<OemAdapterProfile>(encoded)

        assertEquals("OEM-ADAPTER-SAMSUNG-KNOX", decoded.adapterId)
        assertEquals(OemFamily.SAMSUNG, decoded.oemFamily)
        assertEquals("One UI 6.1", decoded.customSkinName)
        assertTrue(decoded.isKnoxSupported)
        assertEquals("0x0", decoded.knoxWarrantyBitState)
        assertEquals(1, decoded.features.size)
        assertEquals("SAMSUNG_KNOX_ATTESTATION", decoded.features[0].featureKey)
    }
}
