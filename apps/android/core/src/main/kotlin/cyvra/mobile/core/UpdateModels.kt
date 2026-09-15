package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Release distribution channel per Master Workflow §16 & Part H.
 */
@Serializable
enum class UpdateChannel {
    STABLE,
    BETA,
    ENTERPRISE_LTS,
}

/**
 * Release package delivery type.
 */
@Serializable
enum class UpdateReleaseType {
    FULL,
    DELTA,
    HOTFIX,
}

/**
 * Cryptographic verification status for downloaded update artifacts.
 * Unsigned or tampered binaries are strictly rejected per §16 & §43.
 */
@Serializable
enum class UpdateVerificationStatus {
    UNVERIFIED,
    HASH_VERIFIED,
    SIGNATURE_VALID,
    SIGNATURE_INVALID,
    HASH_MISMATCH,
    CORRUPTED,
}

/**
 * Lifecycle state of the host update orchestrator.
 */
@Serializable
enum class UpdateStagingStatus {
    IDLE,
    CHECKING,
    UPDATE_AVAILABLE,
    DOWNLOADING,
    VERIFYING,
    STAGED_READY_FOR_RESTART,
    APPLYING_ON_RESTART,
    ROLLED_BACK,
    UP_TO_DATE,
    FAILED,
}

/**
 * Signed update manifest returned by CYVRA update service (GET /updates/manifest).
 */
@Serializable
data class UpdateArtifactManifest(
    val version: String,
    val minimumHostVersion: String = "3.0.0",
    val releaseChannel: UpdateChannel = UpdateChannel.STABLE,
    val releaseType: UpdateReleaseType = UpdateReleaseType.DELTA,
    val publishedAt: String = java.time.Instant.now().toString(),
    val downloadUrl: String,
    val packageSizeBytes: Long,
    val sha256Digest: String,
    val signatureAlgorithm: String = "Ed25519",
    val manifestSignature: String,
    val releaseNotes: List<String> = emptyList(),
    val mandatoryUpdate: Boolean = false,
)

/**
 * Record of an authenticated, cryptographically verified staged package
 * ready for safe application on next restart.
 */
@Serializable
data class UpdateStagingRecord(
    val stagingId: String,
    val targetVersion: String,
    val sourceVersion: String,
    val stagedPackagePath: String,
    val sha256Digest: String,
    val verificationStatus: UpdateVerificationStatus,
    val stagingStatus: UpdateStagingStatus,
    val stagedAt: String = java.time.Instant.now().toString(),
    val restartRequired: Boolean = true,
    val rollbackBackupPath: String? = null,
)
