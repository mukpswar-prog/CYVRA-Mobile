import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFirstPartyApiHost } from "../src/session.ts";

describe("isFirstPartyApiHost", () => {
  it("treats cyvoriq API hosts as first-party", () => {
    assert.equal(isFirstPartyApiHost("api.cyvoriq.co.in"), true);
    assert.equal(isFirstPartyApiHost("cyvoriq.co.in"), true);
  });

  it("keeps leftover cyvra hosts first-party during preview", () => {
    assert.equal(isFirstPartyApiHost("api-mobile.cyvra.co.in"), true);
    assert.equal(isFirstPartyApiHost("cyvra.co.in"), true);
  });

  it("treats workers.dev as cross-site", () => {
    assert.equal(
      isFirstPartyApiHost("cyvra-mobile-api.mukpswar.workers.dev"),
      false,
    );
  });

  it("treats local wrangler as first-party", () => {
    assert.equal(isFirstPartyApiHost("localhost"), true);
    assert.equal(isFirstPartyApiHost("127.0.0.1"), true);
  });
});
