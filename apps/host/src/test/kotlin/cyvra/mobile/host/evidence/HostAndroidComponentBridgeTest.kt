package cyvra.mobile.host.evidence

import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.ComponentBatteryExtras
import cyvra.mobile.core.ComponentDisplayMetrics
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostAndroidComponentBridgeTest {

    private val json = Json { prettyPrint = true }

    private val sampleLifecycleUuid = "11111111-2222-4333-8444-555555555555"
    private val sampleSessionUuid = "22222222-3333-4444-8555-666666666666"

    private fun createSamplePayload(): AndroidComponentEvidencePayload {
        return AndroidComponentEvidencePayload(
            componentVersion = "0.0.0-g5",
            deviceLifecycleId = sampleLifecycleUuid,
            sessionUuid = sampleSessionUuid,
            displayMetrics = ComponentDisplayMetrics(
                densityDpi = 420,
                widthPixels = 1080,
                heightPixels = 2340,
                smallestScreenWidthDp = 384,
                xdpi = 420f,
                ydpi = 420f,
            ),
            batteryExtras = ComponentBatteryExtras(
                isPresent = true,
                technology = "Li-poly",
                temperatureDeciCelsius = 310,
                voltageMilliVolts = 4050,
                capacityPercent = 78,
            ),
            runtimePermissions = emptyList(),
            declaredFeatures = emptyList(),
        )
    }

    @Test
    fun returnsUninstalledWhenPackageNotFound() {
        val runner = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            if (cmdStr.contains("pm list packages")) {
                DefaultProcessExecutionResult(0, "package:com.android.settings\n", "")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        val adbClient = AdbClient(File("/mock/adb"), runner)
        val bridge = HostAndroidComponentBridge(adbClient, "device-serial-001")

        assertFalse(bridge.checkInstalled())
        assertNull(bridge.getComponentVersion())

        val result = bridge.triggerEvidenceCollection("sess-1", "life-1")
        assertFalse(result.isInstalled)
        assertFalse(result.isExecutable)
        assertNull(result.payload)
        assertTrue(result.error?.contains("not installed") == true)
    }

    @Test
    fun triggersAndParsesEvidenceWhenComponentIsInstalled() {
        val samplePayload = createSamplePayload()
        val serializedPayload = json.encodeToString(samplePayload)

        val runner = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            when {
                cmdStr.contains("pm list packages co.in.cyvra.mobile") ->
                    DefaultProcessExecutionResult(0, "package:co.in.cyvra.mobile\n", "")
                cmdStr.contains("dumpsys package co.in.cyvra.mobile") ->
                    DefaultProcessExecutionResult(0, "    versionName=0.0.0-g5\n", "")
                cmdStr.contains("am broadcast") ->
                    DefaultProcessExecutionResult(0, "Broadcast completed: result=0\n", "")
                cmdStr.contains("cat /sdcard/Android/data/co.in.cyvra.mobile") ->
                    DefaultProcessExecutionResult(0, serializedPayload, "")
                else ->
                    DefaultProcessExecutionResult(0, "", "")
            }
        }
        val adbClient = AdbClient(File("/mock/adb"), runner)
        val bridge = HostAndroidComponentBridge(adbClient, "device-serial-002")

        assertTrue(bridge.checkInstalled())
        assertEquals("0.0.0-g5", bridge.getComponentVersion())

        val result = bridge.triggerEvidenceCollection(sampleSessionUuid, sampleLifecycleUuid)
        assertTrue(result.isInstalled)
        assertTrue(result.isExecutable)
        assertNotNull(result.payload)
        assertEquals("ANDROID_COMPONENT", result.payload?.source)
        assertEquals(78, result.payload?.batteryExtras?.capacityPercent)
        assertEquals(310, result.payload?.batteryExtras?.temperatureDeciCelsius)
        assertEquals(420, result.payload?.displayMetrics?.densityDpi)
    }

    @Test
    fun locateBundledAgentApkFindsStagedApkInInstallationResources() {
        val tempInstallDir = java.nio.file.Files.createTempDirectory("cyvra-install-test").toFile()
        val resourcesAgentDir = File(tempInstallDir, "resources/agent")
        resourcesAgentDir.mkdirs()
        val dummyApk = File(resourcesAgentDir, "cyvra-agent.apk")
        dummyApk.writeText("PK stub")

        val prevProp = System.getProperty("cyvra.install")
        try {
            System.setProperty("cyvra.install", tempInstallDir.absolutePath)
            val located = HostAndroidComponentBridge.locateBundledAgentApk()
            assertNotNull(located, "Bridge should locate bundled APK under cyvra.install/resources/agent")
            assertEquals(dummyApk.absolutePath, located.absolutePath)
        } finally {
            if (prevProp != null) System.setProperty("cyvra.install", prevProp)
            else System.clearProperty("cyvra.install")
            tempInstallDir.deleteRecursively()
        }
    }

    @Test
    fun detectInstalledPackageRecognizesUnifiedAndLegacyPackages() {
        val runnerUnified = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            if (cmdStr.contains("co.in.cyvra.mobile")) {
                DefaultProcessExecutionResult(0, "package:co.in.cyvra.mobile\n", "")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        val bridgeUnified = HostAndroidComponentBridge(AdbClient(File("/mock/adb"), runnerUnified), "s1")
        assertEquals("co.in.cyvra.mobile", bridgeUnified.detectInstalledPackage())

        val runnerLegacy = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            if (cmdStr.contains("com.cyvra.sanitization")) {
                DefaultProcessExecutionResult(0, "package:com.cyvra.sanitization\n", "")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        val bridgeLegacy = HostAndroidComponentBridge(AdbClient(File("/mock/adb"), runnerLegacy), "s2")
        assertEquals("com.cyvra.sanitization", bridgeLegacy.detectInstalledPackage())
    }

    @Test
    fun ensureInstalledOrDeployReturnsInstalledIfAlreadyPresent() {
        val runner = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            if (cmdStr.contains("co.in.cyvra.mobile")) {
                DefaultProcessExecutionResult(0, "package:co.in.cyvra.mobile\n", "")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        val bridge = HostAndroidComponentBridge(AdbClient(File("/mock/adb"), runner), "s1")
        val (installed, status) = bridge.ensureInstalledOrDeploy()
        assertTrue(installed)
        assertEquals("INSTALLED", status)
    }

    @Test
    fun ensureInstalledOrDeployFailsClosedWhenPayloadMissing() {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(0, "", "") }
        val bridge = HostAndroidComponentBridge(AdbClient(File("/mock/adb"), runner), "s1")

        val prevProp = System.getProperty("cyvra.install")
        val prevHome = System.getProperty("cyvra.home")
        val prevApk = System.getProperty("cyvra.agent.apk")
        try {
            System.setProperty("cyvra.install", "/non/existent/install/path")
            System.setProperty("cyvra.home", "/non/existent/home/path")
            System.setProperty("cyvra.agent.apk", "/non/existent/agent.apk")
            val (installed, status) = bridge.ensureInstalledOrDeploy()
            assertFalse(installed, "Must fail closed when payload missing")
        } finally {
            if (prevProp != null) System.setProperty("cyvra.install", prevProp) else System.clearProperty("cyvra.install")
            if (prevHome != null) System.setProperty("cyvra.home", prevHome) else System.clearProperty("cyvra.home")
            if (prevApk != null) System.setProperty("cyvra.agent.apk", prevApk) else System.clearProperty("cyvra.agent.apk")
        }
    }

    @Test
    fun ensureInstalledOrDeployFailsClosedWhenAdbInstallFails() {
        val tempInstallDir = java.nio.file.Files.createTempDirectory("cyvra-install-fail-test").toFile()
        val resourcesAgentDir = File(tempInstallDir, "resources/agent")
        resourcesAgentDir.mkdirs()
        val dummyApk = File(resourcesAgentDir, "cyvra-agent.apk")
        dummyApk.writeText("PK stub")

        val runner = ProcessRunner { cmd, _ ->
            val cmdStr = cmd.joinToString(" ")
            if (cmdStr.contains("install")) {
                DefaultProcessExecutionResult(1, "", "INSTALL_FAILED_VERIFICATION_FAILURE")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        val bridge = HostAndroidComponentBridge(AdbClient(File("/mock/adb"), runner), "s1")

        val prevProp = System.getProperty("cyvra.install")
        try {
            System.setProperty("cyvra.install", tempInstallDir.absolutePath)
            val (installed, status) = bridge.ensureInstalledOrDeploy()
            assertFalse(installed, "Must fail closed when ADB install fails")
            assertTrue(status.startsWith("INSTALLATION_FAILED"), "Status should indicate installation failure, got: $status")
            assertTrue(status.contains("INSTALL_FAILED_VERIFICATION_FAILURE"), "Status should contain failure reason")
        } finally {
            if (prevProp != null) System.setProperty("cyvra.install", prevProp)
            else System.clearProperty("cyvra.install")
            tempInstallDir.deleteRecursively()
        }
    }
}
