package cyvra.mobile.host.protocol

import cyvra.mobile.core.TechnicianCheckOutcome
import cyvra.mobile.core.TechnicianChecklistCatalog
import cyvra.mobile.core.TechnicianChecklistRecord
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Tests for the object that owns every checklist invariant.
 *
 * These run without a scan, without ADB and without a device. That is the reason this
 * object exists in this shape: the rules that stop a fabricated or half-finished
 * checklist from looking like a real one would otherwise be reachable only through a
 * completed scan, and a rule no test can reach is a rule that erodes quietly.
 */
class ChecklistRecorderTest {

    private val stamped = "2026-10-14T17:00:00Z"

    private fun rows(vararg pairs: Pair<String, String>): JsonArray = JsonArray(
        pairs.map { (id, outcome) ->
            buildJsonObject {
                put("id", id)
                put("outcome", outcome)
            }
        },
    )

    private fun allAnswered(outcome: TechnicianCheckOutcome = TechnicianCheckOutcome.PASS): JsonArray =
        JsonArray(
            TechnicianChecklistCatalog.ids.map { id ->
                buildJsonObject {
                    put("id", id)
                    put("outcome", outcome.name)
                }
            },
        )

    private fun submit(
        existing: TechnicianChecklistRecord? = null,
        results: JsonArray,
        operatorId: String = "TECH-17",
        sessionUuid: String = "SESS-001",
        deviceIdentifier: String = "Samsung SM-A107F",
    ): ChecklistSubmission = ChecklistRecorder.apply(
        existing = existing,
        results = results,
        operatorId = operatorId,
        sessionUuid = sessionUuid,
        deviceIdentifier = deviceIdentifier,
        recordedAt = stamped,
    )

    private fun acceptedOf(submission: ChecklistSubmission): TechnicianChecklistRecord =
        (submission as? ChecklistSubmission.Accepted)?.record
            ?: fail("expected Accepted, got $submission")

    private fun rejectedCode(submission: ChecklistSubmission): String =
        (submission as? ChecklistSubmission.Rejected)?.code
            ?: fail("expected Rejected, got $submission")

    // ---- the catalog these rules apply to -------------------------------------

    @Test
    fun `the ratified checklist holds exactly fourteen checks`() {
        assertEquals(14, TechnicianChecklistCatalog.expectedCount)
        assertEquals(14, TechnicianChecklistCatalog.ids.size)
        assertEquals(14, TechnicianChecklistCatalog.all.size)
        assertEquals(TechnicianChecklistCatalog.ids.size, TechnicianChecklistCatalog.ids.toSet().size)
    }

    @Test
    fun `every outcome the vocabulary allows is one of the ratified four`() {
        assertEquals(
            setOf("PASS", "DEFECT_OBSERVED", "NOT_APPLICABLE", "NOT_PERFORMED"),
            TechnicianCheckOutcome.entries.map { it.name }.toSet(),
        )
    }

    // ---- refusals -------------------------------------------------------------

    @Test
    fun `an id the workbook never ratified is refused, not dropped`() {
        val rejection = submit(results = rows("PHY-999" to "PASS"))
        assertEquals("CHECKLIST_UNKNOWN_ID", rejectedCode(rejection))
    }

    @Test
    fun `a missing id is refused rather than recorded as something`() {
        val result = JsonArray(listOf(buildJsonObject { put("outcome", "PASS") }))
        assertEquals("CHECKLIST_UNKNOWN_ID", rejectedCode(submit(results = result)))
    }

    @Test
    fun `an outcome outside the ratified vocabulary is refused`() {
        val rejection = submit(results = rows("PHY-001" to "PROBABLY_FINE"))
        assertEquals("CHECKLIST_UNKNOWN_OUTCOME", rejectedCode(rejection))
    }

    @Test
    fun `an empty submission records nothing`() {
        assertEquals(
            "CHECKLIST_RESULTS_EMPTY",
            rejectedCode(submit(results = JsonArray(emptyList()))),
        )
    }

    @Test
    fun `an attestation with no author is refused`() {
        assertEquals(
            "CHECKLIST_OPERATOR_REQUIRED",
            rejectedCode(submit(results = rows("PHY-001" to "PASS"), operatorId = "   ")),
        )
    }

    @Test
    fun `a result that is not an object is refused with the shared code`() {
        val malformed = JsonArray(listOf(JsonPrimitive("PHY-001")))
        val rejection = submit(results = malformed)
        assertEquals(ChecklistRecorder.malformed.code, rejectedCode(rejection))
    }

    @Test
    fun `one bad row in an otherwise good submission refuses the whole submission`() {
        // Not partially accepted: silently keeping the good rows would make the record
        // look worked when part of it was never accepted.
        val rejection = submit(
            results = rows("PHY-001" to "PASS", "NOT-A-REAL-ID" to "PASS"),
        )
        assertEquals("CHECKLIST_UNKNOWN_ID", rejectedCode(rejection))
    }

    // ---- what acceptance must produce -----------------------------------------

    @Test
    fun `an accepted submission names the session, the device class and the author`() {
        val record = acceptedOf(submit(results = rows("PHY-001" to "PASS")))

        assertEquals("SESS-001", record.sessionUuid)
        assertEquals("Samsung SM-A107F", record.deviceIdentifier)
        assertEquals(14, record.expectedCount)
        assertEquals(1, record.results.size)

        val result = record.results.first()
        assertEquals("TECH-17", result.operatorId)
        assertEquals("OPERATOR", result.source)
        assertEquals(stamped, result.observedAt)
    }

    @Test
    fun `the observation time is the stamped one, never anything a client offered`() {
        // The client cannot supply a time at all: `apply` takes it as its own argument.
        // This pins the value that reaches the record so a future "just pass it through"
        // refactor fails loudly.
        val record = acceptedOf(submit(results = rows("PHY-001" to "PASS")))
        assertEquals(stamped, record.results.single().observedAt)
    }

    @Test
    fun `the first completion time is kept when a later write completes it again`() {
        val once = acceptedOf(submit(results = allAnswered()))
        val twice = acceptedOf(submit(existing = once, results = rows("PHY-001" to "PASS")))

        assertEquals(stamped, twice.completedAt)
    }

    // ---- the conflation this model exists to prevent --------------------------

    @Test
    fun `a checklist answered entirely with NOT_PERFORMED is not complete`() {
        val record = acceptedOf(submit(results = allAnswered(TechnicianCheckOutcome.NOT_PERFORMED)))

        assertEquals(14, record.recordedCount, "all fourteen rows exist")
        assertEquals(0, record.answeredCount, "but none was carried out")
        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
        assertNull(record.completedAt, "nothing was completed, so there is no completion time")
    }

    @Test
    fun `NOT_PERFORMED rows still count as unanswered`() {
        val record = acceptedOf(
            submit(results = rows("PHY-001" to "NOT_PERFORMED")),
        )

        assertTrue(
            TechnicianChecklistCatalog.ids.all { id ->
                id in record.unansweredIds(TechnicianChecklistCatalog.ids)
            },
            "a not-performed check is unanswered, so every id stays unanswered",
        )
    }

    @Test
    fun `NOT_APPLICABLE counts as carried out, because it is an answer`() {
        // The catalog itself says a device with no microSD slot answers NOT_APPLICABLE,
        // not PASS. Refusing to count it would force a technician to lie to finish.
        val withoutOne = TechnicianChecklistCatalog.ids.filter { it != "PHY-009" }
        val results = JsonArray(
            withoutOne.map { id ->
                buildJsonObject {
                    put("id", id)
                    put("outcome", "PASS")
                }
            } + buildJsonObject {
                put("id", "PHY-009")
                put("outcome", "NOT_APPLICABLE")
            },
        )

        val record = acceptedOf(submit(results = results))

        assertEquals(14, record.answeredCount)
        assertTrue(record.isComplete(TechnicianChecklistCatalog.ids))
        assertNotNull(record.completedAt)
    }

    @Test
    fun `thirteen of fourteen is incomplete and says which one is missing`() {
        val thirteen = TechnicianChecklistCatalog.ids.drop(1)
        val results = JsonArray(
            thirteen.map { id ->
                buildJsonObject {
                    put("id", id)
                    put("outcome", "PASS")
                }
            },
        )

        val record = acceptedOf(submit(results = results))

        assertFalse(record.isComplete(TechnicianChecklistCatalog.ids))
        assertNull(record.completedAt)
        assertEquals(
            listOf(TechnicianChecklistCatalog.ids.first()),
            record.unansweredIds(TechnicianChecklistCatalog.ids),
        )
    }

    @Test
    fun `a completed checklist re-opens if a correction withdraws an answer`() {
        val complete = acceptedOf(submit(results = allAnswered()))
        assertNotNull(complete.completedAt)

        val retracted = acceptedOf(
            submit(existing = complete, results = rows("PHY-001" to "NOT_PERFORMED")),
        )

        assertFalse(retracted.isComplete(TechnicianChecklistCatalog.ids))
        assertNull(
            retracted.completedAt,
            "a record that regressed must not still read as finished",
        )
    }

    // ---- corrections ----------------------------------------------------------

    @Test
    fun `a correction replaces the row rather than appending a contradictory one`() {
        val first = acceptedOf(submit(results = rows("PHY-001" to "PASS")))
        val corrected = acceptedOf(
            submit(existing = first, results = rows("PHY-001" to "DEFECT_OBSERVED")),
        )

        assertEquals(1, corrected.results.size, "still one row for that check")
        assertEquals(
            TechnicianCheckOutcome.DEFECT_OBSERVED,
            corrected.outcomeFor("PHY-001"),
        )
    }

    @Test
    fun `answers accumulate across submissions until the checklist is finished`() {
        var record: TechnicianChecklistRecord? = null
        for (id in TechnicianChecklistCatalog.ids) {
            val submission = submit(existing = record, results = rows(id to "PASS"))
            record = acceptedOf(submission)
        }

        assertEquals(14, record!!.answeredCount)
        assertTrue(record.isComplete(TechnicianChecklistCatalog.ids))
        assertNotNull(record.completedAt)
    }
}
