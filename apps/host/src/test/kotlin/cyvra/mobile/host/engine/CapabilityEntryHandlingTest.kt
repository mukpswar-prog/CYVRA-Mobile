package cyvra.mobile.host.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * CE-7 — the five capability-entry cases the matrix must handle distinctly.
 *
 * The production loader reads `docs/CYVRA_CAPABILITY_MATRIX_V1.md`
 * (`CapabilityMatrixLoader.MATRIX_RELATIVE_PATH`). Validation is deliberately
 * fail-closed: exactly 22 rows, in Spec §21 order, each carrying a §22 capability
 * token and a §23 result token. Any violation makes the WHOLE matrix unusable rather
 * than loading a partial view — so a malformed row can never be silently skipped
 * while the product keeps reporting its neighbours as supported.
 *
 * These cases exercise the parser directly with in-memory markdown so that a defect
 * can be reproduced without editing the governed matrix document.
 *
 * This suite grants NO authority over provisional rows. Whether a `[P]` entry may be
 * accepted as a production capability is Chief Engineer decision D-CE-26-07; until it
 * is ruled, provisional rows must stay non-authoritative.
 */
class CapabilityEntryHandlingTest {

    private val loader = CapabilityMatrixLoader()

    /** Builds a minimal in-spec matrix so mutations isolate one failure at a time. */
    private fun matrixMarkdown(
        domainOverride: ((Int, String) -> String)? = null,
        itemIdOverride: ((Int, String) -> String)? = null,
        capabilityOverride: ((Int, String) -> String)? = null,
        resultOverride: ((Int, String) -> String)? = null,
        truncateRow: Int? = null,
    ): String = buildString {
        appendLine("Status: TEST FIXTURE")
        appendLine()
        appendLine("| # | Domain | ITEM ID | Capability | Planes | Evidence Type | Result | Evidence Reference |")
        appendLine("|---|---|---|---|---|---|---|---|")
        CapabilityMatrixLoader.SPEC_21_DOMAINS.forEachIndexed { index, domain ->
            val ordinal = index + 1
            if (truncateRow == index) {
                // Seven cells, one short of MIN_COLUMNS (8), so the row is malformed.
                appendLine("| $ordinal | $domain | CON-001 [S] | YES | P1 | FIXTURE | PASS |")
                return@forEachIndexed
            }
            val name = domainOverride?.invoke(index, domain) ?: domain
            val itemId = itemIdOverride?.invoke(index, "TEST-00$ordinal [S]") ?: "TEST-00$ordinal [S]"
            val capability = capabilityOverride?.invoke(index, domain) ?: "YES"
            val result = resultOverride?.invoke(index, domain) ?: "PASS"
            appendLine("| $ordinal | $name | $itemId | $capability | P1 | FIXTURE | $result | ref |")
        }
    }

    // ---- 1. RATIFIED ---------------------------------------------------------

    /** A `[S]` row is ratified and must never be treated as provisional. */
    @Test
    fun ratifiedEntryIsNotProvisional() {
        val matrix = loader.loadedFrom(matrixMarkdown())

        val connection = matrix.row("Connection")
        assertTrue(connection != null, "Connection must resolve")
        assertFalse(connection!!.provisional, "a [S] row is ratified, not provisional")
        assertTrue(connection.itemId.endsWith("[S]"), "the report emits the marker verbatim")

        // The real governed matrix agrees: 7 ratified rows.
        val real = assertIs<MatrixLoadResult.Loaded>(loader.load()).matrix
        val ratified = real.rows.count { !it.provisional }
        assertEquals(7, ratified, "the governed matrix carries exactly 7 ratified [S] rows")
    }

    // ---- 2. PROVISIONAL ------------------------------------------------------

    /** A `[P]` row is a seed. It must be flagged so the acceptance path can refuse it. */
    @Test
    fun provisionalEntryIsFlaggedAndCarriesNoAuthority() {
        // Mark Security — Spec §21 position 3 — as provisional, exactly as the governed
        // matrix does, so the fixture exercises a real `[P]` row rather than 22 `[S]`s.
        val markdown = matrixMarkdown(itemIdOverride = { index, id ->
            if (index == 2) "SEC-001 [P]" else id
        })
        val matrix = loader.loadedFrom(markdown)

        val security = matrix.row("Security")
        assertTrue(security != null, "Security must resolve")
        assertTrue(security!!.provisional, "a [P] row is a provisional seed")
        assertEquals("SEC-001", security.rowId, "the ratification marker is status, not identity")
        assertFalse(
            matrix.row("Connection")!!.provisional,
            "a [S] row must stay non-provisional alongside a [P] neighbour",
        )

        val real = assertIs<MatrixLoadResult.Loaded>(loader.load()).matrix
        val provisional = real.rows.count { it.provisional }
        assertEquals(15, provisional, "the governed matrix carries exactly 15 provisional [P] rows")
        assertEquals(22, real.size, "22 domains in Spec §21 order")
    }

    // ---- 3. UNSUPPORTED ------------------------------------------------------

    /** A `NO` capability must survive parsing as unsupported, not be coerced to support. */
    @Test
    fun unsupportedEntryStaysUnsupported() {
        val markdown = matrixMarkdown(capabilityOverride = { index, _ ->
            if (index == 0) "NO" else "YES"
        })
        val matrix = loader.loadedFrom(markdown)

        assertEquals(Capability.NO, matrix.row("Connection")!!.capability, "an explicit NO is unsupported")
        assertEquals(Capability.YES, matrix.row("Identity")!!.capability, "other rows are unaffected")

        // Unsupported is a CAPABILITY-level fact, not a result-level one. The row may
        // still carry PASS evidence; `NO` says the capability is simply not offered.
        // Collapsing the two would let a well-evidenced "we do not do this" read as
        // "we do not know".
        assertEquals(
            DomainStatus.EVIDENCE_BACKED,
            matrix.row("Connection")!!.status,
            "an explicit NO must stay a capability-level refusal, not an evidence-level unknown",
        )
        assertEquals(
            CapabilityResult.PASS,
            matrix.row("Connection")!!.result,
            "the row's own evidence result is unaffected by the capability being withheld",
        )
    }

    // ---- 4. MALFORMED --------------------------------------------------------

    /** A short row must make the whole matrix unusable, never a partial load. */
    @Test
    fun malformedRowRejectsTheWholeMatrixRatherThanLoadingPartially() {
        val result = loader.parse(matrixMarkdown(truncateRow = 3), "fixture.md")

        val unusable = assertIs<MatrixLoadResult.Unusable>(result, "a short row must fail closed")
        assertTrue(
            unusable.violations.any { it.contains("columns") },
            "the violation must name the column-count defect, got: ${unusable.violations}",
        )
        assertTrue(
            unusable.violations.any { it.contains("22 domains") },
            "a skipped row must also surface the domain-count shortfall, got: ${unusable.violations}",
        )
        // The fail-closed property is that NO matrix comes back at all. There is no
        // partial result to accept by mistake, and no `Loaded` to fall through to.
        assertNull(
            (result as? MatrixLoadResult.Loaded)?.matrix,
            "a document with a malformed row must never yield a matrix",
        )
    }

    // ---- 5. UNKNOWN ----------------------------------------------------------

    /** An unrecognised §23 result token is unknown, and unknown must fail closed. */
    @Test
    fun unknownResultTokenIsRejectedAsUnusable() {
        val markdown = matrixMarkdown(resultOverride = { index, _ ->
            if (index == 0) "TOTALLY_UNRECOGNISED" else "PASS"
        })
        val result = loader.parse(markdown, "fixture.md")

        val unusable = assertIs<MatrixLoadResult.Unusable>(result, "an unknown token must fail closed")
        assertTrue(
            unusable.violations.any { it.contains("result token") },
            "the violation must name the bad result token, got: ${unusable.violations}",
        )
    }

    /** A domain outside Spec §21 order is unknown and must fail closed. */
    @Test
    fun unknownDomainOutsideSpecOrderIsRejected() {
        val markdown = matrixMarkdown(domainOverride = { index, domain ->
            if (index == 5) "Imaginary Domain" else domain
        })
        val result = loader.parse(markdown, "fixture.md")

        val unusable = assertIs<MatrixLoadResult.Unusable>(result, "an out-of-spec domain must fail closed")
        assertTrue(
            unusable.violations.any { it.contains("Spec §21 position") },
            "the violation must name the ordering defect, got: ${unusable.violations}",
        )
    }

    /** `UNKNOWN` is a real §23 token and behaves as *closed*, never as "probably fine". */
    @Test
    fun unknownResultTokenIsClosedNotPermissive() {
        val markdown = matrixMarkdown(resultOverride = { index, _ ->
            if (index == 0) "UNKNOWN" else "PASS"
        })
        val matrix = loader.loadedFrom(markdown)

        val connection = matrix.row("Connection")!!
        assertEquals(CapabilityResult.UNKNOWN, connection.result)

        // `DomainStatus.of` folds FAIL, ERROR and UNKNOWN into ERROR, deliberately kept
        // apart from NOT_TESTED so nothing is softened. The property that matters is
        // that UNKNOWN can never land in the evidence-backed bucket.
        assertEquals(DomainStatus.ERROR, connection.status, "UNKNOWN must fold to ERROR, never soften")
        assertTrue(
            connection.status != DomainStatus.EVIDENCE_BACKED,
            "an UNKNOWN result must never read as evidence-backed",
        )
    }

    // ---- shared --------------------------------------------------------------

    private fun CapabilityMatrixLoader.loadedFrom(markdown: String): CapabilityMatrix {
        val result = parse(markdown, "fixture.md")
        return assertIs<MatrixLoadResult.Loaded>(
            result,
            "fixture must parse: ${(result as? MatrixLoadResult.Unusable)?.violations}",
        ).matrix
    }

    /**
     * The governed matrix must still load through the production path. Everything
     * else here is meaningless if `load()` cannot resolve the real document, and this
     * also guards the count assertions above against a silent edit to the matrix.
     */
    @Test
    fun governedMatrixLoadsThroughTheProductionPath() {
        val result = loader.load()
        val matrix = assertIs<MatrixLoadResult.Loaded>(
            result,
            "the governed matrix must load: ${(result as? MatrixLoadResult.Unusable)?.violations}",
        ).matrix

        assertEquals(22, matrix.size)
        assertTrue(loader.isUsable)
        assertEquals(15, matrix.rows.count { it.provisional }, "15 [P] seeds")
        assertEquals(7, matrix.rows.count { !it.provisional }, "7 [S] ratified rows")
    }

    /**
     * `parse` is a pure function over markdown: it reports unusable rather than
     * returning a partial matrix. It deliberately does NOT poison the receiver —
     * `load()` still resolves the governed document independently, so a caller cannot
     * make the shipped matrix disappear by parsing bad text. What must never happen is
     * a partial load being returned from a document that failed validation.
     */
    @Test
    fun aDocumentThatFailsValidationNeverYieldsAPartialMatrix() {
        val headerless = loader.parse("| 1 | Short |", "fixture.md")
        val unusable = assertIs<MatrixLoadResult.Unusable>(
            headerless,
            "a header-less document must be unusable",
        )
        assertTrue(unusable.reason.contains("header"), "the reason must name the missing header")

        // The governed matrix is unaffected by parsing bad text beside it.
        assertIs<MatrixLoadResult.Loaded>(
            loader.load(),
            "parsing an unusable document must not disturb the governed matrix",
        )
    }
}
