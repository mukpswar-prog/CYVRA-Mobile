import { getTestDefinition } from "./catalog";
import type { EvidenceRecord, HonestyIssue } from "./types";

const S1_FORBIDDEN_PASS_IDS = new Set([
  "IDN.IMEI_SERIAL",
  "PWR.BATTERY_SOH",
  "SEC.KNOX_CLAIM",
]);

/**
 * S1 honesty (guideline §5 / §8.2 / §9).
 * Does not throw on NOT_AVAILABLE / PERMISSION_DENIED — those are valid.
 */
export function assertS1Honesty(record: EvidenceRecord): HonestyIssue[] {
  const issues: HonestyIssue[] = [];
  const definition = getTestDefinition(record.testId);

  if (
    record.source === "S1_APPLICATION" &&
    record.result === "FAIL" &&
    (record.limitation === "PERMISSION_DENIED" ||
      record.limitation === "HARDWARE_ABSENT" ||
      record.limitation === "LAYER_FORBIDDEN" ||
      record.limitation === "API_PRIVILEGED")
  ) {
    issues.push({
      testId: record.testId,
      reason: "Limitation codes must not be stored as FAIL",
    });
  }

  if (
    record.source === "S1_APPLICATION" &&
    record.result === "PASS" &&
    (definition?.s1ForbiddenPass || S1_FORBIDDEN_PASS_IDS.has(record.testId))
  ) {
    issues.push({
      testId: record.testId,
      reason: "S1 must not emit PASS for IMEI, battery SOH, or Knox attestation",
    });
  }

  if (
    record.source === "S1_APPLICATION" &&
    record.testId === "SEC.LOCK_PRESENT" &&
    record.payload &&
    record.payload["bypassAttempted"] === true
  ) {
    issues.push({
      testId: record.testId,
      reason: "S1 must not attempt lock/FRP bypass",
    });
  }

  return issues;
}

export function recordIsHonest(record: EvidenceRecord): boolean {
  return assertS1Honesty(record).length === 0;
}
