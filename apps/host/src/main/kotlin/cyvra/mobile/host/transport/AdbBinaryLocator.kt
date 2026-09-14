package cyvra.mobile.host.transport

import java.io.File

/**
 * Policy per §12: CYVRA should use a controlled, tested Android Platform-Tools distribution.
 * PATH adb is a diagnostic fallback only.
 */
class AdbBinaryLocator(
    private val explicitCustomPath: File? = null,
    private val environmentProvider: (String) -> String? = System::getenv,
) {
    fun locate(): File? {
        if (explicitCustomPath != null && explicitCustomPath.exists() && explicitCustomPath.canExecute()) {
            return explicitCustomPath
        }

        val bundledCandidate = File("platform-tools", if (isWindows()) "adb.exe" else "adb")
        if (bundledCandidate.exists() && bundledCandidate.canExecute()) {
            return bundledCandidate.absoluteFile
        }

        val appData = environmentProvider("LOCALAPPDATA")
        if (appData != null) {
            val studioSdkAdb = File(appData, "Android/Sdk/platform-tools/adb.exe")
            if (studioSdkAdb.exists() && studioSdkAdb.canExecute()) {
                return studioSdkAdb
            }
        }

        val androidHome = environmentProvider("ANDROID_HOME") ?: environmentProvider("ANDROID_SDK_ROOT")
        if (androidHome != null) {
            val envAdb = File(androidHome, if (isWindows()) "platform-tools/adb.exe" else "platform-tools/adb")
            if (envAdb.exists() && envAdb.canExecute()) {
                return envAdb
            }
        }

        val pathVar = environmentProvider("PATH") ?: return null
        val pathDirs = pathVar.split(File.pathSeparatorChar)
        val exeName = if (isWindows()) "adb.exe" else "adb"
        for (dir in pathDirs) {
            val file = File(dir, exeName)
            if (file.exists() && file.canExecute()) {
                return file
            }
        }

        return null
    }

    private fun isWindows(): Boolean =
        System.getProperty("os.name")?.lowercase()?.contains("win") == true
}
