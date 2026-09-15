package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CompatibilityMatrixModelsTest {

    @Test
    fun identifiesAllRequiredOemFamiliesCorrectly() {
        assertEquals(OemFamily.SAMSUNG, CompatibilityMatrixEvaluator.identifyOemFamily("Samsung"))
        assertEquals(OemFamily.XIAOMI_REDMI_POCO, CompatibilityMatrixEvaluator.identifyOemFamily("Xiaomi"))
        assertEquals(OemFamily.XIAOMI_REDMI_POCO, CompatibilityMatrixEvaluator.identifyOemFamily("Redmi"))
        assertEquals(OemFamily.XIAOMI_REDMI_POCO, CompatibilityMatrixEvaluator.identifyOemFamily("POCO"))
        assertEquals(OemFamily.MOTOROLA, CompatibilityMatrixEvaluator.identifyOemFamily("Motorola"))
        assertEquals(OemFamily.ONEPLUS, CompatibilityMatrixEvaluator.identifyOemFamily("OnePlus"))
        assertEquals(OemFamily.OPPO_REALME, CompatibilityMatrixEvaluator.identifyOemFamily("OPPO"))
        assertEquals(OemFamily.OPPO_REALME, CompatibilityMatrixEvaluator.identifyOemFamily("Realme"))
        assertEquals(OemFamily.VIVO, CompatibilityMatrixEvaluator.identifyOemFamily("vivo"))
        assertEquals(OemFamily.GOOGLE_PIXEL, CompatibilityMatrixEvaluator.identifyOemFamily("Google"))
        assertEquals(OemFamily.NOTHING, CompatibilityMatrixEvaluator.identifyOemFamily("Nothing"))
        assertEquals(OemFamily.UNKNOWN_GENERIC, CompatibilityMatrixEvaluator.identifyOemFamily("Fairphone"))
    }

    @Test
    fun evaluatesDeviceAcrossTiersAFWithoutBinarySimplification() {
        val record = CompatibilityMatrixEvaluator.evaluateDevice(
            manufacturer = "Samsung",
            model = "SM-S918B",
            apiLevel = 34,
            androidVersion = "14",
            isUsbConnected = true,
            isAdbAuthorized = true,
            hasEvidence = true,
            hasComponentEvidence = true,
            isSanitizationAuthorized = false,
            isPostResetVerified = false,
        )

        assertEquals(OemFamily.SAMSUNG, record.oemFamily)
        assertTrue(record.isSupportedOsVersion)

        // Tier evaluations
        val tierA = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_A_LAUNCH_CONNECT }
        assertEquals(TierAssessmentResult.PASS, tierA.result)

        val tierB = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_B_GENERIC_EVIDENCE }
        assertEquals(TierAssessmentResult.PASS, tierB.result)

        val tierC = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_C_EXTENDED_EVIDENCE }
        assertEquals(TierAssessmentResult.PASS, tierC.result)

        val tierD = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_D_SANITIZATION_ASSESSMENT }
        assertEquals(TierAssessmentResult.PASS, tierD.result)

        val tierE = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_E_SANITIZATION_EXECUTION }
        assertEquals(TierAssessmentResult.REQUIRES_AUTHORIZATION, tierE.result)

        val tierF = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_F_POST_RESET_VERIFICATION }
        assertEquals(TierAssessmentResult.NOT_APPLICABLE, tierF.result)

        // Ensure serializable
        val json = Json { prettyPrint = true; encodeDefaults = true }
        val serialized = json.encodeToString(record)
        assertTrue(serialized.contains("LEVEL_A_LAUNCH_CONNECT"))
        assertTrue(serialized.contains("SM-S918B"))

        val decoded = json.decodeFromString<DeviceCompatibilityRecord>(serialized)
        assertEquals("Samsung", decoded.manufacturer)
        assertEquals(34, decoded.apiLevel)
    }

    @Test
    fun flagsUnsupportedLegacyAndroidVersionOutsideMatrix() {
        val record = CompatibilityMatrixEvaluator.evaluateDevice(
            manufacturer = "Samsung",
            model = "GT-I9300",
            apiLevel = 16, // Android 4.1 Jelly Bean (outside minSdk 26 baseline)
            androidVersion = "4.1.2",
            isUsbConnected = true,
            isAdbAuthorized = false,
        )

        assertFalse(record.isSupportedOsVersion)
        assertTrue(record.limitations.any { it.contains("outside tested matrix") })
    }
}
