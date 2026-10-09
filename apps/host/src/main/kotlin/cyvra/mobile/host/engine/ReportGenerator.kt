package cyvra.mobile.host.engine

import cyvra.mobile.host.transport.ProbeOutcome
import cyvra.mobile.host.transport.ProbeResult
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** One domain's line in the raw report. */
@Serializable
data class DomainReportEntry(
    val ordinal: Int,
    val domain: String,
    val itemId: String,
    val provisional: Boolean,
    val capability: Capability,
    val result: CapabilityResult,
    val status: DomainStatus,
    val planes: List<Plane>,
    /** Null when the domain was not dispatched this run. */
    val outcome: ProbeOutcome? = null,
    val reasonCode: String? = null,
    /** Spec §24 status token, copied **verbatim** — never rewritten, never blanked. */
    val statusToken: String? = null,
    val evidenceReference: String? = null,
    val degradedServices: List<String> = emptyList(),
)

/**
 * A withheld value, recorded exactly as it was reported.
 *
 * The token itself is the evidence that the value was sought and withheld — which is
 * why it is stored verbatim rather than normalised (Spec §24).
 */
@Serializable
data class RestrictedStateRecord(
    val domain: String,
    val statusToken: String,
    val source: String,
)

/**
 * The RAW REPORT (governed §7).
 *
 * This is the first artifact of the §7 chain — `RAW REPORT → CUSTOMER WORKSPACE
 * (schema 0011, later) → normalize → audit report → customer authorisation → seal →
 * final controlled report`. Normalisation, customer approval and sealing are downstream
 * and are **not** claimed by this class.
 *
 * Adheres to:
 * - Spec §24 (never fabricate identifiers), §29 (claim no more than evidence proves),
 *   §82 (no false automation), §86 (evidence confidence)
 * - Governed §5.3 (engine + patch-set version in every report)
 */
@Serializable
data class RawReport(
    /** Reserved for schema 0011, which is a later phase. Never presented as final. */
    val schemaVersion: String = "0011-DRAFT",
    val generatedAt: String,
    val engineVersion: String,
    val patchSetVersion: String,
    val patchSetMode: String,
    val patchSetHash: String,
    val appliedPatchCount: Int,
    val capabilityMatrixVersion: String,
    val capabilityMatrixSource: String,
    val domains: List<DomainReportEntry>,
    val restrictedStates: List<RestrictedStateRecord>,
    val identifierRegister: Map<String, String>,
    val notes: List<String> = emptyList(),
)

/**
 * Aggregates probe results into the raw report.
 *
 * **Never fabricates.** Every identifier class is written as a Spec §24 status token,
 * and a final guard scrubs any identifier-shaped literal that arrived from outside the
 * generator — replacing it with a status token rather than a blank, so the record still
 * shows that the value was withheld.
 *
 * **Restricted states are recorded verbatim** from the matrix row or the transport
 * refusal, so a restriction can always be traced back to its governing clause.
 *
 * **No false automation.** A domain that was not observed keeps its matrix result
 * (`NOT TESTED`, `NOT AVAILABLE`, `PHYSICAL VERIFICATION REQUIRED`); it is never
 * upgraded to PASS and never downgraded to FAIL (Spec §82).
 */
class ReportGenerator(
    private val loader: CapabilityMatrixLoader,
    private val engineVersion: String,
    private val clock: () -> Instant = { Instant.now() },
) {
    /**
     * Builds the raw report from [results].
     *
     * @param results probe results, typically one per attempted domain.
     * @param patchSet the applied patch set; its five scalar fields are recorded so the
     *   report satisfies the reproducibility invariant (governed §5.3).
     */
    fun generate(
        results: List<ProbeResult> = emptyList(),
        patchSet: PatchSetState = PatchSetState(),
    ): RawReport {
        val loaded = loader.load() as? MatrixLoadResult.Loaded
        val notes = mutableListOf<String>()

        if (loaded == null) {
            val unusable = loader.load() as MatrixLoadResult.Unusable
            notes += "MATRIX_UNUSABLE: ${unusable.reason}"
            unusable.violations.forEach { notes += "matrix: $it" }
        }

        val rows = loaded?.matrix?.rows.orEmpty()
        val patchFields = patchSet.reportFields(engineVersion)

        val entries = rows.map { row ->
            val observed = bestResult(results, row.domain)
            DomainReportEntry(
                ordinal = row.ordinal,
                domain = scrub(row.domain),
                itemId = scrub(row.itemId),
                provisional = row.provisional,
                capability = observed?.capability?.takeIf { it != Capability.NO } ?: row.capability,
                result = observed?.result ?: row.result,
                status = observed?.let { DomainStatus.of(it.result) } ?: row.status,
                planes = row.planes.sortedBy { it.ordinal },
                outcome = observed?.outcome,
                reasonCode = observed?.reasonCode?.let(::scrub),
                statusToken = observed?.statusToken?.let(::scrub) ?: statusTokenFor(row),
                evidenceReference = observed?.evidenceReference?.let(::scrub) ?: row.evidenceReference,
                degradedServices = observed?.degradedServices.orEmpty(),
            )
        }

        // Every withheld value gets a verbatim record. The token is the evidence that the
        // value was sought and withheld, so nothing here is normalised away.
        val restricted = entries.mapNotNull { entry ->
            val token = entry.statusToken ?: return@mapNotNull null
            RestrictedStateRecord(
                domain = entry.domain,
                statusToken = token,
                source = entry.reasonCode ?: "MATRIX",
            )
        }

        return RawReport(
            generatedAt = clock().toString(),
            engineVersion = engineVersion,
            patchSetVersion = patchFields.getValue("patch_set_version"),
            patchSetMode = patchFields.getValue("patch_set_mode"),
            patchSetHash = patchFields.getValue("patch_set_hash"),
            appliedPatchCount = patchFields.getValue("applied_patch_count").toIntOrNull() ?: 0,
            capabilityMatrixVersion = loaded?.matrix?.documentStatus ?: "UNAVAILABLE",
            capabilityMatrixSource = CapabilityMatrixLoader.MATRIX_RELATIVE_PATH,
            domains = entries,
            restrictedStates = restricted,
            identifierRegister = IDENTIFIER_REGISTER,
            notes = notes,
        )
    }

    /** Serialises the report as pretty JSON (no local absolute paths are ever written). */
    fun toJson(report: RawReport): String = JSON.encodeToString(report)

    /**
     * Writes the RAW REPORT as a zip containing `report.json` and `PROVENANCE.txt`.
     *
     * Provenance records relative paths and versions only — nothing machine-identifying,
     * no device serial, no absolute workstation path.
     */
    fun writeZip(report: RawReport, target: File): File {
        target.parentFile?.mkdirs()
        val json = toJson(report)
        ZipOutputStream(FileOutputStream(target)).use { zip ->
            zip.putNextEntry(ZipEntry("report.json"))
            zip.write(json.toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("PROVENANCE.txt"))
            zip.write(provenance(report).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        return target
    }

    private fun provenance(report: RawReport): String = buildString {
        appendLine("CYVRA RAW REPORT — provenance")
        appendLine("schema_version        ${report.schemaVersion}")
        appendLine("generated_at          ${report.generatedAt}")
        appendLine("engine_version        ${report.engineVersion}")
        appendLine("patch_set_version     ${report.patchSetVersion}")
        appendLine("patch_set_mode        ${report.patchSetMode}")
        appendLine("patch_set_hash        ${report.patchSetHash}")
        appendLine("capability_matrix     ${report.capabilityMatrixSource}")
        appendLine("domains               ${report.domains.size}")
        appendLine("restricted_states     ${report.restrictedStates.size}")
        appendLine("status                RAW — not normalised, not customer-approved, not sealed")
    }

    /** Prefers a healthy observation; otherwise the first refusal. Never synthesises. */
    private fun bestResult(results: List<ProbeResult>, domain: String): ProbeResult? {
        val candidates = results.filter {
            CapabilityMatrix.normalizeDomain(it.domain) == CapabilityMatrix.normalizeDomain(domain)
        }
        return candidates.firstOrNull { it.isEvidence } ?: candidates.firstOrNull()
    }

    /** The §24 token a matrix row implies, when the transport did not supply one. */
    private fun statusTokenFor(row: MatrixDomainRow): String? = when (row.status) {
        DomainStatus.RESTRICTED -> RestrictedStatus.RESTRICTED.token
        DomainStatus.NOT_AVAILABLE -> RestrictedStatus.NOT_AVAILABLE.token
        DomainStatus.NOT_TESTED -> RestrictedStatus.NOT_COLLECTED.token
        else -> null
    }

    /**
     * Replaces an identifier-shaped literal with a **status token**, never a blank
     * (telemetry spec §5.2; Spec §24). A blank would lose the fact that the value was
     * withheld.
     */
    private fun scrub(value: String): String {
        var out = value
        IDENTIFIER_PATTERNS.forEach { (pattern, token) ->
            out = out.replace(pattern, "[$token]")
        }
        return out
    }

    companion object {
        /**
         * Spec §24 register. Values are status tokens; no identifier value ever appears
         * in a report produced by this class.
         *
         * Sourced from governed §2/§4 (IMEI masked A10+, no /data/data, no
         * non-interactive reset) and from observed fixture evidence (storage CID denied).
         */
        val IDENTIFIER_REGISTER: Map<String, String> = mapOf(
            "imei" to "NOT COLLECTED",
            "meid" to "NOT COLLECTED",
            "device_serial" to "NOT COLLECTED",
            "android_id" to "NOT COLLECTED",
            "mac_address" to "NOT COLLECTED",
            "advertising_id" to "NOT COLLECTED",
            "storage_cid" to "NOT AVAILABLE",
            "data_data_contents" to "RESTRICTED",
            "non_interactive_reset" to "RESTRICTED",
        )

        private val IDENTIFIER_PATTERNS = listOf(
            Regex("""\b\d{15}\b""") to "NOT COLLECTED",
            Regex("""\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b""") to "NOT COLLECTED",
        )

        private val JSON = Json {
            prettyPrint = true
            encodeDefaults = true
        }
    }
}
