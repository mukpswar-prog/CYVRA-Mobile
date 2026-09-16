package cyvra.mobile.core

/**
 * Standard provider abstraction for device evidence collection.
 * Follows §17: Independent collectors. Failure in one must not crash the scan.
 */
interface DeviceEvidenceProvider {
    fun collectIdentity(): DeviceIdentityEvidence
    fun collectBattery(): BatteryEvidence
    fun collectStorage(): StorageEvidence
    fun collectSecurity(): SecurityEvidence
    fun collectAll(): GenericDeviceEvidence
}

/**
 * Provider interface for device capabilities.
 */
interface DeviceCapabilityProvider {
    fun getCapabilityProfile(): CapabilityProfile
}

/**
 * OEM Capability Resolver interface.
 * Returns true only when a verified hardware capability adapter is available.
 */
interface OemCapabilityResolver {
    fun resolveAdapter(manufacturer: String, model: String): String?
    fun isSupportedOem(manufacturer: String): Boolean
}

/**
 * Default generic OEM resolver. Returns null/false until verified hardware exists (§9).
 */
class DefaultOemCapabilityResolver : OemCapabilityResolver {
    override fun resolveAdapter(manufacturer: String, model: String): String? = null
    override fun isSupportedOem(manufacturer: String): Boolean = false
}
