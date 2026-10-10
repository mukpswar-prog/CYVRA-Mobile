package cyvra.mobile.host.transport

import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Regression coverage for the pipe-deadlock defect.
 *
 * SystemProcessRunner used to call waitFor() before consuming the child's
 * stdout/stderr. Windows anonymous pipes hold 4096 bytes, so any child writing
 * more than that (adb `pm list packages -U` emits ~18 KB on a typical phone)
 * blocked on write, never exited, and the call hit the 10000 ms timeout even
 * though the command itself completes in a few hundred milliseconds.
 *
 * These tests exercise the real OS process, not a mock, because a mock cannot
 * reproduce a pipe-buffer deadlock.
 */
class SystemProcessRunnerTest {

    private val isWindows = System.getProperty("os.name")
        .startsWith("Windows", ignoreCase = true)

    @Test
    fun outputLargerThanThePipeBufferIsFullyCaptured() {
        // 41 characters x 2000 lines ~= 82 KB, roughly 20x the 4096 byte
        // Windows anonymous pipe buffer.
        val line = "0123456789012345678901234567890123456789"
        val command = if (isWindows) {
            listOf(
                "cmd.exe", "/c",
                "for /L %i in (1,1,2000) do @echo $line",
            )
        } else {
            val script = buildString {
                append("i=0; while [ \$i -lt 2000 ]; do echo $line; i=\$((i+1)); done")
            }
            listOf("/bin/sh", "-c", script)
        }

        val started = System.nanoTime()
        val result = SystemProcessRunner().execute(command, timeoutMs = 30_000L)
        val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)

        assertTrue(
            result.isSuccess,
            "child should exit 0, got exitCode=${result.exitCode} stderr=${result.stderr}",
        )
        assertTrue(
            result.stdout.length > 4_096,
            "expected more than one pipe buffer of output, got ${result.stdout.length} bytes",
        )
        assertTrue(
            result.stdout.lines().size >= 2_000,
            "expected all 2000 lines, got ${result.stdout.lines().size}",
        )
        assertTrue(
            elapsedMs < 25_000,
            "large output must not stall; took ${elapsedMs}ms",
        )
    }

    @Test
    fun timeoutStillReportsTheReasonAndDoesNotHangForever() {
        val command = if (isWindows) {
            listOf("powershell.exe", "-NoProfile", "-Command", "Start-Sleep -Seconds 30")
        } else {
            listOf("/bin/sh", "-c", "sleep 30")
        }

        val started = System.nanoTime()
        val result = SystemProcessRunner().execute(command, timeoutMs = 1_500L)
        val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)

        assertEquals(-1, result.exitCode)
        assertTrue(
            result.stderr.contains("Process timed out after 1500ms"),
            "timeout reason must be reported verbatim, got: ${result.stderr}",
        )
        assertTrue(
            elapsedMs < 10_000,
            "timeout path must return promptly after the deadline; took ${elapsedMs}ms",
        )
    }

    @Test
    fun stdoutAndStderrAreKeptSeparate() {
        val command = if (isWindows) {
            listOf("cmd.exe", "/c", "echo FROM_STDOUT & echo FROM_STDERR 1>&2")
        } else {
            listOf("/bin/sh", "-c", "echo FROM_STDOUT; echo FROM_STDERR 1>&2")
        }

        val result = SystemProcessRunner().execute(command, timeoutMs = 15_000L)

        assertTrue(result.isSuccess, "expected success, got exitCode=${result.exitCode}")
        assertTrue(
            result.stdout.contains("FROM_STDOUT") && !result.stdout.contains("FROM_STDERR"),
            "stdout stream must not be mixed with stderr, got: ${result.stdout}",
        )
        assertTrue(
            result.stderr.contains("FROM_STDERR"),
            "stderr stream must be captured separately, got: ${result.stderr}",
        )
    }
}
