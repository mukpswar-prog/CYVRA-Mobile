package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * OEM security suite attestation tier.
 */
@Serializable
enum class OemSecuritySuite {
    STANDARD_ANDROID_KEYSTORE,
    SAMSUNG_KNOX,
    XIAOMI_TEE,
    OPPO_OESTORE,
    MOTO_THINKSHIELD,
    TITAN_M_CHIP,
}

/**
 * OEM-specific diagnostic capability fact.
 */
@Serializable
data class OemCapabilityFeature(
    val featureKey: String,
    val displayName: String,
    val isSupported: Boolean,
    val requiresPrivilegedContract: Boolean,
    val accessDescription: String,
)

/**
 * Complete profile of a resolved OEM device adapter.
 */
@Serializable
data class OemAdapterProfile(
    val adapterId: String,
    val oemFamily: OemFamily,
    val canonicalManufacturer: String,
    val customSkinName: String? = null,           // e.g. "One UI 6.1", "HyperOS 1.0", "ColorOS 14", "MyUX"
    val securitySuite: OemSecuritySuite,
    val isKnoxSupported: Boolean = false,
    val knoxWarrantyBitState: String? = null,      // e.g. "0x0" (uncompromised), "0x1" (tripped), "RESTRICTED"
    val batteryHealthProtocol: String,             // e.g. "sec_bat_health", "qcom_fg_health", "generic_dumpsys"
    val supportedResetMethods: List<SanitizationMethodType> = emptyList(),
    val features: List<OemCapabilityFeature> = emptyList(),
)
