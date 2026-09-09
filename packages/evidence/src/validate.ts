import { isUuid } from "./ids";
import type { EvidenceBatch, EvidenceRecord, ReportManifest } from "./types";
import {
  EVIDENCE_RESULTS,
  EVIDENCE_SOURCES,
  SCHEMA_VERSION,
  type EvidenceResult,
  type EvidenceSource,
} from "./vocabulary";

export interface ValidationIssue {
  path: string;
  message: string;
}

const RESULT_SET = new Set<string>(EVIDENCE_RESULTS);
const SOURCE_SET = new Set<string>(EVIDENCE_SOURCES);
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function check(
  issues: ValidationIssue[],
  condition: boolean,
  path: string,
  message: string,
): void {
  if (!condition) issues.push({ path, message });
}

export function validateEvidenceRecord(record: EvidenceRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  check(
    issues,
    record.schemaVersion === SCHEMA_VERSION,
    "schemaVersion",
    `expected ${SCHEMA_VERSION}`,
  );
  check(issues, isUuid(record.evidenceId), "evidenceId", "must be UUID");
  check(
    issues,
    isUuid(record.deviceLifecycleId),
    "deviceLifecycleId",
    "must be UUID",
  );
  check(
    issues,
    isUuid(record.processingSessionId),
    "processingSessionId",
    "must be UUID",
  );
  check(issues, record.testId.length > 0, "testId", "required");
  check(
    issues,
    SOURCE_SET.has(record.source),
    "source",
    "unknown evidence source",
  );
  check(
    issues,
    RESULT_SET.has(record.result),
    "result",
    "unknown evidence result",
  );
  check(issues, ISO_RE.test(record.collectedAt), "collectedAt", "must be RFC3339");
  check(issues, record.method.length > 0, "method", "required");
  return issues;
}

export function validateEvidenceBatch(batch: EvidenceBatch): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  check(issues, isUuid(batch.batchId), "batchId", "must be UUID");
  check(
    issues,
    isUuid(batch.deviceLifecycleId),
    "deviceLifecycleId",
    "must be UUID",
  );
  check(
    issues,
    isUuid(batch.processingSessionId),
    "processingSessionId",
    "must be UUID",
  );
  batch.records.forEach((record, index) => {
    for (const issue of validateEvidenceRecord(record)) {
      issues.push({
        path: `records[${index}].${issue.path}`,
        message: issue.message,
      });
    }
  });
  return issues;
}

export function validateReportManifest(
  manifest: ReportManifest,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  check(issues, isUuid(manifest.reportId), "reportId", "must be UUID");
  if (manifest.frozenAt !== null) {
    check(issues, ISO_RE.test(manifest.frozenAt), "frozenAt", "must be RFC3339");
  }
  return issues;
}

export function isEvidenceResult(value: string): value is EvidenceResult {
  return RESULT_SET.has(value);
}

export function isEvidenceSource(value: string): value is EvidenceSource {
  return SOURCE_SET.has(value);
}
