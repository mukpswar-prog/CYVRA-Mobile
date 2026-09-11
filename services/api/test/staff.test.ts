import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCyvoriqEmail, SUPER_ADMIN_EMAIL } from "../src/admin.ts";

describe("ops staff policy", () => {
  it("locks super admin and the @cyvoriq.com gate", () => {
    assert.equal(SUPER_ADMIN_EMAIL, "ceo@cyvoriq.com");
    assert.equal(isCyvoriqEmail("ceo@cyvoriq.com"), true);
    assert.equal(isCyvoriqEmail("ops@cyvoriq.com"), true);
    assert.equal(isCyvoriqEmail("ceo@cyvra.co.in"), false);
    assert.equal(isCyvoriqEmail("user@gmail.com"), false);
  });
});
