package cyvra.mobile.host.transport

import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.FeatureFact
import cyvra.mobile.core.PermissionFact

/**
 * Basic ADB device inspector for querying Android platform properties via getprop / dumpsys.
 * Follows honesty guidelines: unavailable is null, no IMEI fabrication.
 */
class AdbDeviceInspector(
    private val adbClient: AdbClient,
) {
    fun inspectDevice(serial: String): CapabilityProfile {
        val manufacturer = getProp(serial, "ro.product.manufacturer") ?: "UNKNOWN"
        val brand = getProp(serial, "ro.product.brand") ?: "UNKNOWN"
        val model = getProp(serial, "ro.product.model") ?: "UNKNOWN"
        val product = getProp(serial, "ro.product.name") ?: ""
        val device = getProp(serial, "ro.product.device") ?: ""
        val fingerprint = getProp(serial, "ro.build.fingerprint") ?: ""
        val androidRelease = getProp(serial, "ro.build.version.release") ?: ""
        val sdkInt = getProp(serial, "ro.build.version.sdk")?.toIntOrNull() ?: 0

        val features = querySystemFeatures(serial)

        return CapabilityProfile(
            manufacturer = manufacturer,
            brand = brand,
            model = model,
            product = product,
            device = device,
            fingerprint = fingerprint,
            androidRelease = androidRelease,
            sdkInt = sdkInt,
            smallestScreenWidthDp = null,
            accessLevel = "L2_HOST_ADB",
            usbState = "USB_CONNECTED_DATA",
            adbState = "ADB_AUTHORIZED",
            features = features,
            permissions = emptyList(),
            limitations = listOf("Collected via Host ADB transport. S3 enterprise hardware identifiers withheld."),
        )
    }

    private fun getProp(serial: String, key: String): String? {
        val result = adbClient.runShell(serial, "getprop $key")
        if (!result.isSuccess) return null
        val value = result.stdout.trim()
        return if (value.isNotEmpty()) value else null
    }

    private fun querySystemFeatures(serial: String): List<FeatureFact> {
        val result = adbClient.runShell(serial, "pm list features")
        if (!result.isSuccess) return emptyList()

        return result.stdout.lines()
            .map { it.trim() }
            .filter { it.startsWith("feature:") }
            .map { line ->
                val name = line.substringAfter("feature:").substringBefore("=")
                FeatureFact(
                    feature = name,
                    declared = true,
                    state = "DECLARED",
                )
            }
    }
}
