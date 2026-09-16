package cyvra.mobile.host.packaging

import cyvra.mobile.core.RuntimeComponentStatus
import cyvra.mobile.core.WindowsInstallerType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostPackagingStagingEngineTest {

    private val engine = HostPackagingStagingEngine()

    @Test
    fun stagesValidReleaseWithAllRuntimeComponentsSatisfied() {
        val dummyInstaller = "CYVRA-Mobile-Setup-v3.2.2.exe-binary-content".toByteArray()
        val manifest = engine.stageRelease(
            version = "3.2.2-g5",
            installerBytes = dummyInstaller,
            installerType = WindowsInstallerType.TAURI_BUNDLE_NSIS,
        )

        assertEquals("3.2.2-g5", manifest.version)
        assertEquals(WindowsInstallerType.TAURI_BUNDLE_NSIS, manifest.installerType)
        assertTrue(manifest.isReleaseReady)
        assertEquals("35.0.2", manifest.platformTools.adbVersion)
        assertTrue(manifest.platformTools.isBundledLocally)
        assertTrue(manifest.platformTools.isPathOverrideRestricted)
        assertTrue(engine.verifyCodeSigningCertificate(manifest))
    }

    @Test
    fun flagsNotReleaseReadyWhenCriticalWebView2IsMissing() {
        val dummyInstaller = "installer-payload".toByteArray()
        val missingChecks = engine.evaluateRuntimeDependencies(
            isWebView2Installed = false,
            webView2Version = null,
        )

        val manifest = engine.stageRelease(
            version = "3.2.2-g5",
            installerBytes = dummyInstaller,
            runtimeChecks = missingChecks,
        )

        assertFalse(manifest.isReleaseReady)
        val webviewCheck = manifest.runtimeChecks.first { it.componentName.contains("WebView2") }
        assertEquals(RuntimeComponentStatus.MISSING_CRITICAL, webviewCheck.status)
    }

    @Test
    fun enforcesConsistentSha256ChecksumGeneration() {
        val payload1 = "reproducible installer payload bytes".toByteArray()
        val payload2 = "reproducible installer payload bytes".toByteArray()

        assertEquals(engine.computeSha256(payload1), engine.computeSha256(payload2))
    }
}
