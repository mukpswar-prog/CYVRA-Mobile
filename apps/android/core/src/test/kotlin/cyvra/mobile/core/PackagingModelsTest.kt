package cyvra.mobile.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PackagingModelsTest {

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    @Test
    fun serializesAndDeserializesWindowsReleaseStagingManifest() {
        val platformTools = ControlledPlatformToolsBundle(
            adbVersion = "35.0.2",
            platformToolsRelease = "35.0.2-12147458",
            adbBinarySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            isBundledLocally = true,
            isPathOverrideRestricted = true,
        )

        val check = RuntimeDependencyCheck(
            componentName = "Microsoft Edge WebView2 Runtime",
            expectedVersion = ">= 109.0.1518.78",
            installedVersion = "126.0.2592.87",
            status = RuntimeComponentStatus.INSTALLED_AND_VERIFIED,
            isMandatory = true,
        )

        val manifest = WindowsReleaseStagingManifest(
            releaseId = "REL-WIN-001",
            version = "3.2.2-g5",
            installerType = WindowsInstallerType.TAURI_BUNDLE_NSIS,
            packageSizeBytes = 84210000L,
            packageSha256Digest = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            platformTools = platformTools,
            runtimeChecks = listOf(check),
            isReleaseReady = true,
        )

        val encoded = json.encodeToString(manifest)
        val decoded = json.decodeFromString<WindowsReleaseStagingManifest>(encoded)

        assertEquals("REL-WIN-001", decoded.releaseId)
        assertEquals("3.2.2-g5", decoded.version)
        assertEquals(WindowsInstallerType.TAURI_BUNDLE_NSIS, decoded.installerType)
        assertTrue(decoded.isReleaseReady)
        assertEquals("35.0.2", decoded.platformTools.adbVersion)
        assertEquals(RuntimeComponentStatus.INSTALLED_AND_VERIFIED, decoded.runtimeChecks[0].status)
    }
}
