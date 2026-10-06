/**
 * THE REGISTRY'S EXPORT FILTER STRING - §12's "Export XLSX" control.
 * ==================================================================
 *
 * The whole promise of that button is that the file matches what is on screen.
 * Two ways for that to break silently:
 *
 *   1. PAGING LEAKS IN - the export then contains one page of the filtered set
 *      under a filename implying the whole filtered set. Wrong in the
 *      direction of too few rows, which is the failure mode nobody notices:
 *      the file opens, the columns are right, the counts are short.
 *
 *   2. FILTERS DROP OUT - the export contains the *unfiltered* register.
 *      Wrong in the direction of too many rows, which for a table carrying
 *      customer addresses is also a disclosure problem rather than a mere
 *      inconvenience.
 *
 * Both are asserted here against `buildSerialFilters`, the one function the
 * registry's export path uses. The server-side half - that those parameters
 * are parsed by the same `parseSerialQuery` `GET /serials` uses, and that the
 * result reaches the `EXPORT_GENERATED` audit row - is
 * `services/api/test/licenceExport.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { buildSerialFilters, buildSerialQuery, EMPTY_SERIAL_QUERY } from "./client";

describe("buildSerialFilters", () => {
  it("is empty when no filter is set - a full register, not a default page", () => {
    expect(buildSerialFilters(EMPTY_SERIAL_QUERY)).toBe("");
  });

  it("drops the paging entirely, whatever page and size the operator is on", () => {
    const onFiveOfAHundred = { ...EMPTY_SERIAL_QUERY, page: 5, pageSize: 100 };
    expect(buildSerialFilters(onFiveOfAHundred)).toBe("");
    // ...while the list query itself does carry them, so the two really are
    // different strings rather than one being a rename of the other.
    expect(buildSerialQuery(onFiveOfAHundred)).toBe("page=5&pageSize=100");
  });

  it("keeps every filter the operator applied", () => {
    const filtered = {
      ...EMPTY_SERIAL_QUERY,
      q: "acme",
      status: ["REVOKED"],
      paymentStatus: ["PAID"],
      planCode: ["CAP-5"],
      customerKind: ["BULK"],
      hostBinding: ["BOUND"],
      delivery: ["FAILED"],
      validityEndsWithinDays: 30,
    };
    const filters = buildSerialFilters(filtered);
    expect(filters).toContain("q=acme");
    expect(filters).toContain("status=REVOKED");
    expect(filters).toContain("paymentStatus=PAID");
    expect(filters).toContain("planCode=CAP-5");
    expect(filters).toContain("customerKind=BULK");
    expect(filters).toContain("hostBinding=BOUND");
    expect(filters).toContain("delivery=FAILED");
    expect(filters).toContain("validityEndsWithinDays=30");
    // The page must not ride along even when every other field is populated.
    expect(filters).not.toContain("page");
    expect(filters).not.toContain("pageSize");
  });

  it("agrees with buildSerialQuery about what a filter looks like", () => {
    // Same vocabulary, same spelling: the server parses both with one parser,
    // so a filter that renders differently here would never reach it.
    const filtered = { ...EMPTY_SERIAL_QUERY, status: ["SUSPENDED"], q: "globe" };
    const exported = new URLSearchParams(buildSerialFilters(filtered));
    const listed = new URLSearchParams(buildSerialQuery(filtered));
    for (const [key, value] of exported) expect(listed.get(key)).toBe(value);
    for (const [key, value] of listed) expect(exported.get(key)).toBe(value);
  });
});
