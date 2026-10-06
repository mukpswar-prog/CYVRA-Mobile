/**
 * §19's DATE STYLE AND §58'S ZONE - THE TWO HALVES OF ONE TIMESTAMP.
 * ==================================================================
 *
 * §58 fixes **where**: "The Admin UI should display: IST (Asia/Kolkata)". §19
 * fixes **how**: `05-Oct-2026 09:42 IST`. Until the Chief Engineer's ruling
 * the implementation satisfied §58 and rendered `05 Oct 2026 09:42 IST` -
 * spaces where §19 has hyphens. Both are now asserted, because a formatter is
 * exactly the sort of code that "obviously works" until someone diffs its
 * output against the spec that authorised it.
 *
 * The zone tests are written against instants where UTC and IST disagree, and
 * one where they disagree about the *calendar date* as well as the hour. A test
 * that only checked a midday timestamp would pass even if the zone were
 * silently dropped, which is the defect this module was created to fix.
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_TIME_ZONE,
  ADMIN_TIME_ZONE_LABEL,
  formatDate,
  formatDateTime,
  formatTime,
  istDay,
} from "./datetime";

/**
 * The glyph `BLANK` renders, written out rather than imported: pinning the
 * literal is the stronger assertion, because a test that imported the module's
 * own constant would pass no matter what that constant became.
 */
const EM_DASH = "\u2014";

/** §19's worked example, restated so the assertion reads as a quotation. */
const SECTION_19_EXAMPLE = "05-Oct-2026 09:42 IST";

describe("§19 punctuation", () => {
  it("renders §19's example character for character", () => {
    // 09:42 IST on 05-Oct-2026 is 04:12 UTC.
    expect(formatDateTime("2026-10-05T04:12:00.000Z")).toBe(SECTION_19_EXAMPLE);
  });

  it("hyphenates the date and keeps a single space before the time", () => {
    expect(formatDateTime("2026-10-05T04:12:00.000Z")).toMatch(
      /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/,
    );
    // The shape §19 does NOT show - the pre-ruling en-GB spacing - must not
    // come back through a locale change.
    expect(formatDateTime("2026-10-05T04:12:00.000Z")).not.toMatch(/ \w{3} \d{4} /);
  });

  it("hyphenates a date-only render too, so every cell agrees", () => {
    expect(formatDate("2026-10-05T04:12:00.000Z")).toBe("05-Oct-2026");
    expect(formatDate("2026-10-05T04:12:00.000Z")).toMatch(
      /^\d{2}-[A-Z][a-z]{2}-\d{4}$/,
    );
  });

  it("labels the time IST, never UTC or a bare offset", () => {
    const rendered = formatDateTime("2026-10-05T04:12:00.000Z");
    expect(rendered.endsWith(" IST")).toBe(true);
    expect(rendered).not.toMatch(/UTC|GMT|[+-]\d{2}:\d{2}/);
    expect(ADMIN_TIME_ZONE_LABEL).toBe("IST");
  });
});

describe("§58 zone", () => {
  it("is Asia/Kolkata, named once", () => {
    expect(ADMIN_TIME_ZONE).toBe("Asia/Kolkata");
  });

  it("moves the calendar day, not just the clock", () => {
    // 19:00 UTC on 05-Oct is already 00:30 IST on 06-Oct. A formatter that
    // read UTC would print yesterday's date on the register's Created column -
    // the exact defect this module exists to prevent.
    expect(formatDateTime("2026-10-05T19:00:00.000Z")).toBe("06-Oct-2026 00:30 IST");
    expect(formatDate("2026-10-05T19:00:00.000Z")).toBe("06-Oct-2026");
    expect(istDay(new Date("2026-10-05T19:00:00.000Z"))).toBe("2026-10-06");
  });

  it("keeps the zone label truthful beside the shifted hour", () => {
    // The same instant rendered in UTC would read 19:00. The label is not
    // decoration: it is what makes the hour interpretable.
    const rendered = formatDateTime("2026-10-05T19:00:00.000Z");
    expect(rendered.startsWith("06-Oct-2026")).toBe(true);
    expect(rendered).toContain("00:30 IST");
    expect(rendered).not.toContain("19:00");
  });
});

describe("absent values", () => {
  it("renders the em dash for null, empty and malformed alike", () => {
    for (const value of [null, "", "   ", "not-a-date"]) {
      expect(formatDate(value)).toBe(EM_DASH);
      expect(formatDateTime(value)).toBe(EM_DASH);
      expect(formatTime(value)).toBe(EM_DASH);
    }
  });
});
