package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UpdateModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesUpdateArtifactManifest() {
        val manifest = UpdateArtifactManifest(
            version = "3.2.2-g5",
            minimumHostVersion = "3.0.0",
            releaseChannel = UpdateChannel.STABLE,
            releaseType = UpdateReleaseType.DELTA,
            downloadUrl = "https://updates.cyvoriq.co.in/mobile/v3.2.2/delta.pkg",
            packageSizeBytes = 18452100L,
            sha256Digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            signatureAlgorithm = "Ed25519",
            manifestSignature = "SIG_ED25519_abcdef0123456789",
            releaseNotes = listOf("Android 15 and 16 preview compatibility", "Diagnostic collector speedup"),
            mandatoryUpdate = false,
        )

        val encoded = json.encodeToString(manifest)
        val decoded = json.decodeFromString<UpdateArtifactManifest>(encoded)

        assertEquals("3.2.2-g5", decoded.version)
        assertEquals(UpdateChannel.STABLE, decoded.releaseChannel)
        assertEquals(UpdateReleaseType.DELTA, decoded.releaseType)
        assertEquals(18452100L, decoded.packageSizeBytes)
        assertEquals(2, decoded.releaseNotes.size)
        assertTrue(decoded.manifestSignature.startsWith("SIG_ED25519_"))
    }

    @Test
    fun serializesAndDeserializesUpdateStagingRecord() {
        val record = UpdateStagingRecord(
            stagingId = "STG-UPD-001",
            targetVersion = "3.2.2-g5",
            sourceVersion = "3.2.1-g5",
            stagedPackagePath = "/opt/cyvra/updates/staged/3.2.2-g5/update.delta",
            sha256Digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            verificationStatus = UpdateVerificationStatus.SIGNATURE_VALID,
            stagingStatus = UpdateStagingStatus.STAGED_READY_FOR_RESTART,
            restartRequired = true,
            rollbackBackupPath = "/opt/cyvra/updates/staged/backup-3.2.1-g5.tar.gz",
        )

        val encoded = json.encodeToString(record)
        val decoded = json.decodeFromString<UpdateStagingRecord>(encoded)

        assertEquals("STG-UPD-001", decoded.stagingId)
        assertEquals("3.2.2-g5", decoded.targetVersion)
        assertEquals(UpdateVerificationStatus.SIGNATURE_VALID, decoded.verificationStatus)
        assertEquals(UpdateStagingStatus.STAGED_READY_FOR_RESTART, decoded.stagingStatus)
        assertTrue(decoded.restartRequired)
    }
}
