package cyvra.mobile.core

import kotlinx.serialization.Serializable

@Serializable
data class FeatureFact(
    val feature: String,
    val declared: Boolean,
    val detected: Boolean? = null,
    val state: String,
)

@Serializable
data class PermissionFact(
    val permission: String,
    val granted: Boolean,
)

@Serializable
data class CapabilityProfile(
    val schemaVersion: String = SCHEMA_VERSION,
    val manufacturer: String,
    val brand: String,
    val model: String,
    val product: String = "",
    val device: String = "",
    val fingerprint: String = "",
    val androidRelease: String = "",
    val sdkInt: Int = 0,
    val smallestScreenWidthDp: Int? = null,
    val accessLevel: String = "L2_S1_APP",
    val usbState: String = "USB_UNKNOWN",
    val adbState: String = "ADB_UNKNOWN",
    val features: List<FeatureFact> = emptyList(),
    val permissions: List<PermissionFact> = emptyList(),
    val limitations: List<String> = emptyList(),
)

@Serializable
data class TestDefinition(
    val testId: String,
    val domain: String,
    val userName: String,
    val objectiveName: String,
    val requireFeatures: List<String> = emptyList(),
    val requirePermissions: List<String> = emptyList(),
    val minSource: String,
    val s1ForbiddenPass: Boolean = false,
    val defaultUntested: String = "NOT_TESTED",
    val observationOnly: Boolean = false,
)

@Serializable
data class CapabilityRule(
    val capabilityId: String,
    val requireFeatures: List<String> = emptyList(),
    val tests: List<String> = emptyList(),
    val requirePermissions: List<String> = emptyList(),
    val missingFeatureResult: String,
    val s1ForbiddenPass: Boolean = false,
    val notes: String? = null,
)

@Serializable
data class CapabilityContract(
    val schemaVersion: String,
    val contractId: String,
    val version: String,
    val layer: String,
    val rules: List<CapabilityRule>,
)

@Serializable
data class CatalogFile(
    val schemaVersion: String,
    val catalog: List<TestDefinition>,
    val contract: CapabilityContract,
)

data class PlannedTest(
    val testId: String,
    val userName: String,
    val objectiveName: String,
    val domain: String,
    val readiness: String,
    val uiStatus: String,
    val plannedResult: String,
    val limitation: String? = null,
)

@Serializable
data class EvidenceRecord(
    val schemaVersion: String = SCHEMA_VERSION,
    val evidenceId: String,
    val deviceLifecycleId: String,
    val processingSessionId: String,
    val testId: String,
    val source: String = "S1_APPLICATION",
    val result: String,
    val collectedAt: String,
    val method: String,
    val limitation: String? = null,
    val notes: String? = null,
    val payload: Map<String, String> = emptyMap(),
    val digest: String? = null,
)

@Serializable
data class EvidenceBatch(
    val schemaVersion: String = SCHEMA_VERSION,
    val batchId: String,
    val deviceLifecycleId: String,
    val processingSessionId: String,
    val records: List<EvidenceRecord>,
    val createdAt: String,
)

@Serializable
data class QueuedItem(
    val record: EvidenceRecord,
    val queuedAt: String,
    val syncedAt: String? = null,
)
