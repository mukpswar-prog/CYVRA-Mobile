/**
 * Shared evidence vocabulary (guideline §5, §8.6).
 *
 * PERMISSION_DENIED is a first-class result (G4 decision, 9 Sep 2026).
 * Guideline §8.6 lists the core results; §5 forbids coercing permission
 * denial into FAIL. Both are encoded here.
 */

export const SCHEMA_VERSION = "1.0.0" as const;

export const EVIDENCE_RESULTS = [
  "PASS",
  "FAIL",
  "LIMITED",
  "NOT_AVAILABLE",
  "NOT_SUPPORTED",
  "NOT_TESTED",
  "CANCELLED",
  "ERROR",
  "PERMISSION_DENIED",
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

/** Coverage labels are NOT quality grades (guideline §3). */
export const COVERAGE_LABELS = ["COMPLETE", "LIMITED", "PARTIAL"] as const;
export type CoverageLabel = (typeof COVERAGE_LABELS)[number];

export const ACCESS_LEVELS = [
  "L0_LOCKED",
  "L1_LIMITED",
  "L2_S1_APP",
  "L3_STATION",
  "L4_ENTERPRISE",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** USB is classified independently of ADB (guideline §8.1). */
export const USB_STATES = [
  "USB_UNKNOWN",
  "USB_DISCONNECTED",
  "USB_CONNECTED_CHARGING",
  "USB_CONNECTED_DATA",
  "USB_NOT_AUTHORIZED",
] as const;
export type UsbState = (typeof USB_STATES)[number];

export const ADB_STATES = [
  "ADB_UNKNOWN",
  "ADB_DISABLED",
  "ADB_VISIBLE_UNAUTHORIZED",
  "ADB_AUTHORIZED",
] as const;
export type AdbState = (typeof ADB_STATES)[number];

export const FACT_STATES = ["DECLARED", "DETECTED", "TESTED"] as const;
export type FactState = (typeof FACT_STATES)[number];

export const REPORT_DOMAINS = [
  "IDENTITY_CONFIGURATION",
  "PHYSICAL_CONDITION",
  "HARDWARE_CONFIGURATION",
  "FUNCTIONAL_VERIFICATION",
  "CONNECTIVITY",
  "POWER_BATTERY_STORAGE",
  "SECURITY_ACCESS_LIMITATIONS",
] as const;
export type ReportDomain = (typeof REPORT_DOMAINS)[number];

export const LIMITATION_CODES = [
  "PERMISSION_DENIED",
  "HARDWARE_ABSENT",
  "API_PRIVILEGED",
  "LAYER_FORBIDDEN",
  "USER_CANCELLED",
  "OFFLINE",
  "INCONCLUSIVE",
  "FEATURE_UNDECLARED",
  "SENSOR_DECLARED_BUT_MISSING",
] as const;
export type LimitationCode = (typeof LIMITATION_CODES)[number];

/** Results that must never be coerced into FAIL (guideline §5 / §8.6). */
const NON_FAILURE: ReadonlySet<EvidenceResult> = new Set([
  "NOT_AVAILABLE",
  "NOT_SUPPORTED",
  "NOT_TESTED",
  "CANCELLED",
  "PERMISSION_DENIED",
]);

export function isFailure(result: EvidenceResult): boolean {
  return result === "FAIL";
}

export function isNonFailure(result: EvidenceResult): boolean {
  return NON_FAILURE.has(result);
}

/** Only an explicit FAIL may be stored as a failure. */
export function coerceToFail(_result: EvidenceResult): EvidenceResult {
  throw new Error(
    "UNAVAILABLE / NOT_TESTED / NOT_SUPPORTED / PERMISSION_DENIED must not be converted into FAIL",
  );
}

export const SOURCE_SUMMARY_RANK: readonly EvidenceSource[] = [
  "S3_ENTERPRISE",
  "S2_AUTHORIZED_ADB",
  "S2_STATION",
  "S1_APPLICATION",
  "TECHNICIAN_OBSERVATION",
];
