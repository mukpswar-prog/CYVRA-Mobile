package cyvra.mobile.host.release

import cyvra.mobile.core.CodeSignStatus
import cyvra.mobile.core.ReleaseArtifactType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HostReleaseFreezeEngineTest {

    private val engine = HostReleaseFreezeEngine()

    @Test
    fun createsValidProductionReleaseFreezeRecord() {
        val freeze = engine.createProductionReleaseFreeze()

        assertEquals("v3.2.2-release", freeze.releaseTag)
        assertTrue(freeze.isProductionFrozen)
        assertEquals(24, freeze.totalPhasesCompleted)
        assertEquals("35.0.2", freeze.bundledPlatformToolsVersion)
        assertEquals(ReleaseArtifactType.WINDOWS_DESKTOP_SETUP_EXE, freeze.primaryArtifact.artifactType)
        assertEquals(CodeSignStatus.AUTHENTICODE_VERIFIED, freeze.primaryArtifact.codeSignStatus)
        assertEquals(64, freeze.freezeTamperProofSeal.length)
        assertTrue(engine.verifyArtifactIntegrity(freeze.primaryArtifact))
    }

    @Test
    fun producesDeterministicFreezeSeal() {
        val hash1 = engine.computeSha256("cyvra-freeze-seal-sample")
        val hash2 = engine.computeSha256("cyvra-freeze-seal-sample")

        assertEquals(hash1, hash2)
    }
}
