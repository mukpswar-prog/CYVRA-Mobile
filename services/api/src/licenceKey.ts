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
 *   1-5       device slab (allowed: 1-3, 1-5, 1-7, 1-25)
 *
 * Same key may be used on devices of the same brand up to `max`.
 * Email only. Not a Windows Erase licence. Not IMEI.
 */

export const LICENCE_PREFIX = "CYVRA";
export const LICENCE_SLABS = [3, 5, 7, 25] as const;
export type LicenceSlabMax = (typeof LICENCE_SLABS)[number];
export type LicenceKind = "SINGLE" | "BULK";

export const LICENCE_KEY_RE =
  /^CYVRA(\d{2})(\d{2})(\d{4})([SB])([0-9A-F]{4})-1-(3|5|7|25)$/;

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
    throw new Error("slab must be 1-3, 1-5, 1-7 or 1-25.");
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
