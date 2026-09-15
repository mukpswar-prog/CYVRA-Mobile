package cyvra.mobile.host.evidence

import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.CapabilityStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostCapabilityCoordinatorTest {

    private fun createMockAdbClient(stdoutResponse: String = ""): AdbClient {
        val mockRunner = ProcessRunner { _, _ ->
            DefaultProcessExecutionResult(
                exitCode = 0,
                stdout = stdoutResponse,
                stderr = "",
            )
        }
        return AdbClient(
            adbBinary = File("/mock/platform-tools/adb"),
            processRunner = mockRunner,
        )
    }

    @Test
    fun hostAssessesConnectedDeviceThroughCoordinator() {
        val adbClient = createMockAdbClient()
        val coordinator = HostCapabilityCoordinator(adbClient)

        val profile = CapabilityProfile(
            manufacturer = "Motorola",
            brand = "motorola",
            model = "moto g84 5G",
            sdkInt = 34,
            accessLevel = "L2_HOST_ADB",
            usbState = "USB_CONNECTED_DATA",
            adbState = "ADB_AUTHORIZED",
        )

        val assessment = coordinator.assessConnectedDevice("mock-serial-123", profile)

        assertEquals("Motorola", assessment.manufacturer)
        assertEquals("moto g84 5G", assessment.model)
        assertTrue(coordinator.isReadyForPlatformReset(assessment))

        val resetCap = assessment.capabilities.first { it.capabilityKey == "PLATFORM_FACTORY_RESET" }
        assertEquals(CapabilityStatus.SUPPORTED, resetCap.status)
        assertTrue(resetCap.isAvailable)
    }

    @Test
    fun hostReportsNotReadyWhenAdbIsUnauthorized() {
        val adbClient = createMockAdbClient()
        val coordinator = HostCapabilityCoordinator(adbClient)

        val profile = CapabilityProfile(
            manufacturer = "Xiaomi",
            brand = "redmi",
            model = "Redmi Note 13",
            sdkInt = 33,
            accessLevel = "L1_USB_ONLY",
            usbState = "USB_CONNECTED_DATA",
            adbState = "ADB_UNAUTHORIZED",
        )

        val assessment = coordinator.assessConnectedDevice("mock-serial-456", profile)
        assertFalse(coordinator.isReadyForPlatformReset(assessment))
        assertEquals("NONE_AUTHORIZATION_REQUIRED", assessment.recommendedPurgeAction)
    }
}
