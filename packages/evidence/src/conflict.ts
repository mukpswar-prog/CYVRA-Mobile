import { SOURCE_SUMMARY_RANK, type EvidenceResult, type EvidenceSource } from "./vocabulary";
import type { EvidenceRecord } from "./types";

export interface ConflictGroup {
  testId: string;
  records: EvidenceRecord[];
  /** Summary preference only. Raw records are never overwritten. */
  summarySource: EvidenceSource;
  summaryResult: EvidenceResult;
  materialConflict: boolean;
}

function rank(source: EvidenceSource): number {
  const index = SOURCE_SUMMARY_RANK.indexOf(source);
  return index === -1 ? SOURCE_SUMMARY_RANK.length : index;
}

/**
 * Preserve + compare + classify (guideline §8.6).
 * Human review is a new record, never an edit of raw evidence.
 */
export function classifyConflicts(records: EvidenceRecord[]): ConflictGroup[] {
  const byTest = new Map<string, EvidenceRecord[]>();
  for (const record of records) {
    const list = byTest.get(record.testId) ?? [];
    list.push(record);
    byTest.set(record.testId, list);
  }

  return [...byTest.entries()].map(([testId, group]) => {
    const sorted = [...group].sort((a, b) => rank(a.source) - rank(b.source));
    const preferred = sorted[0];
    const results = new Set(group.map((item) => item.result));
    return {
      testId,
      records: group,
      summarySource: preferred.source,
      summaryResult: preferred.result,
      materialConflict: results.size > 1,
    };
  });
}
