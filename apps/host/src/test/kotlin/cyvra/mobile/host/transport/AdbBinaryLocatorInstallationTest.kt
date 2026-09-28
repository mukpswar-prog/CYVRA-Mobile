package cyvra.mobile.host.transport

import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Resolution-order guarantees for the *installed* layout (P1).
 *
 * The workstation hands the installation root to the JVM as `-Dcyvra.home=`, so
 * the bundled `platform-tools/adb.exe` must win over every host-local guess,
 * and must degrade to the Android SDK instead of failing when it is absent.
 */
class AdbBinaryLocatorInstallationTest {

    private val adbName = if (isWindows()) "adb.exe" else "adb"

    @Test
    fun `bundled platform-tools wins over PATH and SDK candidates`() {
        val root = tempDir("cyvra-home-present")
        val bundled = writeAdb(File(root, "platform-tools"))

        val sdk = tempDir("cyvra-sdk")
        writeAdb(File(sdk, "platform-tools"))

        val locator = AdbBinaryLocator(
            environmentProvider = { name ->
                when (name) {
                    "ANDROID_HOME" -> sdk.absolutePath
                    "PATH" -> sdk.absolutePath
                    else -> null
                }
            },
            installationRootProvider = { root.absolutePath },
        )

        assertEquals(bundled.canonicalFile, locator.locate()?.canonicalFile)
    }

    @Test
    fun `explicit override still wins over the bundled binary`() {
        val root = tempDir("cyvra-home-override")
        writeAdb(File(root, "platform-tools"))

        val override = writeAdb(tempDir("cyvra-override"))

        val locator = AdbBinaryLocator(
            explicitCustomPath = override,
            installationRootProvider = { root.absolutePath },
        )

        assertEquals(override.canonicalFile, locator.locate()?.canonicalFile)
    }

    @Test
    fun `absent bundled adb falls back to the Android SDK instead of failing`() {
        val root = tempDir("cyvra-home-absent")

        val sdk = tempDir("cyvra-sdk-fallback")
        val sdkAdb = writeAdb(File(sdk, "platform-tools"))

        val locator = AdbBinaryLocator(
            environmentProvider = { name ->
                if (name == "ANDROID_HOME") sdk.absolutePath else null
            },
            installationRootProvider = { root.absolutePath },
        )

        assertEquals(sdkAdb.canonicalFile, locator.locate()?.canonicalFile)
    }

    @Test
    fun `no candidates resolves to null instead of a fabricated path`() {
        val locator = AdbBinaryLocator(
            environmentProvider = { null },
            installationRootProvider = { null },
        )

        assertNull(
            locator.locate(),
            "resolution must report absence honestly rather than invent an adb",
        )
    }

    private fun tempDir(prefix: String): File =
        Files.createTempDirectory(prefix).toFile()

    private fun writeAdb(dir: File): File {
        dir.mkdirs()
        val adb = File(dir, adbName)
        adb.writeText("stub")
        adb.setExecutable(true)
        return adb
    }

    private fun isWindows(): Boolean =
        System.getProperty("os.name")?.lowercase()?.contains("win") == true
}
