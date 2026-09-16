package cyvra.mobile.host.transport

import cyvra.mobile.core.planEvidence
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HostTransportTest {

    @Test
    fun g4StateMapperMapsStatesCorrectly() {
        assertEquals("USB_DISCONNECTED", G4IngestStateMapper.toG4UsbState(HostUsbState.USB_NOT_CONNECTED, HostAdbState.ADB_UNAVAILABLE))
        assertEquals("ADB_DISABLED", G4IngestStateMapper.toG4AdbState(HostAdbState.ADB_UNAVAILABLE))

        assertEquals("USB_CONNECTED_CHARGING", G4IngestStateMapper.toG4UsbState(HostUsbState.USB_CONNECTED, HostAdbState.ADB_UNAVAILABLE))
        assertEquals("ADB_DISABLED", G4IngestStateMapper.toG4AdbState(HostAdbState.ADB_UNAVAILABLE))

        assertEquals("USB_CONNECTED_DATA", G4IngestStateMapper.toG4UsbState(HostUsbState.USB_CONNECTED, HostAdbState.ADB_UNAUTHORIZED))
        assertEquals("ADB_VISIBLE_UNAUTHORIZED", G4IngestStateMapper.toG4AdbState(HostAdbState.ADB_UNAUTHORIZED))

        assertEquals("USB_CONNECTED_DATA", G4IngestStateMapper.toG4UsbState(HostUsbState.USB_CONNECTED, HostAdbState.ADB_READY))
        assertEquals("ADB_AUTHORIZED", G4IngestStateMapper.toG4AdbState(HostAdbState.ADB_READY))

        assertEquals("USB_CONNECTED_DATA", G4IngestStateMapper.toG4UsbState(HostUsbState.USB_CONNECTED, HostAdbState.DEVICE_RECONNECTING))
        assertEquals("ADB_UNKNOWN", G4IngestStateMapper.toG4AdbState(HostAdbState.DEVICE_RECONNECTING))
    }

    @Test
    fun connectionStateMachineEvaluatesTransitions() {
        val machine = ConnectionStateMachine()

        // 1. No USB, No ADB
        val s1 = machine.evaluate(usbConnected = false, adbClientAvailable = false, discoveredDevices = emptyList())
        assertEquals(DeviceConnectionState.NO_DEVICE, s1.connectionState)
        assertFalse(s1.readyToScan)
        assertNotNull(s1.operatorActionRequired)

        // 2. USB connected, no ADB device
        val s2 = machine.evaluate(usbConnected = true, adbClientAvailable = true, discoveredDevices = emptyList())
        assertEquals(DeviceConnectionState.USB_DETECTED, s2.connectionState)
        assertFalse(s2.readyToScan)
        assertTrue(s2.operatorActionRequired!!.contains("Developer Options"))

        // 3. ADB unauthorized
        val unauthDevice = AdbDeviceDescriptor(serial = "RF8R123456", state = "unauthorized")
        val s3 = machine.evaluate(usbConnected = true, adbClientAvailable = true, discoveredDevices = listOf(unauthDevice))
        assertEquals(DeviceConnectionState.ADB_UNAUTHORIZED, s3.connectionState)
        assertEquals(HostAdbState.ADB_UNAUTHORIZED, s3.adbState)
        assertFalse(s3.readyToScan)
        assertTrue(s3.operatorActionRequired!!.contains("Allow USB debugging"))

        // 4. ADB ready / authorized
        val readyDevice = AdbDeviceDescriptor(serial = "RF8R123456", state = "device", product = "a52", model = "SM-A525F")
        val s4 = machine.evaluate(usbConnected = true, adbClientAvailable = true, discoveredDevices = listOf(readyDevice))
        assertEquals(DeviceConnectionState.ADB_READY, s4.connectionState)
        assertEquals(HostAdbState.ADB_READY, s4.adbState)
        assertTrue(s4.readyToScan)
        assertEquals(null, s4.operatorActionRequired)
    }

    @Test
    fun adbClientParsesDevicesList() {
        val sampleOutput = """
            List of devices attached
            RF8R123456            device product:a52sxq model:SM_A528B device:a52sxq transport_id:1
            192.168.1.50:5555      unauthorized transport_id:2
            emulator-5554          offline transport_id:3
        """.trimIndent()

        val parsed = AdbClient.parseDevicesOutput(sampleOutput)
        assertEquals(3, parsed.size)

        val d1 = parsed[0]
        assertEquals("RF8R123456", d1.serial)
        assertEquals("device", d1.state)
        assertEquals("a52sxq", d1.product)
        assertEquals("SM_A528B", d1.model)
        assertEquals("1", d1.transportId)

        val d2 = parsed[1]
        assertEquals("192.168.1.50:5555", d2.serial)
        assertEquals("unauthorized", d2.state)
        assertEquals(null, d2.model)

        val d3 = parsed[2]
        assertEquals("emulator-5554", d3.serial)
        assertEquals("offline", d3.state)
    }

    @Test
    fun adbDeviceInspectorMapsToCoreCapabilityProfile() {
        val fakeRunner = ProcessRunner { command, _ ->
            val cmdStr = command.joinToString(" ")
            when {
                cmdStr.contains("getprop ro.product.manufacturer") -> DefaultProcessExecutionResult(0, "samsung\n", "")
                cmdStr.contains("getprop ro.product.brand") -> DefaultProcessExecutionResult(0, "samsung\n", "")
                cmdStr.contains("getprop ro.product.model") -> DefaultProcessExecutionResult(0, "SM-A525F\n", "")
                cmdStr.contains("getprop ro.build.version.sdk") -> DefaultProcessExecutionResult(0, "34\n", "")
                cmdStr.contains("pm list features") -> DefaultProcessExecutionResult(
                    0,
                    "feature:android.hardware.camera\nfeature:android.hardware.wifi\n",
                    "",
                )
                else -> DefaultProcessExecutionResult(0, "", "")
            }
        }

        val client = AdbClient(File("mock-adb"), fakeRunner)
        val inspector = AdbDeviceInspector(client)
        val profile = inspector.inspectDevice("test-serial")

        assertEquals("samsung", profile.manufacturer)
        assertEquals("SM-A525F", profile.model)
        assertEquals(34, profile.sdkInt)
        assertEquals(2, profile.features.size)
        assertTrue(profile.features.any { it.feature == "android.hardware.camera" })

        // Integration with existing core planning
        val planned = planEvidence(profile)
        assertTrue(planned.isNotEmpty())
        val imeiTest = planned.first { it.testId == "IDN.IMEI_SERIAL" }
        assertEquals("NOT_AVAILABLE", imeiTest.plannedResult)
    }

    @Test
    fun hostPreflightRunsChecks() {
        val verifier = HostPreflightVerifier()
        val result = verifier.runPreflight()
        assertNotNull(result)
        assertTrue(result.checks.isNotEmpty())
        assertTrue(result.checks.any { it.checkName == "Java Runtime" })
    }
}
