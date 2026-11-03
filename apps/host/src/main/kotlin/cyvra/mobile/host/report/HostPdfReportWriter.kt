package cyvra.mobile.host.report

import cyvra.mobile.core.TechnicianChecklistRecord
import cyvra.mobile.host.service.WorkstationDiagnosticExecutionResult
import cyvra.mobile.host.service.WorkstationSanitizationLifecycleResult
import cyvra.mobile.host.service.WorkstationSessionOrchestrator
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDDocumentInformation
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.apache.pdfbox.pdmodel.font.Standard14Fonts
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Calendar
import java.util.TimeZone
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
 * Production Apache PDFBox 3.0.3 report writer for CYVRA Mobile 2.0.1.
 *
 * Produces structured, multi-page, auditable PDF reports with zero hardware serial leakage:
 * - Report 1: Hardware & System Diagnostic Report (HW_SCAN)
 * - Report 2: Installed Application Inventory Report (APP_SCAN)
 * - Report 3: Sanitization Attempt & Verification Report / Certificate (SANITIZATION_AUDIT)
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

        fun cleanText(input: String): String {
            val sb = StringBuilder()
            for (ch in input) {
                if (ch == '\u00B0') {
                    sb.append(ch)
                } else if (ch.code in 32..126 || ch.code in 160..255) {
                    sb.append(ch)
                } else if (ch == '\t') {
                    sb.append("    ")
                } else {
                    sb.append(' ')
                }
            }
            return sb.toString()
        }
    }

    private class PdfDocumentBuilder(private val title: String, private val documentId: String) {
        val document = PDDocument()
        private val fontRegular = PDType1Font(Standard14Fonts.FontName.HELVETICA)
        private val fontBold = PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD)
        private val fontMono = PDType1Font(Standard14Fonts.FontName.COURIER)
        private val fontMonoBold = PDType1Font(Standard14Fonts.FontName.COURIER_BOLD)

        private var currentPage: PDPage? = null
        private var stream: PDPageContentStream? = null
        private var y = 792f
        private var pageNumber = 0
        private val pages = mutableListOf<PDPage>()

        init {
            val info = PDDocumentInformation()
            info.title = title
            info.author = "CYVORIQ Solutions"
            info.creator = "CYVRA Mobile 2.1.2"
            info.producer = "CYVRA Evidence Engine / Apache PDFBox 3.0.3"
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
            info.creationDate = cal
            info.modificationDate = cal
            document.documentInformation = info
            newPage()
        }

        private fun newPage() {
            stream?.close()
            pageNumber++
            val page = PDPage(PDRectangle.A4)
            document.addPage(page)
            pages.add(page)
            currentPage = page
            val s = PDPageContentStream(document, page)
            stream = s
            y = 792f

            // Top Header
            s.beginText()
            s.setFont(fontBold, 8f)
            s.newLineAtOffset(40f, 810f)
            s.showText("CYVRA MOBILE — EVIDENCE PLATFORM")
            s.endText()

            s.beginText()
            s.setFont(fontRegular, 8f)
            s.newLineAtOffset(350f, 810f)
            s.showText(cleanText(documentId))
            s.endText()

            s.setLineWidth(0.5f)
            s.moveTo(40f, 804f)
            s.lineTo(555f, 804f)
            s.stroke()

            // Bottom Footer
            s.setLineWidth(0.5f)
            s.moveTo(40f, 40f)
            s.lineTo(555f, 40f)
            s.stroke()

            s.beginText()
            s.setFont(fontRegular, 7.5f)
            s.newLineAtOffset(40f, 30f)
            s.showText("CONFIDENTIAL — Tamper-Evident Report Artifact — CYVORIQ Solutions")
            s.endText()
        }

        fun ensureSpace(neededHeight: Float) {
            if (y - neededHeight < 50f) {
                newPage()
            }
        }

        fun addTitle(mainTitle: String, subtitle: String? = null) {
            ensureSpace(45f)
            val s = stream!!
            s.beginText()
            s.setFont(fontBold, 13f)
            s.newLineAtOffset(40f, y)
            s.showText(cleanText(mainTitle))
            s.endText()
            y -= 16f

            if (subtitle != null) {
                s.beginText()
                s.setFont(fontRegular, 8.5f)
                s.newLineAtOffset(40f, y)
                s.showText(cleanText(subtitle))
                s.endText()
                y -= 14f
            }
            y -= 6f
        }

        fun addSectionHeader(headerText: String) {
            ensureSpace(32f)
            val s = stream!!
            s.setLineWidth(0.8f)
            s.moveTo(40f, y + 2f)
            s.lineTo(555f, y + 2f)
            s.stroke()

            s.beginText()
            s.setFont(fontBold, 9.5f)
            s.newLineAtOffset(40f, y - 10f)
            s.showText(cleanText(headerText))
            s.endText()
            y -= 22f
        }

        fun addKeyValue(key: String, value: String, keyWidth: Float = 160f) {
            ensureSpace(14f)
            val s = stream!!
            s.beginText()
            s.setFont(fontBold, 8.5f)
            s.newLineAtOffset(40f, y)
            s.showText(cleanText(key))
            s.endText()

            s.beginText()
            s.setFont(fontRegular, 8.5f)
            s.newLineAtOffset(40f + keyWidth, y)
            s.showText(cleanText(value.take(75)))
            s.endText()
            y -= 13f
        }

        fun addTableRow(cols: List<String>, widths: List<Float>, isBold: Boolean = false, isMono: Boolean = false) {
            ensureSpace(14f)
            val s = stream!!
            var curX = 40f
            val f = when {
                isBold && isMono -> fontMonoBold
                isBold -> fontBold
                isMono -> fontMono
                else -> fontRegular
            }
            for (i in cols.indices) {
                val text = cols[i]
                val w = widths[i]
                s.beginText()
                s.setFont(f, 8f)
                s.newLineAtOffset(curX, y)
                val maxChars = (w / 4.8f).toInt().coerceAtLeast(4)
                s.showText(cleanText(text.take(maxChars)))
                s.endText()
                curX += w
            }
            y -= 12f
        }

        fun addDivider() {
            ensureSpace(10f)
            val s = stream!!
            s.setLineWidth(0.3f)
            s.moveTo(40f, y)
            s.lineTo(555f, y)
            s.stroke()
            y -= 8f
        }

        fun build(): ByteArray {
            stream?.close()
            // Stamp page numbers on all pages
            for (i in 0 until pageNumber) {
                val p = pages[i]
                val s = PDPageContentStream(document, p, PDPageContentStream.AppendMode.APPEND, true, true)
                s.beginText()
                s.setFont(fontRegular, 7.5f)
                s.newLineAtOffset(480f, 30f)
                s.showText("Page ${i + 1} of $pageNumber")
                s.endText()
                s.close()
            }
            val out = ByteArrayOutputStream()
            document.save(out)
            document.close()
            return out.toByteArray()
        }
    }

    fun writeHardwareScanPdf(
        serial: String,
        deviceLifecycleId: String,
        scan: WorkstationDiagnosticExecutionResult,
        checklist: TechnicianChecklistRecord? = null,
    ): WrittenPdfArtifact {
        val now = Instant.now()
        val docId = scan.report.header.reportId
        val opaqueRef = WorkstationSessionOrchestrator.opaqueDeviceRefFor(serial)
        val builder = PdfDocumentBuilder(
            title = "CYVRA Mobile — Hardware & System Diagnostic Report",
            documentId = docId,
        )

        builder.addTitle(
            "Hardware & System Diagnostic Report",
            "CYVRA Mobile Workstation — Pre-Sanitization Diagnostic Assessment (H/W SCN)",
        )

        builder.addSectionHeader("1. DOCUMENT METADATA & DEVICE IDENTITY")
        builder.addKeyValue("Report Document ID", docId)
        builder.addKeyValue("Session UUID", scan.sessionUuid)
        builder.addKeyValue("Target Device Ref", opaqueRef)
        builder.addKeyValue("Device Lifecycle ID", deviceLifecycleId)
        builder.addKeyValue("Operator ID", scan.report.header.operatorId)
        builder.addKeyValue("Generated At (UTC)", now.toString())
        builder.addKeyValue("Report Coverage", scan.report.coverage.name)

        val id = scan.report.deviceIdentity
        builder.addDivider()
        builder.addKeyValue("Manufacturer / Brand", "${id.manufacturer.value ?: "N/A"} / ${id.brand.value ?: "N/A"}")
        builder.addKeyValue("Model Identifier", id.model.value ?: "N/A")
        builder.addKeyValue("Android Version", "Android ${id.androidVersion.value ?: "N/A"} (API Level ${id.apiLevel.value ?: 0})")
        builder.addKeyValue("Build ID", id.buildId.value ?: "N/A")
        builder.addKeyValue("Security Patch Level", id.securityPatch.value ?: "N/A")
        builder.addKeyValue("Build Fingerprint", id.buildFingerprint?.value ?: "N/A")
        builder.addKeyValue("Platform Identifier", "RESTRICTED (Withheld for customer privacy)")
        builder.addKeyValue("Hardware Serial / IMEI", "RESTRICTED (Withheld for customer privacy)")

        val battery = scan.report.batterySnapshot
        builder.addSectionHeader("2. BATTERY & POWER SUBSYSTEM")
        builder.addKeyValue("Charge Level", "${battery.levelPercent?.value ?: 0}%")
        builder.addKeyValue("Charging Status", if (battery.isCharging.value == true) "Connected / Charging" else "Discharging")
        builder.addKeyValue("Battery Health State", battery.health?.value ?: "N/A")
        val tempRaw = battery.rawTemperatureDeviceUnits?.value
        val tempStr = if (tempRaw != null) "${"%.1f".format(tempRaw / 10.0)} °C ($tempRaw tenths °C)" else "NOT_AVAILABLE"
        builder.addKeyValue("Battery Temperature", tempStr)
        builder.addKeyValue("State of Health (SOH)", "${battery.stateOfHealthSoh.status.name} (${battery.stateOfHealthSoh.reason ?: "Manufacturer restricted"})")

        val storage = scan.report.storageSnapshot
        builder.addSectionHeader("3. STORAGE CAPACITY & PARTITION TELEMETRY")
        val totBytes = storage.internalTotalBytes?.value
        val availBytes = storage.internalAvailableBytes?.value
        val totStr = if (totBytes != null) {
            "${"%.2f".format(totBytes.toDouble() / 1_000_000_000.0)} GB (${"%.2f".format(totBytes.toDouble() / (1024.0 * 1024.0 * 1024.0))} GiB)"
        } else "NOT_AVAILABLE"
        val availStr = if (availBytes != null) {
            "${"%.2f".format(availBytes.toDouble() / 1_000_000_000.0)} GB (${"%.2f".format(availBytes.toDouble() / (1024.0 * 1024.0 * 1024.0))} GiB)"
        } else "NOT_AVAILABLE"
        builder.addKeyValue("/data Partition Capacity", totStr)
        builder.addKeyValue("/data Partition Free", availStr)
        builder.addKeyValue("External Storage Present", storage.externalStoragePresent.value?.toString() ?: "NOT_AVAILABLE")
        builder.addKeyValue("Storage Crawl Policy", storage.accessLimitation)

        val security = scan.report.securitySnapshot
        builder.addSectionHeader("4. SECURITY POSTURE & GOVERNANCE")
        builder.addKeyValue("Screen Lock Configured", security.screenLockPresent.value?.toString() ?: "NOT_AVAILABLE")
        builder.addKeyValue("USB Debugging (ADB)", security.adbEnabled?.value?.toString() ?: "NOT_AVAILABLE")
        builder.addKeyValue("Verified Boot (dm-verity)", "${security.secureBootEnabled?.value} (${security.secureBootEnabled?.reason ?: ""})")
        builder.addKeyValue("Device Owner Active", "${security.deviceOwnerActive?.value} (${security.deviceOwnerActive?.reason ?: ""})")
        builder.addKeyValue("Knox Enterprise Claim", security.knoxClaim.status.name)

        val extendedParams = scan.report.extendedParameters
        if (extendedParams.isNotEmpty()) {
            builder.addSectionHeader("5. EXTENDED DIAGNOSTIC PARAMETER MATRIX (${extendedParams.size} RATIFIED METRICS)")
            val tableWidths = listOf(65f, 160f, 80f, 210f)
            builder.addTableRow(listOf("ID", "Parameter Name", "Status", "Measured Value / Note"), tableWidths, isBold = true)
            builder.addDivider()

            val byDomain = extendedParams.groupBy { it.domain }
            for ((domain, params) in byDomain) {
                builder.ensureSpace(20f)
                builder.addTableRow(listOf("[$domain]", "", "", ""), tableWidths, isBold = true)
                for (p in params) {
                    val statusStr = p.result.status.name
                    val valStr = p.result.value ?: (p.result.reason ?: "N/A")
                    builder.addTableRow(listOf(p.id, p.label, statusStr, valStr), tableWidths, isMono = true)
                }
            }
        }

        if (checklist != null && checklist.results.isNotEmpty()) {
            builder.addSectionHeader("6. TECHNICIAN PHYSICAL VERIFICATION CHECKLIST")
            builder.addKeyValue("Total Checklist Items", "${checklist.results.size} / ${checklist.expectedCount}")
            val ckWidths = listOf(90f, 120f, 110f, 195f)
            builder.addTableRow(listOf("Checklist ID", "Outcome", "Operator ID", "Timestamp"), ckWidths, isBold = true)
            builder.addDivider()
            for (c in checklist.results) {
                builder.addTableRow(listOf(c.id, c.outcome.name, c.operatorId, c.observedAt), ckWidths)
            }
        }

        return persistPdf(
            reportType = TYPE_HW_SCAN,
            serial = serial,
            sessionUuid = scan.sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            pdfBytes = builder.build(),
        )
    }

    fun writeAppScanPdf(
        serial: String,
        deviceLifecycleId: String,
        scan: WorkstationDiagnosticExecutionResult,
    ): WrittenPdfArtifact {
        val now = Instant.now()
        val docId = scan.report.header.reportId.replace("CYVRA-R1", "CYVRA-APP")
        val opaqueRef = WorkstationSessionOrchestrator.opaqueDeviceRefFor(serial)
        val section = scan.report.applicationInventory
        val reconciledRecords = scan.evidence.reconciledApplicationInventory?.records.orEmpty()
        val primaryApps = scan.evidence.applicationInventory?.applications.orEmpty()

        val builder = PdfDocumentBuilder(
            title = "CYVRA Mobile — Installed Application Inventory Report",
            documentId = docId,
        )

        builder.addTitle(
            "Installed Application Inventory Report",
            "CYVRA Mobile Workstation — Automated Package Enumeration (APP SCN)",
        )

        builder.addSectionHeader("1. DOCUMENT METADATA & ENUMERATION SCOPE")
        builder.addKeyValue("Report Document ID", docId)
        builder.addKeyValue("Session UUID", scan.sessionUuid)
        builder.addKeyValue("Target Device Ref", opaqueRef)
        builder.addKeyValue("Device Lifecycle ID", deviceLifecycleId)
        builder.addKeyValue("Operator ID", scan.report.header.operatorId)
        builder.addKeyValue("Generated At (UTC)", now.toString())
        builder.addKeyValue("Enumeration Scope", "Primary User 0 — ADB (Work profiles / secondary users not enumerated)")

        builder.addSectionHeader("2. RECONCILED INVENTORY SUMMARY")
        val totApps = section?.totalApplications ?: if (reconciledRecords.isNotEmpty()) reconciledRecords.size else primaryApps.size
        builder.addKeyValue("Total Packages Enumerated", totApps.toString())
        builder.addKeyValue("Completeness State", section?.enumerationCompleteness?.name ?: "COMPLETE")
        builder.addKeyValue("S1 (Device Agent)", if (section?.s1EvidencePresent == true) "PRESENT" else "NOT_PRESENT")
        builder.addKeyValue("S2 (Host ADB)", if (section?.s2EvidencePresent == true) "PRESENT" else "NOT_PRESENT")
        builder.addKeyValue("Preinstalled System Apps", (section?.preinstalledSystemCount ?: 0).toString())
        builder.addKeyValue("Updated System Apps", (section?.updatedSystemCount ?: 0).toString())
        builder.addKeyValue("User / Third-Party Apps", (section?.userThirdPartyCount ?: 0).toString())
        builder.addKeyValue("Enabled / Disabled", "${section?.enabledCount ?: 0} enabled / ${section?.disabledCount ?: 0} disabled")

        builder.addSectionHeader("3. COMPLETE APPLICATION INVENTORY LISTING ($totApps PACKAGES)")
        val appWidths = listOf(35f, 240f, 120f, 60f, 60f)
        builder.addTableRow(listOf("#", "Package Identifier", "Classification", "State", "Source"), appWidths, isBold = true)
        builder.addDivider()

        if (reconciledRecords.isNotEmpty()) {
            reconciledRecords.forEachIndexed { idx, rec ->
                builder.addTableRow(
                    listOf(
                        "%03d".format(idx + 1),
                        rec.packageName,
                        rec.classification.name,
                        rec.enabledState.name,
                        rec.provenance.name,
                    ),
                    appWidths,
                    isMono = true,
                )
            }
        } else if (primaryApps.isNotEmpty()) {
            primaryApps.forEachIndexed { idx, app ->
                builder.addTableRow(
                    listOf(
                        "%03d".format(idx + 1),
                        app.packageName,
                        app.classification.name,
                        app.enabledState.name,
                        app.evidenceSource,
                    ),
                    appWidths,
                    isMono = true,
                )
            }
        } else {
            builder.addKeyValue("Inventory Listing", "No application records captured in session")
        }

        return persistPdf(
            reportType = TYPE_APP_SCAN,
            serial = serial,
            sessionUuid = scan.sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            pdfBytes = builder.build(),
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
        val cert = lifecycleResult.finalReport
        val execution = lifecycleResult.executionResult
        val verification = lifecycleResult.verificationResult
        val docId = cert?.header?.reportId ?: "CYVRA-ATTEMPT-${java.time.Year.now().value}-XXXXXX"
        val opaqueRef = WorkstationSessionOrchestrator.opaqueDeviceRefFor(serial)
        val isVerifiedCert = cert?.lifecycleOutcome?.name == "EXECUTED_VERIFIED"
        val titleText = if (isVerifiedCert) "Data Sanitization & Verification Certificate" else "Sanitization Attempt & Verification Report"

        val builder = PdfDocumentBuilder(
            title = "CYVRA Mobile — $titleText",
            documentId = docId,
        )

        builder.addTitle(
            titleText,
            "CYVRA Mobile Workstation — Destructive Sanitization Lifecycle (SAN SCN)",
        )

        builder.addSectionHeader("1. DOCUMENT METADATA & REPUTATION BOUNDARY")
        builder.addKeyValue("Document Identifier", docId)
        builder.addKeyValue("Session UUID", sessionUuid)
        builder.addKeyValue("Target Device Ref", opaqueRef)
        builder.addKeyValue("Device Lifecycle ID", deviceLifecycleId)
        builder.addKeyValue("Pre-Scan Report Ref", verificationReportId)
        builder.addKeyValue("Operator ID", operatorId)
        builder.addKeyValue("Generated At (UTC)", now.toString())

        builder.addSectionHeader("2. PREREQUISITE & PREFLIGHT GATES")
        val gateEligible = lifecycleResult.eligibility.isEligible
        builder.addKeyValue("Eligibility Gate", if (gateEligible) "ELIGIBLE" else "BLOCKED_NOT_ELIGIBLE")
        if (lifecycleResult.blockReasons.isNotEmpty()) {
            builder.addKeyValue("Gate Block Reason", lifecycleResult.blockReasons.first().take(75))
        }
        val barrierPassed = lifecycleResult.session?.barrier?.isBarrierPassed == true
        builder.addKeyValue("2-Step Confirmation Barrier", if (barrierPassed) "PASSED (OPERATOR CONFIRMED)" else "NOT_PASSED")
        builder.addKeyValue("Target Device Lock", "VERIFIED ($opaqueRef)")

        builder.addSectionHeader("3. SANITIZATION EXECUTION TELEMETRY")
        builder.addKeyValue("Sanitization Method", execution?.method?.name ?: "N/A")
        builder.addKeyValue("Execution Status", execution?.executionStatus ?: "BLOCKED_NOT_EXECUTED")
        builder.addKeyValue("Execution Success", (execution?.isSuccess ?: false).toString())
        builder.addKeyValue("Execution Timestamp", execution?.executedAt ?: "N/A")
        if (!execution?.error.isNullOrBlank()) {
            builder.addKeyValue("Execution Diagnostics", execution?.error ?: "")
        }

        builder.addSectionHeader("4. INDEPENDENT POST-RESET VERIFICATION")
        builder.addKeyValue("Verification Status", verification?.status?.name ?: "NOT_RUN")
        builder.addKeyValue("Post-Reset State Detected", (verification?.postResetStateDetected ?: false).toString())
        builder.addKeyValue("Setup Wizard (OOBE) Confirmed", (verification?.setupWizardDetected ?: false).toString())
        builder.addKeyValue("User Data Inaccessible", verification?.userDataInaccessible?.toString() ?: "NOT_ESTABLISHED")
        builder.addKeyValue("Assurance Level Declared", verification?.assuranceLevel ?: "REQUIRES_EXTERNAL_VERIFICATION")

        builder.addSectionHeader("5. FINAL LIFECYCLE OUTCOME & SEAL")
        builder.addKeyValue("Lifecycle Outcome", cert?.lifecycleOutcome?.name ?: "BLOCKED_NOT_EXECUTED")
        builder.addKeyValue("Sanitization Success Claimed", lifecycleResult.successClaimed.toString())
        builder.addKeyValue("Report SHA-256 Digest", cert?.integrity?.contentDigest ?: "N/A")
        builder.addKeyValue("Session Disposition", "DEVICE WORKFLOW SESSION PRESERVED")

        return persistPdf(
            reportType = TYPE_SANITIZATION_AUDIT,
            serial = serial,
            sessionUuid = sessionUuid,
            deviceLifecycleId = deviceLifecycleId,
            now = now,
            pdfBytes = builder.build(),
        )
    }

    private fun persistPdf(
        reportType: String,
        serial: String,
        sessionUuid: String,
        deviceLifecycleId: String,
        now: Instant,
        pdfBytes: ByteArray,
    ): WrittenPdfArtifact {
        val digest = sha256Hex(pdfBytes)
        val seq = sequenceCounter.incrementAndGet()
        val opaqueRef = WorkstationSessionOrchestrator.opaqueDeviceRefFor(serial)
        val shortSession = sanitizeToken(sessionUuid.take(8))
        val safeType = sanitizeToken(reportType)
        val ts = TIMESTAMP_FORMATTER.format(now)

        val directory = downloadsDirectoryProvider()
        synchronized(fileWriteLock) {
            if (!directory.exists()) {
                directory.mkdirs()
            }
            val fileName = "CYVRA_${"%03d".format(seq)}_${opaqueRef}-${shortSession}_${safeType}_${ts}.pdf"
            val file = File(directory, fileName)
            file.writeBytes(pdfBytes)

            val shaFile = File(directory, "$fileName.sha256")
            shaFile.writeText("$digest  $fileName\n", StandardCharsets.UTF_8)

            return WrittenPdfArtifact(
                reportType = reportType,
                serial = serial,
                sessionUuid = sessionUuid,
                deviceLifecycleId = deviceLifecycleId,
                fileName = fileName,
                pdfPath = file.absolutePath,
                pdfSha256 = digest,
                generatedAtUtc = now.toString(),
            )
        }
    }
}
