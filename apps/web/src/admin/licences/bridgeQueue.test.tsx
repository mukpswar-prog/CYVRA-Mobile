/**
 * WORKSTREAM A - A REGISTRATION-CREATED ROW REACHES NEEDS ACTION UNASSISTED.
 * =========================================================================
 *
 * The bridge's promise to the operator was that a customer who registers
 * appears where they already look, with **zero** admin-side code. That promise
 * has three surfaces - the registry list, the Payment pending quick-filter, and
 * the Needs Action queue. The first two are proven server-side in
 * `services/api/test/bridge.test.ts`; this is the third.
 *
 * The chain it pins is deliberately short:
 *
 *   1. the bridge writes `licence_status = 'PAYMENT_PENDING'` (server test);
 *   2. the queue's `payment` item is exactly the canonical query string
 *      `status=PAYMENT_PENDING` - asserted here as a literal, because if that
 *      patch ever changes, the row silently stops reaching the queue while
 *      every server-side test stays green;
 *   3. `totalFor` looks the figure up by that same canonical string, and a
 *      figure that never came back is `null` - rendered as `—` - not `0`.
 *
 * Point 3 is the one worth keeping. A queue that showed `0` because a count
 * request failed would be telling an operator there is nothing to do about a
 * customer whose payment is genuinely outstanding.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NeedsAction } from "./Kpis";
import { QUEUE, totalFor, type Totals } from "./totals";

function totals(values: Record<string, number | null>): Totals {
  return {
    loading: false,
    error: null,
    countOf: (query) => (query in values ? values[query] : null),
  };
}

const PAYMENT_QUEUE = QUEUE.find((item) => item.id === "payment");

describe("a bridge-created row reaches the Needs Action queue without admin-side changes", () => {
  it("matches the canonical query the queue emits", () => {
    expect(PAYMENT_QUEUE).toBeDefined();
    expect(PAYMENT_QUEUE?.patch).toEqual({ status: ["PAYMENT_PENDING"] });
  });

  it("counts it, rather than filtering it out for having no operator creator", () => {
    const figures = totals({ "status=PAYMENT_PENDING": 9 });
    expect(totalFor(figures, PAYMENT_QUEUE!.patch)).toBe(9);
  });

  it("renders the count in the queue", () => {
    render(
      <NeedsAction
        totals={totals({ "status=PAYMENT_PENDING": 9 })}
        loading={false}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("shows an un-loaded count as unknown, never as a reassuring zero", () => {
    expect(totalFor(totals({}), PAYMENT_QUEUE!.patch)).toBeNull();
  });
});
