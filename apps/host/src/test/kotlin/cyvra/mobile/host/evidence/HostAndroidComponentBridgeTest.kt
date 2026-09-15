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

    private fun createSamplePayload(): AndroidComponentEvidencePayload {
        return AndroidComponentEvidencePayload(
            componentVersion = "0.0.0-g5",
            deviceLifecycleId = "life-101",
            sessionUuid = "sess-202",
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

        val result = bridge.triggerEvidenceCollection("sess-202", "life-101")
        assertTrue(result.isInstalled)
        assertTrue(result.isExecutable)
        assertNotNull(result.payload)
        assertEquals("ANDROID_COMPONENT", result.payload?.source)
        assertEquals(78, result.payload?.batteryExtras?.capacityPercent)
        assertEquals(310, result.payload?.batteryExtras?.temperatureDeciCelsius)
        assertEquals(420, result.payload?.displayMetrics?.densityDpi)
    }
}
