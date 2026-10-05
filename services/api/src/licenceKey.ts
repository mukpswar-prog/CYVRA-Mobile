/**
 * Mobile licence key policy (11 Sep 2026).
 *
 * Format (parseable; slab is inside the key):
 *   CYVRA{dd}{mm}{yyyy}{kind}{hex4}-1-{max}
 *
 * Example: CYVRA11092026SA3F1-1-5
 *   CYVRA     product
 *   11092026  issue/create date UTC (ddmmyyyy)
 *   S         SINGLE user  (B = BULK)
 *   A3F1      4-digit hex uniqueness
 *   1-1       device slab (allowed: 1-1, 1-3, 1-5, 1-7, 1-10, 1-25, 1-50)
 *
 * Same key may be used on devices of the same brand up to `max`.
 * 1-1 is single-user, single-device only (not BULK). Email only. Not a Windows Erase licence.
 */

export const LICENCE_PREFIX = "CYVRA";
/**
 * Canonical slab set. ADD ONLY.
 *
 * ⚠ Dual source of truth: `LICENCE_KEY_RE` hardcodes the same list as a regex
 * alternation. Editing one without the other produces keys that format but
 * never parse. Every existing value must stay, in order - a "tidied" list
 * would silently break `-1-3` keys that real customers already hold, which is
 * what `licenceKey.test.ts:43-44` exists to catch.
 */
export const LICENCE_SLABS = [1, 3, 5, 7, 10, 25, 50] as const;
export type LicenceSlabMax = (typeof LICENCE_SLABS)[number];
export type LicenceKind = "SINGLE" | "BULK";

/**
 * Second, independent definition of the slab set - see the warning on
 * `LICENCE_SLABS`. The two MUST change together or a key will format but never
 * parse.
 *
 * The alternation is listed in the same numeric order as `LICENCE_SLABS`, and
 * the trailing `$` is what makes the ambiguous prefixes safe rather than lucky:
 * for `-1-10` the engine tries `1`, finds `0` where `$` demanded the end, and
 * backtracks into `10`; for `-1-50` the same backtrack reaches `50`. A slab
 * that is a strict prefix of another (`1` of `10`, `5` of `50`) therefore
 * parses correctly because the anchor refuses the short match.
 */
export const LICENCE_KEY_RE =
  /^CYVRA(\d{2})(\d{2})(\d{4})([SB])([0-9A-F]{4})-1-(1|3|5|7|10|25|50)$/;

export function kindCode(kind: LicenceKind): "S" | "B" {
  return kind === "BULK" ? "B" : "S";
}

export function kindFromCode(code: string): LicenceKind | null {
  if (code === "S") return "SINGLE";
  if (code === "B") return "BULK";
  return null;
}

export function isLicenceSlab(max: number): max is LicenceSlabMax {
  return (LICENCE_SLABS as readonly number[]).includes(max);
}

export function slabLabel(max: LicenceSlabMax): string {
  return `1-${max}`;
}

/**
 * Commercial plan codes, mirroring `plan_code_enum` in
 * `database/src/schema.ts`.
 *
 * `CAP-10` became reachable when slab 10 joined `LICENCE_SLABS` and
 * `LICENCE_KEY_RE` together (05 Oct 2026: design-freeze RULE 4 fixes the
 * standard plans at 1, 5, 10, 25, 50, and a standard plan the key cannot
 * encode is a gap rather than a plan). Until that edit the two were always
 * changed in the same change, because a `PlanCode` no key can produce is the
 * schema claiming an entitlement the key does not encode.
 *
 * `CAP-3` and `CAP-7` are LEGACY: reachable from records created before the
 * commercial plan list existed, never offered to new ones. Mapping slab 3 to
 * `CAP-5` instead would change what the customer bought while their key still
 * reads `-1-3`.
 */
export type PlanCode =
  | "CAP-1"
  | "CAP-3"
  | "CAP-5"
  | "CAP-7"
  | "CAP-10"
  | "CAP-25"
  | "CAP-50";

/**
 * Plan codes issuable to a newly created record (excludes the legacy pair).
 *
 * Must stay aligned with `ISSUABLE_SLABS` below: same five values, same order.
 * One lists codes, the other lists the slabs they encode.
 */
export const ISSUABLE_PLAN_CODES = [
  "CAP-1",
  "CAP-5",
  "CAP-10",
  "CAP-25",
  "CAP-50",
] as const;

/**
 * Slabs a **newly created** record may be born on.
 *
 * This is `ISSUABLE_PLAN_CODES` with the LEGACY pair removed, and it now equals
 * the design freeze's five standard plans exactly: 1, 5, 10, 25, 50 (RULE 4).
 *
 * `3` and `7` are excluded on policy, not on capability. `LICENCE_SLABS` keeps
 * them because real customers already hold `-1-3` / `-1-7` keys and
 * `PLAN_BY_SLAB` keeps them so those records still map - but `schema.ts` states
 * the rule outright, "reachable by backfill, never issuable to new records", so
 * a registration arriving today must not be born on a plan the product does
 * not sell. An *operator* reopening a legacy record still can: that is
 * `licenceDraftError`, which validates against `LICENCE_SLABS`.
 */
export const ISSUABLE_SLABS = [1, 5, 10, 25, 50] as const;
export type IssuableSlabMax = (typeof ISSUABLE_SLABS)[number];

/** Whether a brand-new record may claim this slab. Total over `ISSUABLE_SLABS`. */
export function isIssuableSlab(max: number): max is IssuableSlabMax {
  return (ISSUABLE_SLABS as readonly number[]).includes(max);
}

const PLAN_BY_SLAB: Readonly<Record<LicenceSlabMax, PlanCode>> = {
  1: "CAP-1",
  3: "CAP-3",
  5: "CAP-5",
  7: "CAP-7",
  10: "CAP-10",
  25: "CAP-25",
  50: "CAP-50",
};

/**
 * Plan code for a device slab. Total over `LICENCE_SLABS`; throws otherwise.
 *
 * Callers must have already run `isLicenceSlab` - this throwing is a guard
 * against a future caller that maps an unvalidated `deviceMax` straight into a
 * NOT NULL column, not a routine error path.
 */
export function planCodeFor(slabMax: number): PlanCode {
  const code = PLAN_BY_SLAB[slabMax as LicenceSlabMax];
  if (!code) {
    throw new Error(
      `no plan code for slab ${slabMax}; deviceMax must be validated with isLicenceSlab first.`,
    );
  }
  return code;
}

export function utcDateParts(at: Date): { dd: string; mm: string; yyyy: string } {
  const dd = String(at.getUTCDate()).padStart(2, "0");
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(at.getUTCFullYear());
  return { dd, mm, yyyy };
}

export function randomHex4(): string {
  const n = crypto.getRandomValues(new Uint16Array(1))[0];
  return n.toString(16).toUpperCase().padStart(4, "0");
}

export function formatLicenceKey(params: {
  at: Date;
  kind: LicenceKind;
  slabMax: LicenceSlabMax;
  hex4: string;
}): string {
  const hex = params.hex4.toUpperCase();
  if (!/^[0-9A-F]{4}$/.test(hex)) {
    throw new Error("hex4 must be 4 hexadecimal digits.");
  }
  if (!isLicenceSlab(params.slabMax)) {
    throw new Error("slab must be 1-1, 1-3, 1-5, 1-7, 1-10, 1-25 or 1-50.");
  }
  if (params.slabMax === 1 && params.kind !== "SINGLE") {
    throw new Error("1-device keys are single-user only.");
  }
  const { dd, mm, yyyy } = utcDateParts(params.at);
  return `${LICENCE_PREFIX}${dd}${mm}${yyyy}${kindCode(params.kind)}${hex}-1-${params.slabMax}`;
}

export function parseLicenceKey(key: string): {
  dd: string;
  mm: string;
  yyyy: string;
  kind: LicenceKind;
  hex4: string;
  slabMax: LicenceSlabMax;
  slabLabel: string;
} | null {
  const match = LICENCE_KEY_RE.exec(key.trim().toUpperCase());
  if (!match) return null;
  const kind = kindFromCode(match[4]);
  const slabMax = Number(match[6]);
  if (!kind || !isLicenceSlab(slabMax)) return null;
  if (slabMax === 1 && kind !== "SINGLE") return null;
  return {
    dd: match[1],
    mm: match[2],
    yyyy: match[3],
    kind,
    hex4: match[5],
    slabMax,
    slabLabel: `1-${slabMax}`,
  };
}

export function generateLicenceKey(params: {
  at: Date;
  kind: LicenceKind;
  slabMax: LicenceSlabMax;
}): string {
  return formatLicenceKey({ ...params, hex4: randomHex4() });
}

export function licenceDraftError(input: {
  customerEmail: string;
  paymentNoted: string;
  customerKind: string;
  deviceMax: number;
  brandScope: string;
  customerFullName?: string;
}): string | null {
  const email = input.customerEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return "customerEmail is required.";
  if (input.paymentNoted.trim().length < 4) {
    return "paymentNoted is required. This is a human note that payment transferred, not a gateway proof.";
  }
  const kind = input.customerKind.trim().toUpperCase();
  if (kind !== "SINGLE" && kind !== "BULK") {
    return "customerKind must be SINGLE or BULK.";
  }
  if (!isLicenceSlab(input.deviceMax)) {
    return "deviceMax slab must be 1, 3, 5, 7, 10, 25 or 50 (1-1 / 1-3 / 1-5 / 1-7 / 1-10 / 1-25 / 1-50).";
  }
  if (input.deviceMax === 1 && kind !== "SINGLE") {
    return "1-device keys are single-user only.";
  }
  if (input.brandScope.trim().length < 2) {
    return "brandScope is required (same key, same brand, up to the slab).";
  }
  if ((input.customerFullName ?? "").trim().length < 2) {
    return "customerFullName is required.";
  }
  return null;
}
