package cyvra.mobile.host.compatibility

import cyvra.mobile.core.CompatibilityMatrixEvaluator
import cyvra.mobile.core.CompatibilityTierLevel
import cyvra.mobile.core.DeviceCompatibilityRecord
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.OemFamily
import cyvra.mobile.core.TierAssessmentResult
import cyvra.mobile.host.transport.AdbClient

/**
 * Host-side validator for evaluating Android device compatibility against
 * the frozen multi-OEM matrix (Windows 10/11 host, Android 8–16, OEM test pool).
 * Adheres to Freeze Guide §41, §42, and TEST_MATRIX.md.
 */
class HostCompatibilityValidator(
    private val adbClient: AdbClient? = null,
) {

    /**
     * Validates a device profile and evidence into a multi-tier compatibility record.
     */
    fun evaluate(
        manufacturer: String,
        model: String,
        apiLevel: Int,
        androidVersion: String,
        isUsbConnected: Boolean,
        isAdbAuthorized: Boolean,
        evidence: GenericDeviceEvidence? = null,
        hasComponentEvidence: Boolean = false,
        isSanitizationAuthorized: Boolean = false,
        isPostResetVerified: Boolean = false,
    ): DeviceCompatibilityRecord {
        return CompatibilityMatrixEvaluator.evaluateDevice(
            manufacturer = manufacturer,
            model = model,
            apiLevel = apiLevel,
            androidVersion = androidVersion,
            isUsbConnected = isUsbConnected,
            isAdbAuthorized = isAdbAuthorized,
            hasEvidence = evidence != null,
            hasComponentEvidence = hasComponentEvidence,
            isSanitizationAuthorized = isSanitizationAuthorized,
            isPostResetVerified = isPostResetVerified,
        )
    }

    /**
     * Verifies whether host operating system environment is supported (Windows 10/11 64-bit baseline).
     */
    fun isHostPlatformSupported(): Boolean {
        val osName = System.getProperty("os.name")?.lowercase() ?: ""
        val osArch = System.getProperty("os.arch")?.lowercase() ?: ""
        val is64Bit = osArch.contains("64") || osArch.contains("arm64") || osArch.contains("aarch64")

        // Supported: Windows 10/11 64-bit or Linux 64-bit CI baseline
        return (osName.contains("windows") || osName.contains("linux")) && is64Bit
    }
}
