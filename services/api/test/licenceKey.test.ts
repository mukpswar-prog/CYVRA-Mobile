import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

  it("supports bulk 1-25 and single 1-3 / 1-7", () => {
    const bulk = formatLicenceKey({
      at: new Date("2026-01-02T00:00:00.000Z"),
      kind: "BULK",
      slabMax: 25,
      hex4: "00AB",
    });
    assert.equal(bulk, "CYVRA02012026B00AB-1-25");
    assert.equal(parseLicenceKey(bulk)?.kind, "BULK");
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-3")?.slabMax, 3);
    assert.equal(parseLicenceKey("CYVRA11092026SA3F1-1-7")?.slabMax, 7);
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
