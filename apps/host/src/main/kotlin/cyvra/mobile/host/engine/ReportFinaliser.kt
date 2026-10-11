package cyvra.mobile.host.engine

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * The operator's authorisation of a report, recorded exactly as governed §6.2 requires:
 * operator, timestamp and **attestation hash**.
 *
 * [attestationDigestSha256] is the digest of the canonical normalised report the operator
 * was shown. It is the reason this record exists at all — a signature without the thing
 * that was signed proves nothing.
 */
@Serializable
data class OperatorAuthorisation(
    val operatorId: String,
    val decision: String,
    val authorisedAt: String,
    val attestationDigestSha256: String,
)

/**
 * The tamper-evident seal over a finalised report.
 *
 * [digest] covers the canonical normalised report; [authorisationDigestSha256] covers the
 * authorisation record, so the seal binds the artifact to the person who released it.
 */
@Serializable
data class ReportSeal(
    val algorithm: String = ReportFinaliser.ALGORITHM,
    val digest: String,
    val sealedAt: String,
    val authorisationDigestSha256: String,
)

/**
 * The FINAL CONTROLLED REPORT — the terminal artifact of the ratified V3 §7 chain
 * `RAW REPORT → NORMALIZE → OPERATOR AUTHORISATION → SEAL → FINAL CONTROLLED REPORT`.
 *
 * Every step of that chain is executed here, inside the .exe (M5). No web surface is
 * required to complete it.
 *
 * **What "FINAL" claims, and what it does not.** It claims only that the report was
 * normalised, authorised by a named operator and sealed. It is *not* a claim about the
 * device: every domain keeps the honest status the raw report recorded — `NOT TESTED`,
 * `NOT AVAILABLE` and `PHYSICAL VERIFICATION REQUIRED` included (Spec §82). It is not a
 * sanitization certificate, and it never reports a purge as performed.
 *
 * **On [schemaVersion].** `0011` is a *reserved* identifier whose shape is still an open
 * item (governed doc §9.4; journey §10), so no schema is invented here and the marker
 * stays exactly as the raw report carries it. Finality is carried by [authorisation] and
 * [seal], never by a version number.
 */
@Serializable
data class FinalControlledReport(
    val reportType: String = ReportFinaliser.REPORT_TYPE,
    val status: String = ReportFinaliser.STATUS_FINAL,
    /**
     * Mirrors the reserved identifier `ReportGenerator` carries.
     *
     * Spelled out rather than shared through a constant because the raw report's line is
     * a governance-held line that must keep reading `0011-DRAFT` literally. A test in
     * [ReportFinaliserTest] pins the two together so they cannot drift apart.
     */
    val schemaVersion: String = "0011-DRAFT",
    val finalisedAt: String,
    val rawReport: RawReport,
    val authorisation: OperatorAuthorisation,
    val seal: ReportSeal,
    val provenance: List<String> = emptyList(),
)

/**
 * Executes the §7 finalisation chain over a [RawReport].
 *
 * **Normalisation is deterministic and idempotent.** Running it twice changes nothing, so
 * the same report always produces the same canonical bytes and therefore the same digest.
 * That is what makes a seal worth computing: a digest over an unstable encoding would
 * differ on every re-serialisation and prove nothing.
 *
 * **The operator cannot be shown one artifact and have a different one sealed.**
 * [authorise] records the digest of exactly the normalised report it is given, and
 * [seal] must reproduce it. A mismatch is a defect, so [finalise] refuses rather than
 * sealing an artifact the operator did not see.
 *
 * **Never fabricates.** The input report is carried through untouched apart from ordering
 * and whitespace; no status is upgraded, no withheld token is rewritten (Spec §24).
 */
class ReportFinaliser(
    private val clock: () -> Instant = { Instant.now() },
) {

    /**
     * Produces the canonical form of [report].
     *
     * Only ordering and whitespace move. No value is added, removed or reworded, so the
     * normalised report says exactly what the raw one said.
     */
    fun normalise(report: RawReport): RawReport = report.copy(
        domains = report.domains.sortedBy { it.ordinal },
        restrictedStates = report.restrictedStates
            .sortedWith(compareBy({ it.domain }, { it.statusToken }, { it.source })),
        identifierRegister = report.identifierRegister.toSortedMap(),
        notes = report.notes.map { it.trim() }.filter { it.isNotEmpty() },
    )

    /**
     * Records the operator's authorisation of [report] — governed §6.2's operator,
     * timestamp and attestation hash.
     *
     * @throws IllegalArgumentException when no operator is named. An unsigned report is
     *   not an authorised one, and blank is not an identity.
     */
    fun authorise(report: RawReport, operatorId: String): OperatorAuthorisation {
        val operator = operatorId.trim()
        require(operator.isNotEmpty()) {
            "FINALISE_REPORT requires a named operator; an authorisation naming nobody proves nothing"
        }
        return OperatorAuthorisation(
            operatorId = operator,
            decision = DECISION_AUTHORISED,
            authorisedAt = clock().toString(),
            attestationDigestSha256 = digestOf(canonical(report)),
        )
    }

    /**
     * Seals the normalised [report] under [authorisation].
     *
     * The seal covers the canonical report, and separately records the digest of the
     * authorisation, so artifact and approver travel together.
     */
    fun seal(report: RawReport, authorisation: OperatorAuthorisation): ReportSeal = ReportSeal(
        digest = digestOf(canonical(report)),
        sealedAt = clock().toString(),
        authorisationDigestSha256 = digestOf(canonical(authorisation)),
    )

    /**
     * Runs the whole chain: normalise → authorise → seal → final controlled report.
     *
     * Refuses to seal when the digest the operator attested to is not the digest the seal
     * would record. That can only happen if normalisation stopped being deterministic, and
     * sealing anyway would produce a report whose seal does not match its own contents.
     */
    fun finalise(report: RawReport, operatorId: String): FinalControlledReport {
        val normalised = normalise(report)
        val authorisation = authorise(normalised, operatorId)
        val sealed = seal(normalised, authorisation)

        check(sealed.digest == authorisation.attestationDigestSha256) {
            "refusing to finalise: the sealed digest (${sealed.digest}) is not the digest " +
                "the operator attested to (${authorisation.attestationDigestSha256})"
        }

        return FinalControlledReport(
            finalisedAt = clock().toString(),
            rawReport = normalised,
            authorisation = authorisation,
            seal = sealed,
            provenance = provenance(normalised, authorisation, sealed),
        )
    }

    /** Serialises the final controlled report as pretty JSON. */
    fun toJson(report: FinalControlledReport): String = PRETTY.encodeToString(report)

    /**
     * The canonical bytes a digest is computed over.
     *
     * Compact and in declaration order, so the same value always encodes identically.
     *
     * Typed per artifact rather than taking `Any`: kotlinx has no serializer for `Any`,
     * and a digest computed through one would fail at runtime instead of at compile time.
     */
    private fun canonical(report: RawReport): String = CANONICAL.encodeToString(report)

    private fun canonical(authorisation: OperatorAuthorisation): String =
        CANONICAL.encodeToString(authorisation)

    /**
     * Writes the final controlled report as a zip of `report.json`, `PROVENANCE.txt` and
     * `SEAL.txt`.
     *
     * Provenance records versions and digests only — no absolute path, no device serial,
     * nothing machine-identifying.
     */
    fun writeZip(report: FinalControlledReport, target: File): File {
        target.parentFile?.mkdirs()
        ZipOutputStream(FileOutputStream(target)).use { zip ->
            zip.putNextEntry(ZipEntry("report.json"))
            zip.write(toJson(report).toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("PROVENANCE.txt"))
            zip.write(report.provenance.joinToString("\n").plus("\n").toByteArray(Charsets.UTF_8))
            zip.closeEntry()

            zip.putNextEntry(ZipEntry("SEAL.txt"))
            zip.write(sealText(report).toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
        return target
    }

    private fun sealText(report: FinalControlledReport): String = buildString {
        appendLine("CYVRA FINAL CONTROLLED REPORT — seal")
        appendLine("algorithm             ${report.seal.algorithm}")
        appendLine("digest                ${report.seal.digest}")
        appendLine("sealed_at             ${report.seal.sealedAt}")
        appendLine("authorisation_digest  ${report.seal.authorisationDigestSha256}")
        appendLine("verifier              recompute SHA-256 over the canonical report.json object, excluding provenance")
    }

    private fun provenance(
        report: RawReport,
        authorisation: OperatorAuthorisation,
        sealed: ReportSeal,
    ): List<String> = listOf(
        "CYVRA FINAL CONTROLLED REPORT — provenance",
        "status                FINAL — normalised, operator-authorised, sealed",
        "schema_version        ${report.schemaVersion} (reserved identifier; schema 0011 is an open item — governed §9.4, journey §10)",
        "generated_at          ${report.generatedAt}",
        "finalised_at          ${clock().toString()}",
        "operator              ${authorisation.operatorId}",
        "decision              ${authorisation.decision}",
        "authorised_at         ${authorisation.authorisedAt}",
        "seal_algorithm        ${sealed.algorithm}",
        "seal_digest           ${sealed.digest}",
        "attestation_digest    ${authorisation.attestationDigestSha256}",
        "engine_version        ${report.engineVersion}",
        "patch_set_version     ${report.patchSetVersion}",
        "patch_set_mode        ${report.patchSetMode}",
        "capability_matrix     ${report.capabilityMatrixSource}",
        "domains               ${report.domains.size}",
        "restricted_states     ${report.restrictedStates.size}",
    )

    companion object {
        const val ALGORITHM = "SHA-256"
        const val REPORT_TYPE = "CYVRA FINAL CONTROLLED REPORT"
        const val STATUS_FINAL = "FINAL"
        const val DECISION_AUTHORISED = "AUTHORISED"

        private val CANONICAL = Json { encodeDefaults = true }
        private val PRETTY = Json {
            prettyPrint = true
            encodeDefaults = true
        }

        /** Lower-case hex SHA-256 over UTF-8 bytes. */
        fun digestOf(content: String): String = MessageDigest
            .getInstance(ALGORITHM)
            .digest(content.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
