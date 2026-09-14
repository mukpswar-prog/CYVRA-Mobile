package cyvra.mobile.host.transport

import java.io.File

/**
 * Controlled ADB client wrapping ADB CLI invocations.
 * Adheres to:
 * - USB is not ADB
 * - ADB detected != ADB authorized
 * - Never bypass Android security controls
 */
class AdbClient(
    private val adbBinary: File,
    private val processRunner: ProcessRunner = SystemProcessRunner(),
    private val defaultTimeoutMs: Long = 10_000L,
) {
    fun getVersion(): AdbVersionInfo? {
        val result = executeAdb(listOf("version"))
        if (!result.isSuccess) return null

        val lines = result.stdout.lines()
        val versionLine = lines.firstOrNull { it.contains("Android Debug Bridge version", ignoreCase = true) }
            ?: lines.firstOrNull()
            ?: "Unknown"

        val bridgeVersion = lines.firstOrNull { it.contains("Version", ignoreCase = true) }?.trim()

        return AdbVersionInfo(
            rawOutput = result.stdout,
            versionString = versionLine.trim(),
            bridgeVersion = bridgeVersion,
            isControlledDistribution = adbBinary.path.contains("platform-tools"),
        )
    }

    fun listDevices(): List<AdbDeviceDescriptor> {
        val result = executeAdb(listOf("devices", "-l"))
        if (!result.isSuccess) return emptyList()

        return parseDevicesOutput(result.stdout)
    }

    fun getDeviceState(serial: String): String {
        val result = executeAdb(listOf("-s", serial, "get-state"))
        return if (result.isSuccess) result.stdout.trim() else "unknown"
    }

    fun runShell(serial: String, command: String, timeoutMs: Long = defaultTimeoutMs): ProcessExecutionResult {
        return executeAdb(listOf("-s", serial, "shell", command), timeoutMs)
    }

    private fun executeAdb(args: List<String>, timeoutMs: Long = defaultTimeoutMs): ProcessExecutionResult {
        val fullCommand = listOf(adbBinary.absolutePath) + args
        return processRunner.execute(fullCommand, timeoutMs)
    }

    companion object {
        fun parseDevicesOutput(output: String): List<AdbDeviceDescriptor> {
            val list = mutableListOf<AdbDeviceDescriptor>()
            val lines = output.lines()
            for (line in lines) {
                val trimmed = line.trim()
                if (trimmed.isEmpty() || trimmed.startsWith("List of devices") || trimmed.startsWith("*")) {
                    continue
                }
                val parts = trimmed.split("\\s+".toRegex())
                if (parts.size >= 2) {
                    val serial = parts[0]
                    val state = parts[1]
                    var product: String? = null
                    var model: String? = null
                    var device: String? = null
                    var transportId: String? = null

                    for (i in 2 until parts.size) {
                        val token = parts[i]
                        when {
                            token.startsWith("product:") -> product = token.substringAfter("product:")
                            token.startsWith("model:") -> model = token.substringAfter("model:")
                            token.startsWith("device:") -> device = token.substringAfter("device:")
                            token.startsWith("transport_id:") -> transportId = token.substringAfter("transport_id:")
                        }
                    }

                    list.add(
                        AdbDeviceDescriptor(
                            serial = serial,
                            state = state,
                            product = product,
                            model = model,
                            device = device,
                            transportId = transportId,
                        ),
                    )
                }
            }
            return list
        }
    }
}
