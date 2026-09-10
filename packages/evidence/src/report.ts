import { catalogTestIds, getTestDefinition } from "./catalog";
import { classifyConflicts } from "./conflict";
import { asReportId } from "./ids";
import type { ManifestEntry, ReportManifest, EvidenceRecord } from "./types";
import {
  REPORT_DOMAINS,
  SCHEMA_VERSION,
  type CoverageLabel,
  type ReportDomain,
} from "./vocabulary";

const DOMAIN_LABELS: Record<ReportDomain, string> = {
  IDENTITY_CONFIGURATION: "Identity & configuration",
  PHYSICAL_CONDITION: "Physical condition",
  HARDWARE_CONFIGURATION: "Hardware configuration",
  FUNCTIONAL_VERIFICATION: "Functional verification",
  CONNECTIVITY: "Connectivity",
  POWER_BATTERY_STORAGE: "Power, battery & storage",
  SECURITY_ACCESS_LIMITATIONS: "Security, access & limitations",
};

const WITHHELD = new Set([
  "LIMITED",
  "NOT_AVAILABLE",
  "NOT_SUPPORTED",
  "PERMISSION_DENIED",
  "CANCELLED",
  "ERROR",
]);

export const REPORT_1_TITLE = "CYVRA Device Verification Report";

export const REPORT_1_NONGOALS = [
  "This report is not a sanitization certificate and does not mean a wipe was authorized or completed.",
  "It does not prove ownership, OEM or Knox authority, warranty, or future reliability.",
  "It is not a claim that the device is certified perfect.",
  "Missing or denied evidence is shown as LIMITED, NOT AVAILABLE, NOT SUPPORTED, or PERMISSION DENIED — never a guessed grade.",
  "Verification is separate from sanitization.",
] as const;

/**
 * Coverage is not a quality grade (guideline §3 / §8.7).
 * PARTIAL = catalog tests missing or still NOT_TESTED.
 * LIMITED = every catalog test has an entry, but some results are withheld.
 * COMPLETE = every catalog test is an explicit PASS or FAIL.
 */
export function computeCoverage(entries: ManifestEntry[]): CoverageLabel {
  const have = new Map(entries.map((entry) => [entry.testId, entry]));
  const missingOrUntested = catalogTestIds().some((testId) => {
    const entry = have.get(testId);
    return !entry || entry.result === "NOT_TESTED";
  });
  if (missingOrUntested) return "PARTIAL";
  if (entries.some((entry) => WITHHELD.has(entry.result))) return "LIMITED";
  return "COMPLETE";
}

/** One summary entry per TEST_ID. Raw records stay in Neon; this is the freeze view. */
export function buildReportEntries(records: EvidenceRecord[]): ManifestEntry[] {
  return classifyConflicts(records).map((group) => {
    const preferred =
      group.records.find((record) => record.source === group.summarySource) ??
      group.records[0];
    return {
      testId: group.testId,
      evidenceId: preferred.evidenceId,
      result: group.summaryResult,
      source: group.summarySource,
    };
  });
}

export function formatReportNumber(reportId: string, frozenAt: Date): string {
  const year = frozenAt.getUTCFullYear();
  const unique = reportId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `CYVRA-R1-${year}-${unique}`;
}

export function enrichEntry(entry: ManifestEntry) {
  const definition = getTestDefinition(entry.testId);
  const domain = definition?.domain ?? "IDENTITY_CONFIGURATION";
  return {
    ...entry,
    userName: definition?.userName ?? entry.testId,
    objectiveName: definition?.objectiveName ?? entry.testId,
    domain,
    domainLabel: domainLabel(domain),
  };
}

export function domainLabel(domain: ReportDomain | string): string {
  if ((REPORT_DOMAINS as readonly string[]).includes(domain)) {
    return DOMAIN_LABELS[domain as ReportDomain];
  }
  return domain;
}

/** Coverage is a completeness label, never a quality grade. */
export function coverageCaption(coverage: CoverageLabel): string {
  if (coverage === "PARTIAL") {
    return "Catalog tests are missing or still NOT TESTED. This is not a quality grade.";
  }
  if (coverage === "LIMITED") {
    return "Every catalog test has an entry, but some results are withheld. This is not a quality grade.";
  }
  return "Every catalog test is an explicit PASS or FAIL. This is not a quality grade.";
}

export function assembleManifest(input: {
  reportId: string;
  deviceLifecycleId: EvidenceRecord["deviceLifecycleId"];
  processingSessionId: EvidenceRecord["processingSessionId"];
  records: EvidenceRecord[];
  frozenAt: string;
}): ReportManifest {
  const entries = buildReportEntries(input.records);
  return {
    schemaVersion: SCHEMA_VERSION,
    reportId: asReportId(input.reportId),
    deviceLifecycleId: input.deviceLifecycleId,
    processingSessionId: input.processingSessionId,
    coverage: computeCoverage(entries),
    entries,
    frozenAt: input.frozenAt,
  };
}

export function assertManifestFrozen(manifest: ReportManifest): void {
  if (!manifest.frozenAt) {
    throw new Error("Report 1 manifest is not frozen");
  }
}
