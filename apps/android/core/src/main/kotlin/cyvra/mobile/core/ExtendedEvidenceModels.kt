package cyvra.mobile.core

import kotlinx.serialization.Serializable

/**
 * One measured device parameter, carrying its ratified matrix identifier.
 *
 * Why every parameter carries a workbook ID
 * ----------------------------------------
 * The product is accountable to a 114-parameter engineering workbook. Storing the
 * identifier beside the measurement means three things become automatic rather than
 * manual:
 *
 *   1. every value in a report is traceable to the requirement it satisfies;
 *   2. a parameter that was never measured simply has no row - it cannot appear to
 *      be present merely because a field exists in a schema;
 *   3. the product can count its own coverage against the ratified matrix, which is
 *      what makes an honest handshake claim computable rather than rhetorical.
 *
 * Nothing here may carry a value that was not measured. If a command fails, the
 * status records the failure; the value stays null. A failure is never rewritten
 * as a negative result.
 */
@Serializable
data class DeviceParameter(
    /** Ratified workbook identifier, e.g. `HW-001`. Never invented. */
    val id: String,
    /** Workbook domain, e.g. `HARDWARE`. */
    val domain: String,
    /** Human-readable requirement name from the workbook. */
    val label: String,
    /** The measurement itself. */
    val result: EvidenceFieldResult<String>,
)

/**
 * Extended evidence group covering the domains that the original identity/battery/
 * storage/security bundle does not reach.
 *
 * Additive and default-null: previously stored JSON without this field still decodes.
 * Legacy records simply report no extended coverage, which is the truthful position -
 * absence of the group means absence of the measurement, not absence of a defect.
 */
@Serializable
data class ExtendedDeviceEvidence(
    val parameters: List<DeviceParameter>,
) {
    /** Coverage against the ratified matrix, computed from what was actually measured. */
    val measuredCount: Int
        get() = parameters.count { it.result.status == EvidenceStatus.AVAILABLE }

    /** Parameters attempted but not obtained, with the honest reason attached to each. */
    val unmeasuredCount: Int
        get() = parameters.size - measuredCount

    fun byId(id: String): DeviceParameter? = parameters.firstOrNull { it.id == id }

    fun byDomain(domain: String): List<DeviceParameter> =
        parameters.filter { it.domain.equals(domain, ignoreCase = true) }
}
