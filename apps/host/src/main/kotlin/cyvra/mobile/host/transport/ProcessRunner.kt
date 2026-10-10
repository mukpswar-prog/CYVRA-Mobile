package cyvra.mobile.host.transport

import java.util.concurrent.TimeUnit

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

        // Drain BOTH streams on background threads BEFORE waiting for the child.
        //
        // Windows anonymous pipes hold only 4096 bytes. A child that writes more
        // than that (adb `pm list packages -U` emits ~18 KB on a typical phone)
        // blocks on write and never exits, so a waitFor()-then-read sequence
        // times out on a command that actually completes in milliseconds.
        // Raising the timeout cannot help: the child stays blocked forever,
        // because nobody is reading.
        val stdoutBuffer = StringBuilder()
        val stderrBuffer = StringBuilder()
        val stdoutThread = drainAsync(process.inputStream, stdoutBuffer, "proc-stdout")
        val stderrThread = drainAsync(process.errorStream, stderrBuffer, "proc-stderr")

        val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            joinQuietly(stdoutThread)
            joinQuietly(stderrThread)
            return DefaultProcessExecutionResult(
                exitCode = -1,
                stdout = readBuffer(stdoutBuffer),
                stderr = "Process timed out after ${timeoutMs}ms",
            )
        }

        joinQuietly(stdoutThread)
        joinQuietly(stderrThread)
        return DefaultProcessExecutionResult(
            exitCode = process.exitValue(),
            stdout = readBuffer(stdoutBuffer),
            stderr = readBuffer(stderrBuffer),
        )
    }

    private fun drainAsync(
        stream: java.io.InputStream,
        buffer: StringBuilder,
        threadName: String,
    ): Thread {
        val thread = Thread({
            try {
                stream.bufferedReader().use { reader ->
                    val chunk = CharArray(CHUNK_SIZE)
                    while (true) {
                        val read = reader.read(chunk)
                        if (read < 0) break
                        synchronized(buffer) { buffer.append(chunk, 0, read) }
                    }
                }
            } catch (_: Exception) {
                // Process was killed or the pipe closed. Whatever was drained
                // into the buffer before that is still the best evidence we have.
            }
        }, threadName)
        thread.isDaemon = true
        thread.start()
        return thread
    }

    private fun joinQuietly(thread: Thread) {
        try {
            thread.join(DRAIN_JOIN_TIMEOUT_MS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun readBuffer(buffer: StringBuilder): String = synchronized(buffer) { buffer.toString() }

    private companion object {
        /** Large enough that a full package listing rarely needs many reads. */
        const val CHUNK_SIZE = 8192

        /**
         * Bounded, so a wedged pipe degrades to partial evidence instead of
         * hanging the caller. The process has already exited (or been killed)
         * by the time we get here, so this is only a safety net.
         */
        const val DRAIN_JOIN_TIMEOUT_MS = 2_000L
    }
}
