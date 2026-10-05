import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LICENCE_SLABS,
  formatLicenceKey,
  generateLicenceKey,
  parseLicenceKey,
} from "../src/licenceKey.ts";

describe("licence key policy", () => {
  it("encodes slab and kind so they can be read from the key", () => {
    const key = formatLicenceKey({
      at: new Date("2026-09-11T08:00:00.000Z"),
      kind: "SINGLE",
      slabMax: 5,
      hex4: "A3F1",
    });
    assert.equal(key, "CYVRA11092026SA3F1-1-5");
    const parsed = parseLicenceKey(key);
    assert.equal(parsed?.kind, "SINGLE");
    assert.equal(parsed?.slabMax, 5);
    assert.equal(parsed?.slabLabel, "1-5");
    assert.equal(parsed?.yyyy, "2026");
  });

  it("supports bulk 1-25 and single 1-1 / 1-3 / 1-7", () => {
    const bulk = formatLicenceKey({
      at: new Date("2026-01-02T00:00:00.000Z"),
      kind: "BULK",
      slabMax: 25,
      hex4: "00AB",
    });
    assert.equal(bulk, "CYVRA02012026B00AB-1-25");
    assert.equal(parseLicenceKey(bulk)?.kind, "BULK");
    const one = formatLicenceKey({
      at: new Date("2026-09-11T08:00:00.000Z"),
      kind: "SINGLE",
      slabMax: 1,
      hex4: "A3F1",
    });
    assert.equal(one, "CYVRA11092026SA3F1-1-1");
    assert.equal(parseLicenceKey(one)?.slabMax, 1);
    assert.equal(parseLicenceKey(one)?.kind, "SINGLE");
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-3")?.slabMax, 3);
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-7")?.slabMax, 7);
  });

  it("encodes and decodes a 10-device key - RULE 4's fifth standard plan", () => {
    // Slab 10 was absent from `LICENCE_SLABS` while `CAP-10` sat reserved, so
    // the standard plan 10 (design freeze RULE 4, 05 Oct 2026) could be named
    // but never sold. It joined `LICENCE_SLABS` and `LICENCE_KEY_RE` together
    // - the two that "MUST change together or a key will format but never
    // parse", which is exactly the failure this test exists to rule out.
    const key = formatLicenceKey({
      at: new Date("2026-10-05T08:00:00.000Z"),
      kind: "SINGLE",
      slabMax: 10,
      hex4: "BEEF",
    });
    assert.equal(key, "CYVRA05102026SBEEF-1-10");

    // Decoded, not merely matched: the suffix has to come back as the NUMBER
    // 10, not as `1` with a stray `0` swallowed by the alternation.
    const parsed = parseLicenceKey(key);
    assert.equal(parsed?.slabMax, 10);
    assert.equal(parsed?.slabLabel, "1-10");
    assert.equal(parsed?.kind, "SINGLE");

    // The production path never supplies its own `hex4`, so round-trip the
    // generator too, in the BULK kind as well as SINGLE.
    const generated = generateLicenceKey({
      at: new Date("2026-10-05T08:00:00.000Z"),
      kind: "BULK",
      slabMax: 10,
    });
    const round = parseLicenceKey(generated);
    assert.ok(round, `generated key must parse: ${generated}`);
    assert.equal(round.slabMax, 10);
    assert.equal(round.slabLabel, "1-10");

    // The prefix ambiguity the alternation has to survive: `1` is a strict
    // prefix of `10`, so `-1-1` and `-1-10` must resolve differently, and a
    // slab nobody lists must still parse as nothing at all.
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-1")?.slabMax, 1);
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-10")?.slabMax, 10);
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-9"), null);
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-100"), null);
  });

  it("round-trips every slab the canonical list declares", () => {
    // The dual-source-of-truth warning on `LICENCE_SLABS`: a slab added to the
    // array but not to `LICENCE_KEY_RE` formats a key nothing can parse, and a
    // slab in the regex but not the array parses a key nothing accepts. Walking
    // the array in both directions catches either half.
    for (const slab of LICENCE_SLABS) {
      const key = formatLicenceKey({
        at: new Date("2026-10-05T00:00:00.000Z"),
        kind: "SINGLE",
        slabMax: slab,
        hex4: "0A0A",
      });
      assert.equal(key.endsWith(`-1-${slab}`), true, `key must end -1-${slab}`);
      const parsed = parseLicenceKey(key);
      assert.ok(parsed, `slab ${slab} formatted but did not parse: ${key}`);
      assert.equal(parsed.slabMax, slab, `slab ${slab} decoded as ${parsed.slabMax}`);
    }
    assert.deepEqual(
      [...LICENCE_SLABS],
      [1, 3, 5, 7, 10, 25, 50],
      "RULE 4's five standard plans plus the legacy pair, in numeric order",
    );
  });

  it("rejects bulk 1-device keys", () => {
    assert.throws(
      () =>
        formatLicenceKey({
          at: new Date("2026-09-11T08:00:00.000Z"),
          kind: "BULK",
          slabMax: 1,
          hex4: "A3F1",
        }),
      /single-user only/,
    );
    assert.equal(parseLicenceKey("CYVRA11092026BA3F1-1-1"), null);
  });

  it("rejects unknown slabs and lowercase hex in parse via normalize", () => {
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-9"), null);
    assert.equal(parseLicenceKey("CYVRA-M-2026-ABCDEF12"), null);
    const parsed = parseLicenceKey("cyvra11092026sa3f1-1-5");
    assert.equal(parsed?.hex4, "A3F1");
  });

  it("generateLicenceKey always parses", () => {
    const key = generateLicenceKey({
      at: new Date("2026-09-11T12:00:00.000Z"),
      kind: "SINGLE",
      slabMax: 7,
    });
    const parsed = parseLicenceKey(key);
    assert.ok(parsed);
    assert.equal(parsed?.slabMax, 7);
    assert.equal(parsed?.kind, "SINGLE");
  });
});
