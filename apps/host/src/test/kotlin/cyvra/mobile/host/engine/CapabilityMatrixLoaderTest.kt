package cyvra.mobile.host.engine

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Loads the real `docs/CYVRA_CAPABILITY_MATRIX_V1.md` and asserts against its actual
 * contents, so a silent edit to the matrix breaks this test rather than silently
 * changing dispatch behaviour.
 */
class CapabilityMatrixLoaderTest {

    private val loader = CapabilityMatrixLoader()

    private fun loaded(): CapabilityMatrix {
        val result = loader.load()
        assertIs<MatrixLoadResult.Loaded>(
            result,
            "matrix must load: ${(result as? MatrixLoadResult.Unusable)?.violations}",
        )
        return result.matrix
    }

    @Test
    fun loadsAllTwentyTwoDomainsInSpecOrder() {
        val matrix = loaded()
        assertEquals(22, matrix.size)
        assertEquals(
            CapabilityMatrixLoader.SPEC_21_DOMAINS,
            matrix.rows.map { it.domain },
            "rows must sit in Spec §21 order",
        )
        assertTrue(loader.isUsable)
    }

    @Test
    fun marksProvisionalVersusRatifiedItemIds() {
        val matrix = loaded()
        assertEquals("CON-001 [S]", matrix.row("Connection")!!.itemId)
        assertTrue(!matrix.row("Connection")!!.provisional, "Connection is ratified [S]")

        assertEquals("SEC-001 [P]", matrix.row("Security")!!.itemId)
        assertTrue(matrix.row("Security")!!.provisional, "a [P] id is a provisional seed")
    }

    @Test
    fun dispatchClassesMatchTheRecordedResults() {
        assertEquals(DomainStatus.EVIDENCE_BACKED, loader.statusOf("Connection"))
        assertEquals(CapabilityResult.PASS, loader.resultOf("Connection"))

        // PASS with a trailing qualifier must stay PASS — the qualifier is not the verdict.
        assertEquals(CapabilityResult.PASS, loader.resultOf("Storage"))
        assertEquals(CapabilityResult.PASS, loader.resultOf("Sensors"))
        assertEquals(CapabilityResult.CONDITIONAL, loader.resultOf("Security"))

        assertEquals(DomainStatus.RESTRICTED, loader.statusOf("Cellular"))
        assertEquals(CapabilityResult.RESTRICTED, loader.resultOf("Cellular"))

        assertEquals(DomainStatus.NOT_AVAILABLE, loader.statusOf("Performance"))
        assertEquals(DomainStatus.NOT_TESTED, loader.statusOf("Touch"))
        assertEquals(DomainStatus.NOT_TESTED, loader.statusOf("Biometrics"))

        assertEquals(
            DomainStatus.PHYSICAL_VERIFICATION_REQUIRED,
            loader.statusOf("Mechanical"),
            "software-undeterminable stays physical, never FAIL",
        )
        assertEquals(CapabilityResult.PHYSICAL_VERIFICATION_REQUIRED, loader.resultOf("Mechanical"))
    }

    @Test
    fun leadingTokenBeatsLaterQualifiers() {
        assertEquals(CapabilityResult.PASS, CapabilityResult.fromText("PASS · State 3 **NOT AVAILABLE**"))
        assertEquals(CapabilityResult.PASS, CapabilityResult.fromText("PASS · CID NOT AVAILABLE"))
        assertEquals(CapabilityResult.PASS, CapabilityResult.fromText("PASS · swelling PHYSICAL VERIFICATION REQUIRED"))
        assertEquals(CapabilityResult.NOT_TESTED, CapabilityResult.fromText("**NOT TESTED** · presence PHYSICAL VERIFICATION REQUIRED"))
        assertEquals(CapabilityResult.RESTRICTED, CapabilityResult.fromText("**RESTRICTED**"))
        assertEquals(CapabilityResult.NOT_AVAILABLE, CapabilityResult.fromText("**NOT AVAILABLE**"))
    }

    @Test
    fun tokensNeverMatchInsideAnotherToken() {
        assertNull(CapabilityToken.fromText("NOT TESTED"), "'NO' must not match inside 'NOT'")
        assertNull(CapabilityResult.fromText("PASSING"))
        assertEquals(Capability.NO, CapabilityToken.fromText("NO evidence"))
        assertEquals(Capability.YES, CapabilityToken.fromText("YES (S1/S2/emu) · NO (S3)"))
    }

    @Test
    fun readsPlanesPerRowIncludingPhysicalOnlyRows() {
        val connection = loaded().row("Connection")!!
        assertTrue(Plane.USB_PNP in connection.planes)
        assertTrue(Plane.ADB in connection.planes)

        val mechanical = loaded().row("Mechanical")!!
        assertTrue(mechanical.planes.isEmpty(), "'physical' names no software plane")

        assertTrue(Plane.COMPANION in loaded().row("Camera")!!.planes)
        assertTrue(Plane.ADB in loaded().row("Bluetooth")!!.planes)
    }

    @Test
    fun mostRestrictiveWinsAgainstAGateThatIsClosed() {
        // The matrix says YES — a closed gate must still win.
        assertEquals(Capability.YES, loader.canProbe("Connection", Plane.USB_PNP, AuthorizationState.NOT_REQUIRED))
        assertEquals(Capability.NO, loader.canProbe("Connection", Plane.USB_PNP, AuthorizationState.UNKNOWN))
        assertEquals(Capability.NO, loader.canProbe("Connection", Plane.ADB, AuthorizationState.DEBUGGING_OFF))
        assertEquals(Capability.NO, loader.canProbe("Connection", Plane.ADB, AuthorizationState.DEBUGGING_UNAUTHORIZED))
    }

    @Test
    fun refusesDomainsThatAreNotCarriedByThePlane() {
        assertEquals(Capability.NO, loader.canProbe("Storage", Plane.USB_PNP, AuthorizationState.NOT_REQUIRED))
        assertEquals(Capability.NO, loader.canProbe("Camera", Plane.ADB, AuthorizationState.SATISFIED))
        assertEquals(Capability.NO, loader.canProbe("Connection", Plane.COMPANION, AuthorizationState.SATISFIED))
    }

    @Test
    fun unknownDomainIsNoRatherThanAnException() {
        assertEquals(Capability.NO, loader.canProbe("NotADomain", Plane.ADB, AuthorizationState.SATISFIED))
        assertNull(loader.resultOf("NotADomain"))
        assertNull(loader.statusOf("NotADomain"))
    }

    @Test
    fun missingDocumentFailsClosedInsteadOfAssumingEverythingIsYes() {
        val absent = CapabilityMatrixLoader(File("definitely-not-there.md"))
        val result = absent.load()
        assertIs<MatrixLoadResult.Unusable>(result)
        assertEquals(Capability.NO, absent.canProbe("Connection", Plane.USB_PNP, AuthorizationState.NOT_REQUIRED))
    }

    @Test
    fun truncatedDocumentIsUnusableRatherThanPartiallyLoaded() {
        val source = CapabilityMatrixLoader.resolveDefaultMatrixFile()
        assertTrue(source.isFile, "expected to find $source")

        val truncated = source.readText(Charsets.UTF_8)
            .lines()
            .filterNot { it.startsWith("| 22 |") }
            .joinToString("\n")

        val result = loader.parse(truncated, "truncated")
        assertIs<MatrixLoadResult.Unusable>(result)
        assertTrue(
            result.violations.any { it.contains("expected 22 domains, found 21") },
            "expected a row-count violation, got: ${result.violations}",
        )
    }

    @Test
    fun outOfOrderDomainsAreRejected() {
        val source = CapabilityMatrixLoader.resolveDefaultMatrixFile()
        val swapped = source.readText(Charsets.UTF_8).lines().let { lines ->
            val a = lines.indexOfFirst { it.startsWith("| 1 |") }
            val b = lines.indexOfFirst { it.startsWith("| 2 |") }
            if (a < 0 || b < 0) return@let lines.joinToString("\n")
            val copy = lines.toMutableList()
            val tmp = copy[a]
            copy[a] = copy[b]
            copy[b] = tmp
            copy.joinToString("\n")
        }

        val result = loader.parse(swapped, "swapped")
        assertIs<MatrixLoadResult.Unusable>(result)
        assertTrue(
            result.violations.any { it.contains("does not match Spec §21 position") },
            "expected an ordering violation, got: ${result.violations}",
        )
    }

    @Test
    fun resolvedPathPointsAtTheGovernedDocument() {
        val file = CapabilityMatrixLoader.resolveDefaultMatrixFile()
        assertTrue(file.isFile, "matrix file must be discoverable by walking up from the working dir")
        assertEquals("CYVRA_CAPABILITY_MATRIX_V1.md", file.name)
        assertTrue(
            file.invariantSeparatorsPath.endsWith(CapabilityMatrixLoader.MATRIX_RELATIVE_PATH),
            "expected a path ending in the governed relative path, got ${file.invariantSeparatorsPath}",
        )
    }
}
