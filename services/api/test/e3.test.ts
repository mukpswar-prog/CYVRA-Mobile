/**
 * W5 PHASE 1 - THE E3 FIX, PROVEN
 * ===============================
 *
 * E3: `requireAdmin` used to fall back to `c.req.header("X-Admin-Email")` and
 * treat that free-text request header as the actor. Everything downstream -
 * `created_by`, `issued_by`, `generated_by`, `nominated_by`, and now
 * `audit_events` - would record whatever name the caller cared to type.
 *
 * The ruling: "Actor identity must come from the verified session/token. The
 * browser-supplied X-Admin-Email header must be ignored."
 *
 * Three kinds of proof, weakest first:
 *
 *   1. STRUCTURAL - nothing in `src/**` reads the header.
 *   2. IDENTITY - `/me` reports the session's address while the header
 *      claims another.
 *   3. CONSEQUENCE - a real, successful, audited write lands with the
 *      session's address in `generated_by` and the session's row in
 *      `audit_events.actor_id`, and the spoofed address appears in *no* write
 *      at all.
 *
 * The third is the one that matters. The first two would still pass if some
 * later handler read the header for a field neither of them touches.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseLicenceKey } from "../src/licenceKey.ts";
import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  paidPayment,
  staffHarness,
} from "./helpers/adminHarness.ts";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\//, "");
const SERIAL_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ROW_ID = "33333333-3333-4333-8333-333333333333";
const SPOOF = "attacker@evil.example";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Drop comment lines; `*` covers every JSDoc continuation in this codebase. */
function codeLines(source: string): Array<{ line: number; text: string }> {
  return source.split(/\r?\n/).map((text, index) => ({ line: index + 1, text })).filter(
    ({ text }) => {
      const trimmed = text.trimStart();
      if (trimmed.startsWith("*")) return false;
      if (trimmed.startsWith("/*")) return false;
      if (trimmed.startsWith("//")) return false;
      return true;
    },
  );
}

describe("E3 - structural", () => {
  it("no file in src/ reads the X-Admin-Email header", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const { line, text } of codeLines(source)) {
        if (/\.header\(\s*["']X-Admin-Email["']/.test(text)) {
          offenders.push(`${file.replace(/\\/g, "/")}:${line}: ${text.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "the browser-supplied header must have no reader anywhere in src/",
    );
  });

  it("keeps the header on the CORS allow-list so the frontend keeps sending it", async () => {
    // Deliberate: `apps/web` still sends `X-Admin-Email` (api.ts), and
    // stripping it from `allowHeaders` would break preflight for a header that
    // is now inert. The fix is to stop *reading* it, not to punish the caller
    // for offering it.
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    assert.match(index, /allowHeaders: \[[^\]]*"X-Admin-Email"/);
  });

  it("resolves identity only through the session and the admin token", () => {
    const principal = readFileSync(join(SRC, "admin", "principal.ts"), "utf8");
    // The parameter list of `resolvePrincipal` is where a header *would* enter
    // if someone re-added it.
    assert.match(principal, /export interface PrincipalCredentials \{[\s\S]*?\}/);
    const credentials = principal.match(
      /export interface PrincipalCredentials \{[\s\S]*?\}/,
    )![0];
    assert.doesNotMatch(credentials, /[Hh]eader|emailHint|requestedBy/);
    assert.match(credentials, /staffToken/);
    assert.match(credentials, /bearerToken/);
  });
});

describe("E3 - identity reported by /me", () => {
  it("reports the session's address while the header claims somebody else", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN");
    const { request } = mountAdmin(harness);
    const res = await request("/me", { token: STAFF_TOKEN, spoofEmail: SPOOF });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.email, "licadmin@cyvoriq.com");
    assert.equal(body.role, "LICENCE_ADMIN");
    assert.notEqual(body.email, SPOOF);
  });

  it("cannot promote the caller: a licence admin is still refused staff:manage", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN");
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      spoofEmail: "ceo@cyvoriq.com",
      body: { email: "new@cyvoriq.com" },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "LICENCE_ADMIN cannot staff manage.");
    // Nothing was written while deciding.
    assert.equal(harness.writes.length, 0);
  });

  it("leaves the admin token's identity at null even when the header names the owner", async () => {
    const harness = staffHarness("ops@cyvoriq.com", "OPERATOR");
    const { request } = mountAdmin(harness, { ADMIN_API_TOKEN: "automation-secret" });
    const res = await request("/me", {
      token: "automation-secret",
      spoofEmail: "ceo@cyvoriq.com",
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.email, null);
    assert.equal(body.role, null);
    assert.equal(body.superAdmin, false);
  });
});

/**
 * THE CONSEQUENCE TEST.
 *
 * `generate-key` is used because it is the one write that produces both a
 * text identity column (`generated_by`) and an audit row with a uuid identity
 * (`actor_id`) in a single request - exactly the two shapes E3 used to corrupt.
 */
describe("E3 - a successful audited write names the session, not the header", () => {
  async function generateKeyWithSpoof() {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "READY_TO_GENERATE", publicNumber: null }),
      payment: paidPayment(SERIAL_ID),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      spoofEmail: SPOOF,
      ip: "203.0.113.9",
    });
    return { harness, res };
  }

  it("succeeds, so the assertions below are about a real write", async () => {
    const { res } = await generateKeyWithSpoof();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    const serial = body.serial as Record<string, unknown>;
    assert.ok(parseLicenceKey(String(serial.licenceKey)), "a real key was allocated");
    assert.equal(body.replayed, false);
  });

  it("writes generated_by = the session address, and never the spoofed one", async () => {
    const { harness } = await generateKeyWithSpoof();
    const update = harness.writes.find(
      (w) => w.table === "mobile_serials" && w.kind === "update",
    );
    assert.ok(update, "generate-key must update the licence row");
    assert.equal(update.values.generatedBy, "licadmin@cyvoriq.com");
    assert.equal(update.values.updatedBy, "licadmin@cyvoriq.com");
    assert.notEqual(update.values.generatedBy, SPOOF);
  });

  it("writes audit_events.actor_id from the staff row, with the row's own role", async () => {
    const { harness } = await generateKeyWithSpoof();
    const audit = harness.writes.find((w) => w.table === "audit_events");
    assert.ok(audit, "generate-key must write an audit row");
    assert.equal(audit.values.actorId, OPERATOR_ROW_ID);
    assert.equal(audit.values.actorRole, "LICENCE_ADMIN");
    assert.equal(audit.values.action, "KEY_GENERATED");
    assert.equal(audit.values.entityId, SERIAL_ID);
    assert.equal(audit.values.ipAddress, "203.0.113.9");
  });

  it("leaves the spoofed address out of every value written, anywhere", async () => {
    const { harness } = await generateKeyWithSpoof();
    assert.ok(harness.writes.length > 0, "the request really did write something");
    const serialised = JSON.stringify(harness.writes);
    assert.equal(serialised.includes(SPOOF), false, serialised);
    assert.equal(serialised.includes("ceo@cyvoriq.com"), false);
  });

  it("puts the audit row inside the same transaction as the mutation", async () => {
    const { harness } = await generateKeyWithSpoof();
    const audit = harness.writes.find((w) => w.table === "audit_events");
    const update = harness.writes.find(
      (w) => w.table === "mobile_serials" && w.kind === "update",
    );
    assert.equal(audit?.inTransaction, true);
    assert.equal(update?.inTransaction, true);
    assert.ok(
      harness.writes.indexOf(audit!) > harness.writes.indexOf(update!),
      "the mutation is recorded before the trail describes it",
    );
  });
});
