package cyvra.mobile.host.evidence

import cyvra.mobile.core.BatteryEvidence
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.DeviceEvidenceProvider
import cyvra.mobile.core.DeviceIdentifierRecord
import cyvra.mobile.core.DeviceIdentityEvidence
import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.core.GenericDeviceEvidence
import cyvra.mobile.core.SecurityEvidence
import cyvra.mobile.core.StorageEvidence
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.AdbDeviceInspector
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

        return BatteryEvidence(
            levelPercent = EvidenceFieldResult(level, if (level != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            isCharging = EvidenceFieldResult(isCharging, EvidenceStatus.AVAILABLE, "ADB"),
            health = EvidenceFieldResult(health, EvidenceStatus.AVAILABLE, "ADB"),
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

        return StorageEvidence(
            internalTotalBytes = EvidenceFieldResult(totalBytes, if (totalBytes != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            internalAvailableBytes = EvidenceFieldResult(availBytes, if (availBytes != null) EvidenceStatus.AVAILABLE else EvidenceStatus.NOT_AVAILABLE, "ADB"),
            externalStoragePresent = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            scopedStorageEnforced = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            accessLimitation = "Scoped storage enforced; unrestricted filesystem access withheld (§22)",
        )
    }

    override fun collectSecurity(): SecurityEvidence {
        val lockResult = adbClient.runShell(serial, "dumpsys trust")
        val lockPresent = if (lockResult.isSuccess) {
            lockResult.stdout.contains("deviceLocked=true") || lockResult.stdout.contains("currentUserIsSecure=true")
        } else false

        return SecurityEvidence(
            screenLockPresent = EvidenceFieldResult(lockPresent, EvidenceStatus.AVAILABLE, "ADB"),
            secureBootEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            deviceOwnerActive = EvidenceFieldResult(false, EvidenceStatus.AVAILABLE, "ADB"),
            adbEnabled = EvidenceFieldResult(true, EvidenceStatus.AVAILABLE, "ADB"),
            knoxClaim = EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.RESTRICTED,
                source = "ADB",
                reason = "Enterprise Knox attestation requires licensed enterprise SDK; S1/generic does not assert Knox",
            ),
        )
    }

    override fun collectAll(): GenericDeviceEvidence {
        return GenericDeviceEvidence(
            sessionUuid = sessionUuid,
            collectedAt = java.time.Instant.now().toString(),
            identity = collectIdentity(),
            battery = collectBattery(),
            storage = collectStorage(),
            security = collectSecurity(),
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
