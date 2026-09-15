package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AndroidComponentModelsTest {

    @Test
    fun serializesAndDeserializesComponentPayloadExplicitSource() {
        val payload = AndroidComponentEvidencePayload(
            componentVersion = "0.0.0-g5",
            deviceLifecycleId = "lifecycle-999",
            sessionUuid = "session-123",
            displayMetrics = ComponentDisplayMetrics(
                densityDpi = 480,
                widthPixels = 1080,
                heightPixels = 2400,
                smallestScreenWidthDp = 411,
                xdpi = 480f,
                ydpi = 480f,
            ),
            batteryExtras = ComponentBatteryExtras(
                isPresent = true,
                technology = "Li-ion",
                temperatureDeciCelsius = 285,
                voltageMilliVolts = 4120,
                chargeCounterUah = 3500000L,
                capacityPercent = 85,
            ),
            runtimePermissions = listOf(
                PermissionFact("android.permission.CAMERA", granted = true),
            ),
            declaredFeatures = listOf(
                FeatureFact(feature = "android.hardware.camera", declared = true, state = "DECLARED"),
            ),
            limitations = listOf("Collected via on-device supporting Android Component"),
        )

        val json = Json { prettyPrint = true; encodeDefaults = true }
        val encoded = json.encodeToString(payload)

        // Honesty & Source invariant (§19): source must be ANDROID_COMPONENT
        assertTrue(encoded.contains("\"source\": \"ANDROID_COMPONENT\""))

        val decoded = json.decodeFromString<AndroidComponentEvidencePayload>(encoded)
        assertEquals("ANDROID_COMPONENT", decoded.source)
        assertEquals("0.0.0-g5", decoded.componentVersion)
        assertEquals("session-123", decoded.sessionUuid)
        assertEquals(480, decoded.displayMetrics.densityDpi)
        assertEquals("Li-ion", decoded.batteryExtras.technology)
        assertEquals(85, decoded.batteryExtras.capacityPercent)
        assertEquals(285, decoded.batteryExtras.temperatureDeciCelsius)
    }
}
