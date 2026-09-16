package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Windows installer distribution artifact format per Customer Freeze Guide §43 & §45.
 */
@Serializable
enum class WindowsInstallerType {
    MSI_STANDALONE,
    EXE_BOOTSTRAPPER,
    TAURI_BUNDLE_NSIS,
    PORTABLE_ZIP,
}

/**
 * Required Windows runtime component verification status.
 */
@Serializable
enum class RuntimeComponentStatus {
    INSTALLED_AND_VERIFIED,
    BUNDLED_IN_INSTALLER,
    MISSING_CRITICAL,
    OPTIONAL_ABSENT,
}

/**
 * Verification record for an essential Windows runtime dependency.
 */
@Serializable
data class RuntimeDependencyCheck(
    val componentName: String,
    val expectedVersion: String,
    val installedVersion: String? = null,
    val status: RuntimeComponentStatus,
    val isMandatory: Boolean,
    val path: String? = null,
)

/**
 * Controlled Google Platform-Tools bundle descriptor (§44).
 */
@Serializable
data class ControlledPlatformToolsBundle(
    val adbVersion: String = "35.0.2",
    val platformToolsRelease: String = "35.0.2-12147458",
    val adbBinarySha256: String,
    val isBundledLocally: Boolean = true,
    val isPathOverrideRestricted: Boolean = true,
    val verifiedLocation: String = "C:\\Program Files\\CYVRA Mobile\\platform-tools\\adb.exe",
)

/**
 * Production Windows Release Staging Manifest (§43, §45 / Phase 22).
 */
@Serializable
data class WindowsReleaseStagingManifest(
    val releaseId: String,
    val version: String,
    val appTitle: String = "CYVRA Mobile Workstation",
    val installerType: WindowsInstallerType,
    val targetArchitecture: String = "x64",
    val minimumWindowsVersion: String = "Windows 10 Build 1803+ (x64)",
    val publisher: String = "CYVORIQ Solutions Pvt. Ltd.",
    val codeSigningAlgorithm: String = "SHA256withRSA / Authenticode",
    val certificateSubject: String = "CN=CYVORIQ Solutions Private Limited, O=CYVORIQ Solutions Private Limited, C=IN",
    val packageSizeBytes: Long,
    val packageSha256Digest: String,
    val platformTools: ControlledPlatformToolsBundle,
    val runtimeChecks: List<RuntimeDependencyCheck> = emptyList(),
    val stagedAt: String = java.time.Instant.now().toString(),
    val isReleaseReady: Boolean,
)
