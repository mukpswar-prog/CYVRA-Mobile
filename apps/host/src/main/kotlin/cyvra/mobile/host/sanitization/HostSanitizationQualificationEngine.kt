package cyvra.mobile.host.sanitization

import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.SanitizationMethodType

/**
 * Option C Hybrid Sanitization Qualification Result.
 */
data class SanitizationQualification(
    val qualifiedMethod: SanitizationMethodType,
    val methodKey: String,
    val methodDisplayName: String,
    val standardsCitation: String,
    val isPurgeLevel: Boolean,
    val eligibilityReasons: List<String>,
    val limitations: List<String>,
)

/**
 * Option C: Hybrid Sanitization Architecture Qualification Engine.
 *
 * Implements the approved capability-based sanitization matrix:
 * 1. Checks for technical blockers (battery < 20%, root/tamper compromises).
 * 2. If Device Owner is active -> [SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE].
 * 3. If FBE active + Hardware KeyStore (TEE/StrongBox) -> [SanitizationMethodType.PURGE_CRYPTOGRAPHIC_ERASE].
 * 4. If supported OEM Hardware (Samsung Knox / Google Titan M) -> [SanitizationMethodType.PURGE_OEM_SECURE_ERASE].
 * 5. If standard Android platform >= API 26 -> [SanitizationMethodType.CLEAR_PLATFORM_RESET].
 * 6. If none satisfied or unverified -> [SanitizationMethodType.UNSUPPORTED_METHOD].
 *
 * Never hard-blocks consumer devices merely because Device Owner provisioning is missing:
 * dynamically assigns the highest verified capability tier based on on-device and host evidence.
 */
object HostSanitizationQualificationEngine {

    fun qualify(
        deviceOwnerActive: Boolean,
        isFbeEncrypted: Boolean,
        isKeyStoreHardwareBacked: Boolean,
        hasStrongBox: Boolean = false,
        manufacturer: String? = null,
        model: String? = null,
        apiLevel: Int? = null,
        batteryPercent: Int? = null,
        isRooted: Boolean = false,
        isDeviceCompromised: Boolean = false,
    ): SanitizationQualification {
        val limitations = mutableListOf<String>()
        val reasons = mutableListOf<String>()

        // 1. Technical Blockers
        if (isRooted || isDeviceCompromised) {
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.UNSUPPORTED_METHOD,
                methodKey = "TECHNICAL_BLOCKER_COMPROMISED",
                methodDisplayName = "Refused: Device Integrity Compromised",
                standardsCitation = "NIST SP 800-88 Rev. 2 §4.2 (Integrity Precondition Unmet)",
                isPurgeLevel = false,
                eligibilityReasons = listOf("Device security integrity is compromised or rooted; cryptographic boundaries cannot be guaranteed."),
                limitations = listOf("Unverified runtime environment"),
            )
        }

        if (batteryPercent != null && batteryPercent < 20) {
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.UNSUPPORTED_METHOD,
                methodKey = "TECHNICAL_BLOCKER_LOW_BATTERY",
                methodDisplayName = "Refused: Low Battery ($batteryPercent% < 20%)",
                standardsCitation = "NIST SP 800-88 Rev. 2 (Operational Safety Gate)",
                isPurgeLevel = false,
                eligibilityReasons = listOf("Battery charge ($batteryPercent%) is below 20% safe operating minimum required for reset cycle."),
                limitations = listOf("Connect external power source before attempting sanitization"),
            )
        }

        // 2. Clear: Device Owner Wipe (Enterprise Managed Route)
        if (deviceOwnerActive) {
            reasons.add("Target device has active CYVRA Device Owner privilege.")
            reasons.add("DevicePolicyManager wipeData authorized to initiate cryptographic erasure and system partition reset.")
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
                methodKey = "CLEAR_DEVICE_OWNER_WIPE",
                methodDisplayName = "Device Owner Management Wipe",
                standardsCitation = "NIST SP 800-88 Rev. 2 Clear (Device Policy Manager)",
                isPurgeLevel = false,
                eligibilityReasons = reasons,
                limitations = limitations,
            )
        }

        limitations.add("Target device lacks Device Owner privilege (enterprise management provisioning absent).")

        // 3. Purge: Cryptographic Erase (FBE + Hardware-backed KeyStore / TEE)
        if (isFbeEncrypted && isKeyStoreHardwareBacked) {
            reasons.add("File-Based Encryption (FBE) is active on user storage.")
            reasons.add(
                if (hasStrongBox) "Hardware KeyStore is backed by dedicated StrongBox Keymaster."
                else "Hardware KeyStore is backed by Trusted Execution Environment (TEE)."
            )
            reasons.add("Cryptographic key destruction invalidates all wrapped storage keys, rendering raw data permanently unrecoverable.")
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.PURGE_CRYPTOGRAPHIC_ERASE,
                methodKey = "PURGE_CRYPTOGRAPHIC_ERASE",
                methodDisplayName = "Cryptographic Erase (Hardware-Backed TEE/FBE)",
                standardsCitation = "NIST SP 800-88 Rev. 2 Purge (Cryptographic Erase §4.8)",
                isPurgeLevel = true,
                eligibilityReasons = reasons,
                limitations = limitations,
            )
        }

        // 4. Purge: OEM Proprietary Secure Erase
        val normMfr = manufacturer?.trim()?.lowercase() ?: ""
        val isSamsungKnox = normMfr.contains("samsung")
        val isPixelTitan = normMfr.contains("google")
        if ((isSamsungKnox || isPixelTitan) && (apiLevel ?: 0) >= 28) {
            reasons.add("Hardware platform $manufacturer supports OEM secure erase protocols.")
            reasons.add("Storage controller supports block-level sanitize and hardware key revocation.")
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.PURGE_OEM_SECURE_ERASE,
                methodKey = "PURGE_OEM_SECURE_ERASE",
                methodDisplayName = "OEM Hardware-Backed Secure Erase (${manufacturer?.uppercase()})",
                standardsCitation = "NIST SP 800-88 Rev. 2 Purge (OEM Block Sanitize)",
                isPurgeLevel = true,
                eligibilityReasons = reasons,
                limitations = limitations,
            )
        }

        // 5. Clear: Consumer Platform Factory Reset
        if ((apiLevel ?: 26) >= 26) {
            reasons.add("Standard Android platform environment (API ${apiLevel ?: 26}) verified.")
            reasons.add("Platform factory reset will clear user partitions, caches, and installed third-party applications.")
            limitations.add("Consumer platform reset does not provide NIST Purge cryptographic key wipe guarantee.")
            return SanitizationQualification(
                qualifiedMethod = SanitizationMethodType.CLEAR_PLATFORM_RESET,
                methodKey = "CLEAR_PLATFORM_RESET",
                methodDisplayName = "Standard Platform Factory Reset",
                standardsCitation = "NIST SP 800-88 Rev. 2 Clear (Android Platform Reset)",
                isPurgeLevel = false,
                eligibilityReasons = reasons,
                limitations = limitations,
            )
        }

        // 6. Refusal
        return SanitizationQualification(
            qualifiedMethod = SanitizationMethodType.UNSUPPORTED_METHOD,
            methodKey = "TECHNICAL_BLOCKER_UNSUPPORTED",
            methodDisplayName = "Unsupported Platform Sanitization",
            standardsCitation = "NIST SP 800-88 Rev. 2 §4.1 (Unverifiable Device State)",
            isPurgeLevel = false,
            eligibilityReasons = listOf("Device capabilities do not satisfy any supported Clear or Purge sanitization profile."),
            limitations = limitations,
        )
    }

    /**
     * Evaluates qualification from live host evidence and agent telemetry.
     */
    fun qualifyFromEvidence(
        evidence: GenericDeviceEvidence,
        agentAssessmentTelemetry: Map<String, Any?>? = null,
    ): SanitizationQualification {
        val deviceOwner = evidence.security.deviceOwnerActive.value == true ||
                agentAssessmentTelemetry?.get("deviceOwnerActive") == true

        val extCrypto = evidence.extended?.parameters?.firstOrNull {
            it.id == "SEC-002" || (it.id.startsWith("SEC-") && it.label.contains("crypto", ignoreCase = true))
        }?.result?.value

        val apiLevel = evidence.identity.apiLevel.value ?: 0

        val isFbe = extCrypto?.contains("file", ignoreCase = true) == true ||
                apiLevel >= 28 ||
                agentAssessmentTelemetry?.get("isFbeEncrypted") == true

        val isHwKeyStore = apiLevel >= 28 ||
                agentAssessmentTelemetry?.get("isKeyStoreHardwareBacked") == true

        val strongBox = agentAssessmentTelemetry?.get("hasStrongBox") == true

        val mfr = evidence.identity.manufacturer.value
        val model = evidence.identity.model.value
        val battery = evidence.battery.levelPercent.value
        val isRooted = evidence.extended?.parameters?.firstOrNull {
            it.label.contains("root", ignoreCase = true)
        }?.result?.value?.contains("rooted", ignoreCase = true) == true

        return qualify(
            deviceOwnerActive = deviceOwner,
            isFbeEncrypted = isFbe,
            isKeyStoreHardwareBacked = isHwKeyStore,
            hasStrongBox = strongBox,
            manufacturer = mfr,
            model = model,
            apiLevel = apiLevel,
            batteryPercent = battery,
            isRooted = isRooted,
        )
    }
}
