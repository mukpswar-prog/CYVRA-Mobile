import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  mobileSerials,
  payments,
  staffOperators,
  staffOtpChallenges,
  staffSessions,
  type LicenceStatus,
} from "@cyvra/database/schema";
import { isUuid } from "@cyvra/evidence";
import {
  generateOtpCode,
  generateSessionToken,
  sha256Hex,
  timingSafeEqualHex,
} from "./crypto";
import { mailConfigured, sendLicenceEmail, sendOtpEmail } from "./email";
import type { Database } from "./db";
import type { Env } from "./env";
import {
  SUPER_ADMIN_EMAIL,
  isApprovedOperator,
  isCyvoriqEmail,
} from "./admin/principal";
import {
  requireAuthenticated,
  requirePermission,
  requireStaffPermission,
} from "./admin/rbac";
import {
  AGGREGATE_ENTITY_ID,
  ENTITY_LICENCE,
  ENTITY_LICENCE_EXPORT,
  ENTITY_STAFF_OPERATOR,
  ROUTE,
  actionFor,
  assertRouteAuditCoverage,
  auditEntry,
  auditMiddleware,
  requireAuditContext,
  type StaffAuditContext,
  writeAudit,
} from "./admin/audit";
import {
  failureHttpStatus,
  failureMessage,
  transition,
  type PaymentStatus,
  type TransitionContext,
  type TransitionError,
} from "./admin/state-machine";
import {
  LICENCE_KEY_RE,
  LICENCE_PREFIX,
  generateLicenceKey,
  isLicenceSlab,
  licenceDraftError,
  parseLicenceKey,
  planCodeFor,
  type LicenceKind,
  type LicenceSlabMax,
} from "./licenceKey";
import {
  SigningConfigError,
  readEntitlementPolicy,
  requireSigningKey,
  signEntitlement,
} from "./entitlementSigner";
import {
  STAFF_COOKIE,
  STAFF_TTL_MS,
  readStaffToken,
  staffCookieOptions,
} from "./session";

/*
 * `SUPER_ADMIN_EMAIL` and `isCyvoriqEmail` used to be defined here. They live
 * in `./admin/principal` now, because `principal` resolves identities and must
 * not import this module - doing so would make the module graph a cycle.
 * Re-exported so `staff.test.ts` and any other importer keeps its path.
 */
export { SUPER_ADMIN_EMAIL, isCyvoriqEmail };

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

/**
 * Licence lifecycle state.
 *
 * W5 retyped this from the old three-value union `{PENDING, ISSUED, REVOKED}`
 * to the full ten-state `licence_status_enum`. The only rename is
 * `PENDING -> PAYMENT_PENDING`; the other two literals are unchanged.
 *
 * It is an alias, not a new name, and the union is derived from the pgEnum, so
 * the API layer and the database cannot drift apart.
 */
type SerialStatus = LicenceStatus;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function jsonSerial(row: typeof mobileSerials.$inferSelect) {
  // `public_number` is NULL while a record sits in DRAFT with no key allocated
  // yet (decision A1). Parse only when there is something to parse - returning
  // `null` is the honest projection of "no key exists", not a masked key.
  const parsed = row.publicNumber === null ? null : parseLicenceKey(row.publicNumber);
  return {
    serialId: row.id,
    publicNumber: row.publicNumber,
    licenceKey: row.publicNumber,
    status: row.status,
    customerKind: row.customerKind,
    deviceMax: row.deviceMax,
    planCode: row.planCode,
    hostBindingStatus: row.hostBindingStatus,
    slabLabel: parsed?.slabLabel ?? `1-${row.deviceMax}`,
    brandScope: row.brandScope,
    customerEmail: row.customerEmail,
    customerFullName: row.customerFullName,
    companyName: row.companyName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    pincode: row.pincode,
    state: row.state,
    userId: row.userId,
    paymentNoted: row.paymentNoted,
    devicesBound: row.devicesBound,
    issuedBy: row.issuedBy,
    issuedAt: iso(row.issuedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt),
    emailedAt: iso(row.emailedAt),
    emailMessageId: row.emailMessageId,
    emailError: row.emailError,
  };
}

/**
 * 8-hex fingerprint of the licence key, matching the plan's `serialFp`
 * convention (Appendix A). Distinguishes one queue row from another without
 * the row carrying the key itself.
 *
 * `null` for a record that has not generated a key yet: there is nothing to
 * fingerprint, and hashing a placeholder would hand the UI a value that looks
 * like a real `serialFp`.
 */
async function serialFingerprint(
  publicNumber: string | null,
): Promise<string | null> {
  if (publicNumber === null) return null;
  return (await sha256Hex(publicNumber)).slice(0, 8);
}

/**
 * Hides the 13 characters that make a key unique (ddmmyyyy + kind + hex4),
 * leaving `CYVRA*************-1-5`.
 *
 * The slab suffix stays visible deliberately: it is not a secret, and an
 * operator reading a queue has to know a 1-25 from a 1-1. What must not leave
 * the server in a *list* response is the uniqueness nibble, because that is
 * the whole key.
 */
/** Exported so the redaction contract is testable; not part of any HTTP surface. */
export function maskSerialKey(publicNumber: string): string {
  const match = LICENCE_KEY_RE.exec(publicNumber.trim().toUpperCase());
  if (!match) return `${LICENCE_PREFIX}-***`;
  return `${LICENCE_PREFIX}${"*".repeat(13)}-1-${match[6]}`;
}

/**
 * List projection: every field `jsonSerial` produces **except** the key,
 * replaced by a masked form plus a short fingerprint.
 *
 * Both aliases are handled. `jsonSerial` emits the full key twice - as
 * `publicNumber` *and* as `licenceKey` (admin.ts L70-71) - and the ops table
 * renders the latter. Stripping only one of the two would leave the key fully
 * exposed through the other, which is the sort of leak that survives review
 * precisely because it is spelled differently.
 *
 * The full key is available only from `GET /admin/serials/:serialId`.
 */
/** Exported for tests: the list response must never carry a recoverable key. */
export async function jsonSerialList(row: typeof mobileSerials.$inferSelect) {
  const { publicNumber, licenceKey: _fullKey, ...rest } = jsonSerial(row);
  // No key yet -> nothing to mask and nothing to fingerprint. Both stay null
  // rather than becoming a fabricated `CYVRA-***`, which would read as a real
  //-but-unavailable key to the operator.
  const masked = publicNumber === null ? null : maskSerialKey(publicNumber);
  return {
    ...rest,
    licenceKey: masked,
    publicNumberMasked: masked,
    serialFp: await serialFingerprint(publicNumber),
  };
}

/** Page size bounds for `GET /admin/serials`. 0 is not a valid limit. */
const SERIAL_PAGE_MIN = 1;
const SERIAL_PAGE_MAX = 100;
const SERIAL_PAGE_DEFAULT = 25;

function readPageParams(query: URLSearchParams): { limit: number; offset: number } {
  const limitRaw = Number(query.get("limit") ?? "");
  const offsetRaw = Number(query.get("offset") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.trunc(limitRaw), SERIAL_PAGE_MAX)
    : SERIAL_PAGE_DEFAULT;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0
    ? Math.trunc(offsetRaw)
    : 0;
  return {
    limit: Math.max(limit, SERIAL_PAGE_MIN),
    offset,
  };
}

/*
 * `isApprovedOperator`, `lookupStaffEmail` and `requireAdmin` used to live
 * here. They moved to `./admin/principal`, and `requireAdmin` was replaced by
 * `requireRole` / `requirePermission` / `requireStaffPermission` from
 * `./admin/rbac`.
 *
 * The important deletion is the last three lines of the old `requireAdmin`:
 *
 *     const email = normalizeEmail(c.req.header("X-Admin-Email") ?? "");
 *     if (!(await isApprovedOperator(db, email))) ...
 *     return { email };
 *
 * A browser-supplied header was being used as the actor's identity. That is
 * the E3 defect; see `./admin/principal` for what replaces it.
 */

async function uniqueLicenceKey(
  db: Pick<Database, "select">,
  kind: LicenceKind,
  slabMax: LicenceSlabMax,
  at: Date,
): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const key = generateLicenceKey({ at, kind, slabMax });
    const [existing] = await db
      .select({ id: mobileSerials.id })
      .from(mobileSerials)
      .where(eq(mobileSerials.publicNumber, key))
      .limit(1);
    if (!existing) return key;
  }
  throw new Error("Could not allocate a unique licence key.");
}

/**
 * The payment status a `TransitionContext` should report for this licence.
 *
 * Read on `idx_payments_licence_id`, inside the caller's transaction, so the
 * precondition check sees the same snapshot of the world as the mutation it is
 * guarding - no window in which a payment is confirmed between the check and
 * the write, or a refund lands between them.
 *
 * Always supplied rather than left undefined, even on edges with no payment
 * precondition. Leaving it out would make a future edge that *does* care fail
 * closed while reporting `actual: null`, i.e. claiming "there is no payment"
 * when there may well be one - a refusal that points the operator at the wrong
 * thing. `null` here means genuinely absent, and it is what the machine means
 * when it says `PAID` was not observed.
 *
 * A licence with no `payments` row returns `null`. After Phase 1 every licence
 * is created with one, so this is the marker of a row that predates that rule
 * rather than a routine case.
 */
async function paymentStatusFor(
  tx: Pick<Database, "select">,
  licenceId: string,
): Promise<PaymentStatus | null> {
  const [payment] = await tx
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.licenceId, licenceId))
    .limit(1);
  return payment?.status ?? null;
}

/**
 * The context every licence transition in this file is judged against.
 *
 * `actorKind` is hard-coded to `"admin"` because that is the only value an
 * HTTP route may ever claim - the two `system` edges (`ISSUED -> ACTIVE`,
 * `ACTIVE -> EXPIRED`) are unreachable from here by construction rather than
 * by remembering to pass the right string at each of the five call sites.
 *
 * There is deliberately no way to ask for `"system"` from a route.
 */
function adminTransitionContext(input: {
  paymentStatus: PaymentStatus | null;
  keyPresent: boolean;
  reason?: string | null;
}): TransitionContext {
  return {
    actorKind: "admin",
    paymentStatus: input.paymentStatus,
    keyPresent: input.keyPresent,
    reason: input.reason ?? null,
  };
}

/**
 * §37's "Reason", as typed by the client.
 *
 * Returns `""` for anything that is not a string, rather than coercing: a
 * reason of `0` or `false` should be refused as missing, and coercing would
 * write `"0"` into an immutable audit row forever.
 *
 * The emptiness check itself belongs to the state machine (`ReasonRequired`),
 * so that this function cannot disagree with what the transition requires.
 */
function readReason(body: unknown): string {
  const value = (body as { reason?: unknown } | null | undefined)?.reason;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A payment amount, as `payments.amount` stores it: an unbounded `numeric`
 * whose Drizzle type is `string | null`.
 *
 * Strict by design. A number is rendered to exactly two decimals; a string is
 * accepted only if it is already a plain decimal with at most two places.
 * Anything else - a negative value, `"12.345"`, an object, `"abc"` - returns
 * `null` and the field is simply left unset rather than stored. `numeric`
 * would raise at the driver for some of those, but not all, and a value that
 * survives only because the database happened to tolerate it is not validated.
 */
function readAmount(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value.toFixed(2);
  }
  if (typeof value === "string" && /^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

/** A free-text payment reference. Empty is `null`, and 200 characters is enough. */
function readReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/**
 * `mobile_serials.customer_kind` is a `text` column, so TypeScript reports
 * `string` where the domain has exactly two values. `POST /serials` validates
 * through `licenceDraftError`, so anything else can only arrive by a write
 * that skipped the API.
 *
 * Narrowed rather than cast because this runs at the one moment a key is
 * generated: `kindCode()` maps the kind to a single character inside the key
 * itself, and an unrecognised value would produce a credential whose format
 * depends on whatever happens to be in the database - readable by nobody,
 * detected by nobody, emailed to a customer.
 */
function readLicenceKind(value: string): LicenceKind | null {
  return value === "SINGLE" || value === "BULK" ? value : null;
}

function parseReportDate(raw: string, endOfDay: boolean): Date | null {
  if (!raw) return endOfDay ? new Date() : new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T${endOfDay ? "23:59:59.999Z" : "00:00:00.000Z"}`);
  }
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

/**
 * Report projection: the SAME masked projection `GET /serials` uses.
 *
 * The report is a bulk list under `requireAdmin`, exactly like `/serials`, so
 * leaving it on `jsonSerial` would make the redaction cosmetic - identical
 * auth, identical rows, and the CSV is the copy that actually leaves the box
 * as an attachment. `GET /serials/:serialId` remains the one-row path to the
 * real key; key *distribution* happens through `/issue`, which emails it.
 *
 * `serialFp` is load-bearing rather than decorative: `maskSerialKey` hides the
 * whole 13-character uniqueness block, so every `-1-5` key masks to the same
 * string. Without the fingerprint, two rows in an export would be
 * indistinguishable and reconciliation would silently compare like with like.
 *
 * Exported so the redaction contract is testable - the same reason
 * `maskSerialKey` / `jsonSerialList` are exported. Not an HTTP surface: the
 * report route is the only caller.
 */
export async function reportRows(rows: (typeof mobileSerials.$inferSelect)[]) {
  return Promise.all(rows.map((row) => jsonSerialList(row)));
}

/**
 * Exported for tests: a header that no longer resolves against the row emits an
 * empty cell silently, so the column list is checked against the projection
 * rather than eyeballed.
 */
export function toCsv(rows: Awaited<ReturnType<typeof jsonSerialList>>[]): string {
  const headers = [
    "licenceKey",
    "serialFp",
    "status",
    "customerKind",
    "slabLabel",
    "deviceMax",
    "devicesBound",
    "brandScope",
    "customerEmail",
    "customerFullName",
    "companyName",
    "addressLine1",
    "addressLine2",
    "pincode",
    "state",
    "paymentNoted",
    "issuedBy",
    "createdAt",
    "issuedAt",
    "revokedAt",
    "emailedAt",
    "emailMessageId",
    "emailError",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers.map((key) => csvCell(row[key as keyof typeof row] as string | number | null)).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

/*
 * Captures the audit frame (actor, IP, route) for every admin request before
 * any handler runs. Registered ahead of the routes so the frame exists by the
 * time one is needed.
 *
 * It never rejects anything: `/auth/*` runs before a session exists and must
 * still work, and the 401/403 belongs to the route's own gate. An
 * unauthenticated caller simply gets no frame, and a handler that goes on to
 * write an audit row will fail closed.
 *
 * The actor comes from `authenticate()` - a verified staff session - never
 * from `X-Admin-Email` (E3). See `./admin/audit` and `./admin/principal`.
 */
adminRoutes.use("*", auditMiddleware());

adminRoutes.post("/auth/request", async (c) => {
  const email = normalizeEmail(
    String(((await c.req.json().catch(() => ({}))) as { email?: string }).email ?? ""),
  );
  if (!isCyvoriqEmail(email)) {
    return c.json({ error: "Only @cyvoriq.com emails can sign in to ops." }, 403);
  }
  const db = c.get("db");
  if (!(await isApprovedOperator(db, email))) {
    return c.json(
      { error: "This email is not nominated by ceo@cyvoriq.com." },
      403,
    );
  }
  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const [challenge] = await db
    .insert(staffOtpChallenges)
    .values({
      email,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    })
    .returning({ id: staffOtpChallenges.id });
  const result = await sendOtpEmail(c.env, {
    email,
    code,
    challengeId: challenge.id,
    purpose: "staff",
  });
  if (!result.sent && c.env.API_ENV === "production") {
    return c.json({ error: `Could not send ops code: ${result.error ?? "email failed"}` }, 502);
  }
  return c.json({
    challengeId: challenge.id,
    delivery: result.sent ? "email" : "dev-log",
    mailConfigured: mailConfigured(c.env),
    devCode: result.devCode,
    mailError: result.error ?? null,
    message: result.sent
      ? "We emailed a 6-digit ops sign-in code. Check Inbox, Spam, and Promotions."
      : `Email was not sent (${result.error ?? "preview"}). API_ENV is still preview, so the on-screen code works until Resend delivers.`,
  });
});

adminRoutes.post("/auth/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    challengeId?: string;
    code?: string;
  };
  const challengeId = (body.challengeId ?? "").trim();
  const code = (body.code ?? "").trim();
  if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) {
    return c.json({ error: "challengeId and 6-digit code are required." }, 400);
  }
  const db = c.get("db");
  const [challenge] = await db
    .select()
    .from(staffOtpChallenges)
    .where(eq(staffOtpChallenges.id, challengeId))
    .limit(1);
  if (!challenge || challenge.consumedAt) {
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    return c.json({ error: "Too many attempts. Request a new code." }, 401);
  }
  const got = await sha256Hex(code);
  if (!timingSafeEqualHex(challenge.codeHash, got)) {
    await db
      .update(staffOtpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(staffOtpChallenges.id, challengeId));
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (!(await isApprovedOperator(db, challenge.email))) {
    return c.json({ error: "This email is not nominated by ceo@cyvoriq.com." }, 403);
  }
  await db
    .update(staffOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(staffOtpChallenges.id, challengeId));
  const token = generateSessionToken();
  await db.insert(staffSessions).values({
    email: challenge.email,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + STAFF_TTL_MS),
  });
  setCookie(c, STAFF_COOKIE, token, staffCookieOptions(c));
  return c.json({
    operator: { email: challenge.email, superAdmin: challenge.email === SUPER_ADMIN_EMAIL },
    token,
  });
});

adminRoutes.post("/auth/logout", async (c) => {
  const token = readStaffToken(c);
  if (token) {
    const db = c.get("db");
    await db
      .delete(staffSessions)
      .where(eq(staffSessions.tokenHash, await sha256Hex(token)));
  }
  deleteCookie(c, STAFF_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

adminRoutes.get("/me", async (c) => {
  const admin = await requireAuthenticated()(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  return c.json({
    // `null` only for a service principal, which has no person behind it (E3).
    email: admin.email,
    role: admin.kind === "staff" ? admin.role : null,
    superAdmin: admin.kind === "staff" && admin.role === "SUPER_ADMIN",
    superAdminEmail: SUPER_ADMIN_EMAIL,
  });
});

adminRoutes.get("/staff", async (c) => {
  /*
   * §41 has no "View staff" row - only "Manage staff", which is SUPER_ADMIN
   * alone. The roster itself carries no secrets (address, status, nominator),
   * and the write paths below are gated on `staff:manage`, so reading it is
   * allowed to every authenticated principal. That keeps the admin UI's staff
   * panel working for a LICENCE_ADMIN while only the owner can change it.
   */
  const admin = await requirePermission("serial:read")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const db = c.get("db");
  const rows = await db
    .select()
    .from(staffOperators)
    .orderBy(desc(staffOperators.nominatedAt));
  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: admin.email,
    operators: rows.map((row) => ({
      staffId: row.id,
      email: row.email,
      status: row.status,
      // §41's matrix is enforced on it; surfacing it lets the UI stop
      // guessing a role from the address.
      role: row.role,
      nominatedBy: row.nominatedBy,
      nominatedAt: iso(row.nominatedAt),
      revokedAt: iso(row.revokedAt),
    })),
  });
});

adminRoutes.post("/staff", async (c) => {
  // §41: "Manage staff - Super Admin only". The matrix says the same thing the
  // old `admin.email !== SUPER_ADMIN_EMAIL` check did, but it says it once,
  // for every route, in a table that can be read.
  const admin = await requireStaffPermission("staff:manage")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = normalizeEmail(body.email ?? "");
  if (!isCyvoriqEmail(email) || email === SUPER_ADMIN_EMAIL) {
    return c.json({ error: "Nominate a @cyvoriq.com address other than the super admin." }, 400);
  }
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.email, email))
    .limit(1);
  // Already live: nothing changes, so nothing is audited. Returning the row
  // instead of a second insert is what makes a repeated nomination idempotent.
  if (existing && existing.status === "ACTIVE") {
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        role: existing.role,
        nominatedBy: existing.nominatedBy,
        nominatedAt: iso(existing.nominatedAt),
      },
      replayed: true,
    });
  }
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const now = new Date();

  const audit = (entityId: string, previous: Record<string, unknown>, next: Record<string, unknown>) =>
    auditEntry(frame, {
      action: actionFor(ROUTE.createStaff),
      entityType: ENTITY_STAFF_OPERATOR,
      entityId,
      previousState: previous,
      newState: next,
    });

  if (existing) {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(staffOperators)
        .set({
          status: "ACTIVE",
          nominatedBy: admin.email,
          nominatedAt: now,
          revokedAt: null,
        })
        .where(eq(staffOperators.id, existing.id))
        .returning();
      if (!row) return null;
      // Row and trail in one unit: a nomination that is not recorded must not
      // have happened, and a recorded nomination must have happened.
      await writeAudit(
        tx,
        audit(
          row.id,
          { status: existing.status, role: existing.role, nominatedBy: existing.nominatedBy },
          { status: row.status, role: row.role, nominatedBy: row.nominatedBy },
        ),
      );
      return row;
    });
    if (!updated) return c.json({ error: "Operator not found." }, 404);
    return c.json({
      operator: {
        staffId: updated.id,
        email: updated.email,
        status: updated.status,
        role: updated.role,
        nominatedBy: updated.nominatedBy,
        nominatedAt: iso(updated.nominatedAt),
      },
      replayed: false,
    });
  }
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(staffOperators).values({
      id,
      email,
      status: "ACTIVE",
      // `role` is deliberately not accepted from the request body: who may do
      // what is decided by §41 on the server, never by a field the browser
      // chose (plan 19: "Never trust ... role=admin").
      nominatedBy: admin.email,
      nominatedAt: now,
    });
    await writeAudit(
      tx,
      audit(id, { status: null }, { status: "ACTIVE", nominatedBy: admin.email }),
    );
  });
  return c.json({
    operator: {
      staffId: id,
      email,
      status: "ACTIVE",
      nominatedBy: admin.email,
      nominatedAt: iso(now),
    },
    replayed: false,
  }, 201);
});

adminRoutes.post("/staff/:staffId/revoke", async (c) => {
  const admin = await requireStaffPermission("staff:manage")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const staffId = c.req.param("staffId");
  if (!isUuid(staffId)) return c.json({ error: "staffId must be a UUID." }, 400);
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.id, staffId))
    .limit(1);
  if (!existing) return c.json({ error: "Operator not found." }, 404);
  // Already revoked: return the same answer without writing again, so a
  // double-click or a retried request cannot put two revocations in the trail
  // for one decision (plan 48).
  if (existing.status === "REVOKED") {
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        revokedAt: iso(existing.revokedAt),
      },
      replayed: true,
    });
  }
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const revokedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(staffOperators)
      .set({ status: "REVOKED", revokedAt })
      .where(eq(staffOperators.id, staffId))
      .returning();
    if (!row) return null;
    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.revokeStaff),
        entityType: ENTITY_STAFF_OPERATOR,
        entityId: row.id,
        previousState: { status: existing.status, role: existing.role },
        newState: { status: row.status, role: row.role },
      }),
    );
    return row;
  });
  if (!updated) return c.json({ error: "Operator not found." }, 404);
  return c.json({
    operator: {
      staffId: updated.id,
      email: updated.email,
      status: updated.status,
      revokedAt: iso(updated.revokedAt),
    },
    replayed: false,
  });
});

adminRoutes.get("/serials", async (c) => {
  const admin = await requirePermission("serial:read")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const db = c.get("db");
  const { limit, offset } = readPageParams(new URL(c.req.url).searchParams);

  const rows = await db
    .select()
    .from(mobileSerials)
    .orderBy(desc(mobileSerials.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db.select({ total: count() }).from(mobileSerials);
  const total = totalRow?.total ?? 0;

  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: admin.email,
    // Keys are never in a list response: masked + fingerprinted only.
    serials: await Promise.all(rows.map(jsonSerialList)),
    pagination: { limit, offset, total, hasMore: offset + rows.length < total },
  });
});

/**
 * Full detail for one serial, the **only** list-adjacent route that returns
 * the complete `publicNumber`.
 *
 * It is a separate, single-resource fetch on purpose: a bulk endpoint that
 * can be made to return every key at once is a breach waiting for a missing
 * filter, and the recon report flagged exactly that on `GET /serials`.
 */
adminRoutes.get("/serials/:serialId", async (c) => {
  const admin = await requirePermission("serial:read")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const db = c.get("db");
  const [row] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.id, serialId))
    .limit(1);
  if (!row) return c.json({ error: "Serial not found." }, 404);

  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: admin.email,
    serial: jsonSerial(row),
    serialFp: await serialFingerprint(row.publicNumber),
  });
});

adminRoutes.post("/serials", async (c) => {
  // §41: create licence = Super Admin / Licence Admin / Operator. An AUDITOR
  // is refused here, which is the first place the read-only rule bites.
  const admin = await requireStaffPermission("serial:create")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const customerEmail = normalizeEmail(String(body.customerEmail ?? ""));
  const paymentNoted = String(body.paymentNoted ?? "").trim();
  const customerKind = String(body.customerKind ?? "SINGLE").toUpperCase();
  const deviceMax = Number(body.deviceMax ?? body.slabMax ?? 1);
  const brandScope = String(body.brandScope ?? "").trim().toUpperCase();
  const customerFullName = String(body.customerFullName ?? "").trim();
  const draftError = licenceDraftError({
    customerEmail,
    paymentNoted,
    customerKind,
    deviceMax,
    brandScope,
    customerFullName,
  });
  if (draftError) {
    return c.json({ error: draftError }, 400);
  }
  if (!isLicenceSlab(deviceMax)) {
    return c.json({ error: "deviceMax slab must be 1, 3, 5, 7, 25 or 50 (1-1 / 1-3 / 1-5 / 1-7 / 1-25 / 1-50)." }, 400);
  }
  const kind: LicenceKind = customerKind === "BULK" ? "BULK" : "SINGLE";

  const createdAt = new Date();
  const db = c.get("db");

  /*
   * DECISION A1 - NO KEY IS ALLOCATED AT CREATION ANY MORE.
   *
   * `uniqueLicenceKey` used to run here, which is why the comment below the
   * `generatedBy` column could say "created and generated genuinely happen in
   * the same request". A1 rules that records are created with no key and that
   * `POST /serials/:id/generate-key` allocates one, and §49 agrees: the path to
   * `KEY_GENERATED` runs through `READY_TO_GENERATE`, which cannot be reached
   * from a record that already holds a key.
   *
   * So `public_number` is NULL until the Green Key Rule has been satisfied
   * server-side. That is also what makes the rule enforceable: there is no
   * key to hand out before payment is confirmed, rather than a key that exists
   * and merely happens not to have been shown.
   */
  const id = crypto.randomUUID();
  const row = {
    id,
    // A1: no key until `generate-key` runs. NULL is the truthful projection of
    // "nothing has been generated", and `jsonSerial` already returns null for
    // it rather than a masked placeholder.
    publicNumber: null,
    status: "PAYMENT_PENDING" as SerialStatus,
    customerEmail,
    userId: null,
    paymentNoted,
    // `issued_by` is NOT NULL in the schema (a pre-W5 column), so it must name
    // somebody from the first moment. It names the creator until issuance
    // overwrites it with the actual issuer. Real fixes need `created_by` to
    // carry the meaning and `issued_by` to be nullable - migration 0008, not
    // Phase 1.
    issuedBy: admin.email,
    issuedAt: null,
    revokedAt: null,
    createdAt,
    // W5: the creator finally survives creation. `issued_by` used to be the
    // only actor column and was overwritten at issue time, so the creator's
    // identity was destroyed by every successful issuance - see migration 0007
    // section C3 for the rows where that loss is permanent.
    createdBy: admin.email,
    // NULL until `POST /serials/:id/generate-key`. Allocation moved there in
    // Phase 1 (decision A1), so `generated_by` now records the person who
    // actually generated a key instead of the person who typed a form.
    generatedBy: null,
    approvedBy: null,
    hostBindingStatus: "NOT_BOUND",
    planCode: planCodeFor(deviceMax),
    // Validity window is not assigned until issuance (Phase 1). NULL is the
    // truthful value for a record that has no window yet; backfilling one here
    // would invent a start date the system never recorded.
    validityStartsAt: null,
    validityEndsAt: null,
    updatedBy: null,
    rowVersion: 1,
    customerKind: kind,
    deviceMax,
    brandScope,
    customerFullName: customerFullName || null,
    companyName: String(body.companyName ?? "").trim() || null,
    addressLine1: String(body.addressLine1 ?? "").trim() || null,
    addressLine2: String(body.addressLine2 ?? "").trim() || null,
    pincode: String(body.pincode ?? "").trim() || null,
    state: String(body.state ?? "").trim() || null,
    devicesBound: 0,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    // A freshly issued serial is bound to nothing. These are written only by
    // `POST /v1/activation`, never by issuance - issuing a key must not make it
    // look as though a workstation had already claimed it.
    hostFingerprint: null,
    firstActivatedAt: null,
    deviceTokenHash: null,
    // `satisfies` rather than a plain annotation: it checks that every column
    // the table now has is accounted for here (which is what caught the nine
    // W5 columns when this was first written) without widening the string
    // literals the way annotating the variable would.
  } satisfies typeof mobileSerials.$inferInsert;

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  /*
   * ONE TRANSACTION, THREE WRITES, NO PARTIAL CREATION.
   *
   *   1. the licence row,
   *   2. its payment row,
   *   3. the audit row for the creation.
   *
   * The payment row is not optional. §50 models PAYMENTS as one row per
   * licence and the schema comment on `payments` repeats it: financial truth
   * lives there, and `licence_status` may only move to PAYMENT_CONFIRMED as a
   * transactional consequence of `payments.status = 'PAID'` (decision A3).
   * Creating a licence with no payment row would leave a record that can never
   * satisfy the Green Key Rule, because there would be nothing to ever mark
   * PAID - the generate-key route would refuse it forever.
   *
   * `amount`, `reference`, `confirmed_by` and `confirmed_at` are left NULL
   * because the form did not record them as facts. `status` starts PENDING,
   * which is what §12's "Save as Pending" means; §64's "Confirm Payment" is
   * what moves it to PAID, and it is that action which is auditable.
   *
   * Ordering matters only in that all three share the handle: if the audit row
   * cannot be written, the licence does not exist either.
   */
  await db.transaction(async (tx) => {
    await tx.insert(mobileSerials).values(row);
    await tx.insert(payments).values({
      licenceId: id,
      status: "PENDING",
    });
    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.createSerial),
        entityType: ENTITY_LICENCE,
        entityId: id,
        // No previous state: the row did not exist. A creation has no "before".
        previousState: null,
        newState: {
          status: "PAYMENT_PENDING",
          planCode: row.planCode,
          deviceMax: row.deviceMax,
          // Recorded explicitly so the trail shows the licence was created
          // without a key, not that a key went missing later.
          publicNumber: null,
        },
      }),
    );
  });
  return c.json({ serial: jsonSerial(row) }, 201);
});

/**
 * §64 - "PAYMENT DONE" SHOULD NOT BE A SIMPLE CHECKBOX.
 *
 * Instead of ticking a box, the operator presses a controlled status action,
 * and this endpoint is that action. It performs **two** edges of §49 in one
 * transaction:
 *
 *     PAYMENT_PENDING -> PAYMENT_CONFIRMED -> READY_TO_GENERATE
 *
 * WHY BOTH, AND WHY IN ONE TRANSACTION
 * ------------------------------------
 * §13 (QUICK APPROVAL WORKFLOW) says the row "immediately changes" to
 * `Generate Key [GREEN]` once the payment is confirmed, and §21/§65 count a
 * KPI named "Ready to Generate". A KPI counts rows sitting in a state, so
 * `READY_TO_GENERATE` has to be somewhere a licence can *rest* - if this route
 * stopped at `PAYMENT_CONFIRMED` nothing would ever reach
 * `READY_TO_GENERATE`, and the Generate Key button would have no state to key
 * off. So the resting state after confirmation is `READY_TO_GENERATE`, and
 * `PAYMENT_CONFIRMED` is the marker this route passes through.
 *
 * Both edges are still checked individually by `transition()`. Collapsing them
 * into a single invented `PAYMENT_PENDING -> READY_TO_GENERATE` edge would have
 * meant teaching the map something §49 does not contain, which is the whole
 * thing the map exists to prevent.
 *
 * ONE AUDIT ROW, NOT TWO: §20's worked example records "Payment changed
 * PENDING -> PAID" as a single event for a single click. The row's action is
 * `PAYMENT_CONFIRMED` - *why* it changed - while `previous_state` and
 * `new_state` record the whole hop, `PAYMENT_PENDING` -> `READY_TO_GENERATE`.
 * An audit trail that inserted a synthetic intermediate row would be reporting
 * an internal checkpoint as though somebody had done something.
 *
 * DECISION A3 IS ENFORCED HERE: `payments.status` is written to `PAID` first,
 * in this same transaction, and only then is `PAYMENT_CONFIRMED` granted. The
 * licence status can never become a claim about money that was not actually
 * recorded as received - which is exactly what A3's "transactional consequence"
 * wording demands.
 */
adminRoutes.post("/serials/:serialId/confirm-payment", async (c) => {
  const admin = await requireStaffPermission("payment:confirm")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = readAmount(body.amount);
  const reference = readReference(body.reference);
  const db = c.get("db");
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(
    async (tx): Promise<ConfirmOutcome> => {
      const [licence] = await tx
        .select()
        .from(mobileSerials)
        .where(eq(mobileSerials.id, serialId))
        .for("update")
        .limit(1);
      if (!licence) return { kind: "not-found" };

      // Already past the point of confirmation -> the work is done. Checked
      // before anything is written so a retry produces no second audit row.
      if (licence.status !== "DRAFT" && licence.status !== "PAYMENT_PENDING") {
        return { kind: "replay", row: licence };
      }

      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.licenceId, serialId))
        .limit(1);
      const previousPaymentStatus = payment?.status ?? null;

      /*
       * Write the money first.
       *
       * `payments.licence_id` has no UNIQUE constraint (0007 gives it an FK
       * and a btree index only), so an upsert is not available and would fail
       * outright if it were attempted. The row lock taken on `licence` above
       * is what makes this safe instead: two concurrent confirmations
       * serialise, so the second reads the row the first wrote and takes the
       * update branch rather than inserting a duplicate - which is what keeps
       * migration 0007's assertion E (`payments` = one row per licence) true
       * after this route starts being used.
       */
      if (!payment) {
        await tx.insert(payments).values({
          licenceId: serialId,
          status: "PAID",
          amount,
          reference,
          confirmedBy: admin.email,
          confirmedAt: new Date(),
        });
      } else if (payment.status !== "PAID" || payment.confirmedAt === null) {
        await tx
          .update(payments)
          .set({
            status: "PAID",
            // Supplied values win; anything not supplied keeps whatever the
            // row already held rather than being nulled out by omission.
            amount: amount ?? payment.amount,
            reference: reference ?? payment.reference,
            confirmedBy: admin.email,
            confirmedAt: payment.confirmedAt ?? new Date(),
          })
          .where(eq(payments.id, payment.id));
      }

      const paymentStatus = await paymentStatusFor(tx, serialId);

      const first = transition(
        licence.status,
        "PAYMENT_CONFIRMED",
        adminTransitionContext({
          paymentStatus,
          keyPresent: licence.publicNumber !== null,
        }),
      );
      if (!first.ok) return { kind: "forbidden", error: first.error };

      const second = transition(
        "PAYMENT_CONFIRMED",
        "READY_TO_GENERATE",
        adminTransitionContext({
          paymentStatus,
          keyPresent: licence.publicNumber !== null,
        }),
      );
      if (!second.ok) return { kind: "forbidden", error: second.error };

      const [row] = await tx
        .update(mobileSerials)
        .set({ status: "READY_TO_GENERATE", updatedBy: admin.email })
        .where(eq(mobileSerials.id, serialId))
        .returning();
      if (!row) return { kind: "not-found" };

      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.confirmPayment),
          entityType: ENTITY_LICENCE,
          entityId: row.id,
          previousState: {
            status: licence.status,
            paymentStatus: previousPaymentStatus,
          },
          newState: {
            status: row.status,
            paymentStatus,
            confirmedBy: admin.email,
          },
        }),
      );
      return { kind: "confirmed", row };
    },
  );

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "replay") {
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      message: REPLAY_MESSAGE,
    });
  }
  if (outcome.kind === "forbidden") {
    const refusal = refused(outcome.error);
    return c.json(refusal.body, refusal.status);
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

/**
 * §8 - THE GREEN KEY-GENERATION RULE, ENFORCED SERVER-SIDE.
 *
 *     IF: Payment Status = PAID ...
 *     THEN: Generate Key button = GREEN / ENABLED
 *     OTHERWISE: Generate Key button = DISABLED / GREY
 *
 * §8 describes a button colour. A disabled button is a statement the browser
 * makes about itself, and plan 19 is explicit that the browser's statements
 * are not evidence: "The browser should request an operation. The server must
 * decide whether that operation is permitted." A caller who skips the UI and
 * POSTs straight to this endpoint must get the same answer the grey button
 * gave - and it does, as **403**, because `READY_TO_GENERATE -> KEY_GENERATED`
 * carries `requiresPaidPayment` and the state machine refuses the edge when
 * `payments.status` is anything but `PAID`.
 *
 * This is also the only place in the codebase that allocates a key. Decision
 * A1 moved allocation out of `POST /serials`, so a record that has not passed
 * this gate holds `public_number = NULL` - there is no key to leak before
 * payment, rather than a key that exists and merely happens not to have been
 * displayed.
 */
adminRoutes.post("/serials/:serialId/generate-key", async (c) => {
  const admin = await requireStaffPermission("key:generate")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const db = c.get("db");
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(
    async (tx): Promise<GenerateOutcome> => {
      const [licence] = await tx
        .select()
        .from(mobileSerials)
        .where(eq(mobileSerials.id, serialId))
        // §47: "Two administrators must not be able to issue the same licence
        // simultaneously... Only one request succeeds." The same lock that
        // protects issue protects generation - without it both callers could
        // read `public_number IS NULL` and allocate two different keys, and
        // §48's "must not accidentally create multiple valid licence
        // credentials" would be violated by construction.
        .for("update")
        .limit(1);
      if (!licence) return { kind: "not-found" };

      // §48 idempotency: a key already exists, so hand back the same one.
      // The check precedes `transition()` deliberately - `transition(ISSUED,
      // KEY_GENERATED)` is correctly forbidden, but a retry of a successful
      // generation is not a request to regenerate, and answering it with 409
      // would punish the browser for losing its connection (§48's exact
      // scenario). `ACTIVE` and the rest are excluded: see ALREADY_GENERATED.
      if (licence.publicNumber !== null && ALREADY_GENERATED.has(licence.status)) {
        return { kind: "replay", row: licence };
      }

      const verdict = transition(
        licence.status,
        "KEY_GENERATED",
        adminTransitionContext({
          paymentStatus: await paymentStatusFor(tx, serialId),
          keyPresent: licence.publicNumber !== null,
        }),
      );
      if (!verdict.ok) return { kind: "forbidden", error: verdict.error };

      const kind = readLicenceKind(licence.customerKind);
      const slabMax = licence.deviceMax;
      if (!kind || !isLicenceSlab(slabMax)) {
        // Neither value is recoverable by the operator and neither belongs in
        // a customer-facing message. 500 rather than 4xx: the request is
        // perfectly reasonable, the *record* is not what the API believes it
        // can produce, and only a human looking at the row can repair it.
        return { kind: "bad-record" };
      }

      const at = new Date();
      const publicNumber = await uniqueLicenceKey(tx, kind, slabMax, at);
      const [row] = await tx
        .update(mobileSerials)
        .set({
          publicNumber,
          generatedBy: admin.email,
          updatedBy: admin.email,
        })
        .where(eq(mobileSerials.id, serialId))
        .returning();
      if (!row) return { kind: "not-found" };

      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.generateKey),
          entityType: ENTITY_LICENCE,
          entityId: row.id,
          previousState: {
            status: licence.status,
            // `null` before, never the key itself: an audit row is a record of
            // what happened, not a second place a licence credential lives.
            publicNumber: null,
          },
          newState: {
            status: row.status,
            publicNumberFingerprint: await serialFingerprint(publicNumber),
            generatedBy: admin.email,
          },
        }),
      );
      return { kind: "generated", row };
    },
  );

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "bad-record") {
    return c.json(
      {
        error:
          "Licence record has an unrecognised plan or customer kind; a key cannot be generated for it. Inspect the record.",
      },
      500,
    );
  }
  if (outcome.kind === "replay") {
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      message: REPLAY_MESSAGE,
    });
  }
  if (outcome.kind === "forbidden") {
    const refusal = refused(outcome.error);
    // 403 for `PaymentNotPaid` - the Green Key Rule - 409 when the record's
    // state simply is not one generation can start from.
    return c.json(refusal.body, refusal.status);
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

/**
 * The key a signing or emailing path must operate on.
 *
 * `public_number` is nullable so a DRAFT record can exist with no key
 * (decision A1). Every path that reaches here - signing an entitlement,
 * emailing a licence - has already passed issuance, and issuance allocates the
 * key, so `null` is an invariant violation rather than a routine case: the
 * state machine would have allowed a signature over a record that never
 * generated anything.
 *
 * It throws instead of coercing to `""` or a placeholder. An entitlement signed
 * over an empty serial still verifies on the host and then names nothing, which
 * is a worse outcome than a 503 with a message that says what is wrong.
 */
function requireIssuedKey(row: typeof mobileSerials.$inferSelect): string {
  if (row.publicNumber === null) {
    throw new SigningConfigError(
      "licence has no key; refusing to sign or send an entitlement for a record that was never generated",
    );
  }
  return row.publicNumber;
}

/**
 * Result of the commit phase of `/issue`.
 *
 * Control flow is returned rather than thrown so a guard (not-found, revoked,
 * replay) unwinds the transaction with nothing written instead of relying on a
 * rollback that would also swallow a real database error.
 */
type IssueOutcome =
  | { kind: "not-found" }
  | { kind: "revoked" }
  | { kind: "forbidden"; error: TransitionError }
  | { kind: "replay"; row: typeof mobileSerials.$inferSelect }
  | { kind: "issued"; row: typeof mobileSerials.$inferSelect };

/**
 * Turn a state-machine refusal into the HTTP answer for it.
 *
 * One place decides the status, so `/issue`, `/revoke`, `/suspend` and
 * `/generate-key` cannot drift into disagreeing about what "not allowed"
 * means. `allowed` is surfaced for an `unknown-edge` refusal so the client can
 * offer the operator the states that *would* work instead of a bare rejection.
 */
function refused(error: TransitionError): {
  body: { error: string; allowed?: readonly LicenceStatus[] };
  status: 400 | 403 | 409 | 503;
} {
  return {
    body:
      error.kind === "ForbiddenTransition"
        ? { error: failureMessage(error), allowed: error.allowed }
        : { error: failureMessage(error) },
    status: failureHttpStatus(error),
  };
}

/**
 * Result of a guarded, audited transition used by `/revoke` and `/suspend`.
 *
 * Like `IssueOutcome`, control flow is returned rather than thrown so that a
 * guard unwinds the transaction with nothing written, instead of relying on a
 * rollback that would also swallow a genuine database error. `previous` is
 * carried alongside `row` so the audit entry can record the real before-state
 * from the row that was read, rather than a value the handler guessed.
 */
type TransitionOutcome =
  | { kind: "not-found" }
  | { kind: "replay"; row: typeof mobileSerials.$inferSelect }
  | { kind: "forbidden"; error: TransitionError }
  | {
      kind: "changed";
      row: typeof mobileSerials.$inferSelect;
      previous: typeof mobileSerials.$inferSelect;
    };

/**
 * Run a guarded, audited licence transition in one transaction.
 *
 * Shared by `/revoke` and `/suspend` so the three things that must be true of
 * every state change - the edge is legal for an admin, the mutation and its
 * audit row commit together, the trail carries the true previous state - are
 * written once rather than three times and counted on to stay identical.
 *
 * `replayWhen(row)` decides what "already done" means for this action. The
 * check runs *before* `transition()` and before `writeAudit`, which is why a
 * repeated request yields no second audit row: it never reaches the insert.
 */
async function transactLicence(
  db: Database,
  serialId: string,
  frame: StaffAuditContext,
  route: string,
  set: (
    row: typeof mobileSerials.$inferSelect,
    at: Date,
  ) => Partial<typeof mobileSerials.$inferInsert>,
  replayWhen: (row: typeof mobileSerials.$inferSelect) => boolean,
  reason?: string | null,
): Promise<TransitionOutcome> {
  return db.transaction(async (tx): Promise<TransitionOutcome> => {
    const [previous] = await tx
      .select()
      .from(mobileSerials)
      .where(eq(mobileSerials.id, serialId))
      /*
       * Row lock, and it is load-bearing rather than defensive.
       *
       * The replay check below reads `previous.status`; under READ COMMITTED
       * two administrators clicking Revoke in the same instant would both read
       * "not revoked yet", both pass, and both write an audit row for one
       * decision. `FOR UPDATE` serialises them, and Postgres re-evaluates the
       * predicate against the *updated* row version when the lock is handed
       * over - so the second caller reads REVOKED and takes the replay branch.
       *
       * Without this the replay guard is a TOCTOU that only shows up under
       * concurrency, which is exactly where it would matter most.
       */
      .for("update")
      .limit(1);
    if (!previous) return { kind: "not-found" };
    if (replayWhen(previous)) return { kind: "replay", row: previous };

    const verdict = transition(
      previous.status,
      targetStatus(route),
      adminTransitionContext({
        paymentStatus: await paymentStatusFor(tx, serialId),
        keyPresent: previous.publicNumber !== null,
        reason,
      }),
    );
    if (!verdict.ok) return { kind: "forbidden", error: verdict.error };

    const at = new Date();
    const [row] = await tx
      .update(mobileSerials)
      .set(set(previous, at))
      .where(eq(mobileSerials.id, serialId))
      .returning();
    if (!row) return { kind: "not-found" };

    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(route),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: {
          status: previous.status,
          revokedAt: previous.revokedAt ? previous.revokedAt.toISOString() : null,
        },
        newState: {
          status: row.status,
          revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
          updatedBy: row.updatedBy,
        },
        reason: reason ?? null,
      }),
    );
    return { kind: "changed", row, previous };
  });
}

/** The state each audited route is trying to reach. One declaration per route. */
function targetStatus(route: string): LicenceStatus {
  switch (route) {
    case ROUTE.revoke:
      return "REVOKED";
    case ROUTE.suspend:
      return "SUSPENDED";
    default:
      throw new Error(`No target state declared for route ${route}.`);
  }
}

/**
 * §47's sentence, returned with every replay so a client that raced another
 * administrator is told what happened rather than handed a bare 200 it might
 * mistake for fresh work: "Refresh the record to see the current state."
 *
 * Used for idempotent retries too (§48). The server cannot distinguish a
 * network retry from a second administrator - both arrive after the operation
 * completed - so both get the same honest answer: it is already done, look at
 * what is actually there.
 */
const REPLAY_MESSAGE =
  "This licence was already processed by another administrator. Refresh the record to see the current state.";

/** Outcomes for `POST /serials/:serialId/confirm-payment`. */
type ConfirmOutcome =
  | { kind: "not-found" }
  | { kind: "replay"; row: typeof mobileSerials.$inferSelect }
  | { kind: "forbidden"; error: TransitionError }
  | { kind: "confirmed"; row: typeof mobileSerials.$inferSelect };

/** Outcomes for `POST /serials/:serialId/generate-key`. */
type GenerateOutcome =
  | { kind: "not-found" }
  /** The row's `customer_kind` is neither `SINGLE` nor `BULK` - see below. */
  | { kind: "bad-record" }
  | { kind: "replay"; row: typeof mobileSerials.$inferSelect }
  | { kind: "forbidden"; error: TransitionError }
  | { kind: "generated"; row: typeof mobileSerials.$inferSelect };

/**
 * States from which a *new* key would already exist.
 *
 * Generation genuinely happened before these, so a repeated request is a retry
 * and gets §48's idempotent answer. `ACTIVE`, `SUSPENDED`, `EXPIRED` and
 * `REVOKED` are deliberately absent: the licence has moved on to something
 * generation has no business touching, and answering 409 with the states that
 * *would* be legal is more useful than handing back a key for a revoked
 * credential.
 */
const ALREADY_GENERATED: ReadonlySet<LicenceStatus> = new Set<LicenceStatus>([
  "KEY_GENERATED",
  "ISSUED",
]);

/**
 * Signs an issued serial, or throws [`SigningConfigError`] (mapped to 503).
 *
 * The clock is pinned to the row's own `issuedAt`, not to "now". That single
 * choice makes the payload a pure function of the row, so the very same
 * signature comes back on a replay instead of a fresh one. Two identical
 * requests therefore produce an identical artifact - which is what makes the
 * signature idempotent rather than merely valid.
 */
async function signedEnvelopeFor(
  env: Env,
  row: typeof mobileSerials.$inferSelect,
) {
  const privateKey = requireSigningKey(env);
  const policy = readEntitlementPolicy(env);
  const pinned = row.issuedAt ?? row.createdAt;
  return signEntitlement(
    {
      id: row.id,
      publicNumber: requireIssuedKey(row),
      status: row.status,
      customerEmail: row.customerEmail,
      customerFullName: row.customerFullName,
      companyName: row.companyName,
      deviceMax: row.deviceMax,
      devicesBound: row.devicesBound,
      issuedAt: row.issuedAt,
      createdAt: row.createdAt,
    },
    policy,
    privateKey,
    () => new Date(pinned),
  );
}

adminRoutes.post("/serials/:serialId/issue", async (c) => {
  // §41: "Approve / issue" = Super Admin or Licence Admin. An OPERATOR or an
  // AUDITOR is refused here even though they can read the record perfectly
  // well - seeing a licence and issuing it are different permissions.
  const admin = await requireStaffPermission("licence:issue")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const db = c.get("db");

  /*
   * PHASE 0 - fail fast, before anything is written.
   *
   * The contract requires `{schema, issuedAt, payload, signature}` on every
   * response, and a signature cannot be produced without the private key. If
   * we discovered that *after* committing the issuance we would be left with a
   * serial marked ISSUED, no email, and a 503 on every retry - a wedged row.
   * Checking here leaves the database untouched and the retry path clean.
   */
  try {
    requireSigningKey(c.env);
    readEntitlementPolicy(c.env);
  } catch (error) {
    if (error instanceof SigningConfigError) {
      return c.json({ error: error.message }, 503);
    }
    throw error;
  }

  /*
   * PHASE 1 - commit the issuance. Pure database work, one atomic unit, no
   * external I/O anywhere in this block.
   *
   * This is the fix for the defect the recon report called out at L566-582:
   * the old order was SELECT -> sendLicenceEmail -> UPDATE, so the email left
   * the building before the row said it had. If the UPDATE then failed the
   * customer held a valid key for a serial the server still called PENDING,
   * and the retry re-sent the email. Committing first means a failure can only
   * ever lose an email (recorded, visible, repairable) - never send one for a
   * licence that does not exist.
   *
   * The guards re-read inside the transaction, which also closes the TOCTOU
   * the old code had between its standalone SELECT and its UPDATE.
   */
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(
    async (tx): Promise<IssueOutcome> => {
      const [current] = await tx
        .select()
        .from(mobileSerials)
        .where(eq(mobileSerials.id, serialId))
        // Same reason as `transactLicence`: the replay check below reads
        // `current.status`, so the row must not change between that read and
        // the UPDATE, or two concurrent issues would both send an email.
        .for("update")
        .limit(1);
      if (!current) return { kind: "not-found" };
      if (current.status === "REVOKED") return { kind: "revoked" };
      /*
       * IDEMPOTENT REPLAY (plan 48).
       *
       * Returns before the transition, before the UPDATE and before
       * `writeAudit`, so a retried request produces no second state change,
       * no second audit row, and never reaches `sendLicenceEmail` - the
       * double-send guard is structural (which branch you land on) rather than
       * a flag someone can forget to set. The signature is stable because
       * `signedEnvelopeFor` pins its clock to the row's own `issuedAt`.
       */
      if (current.status === "ISSUED" && current.issuedAt) {
        return { kind: "replay", row: current };
      }

      /*
       * §49: the ONLY edge into ISSUED is KEY_GENERATED -> ISSUED.
       *
       * Anything else - a record still in PAYMENT_PENDING because somebody
       * skipped payment, one in READY_TO_GENERATE because no key was
       * generated - is refused here, inside the transaction that would have
       * written it, so refusal costs nothing and there is no window where a
       * licence was issued without having been generated.
       */
      const verdict = transition(
        current.status,
        "ISSUED",
        adminTransitionContext({
          paymentStatus: await paymentStatusFor(tx, serialId),
          keyPresent: current.publicNumber !== null,
        }),
      );
      if (!verdict.ok) return { kind: "forbidden", error: verdict.error };

      const issuedAt = new Date();
      const [updated] = await tx
        .update(mobileSerials)
        .set({
          status: "ISSUED",
          issuedBy: admin.email,
          issuedAt,
          // Cleared here, written back after the email attempt in PHASE 3.
          emailedAt: null,
          emailMessageId: null,
          emailError: null,
        })
        .where(eq(mobileSerials.id, serialId))
        .returning();
      if (!updated) return { kind: "not-found" };

      // Same `tx` as the UPDATE: the trail and the issuance commit together or
      // not at all, so there can be no issued licence nobody recorded.
      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.issue),
          entityType: ENTITY_LICENCE,
          entityId: updated.id,
          previousState: {
            status: current.status,
            issuedAt: current.issuedAt ? current.issuedAt.toISOString() : null,
          },
          newState: {
            status: updated.status,
            issuedAt: issuedAt.toISOString(),
            issuedBy: admin.email,
          },
        }),
      );
      return { kind: "issued", row: updated };
    },
  );

  if (outcome.kind === "not-found") {
    return c.json({ error: "Serial not found." }, 404);
  }
  if (outcome.kind === "revoked") {
    return c.json({ error: "Revoked serials cannot be issued." }, 409);
  }
  if (outcome.kind === "forbidden") {
    const refusal = refused(outcome.error);
    return c.json(refusal.body, refusal.status);
  }

  const row = outcome.row;
  /*
   * The transaction above already required `keyPresent` on the
   * KEY_GENERATED -> ISSUED edge, so `row.publicNumber` cannot be null on this
   * branch. It is checked again because the cost of being wrong here is not a
   * wrong status code but a real customer receiving an email that names no
   * licence at all - and `parseLicenceKey` silently returning null would dress
   * that failure up as a normal `1-N` slab label, as though nothing were wrong.
   * Defence in depth at the point where it would actually hurt.
   */
  if (row.publicNumber === null) {
    return c.json(
      { error: "Licence has no key; issuance cannot be completed." },
      503,
    );
  }

  /*
   * PHASE 2 - the replay guard, and only then the email.
   *
   * A replay returns here and never reaches `sendLicenceEmail`. That is the
   * whole double-send guard: it is structural (which branch you land on), not
   * a flag someone can forget to set. Only the path that just committed the
   * issuance is ever allowed to send anything.
   */
  if (outcome.kind === "replay") {
    const envelope = await signedEnvelopeFor(c.env, outcome.row);
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      // §47's sentence. The server cannot tell a second administrator from a
      // browser that lost its connection after the operation completed (§48),
      // so both are told the same thing: it is already done, look at what is
      // actually there.
      message: REPLAY_MESSAGE,
      emailed: outcome.row.emailedAt !== null,
      emailError: outcome.row.emailError,
      ...envelope,
    });
  }

  /*
   * PHASE 3 - the email itself. Deliberately outside any transaction: it is
   * network I/O, and holding a database transaction open across an SMTP round
   * trip is how a connection pool dies under load.
   */
  const parsed = parseLicenceKey(row.publicNumber);
  const mail = await sendLicenceEmail(c.env, {
    email: row.customerEmail,
    licenceKey: row.publicNumber,
    slabLabel: parsed?.slabLabel ?? `1-${row.deviceMax}`,
    kind: row.customerKind,
    brandScope: row.brandScope,
    serialId: row.id,
  });

  /*
   * PHASE 4 - record the outcome. A separate statement on purpose: if this
   * write fails the licence stays issued and the signature still goes out.
   * Rolling the issuance back because an SMTP call misbehaved would be the
   * database taking orders from the network.
   *
   * A failed send is no longer a 502 claiming "Not issued" - it was issued,
   * and saying otherwise told the operator a falsehood about committed state.
   * The response now states both truths: issued, and not emailed.
   */
  const emailedAt = mail.sent ? row.issuedAt : null;
  const emailError = mail.sent ? null : mail.error ?? "preview-no-email";
  await db
    .update(mobileSerials)
    .set({
      emailedAt,
      emailMessageId: mail.id ?? null,
      emailError,
    })
    .where(eq(mobileSerials.id, serialId));

  const envelope = await signedEnvelopeFor(c.env, row);
  return c.json({
    serial: jsonSerial({ ...row, emailedAt, emailMessageId: mail.id ?? null, emailError }),
    replayed: false,
    emailed: mail.sent,
    emailError,
    ...envelope,
  });
});

/**
 * §37 - REVOKE: permanent invalidation of a licence credential.
 *
 * §37 lists four things both this and `/suspend` require: **Reason**,
 * Confirmation, Authorized role, Audit event. The first and last are enforced
 * here; the role is `licence:revoke` in §41; Confirmation is a client concern
 * (a dialog), which is exactly why it cannot be the thing this endpoint relies
 * on.
 *
 * Note for the current UI: the Revoke button in `AdminApp.tsx` sends no body,
 * so it will now be refused with 400 until Phase 4/5 adds a reason prompt.
 * That is the server honouring §37 rather than the server breaking - see the
 * note in `transactLicence` on why the refusal happens before anything is
 * written.
 */
adminRoutes.post("/serials/:serialId/revoke", async (c) => {
  const admin = await requireStaffPermission("licence:revoke")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const reason = readReason(await c.req.json().catch(() => ({})));
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await transactLicence(
    c.get("db"),
    serialId,
    frame,
    ROUTE.revoke,
    (_row, at) => ({ status: "REVOKED", revokedAt: at, updatedBy: admin.email }),
    (row) => row.status === "REVOKED" && row.revokedAt !== null,
    reason,
  );

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "replay") {
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      message: REPLAY_MESSAGE,
    });
  }
  if (outcome.kind === "forbidden") {
    const refusal = refused(outcome.error);
    return c.json(refusal.body, refusal.status);
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

/**
 * §37 - SUSPEND: temporary administrative stop.
 *
 * Distinct from revoke, which is permanent; §37 calls them "different actions"
 * and the state machine reflects it - `SUSPENDED -> ACTIVE` exists so a stop
 * can be lifted, and it is one of only two edges that return a licence to
 * service.
 *
 * `reason` is required for the same §37 reason. Suspending a paying customer's
 * production host without saying why is not recoverable: the customer asks,
 * and the trail must answer.
 */
adminRoutes.post("/serials/:serialId/suspend", async (c) => {
  const admin = await requireStaffPermission("licence:suspend")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const reason = readReason(await c.req.json().catch(() => ({})));
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await transactLicence(
    c.get("db"),
    serialId,
    frame,
    ROUTE.suspend,
    (_row, _at) => ({ status: "SUSPENDED", updatedBy: admin.email }),
    (row) => row.status === "SUSPENDED",
    reason,
  );

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "replay") {
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      message: REPLAY_MESSAGE,
    });
  }
  if (outcome.kind === "forbidden") {
    const refusal = refused(outcome.error);
    return c.json(refusal.body, refusal.status);
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

adminRoutes.get("/reports/licences", async (c) => {
  const admin = await requirePermission("report:export")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const fromRaw = (c.req.query("from") ?? "").trim();
  const toRaw = (c.req.query("to") ?? "").trim();
  const from = parseReportDate(fromRaw, false);
  const to = parseReportDate(toRaw, true);
  if (!from || !to) {
    return c.json({ error: "from and to must be ISO dates." }, 400);
  }
  const db = c.get("db");
  const rows = await db
    .select()
    .from(mobileSerials)
    .where(and(gte(mobileSerials.createdAt, from), lte(mobileSerials.createdAt, to)))
    .orderBy(desc(mobileSerials.createdAt));
  const mapped = await reportRows(rows);
  if ((c.req.query("format") ?? "") === "csv") {
    /*
     * Plan 53, "SECURITY OF XLS EXPORT": "Require authentication. Enforce role
     * permissions. Generate reports server-side. Log report generation."
     *
     * The trail is written BEFORE the file. A CSV of the whole licence
     * register is the copy that actually leaves the building as an
     * attachment, so if the audit row cannot be committed nothing goes out -
     * over-logging is recoverable, a silent export is not.
     *
     * The default JSON projection below is an ordinary read and is not
     * audited, which is why this route sits in `CONDITIONAL_ROUTES`.
     */
    const frame = await requireAuditContext(c);
    if ("error" in frame) return c.json({ error: frame.error }, frame.status);
    await db.transaction(async (tx) => {
      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.exportLicences),
          entityType: ENTITY_LICENCE_EXPORT,
          entityId: AGGREGATE_ENTITY_ID,
          previousState: null,
          newState: {
            format: "csv",
            from: from.toISOString(),
            to: to.toISOString(),
            rowCount: mapped.length,
          },
        }),
      );
    });
    return c.body(toCsv(mapped), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cyvra-mobile-licences.csv"`,
    });
  }
  return c.json({
    actor: admin.email,
    from: from.toISOString(),
    to: to.toISOString(),
    count: mapped.length,
    rows: mapped,
  });
});

/*
 * MODULE-LOAD ASSERTION.
 *
 * Every POST/PUT/PATCH/DELETE route above must be classified as audited or
 * explicitly exempt, and every key in the audit registry must name a route
 * that really exists. If either is false this import throws, which means a new
 * state-changing route cannot be added without its audit action being decided
 * - by a person, in `ROUTE_ACTION_MAP` - and a renamed route cannot quietly
 * stop being audited while its stale action sits in the map forever.
 *
 * This runs once, at startup, rather than being discovered in production as a
 * licence change that nobody can explain afterwards.
 */
assertRouteAuditCoverage(adminRoutes.routes);
