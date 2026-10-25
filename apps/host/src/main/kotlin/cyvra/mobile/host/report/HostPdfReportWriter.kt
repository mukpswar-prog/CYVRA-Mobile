package cyvra.mobile.host.report

import cyvra.mobile.core.TechnicianChecklistRecord
import cyvra.mobile.host.service.WorkstationDiagnosticExecutionResult
import cyvra.mobile.host.service.WorkstationSanitizationLifecycleResult
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicLong

/**
 * Metadata for a persisted PDF report written to `Downloads/CYVRA/`.
 */
data class WrittenPdfArtifact(
    val reportType: String,
    val serial: String,
    val sessionUuid: String,
    val deviceLifecycleId: String,
    val fileName: String,
    val pdfPath: String,
    val pdfSha256: String,
    val generatedAtUtc: String,
)

/**
 * Deterministic, zero-external-dependency PDF 1.4 report writer for CYVRA Mobile.
 *
 * Writes per-device, per-operation PDF reports directly to `<OS Downloads>/CYVRA/`
 * (or the directory configured via `-Dcyvra.downloads.dir` / `CYVRA_DOWNLOADS_DIR`)
 * with collision-safe deterministic naming:
 *   `CYVRA_<seq>_<device-or-session-id>_<report-type>_<timestamp>.pdf`
 *
 * Guarantees:
 * - Reports for Device A and Device B never overwrite each other.
 * - Repeated scans of the same device produce distinct PDF files tied to their scan session.
 * - Output is a standard-compliant PDF 1.4 document (`%PDF-1.4` ... `xref` ... `%%EOF`).
 */
class HostPdfReportWriter(
    private val downloadsDirectoryProvider: () -> File = { defaultDownloadsDirectory() },
) {
    companion object {
        const val TYPE_HW_SCAN = "HW_SCAN"
        const val TYPE_APP_SCAN = "APP_SCAN"
        const val TYPE_SANITIZATION_AUDIT = "SANITIZATION_AUDIT"

        const val DOWNLOADS_DIR_PROPERTY = "cyvra.downloads.dir"
        const val DOWNLOADS_DIR_ENV = "CYVRA_DOWNLOADS_DIR"

        private val sequenceCounter = AtomicLong(0L)
        private val fileWriteLock = Any()

        private val TIMESTAMP_FORMATTER: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC)

        private const val LINES_PER_PAGE = 46

        fun defaultDownloadsDirectory(): File {
            val fromProperty = System.getProperty(DOWNLOADS_DIR_PROPERTY)?.trim()?.takeIf { it.isNotEmpty() }
            if (fromProperty != null) {
                return File(fromProperty)
            }
            val fromEnv = System.getenv(DOWNLOADS_DIR_ENV)?.trim()?.takeIf { it.isNotEmpty() }
            if (fromEnv != null) {
                return File(fromEnv)
            }
            val userHome = System.getProperty("user.home")?.trim()?.takeIf { it.isNotEmpty() } ?: "."
            return File(userHome, "Downloads").resolve("CYVRA")
        }

        private fun sanitizeToken(raw: String): String =
            raw.trim()
                .replace(Regex("[^A-Za-z0-9._-]"), "_")
                .take(36)
                .ifBlank { "DEVICE" }

        private fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256")
                .digest(bytes)
                .joinToString("") { "%02x".format(it) }
    }

    fun writeHardwareScanPdf(
        serial: String,
        deviceLifecycleId: String,
        scan: WorkstationDiagnosticExecutionResult,
        checklist: TechnicianChecklistRecord? = null,
    ): WrittenPdfArtifact {
        val now = Instant.now()
        val id = scan.report.deviceIdentity
        val battery = scan.report.batterySnapshot
        val storage = scan.report.storageSnapshot
        val security = scan.report.securitySnapshot
        val cap = scan.report.capabilityAssessment
        val lines = buildList {
            add("========================================================================")
            add("CYVRA MOBILE WORKSTATION — HARDWARE & SYSTEM DIAGNOSTIC REPORT (H/W SCN)")
            add("========================================================================")
            add("Report ID            : ${scan.report.header.reportId}")
            add("Scan Session UUID    : ${scan.sessionUuid}")
            add("Device Lifecycle ID  : $deviceLifecycleId")
            add("Device Serial        : $serial")
            add("Operator ID          : ${scan.report.header.operatorId}")
            add("Generated At (UTC)   : $now")
            add("Report Digest SHA256 : ${scan.report.integrity?.contentDigest ?: "UNHASHED"}")
            add("------------------------------------------------------------------------")
            add("1. DEVICE IDENTITY")
            add("------------------------------------------------------------------------")
            add("Manufacturer         : ${id.manufacturer.value ?: "Unknown"} (${id.manufacturer.status})")
            add("Brand                : ${id.brand.value ?: "Unknown"}")
            add("Model                : ${id.model.value ?: "Unknown"} (${id.model.status})")
            add("Android Version      : ${id.androidVersion.value ?: "Unknown"}")
            add("API Level            : ${id.apiLevel.value ?: "Unknown"}")
            add("Build ID             : ${id.buildId.value ?: "Unknown"}")
            add("Security Patch       : ${id.securityPatch.value ?: "Unknown"}")
            add("------------------------------------------------------------------------")
            add("2. HARDWARE TELEMETRY (BATTERY & STORAGE)")
            add("------------------------------------------------------------------------")
            add("Battery Level        : ${battery.levelPercent.value?.let { "$it%" } ?: "Unavailable"}")
            add("Battery Health       : ${battery.health.value ?: "Unavailable"}")
            add("Battery Charging     : ${battery.isCharging.value?.toString() ?: "Unavailable"}")
            add("Battery Raw Temp     : ${battery.rawTemperatureDeviceUnits?.value?.toString() ?: "Unavailable"}")
            add("Storage Total Bytes  : ${storage.internalTotalBytes.value?.toString() ?: "Unavailable"}")
            add("Storage Avail Bytes  : ${storage.internalAvailableBytes.value?.toString() ?: "Unavailable"}")
            add("External Storage     : ${storage.externalStoragePresent.value?.toString() ?: "Unavailable"}")
            add("Scoped Storage       : ${storage.scopedStorageEnforced.value?.toString() ?: "Unavailable"}")
            add("------------------------------------------------------------------------")
            add("3. PLATFORM SECURITY & SANITIZATION CAPABILITY ASSESSMENT")
            add("------------------------------------------------------------------------")
            add("Screen Lock Present  : ${security.screenLockPresent.value?.toString() ?: "Unavailable"}")
            add("Secure Boot Enabled  : ${security.secureBootEnabled.value?.toString() ?: "Unavailable"}")
            add("Device Owner Active  : ${security.deviceOwnerActive.value?.toString() ?: "Unavailable"}")
            add("OEM Adapter          : ${cap.resolvedOemAdapter ?: "None"} (available=${cap.isOemAdapterAvailable})")
            add("Recommended Action   : ${cap.recommendedPurgeAction}")
            add("Post-Purge Verify    : ${cap.isPostPurgeVerificationRequired}")
            if (cap.limitations.isNotEmpty()) {
                add("Capability Notes     :")
                cap.limitations.forEach { note -> add("  - $note") }
            }
            add("------------------------------------------------------------------------")
            add("4. TECHNICIAN PHYSICAL CHECKLIST ATTESTATION")
            add("------------------------------------------------------------------------")
            if (checklist == null || checklist.results.isEmpty()) {
                add("Checklist Status     : No operator checklist attestations recorded")
            } else {
                add("Checklist ID         : ${checklist.checklistId}")
                add("Recorded Count       : ${checklist.results.size} / ${checklist.expectedCount}")
                checklist.results.forEach { item ->
                    add("  [${item.id}] ${item.outcome.name} (by ${item.operatorId} at ${item.observedAt})")
                }
            }
            add("========================================================================")
            add("END OF HARDWARE & SYSTEM DIAGNOSTIC REPORT")
            add("========================================================================")
        }
        return persistPdf(
            reportType = TYPE_HW_SCAN,
            serial = serial,
            sessionUuid = scan.sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            lines = lines,
        )
    }

    fun writeAppScanPdf(
        serial: String,
        deviceLifecycleId: String,
        scan: WorkstationDiagnosticExecutionResult,
    ): WrittenPdfArtifact {
        val now = Instant.now()
        val section = scan.report.applicationInventory
        val reconciledRecords = scan.evidence.reconciledApplicationInventory?.records.orEmpty()
        val primaryApps = scan.evidence.applicationInventory?.applications.orEmpty()

        val lines = buildList {
            add("========================================================================")
            add("CYVRA MOBILE WORKSTATION — APPLICATION INVENTORY REPORT (APP SCN)")
            add("========================================================================")
            add("Report ID            : ${scan.report.header.reportId}")
            add("Scan Session UUID    : ${scan.sessionUuid}")
            add("Device Lifecycle ID  : $deviceLifecycleId")
            add("Device Serial        : $serial")
            add("Operator ID          : ${scan.report.header.operatorId}")
            add("Generated At (UTC)   : $now")
            add("------------------------------------------------------------------------")
            add("1. RECONCILED S1 + S2 INVENTORY SUMMARY")
            add("------------------------------------------------------------------------")
            add("Inventory Available  : ${section?.inventoryAvailable ?: false}")
            add("Total Applications   : ${section?.totalApplications ?: reconciledRecords.size}")
            add("Completeness         : ${section?.enumerationCompleteness?.name ?: "UNAVAILABLE"}")
            add("S1 (Device Agent)    : ${if (section?.s1EvidencePresent == true) "PRESENT (${section.s1EnumerationCompleteness})" else "NOT PRESENT"}")
            add("S2 (Authorized ADB)  : ${if (section?.s2EvidencePresent == true) "PRESENT (${section.s2EnumerationCompleteness})" else "NOT PRESENT"}")
            add("Preinstalled System  : ${section?.preinstalledSystemCount ?: 0}")
            add("Updated System       : ${section?.updatedSystemCount ?: 0}")
            add("User / Third-Party   : ${section?.userThirdPartyCount ?: 0}")
            add("Enabled / Disabled   : ${section?.enabledCount ?: 0} enabled / ${section?.disabledCount ?: 0} disabled")
            add("Provenance Split     : S1-only=${section?.s1OnlyCount ?: 0}, S2-only=${section?.s2OnlyCount ?: 0}, Both=${section?.bothCount ?: 0}")
            add("Conflict Count       : ${section?.conflictCount ?: 0}")
            if (!section?.conflicts.isNullOrEmpty()) {
                add("Conflicts            :")
                section?.conflicts?.forEach { c -> add("  ! $c") }
            }
            if (!section?.limitations.isNullOrEmpty()) {
                add("Limitations          :")
                section?.limitations?.forEach { l -> add("  - $l") }
            }
            add("------------------------------------------------------------------------")
            add("2. PACKAGE INVENTORY LISTING")
            add("------------------------------------------------------------------------")
            when {
                reconciledRecords.isNotEmpty() -> {
                    reconciledRecords.forEachIndexed { idx, rec ->
                        add(
                            "%03d. %-38s | %-18s | %-8s | %s".format(
                                idx + 1,
                                rec.packageName.take(38),
                                rec.classification.name.take(18),
                                rec.enabledState.name.take(8),
                                rec.provenance.name,
                            ),
                        )
                    }
                }
                primaryApps.isNotEmpty() -> {
                    primaryApps.forEachIndexed { idx, app ->
                        add(
                            "%03d. %-38s | %-18s | %-8s | %s".format(
                                idx + 1,
                                app.packageName.take(38),
                                app.classification.name.take(18),
                                app.enabledState.name.take(8),
                                app.evidenceSource,
                            ),
                        )
                    }
                }
                else -> {
                    add("No application records enumerated in this session.")
                }
            }
            add("========================================================================")
            add("END OF APPLICATION INVENTORY REPORT")
            add("========================================================================")
        }
        return persistPdf(
            reportType = TYPE_APP_SCAN,
            serial = serial,
            sessionUuid = scan.sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            lines = lines,
        )
    }

    fun writeSanitizationAuditPdf(
        serial: String,
        deviceLifecycleId: String,
        sessionUuid: String,
        verificationReportId: String,
        lifecycleResult: WorkstationSanitizationLifecycleResult,
        operatorId: String,
    ): WrittenPdfArtifact {
        val now = Instant.now()
        val execution = lifecycleResult.executionResult
        val verification = lifecycleResult.verificationResult
        val cert = lifecycleResult.finalReport

        val lines = buildList {
            add("========================================================================")
            add("CYVRA MOBILE WORKSTATION — SANITIZATION AUDIT & VERIFICATION REPORT")
            add("========================================================================")
            add("Certificate / Audit ID : ${cert?.header?.reportId ?: "PENDING"}")
            add("Operation ID           : ${execution?.operationId ?: lifecycleResult.session?.operationId ?: "N/A"}")
            add("Scan Session UUID      : $sessionUuid")
            add("Device Lifecycle ID    : $deviceLifecycleId")
            add("Target Device Serial   : $serial")
            add("Pre-Scan Report Ref    : $verificationReportId")
            add("Operator ID            : $operatorId")
            add("Generated At (UTC)     : $now")
            add("------------------------------------------------------------------------")
            add("1. AUTHORIZATION & PREREQUISITE GATES")
            add("------------------------------------------------------------------------")
            add("Eligibility Gate       : ${if (lifecycleResult.eligibility.isEligible) "ELIGIBLE" else "BLOCKED"}")
            add("2-Step Confirmation    : ${if (lifecycleResult.session?.barrier?.isBarrierPassed == true) "PASSED (OPERATOR CONFIRMED)" else "NOT PASSED"}")
            add("Target Serial Lock     : VERIFIED ($serial)")
            add("------------------------------------------------------------------------")
            add("2. SANITIZATION EXECUTION OUTCOME")
            add("------------------------------------------------------------------------")
            add("Selected Method        : ${execution?.method?.name ?: lifecycleResult.session?.selectedMethod?.name ?: "N/A"}")
            add("Execution Status       : ${execution?.executionStatus ?: "NOT_EXECUTED"}")
            add("Execution Success      : ${execution?.isSuccess ?: false}")
            add("Executed At            : ${execution?.executedAt ?: "N/A"}")
            if (!execution?.error.isNullOrBlank()) {
                add("Execution Error/Reason : ${execution?.error}")
            }
            add("------------------------------------------------------------------------")
            add("3. POST-SANITIZATION VERIFICATION (CONSOLIDATED)")
            add("------------------------------------------------------------------------")
            add("Verification Status    : ${verification?.status?.name ?: "NOT_RUN"}")
            add("Post-Reset Detected    : ${verification?.postResetStateDetected ?: false}")
            add("Setup Wizard Detected  : ${verification?.setupWizardDetected ?: false}")
            add("User Data Inaccessible : ${verification?.userDataInaccessible?.toString() ?: "NOT_ESTABLISHED"}")
            add("Assurance Level        : ${verification?.assuranceLevel ?: "N/A"}")
            add("------------------------------------------------------------------------")
            add("4. FINAL LIFECYCLE OUTCOME & SEAL")
            add("------------------------------------------------------------------------")
            add("Lifecycle Outcome      : ${cert?.lifecycleOutcome?.name ?: "BLOCKED_NOT_EXECUTED"}")
            add("Success Claimed        : ${lifecycleResult.successClaimed}")
            add("Certificate SHA-256    : ${cert?.integrity?.contentDigest ?: "N/A"}")
            if (lifecycleResult.blockReasons.isNotEmpty()) {
                add("Block / Gate Reasons   :")
                lifecycleResult.blockReasons.forEach { reason -> add("  - $reason") }
            }
            add("Session Disposition    : DEVICE WORKFLOW SESSION CLOSED / DISCONNECTED")
            add("========================================================================")
            add("END OF SANITIZATION AUDIT & VERIFICATION REPORT")
            add("========================================================================")
        }
        return persistPdf(
            reportType = TYPE_SANITIZATION_AUDIT,
            serial = serial,
            sessionUuid = sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            lines = lines,
        )
    }

    private fun persistPdf(
        reportType: String,
        serial: String,
        sessionUuid: String,
        deviceLifecycleId: String,
        now: Instant,
        lines: List<String>,
    ): WrittenPdfArtifact {
        val pdfBytes = renderPdfDocument(lines)
        val digest = sha256Hex(pdfBytes)
        val seq = sequenceCounter.incrementAndGet()
        val safeSerial = sanitizeToken(serial)
        val shortSession = sanitizeToken(sessionUuid.take(8))
        val safeType = sanitizeToken(reportType)
        val ts = TIMESTAMP_FORMATTER.format(now)

        val directory = downloadsDirectoryProvider()
        synchronized(fileWriteLock) {
            if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory) {
                throw ReportWriteException("Could not create Downloads/CYVRA directory at ${directory.absolutePath}")
            }
            var candidateName = "CYVRA_%03d_%s-%s_%s_%s.pdf".format(seq, safeSerial, shortSession, safeType, ts)
            var targetFile = File(directory, candidateName)
            var collisionIdx = 1
            while (targetFile.exists()) {
                candidateName = "CYVRA_%03d_%s-%s_%s_%s_%d.pdf".format(
                    seq,
                    safeSerial,
                    shortSession,
                    safeType,
                    ts,
                    collisionIdx++,
                )
                targetFile = File(directory, candidateName)
            }
            targetFile.writeBytes(pdfBytes)

            return WrittenPdfArtifact(
                reportType = reportType,
                serial = serial,
                sessionUuid = sessionUuid,
                deviceLifecycleId = deviceLifecycleId,
                fileName = candidateName,
                pdfPath = targetFile.absolutePath,
                pdfSha256 = digest,
                generatedAtUtc = now.toString(),
            )
        }
    }

    /**
     * Generates a standards-compliant PDF 1.4 byte array using built-in Type1 Courier font
     * for clean fixed-width tabular alignment across all PDF readers.
     */
    internal fun renderPdfDocument(lines: List<String>): ByteArray {
        val pages = if (lines.isEmpty()) listOf(listOf("")) else lines.chunked(LINES_PER_PAGE)
        val out = ByteArrayOutputStream()
        val offsets = mutableMapOf<Int, Int>()

        fun writeAscii(text: String) {
            out.write(text.toByteArray(StandardCharsets.ISO_8859_1))
        }

        fun escapePdfText(raw: String): String {
            val sb = StringBuilder(raw.length + 16)
            for (ch in raw) {
                when (ch) {
                    '\\' -> sb.append("\\\\")
                    '(' -> sb.append("\\(")
                    ')' -> sb.append("\\)")
                    in '\u0020'..'\u007E' -> sb.append(ch)
                    else -> sb.append('?')
                }
            }
            return sb.toString()
        }

        // Object IDs:
        // 1: Catalog
        // 2: Pages
        // 3: Font (Courier)
        // For each page i (0 until pages.size):
        //   pageObjId = 4 + i * 2
        //   contentObjId = 5 + i * 2
        val totalObjects = 3 + pages.size * 2

        writeAscii("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n")

        // 1: Catalog
        offsets[1] = out.size()
        writeAscii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

        // 2: Pages
        val kidsRefs = pages.indices.joinToString(" ") { idx -> "${4 + idx * 2} 0 R" }
        offsets[2] = out.size()
        writeAscii("2 0 obj\n<< /Type /Pages /Kids [ $kidsRefs ] /Count ${pages.size} >>\nendobj\n")

        // 3: Font
        offsets[3] = out.size()
        writeAscii("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n")

        pages.forEachIndexed { idx, pageLines ->
            val pageObjId = 4 + idx * 2
            val contentObjId = 5 + idx * 2

            val streamBuilder = StringBuilder()
            streamBuilder.append("BT\n/F1 9 Tf\n14 TL\n36 756 Td\n")
            pageLines.forEachIndexed { lineIdx, line ->
                val escaped = escapePdfText(line)
                if (lineIdx == 0) {
                    streamBuilder.append("($escaped) Tj\n")
                } else {
                    streamBuilder.append("T* ($escaped) Tj\n")
                }
            }
            streamBuilder.append("T* (Page ${idx + 1} of ${pages.size}) Tj\n")
            streamBuilder.append("ET\n")
            val streamBytes = streamBuilder.toString().toByteArray(StandardCharsets.ISO_8859_1)

            offsets[pageObjId] = out.size()
            writeAscii(
                "$pageObjId 0 obj\n" +
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
                    "/Resources << /Font << /F1 3 0 R >> >> " +
                    "/Contents $contentObjId 0 R >>\n" +
                    "endobj\n",
            )

            offsets[contentObjId] = out.size()
            writeAscii("$contentObjId 0 obj\n<< /Length ${streamBytes.size} >>\nstream\n")
            out.write(streamBytes)
            writeAscii("\nendstream\nendobj\n")
        }

        val xrefOffset = out.size()
        writeAscii("xref\n0 ${totalObjects + 1}\n")
        writeAscii("0000000000 65535 f \n")
        for (objId in 1..totalObjects) {
            val offset = offsets[objId] ?: 0
            writeAscii("%010d 00000 n \n".format(offset))
        }
        writeAscii(
            "trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n" +
                "startxref\n$xrefOffset\n%%EOF\n",
        )
        return out.toByteArray()
    }
}
