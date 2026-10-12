package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AndroidComponentModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    /** A minimal deterministic [PackageMetadataSource], as used by the S1 collector tests. */
    private class FakePackageMetadataSource(
        private val names: List<String>,
        private val metadataByPackage: Map<String, RawPackageMetadata> = emptyMap(),
        private val apiLevel: Int? = 30,
    ) : PackageMetadataSource {
        override fun listVisiblePackageNames(): List<String> = names
        override fun readRawMetadata(packageName: String): RawPackageMetadata? =
            metadataByPackage[packageName]
        override fun deviceApiLevel(): Int? = apiLevel
    }

    private fun samplePayload(
        applicationInventory: ApplicationInventoryEvidence? = null,
    ) = AndroidComponentEvidencePayload(
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
        applicationInventory = applicationInventory,
        limitations = listOf("Collected via on-device supporting Android Component"),
    )

    @Test
    fun serializesAndDeserializesComponentPayloadExplicitSource() {
        val payload = samplePayload()

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

    /**
     * The S1 inventory rides inside the component payload, so a reader that receives one
     * always receives the other or neither.
     *
     * Built through the real [S1ApplicationInventoryCollector] rather than a hand-made
     * model, so this exercises the production collection path and not just the codec.
     */
    @Test
    fun inventoryTravelsWithThePayloadAndKeepsItsLabel() {
        val inventory = S1ApplicationInventoryCollector(
            source = FakePackageMetadataSource(
                names = listOf("com.example.mail"),
                metadataByPackage = mapOf(
                    "com.example.mail" to RawPackageMetadata(
                        systemFlag = false,
                        updatedSystemFlag = false,
                        rawEnabledState = COMPONENT_ENABLED_STATE_ENABLED,
                        versionName = "4.2",
                        longVersionCode = null,
                        legacyVersionCode = 42L,
                        uid = 10100L,
                        label = "Mail",
                    ),
                ),
                apiLevel = 30,
            ),
            collectedAt = "2026-10-12T09:00:00Z",
        ).collect()

        val encoded = json.encodeToString(samplePayload(applicationInventory = inventory))
        val decoded = json.decodeFromString<AndroidComponentEvidencePayload>(encoded)

        val evidence = decoded.applicationInventory
        assertNotNull(evidence, "the inventory must survive the wire")

        val record = evidence.applications.single()
        assertEquals("com.example.mail", record.packageName)
        assertEquals("Mail", record.label, "the human-readable label is the point of WP-3b")
        assertEquals("ANDROID_COMPONENT", record.evidenceSource)
        assertEquals("ANDROID_PACKAGE_MANAGER", record.collectionMethod)

        assertEquals(
            ApplicationEnumerationCompleteness.FILTERED,
            evidence.enumerationCompleteness,
            "S1 enumeration is visibility-filtered and must never be recorded COMPLETE",
        )
        assertTrue(
            evidence.limitations.any { it.contains("package visibility") },
            "the reason it is FILTERED must travel with the evidence",
        )
    }

    /**
     * Backwards compatibility. A payload written by an APK that predates the inventory
     * field must still decode — and must decode to **null**, never to an invented empty
     * inventory, which a reader would take as "this phone has no applications installed".
     */
    @Test
    fun aPayloadWrittenBeforeTheInventoryFieldStillDecodesToNull() {
        val encoded = json.encodeToString(samplePayload())

        val legacy = kotlinx.serialization.json.JsonObject(
            json.parseToJsonElement(encoded).jsonObject.filterKeys { it != "applicationInventory" },
        )
        assertTrue("applicationInventory" !in legacy.keys, "fixture must omit the new field")

        val decoded = json.decodeFromJsonElement(
            AndroidComponentEvidencePayload.serializer(),
            legacy,
        )

        assertEquals("session-123", decoded.sessionUuid)
        assertEquals(85, decoded.batteryExtras.capacityPercent, "legacy fields must still read")
        assertNull(
            decoded.applicationInventory,
            "an absent inventory must decode to null, never to an empty inventory",
        )
    }
}
