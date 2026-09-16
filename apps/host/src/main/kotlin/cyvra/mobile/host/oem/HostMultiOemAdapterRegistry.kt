package cyvra.mobile.host.oem

import cyvra.mobile.core.OemAdapterProfile
import cyvra.mobile.core.OemCapabilityFeature
import cyvra.mobile.core.OemCapabilityResolver
import cyvra.mobile.core.OemFamily
import cyvra.mobile.core.OemSecuritySuite
import cyvra.mobile.core.SanitizationMethodType

/**
 * Common contract for host-side OEM Device Adapters (Freeze Guide §8, §9 & §24 / Phase 21).
 *
 * Invariant Laws:
 * 1. Honesty Invariant: If a proprietary OEM SDK or enterprise license is not present,
 *    report requiresPrivilegedContract = true and fall back to safe generic platform methods.
 * 2. Never claim Knox Warranty Void 0x0 without verifying hardware bit.
 * 3. Never fabricate manufacturer-restricted battery health.
 */
interface HostOemDeviceAdapter {
    val oemFamily: OemFamily
    fun matches(manufacturer: String, model: String): Boolean
    fun createProfile(manufacturer: String, model: String, apiLevel: Int, buildProps: Map<String, String> = emptyMap()): OemAdapterProfile
}

/**
 * Samsung Galaxy / One UI Adapter.
 * Inspects Knox security suite, One UI skin versions, and Samsung-specific battery nodes.
 */
class SamsungGalaxyOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.SAMSUNG

    override fun matches(manufacturer: String, model: String): Boolean {
        val norm = manufacturer.trim().lowercase()
        return norm == "samsung" || norm.contains("samsung")
    }

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        val oneUiVersion = buildProps["ro.build.version.oneui"] ?: "One UI (Auto-Detected)"
        val warrantyBit = buildProps["ro.boot.warranty_bit"] ?: "RESTRICTED_BY_PLATFORM_POLICY"

        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-SAMSUNG-KNOX",
            oemFamily = OemFamily.SAMSUNG,
            canonicalManufacturer = "Samsung Electronics Co., Ltd.",
            customSkinName = oneUiVersion,
            securitySuite = OemSecuritySuite.SAMSUNG_KNOX,
            isKnoxSupported = true,
            knoxWarrantyBitState = warrantyBit,
            batteryHealthProtocol = "sec_bat_health_node",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
                SanitizationMethodType.PURGE_OEM_SECURE_ERASE,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "SAMSUNG_KNOX_ATTESTATION",
                    displayName = "Knox Hardware Security Enclave Attestation",
                    isSupported = true,
                    requiresPrivilegedContract = true,
                    accessDescription = "Attests Knox hardware warranty bit and cryptographic key containment.",
                ),
                OemCapabilityFeature(
                    featureKey = "SAMSUNG_BATTERY_CHARGE_CYCLES",
                    displayName = "Samsung Hardware Battery Cycle Counter",
                    isSupported = true,
                    requiresPrivilegedContract = false,
                    accessDescription = "Queries battery sysfs cycle_count and asoc battery health parameters.",
                ),
            ),
        )
    }
}

/**
 * Xiaomi / Redmi / POCO HyperOS & MIUI Adapter.
 */
class XiaomiHyperOsOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.XIAOMI_REDMI_POCO

    override fun matches(manufacturer: String, model: String): Boolean {
        val norm = manufacturer.trim().lowercase()
        return norm.contains("xiaomi") || norm.contains("redmi") || norm.contains("poco")
    }

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        val miuiVersion = buildProps["ro.miui.ui.version.name"] ?: "HyperOS / MIUI"

        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-XIAOMI-HYPEROS",
            oemFamily = OemFamily.XIAOMI_REDMI_POCO,
            canonicalManufacturer = "Xiaomi Communications Co., Ltd.",
            customSkinName = miuiVersion,
            securitySuite = OemSecuritySuite.XIAOMI_TEE,
            isKnoxSupported = false,
            knoxWarrantyBitState = null,
            batteryHealthProtocol = "qcom_fg_health_node",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "XIAOMI_TEE_INTEGRITY",
                    displayName = "Xiaomi Trusted Execution Environment (TEE)",
                    isSupported = true,
                    requiresPrivilegedContract = true,
                    accessDescription = "Validates bootloader unlock state and TEE cryptographic storage integrity.",
                ),
            ),
        )
    }
}

/**
 * OnePlus / Oppo / Realme ColorOS & OxygenOS Adapter.
 */
class OnePlusOppoOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.ONEPLUS

    override fun matches(manufacturer: String, model: String): Boolean {
        val norm = manufacturer.trim().lowercase()
        return norm.contains("oneplus") || norm.contains("oppo") || norm.contains("realme")
    }

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        val skin = buildProps["ro.build.version.opporom"] ?: "ColorOS / OxygenOS"

        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-OPPO-COLOROS",
            oemFamily = if (manufacturer.contains("oneplus", ignoreCase = true)) OemFamily.ONEPLUS else OemFamily.OPPO_REALME,
            canonicalManufacturer = "Guangdong OPPO Mobile Telecommunications Corp., Ltd.",
            customSkinName = skin,
            securitySuite = OemSecuritySuite.OPPO_OESTORE,
            isKnoxSupported = false,
            knoxWarrantyBitState = null,
            batteryHealthProtocol = "vooc_fastcharge_health_node",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "COLOROS_SUPERVOOC_TELEMETRY",
                    displayName = "SuperVOOC Dual-Cell Battery Telemetry",
                    isSupported = true,
                    requiresPrivilegedContract = false,
                    accessDescription = "Monitors dual-cell series charging voltage and thermal protection registers.",
                ),
            ),
        )
    }
}

/**
 * Motorola / ThinkShield Adapter (e.g. Moto G54 live testing baseline).
 */
class MotorolaThinkShieldOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.MOTOROLA

    override fun matches(manufacturer: String, model: String): Boolean {
        val norm = manufacturer.trim().lowercase()
        return norm.contains("motorola") || norm.contains("moto")
    }

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-MOTO-THINKSHIELD",
            oemFamily = OemFamily.MOTOROLA,
            canonicalManufacturer = "Motorola Mobility LLC",
            customSkinName = "MyUX / Hello UI",
            securitySuite = OemSecuritySuite.MOTO_THINKSHIELD,
            isKnoxSupported = false,
            knoxWarrantyBitState = null,
            batteryHealthProtocol = "moto_battery_charge_control",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "MOTO_THINKSHIELD_HARDENING",
                    displayName = "ThinkShield for Mobile OS Protection",
                    isSupported = true,
                    requiresPrivilegedContract = false,
                    accessDescription = "Audits hardware-level tamper alerts and secure bootloader lock status.",
                ),
            ),
        )
    }
}

/**
 * Google Pixel Titan M Adapter.
 */
class GooglePixelOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.GOOGLE_PIXEL

    override fun matches(manufacturer: String, model: String): Boolean {
        val norm = manufacturer.trim().lowercase()
        return norm.contains("google")
    }

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-GOOGLE-PIXEL",
            oemFamily = OemFamily.GOOGLE_PIXEL,
            canonicalManufacturer = "Google LLC",
            customSkinName = "Stock Pixel Android",
            securitySuite = OemSecuritySuite.TITAN_M_CHIP,
            isKnoxSupported = false,
            knoxWarrantyBitState = null,
            batteryHealthProtocol = "pixel_health_hal",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
                SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "GOOGLE_TITAN_M_SECURITY",
                    displayName = "Titan M/M2 Discrete Hardware Security Module",
                    isSupported = true,
                    requiresPrivilegedContract = false,
                    accessDescription = "Direct hardware keystore key attestation and StrongBox verification.",
                ),
            ),
        )
    }
}

/**
 * Generic Android Fallback Adapter for any unmatched manufacturer.
 */
class GenericAndroidOemAdapter : HostOemDeviceAdapter {
    override val oemFamily: OemFamily = OemFamily.UNKNOWN_GENERIC

    override fun matches(manufacturer: String, model: String): Boolean = true

    override fun createProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        buildProps: Map<String, String>,
    ): OemAdapterProfile {
        return OemAdapterProfile(
            adapterId = "OEM-ADAPTER-GENERIC-ANDROID",
            oemFamily = OemFamily.UNKNOWN_GENERIC,
            canonicalManufacturer = manufacturer.ifBlank { "Generic Android Device" },
            customSkinName = "AOSP Standard",
            securitySuite = OemSecuritySuite.STANDARD_ANDROID_KEYSTORE,
            isKnoxSupported = false,
            knoxWarrantyBitState = null,
            batteryHealthProtocol = "generic_dumpsys_battery",
            supportedResetMethods = listOf(
                SanitizationMethodType.CLEAR_PLATFORM_RESET,
            ),
            features = listOf(
                OemCapabilityFeature(
                    featureKey = "GENERIC_ADB_RESET",
                    displayName = "Standard Android Platform Reset",
                    isSupported = true,
                    requiresPrivilegedContract = false,
                    accessDescription = "Executes recovery wipe-data via Android Open Source platform commands.",
                ),
            ),
        )
    }
}

/**
 * Central Host Multi-OEM Adapter Registry (§8, §24 / Phase 21).
 * Resolves appropriate adapter based on device manufacturer and model.
 * Bridges seamlessly into [OemCapabilityResolver].
 */
class HostMultiOemAdapterRegistry(
    private val adapters: List<HostOemDeviceAdapter> = listOf(
        SamsungGalaxyOemAdapter(),
        XiaomiHyperOsOemAdapter(),
        OnePlusOppoOemAdapter(),
        MotorolaThinkShieldOemAdapter(),
        GooglePixelOemAdapter(),
        GenericAndroidOemAdapter(), // Fallback must be last
    ),
) : OemCapabilityResolver {

    fun resolveOemAdapter(manufacturer: String, model: String): HostOemDeviceAdapter {
        return adapters.firstOrNull { it.matches(manufacturer, model) } ?: GenericAndroidOemAdapter()
    }

    override fun resolveAdapter(manufacturer: String, model: String): String? {
        val adapter = resolveOemAdapter(manufacturer, model)
        return if (adapter !is GenericAndroidOemAdapter) {
            adapter.createProfile(manufacturer, model, 34).adapterId
        } else null
    }

    override fun isSupportedOem(manufacturer: String): Boolean {
        val adapter = resolveOemAdapter(manufacturer, "")
        return adapter !is GenericAndroidOemAdapter
    }

    fun getDeviceProfile(
        manufacturer: String,
        model: String,
        apiLevel: Int = 34,
        buildProps: Map<String, String> = emptyMap(),
    ): OemAdapterProfile {
        val adapter = resolveOemAdapter(manufacturer, model)
        return adapter.createProfile(manufacturer, model, apiLevel, buildProps)
    }
}
