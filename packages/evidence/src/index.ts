/**
 * Shared evidence vocabulary (guideline §8.6). Kept deliberately small for the
 * early gates; the full capability contract + JSON Schema land in gate G4.
 *
 * Rules encoded here on purpose:
 * - Results are never invented: missing evidence is LIMITED / NOT_AVAILABLE.
 * - UNAVAILABLE / NOT_TESTED / NOT_SUPPORTED / PERMISSION_DENIED are NOT FAIL.
 * - Evidence sources stay labelled; higher tiers do not overwrite lower ones.
 */

export const EVIDENCE_RESULTS = [
  "PASS",
  "FAIL",
  "LIMITED",
  "NOT_AVAILABLE",
  "NOT_SUPPORTED",
  "NOT_TESTED",
  "CANCELLED",
  "ERROR",
] as const;
export type EvidenceResult = (typeof EVIDENCE_RESULTS)[number];

export const EVIDENCE_SOURCES = [
  "S1_APPLICATION",
  "S2_STATION",
  "S2_AUTHORIZED_ADB",
  "S3_ENTERPRISE",
  "TECHNICIAN_OBSERVATION",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** Coverage labels are NOT quality grades. */
export const COVERAGE_LABELS = ["COMPLETE", "LIMITED", "PARTIAL"] as const;
export type CoverageLabel = (typeof COVERAGE_LABELS)[number];

/** Results that must never be coerced into FAIL. */
const NON_FAILURE: ReadonlySet<EvidenceResult> = new Set([
  "NOT_AVAILABLE",
  "NOT_SUPPORTED",
  "NOT_TESTED",
  "CANCELLED",
]);

/** Only an explicit FAIL is a failure. */
export function isFailure(result: EvidenceResult): boolean {
  return result === "FAIL";
}

/** True for results that must not be reported as a failure. */
export function isNonFailure(result: EvidenceResult): boolean {
  return NON_FAILURE.has(result);
}
