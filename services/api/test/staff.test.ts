import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCyvoriqEmail, SUPER_ADMIN_EMAIL } from "../src/admin.ts";
import { licenceDraftError } from "../src/licenceKey.ts";

describe("ops staff policy", () => {
  it("locks super admin and the @cyvoriq.com gate", () => {
    assert.equal(SUPER_ADMIN_EMAIL, "ceo@cyvoriq.com");
    assert.equal(isCyvoriqEmail("ceo@cyvoriq.com"), true);
    assert.equal(isCyvoriqEmail("ops@cyvoriq.com"), true);
    assert.equal(isCyvoriqEmail("ceo@cyvra.co.in"), false);
    assert.equal(isCyvoriqEmail("user@gmail.com"), false);
  });

  it("allows single-user 1-device and rejects bulk 1-device", () => {
    const base = {
      customerEmail: "buyer@example.com",
      paymentNoted: "UPI transferred 2026-09-11",
      brandScope: "SAMSUNG",
      customerFullName: "Test Buyer",
    };
    assert.equal(
      licenceDraftError({ ...base, customerKind: "SINGLE", deviceMax: 1 }),
      null,
    );
    assert.match(
      licenceDraftError({ ...base, customerKind: "BULK", deviceMax: 1 }) ?? "",
      /single-user only/,
    );
    assert.match(
      licenceDraftError({ ...base, customerKind: "SINGLE", deviceMax: 1, customerFullName: "" }) ??
        "",
      /customerFullName/,
    );
  });
});
