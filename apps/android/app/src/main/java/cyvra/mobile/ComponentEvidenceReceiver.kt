package cyvra.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.util.DisplayMetrics
import cyvra.mobile.core.AndroidComponentEvidencePayload
import cyvra.mobile.core.ComponentBatteryExtras
import cyvra.mobile.core.ComponentDisplayMetrics
import cyvra.mobile.core.FeatureFact
import cyvra.mobile.core.PermissionFact
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * BroadcastReceiver triggered by the Windows Host via ADB:
 * `am broadcast -a co.in.cyvra.mobile.COLLECT_EVIDENCE --es sessionUuid "..." --es deviceLifecycleId "..."`
 *
 * Collects on-device component evidence, serializes it, and saves it
 * to app-private storage for the host to read.
 * Source is explicitly "ANDROID_COMPONENT" (§19).
 */
class ComponentEvidenceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_COLLECT_EVIDENCE) return

        val sessionUuid = intent.getStringExtra("sessionUuid") ?: "unknown-session"
        val deviceLifecycleId = intent.getStringExtra("deviceLifecycleId") ?: "unknown-lifecycle"

        val payload = collectComponentPayload(context, sessionUuid, deviceLifecycleId)
        val json = Json { prettyPrint = true }
        val serialized = json.encodeToString(payload)

        // Write to accessible external files dir so ADB pull/cat can retrieve it
        val targetFile = File(context.getExternalFilesDir(null), EVIDENCE_FILENAME)
        targetFile.writeText(serialized)
    }

    private fun collectComponentPayload(
        context: Context,
        sessionUuid: String,
        deviceLifecycleId: String,
    ): AndroidComponentEvidencePayload {
        val dm: DisplayMetrics = context.resources.displayMetrics
        val displayMetrics = ComponentDisplayMetrics(
            densityDpi = dm.densityDpi,
            widthPixels = dm.widthPixels,
            heightPixels = dm.heightPixels,
            smallestScreenWidthDp = context.resources.configuration.smallestScreenWidthDp,
            xdpi = dm.xdpi,
            ydpi = dm.ydpi,
        )

        // Query BatteryManager sticky intent for runtime hardware metrics
        val ifilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val batteryStatus: Intent? = context.registerReceiver(null, ifilter)

        val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val percent = if (level >= 0 && scale > 0) (level * 100) / scale else -1
        val isPresent = batteryStatus?.getBooleanExtra(BatteryManager.EXTRA_PRESENT, true) ?: false
        val tech = batteryStatus?.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY)
        val temp = batteryStatus?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
        val voltage = batteryStatus?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)

        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val chargeCounter = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            bm?.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
        } else null

        val batteryExtras = ComponentBatteryExtras(
            isPresent = isPresent,
            technology = tech,
            temperatureDeciCelsius = if (temp != null && temp > 0) temp else null,
            voltageMilliVolts = if (voltage != null && voltage > 0) voltage else null,
            chargeCounterUah = if (chargeCounter != null && chargeCounter > 0) chargeCounter else null,
            capacityPercent = percent,
        )

        val pm = context.packageManager
        val flags = listOf(
            PackageManager.FEATURE_CAMERA,
            PackageManager.FEATURE_CAMERA_FRONT,
            PackageManager.FEATURE_CAMERA_ANY,
            PackageManager.FEATURE_TOUCHSCREEN,
            PackageManager.FEATURE_MICROPHONE,
            PackageManager.FEATURE_WIFI,
            PackageManager.FEATURE_BLUETOOTH,
            PackageManager.FEATURE_TELEPHONY,
            PackageManager.FEATURE_AUDIO_OUTPUT,
            PackageManager.FEATURE_SENSOR_ACCELEROMETER,
            PackageManager.FEATURE_SENSOR_GYROSCOPE,
            PackageManager.FEATURE_SENSOR_PROXIMITY,
            PackageManager.FEATURE_SENSOR_LIGHT,
            PackageManager.FEATURE_SENSOR_COMPASS,
        )
        val declaredFeatures = flags.map { name ->
            FeatureFact(
                feature = name,
                declared = pm.hasSystemFeature(name),
                state = "DECLARED",
            )
        }

        val runtimePermissions = listOf(
            PermissionFact(
                "android.permission.CAMERA",
                context.checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
            ),
            PermissionFact(
                "android.permission.RECORD_AUDIO",
                context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
            ),
        )

        return AndroidComponentEvidencePayload(
            componentVersion = "0.0.0-g5",
            collectedAt = java.time.Instant.now().toString(),
            source = "ANDROID_COMPONENT",
            deviceLifecycleId = deviceLifecycleId,
            sessionUuid = sessionUuid,
            displayMetrics = displayMetrics,
            batteryExtras = batteryExtras,
            runtimePermissions = runtimePermissions,
            declaredFeatures = declaredFeatures,
            limitations = listOf("Collected via on-device supporting Android Component (S1/APK)."),
        )
    }

    companion object {
        const val ACTION_COLLECT_EVIDENCE = "co.in.cyvra.mobile.COLLECT_EVIDENCE"
        const val EVIDENCE_FILENAME = "cyvra-component-evidence.json"
    }
}
