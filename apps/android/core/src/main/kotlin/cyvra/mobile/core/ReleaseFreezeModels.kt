package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Production release artifact type.
 */
@Serializable
enum class ReleaseArtifactType {
    WINDOWS_DESKTOP_SETUP_EXE,
    WINDOWS_DESKTOP_MSI,
    STANDALONE_PORTABLE_ZIP,
    ANDROID_COMPANION_APK,
}

/**
 * Code signing signature algorithm & certificate verification status.
 */
@Serializable
enum class CodeSignStatus {
    AUTHENTICODE_VERIFIED,
    SELF_SIGNED_TEST,
    UNSIGNED,
    INVALID_DIGEST,
}

/**
 * Digital release artifact descriptor (§45, §80 / Phase 24).
 */
@Serializable
data class ProductionReleaseArtifact(
    val filename: String,
    val artifactType: ReleaseArtifactType,
    val sizeBytes: Long,
    val sha256Digest: String,
    val codeSignStatus: CodeSignStatus,
    val publisherSubject: String = "CN=CYVORIQ Solutions Private Limited, O=CYVORIQ Solutions Private Limited, C=IN",
    val timestampAuthority: String = "DigiCert Timestamp Responder 2026",
    val downloadUrl: String,
)

/**
 * Final Signed Production Release Freeze Baseline Record (§80, §81 / Phase 24).
 */
@Serializable
data class ProductionReleaseFreezeRecord(
    val releaseTag: String = "v3.2.2-release",
    val frozenAt: String = java.time.Instant.now().toString(),
    val releaseTitle: String = "CYVRA Mobile Workstation — Professional Android Diagnostics & Data Purge",
    val targetPlatform: String = "Windows 10 / Windows 11 x64",
    val runtimeMinimum: String = "Microsoft Edge WebView2 Evergreen + VC++ 2015-2022 x64",
    val bundledPlatformToolsVersion: String = "35.0.2",
    val minimumAndroidVersion: String = "Android 8.0 (API Level 26)",
    val primaryArtifact: ProductionReleaseArtifact,
    val secondaryArtifacts: List<ProductionReleaseArtifact> = emptyList(),
    val totalPhasesCompleted: Int = 24,
    val isProductionFrozen: Boolean = true,
    val freezeTamperProofSeal: String,
)
