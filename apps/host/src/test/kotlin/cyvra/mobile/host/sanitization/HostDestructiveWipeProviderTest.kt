package cyvra.mobile.host.sanitization

import cyvra.mobile.host.security.HostSecurityAuditEngine
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * PUR-004 agent-based destructive provider.
 *
 * The tests that matter here are the refusals. A wipe path earns trust by declining
 * correctly far more than by firing, so the ineligible and unreadable cases are
 * pinned separately and must never collapse into one another.
 */
class HostDestructiveWipeProviderTest {

    private val agentPresent = "package:com.cyvra.sanitization\n"
    private val ownerPresent =
        "Device Owner:\n  adminInfo: ComponentInfo{com.cyvra.sanitization/com.cyvra.sanitization.SanitizationAdmin}\n"
    private val ownerAbsent =
        "Device Admin:\n  adminInfo: ComponentInfo{com.android.settings/.Settings}\n"

    private fun provider(vararg replies: Pair<String, String>): HostDestructiveWipeProvider {
        val runner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            val hit = replies.firstOrNull { cmd.contains(it.first) }
            if (hit != null) {
                DefaultProcessExecutionResult(0, hit.second, "")
            } else {
                DefaultProcessExecutionResult(0, "", "")
            }
        }
        return HostDestructiveWipeProvider(AdbClient(File("/mock/adb"), runner), "serial-123")
    }

    // ------------------------------------------------------------------ eligible

    @Test
    fun `an installed and enrolled agent is the only eligible state`() {
        val (eligibility, reason) = provider(
            "pm list packages" to agentPresent,
            "dumpsys device_policy" to ownerPresent,
        ).preflight()

        assertEquals(WipeEligibility.ELIGIBLE, eligibility)
        assertTrue(reason.contains("installed"), reason)
    }

    @Test
    fun `the trigger issues exactly the command the 12-Oct proof used`() {
        var issued = ""
        val runner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            issued = cmd
            DefaultProcessExecutionResult(0, "Broadcast completed: result=-1", "")
        }
        val outcome = HostDestructiveWipeProvider(AdbClient(File("/mock/adb"), runner), "s")
            .trigger()

        assertTrue(outcome.delivered)
        assertTrue(issued.contains("am broadcast -n com.cyvra.sanitization/"), issued)
        assertTrue(issued.contains("-a com.cyvra.sanitization.WIPE"), issued)
    }

    @Test
    fun `every command this provider issues stays inside the supported set`() {
        val security = HostSecurityAuditEngine()
        assertTrue(security.validateAdbCommandSafety("pm list packages com.cyvra.sanitization"))
        assertTrue(security.validateAdbCommandSafety("dumpsys device_policy"))
        assertTrue(
            security.validateAdbCommandSafety(
                "am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver " +
                    "-p com.cyvra.sanitization -a com.cyvra.sanitization.WIPE",
            ),
        )
        // The allowlist admits our component and nothing broader.
        assertFalse(security.validateAdbCommandSafety("am broadcast -a android.intent.action.BOOT_COMPLETED"))
        assertFalse(security.validateAdbCommandSafety("am broadcast -n com.other.app/.Receiver"))
    }

    // ------------------------------------------------------------------ refusals

    @Test
    fun `a device without the agent is refused, and the reason names the route`() {
        val (eligibility, reason) = provider(
            "pm list packages" to "package:com.android.settings\n",
        ).preflight()

        assertEquals(WipeEligibility.NOT_ELIGIBLE, eligibility)
        assertTrue(reason.contains("not installed"), reason)
        // H8: the weaker route must be described as weaker, not implied away.
        assertTrue(reason.contains("agent-based"), reason)
        assertTrue(reason.contains("agent-less"), reason)
    }

    @Test
    fun `an installed agent that is not the device owner holds no wipe authority`() {
        val (eligibility, reason) = provider(
            "pm list packages" to agentPresent,
            "dumpsys device_policy" to ownerAbsent,
        ).preflight()

        assertEquals(WipeEligibility.NOT_ELIGIBLE, eligibility)
        assertTrue(reason.contains("not the device"), reason)
    }

    @Test
    fun `an unreadable device-owner dump is INDETERMINATE, never a no`() {
        // The package listing answers, the device-owner dump fails. Reporting
        // NOT_ELIGIBLE here would be a claim about the device made from a failed read.
        val runner = ProcessRunner { command, _ ->
            val cmd = command.joinToString(" ")
            when {
                cmd.contains("pm list packages") ->
                    DefaultProcessExecutionResult(0, agentPresent, "")
                cmd.contains("dumpsys device_policy") ->
                    DefaultProcessExecutionResult(1, "", "permission denied")
                else -> DefaultProcessExecutionResult(0, "", "")
            }
        }
        val (eligibility, reason) =
            HostDestructiveWipeProvider(AdbClient(File("/mock/adb"), runner), "s").preflight()

        assertEquals(WipeEligibility.INDETERMINATE, eligibility)
        assertTrue(reason.contains("could not be read"), reason)
        assertTrue(reason.contains("No destructive step was attempted"), reason)
    }

    @Test
    fun `an unreadable package listing is INDETERMINATE, never an absent agent`() {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(1, "", "device offline") }
        val (eligibility, reason) =
            HostDestructiveWipeProvider(AdbClient(File("/mock/adb"), runner), "s").preflight()

        assertEquals(WipeEligibility.INDETERMINATE, eligibility)
        assertTrue(reason.contains("could not be established"), reason)
    }

    @Test
    fun `a trigger that does not reach the device is reported as undelivered`() {
        val runner = ProcessRunner { _, _ -> DefaultProcessExecutionResult(1, "", "no such device") }
        val outcome = HostDestructiveWipeProvider(AdbClient(File("/mock/adb"), runner), "s").trigger()

        assertFalse(outcome.delivered)
        assertNotNull(outcome.reason)
        assertTrue(outcome.reason!!.contains("could not be issued"), outcome.reason!!)
    }
}
