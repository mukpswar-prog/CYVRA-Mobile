package cyvra.mobile.host.compatibility

import cyvra.mobile.core.CompatibilityTierLevel
import cyvra.mobile.core.OemFamily
import cyvra.mobile.core.TierAssessmentResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostCompatibilityValidatorTest {

    private val validator = HostCompatibilityValidator()

    @Test
    fun verifiesHostPlatformIsSupported() {
        assertTrue(validator.isHostPlatformSupported())
    }

    @Test
    fun evaluatesMultiOemDevicesAcrossLevels() {
        val testOems = listOf(
            Triple("Samsung", "Galaxy S23", 34),
            Triple("Xiaomi", "Redmi Note 12", 33),
            Triple("Motorola", "Edge 40", 33),
            Triple("OnePlus", "OnePlus 11", 34),
            Triple("Google", "Pixel 8 Pro", 35),
            Triple("Nothing", "Phone (2)", 34),
            Triple("GenericBrand", "BasicPhone", 28),
        )

        for ((oem, model, api) in testOems) {
            val record = validator.evaluate(
                manufacturer = oem,
                model = model,
                apiLevel = api,
                androidVersion = "$api",
                isUsbConnected = true,
                isAdbAuthorized = true,
            )

            assertNotNull(record)
            assertTrue(record.isSupportedOsVersion, "Expected API $api on $oem to be supported")
            assertEquals(6, record.tierEvaluations.size, "Must have exactly 6 tier evaluations (A to F)")

            val tierA = record.tierEvaluations.first { it.tier == CompatibilityTierLevel.LEVEL_A_LAUNCH_CONNECT }
            assertEquals(TierAssessmentResult.PASS, tierA.result)
        }
    }
}
