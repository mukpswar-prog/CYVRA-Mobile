package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * Outcome vocabulary for a single technician check.
 *
 * `DEFECT_OBSERVED` is deliberately direct rather than softened. The prohibition on
 * negative wording governs claims a product makes about itself; it does not license
 * dressing up a device condition. The inspection models already state conditions plainly
 * (`hasBackGlassCrack`, `hasFrameBendingOrDents`), and a technician reading a checklist
 * needs the condition, not a euphemism for it.
 */
@Serializable
enum class TechnicianCheckOutcome {
    /** The technician carried out the check and the condition was met. */
    PASS,
    /** The technician carried out the check and found the condition not met. */
    DEFECT_OBSERVED,
    /** This device does not have the feature under test (e.g. no microSD slot). */
    NOT_APPLICABLE,
    /** The check was not carried out. This is the initial state and never a substitute
     *  for an answer - a checklist left in this state is incomplete, not clean. */
    NOT_PERFORMED,
}

/**
 * One ratified physical or specialist check that no collector in this product can perform.
 *
 * These are the 14 parameters no software path in this product can establish: the 13
 * the engineering workbook marks `No / not safely replaceable`, plus PHY-008 which the
 * workbook marks `CYVRA Capability = No` / `Physical required` (ruling CE-2, 13-Oct-2026).
 * They exist here so the product can present, prompt for and record them - NOT so it can
 * claim to have performed them.
 */
@Serializable
data class TechnicianCheckDefinition(
    /** Ratified workbook identifier, e.g. `PHY-001`. Never invented. */
    val id: String,
    /** Workbook domain, e.g. `Mechanical`. */
    val domain: String,
    /** The check, in the workbook's own words. */
    val item: String,
    /** Workbook priority: `P0` or `P1`. */
    val priority: String,
    /** Why no collector can establish this. Stated so no one later "solves" it in code. */
    val whyNotAutomatable: String,
)

/**
 * A technician's attestation against one [TechnicianCheckDefinition].
 *
 * An attestation is not a measurement. [source] is fixed to `OPERATOR` so that a record
 * produced by a person can never be indistinguishable in the report from a record produced
 * by a shell command. Collapsing those two is the specific failure the four-plane
 * attribution rule exists to prevent: a human opinion presented as a software observation
 * is indistinguishable from a fabrication to anyone reading the report later.
 */
@Serializable
data class TechnicianCheckResult(
    /** Must match a [TechnicianCheckDefinition.id]. */
    val id: String,
    val outcome: TechnicianCheckOutcome,
    /** Who performed the check. Required: an attestation without an author is not evidence. */
    val operatorId: String,
    val observedAt: String,
    /** Free-text observation. Optional; the outcome is not. */
    val note: String? = null,
) {
    /** Fixed attribution. Not [EvidenceFieldResult.source], which records machine planes. */
    val source: String
        get() = OPERATOR_SOURCE

    companion object {
        const val OPERATOR_SOURCE = "OPERATOR"
    }
}

/**
 * The complete technician checklist for one device session.
 *
 * Holds all 14 definitions implicitly (see [TechnicianChecklistCatalog]) and whichever
 * have been answered. [unansweredIds] is what makes incompleteness visible: a checklist
 * that has been opened but not finished must not read like one that was finished with
 * everything passing.
 */
@Serializable
data class TechnicianChecklistRecord(
    val checklistId: String,
    val sessionUuid: String,
    val deviceIdentifier: String,
    val expectedCount: Int,
    val results: List<TechnicianCheckResult> = emptyList(),
    /** Null until every expected check was actually carried out. A checklist full of
     *  NOT_PERFORMED rows has no completion time, because nothing was completed. */
    val completedAt: String? = null,
) {
    fun outcomeFor(id: String): TechnicianCheckOutcome? =
        results.firstOrNull { it.id == id }?.outcome

    /** Definition ids that have no SUBSTANTIVE answer yet, in workbook order. */
    fun unansweredIds(expectedIds: List<String>): List<String> =
        expectedIds.filter { id ->
            results.none { it.id == id && it.outcome != TechnicianCheckOutcome.NOT_PERFORMED }
        }

    /**
     * How many checks were actually carried out, counting NOT_APPLICABLE as carried out.
     *
     * `NOT_PERFORMED` is excluded, so this is deliberately smaller than [recordedCount]
     * whenever anything was skipped. A check answered "not done" is not a check done.
     */
    val answeredCount: Int
        get() = results.count { it.outcome != TechnicianCheckOutcome.NOT_PERFORMED }

    /** How many rows exist at all, including NOT_PERFORMED. Differs from [answeredCount]. */
    val recordedCount: Int
        get() = results.size

    /**
     * True only when every expected check was actually carried out.
     *
     * A checklist answered entirely with `NOT_PERFORMED` is NOT complete. Without this
     * rule, "the technician never looked" would summarise identically to "the technician
     * looked and found nothing", which is precisely the conflation this model exists to
     * make impossible.
     */
    fun isComplete(expectedIds: List<String>): Boolean =
        expectedIds.isNotEmpty() && unansweredIds(expectedIds).isEmpty()
}
