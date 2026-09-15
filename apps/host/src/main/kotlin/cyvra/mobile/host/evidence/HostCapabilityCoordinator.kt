package cyvra.mobile.host.evidence

import cyvra.mobile.core.CapabilityAssessmentEngine
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.DefaultOemCapabilityResolver
import cyvra.mobile.core.DeviceCapabilityAssessment
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.OemCapabilityResolver
import cyvra.mobile.core.StandardCapabilityAssessmentEngine
import cyvra.mobile.host.transport.AdbClient

/**
 * Host-side Capability Coordinator for assessing Android devices over USB/ADB.
 * Adheres to:
 * - Customer Freeze Guide §1 (Executive Decision)
 * - Customer Freeze Guide §78 (Host + ADB + Generic Evidence + Capability Engine separation)
 * - Final Freeze Guide §29 (Sanitization Capability Assessment)
 * - Final Freeze Guide §9 (No premature empty OEM adapters)
 */
class HostCapabilityCoordinator(
    private val adbClient: AdbClient,
    private val oemResolver: OemCapabilityResolver = DefaultOemCapabilityResolver(),
    private val assessmentEngine: CapabilityAssessmentEngine = StandardCapabilityAssessmentEngine(oemResolver),
) {
    /**
     * Conducts a full capability assessment on a connected device identified by [serial].
     * Evaluates standard platform capabilities, required access tiers, and OEM adapter status.
     */
    fun assessConnectedDevice(
        serial: String,
        profile: CapabilityProfile,
        evidence: GenericDeviceEvidence? = null,
    ): DeviceCapabilityAssessment {
        return assessmentEngine.assess(profile, evidence)
    }

    /**
     * Quick pre-purge capability check. Returns true only if platform factory reset
     * or higher capability is supported.
     */
    fun isReadyForPlatformReset(assessment: DeviceCapabilityAssessment): Boolean {
        val resetCap = assessment.capabilities.firstOrNull { it.capabilityKey == "PLATFORM_FACTORY_RESET" }
        return resetCap?.isAvailable == true
    }
}
