package cyvra.mobile.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val ingestJson = Json {
    encodeDefaults = true
    explicitNulls = false
}

@Serializable
data class IngestProfile(
    val schemaVersion: String = SCHEMA_VERSION,
    val profileId: String,
    val deviceLifecycleId: String,
    val processingSessionId: String,
    val version: Int = 1,
    val capturedAt: String,
    val accessLevel: String,
    val usbState: String,
    val adbState: String,
    val manufacturer: String,
    val brand: String,
    val model: String,
    val product: String,
    val device: String,
    val fingerprint: String,
    val androidRelease: String,
    val sdkInt: Int,
    val smallestScreenWidthDp: Int? = null,
    val features: List<FeatureFact>,
    val permissions: List<PermissionFact>,
    val limitations: List<String>,
)

@Serializable
data class IngestEnvelope(
    val schemaVersion: String = SCHEMA_VERSION,
    val batchId: String,
    val deviceLifecycleId: String,
    val processingSessionId: String,
    val createdAt: String,
    val records: List<EvidenceRecord>,
    val profile: IngestProfile,
)

fun plannedIngest(
    profile: CapabilityProfile,
    deviceLifecycleId: String,
    processingSessionId: String,
    batchId: String,
    profileId: String,
    collectedAt: String,
    idFactory: () -> String = { newEvidenceId() },
): IngestEnvelope {
    val batch = queuePlannedBatch(
        profile = profile,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        batchId = batchId,
        collectedAt = collectedAt,
        idFactory = idFactory,
    )
    return IngestEnvelope(
        batchId = batch.batchId,
        deviceLifecycleId = batch.deviceLifecycleId,
        processingSessionId = batch.processingSessionId,
        createdAt = batch.createdAt,
        records = batch.records,
        profile = IngestProfile(
            profileId = profileId,
            deviceLifecycleId = deviceLifecycleId,
            processingSessionId = processingSessionId,
            capturedAt = collectedAt,
            accessLevel = profile.accessLevel,
            usbState = profile.usbState,
            adbState = profile.adbState,
            manufacturer = profile.manufacturer,
            brand = profile.brand,
            model = profile.model,
            product = profile.product.ifBlank { profile.model },
            device = profile.device.ifBlank { profile.model },
            fingerprint = profile.fingerprint.ifBlank {
                "${profile.manufacturer}/${profile.model}/${profile.device}:${profile.androidRelease}"
            },
            androidRelease = profile.androidRelease.ifBlank { "unknown" },
            sdkInt = profile.sdkInt,
            smallestScreenWidthDp = profile.smallestScreenWidthDp,
            features = profile.features,
            permissions = profile.permissions,
            limitations = profile.limitations,
        ),
    )
}

fun plannedIngestJson(
    profile: CapabilityProfile,
    deviceLifecycleId: String,
    processingSessionId: String,
    batchId: String,
    profileId: String,
    collectedAt: String,
    idFactory: () -> String = { newEvidenceId() },
): String = ingestJson.encodeToString(
    plannedIngest(
        profile = profile,
        deviceLifecycleId = deviceLifecycleId,
        processingSessionId = processingSessionId,
        batchId = batchId,
        profileId = profileId,
        collectedAt = collectedAt,
        idFactory = idFactory,
    ),
)
