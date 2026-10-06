/**
 * THE API'S ONE CLOCK - §58 DATE AND TIME.
 * ========================================
 *
 * > "The backend should store unambiguous timestamps.
 * >  The Admin UI should display: IST (Asia/Kolkata) for CYVORIQ's Indian
 * >  operations."
 *
 * §58 splits into two obligations and this module is the *second* one's server
 * half: timestamps the Worker puts a calendar date on - today, in a filename -
 * must be IST, not the zone the Worker happens to boot in. Everything else the
 * API emits stays ISO-8601, because ISO-8601 with an offset *is* the
 * unambiguous storage §58's first line asks for and re-rendering it would be
 * throwing information away.
 *
 * THERE ARE TWO OF THESE, AND THAT IS DELIBERATE
 * ---------------------------------------------
 * `apps/web/src/admin/format/datetime.ts` is the other one. They are separate
 * modules because the two runtimes are separate: a Cloudflare Worker and a
 * browser SPA with no package between them that both depend on - `packages/`
 * holds only `evidence`, and standing up a shared `@cyvra/format` to hold
 * twenty lines is a larger architectural change than WS-H2 is authorised to
 * make.
 *
 * That does not make the duplication harmless, and it is called out here
 * rather than left for someone to discover: **if either zone or format
 * changes, both files change.** `git grep Asia/Kolkata` is the cross-reference
 * - it finds both and nothing else.
 *
 * Extracting them is on the disposition list, not done silently.
 *
 * The API otherwise renders no dates at all. There is no `toLocaleString`, no
 * `Intl.DateTimeFormat` and no `timeZone` anywhere else in `services/api`,
 * which is the correct shape: a store and a wire do not have a wall clock for
 * a human to read, and the surface that does is the one that picks a zone.
 */

/** The one zone. Named once so a grep for it finds every consumer. */
export const ADMIN_TIME_ZONE = "Asia/Kolkata";

/** How the zone is named in prose. IST, never "UTC", never "GMT+05:30". */
export const ADMIN_TIME_ZONE_LABEL = "IST";

/**
 * `formatToParts` rather than `Intl.DateTimeFormat("en-CA")`.
 *
 * `en-CA` renders ISO dates and is widely relied on for that, but it is a
 * locale *convention* rather than a guarantee this code is entitled to depend
 * on in the one place the shape has to be exact - §57's controlled filename.
 */
const DAY_PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

/**
 * `2026-10-05T19:00:00.000Z` -> `2026-10-06`.
 *
 * IST is UTC+05:30, so the UTC instant and the IST calendar day differ for
 * nine hours out of every twenty-four - 19:00Z is already 00:30 IST the next
 * morning. `toISOString().slice(0, 10)` would have filed that export under
 * yesterday's date, which for an end-of-day report is the difference between
 * two files that both look right.
 */
export function istDay(date: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const part of DAY_PARTS_FMT.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}
