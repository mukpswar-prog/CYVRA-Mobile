package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Status of an individual evidence field per freeze guide §18.
 */
@Serializable
enum class EvidenceStatus {
    AVAILABLE,
    NOT_AVAILABLE,
    RESTRICTED,
    PERMISSION_REQUIRED,
    UNSUPPORTED_API,
    OEM_UNSUPPORTED,
    ERROR,
}

/**
 * Standard structured result model per §18.
 */
@Serializable
data class EvidenceFieldResult<T>(
    val value: T?,
    val status: EvidenceStatus,
    val source: String,
    val reason: String? = null,
    val timestamp: String = java.time.Instant.now().toString(),
)

/**
 * Device identifier item following §20 and §21.
 * Distinguishes identity types, values, sources, availability, and reasons.
 */
@Serializable
data class DeviceIdentifierRecord(
    val identifierType: String,
    val value: String?,
    val source: String,
    val scope: String,
    val availability: EvidenceStatus,
    val reason: String? = null,
)

/**
 * Identity bundle captured according to §20 hierarchy.
 * IMEI and hardware serial are never fabricated.
 */
@Serializable
data class DeviceIdentityEvidence(
    val manufacturer: EvidenceFieldResult<String>,
    val brand: EvidenceFieldResult<String>,
    val model: EvidenceFieldResult<String>,
    val device: EvidenceFieldResult<String>,
    val product: EvidenceFieldResult<String>,
    val buildId: EvidenceFieldResult<String>,
    val androidVersion: EvidenceFieldResult<String>,
    val apiLevel: EvidenceFieldResult<Int>,
    val securityPatch: EvidenceFieldResult<String>,
    val platformIdentifier: EvidenceFieldResult<String>,
    val hardwareSerial: DeviceIdentifierRecord,
    val imei: DeviceIdentifierRecord,
)

/**
 * Battery evidence snapshot.
 */
@Serializable
data class BatteryEvidence(
    val levelPercent: EvidenceFieldResult<Int>,
    val isCharging: EvidenceFieldResult<Boolean>,
    val health: EvidenceFieldResult<String>,
    val stateOfHealthSoh: EvidenceFieldResult<Int>, // Restricted / unavailable in S1/generic
)

/**
 * Storage evidence snapshot per §22 (no arbitrary /data crawling).
 */
@Serializable
data class StorageEvidence(
    val internalTotalBytes: EvidenceFieldResult<Long>,
    val internalAvailableBytes: EvidenceFieldResult<Long>,
    val externalStoragePresent: EvidenceFieldResult<Boolean>,
    val scopedStorageEnforced: EvidenceFieldResult<Boolean>,
    val accessLimitation: String = "Scoped storage enforced; unrestricted filesystem access withheld",
)

/**
 * Security state evidence.
 */
@Serializable
data class SecurityEvidence(
    val screenLockPresent: EvidenceFieldResult<Boolean>,
    val secureBootEnabled: EvidenceFieldResult<Boolean>,
    val deviceOwnerActive: EvidenceFieldResult<Boolean>,
    val adbEnabled: EvidenceFieldResult<Boolean>,
    val knoxClaim: EvidenceFieldResult<String>, // Always restricted/unavailable without verified enterprise contract
)

/**
 * Comprehensive generic device evidence aggregate.
 */
@Serializable
data class GenericDeviceEvidence(
    val sessionUuid: String,
    val collectedAt: String,
    val identity: DeviceIdentityEvidence,
    val battery: BatteryEvidence,
    val storage: StorageEvidence,
    val security: SecurityEvidence,
    val features: List<FeatureFact> = emptyList(),
)
