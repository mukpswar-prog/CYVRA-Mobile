package cyvra.mobile.host.protocol

import cyvra.mobile.core.TechnicianCheckOutcome
import cyvra.mobile.core.TechnicianCheckResult
import cyvra.mobile.core.TechnicianChecklistCatalog
import cyvra.mobile.core.TechnicianChecklistRecord
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * What happened when a technician's answers were submitted.
 *
 * A refusal carries the code and the reason because a checklist that quietly loses a row
 * is indistinguishable from one that was never worked. Nothing here degrades to "accepted
 * with fewer results than you asked for".
 */
internal sealed interface ChecklistSubmission {
    data class Accepted(val record: TechnicianChecklistRecord) : ChecklistSubmission

    data class Rejected(val code: String, val message: String) : ChecklistSubmission
}

/**
 * Applies submitted checklist answers to the record for a session.
 *
 * Pure and free of the dispatcher so it can be exercised directly: the interesting
 * behaviour here - refusing an id the workbook never ratified, refusing an outcome
 * outside the ratified four, deciding when a checklist is genuinely complete - would
 * otherwise be reachable only through a completed scan, which is exactly the path a test
 * cannot cheaply construct. A rule nobody can run a test against is a rule that erodes.
 *
 * Invariants this object owns, rather than trusting a caller to hold:
 *
 * * Every id must be one `TechnicianChecklistCatalog` actually defines.
 * * Every outcome must be one of the four ratified values.
 * * An attestation must name who made it.
 * * The observation time is stamped here, never taken from the client, because a client
 *   supplied time is a time the client can backdate.
 * * Completion is delegated to `TechnicianChecklistRecord.isComplete`, so a checklist
 *   answered entirely with `NOT_PERFORMED` can never read as finished.
 */
internal object ChecklistRecorder {

    fun apply(
        existing: TechnicianChecklistRecord?,
        results: JsonArray,
        operatorId: String,
        sessionUuid: String,
        deviceIdentifier: String,
        recordedAt: String,
    ): ChecklistSubmission {
        if (operatorId.isBlank()) {
            return ChecklistSubmission.Rejected(
                code = "CHECKLIST_OPERATOR_REQUIRED",
                message = "An attestation with no author is not evidence; RECORD_CHECKLIST " +
                    "needs the technician who performed the checks",
            )
        }

        if (results.isEmpty()) {
            return ChecklistSubmission.Rejected(
                code = "CHECKLIST_RESULTS_EMPTY",
                message = "No results were supplied, so nothing was recorded. Reading " +
                    "current progress does not need this command; GET_CHECKLIST does.",
            )
        }

        val knownIds = TechnicianChecklistCatalog.ids.toSet()
        val outcomeByName = TechnicianCheckOutcome.entries.associateBy { it.name }

        val accepted = mutableListOf<TechnicianCheckResult>()
        for (element in results) {
            val row = element as? JsonObject ?: return malformed

            val id = (row["id"] as? JsonPrimitive)?.contentOrNull
            if (id == null || id !in knownIds) {
                return ChecklistSubmission.Rejected(
                    code = "CHECKLIST_UNKNOWN_ID",
                    message = "Refused an id this product holds no ratified definition " +
                        "for: ${id ?: "<missing>"}",
                )
            }

            val outcomeName = (row["outcome"] as? JsonPrimitive)?.contentOrNull
            val outcome = outcomeByName[outcomeName]
                ?: return ChecklistSubmission.Rejected(
                    code = "CHECKLIST_UNKNOWN_OUTCOME",
                    message = "Refused an outcome outside the ratified vocabulary for " +
                        "$id: ${outcomeName ?: "<missing>"}",
                )

            accepted += TechnicianCheckResult(
                id = id,
                outcome = outcome,
                operatorId = operatorId,
                observedAt = recordedAt,
                note = (row["note"] as? JsonPrimitive)?.contentOrNull,
            )
        }

        val record = existing ?: TechnicianChecklistCatalog.newRecord(
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
        )

        // Newest answer wins per check, so a technician correcting a row replaces it
        // rather than appending a second, contradictory one.
        val byId = LinkedHashMap<String, TechnicianCheckResult>()
        record.results.forEach { byId[it.id] = it }
        accepted.forEach { byId[it.id] = it }

        val expected = TechnicianChecklistCatalog.ids
        val draft = record.copy(results = byId.values.toList())
        val complete = draft.isComplete(expected)

        return ChecklistSubmission.Accepted(
            draft.copy(
                /*
                 * Completion time is kept from the first moment it was earned, and cleared
                 * if a later correction re-opens the checklist - so a record that regressed
                 * can never still read as finished.
                 */
                completedAt = if (complete) draft.completedAt ?: recordedAt else null,
            ),
        )
    }

    /** Shared with the dispatcher so the transport-level check cannot drift from this one. */
    val malformed = ChecklistSubmission.Rejected(
        code = "CHECKLIST_RESULTS_MALFORMED",
        message = "RECORD_CHECKLIST expects payload.results as an array of " +
            "{ id, outcome, note? }",
    )
}
