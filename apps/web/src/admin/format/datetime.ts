/**
 * THE ADMIN PANEL'S ONE CLOCK - §58 DATE AND TIME.
 * ================================================
 *
 * > "The backend should store unambiguous timestamps.
 * >  The Admin UI should display: IST (Asia/Kolkata) for CYVORIQ's Indian
 * >  operations."
 * >
 * > "Date fields should be consistent across dashboard, registry, drawer and
 * >  reports."
 *
 * §58 is a *timezone* rule first and a *consistency* rule second, and the two
 * are the same rule: consistency is only achievable if every formatter reads
 * the same zone, so there has to be exactly one formatter. This module is it.
 *
 * WHY THE OLD CODE WAS WRONG
 * --------------------------
 * `LicenceTable.formatDate` used `timeZone: "UTC"` and `formatDateTime`
 * appended the literal string "UTC" to its output. That is a *correct* UTC
 * rendering, and it is still a violation: §58 does not ask for a labelled
 * zone, it asks for IST. A licence created at 00:30 IST on 06-Oct-2026 was
 * rendered as 05-Oct-2026 19:00 UTC - the right instant, the wrong calendar
 * date, on the "Created Date" column of the register the operator reads.
 *
 * The second defect was worse than the first because it was invisible: the
 * *date* half used `toLocaleDateString` with `timeZone: "UTC"`, so the two
 * halves of `formatDateTime` agreed with each other while both disagreed with
 * the wall clock on the operator's desk in India. Nothing looked broken.
 *
 * The third: `Reports.isoDay` documented itself as "Local YYYY-MM-DD" and then
 * called `toISOString().slice(0, 10)`, which is UTC - so the default report
 * range silently opened a day late for anyone east of Greenwich. The comment
 * and the code disagreed, and the code was what shipped.
 *
 * WHAT IS *NOT* IN SCOPE HERE
 * ---------------------------
 * Instants compared as instants - `expiryTone`'s day arithmetic, a "generated
 * at" written into an audit row, an ISO-8601 string on the wire - are already
 * zone-neutral and must not be routed through this module: formatting one of
 * those would turn a stored instant into a local calendar statement and lose
 * information. §58's first line ("store unambiguous timestamps") is what
 * protects those, and this module only ever *renders*.
 *
 * Nothing in `services/api` formats a date for display, which is deliberate:
 * the API is a store and a wire, and every timestamp it emits is ISO-8601.
 * The zone belongs to the surface that shows a human a calendar.
 */

/** The one zone. Named once so a grep for it finds every consumer. */
export const ADMIN_TIME_ZONE = "Asia/Kolkata";

/** How the zone is suffixed in prose. IST, never "UTC", never "GMT+05:30". */
export const ADMIN_TIME_ZONE_LABEL = "IST";

/**
 * §19's date style, read out of parts.
 *
 * `Intl.DateTimeFormat("en-GB")` renders `05 Oct 2026` - spaces, no hyphens.
 * §19's worked example is `05-Oct-2026 09:42 IST`, and the Chief Engineer has
 * ruled that style as the display format for the whole panel. Assembling from
 * `formatToParts` rather than post-processing the string with a replace means
 * the separators are *ours*: a locale change cannot silently reintroduce spaces
 * or hand back a month we then hyphenate in the wrong place.
 *
 * The month is the locale's short English name (`Oct`), which is what §19 shows
 * and what a one-or-two-word cell needs - `October` would widen every date
 * column in a table that is already twenty columns deep.
 */
const DATE_PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

/** `2026-10-06T00:30:00.000Z` -> `06-Oct-2026` in IST. */
function datePart(date: Date): string {
  const parts: Record<string, string> = {};
  for (const part of DATE_PARTS_FMT.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.day}-${parts.month}-${parts.year}`;
}

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ADMIN_TIME_ZONE,
});

/**
 * `formatToParts` rather than `Intl.DateTimeFormat("en-CA")`.
 *
 * `en-CA` renders ISO dates and is widely relied on for that, but it is a
 * locale *convention*, not a guarantee this code is entitled to assume on a
 * formatter whose whole job is to be strict. Reading the parts makes the
 * `YYYY-MM-DD` shape ours rather than the locale's.
 */
const DAY_PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

/** The em dash every absent value in this console renders as. */
const BLANK = "\u2014";

/**
 * Parse once, refuse garbage once.
 *
 * `new Date("")` is not NaN in the way callers expect - it is NaN, but
 * `new Date(" ")` and `new Date(null)` are not - so the empty string is
 * excluded before the constructor sees it. Every formatter below shares this
 * path, which is what makes `null`, `""` and a malformed timestamp all render
 * identically instead of one of them rendering `Invalid Date`.
 */
function instant(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-10-06T00:30:00.000Z` -> `06-Oct-2026` (IST). Absent -> em dash. */
export function formatDate(value: string | null | undefined): string {
  const date = instant(value);
  return date === null ? BLANK : datePart(date);
}

/** `2026-10-06T00:30:00.000Z` -> `00:30`. Absent -> em dash. */
export function formatTime(value: string | null | undefined): string {
  const date = instant(value);
  return date === null ? BLANK : TIME_FMT.format(date);
}

/**
 * `2026-10-06T00:30:00.000Z` -> `06-Oct-2026 00:30 IST`.
 *
 * This is §19's worked example, character for character: hyphens in the date,
 * a space before the time, and the zone label last. Two decisions are load
 * bearing and neither is styling:
 *
 *   - The label is part of the string, not decoration. A bare `00:30` invites
 *     the reader to assume their own zone, which is precisely the failure this
 *     module exists to prevent.
 *   - The zone is `Asia/Kolkata` whatever machine rendered it. §58 fixes the
 *     zone; §19 fixes the punctuation. Neither is negotiable and neither
 *     depends on the browser's settings.
 */
export function formatDateTime(value: string | null | undefined): string {
  const date = instant(value);
  if (date === null) return BLANK;
  return `${datePart(date)} ${TIME_FMT.format(date)} ${ADMIN_TIME_ZONE_LABEL}`;
}

/**
 * `YYYY-MM-DD` **as it reads in IST** - the shape `<input type="date">` speaks.
 *
 * This is `isoDay` from `Reports.tsx`, corrected: the old one documented
 * "Local YYYY-MM-DD" and computed UTC. Both descriptions cannot be right, and
 * neither can a half-fixed version that takes the zone from the browser - an
 * operator travelling outside India would get a different default range for
 * the same account.
 */
export function istDay(date: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const part of DAY_PARTS_FMT.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  // `h23`, not `hour12: false`: a midday-extended locale renders midnight as
  // "24" under `h24`, and a `24` in a DOS time field is out of range rather
  // than merely wrong.
  hourCycle: "h23",
  timeZone: ADMIN_TIME_ZONE,
});

export interface IstFields {
  readonly year: number;
  /** 1-12, as the calendar reads it - not the 0-11 a `Date` method returns. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Raw IST wall-clock components, for the one caller that needs numbers rather
 * than a formatted string: `xlsx.ts`'s ZIP entry timestamp.
 *
 * The ZIP format stores a DOS date/time with **no timezone field at all** - it
 * is defined as local time, so there is no way to store an absolute instant
 * in it. What there *is* a way to choose is which clock those numbers come
 * from, and the default was `new Date().getHours()`, i.e. whatever laptop
 * produced the file. For an Indian operation whose workbooks are opened in
 * India, IST is the only reading that is right for every reader rather than
 * right for whoever happened to click Export.
 *
 * Everything else - every timestamp a human actually *sees* - goes through
 * `formatDate` / `formatDateTime` instead. This exists so that those two do
 * not have to grow a third shape for a binary format's benefit.
 */
export function istFields(date: Date = new Date()): IstFields {
  const parts: Record<string, string> = {};
  for (const part of PARTS_FMT.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}
