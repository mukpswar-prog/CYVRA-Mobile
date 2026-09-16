package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReleaseFreezeModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesProductionReleaseFreezeRecord() {
        val exeArtifact = ProductionReleaseArtifact(
            filename = "CYVRA-Mobile-Setup-v3.2.2-x64.exe",
            artifactType = ReleaseArtifactType.WINDOWS_DESKTOP_SETUP_EXE,
            sizeBytes = 84934656L,
            sha256Digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            codeSignStatus = CodeSignStatus.AUTHENTICODE_VERIFIED,
            downloadUrl = "https://cyvoriq.co.in/downloads/windows/CYVRA-Mobile-Setup-v3.2.2-x64.exe",
        )

        val record = ProductionReleaseFreezeRecord(
            releaseTag = "v3.2.2-release",
            primaryArtifact = exeArtifact,
            totalPhasesCompleted = 24,
            isProductionFrozen = true,
            freezeTamperProofSeal = "c5b2ce8e30b65bf73fd714ec8700247fe0533519892cfa72702a4bf745cb57a5",
        )

        val encoded = json.encodeToString(record)
        val decoded = json.decodeFromString<ProductionReleaseFreezeRecord>(encoded)

        assertEquals("v3.2.2-release", decoded.releaseTag)
        assertTrue(decoded.isProductionFrozen)
        assertEquals(24, decoded.totalPhasesCompleted)
        assertEquals(ReleaseArtifactType.WINDOWS_DESKTOP_SETUP_EXE, decoded.primaryArtifact.artifactType)
        assertEquals(CodeSignStatus.AUTHENTICODE_VERIFIED, decoded.primaryArtifact.codeSignStatus)
    }
}
