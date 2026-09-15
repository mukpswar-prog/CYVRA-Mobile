package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Payload produced by the on-device CYVRA Android Component (APK).
 * Source is always explicitly recorded as "ANDROID_COMPONENT" (§19).
 * Contains device-side facts and measurements that cannot be reliably
 * determined via remote ADB shell alone (e.g., active display metrics,
 * runtime permissions, thermal headroom, detailed battery extras, hardware sensors).
 */
@Serializable
data class AndroidComponentEvidencePayload(
    val schemaVersion: String = SCHEMA_VERSION,
    val componentVersion: String = "0.0.0-g5",
    val collectedAt: String = java.time.Instant.now().toString(),
    val source: String = "ANDROID_COMPONENT",
    val deviceLifecycleId: String,
    val sessionUuid: String,
    val displayMetrics: ComponentDisplayMetrics,
    val batteryExtras: ComponentBatteryExtras,
    val runtimePermissions: List<PermissionFact>,
    val declaredFeatures: List<FeatureFact>,
    val limitations: List<String> = emptyList(),
)

@Serializable
data class ComponentDisplayMetrics(
    val densityDpi: Int,
    val widthPixels: Int,
    val heightPixels: Int,
    val smallestScreenWidthDp: Int,
    val xdpi: Float,
    val ydpi: Float,
)

@Serializable
data class ComponentBatteryExtras(
    val isPresent: Boolean,
    val technology: String?,
    val temperatureDeciCelsius: Int?,
    val voltageMilliVolts: Int?,
    val chargeCounterUah: Long? = null,
    val capacityPercent: Int,
)

/**
 * Result of interacting with the Android Component on the device.
 */
@Serializable
data class AndroidComponentExecutionResult(
    val isInstalled: Boolean,
    val packageVersion: String? = null,
    val isExecutable: Boolean,
    val payload: AndroidComponentEvidencePayload? = null,
    val error: String? = null,
)

/**
 * Contract for interacting with the supporting on-device Android Component.
 */
interface AndroidComponentBridge {
    fun checkInstalled(): Boolean
    fun getComponentVersion(): String?
    fun triggerEvidenceCollection(sessionUuid: String, deviceLifecycleId: String): AndroidComponentExecutionResult
}
