package cyvra.mobile.host.update

import cyvra.mobile.core.UpdateArtifactManifest
import cyvra.mobile.core.UpdateChannel
import cyvra.mobile.core.UpdateReleaseType
import cyvra.mobile.core.UpdateStagingStatus
import cyvra.mobile.core.UpdateVerificationStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostUpdateEngineTest {

    private val engine = HostUpdateEngine(trustedKeyIdentifier = "CYVORIQ-UPDATE-KEY-PROD-2026")

    private fun createSampleManifest(payloadBytes: ByteArray): UpdateArtifactManifest {
        val hash = engine.computeSha256(payloadBytes)
        return UpdateArtifactManifest(
            version = "3.2.2-g5",
            minimumHostVersion = "3.0.0",
            releaseChannel = UpdateChannel.STABLE,
            releaseType = UpdateReleaseType.DELTA,
            downloadUrl = "https://updates.cyvoriq.co.in/mobile/v3.2.2/delta.pkg",
            packageSizeBytes = payloadBytes.size.toLong(),
            sha256Digest = hash,
            signatureAlgorithm = "Ed25519",
            manifestSignature = "SIG_ED25519_valid_signature_hash_bytes",
            releaseNotes = listOf("Android 15 compatibility", "Improved camera diagnostic probes"),
        )
    }

    @Test
    fun detectsUpdateAvailabilityCorrectly() {
        val payload = "dummy package content".toByteArray()
        val manifest = createSampleManifest(payload)

        // 3.2.1-g5 < 3.2.2-g5 -> true
        assertTrue(engine.isUpdateAvailable("3.2.1-g5", manifest))

        // 3.2.2-g5 == 3.2.2-g5 -> false
        assertFalse(engine.isUpdateAvailable("3.2.2-g5", manifest))

        // 3.3.0-g5 > 3.2.2-g5 -> false
        assertFalse(engine.isUpdateAvailable("3.3.0-g5", manifest))
    }

    @Test
    fun enforcesMinimumHostVersionConstraint() {
        val payload = "dummy package content".toByteArray()
        val manifest = createSampleManifest(payload).copy(minimumHostVersion = "3.2.0")

        assertTrue(engine.satisfiesMinimumHostVersion("3.2.1-g5", manifest))
        assertFalse(engine.satisfiesMinimumHostVersion("3.1.9-g5", manifest))
    }

    @Test
    fun stagesValidUpdateSuccessfully() {
        val payload = "authentic secure delta package".toByteArray()
        val manifest = createSampleManifest(payload)

        val record = engine.stageUpdate(
            currentVersion = "3.2.1-g5",
            manifest = manifest,
            packageBytes = payload,
        )

        assertEquals(UpdateStagingStatus.STAGED_READY_FOR_RESTART, record.stagingStatus)
        assertEquals(UpdateVerificationStatus.SIGNATURE_VALID, record.verificationStatus)
        assertEquals("3.2.2-g5", record.targetVersion)
        assertTrue(record.restartRequired)
        assertTrue(record.stagedPackagePath.endsWith("update.delta"))
    }

    @Test
    fun rejectsTamperedPayloadWithHashMismatch() {
        val payload = "authentic secure delta package".toByteArray()
        val manifest = createSampleManifest(payload)
        val tamperedPayload = "tampered payload with malicious code".toByteArray()

        val record = engine.stageUpdate(
            currentVersion = "3.2.1-g5",
            manifest = manifest,
            packageBytes = tamperedPayload,
        )

        assertEquals(UpdateStagingStatus.FAILED, record.stagingStatus)
        assertEquals(UpdateVerificationStatus.HASH_MISMATCH, record.verificationStatus)
        assertFalse(record.restartRequired)
    }

    @Test
    fun rejectsUnsignedOrForgedManifest() {
        val payload = "authentic secure delta package".toByteArray()
        val unsignedManifest = createSampleManifest(payload).copy(manifestSignature = "")

        val record = engine.stageUpdate(
            currentVersion = "3.2.1-g5",
            manifest = unsignedManifest,
            packageBytes = payload,
        )

        assertEquals(UpdateStagingStatus.FAILED, record.stagingStatus)
        assertEquals(UpdateVerificationStatus.SIGNATURE_INVALID, record.verificationStatus)
        assertFalse(record.restartRequired)
    }

    @Test
    fun supportsSafeRollbackOfStagedUpdate() {
        val payload = "authentic secure delta package".toByteArray()
        val manifest = createSampleManifest(payload)
        val stagedRecord = engine.stageUpdate("3.2.1-g5", manifest, payload)

        val rolledBack = engine.rollbackStagedUpdate(stagedRecord)
        assertEquals(UpdateStagingStatus.ROLLED_BACK, rolledBack.stagingStatus)
        assertFalse(rolledBack.restartRequired)
    }
}
