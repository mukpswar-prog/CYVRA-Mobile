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
    /**
     * ID-005's fingerprint half. Additive and default-null.
     *
     * Deliberately declared last. Inserting an optional field mid-class shifts the
     * argument positions of every field after it, which silently retypes positional
     * construction sites in other modules instead of failing loudly. Additive fields
     * append; that is what makes them additive.
     *
     * The build identifier alone does not identify a build uniquely, so a fingerprint
     * is what binds a report to one specific software image rather than to a marketing
     * version.
     */
    val buildFingerprint: EvidenceFieldResult<String>? = null,
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
    /**
     * BAT-004. The temperature integer exactly as the device publishes it under
     * `dumpsys battery`.
     *
     * Deliberately left unconverted. The device's native scale is not assumed here:
     * shipping a value labelled Celsius on an unverified divisor would put a wrong
     * number in a customer report. The divisor is confirmed by measurement against a
     * reference thermometer during Stage 1 validation, and only then is a Celsius
     * figure derived.
     */
    val rawTemperatureDeviceUnits: EvidenceFieldResult<Int>? = null,
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
    /**
     * Default must assert nothing. A default argument is applied by every constructor
     * that does not supply one, so a default carrying a policy claim would re-assert
     * "scoped storage enforced" from call sites that never measured it. The caller that
     * has actually observed the device may override this with what it saw.
     */
    val accessLimitation: String = "No directory crawl is performed; only reported capacity figures are captured",
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
    /**
     * Optional single-source installed-application inventory. When the device-side (S1)
     * inventory was collected it is stored here (the device-side evidence is the primary
     * inventory snapshot); otherwise the authorized host-side (S2) inventory is stored.
     * Full S1/S2 provenance lives in [reconciledApplicationInventory].
     * Additive and default-null: legacy JSON without this field still decodes.
     */
    val applicationInventory: ApplicationInventoryEvidence? = null,
    /**
     * Optional deterministic S1+S2 reconciliation of the installed-application inventory
     * (null when no inventory source was collected). Preserves per-source provenance,
     * completeness, limitations, and conflicts verbatim. Additive and default-null.
     */
    val reconciledApplicationInventory: ReconciledApplicationInventory? = null,
    /**
     * Optional extended device evidence (hardware, display, sensors, camera, audio,
     * radios, performance, system, and the security states that require a real query).
     *
     * Null means the extended collectors were not run - it does NOT mean the device
     * is free of any condition. Additive and default-null: legacy JSON still decodes.
     */
    val extended: ExtendedDeviceEvidence? = null,
)
