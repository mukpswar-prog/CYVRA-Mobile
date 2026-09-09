/**
 * ID kinds are not interchangeable (guideline §6.3).
 * Types are branded strings so a report id cannot be passed as an evidence id.
 */

export type ProcessingSessionId = string & {
  readonly __brand: "PROCESSING_SESSION_ID";
};
export type DeviceLifecycleId = string & {
  readonly __brand: "DEVICE_LIFECYCLE_ID";
};
export type EvidenceId = string & { readonly __brand: "EVIDENCE_ID" };
export type ReportId = string & { readonly __brand: "REPORT_ID" };
export type CapabilityProfileId = string & {
  readonly __brand: "CAPABILITY_PROFILE_ID";
};
export type EvidenceBatchId = string & { readonly __brand: "EVIDENCE_BATCH_ID" };
export type TestId = string & { readonly __brand: "TEST_ID" };

export const ID_KINDS = [
  "PROCESSING_SESSION_ID",
  "DEVICE_LIFECYCLE_ID",
  "EVIDENCE_ID",
  "REPORT_ID",
  "CAPABILITY_PROFILE_ID",
  "EVIDENCE_BATCH_ID",
  "TEST_ID",
] as const;
export type IdKind = (typeof ID_KINDS)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function asProcessingSessionId(value: string): ProcessingSessionId {
  assertUuid(value, "PROCESSING_SESSION_ID");
  return value as ProcessingSessionId;
}
export function asDeviceLifecycleId(value: string): DeviceLifecycleId {
  assertUuid(value, "DEVICE_LIFECYCLE_ID");
  return value as DeviceLifecycleId;
}
export function asEvidenceId(value: string): EvidenceId {
  assertUuid(value, "EVIDENCE_ID");
  return value as EvidenceId;
}
export function asReportId(value: string): ReportId {
  assertUuid(value, "REPORT_ID");
  return value as ReportId;
}
export function asCapabilityProfileId(value: string): CapabilityProfileId {
  assertUuid(value, "CAPABILITY_PROFILE_ID");
  return value as CapabilityProfileId;
}
export function asEvidenceBatchId(value: string): EvidenceBatchId {
  assertUuid(value, "EVIDENCE_BATCH_ID");
  return value as EvidenceBatchId;
}

function assertUuid(value: string, kind: IdKind): void {
  if (!isUuid(value)) {
    throw new Error(`${kind} must be a UUID, got ${JSON.stringify(value)}`);
  }
}
