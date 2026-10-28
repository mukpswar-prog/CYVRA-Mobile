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
 * The outcome of issuing the wipe trigger.
 *
 * Tri-state, because this is the one place in the product where a wrong guess is
 * expensive in both directions. Issuing `wipeData` tears the ADB connection down, so
 * a non-zero exit does NOT mean the command failed: on 14-Oct the trigger returned
 * exit 224 with the device already gone from ADB, which is what a wipe starting looks
 * like. Reporting that as "not delivered" would have recorded the most important
 * outcome of the run backwards.
 */
enum class WipeTriggerOutcome {
    /** The broadcast was accepted by the device. Still not erasure. */
    DELIVERED,

    /** The command could not be issued at all, and the device is still reachable. */
    NOT_ISSUED,

    /**
     * The command was issued and its effect cannot be established from here. This is
     * the honest answer when the connection drops: the only way to settle it is the
     * post-reboot reading (PUR-005 / Stage 5), never a second guess here.
     */
    INDETERMINATE,
}

data class WipeOutcome(
    val outcome: WipeTriggerOutcome,
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
        var activePkg = resolveActivePackage()
        if (!installed || activePkg == null) {
            // Attempt automated deployment if bundled agent payload exists
            val bridge = cyvra.mobile.host.evidence.HostAndroidComponentBridge(adbClient, serial)
            val (deployed, _) = bridge.ensureInstalledOrDeploy()
            if (deployed) {
                activePkg = resolveActivePackage()
            }
        }

        if (activePkg == null && !installed) {
            return WipeEligibility.NOT_ELIGIBLE to
                "Refused: the CYVRA sanitization agent is not installed on this device, so " +
                "no purge method is available. Purge on this build is agent-based; it is not " +
                "offered as an agent-less capability."
        }

        val effectivePkg = activePkg ?: AGENT_PACKAGE
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

    /** Resolves which supported sanitization package is present on the device. */
    fun resolveActivePackage(): String? {
        val candidates = listOf(AGENT_PACKAGE, "co.in.cyvra.mobile")
        for (pkg in candidates) {
            val result = adbClient.runShell(serial, "pm list packages $pkg")
            if (result.isSuccess && result.stdout.lines().any { it.trim() == "package:$pkg" }) {
                return pkg
            }
        }
        return null
    }

    /**
     * Issues the two-step ARM -> WIPE trigger. Call only after [preflight] has returned ELIGIBLE.
     * Generates a 256-bit cryptographically secure token and binds the request strictly to
     * [serial], [sessionUuid], and [operationId].
     *
     * `delivered` means the broadcast reached the device. It does not mean the device
     * is wiping, and it certainly does not mean data is gone. See the class note.
     */
    fun trigger(sessionUuid: String? = null, operationId: String? = null): WipeOutcome {
        val targetPkg = resolveActivePackage() ?: AGENT_PACKAGE
        // Established BEFORE the trigger, because afterwards the device may be gone and
        // "absent to begin with" would then be indistinguishable from "absent because
        // it is wiping".
        val reachableBefore = adbClient.runShell(serial, "pm list packages $targetPkg")
        if (!reachableBefore.isSuccess) {
            return WipeOutcome(
                WipeTriggerOutcome.NOT_ISSUED,
                "The wipe trigger was not issued: the device did not answer a package " +
                    "listing, so there was nothing to address.",
            )
        }

        // Cryptographically secure, high-entropy 256-bit single-use token
        val secureRandom = java.security.SecureRandom()
        val tokenBytes = ByteArray(32)
        secureRandom.nextBytes(tokenBytes)
        val wipeToken = tokenBytes.joinToString("") { "%02x".format(it) }

        val commonExtras = buildList {
            add("--es wipeToken $wipeToken")
            if (!sessionUuid.isNullOrBlank()) add("--es sessionUuid $sessionUuid")
            add("--es targetSerial $serial")
            if (!operationId.isNullOrBlank()) add("--es operationId $operationId")
        }.joinToString(" ")

        // Phase 1: ARM broadcast
        val armCommand = "am broadcast -n $targetPkg/.SanitizationBroadcastReceiver -p $targetPkg -a $targetPkg.ARM $commonExtras"
        val armResult = adbClient.runShell(serial, armCommand)
        if (!armResult.isSuccess || (!armResult.stdout.contains("result=0") && !armResult.stdout.contains("result=-1"))) {
            return WipeOutcome(
                WipeTriggerOutcome.NOT_ISSUED,
                "The arm command was rejected or failed on the device: ${armResult.stderr.ifBlank { armResult.stdout }}",
            )
        }

        // Phase 2: WIPE broadcast with matching token and binding
        val wipeCommand = "am broadcast -n $targetPkg/.SanitizationBroadcastReceiver -p $targetPkg -a $targetPkg.WIPE $commonExtras"
        val result = adbClient.runShell(serial, wipeCommand)
        if (result.isSuccess) {
            return WipeOutcome(WipeTriggerOutcome.DELIVERED, null)
        }

        // A wipe tears the connection down as it starts, so a non-zero exit here is
        // genuinely ambiguous. On 14-Oct this returned exit 224 with the device already
        // absent from ADB, which is what a wipe starting looks like. Reporting that as
        // a failure would have recorded the run's most important outcome backwards,
        // so it is reported as what it is: unsettled until the post-reboot reading.
        return WipeOutcome(
            WipeTriggerOutcome.INDETERMINATE,
            "The wipe command was issued and its outcome could not be established from " +
                "the workstation: the device stopped answering (exit ${result.exitCode}). " +
                "That is consistent with the wipe starting. It is settled only by the " +
                "post-reboot reading, never by a second guess here.",
        )
    }

    /** Explicitly cancels any armed state on the device. */
    fun disarm(): Boolean {
        val targetPkg = resolveActivePackage() ?: AGENT_PACKAGE
        val disarmCommand = "am broadcast -n $targetPkg/.SanitizationBroadcastReceiver -p $targetPkg -a $targetPkg.DISARM --es targetSerial $serial"
        val result = adbClient.runShell(serial, disarmCommand)
        return result.isSuccess
    }

    /** `null` when the listing did not answer. */
    private fun agentInstalled(): Boolean? {
        val result = adbClient.runShell(serial, CMD_AGENT_PRESENT)
        if (!result.isSuccess) return null
        val found = result.stdout.lines().any {
            it.trim().startsWith(PACKAGE_LINE_PREFIX) &&
                it.contains(AGENT_PACKAGE, ignoreCase = true)
        }
        if (found) return true
        val altResult = adbClient.runShell(serial, "pm list packages co.in.cyvra.mobile")
        if (altResult.isSuccess && altResult.stdout.lines().any { it.trim() == "package:co.in.cyvra.mobile" }) {
            return true
        }
        return false
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
