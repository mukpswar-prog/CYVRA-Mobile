package cyvra.mobile.host.transport

import java.io.File

/**
 * Windows Host Preflight verifier (§16).
 * Checks OS environment, architecture, runtime, and ADB availability.
 */
class HostPreflightVerifier(
    private val adbLocator: AdbBinaryLocator = AdbBinaryLocator(),
) {
    fun runPreflight(): PreflightResult {
        val osName = System.getProperty("os.name") ?: "Unknown"
        val osArch = System.getProperty("os.arch") ?: "Unknown"
        val javaVersion = System.getProperty("java.version") ?: "Unknown"

        val isWindows = osName.lowercase().contains("win")
        val is64Bit = osArch.contains("64") || System.getenv("ProgramFiles(x86)") != null

        val checks = mutableListOf<PreflightCheckItem>()

        // 1. Operating System
        checks.add(
            PreflightCheckItem(
                checkName = "Operating System",
                pass = isWindows,
                details = "OS: $osName (Windows 10/11 64-bit required for production host)",
                isOptional = !isWindows, // Allow CI/Linux for dev/test execution
            ),
        )

        // 2. 64-bit Architecture
        checks.add(
            PreflightCheckItem(
                checkName = "64-bit Architecture",
                pass = is64Bit,
                details = "Architecture: $osArch",
            ),
        )

        // 3. Java Runtime (JDK 21 per freeze)
        val isJava21 = javaVersion.startsWith("21")
        checks.add(
            PreflightCheckItem(
                checkName = "Java Runtime",
                pass = isJava21,
                details = "Java version: $javaVersion (Freeze pins JDK 21)",
            ),
        )

        // 4. ADB Component
        val adbFile = adbLocator.locate()
        val adbFound = adbFile != null && adbFile.exists() && adbFile.canExecute()
        checks.add(
            PreflightCheckItem(
                checkName = "ADB Component",
                pass = adbFound,
                details = if (adbFile != null) "Found ADB at: ${adbFile.absolutePath}" else "ADB binary not located in platform-tools or standard locations",
            ),
        )

        val criticalPass = checks.filter { !it.isOptional }.all { it.pass }
        return PreflightResult(
            readyToScan = criticalPass,
            checks = checks,
        )
    }
}
