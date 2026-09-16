import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedOrigin } from "../src/origins.ts";

const env = { APP_ORIGIN: "https://cyvra-mobile.pages.dev" };

describe("isAllowedOrigin", () => {
  it("allows the cyvoriq product family", () => {
    assert.equal(isAllowedOrigin("https://www.cyvoriq.co.in", env), true);
    assert.equal(isAllowedOrigin("https://admin.cyvoriq.co.in", env), true);
    assert.equal(isAllowedOrigin("https://accounts.cyvoriq.co.in", env), true);
    assert.equal(isAllowedOrigin("https://cyvoriq.co.in", env), true);
    assert.equal(isAllowedOrigin("https://api.cyvoriq.co.in", env), true);
  });

  it("allows planned Pages previews", () => {
    assert.equal(
      isAllowedOrigin("https://cyvoriq-www.pages.dev", env),
      true,
    );
    assert.equal(
      isAllowedOrigin("https://abc.cyvoriq-admin.pages.dev", env),
      true,
    );
  });

  it("keeps the mobile preview and Erase admin until Phase 5", () => {
    assert.equal(isAllowedOrigin("https://mobile.cyvra.co.in", env), true);
    assert.equal(isAllowedOrigin("https://admin.cyvra.co.in", env), true);
    assert.equal(isAllowedOrigin("https://accounts.cyvra.co.in", env), true);
    assert.equal(isAllowedOrigin("https://cyvra-mobile.pages.dev", env), true);
  });

  it("never allows Erase www or the Windows API origin", () => {
    assert.equal(isAllowedOrigin("https://www.cyvra.co.in", env), false);
    assert.equal(isAllowedOrigin("https://api.cyvra.co.in", env), false);
  });

  it("rejects http and unknown hosts", () => {
    assert.equal(isAllowedOrigin("http://www.cyvoriq.co.in", env), false);
    assert.equal(isAllowedOrigin("https://evil.example", env), false);
    assert.equal(isAllowedOrigin(undefined, env), false);
  });

  it("honours APP_ORIGIN and extra allowlist", () => {
    assert.equal(
      isAllowedOrigin("https://cyvra-mobile.pages.dev", env),
      true,
    );
    assert.equal(
      isAllowedOrigin("https://extra.example", {
        ALLOWED_ORIGINS: "https://extra.example",
      }),
      true,
    );
  });
});
