package cyvra.mobile.host.transport

import java.io.File

/**
 * Policy per §12: CYVRA should use a controlled, tested Android Platform-Tools distribution.
 * PATH adb is a diagnostic fallback only.
 */
class AdbBinaryLocator(
    private val explicitCustomPath: File? = null,
    private val environmentProvider: (String) -> String? = System::getenv,
    private val installationRootProvider: () -> String? = { System.getProperty(INSTALLATION_ROOT_PROPERTY) },
) {
    fun locate(): File? {
        if (explicitCustomPath != null && explicitCustomPath.exists() && explicitCustomPath.canExecute()) {
            return explicitCustomPath
        }

        // Bundled platform-tools shipped inside the installer. The workstation passes
        // the installation root explicitly (-Dcyvra.home=), so resolution never
        // depends on the process working directory - which differs between
        // `tauri dev`, an installed run launched from a Start Menu shortcut, and a
        // support shell. Checked before every host-local guess (P1).
        val installationRoot = installationRootProvider()
        if (!installationRoot.isNullOrBlank()) {
            val bundledAdb = File(File(installationRoot, "platform-tools"), adbFileName())
            if (bundledAdb.exists() && bundledAdb.canExecute()) {
                return bundledAdb.absoluteFile
            }
        }

        // Development fallback: a `platform-tools` directory beside the working
        // directory of a source run.
        val bundledCandidate = File("platform-tools", adbFileName())
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

    private fun adbFileName(): String = if (isWindows()) "adb.exe" else "adb"

    private fun isWindows(): Boolean =
        System.getProperty("os.name")?.lowercase()?.contains("win") == true

    companion object {
        /** System property carrying the installation root passed by the workstation. */
        const val INSTALLATION_ROOT_PROPERTY: String = "cyvra.home"
    }
}
