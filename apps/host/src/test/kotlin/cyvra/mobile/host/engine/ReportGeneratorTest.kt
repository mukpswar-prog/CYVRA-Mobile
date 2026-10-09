package cyvra.mobile.host.engine

import cyvra.mobile.host.transport.ProbeOutcome
import cyvra.mobile.host.transport.ProbeResult
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipFile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReportGeneratorTest {

    private val loader = CapabilityMatrixLoader()
    private val generator = ReportGenerator(loader, engineVersion = "1.0.0")

    @Test
    fun emitsEveryDomainFromTheMatrixEvenWithNoProbeResults() {
        val report = generator.generate()

        assertEquals(22, report.domains.size)
        assertEquals(
            CapabilityMatrixLoader.SPEC_21_DOMAINS,
            report.domains.map { it.domain },
        )
        // Nothing was observed, so nothing is claimed as observed.
        assertEquals(CapabilityResult.PASS, report.domains.first().result)
        assertTrue(report.domains.all { it.outcome == null }, "unobserved domains carry no outcome")
    }

    @Test
    fun neverUpgradesARecordedResultWithoutAnObservation() {
        val report = generator.generate()

        fun resultOf(domain: String) = report.domains.first { it.domain == domain }.result

        assertEquals(CapabilityResult.RESTRICTED, resultOf("Cellular"))
        assertEquals(CapabilityResult.NOT_AVAILABLE, resultOf("Performance"))
        assertEquals(CapabilityResult.NOT_TESTED, resultOf("Touch"))
        assertEquals(
            CapabilityResult.PHYSICAL_VERIFICATION_REQUIRED,
            resultOf("Mechanical"),
        )
        assertTrue(report.domains.none { it.result == CapabilityResult.FAIL }, "no fabricated FAIL")
    }

    @Test
    fun recordsEveryVersionFieldNeededForReproducibility() {
        val report = generator.generate(
            patchSet = PatchSetState(
                version = "2026.10.09-1",
                mode = PatchSetMode.SIGNED_CURRENT,
            ),
        )

        assertEquals("1.0.0", report.engineVersion)
        assertEquals("2026.10.09-1", report.patchSetVersion)
        assertEquals("SIGNED-CURRENT", report.patchSetMode)
        assertTrue(report.capabilityMatrixVersion.contains("v1 SEED"), report.capabilityMatrixVersion)
        assertEquals(
            CapabilityMatrixLoader.MATRIX_RELATIVE_PATH,
            report.capabilityMatrixSource,
            "the source is recorded as a relative path, never a workstation path",
        )
    }

    @Test
    fun emptyPatchSetIsAnHonestReportableState() {
        val report = generator.generate()
        assertEquals("NO-PATCHES", report.patchSetVersion)
        assertEquals("NO-PATCHES", report.patchSetMode)
        assertEquals(PatchSetState.EMPTY_SET_HASH, report.patchSetHash)
        assertEquals(0, report.appliedPatchCount)
        assertTrue(report.patchSetHash.isNotBlank(), "no report field may be blank")
    }

    @Test
    fun identifierRegisterIsStatusTokensOnly() {
        val register = ReportGenerator.IDENTIFIER_REGISTER
        assertEquals(9, register.size)
        assertTrue(register.values.all { it.isNotBlank() }, "a register entry must never be blank")
        assertEquals("NOT COLLECTED", register["imei"])
        assertEquals("NOT COLLECTED", register["device_serial"])
        assertEquals("RESTRICTED", register["data_data_contents"])
        assertEquals("RESTRICTED", register["non_interactive_reset"])
        assertTrue(register.keys.none { it.contains("value") }, "keys are classes, not values")
    }

    @Test
    fun scrubsIdentifierShapedLiteralsThatArriveFromProbeResults() {
        val observed = ProbeResult(
            domain = "Identity",
            plane = cyvra.mobile.host.engine.Plane.ADB,
            outcome = ProbeOutcome.SUCCESS,
            result = CapabilityResult.PASS,
            reasonCode = "ADB_OBSERVATION_OK",
            capability = Capability.YES,
            evidenceReference = "P3-getprop 351234567890123 and 00:11:22:33:44:55",
        )
        val report = generator.generate(listOf(observed))

        val json = generator.toJson(report)
        assertTrue(!json.contains("351234567890123"), "an IMEI-shaped literal must be scrubbed")
        assertTrue(!json.contains("00:11:22:33:44:55"), "a MAC-shaped literal must be scrubbed")
        assertTrue(json.contains("[NOT COLLECTED]"), "scrubbed to a status token, never a blank")
    }

    @Test
    fun recordsRestrictedStatesVerbatim() {
        val report = generator.generate()
        val cellular = report.restrictedStates.first { it.domain == "Cellular" }
        assertEquals("RESTRICTED", cellular.statusToken)
        assertTrue(report.restrictedStates.none { it.statusToken.isBlank() })
        assertTrue(report.restrictedStates.none { it.domain.isBlank() })
    }

    @Test
    fun zipCarriesReportAndProvenanceWithoutLocalPaths() {
        val target = Files.createTempDirectory("cyvra-report").resolve("raw-report.zip").toFile()
        try {
            val report = generator.generate()
            generator.writeZip(report, target)
            assertTrue(target.isFile && target.length() > 0)

            ZipFile(target).use { zip ->
                val names = zip.entries().toList().map { it.name }.toSet()
                assertTrue("report.json" in names, "got $names")
                assertTrue("PROVENANCE.txt" in names, "got $names")

                val provenance = zip.getInputStream(zip.getEntry("PROVENANCE.txt"))
                    .readBytes().toString(Charsets.UTF_8)
                assertTrue(provenance.contains("engine_version"), provenance)
                assertTrue(provenance.contains("capability_matrix"), provenance)
                assertTrue(!provenance.contains("C:\\"), "no workstation path may egress")
                assertTrue(provenance.contains("not normalised"), "status must be declared RAW")
            }
        } finally {
            target.delete()
        }
    }

    @Test
    fun unusableMatrixStillProducesAnHonestReportRatherThanNone() {
        val broken = ReportGenerator(CapabilityMatrixLoader(File("no-such-matrix.md")), "1.0.0")
        val report = broken.generate()

        assertTrue(report.domains.isEmpty(), "no rows means no claimed rows")
        assertTrue(
            report.notes.any { it.startsWith("MATRIX_UNUSABLE") },
            "the failure is declared, not hidden: ${report.notes}",
        )
        assertTrue(report.capabilityMatrixVersion == "UNAVAILABLE")
        assertEquals("1.0.0", report.engineVersion, "versioning survives a matrix failure")
    }
}
