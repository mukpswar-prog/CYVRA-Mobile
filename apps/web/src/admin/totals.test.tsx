/**
 * KPI AND QUEUE NUMBERS COME FROM `pagination.total` - NOWHERE ELSE.
 * =================================================================
 *
 * The brief's rule, tested from three directions:
 *
 * 1. DEDUPLICATION. `KPIS + QUEUE` describe ten figures but eight distinct
 *    queries, because "Payment pending" and "Ready to issue" appear in both
 *    and are one number each. The assertion is on the REQUEST COUNT, so a
 *    regression shows up as a network-shape failure rather than as a
 *    double-fetch somebody notices in a profile months later.
 *
 * 2. DERIVATION. Each card renders `pagination.total` from a count-only
 *    response whose `serials` array is deliberately EMPTY. There are no rows
 *    to walk: a fallback to `rows.length` would render zero everywhere and
 *    fail every assertion below.
 *
 * 3. FAILURE IS NOT ZERO. A count that did not come back renders `—` with a
 *    banner naming how many failed. Rendering `0` would tell an operator that
 *    nothing needs doing, which is the one sentence a "Payment pending" card
 *    must never say on the strength of a network problem.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { countSerials } from "./client";
import { KpiStrip, NeedsAction } from "./licences/Kpis";
import { KPIS, QUEUE, totalFor, totalQueries, useServerTotals } from "./licences/totals";
import type { KpiDef, QueueDef, Totals } from "./licences/totals";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, countSerials: vi.fn() };
});

const COUNTS: Record<string, number> = {
  "": 1000,
  "status=PAYMENT_PENDING": 42,
  "status=READY_TO_GENERATE": 7,
  "status=ACTIVE": 600,
  "validityEndsWithinDays=30": 3,
  "status=KEY_GENERATED": 5,
  "delivery=FAILED": 2,
  "hostBinding=REBIND_REQUEST": 1,
};

const ALL = [...KPIS, ...QUEUE];

function mockCounts(failures: string[] = []) {
  const mock = countSerials as Mock;
  mock.mockReset();
  mock.mockImplementation(async (query: string) => {
    if (failures.includes(query)) throw new Error("network down");
    const total = COUNTS[query];
    if (total === undefined) throw new Error(`unexpected query: "${query}"`);
    return {
      superAdmin: "ceo@cyvoriq.com",
      actor: "ceo@cyvoriq.com",
      serials: [],
      filters: {},
      pagination: {
        page: 1,
        pageSize: 25,
        offset: 0,
        returned: 0,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / 25),
        hasMore: total > 25,
        nextPage: total > 25 ? 2 : null,
      },
    };
  });
  return mock;
}

/** One hook instance feeding both views, exactly as the pages do. */
function Strip({ defs }: { defs: readonly (KpiDef | QueueDef)[] }) {
  const totals = useServerTotals(defs);
  return (
    <>
      <KpiStrip
        totals={totals}
        loading={totals.loading}
        onSelect={() => undefined}
        activePatch={null}
      />
      <NeedsAction totals={totals} loading={totals.loading} onSelect={() => undefined} />
    </>
  );
}

describe("the ten figures are eight requests", () => {
  it("deduplicates the queries shared between the strip and the queue", () => {
    const queries = totalQueries(ALL);
    expect(queries).toHaveLength(8);
    expect(queries.filter((query) => query === "status=PAYMENT_PENDING")).toHaveLength(1);
    expect(queries.filter((query) => query === "status=READY_TO_GENERATE")).toHaveLength(1);
  });

  it("fires exactly one request per distinct query", async () => {
    const mock = mockCounts();
    render(<Strip defs={ALL} />);
    await screen.findByText("1,000");
    expect(mock).toHaveBeenCalledTimes(8);
  });
});

describe("each figure is the server's pagination.total", () => {
  it("renders the totals from the count-only responses", async () => {
    mockCounts();
    render(<Strip defs={ALL} />);

    expect(await screen.findByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("600")).toBeInTheDocument(); // Active
    expect(screen.getByText("3")).toBeInTheDocument(); // Expiring soon
    expect(screen.getByText("5")).toBeInTheDocument(); // Awaiting approval
    expect(screen.getByText("2")).toBeInTheDocument(); // Failed delivery
    expect(screen.getByText("1")).toBeInTheDocument(); // Rebind requested

    // 42 and 7 each appear twice - once in the strip, once in the queue - and
    // that repetition is the point: two views, one underlying query.
    expect(screen.getAllByText("42")).toHaveLength(2);
    expect(screen.getAllByText("7")).toHaveLength(2);
  });

  it("shows an ellipsis, never a zero, while the counts are in flight", () => {
    mockCounts();
    render(<Strip defs={ALL} />);
    // Ten figures, all still unknown: none of them may read as "found none".
    expect(screen.getAllByText("…")).toHaveLength(10);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("a count that fails is unknown, not zero", () => {
  it("renders an em dash for the failed figure and says how many failed", async () => {
    mockCounts(["delivery=FAILED"]);
    render(<Strip defs={ALL} />);

    await screen.findByText("1,000");
    const failed = screen.getByRole("button", { name: /Failed delivery/ });
    expect(failed).toHaveTextContent("—");
    expect(failed).not.toHaveTextContent("0");

    expect(screen.getByText(/1 of 8 totals could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText(/refresh rather than reading them as zero/)).toBeInTheDocument();
  });

  it("leaves the other figures usable when one fails", async () => {
    mockCounts(["delivery=FAILED"]);
    render(<Strip defs={ALL} />);
    // 42 appears twice (strip + queue); both must resolve.
    expect(await screen.findAllByText("42")).toHaveLength(2);
    expect(screen.getByText("600")).toBeInTheDocument();
  });
});

describe("totalFor", () => {
  const totals = (values: Record<string, number | null>): Totals => ({
    loading: false,
    error: null,
    countOf: (query) => (query in values ? values[query] : null),
  });

  it("looks the figure up by its canonical query", () => {
    expect(
      totalFor(totals({ "status=PAYMENT_PENDING": 42 }), { status: ["PAYMENT_PENDING"] }),
    ).toBe(42);
  });

  it("returns null for an unknown figure - distinct from a loaded zero", () => {
    expect(totalFor(totals({}), { status: ["ACTIVE"] })).toBeNull();
    expect(totalFor(totals({ "status=ACTIVE": 0 }), { status: ["ACTIVE"] })).toBe(0);
  });
});
