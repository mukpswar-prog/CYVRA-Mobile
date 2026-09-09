package cyvra.mobile

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.FeatureFact
import cyvra.mobile.core.PermissionFact
import cyvra.mobile.core.planEvidence

/**
 * S1 home: capability plan only. No IMEI, no Knox, no grades.
 * Permissions are requested when a test starts (later slice), not on launch.
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val profile = snapshot()
        val planned = planEvidence(profile)
        val text = buildString {
            appendLine("CYVRA Mobile Evidence")
            appendLine("S1 scaffold — not a sanitization report.")
            appendLine("Logins are separate from Windows Erase.")
            appendLine()
            appendLine("Build: ${profile.manufacturer} ${profile.model} / SDK ${profile.sdkInt}")
            appendLine("Android ID (not IMEI): ${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)}")
            appendLine()
            for (row in planned) {
                appendLine("${row.testId}  ${row.uiStatus}  (${row.plannedResult})")
            }
        }
        val view = TextView(this).apply {
            textSize = 14f
            setPadding(32, 32, 32, 32)
            this.text = text
        }
        val scroll = ScrollView(this)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        box.addView(view)
        scroll.addView(box)
        setContentView(scroll)
    }

    private fun snapshot(): CapabilityProfile {
        val pm = packageManager
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
        return CapabilityProfile(
            manufacturer = Build.MANUFACTURER,
            brand = Build.BRAND,
            model = Build.MODEL,
            product = Build.PRODUCT,
            device = Build.DEVICE,
            fingerprint = Build.FINGERPRINT,
            androidRelease = Build.VERSION.RELEASE,
            sdkInt = Build.VERSION.SDK_INT,
            smallestScreenWidthDp = resources.configuration.smallestScreenWidthDp,
            accessLevel = "L2_S1_APP",
            usbState = "USB_UNKNOWN",
            adbState = "ADB_UNKNOWN",
            features = flags.map { name ->
                FeatureFact(
                    feature = name,
                    declared = pm.hasSystemFeature(name),
                    state = "DECLARED",
                )
            },
            permissions = listOf(
                PermissionFact(
                    "android.permission.CAMERA",
                    checkSelfPermission(android.Manifest.permission.CAMERA) ==
                        PackageManager.PERMISSION_GRANTED,
                ),
                PermissionFact(
                    "android.permission.RECORD_AUDIO",
                    checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED,
                ),
            ),
        )
    }
}
