/*
 * Reader for `<cyvra.home>/logs/ledger.jsonl`.
 *
 * The desktop view parses the file **itself** rather than being handed a
 * decoded struct. That is deliberate: a screen which only ever sees the Rust
 * side's interpretation of the file can never notice that the interpretation
 * is wrong, and "the writer says it is fine" is not an audit. Rust still does
 * the byte-level work this layer deliberately does not - recomputing the
 * SHA-256 over each entry body, which requires two languages to agree on
 * exactly how an object serialises - and its verdict is shown alongside, not
 * instead of, what this reader sees.
 *
 * What this reader does check, independently: every line is valid JSON, every
 * object carries the v1 schema, every event is one of the six, `seq` runs
 * without gaps, and each entry's `prev` names the previous entry's `hash`.
 * Structural evidence, in other words - the sort a human can follow with a
 * finger, which is what makes it useful when the byte-level check fails.
 */

export const LEDGER_SCHEMA = "cyvra.ledger.v1";

/** `prev` of the first entry: 64 zeros, never a hash of anything. */
export const GENESIS_PREV = "0".repeat(64);

/** The six things worth recording forever, exactly as Rust names them. */
export const LEDGER_EVENTS = [
  "ACTIVATION",
  "REVALIDATION",
  "SCAN_COMMITTED",
  "SCAN_DEBITED",
  "GRACE_ENTERED",
  "GRACE_EXPIRED",
] as const;

export type LedgerEvent = (typeof LEDGER_EVENTS)[number];

/** One entry as `ledger.jsonl` holds it. */
export interface LedgerRow {
  /** 1-based line number this entry was read from. */
  line: number;
  schema: string;
  seq: number;
  at: string;
  event: LedgerEvent;
  offline: boolean;
  subject: string | null;
  prev: string;
  hash: string;
}

/** A line that could not be read as an entry, and why not. */
export interface UnreadableLine {
  line: number;
  reason: string;
}

export interface ParsedLedger {
  rows: LedgerRow[];
  unreadable: UnreadableLine[];
}

/** An entry decoded by the Rust bridge, for the cross-check. */
export interface LedgerEntryLine {
  schema: string;
  seq: number;
  at: string;
  event: string;
  offline: boolean;
  subject: string | null;
  prev: string;
  hash: string;
}

/** What the Rust `ledger_read` command returns. */
export interface LedgerReadResult {
  entries: LedgerEntryLine[];
  /** `null` when no ledger exists yet - absent, not broken. */
  verified: boolean | null;
  error: string | null;
  raw: string | null;
}

const HEX_64 = /^[0-9a-f]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvent(value: unknown): value is LedgerEvent {
  return typeof value === "string" && (LEDGER_EVENTS as readonly string[]).includes(value);
}

/**
 * Reads `ledger.jsonl` line by line, keeping every line it can and naming
 * every line it cannot.
 *
 * A single unreadable line does not discard the rest of the file. An auditor
 * looking at a damaged ledger needs to see what survived *and* be told which
 * line stopped making sense - a reader that throws its hands up at the first
 * bad byte is a reader that tells the operator nothing about where to look.
 */
export function parseLedgerJsonl(raw: string): ParsedLedger {
  const rows: LedgerRow[] = [];
  const unreadable: UnreadableLine[] = [];

  const lines = raw.split(/\r?\n/);

  lines.forEach((text, index) => {
    const line = index + 1;
    const trimmed = text.trim();

    // A trailing newline after the last entry is how the file is written, so
    // an empty line is not damage. Nothing else is skipped.
    if (trimmed === "") return;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      unreadable.push({ line, reason: "not valid JSON" });
      return;
    }

    if (!isObject(value)) {
      unreadable.push({ line, reason: "not a JSON object" });
      return;
    }

    const reason = entryReason(value);
    if (reason !== null) {
      unreadable.push({ line, reason });
      return;
    }

    rows.push({
      line,
      schema: value.schema as string,
      seq: value.seq as number,
      at: value.at as string,
      event: value.event as LedgerEvent,
      offline: value.offline as boolean,
      subject: typeof value.subject === "string" ? value.subject : null,
      prev: value.prev as string,
      hash: value.hash as string,
    });
  });

  return { rows, unreadable };
}

/** Why a parsed object is not a ledger entry, or `null` when it is one. */
function entryReason(value: Record<string, unknown>): string | null {
  if (value.schema !== LEDGER_SCHEMA) return `unexpected schema "${String(value.schema)}"`;

  if (typeof value.seq !== "number" || !Number.isInteger(value.seq) || value.seq < 1) {
    return "seq is not a positive whole number";
  }

  if (typeof value.at !== "string" || value.at.trim() === "") {
    return "at is missing";
  }

  if (!isEvent(value.event)) return `unknown event "${String(value.event)}"`;

  if (typeof value.offline !== "boolean") return "offline is not true or false";

  if (value.subject !== undefined && value.subject !== null && typeof value.subject !== "string") {
    return "subject is neither a string nor null";
  }

  if (typeof value.prev !== "string" || !HEX_64.test(value.prev)) {
    return "prev is not a 64-character lowercase hex hash";
  }

  if (typeof value.hash !== "string" || !HEX_64.test(value.hash)) {
    return "hash is not a 64-character lowercase hex hash";
  }

  return null;
}

/**
 * Structural faults in the chain: gaps, forks and entries that do not hang off
 * their predecessor.
 *
 * This does **not** re-hash anything - that would mean reproducing the exact
 * bytes `serde_json` produced, which is the disagreement storing payloads
 * verbatim exists to avoid. Byte-level proof is the Rust side's `verified`
 * flag; this is the part a person can check by reading down the column.
 *
 * Rows are expected in file order, which is the order they are written in.
 */
export function chainProblems(rows: LedgerRow[]): string[] {
  const problems: string[] = [];
  let previous: LedgerRow | null = null;

  for (const row of rows) {
    const expectedSeq = previous === null ? 1 : previous.seq + 1;
    if (row.seq !== expectedSeq) {
      problems.push(`entry ${row.seq} appears where entry ${expectedSeq} should be`);
    }

    const expectedPrev = previous === null ? GENESIS_PREV : previous.hash;
    if (row.prev !== expectedPrev) {
      problems.push(
        previous === null
          ? `entry ${row.seq} does not hang off the genesis hash`
          : `entry ${row.seq} does not link back to entry ${previous.seq}`,
      );
    }

    previous = row;
  }

  return problems;
}

/** The six events, named the way the workstation talks about them. */
export const EVENT_LABEL: Record<LedgerEvent, string> = {
  ACTIVATION: "First device binding",
  REVALIDATION: "Server revalidation",
  SCAN_COMMITTED: "Scan reserved",
  SCAN_DEBITED: "Scan spent on a certificate",
  GRACE_ENTERED: "Offline grace entered",
  GRACE_EXPIRED: "Offline grace expired",
};

/** What each event means, for the row's `title`. */
export const EVENT_NOTE: Record<LedgerEvent, string> = {
  ACTIVATION: "The first device binding for this workstation was written.",
  REVALIDATION: "A stored activation was re-read and the server accepted it again.",
  SCAN_COMMITTED: "A scan was reserved as pending. No entitlement was spent by this event.",
  SCAN_DEBITED: "A certificate was produced, so one reserved scan was actually spent.",
  GRACE_ENTERED: "The workstation entered on the server's offline grace window.",
  GRACE_EXPIRED: "The offline grace window closed while the server was unreachable.",
};
