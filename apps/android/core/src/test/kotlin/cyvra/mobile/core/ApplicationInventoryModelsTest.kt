package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Core-model-only tests for the installed-application inventory contract.
 * No hardware, instrumentation, or ADB collection is exercised here.
 */
class ApplicationInventoryModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    private fun sampleRecord(
        pkg: String = "com.example.app",
        systemFlag: Boolean? = false,
        updatedSystemFlag: Boolean? = false,
        label: String? = "Example",
        versionName: String? = "1.2.3",
        versionCode: Long? = 10203L,
        enabledState: ApplicationEnabledState = ApplicationEnabledState.ENABLED,
        apiLevel: Int? = 30,
    ) = ApplicationInventoryRecord(
        packageName = pkg,
        classification = deriveClassification(systemFlag, updatedSystemFlag),
        classificationStatus = deriveClassificationStatus(systemFlag, updatedSystemFlag),
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        collectedAt = "2026-09-27T10:00:00Z",
        label = label,
        versionName = versionName,
        versionCode = versionCode,
        systemFlag = systemFlag,
        updatedSystemFlag = updatedSystemFlag,
        enabledState = enabledState,
        apiLevel = apiLevel,
    )

    private fun sampleEvidence(
        completeness: ApplicationEnumerationCompleteness = ApplicationEnumerationCompleteness.COMPLETE,
        applications: List<ApplicationInventoryRecord> = listOf(sampleRecord()),
        limitations: List<String> = emptyList(),
    ) = ApplicationInventoryEvidence(
        collectedAt = "2026-09-27T10:00:00Z",
        evidenceSource = "ANDROID_COMPONENT",
        collectionMethod = "ANDROID_PACKAGE_MANAGER",
        enumerationCompleteness = completeness,
        apiLevel = 30,
        applications = applications,
        limitations = limitations,
    )

    // ---- 1. PREINSTALLED_SYSTEM classification ------------------------------------

    @Test
    fun preinstalledSystemClassificationFromDirectFlags() {
        assertEquals(
            ApplicationClassification.PREINSTALLED_SYSTEM,
            deriveClassification(systemFlag = true, updatedSystemFlag = false),
        )
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            deriveClassificationStatus(systemFlag = true, updatedSystemFlag = false),
        )
    }

    // ---- 2. UPDATED_SYSTEM classification -----------------------------------------

    @Test
    fun updatedSystemClassificationFromDirectFlags() {
        assertEquals(
            ApplicationClassification.UPDATED_SYSTEM,
            deriveClassification(systemFlag = true, updatedSystemFlag = true),
        )
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            deriveClassificationStatus(systemFlag = true, updatedSystemFlag = true),
        )
    }

    // ---- 3. USER_THIRD_PARTY classification ---------------------------------------

    @Test
    fun userThirdPartyClassificationFromDirectFlags() {
        assertEquals(
            ApplicationClassification.USER_THIRD_PARTY,
            deriveClassification(systemFlag = false, updatedSystemFlag = false),
        )
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            deriveClassificationStatus(systemFlag = false, updatedSystemFlag = false),
        )
    }

    // ---- 4. UNKNOWN classification ------------------------------------------------

    @Test
    fun unknownClassificationWhenEvidenceMissingOrContradictory() {
        val missingEvidenceCases: List<Pair<Boolean?, Boolean?>> = listOf(
            null to false,
            true to null,
            null to null,
        )
        for ((system, updated) in missingEvidenceCases) {
            assertEquals(
                ApplicationClassification.UNKNOWN,
                deriveClassification(system, updated),
                "flags=($system, $updated) must classify UNKNOWN",
            )
            assertEquals(
                ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE,
                deriveClassificationStatus(system, updated),
            )
        }

        // Contradictory raw evidence must never be guessed into a concrete class.
        assertEquals(
            ApplicationClassification.UNKNOWN,
            deriveClassification(systemFlag = false, updatedSystemFlag = true),
        )
        assertEquals(
            ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS,
            deriveClassificationStatus(systemFlag = false, updatedSystemFlag = true),
        )
    }

    @Test
    fun classificationEnumContainsOnlyApprovedValues() {
        assertEquals(4, ApplicationClassification.entries.size)
        assertTrue(ApplicationClassification.entries.contains(ApplicationClassification.PREINSTALLED_SYSTEM))
        assertTrue(ApplicationClassification.entries.contains(ApplicationClassification.UPDATED_SYSTEM))
        assertTrue(ApplicationClassification.entries.contains(ApplicationClassification.USER_THIRD_PARTY))
        assertTrue(ApplicationClassification.entries.contains(ApplicationClassification.UNKNOWN))
    }

    // ---- 5. Direct classification status ------------------------------------------

    @Test
    fun classificationStatusEnumHasExactlyRequiredSemantics() {
        assertEquals(3, ApplicationClassificationStatus.entries.size)
        assertTrue(
            ApplicationClassificationStatus.entries
                .contains(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS),
        )
        assertTrue(
            ApplicationClassificationStatus.entries
                .contains(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE),
        )
        assertTrue(
            ApplicationClassificationStatus.entries
                .contains(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS),
        )
    }

    // ---- 6. Unavailable / ambiguous classification status --------------------------

    @Test
    fun unavailableAndAmbiguousStatusesAreDistinctAndNeverAuthoritative() {
        val unavailable = deriveClassificationStatus(systemFlag = null, updatedSystemFlag = false)
        val ambiguous = deriveClassificationStatus(systemFlag = false, updatedSystemFlag = true)

        assertEquals(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE, unavailable)
        assertEquals(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS, ambiguous)
        assertNotEquals(unavailable, ambiguous)
        assertNotEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, unavailable)
        assertNotEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, ambiguous)
    }

    // ---- 7. Serialization / deserialization ---------------------------------------

    @Test
    fun inventoryEvidenceSerializesAndDeserializesRoundTrip() {
        val evidence = sampleEvidence(
            completeness = ApplicationEnumerationCompleteness.COMPLETE,
            applications = listOf(
                sampleRecord(
                    pkg = "com.samsung.android.app",
                    systemFlag = true,
                    updatedSystemFlag = true,
                    label = "Samsung App",
                ),
                sampleRecord(pkg = "org.example.userapp", label = null),
            ),
        )

        val encoded = json.encodeToString(evidence)
        assertTrue(encoded.contains("\"packageName\""))
        assertTrue(encoded.contains("\"UPDATED_SYSTEM\""))
        assertTrue(encoded.contains("\"USER_THIRD_PARTY\""))
        assertTrue(encoded.contains("\"COMPLETE\""))

        val decoded = json.decodeFromString<ApplicationInventoryEvidence>(encoded)
        assertEquals(evidence, decoded)
        assertEquals(2, decoded.applications.size)
        assertEquals(
            ApplicationClassification.UPDATED_SYSTEM,
            decoded.applications[0].classification,
        )
        assertEquals(
            ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS,
            decoded.applications[0].classificationStatus,
        )
        assertEquals(10203L, decoded.applications[0].versionCode)
        assertEquals(true, decoded.applications[0].systemFlag)
        assertEquals(true, decoded.applications[0].updatedSystemFlag)
        assertEquals(ApplicationEnabledState.ENABLED, decoded.applications[0].enabledState)
    }

    // ---- 8. Default / backward-compatible behavior --------------------------------

    @Test
    fun minimalInventoryJsonDecodesWithSafeDefaults() {
        val minimalRecordJson =
            """
            {
              "packageName": "com.example.minimal",
              "classification": "UNKNOWN",
              "classificationStatus": "EVIDENCE_UNAVAILABLE",
              "evidenceSource": "ANDROID_COMPONENT",
              "collectionMethod": "ANDROID_PACKAGE_MANAGER",
              "collectedAt": "2026-09-27T10:00:00Z"
            }
            """.trimIndent()
        val record = json.decodeFromString<ApplicationInventoryRecord>(minimalRecordJson)

        assertEquals(SCHEMA_VERSION, record.schemaVersion)
        assertNull(record.label)
        assertNull(record.versionName)
        assertNull(record.versionCode)
        assertNull(record.uid)
        assertNull(record.systemFlag)
        assertNull(record.updatedSystemFlag)
        assertEquals(ApplicationEnabledState.UNKNOWN, record.enabledState)
        assertNull(record.apiLevel)

        val minimalEvidenceJson =
            """
            {
              "collectedAt": "2026-09-27T10:00:00Z",
              "evidenceSource": "ANDROID_ADB",
              "collectionMethod": "ADB_PM_LIST_PACKAGES",
              "enumerationCompleteness": "UNAVAILABLE"
            }
            """.trimIndent()
        val inventory = json.decodeFromString<ApplicationInventoryEvidence>(minimalEvidenceJson)

        assertEquals(SCHEMA_VERSION, inventory.schemaVersion)
        assertNull(inventory.apiLevel)
        assertTrue(inventory.applications.isEmpty())
        assertTrue(inventory.limitations.isEmpty())
    }

    @Test
    fun legacyGenericDeviceEvidenceJsonStillDecodesWithoutInventoryField() {
        val legacyJson =
            """
            {
              "sessionUuid": "legacy-session",
              "collectedAt": "2026-01-01T00:00:00Z",
              "identity": {
                "manufacturer": {"value": "samsung", "status": "AVAILABLE", "source": "ADB"},
                "brand": {"value": "samsung", "status": "AVAILABLE", "source": "ADB"},
                "model": {"value": "SM-A107F", "status": "AVAILABLE", "source": "ADB"},
                "device": {"value": "a10s", "status": "AVAILABLE", "source": "ADB"},
                "product": {"value": "a10sxx", "status": "AVAILABLE", "source": "ADB"},
                "buildId": {"value": "RP1A.200720.012", "status": "AVAILABLE", "source": "ADB"},
                "androidVersion": {"value": "11", "status": "AVAILABLE", "source": "ADB"},
                "apiLevel": {"value": 30, "status": "AVAILABLE", "source": "ADB"},
                "securityPatch": {"value": "2024-08-01", "status": "AVAILABLE", "source": "ADB"},
                "platformIdentifier": {"value": "android-id-redacted", "status": "AVAILABLE", "source": "ADB"},
                "hardwareSerial": {"identifierType": "HARDWARE_SERIAL", "value": null, "source": "ADB", "scope": "DEVICE", "availability": "RESTRICTED"},
                "imei": {"identifierType": "IMEI", "value": null, "source": "ADB", "scope": "DEVICE", "availability": "RESTRICTED"}
              },
              "battery": {
                "levelPercent": {"value": 72, "status": "AVAILABLE", "source": "ADB"},
                "isCharging": {"value": true, "status": "AVAILABLE", "source": "ADB"},
                "health": {"value": "GOOD", "status": "AVAILABLE", "source": "ADB"},
                "stateOfHealthSoh": {"value": null, "status": "RESTRICTED", "source": "ADB"}
              },
              "storage": {
                "internalTotalBytes": {"value": 32000000000, "status": "AVAILABLE", "source": "ADB"},
                "internalAvailableBytes": {"value": 12000000000, "status": "AVAILABLE", "source": "ADB"},
                "externalStoragePresent": {"value": false, "status": "AVAILABLE", "source": "ADB"},
                "scopedStorageEnforced": {"value": true, "status": "AVAILABLE", "source": "ADB"}
              },
              "security": {
                "screenLockPresent": {"value": true, "status": "AVAILABLE", "source": "ADB"},
                "secureBootEnabled": {"value": true, "status": "AVAILABLE", "source": "ADB"},
                "deviceOwnerActive": {"value": false, "status": "AVAILABLE", "source": "ADB"},
                "adbEnabled": {"value": true, "status": "AVAILABLE", "source": "ADB"},
                "knoxClaim": {"value": null, "status": "RESTRICTED", "source": "ADB"}
              }
            }
            """.trimIndent()

        val decoded = json.decodeFromString<GenericDeviceEvidence>(legacyJson)
        assertEquals("legacy-session", decoded.sessionUuid)
        assertNull(decoded.applicationInventory)
        assertEquals(72, decoded.battery.levelPercent.value)

        // Default (non-encodeDefaults) serialization must not introduce the new key,
        // proving existing output formats stay byte-compatible until a collector exists.
        val defaultEncoded = Json.encodeToString(decoded)
        assertTrue(!defaultEncoded.contains("applicationInventory"))
    }

    // ---- 9. COMPLETE completeness --------------------------------------------------

    @Test
    fun completeCompletenessRepresentsFullEnumerationWithRecords() {
        assertEquals(3, ApplicationEnumerationCompleteness.entries.size)
        assertTrue(
            ApplicationEnumerationCompleteness.entries
                .contains(ApplicationEnumerationCompleteness.COMPLETE),
        )

        val evidence = sampleEvidence(
            completeness = ApplicationEnumerationCompleteness.COMPLETE,
            applications = listOf(sampleRecord(), sampleRecord(pkg = "org.example.two")),
        )
        val decoded = json.decodeFromString<ApplicationInventoryEvidence>(json.encodeToString(evidence))

        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, decoded.enumerationCompleteness)
        assertEquals(2, decoded.applications.size)
    }

    // ---- 10. FILTERED completeness -------------------------------------------------

    @Test
    fun filteredCompletenessNeverSilentlyBecomesComplete() {
        assertTrue(
            ApplicationEnumerationCompleteness.entries
                .contains(ApplicationEnumerationCompleteness.FILTERED),
        )

        val filtered = sampleEvidence(
            completeness = ApplicationEnumerationCompleteness.FILTERED,
            applications = listOf(sampleRecord()),
        )
        val decoded = json.decodeFromString<ApplicationInventoryEvidence>(json.encodeToString(filtered))

        assertEquals(ApplicationEnumerationCompleteness.FILTERED, decoded.enumerationCompleteness)
        assertNotEquals(ApplicationEnumerationCompleteness.COMPLETE, decoded.enumerationCompleteness)
    }

    // ---- 11. UNAVAILABLE completeness ----------------------------------------------

    @Test
    fun unavailableCompletenessCarriesNoFabricatedRecords() {
        val unavailable = ApplicationInventoryEvidence(
            collectedAt = "2026-09-27T10:00:00Z",
            evidenceSource = "ANDROID_ADB",
            collectionMethod = "ADB_PM_LIST_PACKAGES",
            enumerationCompleteness = ApplicationEnumerationCompleteness.UNAVAILABLE,
            limitations = listOf("Package enumeration unavailable; recorded honestly without guessing"),
        )
        val decoded = json.decodeFromString<ApplicationInventoryEvidence>(json.encodeToString(unavailable))

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, decoded.enumerationCompleteness)
        assertTrue(decoded.applications.isEmpty())
        assertEquals(1, decoded.limitations.size)
    }

    // ---- 12. Empty / optional metadata handling ------------------------------------

    @Test
    fun emptyOptionalMetadataIsPreservedAsAbsent() {
        val record = ApplicationInventoryRecord(
            packageName = "com.example.nooptionals",
            classification = ApplicationClassification.UNKNOWN,
            classificationStatus = ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE,
            evidenceSource = "ANDROID_COMPONENT",
            collectionMethod = "ANDROID_PACKAGE_MANAGER",
            collectedAt = "2026-09-27T10:00:00Z",
        )
        val decodedRecord = json.decodeFromString<ApplicationInventoryRecord>(json.encodeToString(record))
        assertEquals(record, decodedRecord)
        assertNull(decodedRecord.label)
        assertNull(decodedRecord.versionName)
        assertNull(decodedRecord.versionCode)
        assertNull(decodedRecord.uid)
        assertNull(decodedRecord.systemFlag)
        assertNull(decodedRecord.updatedSystemFlag)
        assertEquals(ApplicationEnabledState.UNKNOWN, decodedRecord.enabledState)
        assertNull(decodedRecord.apiLevel)

        val inventory = ApplicationInventoryEvidence(
            collectedAt = "2026-09-27T10:00:00Z",
            evidenceSource = "ANDROID_COMPONENT",
            collectionMethod = "ANDROID_PACKAGE_MANAGER",
            enumerationCompleteness = ApplicationEnumerationCompleteness.UNAVAILABLE,
        )
        val decodedInventory = json.decodeFromString<ApplicationInventoryEvidence>(json.encodeToString(inventory))
        assertEquals(inventory, decodedInventory)
        assertTrue(decodedInventory.applications.isEmpty())
        assertTrue(decodedInventory.limitations.isEmpty())
        assertNull(decodedInventory.apiLevel)
    }
}
