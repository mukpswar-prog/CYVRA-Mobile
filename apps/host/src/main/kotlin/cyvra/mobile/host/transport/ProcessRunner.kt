package cyvra.mobile.host.transport

interface ProcessExecutionResult {
    val exitCode: Int
    val stdout: String
    val stderr: String
    val isSuccess: Boolean get() = exitCode == 0
}

data class DefaultProcessExecutionResult(
    override val exitCode: Int,
    override val stdout: String,
    override val stderr: String,
) : ProcessExecutionResult

/**
 * Abstraction for executing CLI commands (e.g. adb).
 * Allows full in-memory mocking without spawning external processes in tests.
 */
fun interface ProcessRunner {
    fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult
}

class SystemProcessRunner : ProcessRunner {
    override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
        val process = ProcessBuilder(command)
            .redirectErrorStream(false)
            .start()

        val stdoutReader = process.inputStream.bufferedReader()
        val stderrReader = process.errorStream.bufferedReader()

        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            return DefaultProcessExecutionResult(
                exitCode = -1,
                stdout = stdoutReader.readText(),
                stderr = "Process timed out after ${timeoutMs}ms",
            )
        }

        return DefaultProcessExecutionResult(
            exitCode = process.exitValue(),
            stdout = stdoutReader.readText(),
            stderr = stderrReader.readText(),
        )
    }
}
