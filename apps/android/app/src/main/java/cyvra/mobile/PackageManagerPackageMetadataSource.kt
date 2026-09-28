package cyvra.mobile

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import cyvra.mobile.core.PackageMetadataSource
import cyvra.mobile.core.RawPackageMetadata

/**
 * PackageManager-backed implementation of [PackageMetadataSource] — the Android seam of the
 * S1 device-side application-inventory collector (DEVICE_EVIDENCE_ARCHITECTURE §18.4).
 *
 * Boundaries:
 * - **Metadata only**: package names, ApplicationInfo system flags, the platform
 *   enabled-setting, versionName/versionCode, UID, and label as descriptive text.
 *   Application content (messages, photos, contacts, accounts, databases, credentials,
 *   tokens, notifications, clipboard, usage history) is never read or exposed.
 * - **No classification happens here**: raw flags are passed through as evidence; the
 *   approved pure functions in `:core` decide classification. Package names, labels,
 *   paths, code paths, installer names, and OEM strings are never inspected.
 * - **S1 independence**: PackageManager only — no ADB, no ProcessRunner, no host, no
 *   workstation component. This collector works with USB connected, ADB OFF, ADB
 *   unavailable, or no ADB installation at all.
 * - **No visibility widening**: no `<queries>`, no `QUERY_ALL_PACKAGES`, no new
 *   permissions. Enumeration legitimately reflects only the packages visible to this
 *   application; the `:core` collector records that honestly as FILTERED.
 * - **Fail-closed**: every platform failure becomes `null` (evidence unavailable), never
 *   a guess, and never a crash of the collecting application.
 */
class PackageManagerPackageMetadataSource(
    private val context: Context,
) : PackageMetadataSource {

    private val packageManager: PackageManager
        get() = context.packageManager

    override fun listVisiblePackageNames(): List<String>? = try {
        @Suppress("DEPRECATION")
        packageManager.getInstalledPackages(0).mapNotNull { it.packageName }
    } catch (e: Exception) {
        null
    }

    override fun readRawMetadata(packageName: String): RawPackageMetadata? = try {
        @Suppress("DEPRECATION")
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val applicationInfo = packageInfo.applicationInfo

        // Version: strongest representation available at this API level. longVersionCode
        // exists only from API 28 (P); reading it is runtime-guarded, never fabricated.
        @Suppress("DEPRECATION")
        val legacyVersionCode = packageInfo.versionCode.toLong()
        val longVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            null
        }

        // Authoritative platform enabled-setting; a failed query yields null (UNKNOWN),
        // never ENABLED or DISABLED.
        val rawEnabledState = try {
            packageManager.getApplicationEnabledSetting(packageName)
        } catch (e: Exception) {
            null
        }

        // Label is descriptive metadata only; resolution failure keeps it null.
        val label = try {
            applicationInfo?.loadLabel(packageManager)?.toString()
        } catch (e: Exception) {
            null
        }

        RawPackageMetadata(
            systemFlag = applicationInfo?.let { (it.flags and ApplicationInfo.FLAG_SYSTEM) != 0 },
            updatedSystemFlag = applicationInfo?.let {
                (it.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
            },
            rawEnabledState = rawEnabledState,
            versionName = packageInfo.versionName,
            longVersionCode = longVersionCode,
            legacyVersionCode = legacyVersionCode,
            uid = applicationInfo?.uid?.toLong(),
            label = label,
        )
    } catch (e: Exception) {
        null
    }

    override fun deviceApiLevel(): Int = Build.VERSION.SDK_INT
}
