package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Capability availability status per Freeze Guide §29.
 */
@Serializable
enum class CapabilityStatus {
    SUPPORTED,
    PARTIAL,
    UNSUPPORTED,
    REQUIRES_PERMISSION,
    REQUIRES_DEVICE_OWNER,
    REQUIRES_OEM_SERVICE,
    UNKNOWN,
}

/**
 * Access tier required for an operational capability.
 */
@Serializable
enum class RequiredAccessTier {
    L1_USB_DETECTION,
    L2_HOST_ADB,
    L3_DEVICE_OWNER,
    L4_OEM_PRIVILEGED,
}

/**
 * Evaluated capability item for a specific device feature / operation.
 */
@Serializable
data class DeviceCapabilityItem(
    val capabilityKey: String,
    val displayName: String,
    val status: CapabilityStatus,
    val requiredTier: RequiredAccessTier,
    val isAvailable: Boolean,
    val reason: String? = null,
    val source: String = "CORE_CAPABILITY_ENGINE",
)

/**
 * Aggregate capability assessment for an Android device.
 * Adheres to:
 * - §29 (Standard Android vs Device Owner vs OEM vs Platform Factory Reset)
 * - §32 (Device Owner / Enterprise wipe distinction)
 * - §37 (No fabricated data, no universal claims)
 * - §50 (No security control bypass)
 */
@Serializable
data class DeviceCapabilityAssessment(
    val assessedAt: String = java.time.Instant.now().toString(),
    val manufacturer: String,
    val model: String,
    val apiLevel: Int,
    val isOemAdapterAvailable: Boolean,
    val resolvedOemAdapter: String?,
    val capabilities: List<DeviceCapabilityItem>,
    val recommendedPurgeAction: String,
    val isPostPurgeVerificationRequired: Boolean = true,
    val limitations: List<String> = emptyList(),
)

/**
 * Pluggable OEM Adapter interface per Freeze Guide §8 and §9.
 * Real adapters only instantiated when verified on hardware.
 */
interface OemAdapter {
    val oemName: String
    fun isSupportedDevice(manufacturer: String, model: String): Boolean
    fun assessOemCapabilities(profile: CapabilityProfile): List<DeviceCapabilityItem>
}

/**
 * Core capability assessment engine interface.
 */
interface CapabilityAssessmentEngine {
    fun assess(
        profile: CapabilityProfile,
        evidence: GenericDeviceEvidence?,
    ): DeviceCapabilityAssessment
}
