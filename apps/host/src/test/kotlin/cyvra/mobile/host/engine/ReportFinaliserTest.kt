package cyvra.mobile.host.engine

import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.zip.ZipFile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Proves the §7 finalisation chain does what it claims — nothing more.
 *
 * These are tests of the *code*. They are not evidence that the feature works on an
 * installed workstation; that is a separate proof, taken on the built `.exe`.
 */
class ReportFinaliserTest {

    private val fixedClock = { Instant.parse("2026-10-11T12:00:00Z") }
    private val finaliser = ReportFinaliser(fixedClock)
    private val raw = ReportGenerator(CapabilityMatrixLoader(), engineVersion = "1.0.0").generate()

    @Test
    fun normalisingTwiceChangesNothingSoTheEncodingIsStable() {
        val once = finaliser.normalise(raw)
        val twice = finaliser.normalise(once)

        assertEquals(once, twice, "normalisation must be idempotent")
    }

    @Test
    fun normalisingOnlyMovesOrderingNeverAValue() {
        val shuffled = raw.copy(domains = raw.domains.reversed())

        val normalised = finaliser.normalise(shuffled)

        assertEquals(
            raw.domains.associate { it.domain to (it.result to it.statusToken) },
            normalised.domains.associate { it.domain to (it.result to it.statusToken) },
            "every domain keeps the result and status token it arrived with",
        )
        assertEquals(
            raw.domains.map { it.ordinal },
            normalised.domains.map { it.ordinal }.sorted(),
            "domains come out ordered by ordinal",
        )
    }

    @Test
    fun theSealCoversExactlyWhatTheOperatorAttestedTo() {
        val authorised = finaliser.authorise(finaliser.normalise(raw), "OPERATOR-01")
        val sealed = finaliser.seal(finaliser.normalise(raw), authorised)

        assertEquals(
            authorised.attestationDigestSha256,
            sealed.digest,
            "an operator shown one artifact must never have a different one sealed",
        )
    }

    @Test
    fun theSameReportFinalisesToTheSameDigestHoweverManyTimes() {
        val first = finaliser.finalise(raw, "OPERATOR-01")
        val second = finaliser.finalise(raw, "OPERATOR-02")

        assertEquals(
            first.seal.digest,
            second.seal.digest,
            "the digest covers the report, not the clock or the operator",
        )
        assertEquals(
            first.seal.digest,
            second.authorisation.attestationDigestSha256,
            "both runs attest to the digest they sealed",
        )
        assertNotEquals(
            first.authorisation.operatorId,
            second.authorisation.operatorId,
            "the two runs are still distinguishable by who signed them",
        )
    }

    @Test
    fun aReportWithNoNamedOperatorIsRefusedRatherThanSealed() {
        val failure = assertFailsWith<IllegalArgumentException> {
            finaliser.finalise(raw, "   ")
        }

        assertTrue(
            failure.message.orEmpty().contains("named operator"),
            "the refusal must say what was missing, got: ${failure.message}",
        )
    }

    @Test
    fun finalisingNeverUpgradesAnUnobservedDomain() {
        val report = finaliser.finalise(raw, "OPERATOR-01")

        assertEquals(
            raw.domains.associate { it.domain to it.result },
            report.rawReport.domains.associate { it.domain to it.result },
            "an unobserved domain keeps its matrix result; finalising is not an observation",
        )
        assertTrue(
            report.rawReport.domains.none { it.outcome != null },
            "nothing is claimed as observed that the scan did not observe",
        )
    }

    @Test
    fun withheldStatesSurviveVerbatimRatherThanBeingNormalisedAway() {
        val report = finaliser.finalise(raw, "OPERATOR-01")

        assertEquals(
            raw.restrictedStates.map { it.statusToken }.sorted(),
            report.rawReport.restrictedStates.map { it.statusToken }.sorted(),
            "the token is the evidence the value was withheld (Spec 24)",
        )
        assertEquals(
            raw.restrictedStates.size,
            report.rawReport.restrictedStates.size,
            "no withheld record is dropped by normalisation",
        )
    }

    @Test
    fun theIdentifierRegisterKeepsEveryClassItDeclares() {
        val report = finaliser.finalise(raw, "OPERATOR-01")

        assertEquals(
            ReportGenerator.IDENTIFIER_REGISTER,
            report.rawReport.identifierRegister,
            "sorting must reorder the register, never lose a class from it",
        )
    }

    @Test
    fun provenanceStatesFinalAndExplainsTheReservedSchemaHonestly() {
        val report = finaliser.finalise(raw, "OPERATOR-01")
        val text = report.provenance.joinToString("\n")

        assertTrue(text.contains("FINAL"), "provenance must state the artifact is final")
        assertTrue(
            text.contains("normalised, operator-authorised, sealed"),
            "provenance must say what finality was made of",
        )
        assertTrue(
            text.contains("0011-DRAFT"),
            "the reserved schema identifier must be echoed, not silently dropped",
        )
        assertTrue(
            text.contains("open item"),
            "provenance must disclose that schema 0011 is still undesigned",
        )
        assertTrue(
            report.seal.digest in text && report.seal.sealedAt in text,
            "the seal must be reproduced in provenance",
        )
        assertTrue(
            report.authorisation.operatorId in text,
            "the operator who authorised must be named",
        )
    }

    @Test
    fun theFinalReportMirrorsTheReservedSchemaTheRawReportCarries() {
        val report = finaliser.finalise(raw, "OPERATOR-01")

        assertEquals(
            raw.schemaVersion,
            report.schemaVersion,
            "the final report must carry the same reserved identifier the raw report does",
        )
        assertEquals(
            "0011-DRAFT",
            report.schemaVersion,
            "schema 0011 is still an open item (governed 9.4; journey 10), so it stays a DRAFT reservation",
        )
    }

    @Test
    fun provenanceCarriesNoAbsoluteWorkstationPath() {
        val report = finaliser.finalise(raw, "OPERATOR-01")

        assertTrue(
            report.provenance.none { it.contains(File.separator) && it.contains(":") },
            "provenance records versions and digests only",
        )
    }

    @Test
    fun theArchivedArtifactCarriesTheReportItsProvenanceAndItsSeal() {
        val report = finaliser.finalise(raw, "OPERATOR-01")
        val target = Files.createTempDirectory("cyvra-fcr").resolve("report.zip").toFile()

        try {
            finaliser.writeZip(report, target)

            ZipFile(target).use { zip ->
                val names = zip.entries().asSequence().map { it.name }.toSet()
                assertTrue(
                    setOf("report.json", "PROVENANCE.txt", "SEAL.txt").all { it in names },
                    "expected all three entries, got $names",
                )
                val sealText = zip.getInputStream(zip.getEntry("SEAL.txt"))
                    .bufferedReader().readText()
                assertTrue(
                    report.seal.digest in sealText,
                    "the archive must carry the digest an operator can recompute",
                )
            }
        } finally {
            target.delete()
        }
    }

    @Test
    fun aChangedReportProducesADifferentDigestSoTamperingIsDetectable() {
        val original = finaliser.finalise(raw, "OPERATOR-01")
        val tampered = finaliser.finalise(
            raw.copy(engineVersion = "9.9.9"),
            "OPERATOR-01",
        )

        assertNotEquals(
            original.seal.digest,
            tampered.seal.digest,
            "an altered report must not produce the digest it was sealed with",
        )
    }
}
