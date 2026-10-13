package cyvra.mobile.host.evidence

import cyvra.mobile.core.DeviceParameter
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Regression coverage for the three rows a bench-device diagnosis re-sourced.
 *
 * The fixtures below are synthetic. They reproduce only the *shape* of the headings the
 * product parses, so that a later change to the parse cannot silently re-break a row that
 * was already measured against hardware. No captured device output appears in this file.
 */
class AdbExtendedEvidenceProviderTest {

    private fun List<DeviceParameter>.byId(id: String): DeviceParameter = first { it.id == id }

    private fun provider(vararg replies: Pair<String, String>): AdbExtendedEvidenceProvider {
        val runner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            val hit = replies.firstOrNull { cmd.contains(it.first) }
            if (hit == null) {
                DefaultProcessExecutionResult(0, "", "")
            } else {
                DefaultProcessExecutionResult(0, hit.second, "")
            }
        }
        return AdbExtendedEvidenceProvider(AdbClient(File("mock-adb"), runner), "serial-test")
    }

    // ------------------------------------------------------------------ CAM-001

    @Test
    fun cameraCountIsReadFromTheCameraDevicesHeading() {
        val provider = provider(
            "dumpsys media.camera" to """
                Camera service state:
                  Number of camera devices: 2
                  Number of normal camera devices: 2
                  Number of public camera devices visible to API1: 2
            """.trimIndent(),
        )

        val row = provider.collect().byId("CAM-001")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("2", row.result.value)
    }

    @Test
    fun cameraCountFallsBackToWhicheverHeadingThisOemPublishes() {
        val provider = provider(
            "dumpsys media.camera" to """
                Number of public camera devices visible to API1: 1
            """.trimIndent(),
        )

        val row = provider.collect().byId("CAM-001")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("1", row.result.value)
    }

    @Test
    fun cameraCountStillDeclinesWhenNoHeadingIsPublished() {
        val provider = provider(
            "dumpsys media.camera" to "Camera service state:\n  no enumeration follows",
        )

        val row = provider.collect().byId("CAM-001")
        assertEquals(EvidenceStatus.NOT_AVAILABLE, row.result.status)
        assertNull(row.result.value)
        assertEquals("dumpsys media.camera published no camera-device count", row.result.reason)
    }

    // ------------------------------------------------------------------ SYS-003

    @Test
    fun screenStateIsReadFromTheAospWakefulnessSpelling() {
        val provider = provider(
            "dumpsys power" to """
                mWakefulness=Awake
                mWakefulnessChanging=false
            """.trimIndent(),
        )

        val row = provider.collect().byId("SYS-003")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("Awake", row.result.value)
    }

    @Test
    fun screenStateIsReadFromDisplayPowerWhenWakefulnessIsAbsent() {
        // `mWakefulnessChanging` must NOT be mistaken for `mWakefulness=`: the prefix is
        // shared, so an unanchored match would return the wrong line's content.
        val provider = provider(
            "dumpsys power" to """
                mWakefulnessChanging=false
                Display Power: state=ON
            """.trimIndent(),
        )

        val row = provider.collect().byId("SYS-003")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("ON", row.result.value)
    }

    @Test
    fun screenStateDeclinesWhenNeitherKeyIsPublished() {
        val provider = provider(
            "dumpsys power" to "Power Manager State:\n  mHoldingDisplaySuspendBlocker=false",
        )

        val row = provider.collect().byId("SYS-003")
        assertEquals(EvidenceStatus.NOT_AVAILABLE, row.result.status)
        assertEquals(
            "dumpsys power published neither a wakefulness nor a display-power state",
            row.result.reason,
        )
    }

    // ------------------------------------------------------------------ HAP-001

    @Test
    fun hapticsReportsTheRegisteredVibratorService() {
        // Real `service list` output prefixes each entry with its binder index; the
        // fixture reproduces that shape, because a fixture without it passes locally
        // and then fails against hardware.
        val provider = provider(
            "service list" to """
                12	external_vibrator_service: [android.os.IExternalVibratorService]
                41	vibrator: [android.os.IVibratorService]
                63	package: [android.os.IPackageManager]
            """.trimIndent(),
        )

        val row = provider.collect().byId("HAP-001")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("vibrator service registered", row.result.value)
    }

    @Test
    fun hapticsDoesNotMatchASimilarlyNamedService() {
        // `external_vibrator_service:` shares the word but is not the vibrator binder,
        // with and without the index prefix that `service list` adds.
        val provider = provider(
            "service list" to """
                12	external_vibrator_service: [android.os.IExternalVibratorService]
                63	package: [android.os.IPackageManager]
            """.trimIndent(),
        )

        val row = provider.collect().byId("HAP-001")
        assertEquals(EvidenceStatus.NOT_AVAILABLE, row.result.status)
        assertEquals("service list registered no vibrator service", row.result.reason)
    }

    @Test
    fun hapticsAcceptsAnUnindexedListingToo() {
        val provider = provider(
            "service list" to "vibrator: [android.os.IVibratorService]",
        )

        val row = provider.collect().byId("HAP-001")
        assertEquals(EvidenceStatus.AVAILABLE, row.result.status)
        assertEquals("vibrator service registered", row.result.value)
    }
}
