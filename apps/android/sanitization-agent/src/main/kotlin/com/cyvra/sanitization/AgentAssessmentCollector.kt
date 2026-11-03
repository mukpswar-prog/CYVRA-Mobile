package com.cyvra.sanitization

import android.app.ActivityManager
import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native on-device assessment collector for CYVRA Android Agent 2.1.1.
 *
 * Directly queries Android OS framework APIs to extract comprehensive hardware, storage,
 * encryption, privilege, and sanitization capability intelligence.
 * Operates without external third-party dependencies using Android SDK core classes.
 */
class AgentAssessmentCollector(private val context: Context) {

    fun collectAssessment(sessionUuid: String?): JSONObject {
        val root = JSONObject()
        root.put("schemaVersion", "cyvra.agent.assessment.v2")
        root.put("agentVersion", "2.1.2")
        root.put("agentPackage", context.packageName)
        root.put("sessionUuid", sessionUuid ?: "UNBOUND")
        root.put("timestampMs", System.currentTimeMillis())

        root.put("hardware", collectHardware())
        root.put("storage", collectStorage())
        root.put("system", collectSystem())
        root.put("security", collectSecurity())
        root.put("management", collectManagement())
        root.put("methodQualification", evaluateMethods())

        return root
    }

    private fun collectHardware(): JSONObject {
        val hw = JSONObject()
        hw.put("manufacturer", Build.MANUFACTURER)
        hw.put("brand", Build.BRAND)
        hw.put("model", Build.MODEL)
        hw.put("product", Build.PRODUCT)
        hw.put("device", Build.DEVICE)
        hw.put("board", Build.BOARD)
        hw.put("hardware", Build.HARDWARE)

        val abis = JSONArray()
        Build.SUPPORTED_ABIS.forEach { abis.put(it) }
        hw.put("supportedAbis", abis)

        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (am != null) {
                val memInfo = ActivityManager.MemoryInfo()
                am.getMemoryInfo(memInfo)
                hw.put("ramTotalBytes", memInfo.totalMem)
                hw.put("ramAvailBytes", memInfo.availMem)
                hw.put("lowMemory", memInfo.lowMemory)
            }
        } catch (_: Throwable) {
            hw.put("ramTotalBytes", -1L)
        }

        try {
            val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (batteryIntent != null) {
                val battery = JSONObject()
                battery.put("level", batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1))
                battery.put("scale", batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1))
                battery.put("health", batteryIntent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1))
                battery.put("temperatureTenthsC", batteryIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1))
                battery.put("voltageMv", batteryIntent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1))
                battery.put("status", batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, -1))
                battery.put("plugged", batteryIntent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1))
                battery.put("technology", batteryIntent.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: "Unknown")
                hw.put("battery", battery)
            }
        } catch (_: Throwable) {
            // Battery telemetry unavailable
        }

        return hw
    }

    private fun collectStorage(): JSONObject {
        val storage = JSONObject()
        try {
            val dataDir = Environment.getDataDirectory()
            val statFs = StatFs(dataDir.path)
            storage.put("dataTotalBytes", statFs.totalBytes)
            storage.put("dataAvailBytes", statFs.availableBytes)
            storage.put("dataFreeBytes", statFs.freeBytes)
        } catch (_: Throwable) {
            storage.put("dataTotalBytes", -1L)
        }

        try {
            val rootDir = Environment.getRootDirectory()
            val sysStat = StatFs(rootDir.path)
            storage.put("systemTotalBytes", sysStat.totalBytes)
            storage.put("systemAvailBytes", sysStat.availableBytes)
        } catch (_: Throwable) {
            storage.put("systemTotalBytes", -1L)
        }

        try {
            storage.put("isExternalStorageEmulated", Environment.isExternalStorageEmulated())
            storage.put("isExternalStorageRemovable", Environment.isExternalStorageRemovable())
        } catch (_: Throwable) {
            // Storage flags
        }

        return storage
    }

    private fun collectSystem(): JSONObject {
        val sys = JSONObject()
        sys.put("androidVersion", Build.VERSION.RELEASE)
        sys.put("sdkInt", Build.VERSION.SDK_INT)
        sys.put("buildId", Build.ID)
        sys.put("buildFingerprint", Build.FINGERPRINT)
        sys.put("securityPatch", Build.VERSION.SECURITY_PATCH)
        sys.put("bootloader", Build.BOOTLOADER)
        return sys
    }

    private fun collectSecurity(): JSONObject {
        val sec = JSONObject()
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

        val encStatus = try {
            dpm?.storageEncryptionStatus ?: DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED
        } catch (_: Throwable) {
            DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED
        }
        sec.put("storageEncryptionStatus", encStatus)
        sec.put("isEncrypted", encStatus == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE ||
                encStatus == 5 /* ENCRYPTION_STATUS_ACTIVE_PER_USER */)

        try {
            val km = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            sec.put("isDeviceSecure", km?.isDeviceSecure ?: false)
        } catch (_: Throwable) {
            sec.put("isDeviceSecure", false)
        }

        try {
            val pm = context.packageManager
            sec.put("hasStrongBox", pm.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
            sec.put("hasFingerprint", pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT))
        } catch (_: Throwable) {
            sec.put("hasStrongBox", false)
        }

        return sec
    }

    private fun collectManagement(): JSONObject {
        val mgmt = JSONObject()
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

        val isDO = try {
            dpm?.isDeviceOwnerApp(context.packageName) ?: false
        } catch (_: Throwable) {
            false
        }
        val isAdmin = try {
            dpm?.isAdminActive(ComponentName(context, SanitizationAdmin::class.java)) ?: false
        } catch (_: Throwable) {
            false
        }

        mgmt.put("isDeviceOwner", isDO)
        mgmt.put("isAdminActive", isAdmin)

        return mgmt
    }

    private fun evaluateMethods(): JSONObject {
        val eval = JSONObject()
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

        val isDO = try {
            dpm?.isDeviceOwnerApp(context.packageName) ?: false
        } catch (_: Throwable) {
            false
        }

        val encStatus = try {
            dpm?.storageEncryptionStatus ?: DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED
        } catch (_: Throwable) {
            DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED
        }
        val isEncrypted = encStatus == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE ||
                encStatus == 5 /* ENCRYPTION_STATUS_ACTIVE_PER_USER */

        val isSamsung = Build.MANUFACTURER.equals("samsung", ignoreCase = true)

        eval.put("deviceOwnerWipeSupported", isDO)
        eval.put("cryptographicEraseSupported", isEncrypted)
        eval.put("oemSecureEraseSupported", isSamsung)
        eval.put("platformResetSupported", true)

        val recommendedMethod = when {
            isDO -> "CLEAR_DEVICE_OWNER_WIPE"
            isEncrypted -> "PURGE_CRYPTOGRAPHIC_ERASE"
            isSamsung -> "PURGE_OEM_SECURE_ERASE"
            else -> "CLEAR_PLATFORM_RESET"
        }

        eval.put("recommendedMethod", recommendedMethod)
        eval.put("qualificationStatus", "QUALIFIED")

        return eval
    }
}
