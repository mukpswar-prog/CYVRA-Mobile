package cyvra.mobile.host.evidence

import cyvra.mobile.core.ApplicationClassification
import cyvra.mobile.core.ApplicationEnabledState
import cyvra.mobile.core.ApplicationEnumerationCompleteness
import cyvra.mobile.core.ApplicationClassificationStatus
import cyvra.mobile.host.security.HostSecurityAuditEngine
import cyvra.mobile.host.transport.AdbClient
import cyvra.mobile.host.transport.DefaultProcessExecutionResult
import cyvra.mobile.host.transport.ProcessExecutionResult
import cyvra.mobile.host.transport.ProcessRunner
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun ok(stdout: String) = DefaultProcessExecutionResult(0, stdout, "")

private fun fail(stderr: String) = DefaultProcessExecutionResult(1, "", stderr)

class AdbApplicationInventoryProviderTest {

    private val collectedAt = "2026-09-27T12:00:00Z"

    /**
     * Deterministic fake ADB: records every shell command issued and answers each
     * known command from configured fixtures. Anything unexpected fails loudly.
     */
    private class FakeAdbRunner(
        private val enumeration: ProcessExecutionResult,
        private val apiLevel: ProcessExecutionResult = ok("30\n"),
        private val disabled: ProcessExecutionResult = ok(""),
        private val enabled: ProcessExecutionResult = ok(""),
        private val dumpsys: Map<String, ProcessExecutionResult> = emptyMap(),
        private val defaultDumpsys: ProcessExecutionResult = ok(""),
    ) : ProcessRunner {
        val shellCommands = mutableListOf<String>()

        override fun execute(command: List<String>, timeoutMs: Long): ProcessExecutionResult {
            val joined = command.joinToString(" ")
            val shell = joined.substringAfter(" shell ", missingDelimiterValue = "")
            shellCommands += shell
            return when {
                shell == AdbApplicationInventoryProvider.CMD_API_LEVEL -> apiLevel
                shell == AdbApplicationInventoryProvider.CMD_LIST_ALL -> enumeration
                shell == AdbApplicationInventoryProvider.CMD_LIST_DISABLED -> disabled
                shell == AdbApplicationInventoryProvider.CMD_LIST_ENABLED -> enabled
                shell.startsWith("dumpsys package ") ->
                    dumpsys[shell.removePrefix("dumpsys package ")] ?: defaultDumpsys
                else -> DefaultProcessExecutionResult(99, "", "unexpected command: $shell")
            }
        }
    }

    private fun provider(runner: FakeAdbRunner) = AdbApplicationInventoryProvider(
        adbClient = AdbClient(File("mock-adb"), runner),
        serial = "serial-test",
        collectedAt = collectedAt,
    )

    private fun providerFor(runner: FakeAdbRunner): Pair<AdbApplicationInventoryProvider, FakeAdbRunner> =
        provider(runner) to runner

    /** Modern dumpsys block (Android 10+ `flags=[...]`). Pass flags=null to omit the flags line entirely. */
    private fun modernDumpsys(
        pkg: String,
        flags: String? = "SYSTEM HAS_CODE ALLOW_BACKUP",
        versionCode: Int? = 30,
        versionName: String? = "11",
        codePath: String = "/system/app/Settings",
    ): String = buildString {
        appendLine("Package [$pkg] (deadbeef):")
        appendLine("  userId=1000")
        appendLine("  codePath=$codePath")
        if (versionCode != null) appendLine("  versionCode=$versionCode minSdk=26 targetSdk=34")
        if (versionName != null) appendLine("  versionName=$versionName")
        if (flags != null) {
            appendLine("  flags=[$flags]")
            appendLine("  privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE ]")
        }
        appendLine("  firstInstallTime=2021-08-01T10:00:00")
    }

    /** Legacy dumpsys block (pre-Android 10 `pkgFlags=[...]`, no `flags=` line). */
    private fun legacyDumpsys(pkg: String): String = """
        Package [$pkg] (cafebabe):
          userId=1000
          codePath=/system/app/Legacy
          versionCode=27 minSdk=26 targetSdk=27
          versionName=8.1.0
          pkgFlags=[ SYSTEM HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    """.trimIndent() + "\n"

    // ---------------------------------------------------------------
    // 1. System-only package list
    // ---------------------------------------------------------------
    @Test
    fun systemOnlyPackageListClassifiesAllAsPreinstalled() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:com.android.systemui uid:1000
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
                "com.android.systemui" to ok(modernDumpsys("com.android.systemui")),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        assertEquals(2, evidence.applications.size)
        evidence.applications.forEach { record ->
            assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
            assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
            assertEquals(true, record.systemFlag)
            assertEquals(false, record.updatedSystemFlag)
            assertEquals(AdbApplicationInventoryProvider.EVIDENCE_SOURCE, record.evidenceSource)
            assertEquals(
                AdbApplicationInventoryProvider.RECORD_COLLECTION_METHOD,
                record.collectionMethod,
            )
            assertEquals(collectedAt, record.collectedAt)
            assertEquals(30, record.apiLevel)
        }
        assertEquals(30, evidence.apiLevel)
        assertEquals(collectedAt, evidence.collectedAt)
        assertEquals(AdbApplicationInventoryProvider.EVIDENCE_SOURCE, evidence.evidenceSource)
        assertEquals(
            AdbApplicationInventoryProvider.ENUMERATION_COLLECTION_METHOD,
            evidence.collectionMethod,
        )
        assertEquals(
            listOf(
                AdbApplicationInventoryProvider.SCOPE_LIMITATION,
                AdbApplicationInventoryProvider.LABEL_LIMITATION,
            ),
            evidence.limitations,
        )
    }

    // ---------------------------------------------------------------
    // 2. Mixed system + third-party packages
    // ---------------------------------------------------------------
    @Test
    fun mixedSystemAndThirdPartyPackages() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(
                    modernDumpsys("com.android.settings", flags = "SYSTEM HAS_CODE"),
                ),
                "org.example.userapp" to ok(
                    modernDumpsys(
                        "org.example.userapp",
                        flags = "HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP",
                        codePath = "/data/app/org.example.userapp-xyz",
                    ),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()
        val byName = evidence.applications.associateBy { it.packageName }

        assertEquals(
            ApplicationClassification.PREINSTALLED_SYSTEM,
            byName.getValue("com.android.settings").classification,
        )
        assertEquals(
            ApplicationClassification.USER_THIRD_PARTY,
            byName.getValue("org.example.userapp").classification,
        )
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
    }

    // ---------------------------------------------------------------
    // 3. Updated system application (Task 5)
    // ---------------------------------------------------------------
    @Test
    fun updatedSystemAppClassifiedFromFlagsDespiteDataAppPath() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.vendor.camera uid:10042\n"),
            dumpsys = mapOf(
                "com.vendor.camera" to ok(
                    modernDumpsys(
                        "com.vendor.camera",
                        flags = "SYSTEM HAS_CODE UPDATED_SYSTEM_APP ALLOW_BACKUP",
                        codePath = "/data/app/com.vendor.camera-abc",
                    ),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(ApplicationClassification.UPDATED_SYSTEM, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
        assertEquals(true, record.systemFlag)
        assertEquals(true, record.updatedSystemFlag)
        // Regression guard: never USER_THIRD_PARTY just because codePath is /data/app.
        assertFalse(record.classification == ApplicationClassification.USER_THIRD_PARTY)
    }

    // ---------------------------------------------------------------
    // 4. Disabled system application
    // ---------------------------------------------------------------
    @Test
    fun disabledSystemPackageReportsDisabledIndependentlyOfClassification() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.android.settings uid:1000\n"),
            disabled = ok("package:com.android.settings\n"),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
        assertEquals(ApplicationEnabledState.DISABLED, record.enabledState)
    }

    // ---------------------------------------------------------------
    // 5. Disabled third-party application
    // ---------------------------------------------------------------
    @Test
    fun disabledThirdPartyPackageReportsDisabled() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:org.example.userapp uid:10089\n"),
            disabled = ok("package:org.example.userapp\n"),
            dumpsys = mapOf(
                "org.example.userapp" to ok(
                    modernDumpsys(
                        "org.example.userapp",
                        flags = "HAS_CODE ALLOW_BACKUP",
                        codePath = "/data/app/org.example.userapp-xyz",
                    ),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(ApplicationClassification.USER_THIRD_PARTY, record.classification)
        assertEquals(ApplicationEnabledState.DISABLED, record.enabledState)
    }

    // ---------------------------------------------------------------
    // 6. Malformed package record (no crash, valid records preserved)
    // ---------------------------------------------------------------
    @Test
    fun malformedPackageRecordIsSkippedWithoutCrashing() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                !!!not-a-package-record!!!
                package:com.evil; reboot
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
                "org.example.userapp" to ok(
                    modernDumpsys("org.example.userapp", flags = "HAS_CODE"),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        assertEquals(2, evidence.applications.size)
        assertEquals(
            ApplicationClassification.PREINSTALLED_SYSTEM,
            evidence.applications.first { it.packageName == "com.android.settings" }.classification,
        )
        assertEquals(
            ApplicationClassification.USER_THIRD_PARTY,
            evidence.applications.first { it.packageName == "org.example.userapp" }.classification,
        )
    }

    // ---------------------------------------------------------------
    // 7. Missing system flags -> UNKNOWN + evidence unavailable (never false)
    // ---------------------------------------------------------------
    @Test
    fun missingSystemFlagsYieldsUnknownWithUnavailableStatus() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.android.settings uid:1000\n"),
            dumpsys = mapOf(
                "com.android.settings" to ok(
                    modernDumpsys("com.android.settings", flags = null),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertNull(record.systemFlag)
        assertNull(record.updatedSystemFlag)
        assertEquals(ApplicationClassification.UNKNOWN, record.classification)
        assertEquals(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE, record.classificationStatus)
        assertTrue(
            provider.collect().limitations.any {
                it.contains("System/updated flags unavailable for 1 package(s)")
            },
        )
    }

    // ---------------------------------------------------------------
    // 8. Contradictory classification evidence -> UNKNOWN + ambiguous
    // ---------------------------------------------------------------
    @Test
    fun contradictoryClassificationEvidenceYieldsUnknownAmbiguous() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.broken.app uid:10050\n"),
            dumpsys = mapOf(
                // UPDATED_SYSTEM_APP without SYSTEM is contradictory evidence.
                "com.broken.app" to ok(
                    modernDumpsys("com.broken.app", flags = "UPDATED_SYSTEM_APP HAS_CODE"),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(false, record.systemFlag)
        assertEquals(true, record.updatedSystemFlag)
        assertEquals(ApplicationClassification.UNKNOWN, record.classification)
        assertEquals(ApplicationClassificationStatus.UNRESOLVED_AMBIGUOUS, record.classificationStatus)
    }

    // ---------------------------------------------------------------
    // 9. Empty package output -> UNAVAILABLE
    // ---------------------------------------------------------------
    @Test
    fun emptyEnumerationOutputIsUnavailable() {
        val runner = FakeAdbRunner(enumeration = ok("\n\n"))

        val evidence = provider(runner).collect()

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, evidence.enumerationCompleteness)
        assertTrue(evidence.applications.isEmpty())
        assertTrue(evidence.limitations.any { it.contains("UNAVAILABLE") })
        assertEquals(30, evidence.apiLevel)
    }

    // ---------------------------------------------------------------
    // 10. ADB command failure -> UNAVAILABLE, no fabricated data
    // ---------------------------------------------------------------
    @Test
    fun adbCommandFailureYieldsUnavailable() {
        val runner = FakeAdbRunner(enumeration = fail("error: no devices/emulators found"))

        val evidence = provider(runner).collect()

        assertEquals(ApplicationEnumerationCompleteness.UNAVAILABLE, evidence.enumerationCompleteness)
        assertTrue(evidence.applications.isEmpty())
        assertTrue(evidence.limitations.any { it.contains("UNAVAILABLE") })
        assertTrue(evidence.limitations.any { it.contains("no devices/emulators found") })
        // No per-package commands were attempted after the failed enumeration.
        assertTrue(runner.shellCommands.none { it.startsWith("dumpsys package ") })
    }

    // ---------------------------------------------------------------
    // 11. Partial/filtered enumeration -> FILTERED
    // ---------------------------------------------------------------
    @Test
    fun partialEnumerationIsReportedAsFiltered() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                >>>truncated-output<<<
                """.trimIndent() + "\n",
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        assertEquals(ApplicationEnumerationCompleteness.FILTERED, evidence.enumerationCompleteness)
        assertEquals(1, evidence.applications.size)
        assertTrue(evidence.limitations.any { it.contains("FILTERED") })
    }

    // ---------------------------------------------------------------
    // 12. Complete enumeration -> COMPLETE
    // ---------------------------------------------------------------
    @Test
    fun completeEnumerationReportsComplete() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
                "org.example.userapp" to ok(
                    modernDumpsys("org.example.userapp", flags = "HAS_CODE"),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
        assertEquals(2, evidence.applications.size)
        // Task 8: the multi-user scope limitation is always recorded.
        assertTrue(evidence.limitations.contains(AdbApplicationInventoryProvider.SCOPE_LIMITATION))
        assertTrue(evidence.limitations.contains(AdbApplicationInventoryProvider.LABEL_LIMITATION))
        assertFalse(evidence.limitations.any { it.contains("FILTERED") })
        assertFalse(evidence.limitations.any { it.contains("UNAVAILABLE") })
    }

    // ---------------------------------------------------------------
    // 13. Duplicate package handling
    // ---------------------------------------------------------------
    @Test
    fun duplicatePackagesAreDeduplicated() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:com.android.settings uid:1000
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        assertEquals(2, evidence.applications.size)
        assertEquals(1, evidence.applications.count { it.packageName == "com.android.settings" })
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
    }

    // ---------------------------------------------------------------
    // 14. Missing optional version metadata stays null
    // ---------------------------------------------------------------
    @Test
    fun missingOptionalVersionMetadataStaysNull() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.android.settings uid:1000\n"),
            dumpsys = mapOf(
                "com.android.settings" to ok(
                    modernDumpsys("com.android.settings", versionCode = null, versionName = null),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertNull(record.versionCode)
        assertNull(record.versionName)
        assertNull(record.label)
        // Flags still present, so classification is unaffected by missing version data.
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
    }

    // ---------------------------------------------------------------
    // 15. UID parsing
    // ---------------------------------------------------------------
    @Test
    fun uidIsParsedWhenPresent() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:org.example.userapp
                """.trimIndent() + "\n",
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()
        val byName = evidence.applications.associateBy { it.packageName }

        assertEquals(1000L, byName.getValue("com.android.settings").uid)
        assertNull(byName.getValue("org.example.userapp").uid)
    }

    // ---------------------------------------------------------------
    // 16. Android-version output differences (legacy pkgFlags)
    // ---------------------------------------------------------------
    @Test
    fun androidVersionOutputDifferencesLegacyPkgFlags() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:com.android.legacy uid:1000\n"),
            dumpsys = mapOf("com.android.legacy" to ok(legacyDumpsys("com.android.legacy"))),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
        assertEquals(ApplicationClassificationStatus.DIRECT_PLATFORM_FLAGS, record.classificationStatus)
        assertEquals(true, record.systemFlag)
        assertEquals(27L, record.versionCode)
        assertEquals("8.1.0", record.versionName)
    }

    // ---------------------------------------------------------------
    // Task 6: classification x enabled state are independent dimensions
    // ---------------------------------------------------------------
    @Test
    fun classificationAndEnabledStateAreIndependentDimensions() {
        val systemFlags = "SYSTEM HAS_CODE"
        val updatedFlags = "SYSTEM UPDATED_SYSTEM_APP HAS_CODE"
        val userFlags = "HAS_CODE ALLOW_BACKUP"
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:pkg.sys.enabled uid:10001
                package:pkg.sys.disabled uid:10002
                package:pkg.upd.enabled uid:10003
                package:pkg.upd.disabled uid:10004
                package:pkg.user.enabled uid:10005
                package:pkg.user.disabled uid:10006
                package:pkg.user.default uid:10007
                """.trimIndent() + "\n",
            ),
            disabled = ok(
                """
                package:pkg.sys.disabled
                package:pkg.upd.disabled
                package:pkg.user.disabled
                """.trimIndent() + "\n",
            ),
            enabled = ok(
                """
                package:pkg.sys.enabled
                package:pkg.upd.enabled
                package:pkg.user.enabled
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "pkg.sys.enabled" to ok(modernDumpsys("pkg.sys.enabled", flags = systemFlags)),
                "pkg.sys.disabled" to ok(modernDumpsys("pkg.sys.disabled", flags = systemFlags)),
                "pkg.upd.enabled" to ok(modernDumpsys("pkg.upd.enabled", flags = updatedFlags)),
                "pkg.upd.disabled" to ok(modernDumpsys("pkg.upd.disabled", flags = updatedFlags)),
                "pkg.user.enabled" to ok(modernDumpsys("pkg.user.enabled", flags = userFlags)),
                "pkg.user.disabled" to ok(modernDumpsys("pkg.user.disabled", flags = userFlags)),
                "pkg.user.default" to ok(modernDumpsys("pkg.user.default", flags = userFlags)),
            ),
        )
        val (provider, _) = providerFor(runner)

        val byName = provider.collect().applications.associateBy { it.packageName }

        fun expected(pkg: String, classification: ApplicationClassification, state: ApplicationEnabledState) {
            val record = assertNotNull(byName[pkg], "missing record for $pkg")
            assertEquals(classification, record.classification, pkg)
            assertEquals(state, record.enabledState, pkg)
        }

        expected("pkg.sys.enabled", ApplicationClassification.PREINSTALLED_SYSTEM, ApplicationEnabledState.ENABLED)
        expected("pkg.sys.disabled", ApplicationClassification.PREINSTALLED_SYSTEM, ApplicationEnabledState.DISABLED)
        expected("pkg.upd.enabled", ApplicationClassification.UPDATED_SYSTEM, ApplicationEnabledState.ENABLED)
        expected("pkg.upd.disabled", ApplicationClassification.UPDATED_SYSTEM, ApplicationEnabledState.DISABLED)
        expected("pkg.user.enabled", ApplicationClassification.USER_THIRD_PARTY, ApplicationEnabledState.ENABLED)
        expected("pkg.user.disabled", ApplicationClassification.USER_THIRD_PARTY, ApplicationEnabledState.DISABLED)
        expected("pkg.user.default", ApplicationClassification.USER_THIRD_PARTY, ApplicationEnabledState.DEFAULT)
    }

    // ---------------------------------------------------------------
    // Enabled-state honesty: failed/untrusted filters -> UNKNOWN, not a guess
    // ---------------------------------------------------------------
    @Test
    fun failedFilterQueriesKeepEnabledStateHonest() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:org.example.userapp uid:10089\n"),
            disabled = fail("Error: can't query disabled packages"),
            enabled = ok("Error: cannot query\n"),
            dumpsys = mapOf(
                "org.example.userapp" to ok(
                    modernDumpsys("org.example.userapp", flags = "HAS_CODE"),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()
        val record = evidence.applications.single()

        // Neither filter output is trustworthy -> not-disabled must NOT become DEFAULT/ENABLED.
        assertEquals(ApplicationEnabledState.UNKNOWN, record.enabledState)
        assertTrue(
            evidence.limitations.contains(AdbApplicationInventoryProvider.FILTER_STATE_LIMITATION),
        )
    }

    @Test
    fun contradictoryEnabledFilterMembershipYieldsUnknown() {
        val runner = FakeAdbRunner(
            enumeration = ok("package:org.example.userapp uid:10089\n"),
            disabled = ok("package:org.example.userapp\n"),
            enabled = ok("package:org.example.userapp\n"),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        assertEquals(ApplicationEnabledState.UNKNOWN, record.enabledState)
    }

    // ---------------------------------------------------------------
    // Task 10: security regression — every command stays allowlisted
    // ---------------------------------------------------------------
    @Test
    fun allCommandsRemainWithinAdbSecurityAllowlist() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
                "org.example.userapp" to ok(
                    modernDumpsys("org.example.userapp", flags = "HAS_CODE"),
                ),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)

        val security = HostSecurityAuditEngine()
        assertTrue(runner.shellCommands.isNotEmpty())
        runner.shellCommands.forEach { command ->
            assertTrue(
                security.validateAdbCommandSafety(command),
                "command not allowlist-safe: $command",
            )
            assertTrue(
                command.startsWith("getprop") ||
                    command.startsWith("pm list packages") ||
                    command.startsWith("dumpsys package"),
                "command outside inventory command set: $command",
            )
        }
        // Every dumpsys command embeds a strictly validated package token.
        runner.shellCommands.filter { it.startsWith("dumpsys package ") }.forEach { command ->
            val token = command.removePrefix("dumpsys package ")
            assertTrue(AdbApplicationInventoryProvider.isValidPackageName(token), command)
            assertTrue(Regex("dumpsys package [A-Za-z0-9._]+").matches(command), command)
        }
        // The exact expected command set was used — nothing more.
        assertEquals(
            listOf(
                AdbApplicationInventoryProvider.CMD_API_LEVEL,
                AdbApplicationInventoryProvider.CMD_LIST_ALL,
                AdbApplicationInventoryProvider.CMD_LIST_DISABLED,
                AdbApplicationInventoryProvider.CMD_LIST_ENABLED,
                "dumpsys package com.android.settings",
                "dumpsys package org.example.userapp",
            ),
            runner.shellCommands,
        )
    }

    @Test
    fun injectionAttemptInPackageOutputNeverReachesShell() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:com.evil;reboot uid:10099
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()

        // The hostile token never reaches the shell as a command argument.
        assertTrue(runner.shellCommands.none { it.contains("com.evil") })
        assertEquals(1, evidence.applications.size)
        assertEquals(ApplicationEnumerationCompleteness.FILTERED, evidence.enumerationCompleteness)
        val security = HostSecurityAuditEngine()
        runner.shellCommands.forEach { command ->
            assertTrue(security.validateAdbCommandSafety(command), command)
        }
    }

    // ---------------------------------------------------------------
    // Per-record degradation: one dumpsys failure does not poison the set
    // ---------------------------------------------------------------
    @Test
    fun dumpsysFailureDegradesOnlyAffectedRecord() {
        val runner = FakeAdbRunner(
            enumeration = ok(
                """
                package:com.android.settings uid:1000
                package:org.example.userapp uid:10089
                """.trimIndent() + "\n",
            ),
            dumpsys = mapOf(
                "com.android.settings" to ok(modernDumpsys("com.android.settings")),
                "org.example.userapp" to fail("Error: package not found"),
            ),
        )
        val (provider, _) = providerFor(runner)

        val evidence = provider.collect()
        val byName = evidence.applications.associateBy { it.packageName }

        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, byName.getValue("com.android.settings").classification)
        val degraded = byName.getValue("org.example.userapp")
        assertEquals(ApplicationClassification.UNKNOWN, degraded.classification)
        assertEquals(ApplicationClassificationStatus.EVIDENCE_UNAVAILABLE, degraded.classificationStatus)
        assertNull(degraded.systemFlag)
        assertNull(degraded.versionCode)
        // The enumeration itself is intact, so completeness is unaffected.
        assertEquals(ApplicationEnumerationCompleteness.COMPLETE, evidence.enumerationCompleteness)
        assertTrue(
            evidence.limitations.any { it.contains("System/updated flags unavailable for 1 package(s)") },
        )
    }

    // ---------------------------------------------------------------
    // Shared-user dumps: flags are attributed only to the requested package
    // ---------------------------------------------------------------
    @Test
    fun sharedUserDumpAttributesFlagsOnlyToRequestedPackage() {
        val twoPackageDump = """
            Package [com.shared.a] (aaaa1111):
              userId=10001
              versionCode=5 minSdk=26 targetSdk=34
              versionName=5.0
              flags=[ SYSTEM HAS_CODE ]
            Package [com.shared.b] (bbbb2222):
              userId=10001
              versionCode=9 minSdk=26 targetSdk=34
              versionName=9.0
              flags=[ HAS_CODE ALLOW_BACKUP ]
        """.trimIndent() + "\n"

        val runner = FakeAdbRunner(
            enumeration = ok("package:com.shared.a uid:10001\n"),
            dumpsys = mapOf("com.shared.a" to ok(twoPackageDump)),
        )
        val (provider, _) = providerFor(runner)

        val record = provider.collect().applications.single()

        // Block extraction must use com.shared.a's block, not com.shared.b's.
        assertEquals(ApplicationClassification.PREINSTALLED_SYSTEM, record.classification)
        assertEquals(5L, record.versionCode)
        assertEquals("5.0", record.versionName)
    }
}
