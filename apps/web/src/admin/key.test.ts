/**
 * THE MASK, PINNED TO THE SERVER'S FIXTURE.
 * ==========================================
 *
 * `maskSerialKey` in `admin.ts` and `maskSerialKey` here are two copies of one
 * rule with nothing but discipline joining them - `apps/web` does not import
 * from `services/api`, and it should not: the console must build without the
 * API package's dependencies anywhere near it.
 *
 * So the join is a shared FIXTURE instead. `adminRedaction.test.ts` on the
 * server asserts `maskSerialKey("CYVRA01102026SA3F1-1-5") ===
 * "CYVRA*************-1-5"`; this file asserts the same pair here. Either
 * copy changing alone now fails a test, and the failing test is on the side
 * that changed - which is exactly where the person who changed it is looking.
 *
 * What the drawer does with it is `LicenceDrawer`'s `KeyReveal`: masked until
 * an explicit click, because the full key arriving in the payload is not the
 * same exposure as the full key appearing on screen.
 */
import { describe, expect, it } from "vitest";
import { beforeReveal, maskSerialKey } from "./key";

describe("maskSerialKey", () => {
  it("matches the server's fixture exactly", () => {
    expect(maskSerialKey("CYVRA01102026SA3F1-1-5")).toBe("CYVRA*************-1-5");
  });

  it("matches on every slab the key format allows", () => {
    for (const slab of ["1", "3", "5", "7", "25", "50"]) {
      // Kind B, hex body `00A0` - four hex digits, exactly as the format
      // defines them: `CYVRA` + dd + mm + yyyy + kind + hex4 + `-1-` + slab.
      expect(maskSerialKey(`CYVRA01102026B00A0-1-${slab}`)).toBe(
        `CYVRA*************-1-${slab}`,
      );
    }
  });

  it("masks both SINGLE and BULK kinds", () => {
    expect(maskSerialKey("CYVRA01102026SA3F1-1-1")).toBe("CYVRA*************-1-1");
    expect(maskSerialKey("CYVRA01102026BB00A-1-1")).toBe("CYVRA*************-1-1");
  });

  it("is case-insensitive and whitespace-tolerant, like the server's", () => {
    expect(maskSerialKey("  cyvra01102026sa3f1-1-5 ")).toBe("CYVRA*************-1-5");
  });

  it("refuses to invent a mask for a value that does not parse", () => {
    // A fabricated `-1-5` on an unparseable value would read as "we know this
    // key's shape", which is precisely what we do not know.
    expect(maskSerialKey("something-else")).toBe("CYVRA-***");
    expect(maskSerialKey("")).toBe("CYVRA-***");
    // Wrong slab: rejected rather than echoed back with its tail intact.
    expect(maskSerialKey("CYVRA01102026SA3F1-1-99")).toBe("CYVRA-***");
    expect(maskSerialKey("CYVRA01102026SA3F1-2-5")).toBe("CYVRA-***");
  });

  it("never returns a substring of the input's body", () => {
    const full = "CYVRA01102026SA3F1-1-5";
    const masked = maskSerialKey(full);
    expect(masked).not.toContain("01102026");
    expect(masked).not.toContain("SA3F1");
    expect(masked).not.toContain("A3F1");
  });
});

describe("beforeReveal", () => {
  it("masks a full key", () => {
    expect(beforeReveal("CYVRA01102026SA3F1-1-5")).toBe("CYVRA*************-1-5");
  });

  it("passes an already-masked value through instead of degrading it", () => {
    // The list projection's `licenceKey` arrives masked. Re-masking it would
    // not parse (asterisks where digits belong) and would collapse to
    // `CYVRA-***`, discarding the slab suffix the server kept visible.
    expect(beforeReveal("CYVRA*************-1-5")).toBe("CYVRA*************-1-5");
  });

  it("keeps null as null rather than showing a key-shaped placeholder", () => {
    expect(beforeReveal(null)).toBeNull();
    expect(beforeReveal("")).toBeNull();
  });
});
