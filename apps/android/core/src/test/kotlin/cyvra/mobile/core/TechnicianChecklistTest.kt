package cyvra.mobile.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TechnicianChecklistTest {

    /** The 13 ids exactly as they appear in the Chief Engineer's workbook. Pinned so the
     *  catalog cannot drift from the ratified plan without a test failing. */
    private val ratifiedIds = listOf(
        "AUD-002", "BAT-007", "BAT-008", "BIO-002", "CELL-005",
        "PHY-001", "PHY-002", "PHY-003", "PHY-004", "PHY-009",
        "PHY-014", "PHY-015", "PUR-007",
    )

    @Test
    fun catalogHoldsExactlyTheThirteenRatifiedChecks() {
        assertEquals(13, TechnicianChecklistCatalog.all.size)
        assertEquals(ratifiedIds.sorted(), TechnicianChecklistCatalog.ids.sorted())
        assertEquals(13, TechnicianChecklistCatalog.ids.distinct().size, "no id may repeat")
    }

    @Test
    fun everyCheckStatesWhyNoCollectorCanEstablishIt() {
        TechnicianChecklistCatalog.all.forEach { def ->
            assertTrue(def.item.isNotBlank(), "${def.id} has no item text")
            assertTrue(def.domain.isNotBlank(), "${def.id} has no domain")
            assertTrue(
                def.whyNotAutomatable.length > 80,
                "${def.id} reason is too short to be a real justification",
            )
            assertTrue(
                def.whyNotAutomatable.contains("workbook", ignoreCase = true),
                "${def.id} does not cite the workbook boundary it is derived from",
            )
        }
    }

    @Test
    fun theSingleP0IsNandVerificationAndIsIdentifiedAsSuch() {
        assertEquals(listOf("PUR-007"), TechnicianChecklistCatalog.p0Items.map { it.id })
        val p0 = TechnicianChecklistCatalog.definitionFor("PUR-007")
        assertNotNull(p0)
        assertEquals("Sanitization", p0.domain)
    }

    @Test
    fun definitionsAreRetrievableById() {
        assertNotNull(TechnicianChecklistCatalog.definitionFor("PHY-001"))
        assertNotNull(TechnicianChecklistCatalog.definitionFor("BAT-007"))
        assertNull(TechnicianChecklistCatalog.definitionFor("PHY-999"))
    }

    /**
     * The reason this model exists at all. A technician's opinion recorded as software
     * evidence is indistinguishable from a fabrication to whoever reads the report later,
     * so attribution must survive the record being built.
     */
    @Test
    fun aTechnicianAttestationIsNeverAttributableToAMachine() {
        val result = TechnicianCheckResult(
            id = "PHY-001",
            outcome = TechnicianCheckOutcome.PASS,
            operatorId = "TECH-17",
            observedAt = "2026-10-12T18:55:00Z",
        )
        assertEquals("OPERATOR", result.source)
        assertNotEquals("ADB", result.source)
        // Fixed getter: no constructor can supply a machine plane instead.
        TechnicianCheckOutcome.entries.forEach { outcome ->
            val r = TechnicianCheckResult("PHY-002", outcome, "TECH-17", "2026-10-12T18:55:00Z")
            assertEquals("OPERATOR", r.source, "outcome $outcome must stay operator-attributed")
        }
    }

    @Test
    fun aFreshChecklistIsOpenNotClean() {
        val record = TechnicianChecklistCatalog.newRecord("SESS-001", "device-class")
        assertEquals(13, record.expectedCount)
        assertEquals(0, record.answeredCount)
        assertNull(record.completedAt, "an unanswered checklist must not carry a completion time")
        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
        assertEquals(ratifiedIds.sorted(), record.unansweredIds(TechnicianChecklistCatalog.ids).sorted())
    }

    /** A checklist left untouched must never read like one where everything passed. */
    @Test
    fun notPerformedIsDistinctFromPassAndDoesNotCompleteTheChecklist() {
        val allNotPerformed = TechnicianChecklistCatalog.ids.mapIndexed { i, id ->
            TechnicianCheckResult(id, TechnicianCheckOutcome.NOT_PERFORMED, "TECH-17", "t$i")
        }
        val record = TechnicianChecklistRecord(
            checklistId = "TECH-SESS-002",
            sessionUuid = "SESS-002",
            deviceIdentifier = "device-class",
            expectedCount = 13,
            results = allNotPerformed,
        )
        assertEquals(TechnicianCheckOutcome.NOT_PERFORMED, record.outcomeFor("PHY-001"))
        assertNotEquals(
            TechnicianCheckOutcome.PASS,
            record.outcomeFor("PHY-001"),
            "NOT_PERFORMED must never be confusable with PASS",
        )
        // Every id has a row, yet none was carried out: the checklist is still open.
        assertEquals(13, record.recordedCount)
        assertEquals(0, record.answeredCount, "NOT_PERFORMED is not an answer")
        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
        assertEquals(
            TechnicianChecklistCatalog.ids.sorted(),
            record.unansweredIds(TechnicianChecklistCatalog.ids).sorted(),
        )
    }

    @Test
    fun notApplicableCountsAsARealAnswer() {
        // A device with no microSD slot: the honest answer is NOT_APPLICABLE, not PASS.
        val results = listOf(
            TechnicianCheckResult("PHY-009", TechnicianCheckOutcome.NOT_APPLICABLE, "TECH-17", "t0"),
        )
        val record = TechnicianChecklistRecord("TECH-S", "SESS-003", "device-class", 13, results)
        assertEquals(TechnicianCheckOutcome.NOT_APPLICABLE, record.outcomeFor("PHY-009"))
        assertEquals(1, record.answeredCount)
        assertEquals(12, record.unansweredIds(TechnicianChecklistCatalog.ids).size)
        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
    }

    @Test
    fun aFullChecklistCompletesOnlyWhenEveryIdIsAnswered() {
        val results = TechnicianChecklistCatalog.ids.mapIndexed { i, id ->
            TechnicianCheckResult(id, TechnicianCheckOutcome.PASS, "TECH-17", "t$i")
        }
        val record = TechnicianChecklistRecord(
            checklistId = "TECH-SESS-004",
            sessionUuid = "SESS-004",
            deviceIdentifier = "device-class",
            expectedCount = 13,
            results = results,
            completedAt = "2026-10-12T19:10:00Z",
        )
        assertTrue(record.isComplete(TechnicianChecklistCatalog.ids))
        assertEquals(0, record.unansweredIds(TechnicianChecklistCatalog.ids).size)
        assertEquals(13, record.answeredCount)
    }

    /** An unknown id must not silently satisfy anything. */
    @Test
    fun aResultAgainstAnUnratifiedIdIsNotTreatedAsCoverage() {
        val record = TechnicianChecklistRecord(
            checklistId = "TECH-SESS-005",
            sessionUuid = "SESS-005",
            deviceIdentifier = "device-class",
            expectedCount = 13,
            results = listOf(
                TechnicianCheckResult("PHY-999", TechnicianCheckOutcome.PASS, "TECH-17", "t0"),
            ),
        )
        assertNull(record.outcomeFor("PHY-001"))
        assertEquals(13, record.unansweredIds(TechnicianChecklistCatalog.ids).size)
        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
    }

    @Test
    fun theRecordRoundTripsThroughJsonWithAttributionIntact() {
        val record = TechnicianChecklistRecord(
            checklistId = "TECH-SESS-006",
            sessionUuid = "SESS-006",
            deviceIdentifier = "device-class",
            expectedCount = 13,
            results = listOf(
                TechnicianCheckResult(
                    id = "BAT-007",
                    outcome = TechnicianCheckOutcome.DEFECT_OBSERVED,
                    operatorId = "TECH-17",
                    observedAt = "2026-10-12T19:00:00Z",
                    note = "Slight lift at the lower edge of the cell",
                ),
            ),
            completedAt = null,
        )
        val encoded = Json.encodeToString(TechnicianChecklistRecord.serializer(), record)
        val decoded = Json.decodeFromString(TechnicianChecklistRecord.serializer(), encoded)

        assertEquals("BAT-007", decoded.results.single().id)
        assertEquals(TechnicianCheckOutcome.DEFECT_OBSERVED, decoded.results.single().outcome)
        assertEquals("TECH-17", decoded.results.single().operatorId)
        assertEquals("OPERATOR", decoded.results.single().source)
        assertNull(decoded.completedAt)
        assertEquals(12, decoded.unansweredIds(TechnicianChecklistCatalog.ids).size)
    }
}
