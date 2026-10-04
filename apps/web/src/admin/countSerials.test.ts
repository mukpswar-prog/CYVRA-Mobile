/**
 * The count request must stay inside the server's page-size contract.
 *
 * This file exists because `totals.test.tsx` mocks `countSerials` outright -
 * it asserts what the strip renders from a total, never what the total asks
 * for. That is how `pageSize=1` shipped: every KPI on the Dashboard was a 400
 * ("pageSize" must be one of 25, 50, 100) and the strip rendered em dashes
 * while the whole suite stayed green.
 *
 * So the request itself is asserted here, against the real `countSerials`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { countSerials } from "./client";

/**
 * Mirrors `PAGE_SIZES` in services/api/src/admin/search.ts. Kept literal
 * rather than imported: apps/web may not depend on the Worker's source, and
 * the server's own test pins that constant - this side pins that what it
 * *asks* for is a member of it.
 */
const SERVER_PAGE_SIZES = [25, 50, 100];

/** Stub `fetch`, run the real request, and hand back what it asked for. */
async function urlFor(query: string): Promise<string> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      serials: [],
      pagination: { page: 1, pageSize: 25, offset: 0, returned: 0, total: 0 },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  await countSerials(query);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return String((fetchMock.mock.calls[0] as unknown[])[0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("countSerials and the server's page-size contract", () => {
  it("asks for a page size the server accepts, never pageSize=1", async () => {
    const url = new URL(await urlFor("status=ACTIVE"));
    const size = url.searchParams.get("pageSize");

    expect(size).not.toBe("1");
    expect(SERVER_PAGE_SIZES).toContain(Number(size));
    expect(size).toBe("25");
  });

  it("keeps the count on page one, so `total` is read from the first page", async () => {
    const url = new URL(await urlFor("status=ACTIVE&page=4"));
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("pageSize")).toBe("25");
  });

  it("carries the filters through - the count and the table share one WHERE", async () => {
    const url = new URL(await urlFor("status=PAYMENT_PENDING&delivery=FAILED"));
    expect(url.pathname).toBe("/admin/serials");
    expect(url.searchParams.get("status")).toBe("PAYMENT_PENDING");
    expect(url.searchParams.get("delivery")).toBe("FAILED");
  });
});
