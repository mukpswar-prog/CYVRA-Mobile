/**
 * KPI AND QUEUE NUMBERS, FROM SERVER TOTALS ONLY.
 * ===============================================
 *
 * The brief's hardest rule, in one file: *"computed ONLY from server pagination
 * totals - never client-side accumulation."*
 *
 * Why it is worth a file rather than a comment on a `useState`:
 * accumulating is the obvious implementation and it is wrong in a specific
 * direction. Summing rows the browser has already fetched under-reports
 * whenever a page fails to load, is truncated by a `pageSize`, or is filtered
 * by something the accumulator did not know about. Under-reporting "Payment
 * Pending" reads as *nothing needs doing*, which is the worst possible failure
 * mode for a number whose job is to tell somebody that something needs doing.
 *
 * So each figure is `GET /admin/serials?...&pageSize=25` -> `pagination.total`.
 * The smallest page the contract accepts, the whole answer in `total`, and the
 * count is produced by the same WHERE clause that would produce the rows - so a
 * KPI and the table behind it can never disagree.
 *
 * The requests are deduplicated before they are fired: "Payment pending" is
 * both the second KPI and the first queue item, and it is one number, so it is
 * one request.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildSerialQuery,
  countSerials,
  EMPTY_SERIAL_QUERY,
  type SerialQueryState,
} from "../client";

export interface TotalQuery {
  /** Stable key: the canonical query string for this figure. */
  readonly query: string;
  /** `pagination.total` for it, or null while unknown / on failure. */
  readonly total: number | null;
}

/** A KPI card (§43's strip, §65's home page). */
export interface KpiDef {
  readonly id: string;
  readonly label: string;
  readonly tone: "total" | "pending" | "ready" | "active" | "expiring";
  /** Applied on top of the empty query. */
  readonly patch: Partial<SerialQueryState>;
}

/** One item of §42's Needs Action queue. */
export interface QueueDef {
  readonly id: string;
  readonly label: string;
  readonly tone: "amber" | "blue" | "red";
  readonly patch: Partial<SerialQueryState>;
}

const q = (patch: Partial<SerialQueryState>): SerialQueryState => ({
  ...EMPTY_SERIAL_QUERY,
  ...patch,
});

export const KPIS: readonly KpiDef[] = Object.freeze([
  { id: "total", label: "Total licences", tone: "total", patch: {} },
  {
    id: "pending",
    label: "Payment pending",
    tone: "pending",
    patch: { status: ["PAYMENT_PENDING"] },
  },
  {
    id: "ready",
    label: "Ready to generate",
    tone: "ready",
    patch: { status: ["READY_TO_GENERATE"] },
  },
  { id: "active", label: "Active", tone: "active", patch: { status: ["ACTIVE"] } },
  {
    id: "expiring",
    label: "Expiring soon",
    tone: "expiring",
    patch: { validityEndsWithinDays: 30 },
  },
]);

/**
 * §42's five, in §42's order.
 *
 * Each maps to exactly one server filter, which is the only reason there are
 * five *rows* and not one "Needs Action" figure: FAILED delivery and
 * REBIND_REQUEST live in different columns from the three statuses, a single
 * query cannot OR across them, and adding two totals together would double-count
 * a licence that is (say) KEY_GENERATED with a pending rebind. Five honest
 * numbers, not one arithmetic error wearing a label.
 */
export const QUEUE: readonly QueueDef[] = Object.freeze([
  { id: "payment", label: "Payment pending", tone: "amber", patch: { status: ["PAYMENT_PENDING"] } },
  { id: "ready", label: "Ready to generate", tone: "blue", patch: { status: ["READY_TO_GENERATE"] } },
  { id: "approval", label: "Awaiting approval", tone: "blue", patch: { status: ["KEY_GENERATED"] } },
  { id: "delivery", label: "Failed delivery", tone: "red", patch: { delivery: ["FAILED"] } },
  { id: "rebind", label: "Rebind requested", tone: "amber", patch: { hostBinding: ["REBIND_REQUEST"] } },
]);

/** Every figure the Dashboard and the registry strip need, deduplicated. */
export function totalQueries(
  defs: readonly { readonly patch: Partial<SerialQueryState> }[],
): string[] {
  const seen = new Set<string>();
  for (const def of defs) seen.add(buildSerialQuery(q(def.patch)));
  return [...seen];
}

export interface Totals {
  loading: boolean;
  error: string | null;
  /** `null` while unknown - explicitly distinct from a loaded `0`. */
  countOf(query: string): number | null;
}

/**
 * Fetch every requested total once, in parallel, and expose them by query.
 *
 * `countOf` returns `null` rather than `0` while a figure is unknown or has
 * failed. That distinction is the whole point of a load error here: rendering
 * a failed count as `0` says "nothing is pending", which is a statement about
 * the business made up out of a network problem.
 */
export function useServerTotals(defs: readonly { readonly patch: Partial<SerialQueryState> }[]): Totals {
  const queries = useMemo(() => totalQueries(defs), [defs]);
  const [totals, setTotals] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all(
      queries.map(async (query) => {
        try {
          const response = await countSerials(query);
          return [query, response.pagination.total] as const;
        } catch (cause) {
          return [query, null] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled || mine !== generation.current) return;
      const next: Record<string, number | null> = {};
      let failures = 0;
      for (const [query, total] of entries) {
        next[query] = total;
        if (total === null) failures += 1;
      }
      setTotals(next);
      // One message for the batch: five identical banners would be noise, and
      // the reader needs to know *why* the strip is blank, not which of the
      // five requests broke.
      setError(
        failures > 0
          ? `${failures} of ${queries.length} totals could not be loaded. The figures below are incomplete - refresh rather than reading them as zero.`
          : null,
      );
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [queries]);

  return {
    loading,
    error,
    countOf: (query: string) => (query in totals ? totals[query] : null),
  };
}

/** Convenience: total for a definition, given a loaded `Totals`. */
export function totalFor(
  totals: Totals,
  patch: Partial<SerialQueryState>,
): number | null {
  return totals.countOf(buildSerialQuery(q(patch)));
}
