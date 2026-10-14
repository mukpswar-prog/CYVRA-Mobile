package cyvra.mobile.host.sanitization

import cyvra.mobile.host.security.HostSecurityAuditEngine
import cyvra.mobile.host.transport.AdbClient

/**
 * What the PUR-004 pre-flight was able to establish about the target device.
 *
 * Tri-state on purpose. `INDETERMINATE` is not a synonym for `false`: it means the
 * read failed, so the product knows nothing about the device and must not behave as
 * though it had been told "no".
 */
enum class WipeEligibility {
    /** The CYVRA sanitization agent is installed AND is the device owner. */
    ELIGIBLE,

    /** The agent is absent, or present and not the device owner. */
    NOT_ELIGIBLE,

    /** A pre-flight read failed, so eligibility was never established either way. */
    INDETERMINATE,
}

/**
 * The outcome of issuing the wipe trigger. Delivery only; see [trigger].
 */
data class WipeOutcome(
    val delivered: Boolean,
    val reason: String?,
)

/**
 * PUR-004: the destructive purge trigger.
 *
 * ## This is the agent-based route, and it is labelled that way on purpose
 *
 * The only destructive path with hardware proof on our bench device is the installed
 * CYVRA sanitization agent acting as Device Owner, which calls
 * `DevicePolicyManager.wipeData(0)`. That is what produced
 * `ro.boot.bootreason = reboot,factory_reset` on 12-Oct-2026. The agent-less route has
 * never erased anything on this device, and on a locked bootloader with `uid=2000`, no
 * root and no device owner it is believed to be impossible. That last sentence is a
 * belief, not a measurement, and it is recorded as one.
 *
 * Consequence, stated rather than implied: **a device without this agent installed and
 * enrolled cannot be purged through this path, and is refused rather than silently
 * failing.** Standing hold H8 requires that the weaker route be described as weaker
 * instead of being dressed up.
 *
 * ## Delivery is not erasure
 *
 * `am broadcast` reports "Broadcast completed" whether or not the wipe ever fires. The
 * receiver returns before `wipeData` completes, and if the agent is not the device
 * owner the call throws on the device while the broadcast still reports success. So
 * nothing here can establish that data was erased. Completion is established only by
 * post-reset verification (PUR-005), never by this class.
 *
 * ## The proven command
 *
 * This is the exact command that performed the 12-Oct wipe, recorded in
 * `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` §2. The documented
 * `cmd recovery wipe-data` path is allowlisted but is recorded in the same proof as
 * not working on Android 8.0 and above, so it is not used here.
 *
 * Every command stays inside `HostSecurityAuditEngine.ALLOWED_ADB_PREFIXES`.
 */
class HostDestructiveWipeProvider(
    private val adbClient: AdbClient,
    private val serial: String,
) {

    /**
     * Establishes whether a destructive trigger may be issued at all.
     *
     * Both facts are read rather than assumed. Neither may be inferred from the other:
     * an installed agent that is not the device owner cannot wipe, and this is the
     * single condition the wipe call itself depends on.
     */
    fun preflight(): Pair<WipeEligibility, String> {
        val installed = agentInstalled()
        if (installed == null) {
            return WipeEligibility.INDETERMINATE to
                "The presence of the CYVRA sanitization agent could not be established " +
                "(the package listing did not answer). No destructive step was attempted."
        }
        if (!installed) {
            return WipeEligibility.NOT_ELIGIBLE to
                "Refused: the CYVRA sanitization agent is not installed on this device, so " +
                "no purge method is available. Purge on this build is agent-based; it is not " +
                "offered as an agent-less capability."
        }

        val owner = deviceOwnerPresent()
        if (owner == null) {
            return WipeEligibility.INDETERMINATE to
                "The device-owner state could not be read, so eligibility was never " +
                "established. No destructive step was attempted."
        }
        if (!owner) {
            return WipeEligibility.NOT_ELIGIBLE to
                "Refused: the CYVRA sanitization agent is installed but is not the device " +
                "owner on this device, so it holds no wipe authority."
        }

        return WipeEligibility.ELIGIBLE to
            "The CYVRA sanitization agent is installed and is the device owner."
    }

    /**
     * Issues the wipe trigger. Call only after [preflight] has returned ELIGIBLE.
     *
     * `delivered` means the broadcast reached the device. It does not mean the device
     * is wiping, and it certainly does not mean data is gone. See the class note.
     */
    fun trigger(): WipeOutcome {
        val result = adbClient.runShell(serial, WIPE_COMMAND)
        if (!result.isSuccess) {
            return WipeOutcome(
                delivered = false,
                reason = "The wipe trigger could not be issued: " +
                    (result.stderr.trim().ifBlank { "exit ${result.exitCode}" }).take(160),
            )
        }
        return WipeOutcome(delivered = true, reason = null)
    }

    /** `null` when the listing did not answer. */
    private fun agentInstalled(): Boolean? {
        val result = adbClient.runShell(serial, CMD_AGENT_PRESENT)
        if (!result.isSuccess) return null
        return result.stdout.lines().any {
            it.trim().startsWith(PACKAGE_LINE_PREFIX) &&
                it.contains(AGENT_PACKAGE, ignoreCase = true)
        }
    }

    /**
     * `null` when the dump did not answer. Presence of the device-owner heading is the
     * same test the standing-holds harness uses, so the product and the harness cannot
     * disagree about what counts as ownership.
     */
    private fun deviceOwnerPresent(): Boolean? {
        val result = adbClient.runShell(serial, CMD_DEVICE_POLICY)
        if (!result.isSuccess) return null
        return result.stdout.lineSequence().any { it.contains(DEVICE_OWNER_HEADING) }
    }

    private companion object {
        const val AGENT_PACKAGE = "com.cyvra.sanitization"
        const val PACKAGE_LINE_PREFIX = "package:"
        const val DEVICE_OWNER_HEADING = "Device Owner"
        const val CMD_AGENT_PRESENT = "pm list packages $AGENT_PACKAGE"
        const val CMD_DEVICE_POLICY = "dumpsys device_policy"

        /**
         * The exact command from the 12-Oct-2026 proof. Flag `0` inside the agent means
         * internal storage only: removable media is untouched and the bootloader state
         * is not altered.
         */
        const val WIPE_COMMAND =
            "am broadcast -n $AGENT_PACKAGE/.SanitizationBroadcastReceiver " +
                "-p $AGENT_PACKAGE -a $AGENT_PACKAGE.WIPE"
    }
}
