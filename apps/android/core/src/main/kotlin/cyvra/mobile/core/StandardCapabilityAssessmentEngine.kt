package cyvra.mobile.core

/**
 * Standard Capability Assessment Engine in :core.
 * Evaluates standard Android device capabilities across ADB, Platform, and OEM boundaries.
 * Enforces honesty invariants:
 * - Factory reset is platform capability, not universal NIST Purge.
 * - Device Owner wipe requires Device Owner active state.
 * - Enterprise / OEM secure erase requires verified OEM service adapter.
 * - SOH / Telephony require privileged access.
 */
class StandardCapabilityAssessmentEngine(
    private val oemResolver: OemCapabilityResolver = DefaultOemCapabilityResolver(),
) : CapabilityAssessmentEngine {

    override fun assess(
        profile: CapabilityProfile,
        evidence: GenericDeviceEvidence?,
    ): DeviceCapabilityAssessment {
        val capabilities = mutableListOf<DeviceCapabilityItem>()
        val limitations = mutableListOf<String>()

        val isAdbReady = profile.adbState == "ADB_AUTHORIZED" || profile.accessLevel.contains("ADB")
        val apiLevel = profile.sdkInt
        val oemAdapter = oemResolver.resolveAdapter(profile.manufacturer, profile.model)
        val isOemSupported = oemResolver.isSupportedOem(profile.manufacturer)

        // 1. Generic ADB Inspection
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "ADB_DEVICE_INSPECTION",
                displayName = "Host ADB Device Inspection",
                status = if (isAdbReady) CapabilityStatus.SUPPORTED else CapabilityStatus.REQUIRES_PERMISSION,
                requiredTier = RequiredAccessTier.L2_HOST_ADB,
                isAvailable = isAdbReady,
                reason = if (isAdbReady) null else "ADB interface not authorized or unavailable",
            ),
        )

        // 2. Battery Diagnostic Basic
        val hasBatteryEvidence = evidence?.battery?.levelPercent?.status == EvidenceStatus.AVAILABLE
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "BATTERY_BASIC_DIAGNOSTIC",
                displayName = "Standard Battery Metrics",
                status = if (isAdbReady) CapabilityStatus.SUPPORTED else CapabilityStatus.UNSUPPORTED,
                requiredTier = RequiredAccessTier.L2_HOST_ADB,
                isAvailable = isAdbReady,
                reason = if (isAdbReady) null else "Requires ADB authorization",
            ),
        )

        // 3. Battery SOH (Health State of Health)
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "BATTERY_SOH_METRIC",
                displayName = "Battery State of Health (SOH)",
                status = CapabilityStatus.REQUIRES_OEM_SERVICE,
                requiredTier = RequiredAccessTier.L4_OEM_PRIVILEGED,
                isAvailable = false,
                reason = "Battery SOH is a privileged manufacturer/enterprise diagnostic; not exposed via standard Android platform",
            ),
        )
        limitations.add("Battery SOH metric withheld without privileged manufacturer contract")

        // 4. Telephony / Hardware Identifiers (IMEI / Hardware Serial)
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "HARDWARE_IDENTIFIERS_TELEPHONY",
                displayName = "Telephony IMEI / Hardware Serial Access",
                status = CapabilityStatus.REQUIRES_PERMISSION,
                requiredTier = RequiredAccessTier.L3_DEVICE_OWNER,
                isAvailable = false,
                reason = "Modern Android (API 29+) restricts persistent hardware serial and IMEI to carrier/privileged apps",
            ),
        )
        limitations.add("Hardware IMEI/Serial non-accessible over non-privileged interfaces (§20)")

        // 5. Scoped Storage / User Data Inspection
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "SCOPED_STORAGE_ENFORCEMENT",
                displayName = "Filesystem Scoped Storage Access",
                status = CapabilityStatus.PARTIAL,
                requiredTier = RequiredAccessTier.L2_HOST_ADB,
                isAvailable = isAdbReady,
                reason = "Storage statistics available via df; arbitrary crawling restricted by platform security (§22)",
            ),
        )

        // 6. Platform Factory Reset (Purge / Reset)
        val isDeviceOwnerActive = evidence?.security?.deviceOwnerActive?.value == true
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "PLATFORM_FACTORY_RESET",
                displayName = "Platform Factory Reset Workflow",
                status = if (isAdbReady) CapabilityStatus.SUPPORTED else CapabilityStatus.REQUIRES_PERMISSION,
                requiredTier = RequiredAccessTier.L2_HOST_ADB,
                isAvailable = isAdbReady,
                reason = if (isAdbReady) null else "ADB authorization required for orchestrated reset trigger",
            ),
        )

        // 7. Device Owner Wipe
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "DEVICE_OWNER_WIPE",
                displayName = "Device Policy Manager Device Owner Wipe",
                status = if (isDeviceOwnerActive) CapabilityStatus.SUPPORTED else CapabilityStatus.REQUIRES_DEVICE_OWNER,
                requiredTier = RequiredAccessTier.L3_DEVICE_OWNER,
                isAvailable = isDeviceOwnerActive,
                reason = if (isDeviceOwnerActive) null else "CYVRA is not active Device Owner on standard consumer device (§32)",
            ),
        )
        if (!isDeviceOwnerActive) {
            limitations.add("Device Owner wipe unavailable on standard consumer device")
        }

        // 8. OEM Proprietary Secure Erase
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "OEM_PROPRIETARY_SECURE_ERASE",
                displayName = "OEM Hardware-Backed Secure Erase",
                status = if (isOemSupported && oemAdapter != null) CapabilityStatus.SUPPORTED else CapabilityStatus.REQUIRES_OEM_SERVICE,
                requiredTier = RequiredAccessTier.L4_OEM_PRIVILEGED,
                isAvailable = isOemSupported && oemAdapter != null,
                reason = if (isOemSupported && oemAdapter != null) null else "No verified OEM hardware adapter configured for ${profile.manufacturer}",
            ),
        )
        if (!isOemSupported) {
            limitations.add("OEM proprietary erase unavailable; falling back to verified generic platform reset")
        }

        // 9. Cryptographic Erase Direct Invocation
        capabilities.add(
            DeviceCapabilityItem(
                capabilityKey = "CRYPTOGRAPHIC_ERASE_DIRECT",
                displayName = "Direct Cryptographic Key Deletion",
                status = CapabilityStatus.UNSUPPORTED,
                requiredTier = RequiredAccessTier.L4_OEM_PRIVILEGED,
                isAvailable = false,
                reason = "Direct cryptographic key wipe not exposed through non-privileged host interfaces (§33)",
            ),
        )

        val recommendedPurge = if (isAdbReady) {
            "PLATFORM_FACTORY_RESET"
        } else {
            "NONE_AUTHORIZATION_REQUIRED"
        }

        return DeviceCapabilityAssessment(
            manufacturer = profile.manufacturer,
            model = profile.model,
            apiLevel = apiLevel,
            isOemAdapterAvailable = isOemSupported && oemAdapter != null,
            resolvedOemAdapter = oemAdapter,
            capabilities = capabilities,
            recommendedPurgeAction = recommendedPurge,
            isPostPurgeVerificationRequired = true,
            limitations = limitations,
        )
    }
}
