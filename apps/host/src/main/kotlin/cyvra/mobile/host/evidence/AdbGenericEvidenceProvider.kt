package cyvra.mobile.host.evidence

import cyvra.mobile.core.BatteryEvidence
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.DeviceEvidenceProvider
import cyvra.mobile.core.DeviceIdentifierRecord
import cyvra.mobile.core.DeviceIdentityEvidence
import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.core.ExtendedDeviceEvidence
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.SecurityEvidence
import cyvra.mobile.core.StorageEvidence
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.AdbDeviceInspector
import cyvra.mobile.host.transport.ProcessExecutionResult
import java.util.UUID

/**
 * Generic Android evidence collector utilizing controlled ADB transport.
 * Follows honesty guidelines:
 * - Source is explicitly labelled ("ADB" / "ANDROID_PLATFORM")
 * - Failure in one collector does not crash the overall scan
 * - Hardware serial / IMEI are never fabricated; restricted state reported honestly
 * - Battery SOH and Knox claims are not asserted without authorization
 */
class AdbGenericEvidenceProvider(
    private val adbClient: AdbClient,
    private val serial: String,
    private val sessionUuid: String = UUID.randomUUID().toString(),
) : DeviceEvidenceProvider, cyvra.mobile.core.DeviceCapabilityProvider {

    override fun getCapabilityProfile(): CapabilityProfile {
        return AdbDeviceInspector(adbClient).inspectDevice(serial)
    }

    override fun collectIdentity(): DeviceIdentityEvidence {
        val manufacturer = getProp("ro.product.manufacturer")
        val brand = getProp("ro.product.brand")
        val model = getProp("ro.product.model")
        val device = getProp("ro.product.device")
        val product = getProp("ro.product.name")
        val buildId = getProp("ro.build.id")
        val androidVersion = getProp("ro.build.version.release")
        val apiLevelStr = getProp("ro.build.version.sdk")
        val securityPatch = getProp("ro.build.version.security_patch")
        val fingerprint = getProp("ro.build.fingerprint")
        val platformId = getAdbSecureSetting("android_id")

        return DeviceIdentityEvidence(
            manufacturer = makeField(manufacturer, "UNKNOWN"),
            brand = makeField(brand, "UNKNOWN"),
            model = makeField(model, "UNKNOWN"),
            device = makeField(device, ""),
            product = makeField(product, ""),
            buildId = makeField(buildId, ""),
            androidVersion = makeField(androidVersion, ""),
            apiLevel = EvidenceFieldResult(
                value = apiLevelStr?.toIntOrNull() ?: 0,
                status = if (apiLevelStr != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
            ),
            securityPatch = makeField(securityPatch, ""),
            platformIdentifier = makeField(platformId, null),
            buildFingerprint = EvidenceFieldResult(
                value = fingerprint,
                status = if (fingerprint != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = if (fingerprint == null) "ro.build.fingerprint is not published on this device" else null,
            ),
            hardwareSerial = DeviceIdentifierRecord(
                identifierType = "HARDWARE_SERIAL",
                value = null,
                source = "ADB",
                scope = "DEVICE",
                availability = EvidenceStatus.RESTRICTED,
                reason = "Modern Android restricts persistent hardware serial via non-privileged interfaces",
            ),
            imei = DeviceIdentifierRecord(
                identifierType = "IMEI",
                value = null,
                source = "ADB",
                scope = "DEVICE",
                availability = EvidenceStatus.RESTRICTED,
                reason = "Telephony IMEI restricted by platform security; requires carrier or enterprise privilege",
            ),
        )
    }

    override fun collectBattery(): BatteryEvidence {
        val dumpsys = adbClient.runShell(serial, "dumpsys battery")
        if (!dumpsys.isSuccess) {
            return BatteryEvidence(
                levelPercent = EvidenceFieldResult(null, EvidenceStatus.ERROR, "ADB", dumpsys.stderr),
                isCharging = EvidenceFieldResult(null, EvidenceStatus.ERROR, "ADB", dumpsys.stderr),
                health = EvidenceFieldResult(null, EvidenceStatus.ERROR, "ADB", dumpsys.stderr),
                stateOfHealthSoh = EvidenceFieldResult(
                    null,
                    EvidenceStatus.RESTRICTED,
                    "ADB",
                    "Battery SOH is privileged manufacturer/enterprise diagnostic",
                ),
            )
        }

        val output = dumpsys.stdout
        val level = output.lines().firstOrNull { it.trim().startsWith("level:") }
            ?.substringAfter("level:")?.trim()?.toIntOrNull()
        val plugged = output.lines().firstOrNull { it.trim().startsWith("AC powered:") || it.trim().startsWith("USB powered:") }
            ?.substringAfter(":")?.trim()?.toBooleanStrictOrNull() ?: false
        val usbPlugged = output.lines().firstOrNull { it.trim().startsWith("USB powered:") }
            ?.substringAfter(":")?.trim()?.toBooleanStrictOrNull() ?: false
        val isCharging = plugged || usbPlugged
        val health = output.lines().firstOrNull { it.trim().startsWith("health:") }
            ?.substringAfter("health:")?.trim() ?: "UNKNOWN"
        // BAT-004 was present in this output all along and simply discarded.
        val rawTemp = output.lines().firstOrNull { it.trim().startsWith("temperature:") }
            ?.substringAfter("temperature:")?.trim()?.toIntOrNull()

        return BatteryEvidence(
            levelPercent = EvidenceFieldResult(level, if (level != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            isCharging = EvidenceFieldResult(isCharging, EvidenceStatus.AVAILABLE, "ADB"),
            health = EvidenceFieldResult(health, EvidenceStatus.AVAILABLE, "ADB"),
            rawTemperatureDeviceUnits = EvidenceFieldResult(
                value = rawTemp,
                status = if (rawTemp != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = if (rawTemp != null) {
                    "raw device units from dumpsys battery; not converted to Celsius pending calibration"
                } else {
                    "dumpsys battery published no temperature line"
                },
            ),
            stateOfHealthSoh = EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.RESTRICTED,
                source = "ADB",
                reason = "Battery SOH is not exposed through standard dumpsys battery",
            ),
        )
    }

    override fun collectStorage(): StorageEvidence {
        val df = adbClient.runShell(serial, "df -k /data")
        var totalBytes: Long? = null
        var availBytes: Long? = null

        if (df.isSuccess) {
            val lines = df.stdout.lines().filter { it.isNotBlank() }
            if (lines.size >= 2) {
                val tokens = lines[1].trim().split("\\s+".toRegex())
                if (tokens.size >= 4) {
                    val totalKb = tokens[1].toLongOrNull()
                    val availKb = tokens[3].toLongOrNull()
                    if (totalKb != null) totalBytes = totalKb * 1024
                    if (availKb != null) availBytes = availKb * 1024
                }
            }
        }

        // Both storage policy flags were previously hardcoded and stamped AVAILABLE.
        // `externalStoragePresent` is genuinely observable, so it is measured. Scoped-storage
        // enforcement is a per-application policy with no shell-visible signal, so it is
        // reported as unobservable rather than asserted - and the narrative string no longer
        // claims a policy state that was never established.
        return StorageEvidence(
            internalTotalBytes = EvidenceFieldResult(totalBytes, if (totalBytes != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            internalAvailableBytes = EvidenceFieldResult(availBytes, if (availBytes != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            externalStoragePresent = readExternalStoragePresent(),
            scopedStorageEnforced = EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "Scoped-storage enforcement is a per-application policy; it is not observable from an ADB shell",
            ),
            accessLimitation = "Reported capacity only; no directory crawl is performed (§22)",
        )
    }

    /** Removable/adopted volumes appear under /storage beside the emulated tree. */
    private fun readExternalStoragePresent(): EvidenceFieldResult<Boolean> {
        val result = adbClient.runShell(serial, "ls /storage")
        if (!result.isSuccess) return EvidenceFieldResult(
            value = null,
            status = EvidenceStatus.ERROR,
            source = "ADB",
            reason = "ls /storage failed: " + (result.stderr.ifBlank { "exit ${result.exitCode}, no diagnostic output" }),
        )
        val knownInternal = setOf("emulated", "self", "enc_emulated", "adopted", "README")
        val entries = result.stdout.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val external = entries.filterNot { it in knownInternal }
        return EvidenceFieldResult(
            value = external.isNotEmpty(),
            status = EvidenceStatus.AVAILABLE,
            source = "ADB",
            reason = if (external.isNotEmpty()) "observed volumes: ${external.joinToString(", ")}" else "only internal volumes present",
        )
    }

    override fun collectSecurity(): SecurityEvidence {
        // SEC-001 - screen lock state, observed from the trust service.
        // A failed command used to be rewritten as `false` stamped AVAILABLE. That turned
        // an unmeasured state into a negative finding, which the honesty rule forbids, so
        // a failure now reports ERROR and carries the reason instead.
        val lockResult = adbClient.runShell(serial, "dumpsys trust")
        val screenLockPresent = if (lockResult.isSuccess) {
            EvidenceFieldResult(
                value = lockResult.stdout.contains("deviceLocked=true") ||
                    lockResult.stdout.contains("currentUserIsSecure=true"),
                status = EvidenceStatus.AVAILABLE,
                source = "ADB",
            )
        } else {
            failureField("dumpsys trust", lockResult)
        }

        // SEC-002 - USB debugging state, read from the global settings namespace.
        val adbEnabled = readGlobalSettingBoolean("adb_enabled")

        // SEC-004 - bootloader / verified-boot state as published by the boot property.
        val secureBootEnabled = readVerifiedBootState()

        // SEC-005 - device-owner state, read from the device policy service.
        val deviceOwnerActive = readDeviceOwnerState()

        return SecurityEvidence(
            screenLockPresent = screenLockPresent,
            secureBootEnabled = secureBootEnabled,
            deviceOwnerActive = deviceOwnerActive,
            adbEnabled = adbEnabled,
            knoxClaim = EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.RESTRICTED,
                source = "ADB",
                reason = "Enterprise Knox attestation requires licensed enterprise SDK; S1/generic does not assert Knox",
            ),
        )
    }

    /**
     * SEC-002. `settings get global adb_enabled` yields `1`, `0`, or `null` when the
     * namespace does not answer. Any of those is a real reading; only a failed command
     * is an error.
     */
    private fun readGlobalSettingBoolean(key: String): EvidenceFieldResult<Boolean> {
        val result = adbClient.runShell(serial, "settings get global $key")
        if (!result.isSuccess) return failureField("settings get global $key", result)
        val raw = result.stdout.trim()
        return when {
            raw == "1" -> EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB")
            raw == "0" -> EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB")
            else -> EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "settings returned '$raw' for $key; no boolean reading available",
            )
        }
    }

    /**
     * SEC-004. `ro.boot.verifiedbootstate` reports the verified-boot state measured by
     * the bootloader: `green` means the boot chain verified, `orange` means an unlocked
     * or modified chain, `yellow` a custom key, `red` a verification failure.
     *
     * The raw state is preserved in [EvidenceFieldResult.reason] so the boolean never
     * stands alone as an unsupported assertion.
     */
    private fun readVerifiedBootState(): EvidenceFieldResult<Boolean> {
        val result = adbClient.runShell(serial, "getprop ro.boot.verifiedbootstate")
        if (!result.isSuccess) return failureField("getprop ro.boot.verifiedbootstate", result)
        val raw = result.stdout.trim().lowercase()
        return when (raw) {
            "green" -> EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB", "verifiedbootstate=green")
            "orange", "yellow", "red" -> EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB", "verifiedbootstate=$raw")
            "" -> EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "ro.boot.verifiedbootstate is not published on this device",
            )
            else -> EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "unrecognised verifiedbootstate '$raw'; no boolean asserted",
            )
        }
    }

    /**
     * SEC-005. Device-owner state read from `dumpsys device_policy`.
     *
     * Absence of the string "Device Owner" is only treated as absence of an owner when
     * the command actually succeeded AND produced output that demonstrably contains an
     * admin enumeration. If the output cannot be interpreted with confidence, the result
     * is NOT_AVAILABLE rather than a guess - the previous `false` here was disproved on
     * hardware that was demonstrably a device owner.
     */
    private fun readDeviceOwnerState(): EvidenceFieldResult<Boolean> {
        val result = adbClient.runShell(serial, "dumpsys device_policy")
        if (!result.isSuccess) return failureField("dumpsys device_policy", result)
        val output = result.stdout
        if (output.isBlank()) {
            return EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "dumpsys device_policy returned no output; owner state not established",
            )
        }
        // The section prints an empty "Device Owner:" header even when no owner exists, so
        // the header alone is not evidence either way. Only a resolved component name
        // (package/class) establishes an owner; a present-but-empty section establishes
        // that the policy service answered and named none.
        val ownerLines = output.lineSequence()
            .map { it.trim() }
            .filter { it.startsWith("Device Owner", ignoreCase = true) }
            .toList()
        val component = ownerLines.firstOrNull { it.substringAfter(':').trim().contains('/') }
        return when {
            component != null -> EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB", "observed: $component")
            ownerLines.isNotEmpty() -> EvidenceFieldResult(
                false,
                EvidenceStatus.AVAILABLE,
                "ADB",
                "device_policy section present and named no owner component",
            )
            else -> EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.NOT_AVAILABLE,
                source = "ADB",
                reason = "dumpsys device_policy produced no recognisable Device Owner section; state not established",
            )
        }
    }

    private fun failureField(command: String, result: ProcessExecutionResult): EvidenceFieldResult<Boolean> =
        EvidenceFieldResult(
            value = null,
            status = EvidenceStatus.ERROR,
            source = "ADB",
            reason = "$command failed: " + (result.stderr.ifBlank { "exit ${result.exitCode}, no diagnostic output" }),
        )

    override fun collectAll(): GenericDeviceEvidence {
        return GenericDeviceEvidence(
            sessionUuid = sessionUuid,
            collectedAt = java.time.Instant.now().toString(),
            identity = collectIdentity(),
            battery = collectBattery(),
            storage = collectStorage(),
            security = collectSecurity(),
            extended = ExtendedDeviceEvidence(
                AdbExtendedEvidenceProvider(adbClient, serial).collect(),
            ),
        )
    }

    private fun getProp(key: String): String? {
        val result = adbClient.runShell(serial, "getprop $key")
        if (!result.isSuccess) return null
        val value = result.stdout.trim()
        return if (value.isNotEmpty()) value else null
    }

    private fun getAdbSecureSetting(key: String): String? {
        val result = adbClient.runShell(serial, "settings get secure $key")
        if (!result.isSuccess) return null
        val value = result.stdout.trim()
        return if (value.isNotEmpty() && value != "null") value else null
    }

    private fun makeField(value: String?, default: String?): EvidenceFieldResult<String> {
        val finalVal = value ?: default
        return EvidenceFieldResult(
            value = finalVal,
            status = if (finalVal != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE,
            source = "ADB",
        )
    }
}
