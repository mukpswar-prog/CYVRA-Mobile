package cyvra.mobile.host.evidence

import cyvra.mobile.core.ApplicationEnabledState
import cyvra.mobile.core.ApplicationEnumerationCompleteness
import cyvra.mobile.core.ApplicationInventoryEvidence
import cyvra.mobile.core.ApplicationInventoryRecord
import cyvra.mobile.core.deriveClassification
import cyvra.mobile.core.deriveClassificationStatus
import cyvra.mobile.host.transport.AdbClient

/**
 * S2 authorized-ADB application inventory provider (enrichment only).
 *
 * Contract:
 * - Metadata-only: package inventory metadata is collected; application content,
 *   messages, photos, contacts, accounts, databases, credentials, tokens,
 *   notification content, clipboard, and usage history are never accessed.
 * - Classification derives exclusively from raw platform system flags via
 *   [deriveClassification] / [deriveClassificationStatus]. Package-name prefixes,
 *   OEM names, APK paths, and installer names are never used to classify.
 * - All commands stay inside `HostSecurityAuditEngine.ALLOWED_ADB_PREFIXES`
 *   (`getprop`, `pm list packages`, `dumpsys package`); package tokens are
 *   validated against a strict pattern before interpolation so device-controlled
 *   output cannot inject shell syntax.
 * - Honesty: failed commands and missing fields become UNKNOWN / UNAVAILABLE,
 *   never false.
 * - Completeness: COMPLETE only when the enumeration parsed fully and non-empty;
 *   FILTERED when known-truncated; UNAVAILABLE when the enumeration cannot be trusted.
 * - ADB remains enrichment only: this provider is standalone (not wired into the
 *   connection state machine or the diagnostic workflow).
 */
class AdbApplicationInventoryProvider(
    private val adbClient: AdbClient,
    private val serial: String,
    private val collectedAt: String = java.time.Instant.now().toString(),
) {

    private data class ParsedEnumeration(
        val packages: List<EnumeratedPackage>,
        val skippedLines: Int,
    )

    private data class EnumeratedPackage(val packageName: String, val uid: Long?)

    private data class RawSystemFlags(val system: Boolean, val updatedSystem: Boolean)

    private data class FilterResult(val names: Set<String>, val trusted: Boolean)

    /**
     * Collects the installed-application inventory for the connected device.
     * Never throws: every failure mode maps to an honest completeness/limitation value.
     */
    fun collect(): ApplicationInventoryEvidence {
        val limitations = mutableListOf(
            SCOPE_LIMITATION,
            LABEL_LIMITATION,
        )

        val apiLevel = adbClient.runShell(serial, CMD_API_LEVEL)
            .takeIf { it.isSuccess }
            ?.stdout?.trim()?.toIntOrNull()
        if (apiLevel == null) {
            limitations += "Device API level could not be established."
        }

        // 1. Primary enumeration (package name + UID).
        val enumeration = adbClient.runShell(serial, CMD_LIST_ALL)
        if (!enumeration.isSuccess) {
            val detail = enumeration.stderr.trim().take(200).ifBlank { "exit ${enumeration.exitCode}" }
            limitations += "ADB package enumeration failed; inventory recorded as UNAVAILABLE ($detail)"
            return unavailableEvidence(apiLevel, limitations)
        }

        val parsed = parsePackageLines(enumeration.stdout)
        if (parsed.packages.isEmpty()) {
            limitations += "Package enumeration returned no parsable records; inventory recorded as UNAVAILABLE."
            return unavailableEvidence(apiLevel, limitations)
        }

        // 2. Enabled/disabled filter sets (positive-evidence only).
        val disabledFilter = queryFilter(CMD_LIST_DISABLED)
        val enabledFilter = queryFilter(CMD_LIST_ENABLED)
        if (disabledFilter == null || enabledFilter == null) {
            limitations += FILTER_STATE_LIMITATION
        }

        // 3. Per-package metadata via dumpsys (flags + version).
        var flagsUnavailable = 0
        val applications = parsed.packages.map { pkg ->
            val dumpsys = adbClient.runShell(serial, dumpsysCommandFor(pkg.packageName))
            val block = if (dumpsys.isSuccess) packageBlock(dumpsys.stdout, pkg.packageName) else null
            val flags = block?.let { parseSystemFlags(it) }
            if (flags == null) flagsUnavailable++

            val systemFlag = flags?.system
            val updatedSystemFlag = flags?.updatedSystem
            ApplicationInventoryRecord(
                packageName = pkg.packageName,
                classification = deriveClassification(systemFlag, updatedSystemFlag),
                classificationStatus = deriveClassificationStatus(systemFlag, updatedSystemFlag),
                evidenceSource = EVIDENCE_SOURCE,
                collectionMethod = RECORD_COLLECTION_METHOD,
                collectedAt = collectedAt,
                label = null,
                versionName = block?.let { parseVersionName(it) },
                versionCode = block?.let { parseVersionCode(it) },
                systemFlag = systemFlag,
                updatedSystemFlag = updatedSystemFlag,
                enabledState = enabledStateFor(pkg.packageName, disabledFilter, enabledFilter),
                apiLevel = apiLevel,
                uid = pkg.uid,
            )
        }
        if (flagsUnavailable > 0) {
            limitations += "System/updated flags unavailable for $flagsUnavailable package(s); " +
                "affected records report UNKNOWN classification."
        }

        // 4. Completeness of the enumeration itself.
        val completeness = if (parsed.skippedLines > 0) {
            limitations += "${parsed.skippedLines} enumeration line(s) malformed or unsafe and skipped; " +
                "inventory recorded as FILTERED."
            ApplicationEnumerationCompleteness.FILTERED
        } else {
            ApplicationEnumerationCompleteness.COMPLETE
        }

        return ApplicationInventoryEvidence(
            collectedAt = collectedAt,
            evidenceSource = EVIDENCE_SOURCE,
            collectionMethod = ENUMERATION_COLLECTION_METHOD,
            enumerationCompleteness = completeness,
            apiLevel = apiLevel,
            applications = applications,
            limitations = limitations,
        )
    }

    private fun unavailableEvidence(apiLevel: Int?, limitations: List<String>) =
        ApplicationInventoryEvidence(
            collectedAt = collectedAt,
            evidenceSource = EVIDENCE_SOURCE,
            collectionMethod = ENUMERATION_COLLECTION_METHOD,
            enumerationCompleteness = ApplicationEnumerationCompleteness.UNAVAILABLE,
            apiLevel = apiLevel,
            applications = emptyList(),
            limitations = limitations,
        )

    /** Returns null when the filter command failed; [FilterResult.trusted] is false when its output was partially unparsable. */
    private fun queryFilter(command: String): FilterResult? {
        val result = adbClient.runShell(serial, command)
        if (!result.isSuccess) return null
        val parsed = parsePackageLines(result.stdout)
        return FilterResult(
            names = parsed.packages.map { it.packageName }.toSet(),
            trusted = parsed.skippedLines == 0,
        )
    }

    /**
     * Enabled state, independent from classification. Positive membership is honored
     * even from an untrusted filter set; negative claims ("neither") require both
     * filter commands to have succeeded with fully parsable output. Contradictory
     * membership (in both sets) yields UNKNOWN.
     */
    private fun enabledStateFor(
        packageName: String,
        disabled: FilterResult?,
        enabled: FilterResult?,
    ): ApplicationEnabledState {
        val inDisabled = disabled?.names?.contains(packageName) == true
        val inEnabled = enabled?.names?.contains(packageName) == true
        val negativeClaimTrusted = disabled?.trusted == true && enabled?.trusted == true
        return when {
            inDisabled && inEnabled -> ApplicationEnabledState.UNKNOWN
            inDisabled -> ApplicationEnabledState.DISABLED
            inEnabled -> ApplicationEnabledState.ENABLED
            negativeClaimTrusted -> ApplicationEnabledState.DEFAULT
            else -> ApplicationEnabledState.UNKNOWN
        }
    }

    /**
     * Parses `package:<name> [uid:<n>]` lines. Duplicates are de-duplicated (first
     * occurrence wins, not counted as malformed). Lines that are not valid package
     * records (including injection attempts) are counted as skipped, which marks the
     * containing enumeration as FILTERED / the containing filter set as untrusted.
     */
    private fun parsePackageLines(stdout: String): ParsedEnumeration {
        val byName = LinkedHashMap<String, Long?>()
        var skipped = 0
        for (raw in stdout.lines()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (!line.startsWith(PACKAGE_PREFIX)) {
                skipped++
                continue
            }
            val body = line.removePrefix(PACKAGE_PREFIX).trim()
            val name = body.split(WHITESPACE).firstOrNull().orEmpty()
            if (name.isEmpty() || !PACKAGE_PATTERN.matches(name)) {
                skipped++
                continue
            }
            if (byName.containsKey(name)) continue
            val uid = UID_PATTERN.find(body)?.groupValues?.get(1)?.toLongOrNull()
            byName[name] = uid
        }
        return ParsedEnumeration(
            packages = byName.map { EnumeratedPackage(it.key, it.value) },
            skippedLines = skipped,
        )
    }

    /**
     * Extracts the `Package [<name>]` block for the requested package so shared-user
     * dumps cannot attribute another package's flags to this record.
     * Returns null when the header is missing (format not recognized).
     */
    private fun packageBlock(stdout: String, packageName: String): String? {
        val headers = PACKAGE_HEADER.findAll(stdout).toList()
        val index = headers.indexOfFirst { it.groupValues[1] == packageName }
        if (index < 0) return null
        val startIdx = headers[index].range.first
        val endIdx = if (index + 1 < headers.size) headers[index + 1].range.first else stdout.length
        return stdout.substring(startIdx, endIdx)
    }

    /**
     * Reads raw system flags from a recognized flags line (`flags=[ ... ]` on modern
     * Android, `pkgFlags=[ ... ]` on legacy output). Token presence establishes true;
     * a present-but-complete flags line without the token establishes false; a missing
     * flags line yields nulls (evidence unavailable — never silently false).
     */
    private fun parseSystemFlags(block: String): RawSystemFlags? {
        val match = FLAGS_LINE.find(block) ?: PKG_FLAGS_LINE.find(block) ?: return null
        val tokens = match.groupValues[1]
            .trim()
            .split(TOKEN_SEPARATOR)
            .filter { it.isNotEmpty() }
            .toSet()
        return RawSystemFlags(
            system = SYSTEM_TOKEN in tokens,
            updatedSystem = UPDATED_SYSTEM_TOKEN in tokens,
        )
    }

    private fun parseVersionCode(block: String): Long? =
        VERSION_CODE_LINE.find(block)?.groupValues?.get(1)?.toLongOrNull()
            ?: VERSION_CODE_ANYWHERE.find(block)?.groupValues?.get(1)?.toLongOrNull()

    private fun parseVersionName(block: String): String? =
        VERSION_NAME_LINE.find(block)?.groupValues?.get(1)?.trim()
            ?.takeIf { it.isNotEmpty() && it != NULL_LITERAL }

    companion object {
        const val CMD_API_LEVEL = "getprop ro.build.version.sdk"
        const val CMD_LIST_ALL = "pm list packages -U"
        const val CMD_LIST_DISABLED = "pm list packages -d"
        const val CMD_LIST_ENABLED = "pm list packages -e"

        const val EVIDENCE_SOURCE = "ANDROID_ADB"
        const val ENUMERATION_COLLECTION_METHOD = "ADB_PM_LIST_PACKAGES"
        const val RECORD_COLLECTION_METHOD = "ADB_PM_LIST_PACKAGES_DUMPSYS_PACKAGE"

        internal const val SCOPE_LIMITATION =
            "Package enumeration uses the ADB shell default user scope; " +
                "additional users and work profiles are not enumerated."
        internal const val LABEL_LIMITATION =
            "Application labels are not available over ADB; " +
                "deferred to device-side (S1) collection."
        internal const val FILTER_STATE_LIMITATION =
            "Disabled/enabled filter query failed; enabled state defaults to " +
                "UNKNOWN unless positively established."

        internal fun isValidPackageName(name: String): Boolean = PACKAGE_PATTERN.matches(name)

        internal fun dumpsysCommandFor(packageName: String): String = "dumpsys package $packageName"

        private const val PACKAGE_PREFIX = "package:"
        private const val SYSTEM_TOKEN = "SYSTEM"
        private const val UPDATED_SYSTEM_TOKEN = "UPDATED_SYSTEM_APP"
        private const val NULL_LITERAL = "null"

        private val PACKAGE_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._]*")
        private val WHITESPACE = Regex("\\s+")
        private val UID_PATTERN = Regex("""\buid:(\d+)""")
        private val TOKEN_SEPARATOR = Regex("\\s+")

        private val PACKAGE_HEADER = Regex("""(?m)^[ \t]*Package \[([^]]+)]""")
        private val FLAGS_LINE = Regex("""(?m)^[ \t]*flags=\[([^\]]*)]""")
        private val PKG_FLAGS_LINE = Regex("""(?m)^[ \t]*pkgFlags=\[([^\]]*)]""")
        private val VERSION_CODE_LINE = Regex("""(?m)^[ \t]*versionCode=(\d+)""")
        private val VERSION_CODE_ANYWHERE = Regex("""(?<![A-Za-z])versionCode=(\d+)""")
        private val VERSION_NAME_LINE = Regex("""(?m)^[ \t]*versionName=(.*)$""")
    }
}
