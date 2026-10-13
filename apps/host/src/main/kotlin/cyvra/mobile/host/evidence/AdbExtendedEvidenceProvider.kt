package cyvra.mobile.host.evidence

import cyvra.mobile.core.DeviceParameter
import cyvra.mobile.core.EvidenceFieldResult
import cyvra.mobile.core.EvidenceStatus
import cyvra.mobile.host.transport.AdbClient

/**
 * Extended agent-less collector.
 *
 * Closes the gap between what the ADB plane can actually return and what the original
 * identity/battery/storage/security bundle reaches. Every parameter is keyed to its
 * ratified workbook identifier so coverage is computable rather than asserted.
 *
 * One rule governs every row below
 * --------------------------------
 * A command that fails reports ERROR. A command that succeeds but yields nothing
 * interpretable reports NOT_AVAILABLE and says why. No value is ever substituted,
 * defaulted, or inferred from the absence of a signal. This is what separates an
 * evidence product from a dashboard that guesses.
 *
 * The rows marked "requires stimulus" or "requires vision" are deliberately NOT
 * collected here. They cannot be measured from a shell, and claiming otherwise is
 * exactly the defect Stage 0 was raised to remove.
 */
class AdbExtendedEvidenceProvider(
    private val adbClient: AdbClient,
    private val serial: String,
) {

    fun collect(): List<DeviceParameter> = buildList {
        addAll(hardware())
        addAll(storage())
        addAll(display())
        addAll(camera())
        addAll(audio())
        addAll(sensors())
        addAll(haptics())
        addAll(wifi())
        addAll(bluetooth())
        addAll(cellular())
        addAll(gnss())
        addAll(performance())
        addAll(system())
        addAll(extraIdentity())
        addAll(extraSecurity())
        addAll(extraApplications())
    }

    // ------------------------------------------------------------------ primitives

    /**
     * Runs [command] and produces a parameter. This is the only path to a value in this
     * class, which is what makes the honesty rule enforceable rather than aspirational.
     */
    private fun param(
        id: String,
        domain: String,
        label: String,
        command: String,
        parse: (String) -> String?,
        unavailableReason: String,
    ): DeviceParameter {
        val result = adbClient.runShell(serial, command)
        // The explicit type is required, not cosmetic: the null branches infer
        // EvidenceFieldResult<Nothing>, and because T is invariant the compiler captures
        // the common supertype instead of unifying to EvidenceFieldResult<String>.
        val evidence: EvidenceFieldResult<String> = if (!result.isSuccess) {
            EvidenceFieldResult(
                value = null,
                status = EvidenceStatus.ERROR,
                source = "ADB",
                reason = "$command failed: " + (result.stderr.ifBlank { "exit ${result.exitCode}, no diagnostic output" }),
            )
        } else {
            val parsed = parse(result.stdout)
            if (parsed == null) {
                EvidenceFieldResult(
                    value = null,
                    status = EvidenceStatus.NOT_AVAILABLE,
                    source = "ADB",
                    reason = unavailableReason,
                )
            } else {
                EvidenceFieldResult(parsed, EvidenceStatus.AVAILABLE, "ADB", "measured by: $command")
            }
        }
        return DeviceParameter(id = id, domain = domain, label = label, result = evidence)
    }

    /** A parameter that this transport structurally cannot measure, said plainly. */
    private fun notMeasurableByShell(
        id: String,
        domain: String,
        label: String,
        reason: String,
    ): DeviceParameter = DeviceParameter(
        id = id,
        domain = domain,
        label = label,
        result = EvidenceFieldResult(
            value = null,
            status = EvidenceStatus.NOT_AVAILABLE,
            source = "ADB",
            reason = reason,
        ),
    )

    private fun getPropParam(id: String, domain: String, label: String, key: String): DeviceParameter =
        param(id, domain, label, "getprop $key", { it.trim().ifEmpty { null } }, "property $key is not published on this device")

    private fun firstLine(stdout: String): String? =
        stdout.lines().map { it.trim() }.firstOrNull { it.isNotEmpty() }

    private fun propValue(stdout: String): String? {
        val raw = stdout.trim()
        if (raw.isEmpty() || raw == "null") return null
        return raw
    }

    // ------------------------------------------------------------------ hardware

    private fun hardware() = listOf(
        getPropParam("HW-001", "HARDWARE", "CPU model / architecture", "ro.board.platform"),
        param("HW-002", "HARDWARE", "CPU core count", "cat /proc/cpuinfo",
            { out -> out.lines().count { it.trim().startsWith("processor") }.takeIf { it > 0 }?.toString() },
            "/proc/cpuinfo published no processor entries"),
        param("HW-003", "HARDWARE", "CPU frequency observation", "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
            { firstLine(it)?.trim()?.toIntOrNull()?.toString() },
            "cpu0 scaling_cur_freq is not readable from the shell (commonly root-only)"),
        param("HW-004", "HARDWARE", "Installed/visible RAM", "cat /proc/meminfo",
            { out -> out.lines().firstOrNull { it.trim().startsWith("MemTotal:") }?.substringAfter(":")?.trim()?.split("\\s+".toRegex())?.firstOrNull() },
            "/proc/meminfo published no MemTotal line"),
        notMeasurableByShell("HW-005", "HARDWARE", "RAM spot/stress test",
            "requires a controlled memory-stimulus harness on the workstation; it is not a passive shell reading"),
    )

    // ------------------------------------------------------------------ storage

    private fun storage() = listOf(
        notMeasurableByShell("STO-003", "STORAGE", "Storage read/write responsiveness",
            "requires a controlled read/write stimulus; a passive shell call cannot establish throughput"),
        notMeasurableByShell("STO-004", "STORAGE", "NAND health/wear",
            "NAND wear counters are privileged manufacturer diagnostics and are not exposed through ADB"),
    )

    // ------------------------------------------------------------------ display

    private fun display() = listOf(
        param("DIS-001", "DISPLAY", "Display presence/logical display", "dumpsys display",
            { out -> Regex("""mDisplayId=\d+""").find(out)?.value?.substringAfter('=') },
            "dumpsys display published no logical display identifier"),
        param("DIS-002", "DISPLAY", "Resolution", "wm size",
            { out -> Regex("""\d+\s*x\s*\d+""").find(out)?.value?.replace("\\s".toRegex(), "") },
            "wm size published no resolution"),
        param("DIS-003", "DISPLAY", "Refresh rate", "dumpsys display",
            { out -> out.lines().firstOrNull { it.contains("fps", ignoreCase = true) }
                ?.substringAfterLast(':')?.trim()?.split("\\s+".toRegex())?.firstOrNull() },
            "dumpsys display published no refresh-rate figure"),
        notMeasurableByShell("DIS-010", "DISPLAY", "Panel uniformity",
            "requires controlled display patterns and optical capture; no shell reading establishes uniformity"),
    )

    // ------------------------------------------------------------------ camera

    private fun camera() = listOf(
        param("CAM-001", "CAMERA", "Camera enumeration", "dumpsys media.camera",
            { out ->
                val headings = out.lines().filter {
                    it.contains("Number of", ignoreCase = true) &&
                        it.contains("camera device", ignoreCase = true)
                }
                // Prefer the total-device heading; fall back to whichever variant this
                // OEM publishes rather than declining when only one of them is present.
                val heading = headings.firstOrNull {
                    it.trim().startsWith("Number of camera devices", ignoreCase = true)
                } ?: headings.firstOrNull()
                heading?.substringAfter(':', "")?.trim()?.ifEmpty { null }
            },
            "dumpsys media.camera published no camera-device count"),
        notMeasurableByShell("CAM-002", "CAMERA", "Camera initialization",
            "initialisation requires an application to open the camera HAL; not observable passively"),
        notMeasurableByShell("CAM-003", "CAMERA", "Live preview/frame delivery",
            "frame delivery requires an application to open the camera HAL; not observable passively"),
    )

    // ------------------------------------------------------------------ audio

    private fun audio() = listOf(
        param("AUD-001", "AUDIO", "Speaker playback path", "ls /proc/asound",
            { out -> if (out.isNotBlank()) "sound card interface present" else null },
            "/proc/asound is absent; no ALSA interface exposed"),
        param("AUD-003", "AUDIO", "Microphone input path", "ls /proc/asound",
            { out -> if (out.isNotBlank()) "sound card interface present" else null },
            "/proc/asound is absent; no ALSA interface exposed"),
    )

    // ------------------------------------------------------------------ sensors

    private fun sensors() = listOf(
        sensorParam("SEN-001", "Accelerometer"),
        sensorParam("SEN-002", "Gyroscope"),
        sensorParam("SEN-003", "Magnetometer"),
        sensorParam("SEN-004", "Proximity"),
        sensorParam("SEN-005", "Light"),
        sensorParam("SEN-006", "Barometer"),
    )

    private fun sensorParam(id: String, name: String): DeviceParameter =
        param(id, "SENSORS", "$name sensor", "dumpsys sensorservice",
            { out ->
                out.lines().firstOrNull { it.contains(name, ignoreCase = true) }
                    ?.trim()?.ifEmpty { null }
            },
            "sensorservice did not list a $name sensor")

    // ------------------------------------------------------------------ haptics

    private fun haptics() = listOf(
        // Re-sourced from `pm list features`: that list declares 103 features on the
        // bench device and none of them is a vibrator feature, while `service list`
        // does publish the binder. Presence of the service is what this reports.
        param("HAP-001", "HAPTICS", "Vibration command/response", "service list",
            { out ->
                val registered = out.lines().any { line ->
                    // `service list` prefixes every entry with its binder index, so the
                    // service name only reaches the start of the line once that is gone.
                    val name = line.trim().replaceFirst(Regex("""^\d+\s+"""), "")
                    name.startsWith("vibrator:")
                }
                if (registered) {
                    "vibrator service registered"
                } else {
                    null
                }
            },
            "service list registered no vibrator service"),
    )

    // ------------------------------------------------------------------ radios

    private fun wifi() = listOf(
        param("WIFI-001", "WI-FI", "Wi-Fi capability/state", "dumpsys wifi",
            { out -> out.lines().firstOrNull { it.trim().startsWith("Wi-Fi is") }
                ?.removePrefix("Wi-Fi is")?.trim()?.ifEmpty { null } },
            "dumpsys wifi published no Wi-Fi state line"),
        param("WIFI-002", "WI-FI", "Wi-Fi scan/discovery", "dumpsys wifi",
            { out ->
                val block = out.substringAfter("Scan results", "")
                block.lines().count { Regex("""([0-9a-f]{2}:){5}[0-9a-f]{2}""", RegexOption.IGNORE_CASE).containsMatchIn(it) }
                    .takeIf { it > 0 }?.toString()
            },
            "no scan-result block with addressable access points was published"),
        notMeasurableByShell("WIFI-003", "WI-FI", "Connection to controlled AP",
            "requires a controlled access point on the bench; not a passive reading"),
        notMeasurableByShell("WIFI-004", "WI-FI", "Signal/link quality",
            "link quality requires an associated session with a controlled AP; not a passive reading"),
    )

    private fun bluetooth() = listOf(
        param("BT-001", "BLUETOOTH", "Bluetooth capability/state", "settings get global bluetooth_on",
            { out -> when (out.trim()) { "1" -> "enabled"; "0" -> "disabled"; else -> null } },
            "bluetooth_on setting did not return a boolean"),
        notMeasurableByShell("BT-002", "BLUETOOTH", "Discovery scan",
            "requires the operator to authorise a discovery window; not a passive reading"),
        notMeasurableByShell("BT-003", "BLUETOOTH", "Pair/connect to known-good fixture",
            "requires a controlled fixture and operator-supplied pairing consent"),
    )

    private fun cellular() = listOf(
        getPropParam("CELL-001", "CELLULAR", "Modem/radio capability", "ro.telephony.default_network"),
        param("CELL-002", "CELLULAR", "SIM detected", "getprop gsm.sim.state",
            { out -> propValue(out)?.let { if (it.startsWith("ABSENT")) "absent" else "present ($it)" } },
            "gsm.sim.state did not report a SIM state"),
        param("CELL-003", "CELLULAR", "Network registration", "dumpsys telephony.registry",
            { out -> out.lines().firstOrNull { it.contains("mServiceState", ignoreCase = true) }
                ?.substringAfter(':')?.trim()?.ifEmpty { null } },
            "telephony registry published no service state"),
        param("CELL-004", "CELLULAR", "Mobile data path", "settings get global mobile_data",
            { out -> when (out.trim()) { "1" -> "enabled"; "0" -> "disabled"; else -> null } },
            "mobile_data setting did not return a boolean"),
        notMeasurableByShell("CELL-005", "CELLULAR", "RF/antenna performance",
            "requires a specialist RF fixture; antenna performance is never inferable from software"),
    )

    private fun gnss() = listOf(
        param("GNSS-001", "GNSS", "GNSS capability", "pm list features",
            { out -> if (out.contains("android.hardware.location.gps")) "gps location feature declared" else null },
            "package manager did not declare a GPS location feature"),
        notMeasurableByShell("GNSS-002", "GNSS", "GNSS fix acquisition",
            "requires sky view and a dwell period under controlled conditions; not a passive reading"),
    )

    // ------------------------------------------------------------------ performance

    private fun performance() = listOf(
        notMeasurableByShell("PERF-001", "PERFORMANCE", "CPU workload response",
            "requires a controlled workload stimulus applied by the workstation"),
        param("PERF-002", "PERFORMANCE", "Memory pressure behavior", "cat /proc/meminfo",
            { out ->
                val total = out.lineSequence().firstOrNull { it.startsWith("MemTotal:") }
                    ?.substringAfter(":")?.trim()?.split("\\s+".toRegex())?.firstOrNull()?.toLongOrNull()
                val avail = out.lineSequence().firstOrNull { it.startsWith("MemAvailable:") }
                    ?.substringAfter(":")?.trim()?.split("\\s+".toRegex())?.firstOrNull()?.toLongOrNull()
                if (total != null && avail != null && total > 0) {
                    "${100 - (avail * 100 / total)}% in use"
                } else null
            },
            "/proc/meminfo did not publish both MemTotal and MemAvailable"),
        notMeasurableByShell("PERF-003", "PERFORMANCE", "Storage I/O responsiveness",
            "requires a controlled read/write stimulus applied by the workstation"),
        param("PERF-004", "PERFORMANCE", "Boot/reboot completion", "getprop sys.boot_completed",
            { out -> if (out.trim() == "1") "completed" else null },
            "sys.boot_completed did not report completion"),
    )

    // ------------------------------------------------------------------ system

    private fun system() = listOf(
        param("SYS-001", "SYSTEM", "Date/time/timezone", "date -u",
            { out -> firstLine(out)?.let { line ->
                val tz = adbClient.runShell(serial, "getprop persist.sys.timezone").stdout.trim()
                if (tz.isNotEmpty()) "$line UTC (device zone: $tz)" else "$line UTC"
            } },
            "date did not publish a timestamp"),
        getPropParam("SYS-002", "SYSTEM", "Locale/language", "persist.sys.locale"),
        param("SYS-003", "SYSTEM", "Screen-on/power/display state", "dumpsys power",
            { out ->
                val lines = out.lines()
                // `mWakefulness=` is the AOSP spelling; this build publishes the state
                // under `Display Power: state=` instead, so accept either.
                val line = lines.firstOrNull { it.trim().startsWith("mWakefulness=") }
                    ?: lines.firstOrNull { it.trim().startsWith("Display Power:") }
                line?.substringAfter('=', "")?.trim()?.ifEmpty { null }
            },
            "dumpsys power published neither a wakefulness nor a display-power state"),
    )

    // ------------------------------------------------------------------ identity / security / applications

    private fun extraIdentity(): List<DeviceParameter> = emptyList()

    private fun extraSecurity() = listOf(
        param("SEC-003", "SECURITY", "Encryption status where exposed", "getprop ro.crypto.state",
            { out -> propValue(out) },
            "ro.crypto.state is not published on this device"),
    )

    /**
     * APP-002. Version inventory is gathered with an explicit bound. The bound is part of
     * the reported reason so a partial inventory is never mistaken for a complete one -
     * a sampled list presented as a full list is a completeness claim the data cannot
     * support.
     */
    private fun extraApplications(): List<DeviceParameter> {
        val packages = adbClient.runShell(serial, "pm list packages")
        if (!packages.isSuccess) {
            return listOf(notMeasuredAppVersion("package enumeration failed: " +
                (packages.stderr.ifBlank { "exit ${packages.exitCode}" })))
        }
        val names = packages.stdout.lines()
            .map { it.removePrefix("package:").trim() }
            .filter { it.isNotEmpty() }
        if (names.isEmpty()) {
            return listOf(notMeasuredAppVersion("package manager enumerated no packages"))
        }
        val bound = 25
        val sample = names.take(bound)
        val versions = sample.mapNotNull { pkg ->
            val dump = adbClient.runShell(serial, "dumpsys package $pkg")
            if (!dump.isSuccess) return@mapNotNull null
            Regex("""versionName=(\S+)""").find(dump.stdout)?.groupValues?.get(1)
        }.distinct().size
        return listOf(
            DeviceParameter(
                id = "APP-002",
                domain = "APPLICATIONS",
                label = "App version inventory",
                result = EvidenceFieldResult(
                    value = "$versions distinct versions across a bounded sample of ${sample.size} of ${names.size} packages",
                    status = EvidenceStatus.AVAILABLE,
                    source = "ADB",
                    reason = "deliberately bounded to $bound packages to keep the scan responsive; " +
                        "this is a SAMPLE, not a complete version inventory",
                ),
            )
        )
    }

    private fun notMeasuredAppVersion(reason: String): DeviceParameter = DeviceParameter(
        id = "APP-002",
        domain = "APPLICATIONS",
        label = "App version inventory",
        result = EvidenceFieldResult(value = null, status = EvidenceStatus.NOT_AVAILABLE, source = "ADB", reason = reason),
    )
}
