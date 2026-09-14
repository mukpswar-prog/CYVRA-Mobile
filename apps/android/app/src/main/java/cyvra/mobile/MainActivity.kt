package cyvra.mobile

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import cyvra.mobile.core.CapabilityProfile
import cyvra.mobile.core.FeatureFact
import cyvra.mobile.core.PermissionFact
import cyvra.mobile.core.newEvidenceId
import cyvra.mobile.core.planEvidence
import cyvra.mobile.core.plannedIngestJson
import cyvra.mobile.core.queuePlannedBatch

/**
 * S1 home: capability plan + honest queued batch. No IMEI, no Knox, no grades.
 * Permissions are requested when a test starts (later slice), not on launch.
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val profile = snapshot()
        val planned = planEvidence(profile)
        val collectedAt = java.time.Instant.now().toString()
        val deviceLifecycleId = newEvidenceId()
        val processingSessionId = newEvidenceId()
        val batchId = newEvidenceId()
        val profileId = newEvidenceId()
        val batch = queuePlannedBatch(
            profile = profile,
            deviceLifecycleId = deviceLifecycleId,
            processingSessionId = processingSessionId,
            batchId = batchId,
            collectedAt = collectedAt,
        )
        val ingest = plannedIngestJson(
            profile = profile,
            deviceLifecycleId = deviceLifecycleId,
            processingSessionId = processingSessionId,
            batchId = batchId,
            profileId = profileId,
            collectedAt = collectedAt,
        )
        filesDir.resolve("cyvra-g5-batch.json").writeText(ingest)
        val text = buildString {
            appendLine("CYVRA Mobile Evidence")
            appendLine("S1 planned batch — not a sanitization report.")
            appendLine("POST https://api.cyvoriq.co.in/evidence/batches")
            appendLine("USB file copy is not device authorization.")
            appendLine("Logins are separate from Windows Erase.")
            appendLine()
            appendLine("Build: ${profile.manufacturer} ${profile.model} / SDK ${profile.sdkInt}")
            appendLine("Android ID (not IMEI): ${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)}")
            appendLine("Queued ${batch.records.size} records. PASS count: ${batch.records.count { it.result == "PASS" }} (must be 0).")
            appendLine("Saved files/cyvra-g5-batch.json")
            appendLine()
            for (row in planned) {
                appendLine("${row.testId}  ${row.uiStatus}  (${row.plannedResult})")
            }
        }
        val view = TextView(this).apply {
            textSize = 14f
            setPadding(32, 32, 32, 32)
            setText(text)
        }
        val share = Button(this).apply {
            text = "Share batch JSON"
            setOnClickListener {
                startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).apply {
                            type = "application/json"
                            putExtra(Intent.EXTRA_TEXT, ingest)
                            putExtra(Intent.EXTRA_SUBJECT, "CYVRA Mobile S1 batch $batchId")
                        },
                        "Share CYVRA batch",
                    ),
                )
            }
        }
        val scroll = ScrollView(this)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        box.addView(share)
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
