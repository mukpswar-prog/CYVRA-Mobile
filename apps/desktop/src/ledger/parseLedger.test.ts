import { describe, expect, it } from "vitest";
import {
  chainProblems,
  GENESIS_PREV,
  LEDGER_EVENTS,
  parseLedgerJsonl,
  type LedgerRow,
} from "./parseLedger";

const ZERO = "0".repeat(64);

function entry(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    schema: "cyvra.ledger.v1",
    seq: 1,
    at: "2026-09-30T10:00:00Z",
    event: "ACTIVATION",
    offline: false,
    subject: null,
    prev: ZERO,
    hash: "a".repeat(64),
    ...overrides,
  });
}

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    line: 1,
    schema: "cyvra.ledger.v1",
    seq: 1,
    at: "2026-09-30T10:00:00Z",
    event: "ACTIVATION",
    offline: false,
    subject: null,
    prev: ZERO,
    hash: "a".repeat(64),
    ...overrides,
  };
}

describe("the six events", () => {
  it("are exactly the six the workstation records", () => {
    expect([...LEDGER_EVENTS]).toEqual([
      "ACTIVATION",
      "REVALIDATION",
      "SCAN_COMMITTED",
      "SCAN_DEBITED",
      "GRACE_ENTERED",
      "GRACE_EXPIRED",
    ]);
  });
});

describe("parseLedgerJsonl", () => {
  it("reads a well-formed file oldest first and keeps each line number", () => {
    const raw = [
      entry({ seq: 1, hash: "a".repeat(64) }),
      entry({ seq: 2, event: "SCAN_COMMITTED", subject: "CYVRA-SESSION-1", prev: "a".repeat(64), hash: "b".repeat(64) }),
      entry({ seq: 3, event: "SCAN_DEBITED", subject: "CYVRA-CERT-1", prev: "b".repeat(64), hash: "c".repeat(64) }),
    ].join("\n");

    const parsed = parseLedgerJsonl(raw);

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(parsed.rows.map((r) => r.line)).toEqual([1, 2, 3]);
    expect(parsed.rows[1].subject).toBe("CYVRA-SESSION-1");
    expect(parsed.rows[2].event).toBe("SCAN_DEBITED");
  });

  it("treats the file's own trailing newline as an ending, not damage", () => {
    const parsed = parseLedgerJsonl(entry() + "\n");

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
  });

  it("keeps the readable lines when one line is not JSON at all", () => {
    const raw = [entry({ seq: 1 }), "this is not JSON", entry({ seq: 3 })].join("\n");

    const parsed = parseLedgerJsonl(raw);

    expect(parsed.rows.map((r) => r.seq)).toEqual([1, 3]);
    expect(parsed.unreadable).toEqual([{ line: 2, reason: "not valid JSON" }]);
  });

  it("names a line that is valid JSON but not an object", () => {
    const parsed = parseLedgerJsonl(`["not", "an", "object"]`);

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.unreadable[0].reason).toBe("not a JSON object");
  });

  it("refuses a foreign schema rather than reading it as ours", () => {
    const parsed = parseLedgerJsonl(entry({ schema: "some.other.v9" }));

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.unreadable[0].reason).toContain("unexpected schema");
  });

  it("refuses an event nobody has defined", () => {
    const parsed = parseLedgerJsonl(entry({ event: "SCAN_TELEPORTED" }));

    expect(parsed.unreadable[0].reason).toContain("unknown event");
  });

  it("refuses a seq that is not a positive whole number", () => {
    for (const seq of [0, -1, 1.5, "1"]) {
      const parsed = parseLedgerJsonl(entry({ seq }));
      expect(parsed.unreadable[0].reason).toContain("seq");
    }
  });

  it("refuses a provenance flag that is not true or false", () => {
    const parsed = parseLedgerJsonl(entry({ offline: "false" }));

    expect(parsed.unreadable[0].reason).toContain("offline");
  });

  it("refuses a hash that is not 64 lowercase hex characters", () => {
    for (const bad of ["", "a".repeat(63), "A".repeat(64), "z".repeat(64)]) {
      const parsed = parseLedgerJsonl(entry({ hash: bad }));
      expect(parsed.unreadable[0].reason).toContain("hash");
    }
  });

  it("refuses a prev that is not a hash", () => {
    const parsed = parseLedgerJsonl(entry({ prev: "genesis" }));

    expect(parsed.unreadable[0].reason).toContain("prev");
  });

  it("accepts a null subject and a string subject alike", () => {
    expect(parseLedgerJsonl(entry({ subject: null })).rows[0].subject).toBeNull();
    expect(parseLedgerJsonl(entry({ subject: "CERT-1" })).rows[0].subject).toBe("CERT-1");
  });

  it("reads an empty file as an empty ledger, not a broken one", () => {
    const parsed = parseLedgerJsonl("");

    expect(parsed.rows).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
  });

  it("never reorders: rows come back in the order the lines appeared", () => {
    const raw = [entry({ seq: 5 }), entry({ seq: 2 })].join("\n");

    const parsed = parseLedgerJsonl(raw);

    expect(parsed.rows.map((r) => r.seq)).toEqual([5, 2]);
  });
});

describe("chainProblems", () => {
  const a = row({ seq: 1, prev: ZERO, hash: "a".repeat(64) });
  const b = row({ seq: 2, prev: "a".repeat(64), hash: "b".repeat(64) });
  const c = row({ seq: 3, prev: "b".repeat(64), hash: "c".repeat(64) });

  it("finds nothing wrong with a linked chain", () => {
    expect(chainProblems([a, b, c])).toEqual([]);
  });

  it("finds nothing wrong with no chain at all", () => {
    expect(chainProblems([])).toEqual([]);
  });

  it("reports a first entry that does not hang off genesis", () => {
    const fork = row({ seq: 1, prev: "f".repeat(64) });

    expect(chainProblems([fork])).toEqual([
      "entry 1 does not hang off the genesis hash",
    ]);
  });

  it("reports a gap in the sequence", () => {
    const skipped = row({ seq: 4, prev: "b".repeat(64), hash: "d".repeat(64) });

    const problems = chainProblems([a, b, skipped]);

    expect(problems).toContain("entry 4 appears where entry 3 should be");
  });

  it("reports an entry that does not name its predecessor's hash", () => {
    const spliced = row({ seq: 3, prev: ZERO, hash: "c".repeat(64) });

    const problems = chainProblems([a, b, spliced]);

    expect(problems).toContain("entry 3 does not link back to entry 2");
  });

  it("says so plainly when a single entry stands alone off the wrong hash", () => {
    const lonely = row({ seq: 7, prev: ZERO });

    expect(chainProblems([lonely])).toEqual(["entry 7 appears where entry 1 should be"]);
  });
});

describe("GENESIS_PREV", () => {
  it("is 64 zeros, matching the writer's genesis hash", () => {
    expect(GENESIS_PREV).toBe("0".repeat(64));
    expect(GENESIS_PREV).toHaveLength(64);
  });
});
