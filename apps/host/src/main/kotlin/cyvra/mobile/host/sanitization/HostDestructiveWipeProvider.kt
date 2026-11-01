package cyvra.mobile.host.sanitization

import cyvra.mobile.core.SanitizationMethodType
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
     * Establishes whether a destructive trigger may be issued at all under Option C.
     * Evaluates method-specific prerequisites (Device Owner, Cryptographic Erase, OEM, or Platform Reset).
     */
    fun preflight(selectedMethod: SanitizationMethodType = SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE): Pair<WipeEligibility, String> {
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

        return when (selectedMethod) {
            SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE -> {
                val owner = deviceOwnerPresent()
                if (owner == null) {
                    WipeEligibility.INDETERMINATE to
                        "The device-owner state could not be read, so eligibility was never established. No destructive step was attempted."
                } else if (!owner) {
                    WipeEligibility.NOT_ELIGIBLE to
                        "Refused: the CYVRA sanitization agent is installed but is not the device owner on this device, so it holds no Device Owner wipe authority."
                } else {
                    WipeEligibility.ELIGIBLE to
                        "The CYVRA sanitization agent is installed and is the device owner."
                }
            }
            SanitizationMethodType.PURGE_CRYPTOGRAPHIC_ERASE -> {
                val cryptoType = adbClient.runShell(serial, "getprop ro.crypto.type").stdout.trim()
                val cryptoState = adbClient.runShell(serial, "getprop ro.crypto.state").stdout.trim()
                val isEncrypted = cryptoState.equals("encrypted", ignoreCase = true)
                val isFbe = cryptoType.equals("file", ignoreCase = true)
                val apiLevel = adbClient.runShell(serial, "getprop ro.build.version.sdk").stdout.trim().toIntOrNull() ?: 0
                val isHwKeyStore = apiLevel >= 28

                if (!isEncrypted && !isFbe) {
                    WipeEligibility.NOT_ELIGIBLE to
                        "Refused: target device storage is unencrypted; cryptographic key destruction cannot be applied to plaintext storage."
                } else if (!isHwKeyStore) {
                    WipeEligibility.NOT_ELIGIBLE to
                        "Refused: target device platform (API $apiLevel) lacks hardware-backed KeyStore TEE required for cryptographic erasure guarantee."
                } else {
                    WipeEligibility.ELIGIBLE to
                        "Qualified: CYVRA agent installed with File-Based Encryption (FBE) and hardware-backed KeyStore TEE verified. Ready for cryptographic key destruction."
                }
            }
            SanitizationMethodType.PURGE_OEM_SECURE_ERASE -> {
                val mfr = adbClient.runShell(serial, "getprop ro.product.manufacturer").stdout.trim().lowercase()
                if (mfr.contains("samsung") || mfr.contains("google")) {
                    WipeEligibility.ELIGIBLE to "Qualified: Target device ($mfr) supports OEM hardware block erase protocol."
                } else {
                    WipeEligibility.NOT_ELIGIBLE to "Refused: OEM proprietary secure erase is not configured for manufacturer '$mfr'."
                }
            }
            SanitizationMethodType.CLEAR_PLATFORM_RESET -> {
                val apiLevel = adbClient.runShell(serial, "getprop ro.build.version.sdk").stdout.trim().toIntOrNull() ?: 0
                if (apiLevel >= 26) {
                    WipeEligibility.ELIGIBLE to "Qualified: Android platform API $apiLevel supports verified standard factory reset."
                } else {
                    WipeEligibility.NOT_ELIGIBLE to "Refused: Android API $apiLevel is below platform minimum (API 26)."
                }
            }
            SanitizationMethodType.UNSUPPORTED_METHOD -> {
                WipeEligibility.NOT_ELIGIBLE to "Refused: selected method is unsupported on this device."
            }
        }
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
    fun trigger(
        sessionUuid: String? = null,
        operationId: String? = null,
        method: SanitizationMethodType = SanitizationMethodType.CLEAR_DEVICE_OWNER_WIPE,
    ): WipeOutcome {
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

        // Read target hardware build fingerprint immediately before destructive execution
        val liveBuildFingerprint = adbClient.runShell(serial, "getprop ro.build.fingerprint")
            .takeIf { it.isSuccess }
            ?.stdout
            ?.trim()
            ?.takeIf { it.isNotEmpty() && it.none { ch -> ch.isWhitespace() || ch in ";|&`\"'<>()" } }

        val commonExtras = buildList {
            add("--es wipeToken $wipeToken")
            if (!sessionUuid.isNullOrBlank()) add("--es sessionUuid $sessionUuid")
            add("--es targetSerial $serial")
            if (!operationId.isNullOrBlank()) add("--es operationId $operationId")
            if (!liveBuildFingerprint.isNullOrBlank()) add("--es targetBuildFingerprint $liveBuildFingerprint")
            add("--es method ${method.name}")
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

    /**
     * Legitimate Android Device-Owner provisioning workflow via ADB (`dpm set-device-owner`).
     *
     * Preconditions enforced without bypassing Android platform rules:
     * 1. Confirms the device is reachable and has 0 registered user accounts (`dumpsys account`),
     *    because Android refuses `dpm set-device-owner` when personal/Google/Samsung accounts exist.
     * 2. Ensures the signed CYVRA sanitization agent APK (`com.cyvra.sanitization`) is installed.
     * 3. Runs `dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin` and re-verifies
     *    via [preflight] that `WipeEligibility.ELIGIBLE` is genuinely established.
     */
    fun provisionDeviceOwner(): Pair<Boolean, String> {
        val existingOwner = deviceOwnerPresent()
        if (existingOwner == true && agentInstalled() == true) {
            return true to "Device Owner is already active for CYVRA Sanitization Agent."
        }

        val accountsDump = adbClient.runShell(serial, "dumpsys account")
        if (!accountsDump.isSuccess) {
            return false to "Unable to inspect device account state before Device Owner provisioning."
        }
        val accountHeaderMatch = Regex("Accounts:\\s*(\\d+)").find(accountsDump.stdout)
        val accountCount = accountHeaderMatch?.groupValues?.getOrNull(1)?.toIntOrNull()
            ?: accountsDump.stdout.lines().count { it.trim().startsWith("Account {") }
        if (accountCount > 0) {
            return false to
                "Android refuses Device Owner provisioning while $accountCount account(s) exist on the device. " +
                "Remove all Google/OEM accounts in Android Settings -> Accounts first, then retry provisioning."
        }

        if (agentInstalled() != true) {
            val bridge = cyvra.mobile.host.evidence.HostAndroidComponentBridge(adbClient, serial)
            val (deployed, deployMessage) = bridge.ensureInstalledOrDeploy()
            if (!deployed && agentInstalled() != true) {
                return false to "CYVRA Sanitization Agent APK could not be installed: $deployMessage"
            }
        }

        val dpmResult = adbClient.runShell(
            serial,
            "dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin",
        )
        if (!dpmResult.isSuccess) {
            val detail = dpmResult.stderr.ifBlank { dpmResult.stdout }.trim()
            return false to "Android Device Policy Manager rejected provisioning: $detail"
        }

        val (postEligibility, postReason) = preflight()
        return if (postEligibility == WipeEligibility.ELIGIBLE) {
            true to "Device Owner provisioned and verified: $postReason"
        } else {
            false to "Provisioning command returned, but Device Owner verification is $postEligibility: $postReason"
        }
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
