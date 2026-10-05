import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import {
  mobileSerials,
  payments,
  staffOperators,
  staffOtpChallenges,
  staffRoleEnum,
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
  isCyvoriqEmail,
  staffLifecycleStatus,
} from "./admin/principal";
import {
  LIMITED_AUDIT_ROLES,
  requireAuthenticated,
  requirePermission,
  requireStaffPermission,
  mayWaivePayment,
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
  auditFiltersFor,
  auditMiddleware,
  parseAuditQuery,
  readAuditEvents,
  requireAuditContext,
  selfServiceAuditContext,
  type StaffAuditContext,
  writeAudit,
} from "./admin/audit";
import {
  HOST_BINDING_CONFLICT_STATUS,
  failureHttpStatus,
  failureMessage,
  transition,
  transitionHostBinding,
  type PaymentStatus,
  type TransitionContext,
  type TransitionError,
} from "./admin/state-machine";
import {
  filtersFor,
  offsetOf,
  paginationFor,
  parseSerialQuery,
  serialQueryWhere,
} from "./admin/search";
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

function jsonSerial(
  row: typeof mobileSerials.$inferSelect,
  paymentStatus: PaymentStatus | null = null,
) {
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
    /*
     * FINANCIAL TRUTH (design plan 5 / 7).
     *
     * This lives on `payments`, not on this row: plan 7 forbids collapsing the
     * two, so `licence_status` may only move as a *transactional consequence*
     * of `payments.status`. Projecting it here is what lets the registry
     * render §5's "Payment Status" column and lets the drawer's Payment
     * section be a fact rather than a guess the browser has to make - and a
     * browser guessing a financial state is precisely what plan 19 forbids.
     *
     * `null` means "no payment record exists", which is NOT "pending".
     * `POST /serials` writes the row as PENDING (admin.ts, create route), so
     * an absent row only occurs on a record created outside this API, and
     * rendering it as PENDING would be inventing a financial state.
     *
     * The default parameter is deliberate: `adminRedaction.test.ts` calls this
     * projection with one argument, and a *required* parameter would run as
     * `undefined` there - which `JSON.stringify` drops and `toCsv` renders as
     * an empty cell reading "this customer has no value" instead of "this
     * column is broken". `null` stays visible and stays honest.
     */
    paymentStatus,
    /*
     * §5 columns 15 and 16 - Activation Date, Expiry / Renewal Date.
     *
     * Both are nullable by design rather than by omission: `first_activated_at`
     * is written once on the first successful binding and never again, and
     * `validity_*` was never backfilled for pre-W5 rows (migration 0007 leaves
     * them NULL rather than defaulting them to "now"). An empty cell is the
     * honest rendering of a window nobody ever recorded; a defaulted date
     * would be fabricated data in an append-only-adjacent record.
     */
    firstActivatedAt: iso(row.firstActivatedAt),
    validityStartsAt: iso(row.validityStartsAt),
    validityEndsAt: iso(row.validityEndsAt),
    devicesBound: row.devicesBound,
    /*
     * WHO, SPLIT THE WAY §56 LISTS IT (design freeze 05 Oct 2026).
     *
     * "Issued By" answers *who issued this licence*, so it may not name an
     * issuer while nothing has been issued. Migration 0008 dropped the NOT NULL
     * that used to force a create to name one, so a new row is NULL in here and
     * the column and the header agree by construction - but the gate is not
     * redundant: a row written before 0008 still holds its CREATOR in
     * `issued_by` (0007 section 6e copied it into `created_by` and left this
     * column alone). Gating on `issued_at` turns the cell into "—" until the
     * fact it describes is true, for both kinds of row.
     *
     * The creator is not lost: `created_by` is projected beside it and is its
     * own column in the XLSX export. Neither field is a secret - both are free
     * text an operator typed or the system wrote.
     */
    createdBy: row.createdBy,
    issuedBy: row.issuedAt === null ? null : row.issuedBy,
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
export async function jsonSerialList(
  row: typeof mobileSerials.$inferSelect,
  paymentStatus: PaymentStatus | null = null,
) {
  const { publicNumber, licenceKey: _fullKey, ...rest } = jsonSerial(row, paymentStatus);
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

/*
 * `readPageParams` and `SERIAL_PAGE_*` moved out to `./admin/search`, which
 * replaced them with `parseSerialQuery`.
 *
 * The old helper is worth remembering, because it was the defect: `limit` was
 * clamped with `Math.min(raw, 100)` and a non-numeric value fell back to 25,
 * so `?limit=1000` was answered with 100 rows and a 200 while the client
 * believed it had asked for a thousand. Search refuses rather than clamps, and
 * the response always carries `total` / `hasMore` - see `search.ts`'s header.
 */

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
 *
 * -----------------------------------------------------------------------
 * RULING R4 - "CURRENT PAYMENT = THE LATEST ROW"
 * -----------------------------------------------------------------------
 * `payments.licence_id` carries an FK and a btree index but **no UNIQUE
 * constraint** (migration 0007 deliberately leaves it open, because the
 * provider's webhook can post a second charge before the first one is read).
 * So "the payment for this licence" is a set, and something has to say which
 * member of it the machine is being asked about.
 *
 * It is the latest one. Ordered by `created_at` descending, this query reads
 * the row that was most recently written, which is the only definition that
 * survives every real sequence:
 *
 *   - a licence whose only charge still stands        -> that row, trivially;
 *   - a licence whose first charge was later refunded
 *     and re-charged                                 -> the re-charge;
 *   - a row inserted inside the same transaction as
 *     the licence (the Phase 1 create path)          -> itself.
 *
 * The final `id` ordering is not part of that definition. It exists because
 * `now()` in Postgres is the *transaction* start time, so two rows written in
 * one transaction can share a `created_at` down to the microsecond; without a
 * tie-break the "latest" row would be whichever the planner felt like
 * returning, and this function would answer differently for two identical
 * reads. Sorting by the primary key makes the ambiguous case *stable*, which
 * is worth far more in a precondition check than being right about which of
 * two simultaneous charges counts.
 *
 * Note what this does NOT do: it does not pick the PAID row, or the row whose
 * status happens to satisfy the edge being taken. Selecting whichever payment
 * makes the transition succeed would be the exact shortcut decision A3 exists
 * to forbid - the machine would then report `PAID` because a PAID row was
 * chosen for it, not because the licence's payment is PAID.
 *
 * The list routes do not go through here: they use the correlated `EXISTS` in
 * `./admin/search`, which asks "does this licence have any PAID payment" over
 * a whole page at once. Both answer "is it paid" and neither answers it by
 * reading one arbitrary row.
 */
async function paymentStatusFor(
  tx: Pick<Database, "select">,
  licenceId: string,
): Promise<PaymentStatus | null> {
  const [payment] = await tx
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.licenceId, licenceId))
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(1);
  return payment?.status ?? null;
}

/**
 * Payment status for a whole page, in ONE query.
 *
 * WHY NOT A JOIN
 * --------------
 * `payments.licence_id` carries an FK and a btree index but no UNIQUE
 * constraint (migration 0007), so a join could multiply rows - and `count(*)`
 * over a multiplied set reports a register larger than the one it served,
 * which is the exact inversion of the promise `search.ts` makes about
 * `total`/`hasMore`. The same reasoning is written out at `search.ts`'s
 * `paymentPredicate`, which uses `EXISTS` for precisely this reason. An
 * `inArray` over the page's ids is one row in, one row out per licence.
 *
 * WHY THE ORDERING MATTERS
 * ------------------------
 * `desc(createdAt), desc(id)` with first-sighting-wins reproduces
 * `paymentStatusFor` above character for character, so a licence rendered in
 * the table and the same licence opened in the drawer can never show two
 * different payment states. Two functions that disagreed about "current" would
 * be worse than one function that was wrong, because only one of them would be
 * visible at a time.
 *
 * WHY `null` AND NOT `"PENDING"`
 * ------------------------------
 * An id with no payment row means the row was never created - not that money
 * is outstanding. Fabricating `PENDING` would put a financial claim into a
 * response that no query ever made.
 *
 * Callers pass the page's ids; an empty page costs no query at all.
 */
async function paymentStatusesFor(
  db: Pick<Database, "select">,
  serialIds: readonly string[],
): Promise<Map<string, PaymentStatus | null>> {
  const out = new Map<string, PaymentStatus | null>();
  for (const id of serialIds) out.set(id, null);
  if (serialIds.length === 0) return out;

  const rows = await db
    .select({ licenceId: payments.licenceId, status: payments.status })
    .from(payments)
    .where(inArray(payments.licenceId, [...serialIds]))
    .orderBy(desc(payments.createdAt), desc(payments.id));

  /*
   * Read the real answers FIRST, and only then fill the gaps.
   *
   * The obvious shape - seed every id with `null`, then overwrite - is wrong in
   * a way that only shows up at runtime: seeding puts the key in the map, so
   * `!out.has(id)` is false for every row read back and the status is never
   * written. The projection would then answer `null` for a licence that was
   * paid in full, on every list response, while the drawer (which goes through
   * `paymentStatusFor`) showed PAID. A table and its drawer disagreeing about
   * money is the single most damaging inconsistency this console could have,
   * and it would have looked like "no payment recorded" rather than a bug.
   */
  const seen = new Set<string>();
  for (const row of rows) {
    // First sighting wins: rows arrive newest-first, so this is the current
    // status and never the historical one - the same rule R4 gave
    // `paymentStatusFor`, which must not be reinterpreted here.
    if (seen.has(row.licenceId)) continue;
    seen.add(row.licenceId);
    out.set(row.licenceId, row.status);
  }
  for (const id of serialIds) {
    if (!out.has(id)) out.set(id, null);
  }
  return out;
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
 *
 * `paymentWaived` is threaded through here rather than being read from the
 * request directly, for the same reason `actorKind` is hard-coded: the state
 * machine must never learn *who* asked, only *whether a waiver is in force*.
 * The role check that decides that lives in `mayWaivePayment` and is invoked
 * exactly once, at the generate-key call site, so there is a single place in
 * this file where the Green Key Rule is stood down.
 */
function adminTransitionContext(input: {
  paymentStatus: PaymentStatus | null;
  keyPresent: boolean;
  reason?: string | null;
  paymentWaived?: boolean;
}): TransitionContext {
  return {
    actorKind: "admin",
    paymentStatus: input.paymentStatus,
    keyPresent: input.keyPresent,
    reason: input.reason ?? null,
    paymentWaived: input.paymentWaived ?? false,
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
export async function reportRows(
  rows: (typeof mobileSerials.$inferSelect)[],
  paymentById: ReadonlyMap<string, PaymentStatus | null> = new Map(),
) {
  return Promise.all(
    rows.map((row) => jsonSerialList(row, paymentById.get(row.id) ?? null)),
  );
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
    // Placed against `status` on purpose: §5's column 10 is the workflow
    // truth and column 9 is the financial truth, and an auditor reconciling an
    // export reads the two side by side. Burying payment further down would
    // make the file answer "is this issued" without answering "was it paid".
    "paymentStatus",
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
    // §56 lists Created By and Issued By as separate columns. Keeping both -
    // rather than one actor column doing double duty - is what lets an export
    // answer "who made this record" and "who issued it" as two questions with
    // two answers; see `jsonSerial` for why `issuedBy` may be empty.
    "createdBy",
    "issuedBy",
    "createdAt",
    "issuedAt",
    "revokedAt",
    // §5 columns 15 and 16. NULL renders as an empty cell, which is the
    // correct reading of "no window was ever recorded" - see `jsonSerial`.
    "firstActivatedAt",
    "validityStartsAt",
    "validityEndsAt",
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
  const db = c.get("db");

  /*
   * The OTP gate asks `staffLifecycleStatus`, not `isApprovedOperator`.
   *
   * Phase 2 splits "has a staff row" from "may act", so an invitee must be
   * able to request the very code that proves they own the address - which the
   * old ACTIVE-only check refused by construction, since they are INVITED
   * precisely because they have not verified yet. The refusal still carries a
   * real sentence: a suspended account is told it is suspended rather than
   * being left to look identical to an address nobody ever invited.
   */
  const lifecycle = await staffLifecycleStatus(db, email);
  if (!lifecycle.allowed) {
    return c.json({ error: lifecycle.reason ?? "Not authorised." }, 403);
  }

  const { challengeId, code } = await issueStaffOtp(db, email);
  const result = await sendOtpEmail(c.env, {
    email,
    code,
    challengeId,
    purpose: "staff",
  });
  if (!result.sent && c.env.API_ENV === "production") {
    return c.json({ error: `Could not send ops code: ${result.error ?? "email failed"}` }, 502);
  }
  return c.json({
    challengeId,
    // Lets the client stop guessing what happens next: an `INVITED` address
    // will verify but not receive a session, and telling it that up front is
    // cheaper than the client discovering it when the token comes back null.
    status: lifecycle.status ?? "ACTIVE",
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

  /*
   * ------------------------------------------------------------------
   * THE `INVITED -> EMAIL_VERIFIED` PROMOTION (ruling R2 vocabulary)
   * ------------------------------------------------------------------
   * R2 ruled that this route writes `STAFF_INVITED` rather than a new
   * `STAFF_EMAIL_VERIFIED` value, so that no migration is needed and the whole
   * invitation becomes one readable story: invited, verified, changed, granted,
   * suspended, revoked. The transition itself is not carried by the action name
   * - it is carried by `previous_state` / `new_state`, which is what those two
   * columns are for.
   *
   * It is audited here because it *is* a state change on `staff_operators`, and
   * the only alternative would be an unrecorded write to an identity record.
   * The actor is the invitee themselves: they are acting on their own record,
   * and the OTP is what proves they are who they say. `selfServiceAuditContext`
   * exists for precisely this one case - see its own note.
   */
  const lifecycle = await staffLifecycleStatus(db, challenge.email);
  if (!lifecycle.allowed) {
    return c.json({ error: lifecycle.reason ?? "Not authorised." }, 403);
  }

  const isSuper = challenge.email === SUPER_ADMIN_EMAIL;
  const [operator] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.email, challenge.email))
    .limit(1);
  // `staffLifecycleStatus` already proved a row exists for anything that got
  // this far without being the super admin; this is the invariant, stated.
  if (!operator && !isSuper) {
    return c.json({ error: "This email is not nominated by ceo@cyvoriq.com." }, 403);
  }

  const status = isSuper ? "ACTIVE" : (operator?.status ?? "INVITED");
  const verifiedNow = status === "INVITED";
  /*
   * A session follows only for `ACTIVE`, and `lookupStaffSession` would refuse
   * anything else anyway. Saying so in the response rather than handing back a
   * token that will be rejected on first use is the difference between an
   * invitee knowing their account is pending and one filing a bug against an
   * API that did nothing wrong.
   */
  const mayMintSession = isSuper || status === "ACTIVE";

  const frame = await selfServiceAuditContext(c, {
    actorId: operator?.id ?? null,
    actorRole: isSuper ? "SUPER_ADMIN" : (operator?.role ?? "OPERATOR"),
    actorEmail: challenge.email,
  });

  const now = new Date();
  const token = generateSessionToken();
  const outcome = await db.transaction(async (tx) => {
    await tx
      .update(staffOtpChallenges)
      .set({ consumedAt: now })
      .where(eq(staffOtpChallenges.id, challengeId));

    if (verifiedNow && operator) {
      const [updated] = await tx
        .update(staffOperators)
        .set({ status: "EMAIL_VERIFIED", emailVerifiedAt: now })
        .where(eq(staffOperators.id, operator.id))
        .returning();
      if (!updated) return { kind: "gone" as const };
      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.authVerify),
          entityType: ENTITY_STAFF_OPERATOR,
          entityId: updated.id,
          previousState: { status: "INVITED", emailVerifiedAt: null },
          newState: {
            status: "EMAIL_VERIFIED",
            emailVerifiedAt: now.toISOString(),
          },
        }),
      );
    }

    if (mayMintSession) {
      await tx.insert(staffSessions).values({
        email: challenge.email,
        tokenHash: await sha256Hex(token),
        expiresAt: new Date(Date.now() + STAFF_TTL_MS),
      });
    }
    return { kind: "ok" as const };
  });

  if (outcome.kind === "gone") {
    return c.json({ error: "This account no longer exists." }, 409);
  }

  if (!mayMintSession) {
    return c.json({
      operator: { email: challenge.email, superAdmin: isSuper, status },
      token: null,
      sessionMinted: false,
      message:
        "Your email is verified. An administrator must activate your account before you can sign in.",
    });
  }

  setCookie(c, STAFF_COOKIE, token, staffCookieOptions(c));
  return c.json({
    operator: { email: challenge.email, superAdmin: isSuper, status },
    token,
    sessionMinted: true,
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

/**
 * Issue one staff OTP challenge and return it.
 *
 * Shared by `POST /auth/request` and the invite route so that "how a code is
 * minted" exists once: an invite and a sign-in request that hashed differently
 *, or that generated the id differently, would be two places to get the
 * attempt-counting or the TTL wrong. Neither caller ever sees the stored hash -
 * only the code they are about to email and the id they are about to return.
 */
async function issueStaffOtp(
  db: Pick<Database, "insert">,
  email: string,
): Promise<{ challengeId: string; code: string }> {
  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  /*
   * The id is generated here rather than by the database's default.
   *
   * Both callers need it back in the same response, and reading a generated
   * value requires a round trip that buys nothing - the id is not a secret,
   * not ordered, and not a sequence an attacker can enumerate any faster than
   * a uuid. It also makes an invite and a sign-in request behave identically,
   * which is the point of sharing the function.
   */
  const challengeId = crypto.randomUUID();
  await db.insert(staffOtpChallenges).values({
    id: challengeId,
    email,
    codeHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return { challengeId, code };
}

/**
 * NOMINATE AN OPERATOR - design plan §18 ("Staff Management", "Select Role").
 *
 * THE INVITATION IS NOT AN ACTIVATION (ruling R3 vocabulary)
 * ----------------------------------------------------------
 * `POST /staff` used to write `status: 'ACTIVE'` in the same statement that
 * created the row, which made nomination and activation one act performed by
 * one click. Phase 2 splits them into the four steps §18 describes:
 *
 *     invite      POST /staff              -> INVITED   (this route)
 *     verify      POST /auth/verify        -> EMAIL_VERIFIED (the invitee)
 *     approve     POST /staff/:id/approve  -> ACTIVE    (Super Admin)
 *     suspend / revoke                     -> SUSPENDED / REVOKED
 *
 * Every one of those writes an audit row, and this one writes `STAFF_INVITED`.
 *
 * `role` IS ACCEPTED FROM THE BODY - AND WHY THAT IS SAFE
 * -------------------------------------------------------
 * Phase 1's comment here said role is never accepted from the body, citing
 * plan 19's "Never trust ... role=admin ... coming directly from the browser".
 * §18 nevertheless requires a "Select Role" step at invitation, so ruling R3
 * puts it back with a different justification:
 *
 *   - The route is gated on `staff:manage`, which §41 grants to SUPER_ADMIN
 *     alone. The role therefore arrives as a *grant from the one seat that
 *     hands roles out*, over an authenticated, audited channel - not as a
 *     claim about oneself. Plan 19's rule is about a browser asserting
 *     "role=admin" to *become* privileged; this is the opposite: the already
 *     privileged operator nominating somebody else.
 *   - It is validated against `staff_role_enum` and rejected outright if it is
 *     not one of the four, so nothing outside the matrix can be written.
 *   - It is written exactly once, at creation. Later changes go through
 *     approval, never through a re-invite, so there is no path by which a
 *     nominator's own permissions could be widened after the fact.
 *
 * The row that comes out is `INVITED`, and it cannot do anything: an invitee
 * has no session, `lookupStaffSession` requires ACTIVE, and every write route
 * in this file requires a permission. Inviting somebody confers nothing.
 */
/**
 * THE AUDIT TRAIL - design plan 20, and the read `rbac.ts` declared before
 * there was a route to serve it.
 *
 * GET, so `assertRouteAuditCoverage` skips it: reading the trail does not write
 * to it. Whether a *read of the trail* should itself be recorded is plan 20's
 * call and is deliberately not decided here - that would add an entry to
 * `CONDITIONAL_ROUTES`, which `audit.test.ts` pins to exactly one route.
 *
 * ONE ROUTE, TWO SURFACES. `?entityId=<uuid>` is one licence's history for the
 * drawer's timeline; with no `entityId` it is the global activity page. Two
 * routes would mean two copies of the validator, of the §41 scoping and of the
 * pagination, and a third place for them to drift apart.
 *
 * The LIMITATION LIVES IN THE DATA LAYER. See `readAuditEvents`: it is applied
 * where the WHERE clause is built, so no handler added later can forget it.
 */
adminRoutes.get("/audit", async (c) => {
  const principal = await requirePermission("audit:read")(c);
  if ("error" in principal) return c.json({ error: principal.error }, principal.status);

  const parsed = parseAuditQuery(new URL(c.req.url).searchParams);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const spec = parsed.spec;

  // Narrowed once, before any use: a service principal holds `audit:read` but
  // has no role and no staff row, and `LIMITED_AUDIT_ROLES` is a list of roles.
  const staffRole = principal.kind === "staff" ? principal.role : null;
  const principalActorId = principal.kind === "staff" ? principal.actorId : null;
  const limited = staffRole !== null && LIMITED_AUDIT_ROLES.includes(staffRole);

  const result = await readAuditEvents(c.get("db"), spec, {
    limited,
    actorId: limited ? principalActorId : null,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);

  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: principal.kind === "staff" ? principal.email : null,
    events: result.events,
    filters: auditFiltersFor(spec),
    pagination: paginationFor(spec, result.events.length, result.total),
    /*
     * The UI must be able to SAY why an operator sees three rows.
     *
     * §41 marks operator audit access LIMITED, and a page that silently shows
     * a subset looks like a broken query rather than a policy. Surfacing the
     * scope turns "where is the rest of my audit log?" into "you are seeing
     * your own activity", which is an answer instead of a support ticket.
     */
    scope: limited ? "self" : "all",
    scopeActorId: limited ? principalActorId : null,
  });
});

adminRoutes.post("/staff", async (c) => {
  // §41: "Manage staff - Super Admin only". The matrix says the same thing the
  // old `admin.email !== SUPER_ADMIN_EMAIL` check did, but it says it once,
  // for every route, in a table that can be read.
  const admin = await requireStaffPermission("staff:manage")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    role?: string;
  };
  const email = normalizeEmail(body.email ?? "");
  if (!isCyvoriqEmail(email) || email === SUPER_ADMIN_EMAIL) {
    return c.json({ error: "Nominate a @cyvoriq.com address other than the super admin." }, 400);
  }

  // Validated against the enum, never cast into it. A typo'd role is a 400
  // naming the legal values rather than a row nobody in §41 can act as.
  const requestedRole = String(body.role ?? "OPERATOR").toUpperCase();
  if (!staffRoleEnum.enumValues.includes(requestedRole as (typeof staffRoleEnum.enumValues)[number])) {
    return c.json(
      {
        error: `Unknown role "${body.role ?? ""}". Allowed: ${staffRoleEnum.enumValues.join(", ")}.`,
      },
      400,
    );
  }
  // `SYSTEM` passes the enum check above and is still refused, because the
  // reason to refuse it is not "unknown" but "known and not a person": it
  // exists for `audit_events.actor_role` so a system-authored event can be
  // recorded truthfully, and a `staff_operators` row holding it would be an
  // account with a role that grants nothing and nobody can explain.
  if (requestedRole === "SYSTEM") {
    return c.json(
      {
        error:
          'Role "SYSTEM" is not a staff role; it is reserved for system-authored audit rows.',
      },
      400,
    );
  }
  const role = requestedRole as (typeof staffRoleEnum.enumValues)[number];

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
  /*
   * SUSPENDED and REVOKED are terminal for *this* route. Both have their own
   * routes that record why - `POST /staff/:id/revoke` for the permanent one -
   * and letting a fresh nomination quietly launder a suspension back into an
   * invitation would erase the reason from the timeline while leaving the
   * operator with no way to tell the two apart. 409, because what disagrees is
   * the record's state, not the request's shape.
   */
  if (existing && (existing.status === "SUSPENDED" || existing.status === "REVOKED")) {
    return c.json(
      {
        error:
          existing.status === "SUSPENDED"
            ? "That account is suspended. Reactivate it rather than re-inviting it."
            : "That account has been revoked; revoked accounts are not re-invited.",
        status: existing.status,
      },
      409,
    );
  }
  /*
   * EMAIL_VERIFIED means the person proved the address and is now waiting on
   * activation. Re-inviting would drop them back to INVITED - a demotion, and
   * an unaudited one. The next step for them is approval, not another code.
   */
  if (existing && existing.status === "EMAIL_VERIFIED") {
    return c.json(
      {
        error:
          "That account has already verified its email and is waiting for activation. Approve or revoke it instead.",
        status: existing.status,
      },
      409,
    );
  }
  // Still INVITED: a re-invite refreshes the code without touching status,
  // role or nominator. Changing any of those here would be a write to an
  // identity record with no transition to record, so a differing role is
  // refused rather than silently applied or silently ignored.
  if (existing && existing.status === "INVITED" && existing.role !== role) {
    return c.json(
      {
        error: `That account is already invited as ${existing.role}; revoke it and re-invite to change the role.`,
        status: existing.status,
      },
      409,
    );
  }

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const now = new Date();
  const { challengeId, code } = await issueStaffOtp(db, email);
  const delivery = await sendOtpEmail(c.env, {
    email,
    code,
    challengeId,
    purpose: "staff",
  });

  const audit = (entityId: string, previous: Record<string, unknown>, next: Record<string, unknown>) =>
    auditEntry(frame, {
      action: actionFor(ROUTE.createStaff),
      entityType: ENTITY_STAFF_OPERATOR,
      entityId,
      previousState: previous,
      newState: next,
    });

  if (existing) {
    // INVITED and still INVITED: the invitation stands, a fresh code is on its
    // way, and no status changed - so there is no transition to audit. The
    // OTP challenge is deliberately outside the audit vocabulary (see
    // `audit_action_enum`): recording every email we sent would bury the
    // lifecycle under delivery notices.
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        role: existing.role,
        nominatedBy: existing.nominatedBy,
        nominatedAt: iso(existing.nominatedAt),
      },
      invitation: {
        challengeId,
        delivery: delivery.sent ? "email" : "dev-log",
        mailConfigured: mailConfigured(c.env),
        devCode: delivery.devCode,
        message: "That account is already invited; a new code has been issued.",
      },
      replayed: false,
    });
  }

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(staffOperators).values({
      id,
      email,
      status: "INVITED",
      role,
      nominatedBy: admin.email,
      nominatedAt: now,
    });
    await writeAudit(
      tx,
      audit(id, { status: null, role: null }, { status: "INVITED", role, nominatedBy: admin.email }),
    );
  });
  return c.json({
    operator: {
      staffId: id,
      email,
      status: "INVITED",
      role,
      nominatedBy: admin.email,
      nominatedAt: iso(now),
    },
    invitation: {
      challengeId,
      delivery: delivery.sent ? "email" : "dev-log",
      mailConfigured: mailConfigured(c.env),
      devCode: delivery.devCode,
      mailError: delivery.error ?? null,
      message: delivery.sent
        ? "Invitation sent. They verify their email, then you approve the account."
        : `Email was not sent (${delivery.error ?? "preview"}). API_ENV is still preview, so this code works until Resend delivers.`,
    },
    replayed: false,
  }, 201);
});

/**
 * THE STAFF LIFECYCLE'S TRANSITION GUARDS.
 *
 * Phase 2 turned "invite" from a single write into a chain, so the chain needs
 * the same kind of table §49 gives licences: an explicit set of legal `from`
 * states per action, rather than a sequence of `if`s scattered through three
 * handlers. A row is *in* one of these lists or it is not - there is no
 * ordering to get subtly wrong and no state that quietly falls through.
 *
 * Everything absent from both lists is refused with 409, which is the right
 * status: what disagrees is the record's current state, not the request's
 * shape (400) and not the caller's identity (403).
 */
const STAFF_APPROVE_FROM = Object.freeze(["EMAIL_VERIFIED", "SUSPENDED"] as const);
const STAFF_SUSPEND_FROM = Object.freeze(["INVITED", "EMAIL_VERIFIED", "ACTIVE"] as const);

/** Operator-facing reason a `from` state is refused by `approve`. */
function approveRefusal(status: string): string {
  return status === "INVITED"
    ? "That account has not verified its email yet. They must complete sign-in before you can approve it."
    : "A revoked account cannot be re-approved. Nominate a new address instead.";
}

/** Operator-facing reason a `from` state is refused by `suspend`. */
function suspendRefusal(status: string): string {
  return status === "REVOKED"
    ? "That account has been revoked; revoked accounts are not suspended."
    : "That account is already suspended.";
}

/**
 * APPROVE - `EMAIL_VERIFIED -> ACTIVE`, or `SUSPENDED -> ACTIVE`.
 *
 * The gate is `staff:manage`, i.e. SUPER_ADMIN alone (§41), and it is the
 * *only* way any row reaches `ACTIVE`: `POST /staff` no longer activates
 * anybody (ruling R3). So activation is a decision with a named author, which
 * is what makes the audit row worth reading six months later.
 *
 * `INVITED -> ACTIVE` is deliberately absent. It would let an admin skip the
 * OTP that proves the address is real, and then the verification step is a
 * formality that can be waved through whenever it is inconvenient - at which
 * point it is not a control. An invite that bounced stays `INVITED` until it
 * is revoked and re-sent, which is visible in the roster rather than hidden.
 *
 * `SUSPENDED -> ACTIVE` is present because suspension is the *temporary*
 * state: without it the only way to lift a suspension would be revoke plus
 * re-invite, which destroys the very history the audit trail exists to keep.
 * Revocation stays permanent for the same reason in the other direction.
 */
adminRoutes.post("/staff/:staffId/approve", async (c) => {
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

  // Already live: the decision has been made. Returning the row without
  // writing is what stops a double-click putting two activations in the trail
  // for one decision (plan 48) - the same shape as `issue`'s replay.
  if (existing.status === "ACTIVE") {
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        role: existing.role,
        revokedAt: iso(existing.revokedAt),
      },
      replayed: true,
    });
  }
  if (!STAFF_APPROVE_FROM.includes(existing.status as (typeof STAFF_APPROVE_FROM)[number])) {
    return c.json(
      { error: approveRefusal(existing.status), status: existing.status },
      409,
    );
  }

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(staffOperators)
      .set({ status: "ACTIVE" })
      .where(eq(staffOperators.id, staffId))
      .returning();
    if (!row) return null;
    await writeAudit(
      tx,
      auditEntry(frame, {
        // Ruling R2: `STAFF_ROLE_CHANGED` is the granted-vocabulary value for
        // a change of standing; the transition itself is in the two states.
        action: actionFor(ROUTE.approveStaff),
        entityType: ENTITY_STAFF_OPERATOR,
        entityId: row.id,
        previousState: { status: existing.status, role: existing.role },
        newState: { status: row.status, role: row.role, approvedBy: admin.email },
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
      role: updated.role,
      revokedAt: iso(updated.revokedAt),
    },
    replayed: false,
  });
});

/**
 * SUSPEND - any non-terminal state -> `SUSPENDED`.
 *
 * A reason is required and lands in the audit row. Plan 37's reasoning for
 * licences applies unchanged to a person: "suspended" with no stated cause is
 * the one question the roster will be asked, and an immutable trail that
 * cannot answer it is a trail with a hole in it. 400 rather than 409, because
 * what is missing is a field of the request.
 */
adminRoutes.post("/staff/:staffId/suspend", async (c) => {
  const admin = await requireStaffPermission("staff:manage")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const staffId = c.req.param("staffId");
  if (!isUuid(staffId)) return c.json({ error: "staffId must be a UUID." }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason ?? "").trim();
  if (reason === "") {
    return c.json(
      { error: 'A reason is required to suspend an account. Send it as "reason".' },
      400,
    );
  }
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.id, staffId))
    .limit(1);
  if (!existing) return c.json({ error: "Operator not found." }, 404);

  if (existing.status === "SUSPENDED") {
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        role: existing.role,
        suspendedAt: iso(existing.suspendedAt),
      },
      replayed: true,
    });
  }
  if (!STAFF_SUSPEND_FROM.includes(existing.status as (typeof STAFF_SUSPEND_FROM)[number])) {
    return c.json(
      { error: suspendRefusal(existing.status), status: existing.status },
      409,
    );
  }

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const suspendedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(staffOperators)
      .set({ status: "SUSPENDED", suspendedAt })
      .where(eq(staffOperators.id, staffId))
      .returning();
    if (!row) return null;
    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.suspendStaff),
        entityType: ENTITY_STAFF_OPERATOR,
        entityId: row.id,
        previousState: { status: existing.status, role: existing.role },
        newState: { status: row.status, role: row.role, suspendedBy: admin.email },
        reason,
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
      role: updated.role,
      suspendedAt: iso(updated.suspendedAt),
    },
    replayed: false,
  });
});

adminRoutes.post("/staff/:staffId/revoke", async (c) => {
  const admin = await requireStaffPermission("staff:manage")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const staffId = c.req.param("staffId");
  if (!isUuid(staffId)) return c.json({ error: "staffId must be a UUID." }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = String(body.reason ?? "").trim();
  /*
   * Revocation is permanent, so the reason is permanent too - and it is
   * required for the same reason `suspend` requires one: plan 37's point is
   * that the answer to "why is this account dead" has to outlive everybody who
   * was in the room. Added in Phase 2 alongside `suspend`; the route previously
   * wrote a REVOKED row with no cause recorded at all.
   */
  if (reason === "") {
    return c.json(
      { error: 'A reason is required to revoke an account. Send it as "reason".' },
      400,
    );
  }
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
        reason,
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

/**
 * LIST THE LICENCE REGISTRY - design plan §22.
 *
 * Three things this handler must never do, all of them enforced by
 * `parseSerialQuery` rather than by a comment:
 *
 *   - clamp `pageSize` down to something it did not ask for;
 *   - drop a filter it could not understand;
 *   - return rows without saying how many rows exist in total.
 *
 * The single predicate from `serialQueryWhere(spec)` is passed to **both** the
 * row query and the count query, because building it twice is how a page of
 * 25 and a total of 0 come to describe different questions - at which point
 * `hasMore` stops being a fact. `filtersFor(spec)` echoes the parsed query back
 * and is the same object an export writes into its audit row, so what the
 * client saw, what the server ran, and what the trail records cannot diverge.
 */
adminRoutes.get("/serials", async (c) => {
  const admin = await requirePermission("serial:read")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);

  const parsed = parseSerialQuery(new URL(c.req.url).searchParams);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const spec = parsed.spec;

  const db = c.get("db");
  /*
   * ONE clock read, shared by the row query and the count query below.
   *
   * The two run in the same `Promise.all`, so they already start together, but
   * the point is structural rather than lucky: if each computed its own horizon
   * a licence whose window opened between them would be counted on one side and
   * not selected on the other, and `total` would describe a set the rows do not
   * come from. Every number the pager renders has to come from the same instant
   * or the pager is guessing.
   */
  const now = new Date();
  const where = serialQueryWhere(spec, now);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(mobileSerials)
      .where(where)
      .orderBy(desc(mobileSerials.createdAt), desc(mobileSerials.id))
      .limit(spec.pageSize)
      .offset(offsetOf(spec)),
    db.select({ total: count() }).from(mobileSerials).where(where),
  ]);

  // One extra query for the whole page, never one per row: at 100 rows a
  // per-row lookup would turn a list into 101 round trips, and a list that
  // gets slower as it gets longer is a list people stop paging through -
  // which is how a truncated-looking table becomes a habit.
  const paymentById = await paymentStatusesFor(db, rows.map((row) => row.id));

  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: admin.email,
    // Keys are never in a list response: masked + fingerprinted only.
    serials: await Promise.all(
      rows.map((row) => jsonSerialList(row, paymentById.get(row.id) ?? null)),
    ),
    filters: filtersFor(spec),
    pagination: paginationFor(spec, rows.length, totalRows[0]?.total ?? 0),
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
    serial: jsonSerial(row, await paymentStatusFor(db, serialId)),
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
    return c.json({ error: "deviceMax slab must be 1, 3, 5, 7, 10, 25 or 50 (1-1 / 1-3 / 1-5 / 1-7 / 1-10 / 1-25 / 1-50)." }, 400);
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

  /*
   * ------------------------------------------------------------------
   * RULING R1 - WHY THIS IS `PAYMENT_PENDING` AND WHY `DRAFT` EXISTS
   * ------------------------------------------------------------------
   * `licence_status_enum` ships six values and this route is where the first
   * one is chosen. It is `PAYMENT_PENDING`, and that is not an oversight about
   * the other five:
   *
   *   DRAFT            - accepted, deliberately produced by nothing here;
   *   PAYMENT_PENDING  - what every row this route writes starts at;
   *   PAYMENT_CONFIRMED, READY_TO_GENERATE, KEY_GENERATED, ISSUED
   *                    - unreachable from creation; §49 walks to them;
   *   ACTIVE, EXPIRED  - system edges only;
   *   SUSPENDED, REVOKED - the two negative outcomes.
   *
   * `DRAFT` is in the enum and stays there on purpose, even though no code in
   * this repository writes it. It exists as a *legal* state rather than a live
   * one, because two things are true at once:
   *
   *   1. Nothing about a licence is real before a payment row exists. The
   *      row's money, its customer's intent, whether it will ever be paid -
   *      all of that is pending, and a status saying otherwise would be an
   *      assertion the system has no evidence for. `PAYMENT_PENDING` is the
   *      first state the record can honestly occupy, and the payment row is
   *      written in the same transaction as this one (decision A3), so the two
   *      arrive together.
   *   2. A value with no producer can still be *encountered*. Rows written
   *      before this rule, imported from a provider, or restored from an older
   *      schema may already carry it, and `assertLicenceState` would treat an
   *      unknown-looking `DRAFT` as garbage rather than as a state the schema
   *      declares. Keeping the enum honest about what it accepts costs nothing
   *      and removes a whole class of "the database is stricter than the plan"
   *      surprise.
   *
   * So: `DRAFT` is a state the machine can *read* and never *writes*. That
   * asymmetry is the point, not a TODO. §49's map is unaffected either way -
   * it carries no `DRAFT` edge, because a state nobody creates cannot be
   * departed from by anybody.
   */
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
    // `issued_by` was NOT NULL until migration 0008, which made every create
    // name an issuer before anything had been issued. It is NULL now, and
    // `issued_at` beside it is what `jsonSerial` gates the projected "Issued
    // By" cell on (design freeze §6, §56, acceptance 17) - a gate that still
    // earns its keep for pre-0008 never-issued rows, which hold their creator
    // in this column. `created_by` below carries the meaning that has to
    // survive creation for every row.
    issuedBy: null,
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
 * The one exception is this route's `waivePayment: true`, which is Super Admin
 * only, must carry a reason, and is recorded in the audit row - see the block
 * at the top of the handler. Note what that means for the sentence above:
 * nothing here is *laxer* by default, and a caller who does not explicitly ask
 * for the waiver gets byte-for-byte the Phase 1 answer.
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

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const waivePayment = body.waivePayment === true;
  const waiverReason = String(body.reason ?? "").trim();

  /*
   * ------------------------------------------------------------------
   * THE SUPER ADMIN PAYMENT WAIVER - operator ruling, with two clauses.
   * ------------------------------------------------------------------
   *
   *   "Super admin should have the power to issue licence to any user or
   *    customer, bypassing payment done or not, doesn't matter. Any user
   *    below him is the admin user but not super admin user."
   *
   * CLAUSE 1 - *beneath* him, nobody can. `waivePayment: true` from anyone
   * who is not SUPER_ADMIN is refused here, before the transaction opens and
   * before the state machine is consulted, so the waiver cannot be reached by
   * a permission that happens to include `key:generate`. LICENCE_ADMIN holds
   * that permission and is still refused - which is the point of writing it
   * as a role check in `mayWaivePayment` rather than as a row in §41's
   * matrix: the Green Key Rule's exception belongs to one seat, not to a
   * capability that can be granted onward.
   *
   * CLAUSE 2 - the waiver must be *asked for*. Leaving `waivePayment` off
   * keeps the rule fully in force for everyone, Super Admin included, so an
   * accidental unpaid key is impossible: a Super Admin who forgot to confirm
   * payment gets 403 and a sentence telling them payment is outstanding,
   * rather than a key they did not mean to mint. The bypass is a decision,
   * not an ambient property of who is logged in.
   *
   * And a decision with consequences needs a sentence of its own. A reason is
   * required *with* the waiver and is written into the immutable audit row
   * next to `paymentWaived: true`, so the trail answers "why does this
   * customer hold a key when their payment is still PENDING" without anybody
   * having to reconstruct it from a payment table that will never agree.
   *
   * The waiver does NOT touch `payments.status`. Faking that would put money
   * in the books that never arrived, and it would destroy the one thing the
   * payment table is for. The record keeps its real status; only the licence
   * workflow moves.
   */
  if (waivePayment && !mayWaivePayment(admin)) {
    return c.json(
      {
        error: `The payment waiver is Super Admin only; your role is ${admin.role}. Payment must be confirmed as PAID before a key can be generated.`,
      },
      403,
    );
  }
  if (waivePayment && waiverReason === "") {
    return c.json(
      {
        error:
          'A reason is required when waiving payment: explain why this licence may be issued without payment. Send it as "reason".',
      },
      400,
    );
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

      // Read once, used for both the precondition and the audit row, so the
      // trail records the payment the *transition* saw rather than a second
      // read that could have raced a confirmation.
      const paymentStatus = await paymentStatusFor(tx, serialId);
      const verdict = transition(
        licence.status,
        "KEY_GENERATED",
        adminTransitionContext({
          paymentStatus,
          keyPresent: licence.publicNumber !== null,
          paymentWaived: waivePayment,
          reason: waiverReason || null,
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
          // THE TRANSITION ITSELF.
          //
          // `transition()` above is pure: it says the move is legal, it does not
          // perform it. Writing `generatedBy` without `status` would leave the
          // record claiming `READY_TO_GENERATE` while holding a key, which is
          // three failures at once:
          //
          //   - `/issue` reads the status as its own precondition, so the very
          //     next edge of §49 would answer 409 forever;
          //   - the audit row below records `newState.status` from the *written*
          //     row, so the trail would say nothing moved while minting a key -
          //     an append-only record that contradicts the row it describes;
          //   - §48's retry guard tests `publicNumber !== null` AND
          //     `ALREADY_GENERATED.has(status)`. With the status stuck, a second
          //     click re-enters generation and allocates a second valid key,
          //     which is exactly the outcome §48 forbids.
          //
          // Taken from the accepted edge rather than hard-coded, so the written
          // status is by construction the one that was just authorised - the
          // waived path and the paid path go through the same line and cannot
          // drift apart.
          status: verdict.edge.to,
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
            paymentStatus,
          },
          newState: {
            status: row.status,
            publicNumberFingerprint: await serialFingerprint(publicNumber),
            generatedBy: admin.email,
            /*
             * Written `false` as often as `true`, deliberately. A reader of the
             * trail should never have to reconstruct "was this key generated
             * under a payment waiver" by comparing two tables - and if the field
             * only appeared when waived, its *absence* would have to mean
             * something, which is exactly how a question becomes unanswerable.
             */
            paymentWaived: waivePayment,
            paymentStatus,
            ...(waiverReason === "" ? {} : { reason: waiverReason }),
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

/**
 * EDIT - `PATCH /serials/:serialId`.
 *
 * §14 lists "Edit" as one of the twelve admin actions. It is the only one with
 * no target state, and that is what makes it different from every other write
 * in this file: there is nothing to have *already done*, so there is no replay
 * guard and there cannot be one. Two saves are two events, and an append-only
 * trail that recorded only the first would be describing a register it does not
 * hold. The guard here is instead about *what may move*.
 *
 * THE BOUNDARY IS THE CUSTOMER, NOT THE LICENCE
 * ---------------------------------------------
 *   - Customer contact fields are editable while the record is still being
 *     prepared: `PAYMENT_PENDING`, `PAYMENT_CONFIRMED`, `READY_TO_GENERATE`
 *     and `KEY_GENERATED` are all states in which no credential has left the
 *     building, so correcting an address cannot invalidate anything a customer
 *     already holds.
 *   - From `ISSUED` onwards the customer fields are frozen (409). A licence
 *     the customer has been emailed is a fact; re-pointing it at a different
 *     inbox afterwards would make the trail and the world disagree, and would
 *     let an issued credential be re-addressed without a revoke.
 *   - Plan fields - `deviceMax`, `customerKind`, `brandScope`, `planCode` -
 *     are never editable (400, not 409). They are the licence's *size and
 *     scope*, they are baked into the key string itself (`kindCode()` and the
 *     slab digits), and a record whose plan could be edited after generation
 *     would produce keys whose meaning depends on when you look at them. There
 *     is no state in which they become legal, so refusing them as a bad
 *     request rather than a conflict is the honest answer.
 */
const FROZEN_AFTER_ISSUE: ReadonlySet<LicenceStatus> = new Set<LicenceStatus>([
  "ISSUED",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "REVOKED",
]);

/** Fields that describe the licence's size and scope; never editable. */
const IMMUTABLE_PLAN_FIELDS = [
  "deviceMax",
  "slabMax",
  "customerKind",
  "brandScope",
  "planCode",
] as const;

adminRoutes.patch("/serials/:serialId", async (c) => {
  const admin = await requireStaffPermission("serial:update")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Presence, not difference: a body that *names* an immutable field is
  // refused even when it carries the current value, because the alternative is
  // a client believing it changed a plan it never could.
  const immutable = IMMUTABLE_PLAN_FIELDS.filter((key) => key in body);
  if (immutable.length > 0) {
    return c.json(
      {
        error:
          `${immutable.join(", ")} cannot be edited after creation: the plan is fixed at ${"creation"} and is encoded in the key itself.`,
      },
      400,
    );
  }

  const db = c.get("db");
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(mobileSerials)
      .where(eq(mobileSerials.id, serialId))
      // Same lock the mutating routes take: without it two saves racing each
      // other would both read "editable", both pass the freeze check, and the
      // second would overwrite the first's audit `changes` with a set taken
      // from a row that had already moved.
      .for("update")
      .limit(1);
    if (!previous) return { kind: "not-found" as const };
    if (FROZEN_AFTER_ISSUE.has(previous.status)) {
      return { kind: "frozen" as const, row: previous };
    }

    /*
     * Absent fields keep their current value, so a partial body edits a
     * partial record. `customerEmail` is the one exception to "absent means
     * unchanged" only in that it cannot be blanked - the column is NOT NULL
     * and a licence with no customer is not a licence.
     */
    const next = {
      customerEmail:
        "customerEmail" in body
          ? normalizeEmail(String(body.customerEmail ?? ""))
          : previous.customerEmail,
      paymentNoted:
        "paymentNoted" in body ? String(body.paymentNoted ?? "").trim() : previous.paymentNoted,
      customerFullName:
        "customerFullName" in body
          ? String(body.customerFullName ?? "").trim() || null
          : previous.customerFullName,
      companyName:
        "companyName" in body ? String(body.companyName ?? "").trim() || null : previous.companyName,
      addressLine1:
        "addressLine1" in body ? String(body.addressLine1 ?? "").trim() || null : previous.addressLine1,
      addressLine2:
        "addressLine2" in body ? String(body.addressLine2 ?? "").trim() || null : previous.addressLine2,
      pincode: "pincode" in body ? String(body.pincode ?? "").trim() || null : previous.pincode,
      state: "state" in body ? String(body.state ?? "").trim() || null : previous.state,
    };

    /*
     * The same validator `POST /serials` runs, fed the *merged* candidate with
     * the row's own plan fields - so the rule "a BULK licence must carry a
     * brand scope" holds identically whether you are creating one or editing
     * one. Validating only the supplied fields would let an edit remove the
     * very thing creation required.
     */
    const draftError = licenceDraftError({
      customerEmail: next.customerEmail,
      paymentNoted: next.paymentNoted,
      customerKind: previous.customerKind,
      deviceMax: previous.deviceMax,
      brandScope: previous.brandScope,
      customerFullName: next.customerFullName ?? "",
    });
    if (draftError) return { kind: "invalid" as const, error: draftError };

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      const before = previous[key];
      const after = next[key];
      if (before !== after) {
        changes[key] = { from: before, to: after };
      }
    }

    const [row] = await tx
      .update(mobileSerials)
      .set({ ...next, updatedBy: admin.email })
      .where(eq(mobileSerials.id, serialId))
      .returning();
    if (!row) return { kind: "not-found" as const };

    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.updateSerial),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: { status: previous.status },
        newState: {
          status: row.status,
          updatedBy: admin.email,
          /*
           * Old and new values, not just a field list.
           *
           * `audit_events` is itself gated on `audit:read`
           * (SUPER_ADMIN / LICENCE_ADMIN / AUDITOR) and lives inside the same
           * trust boundary as `mobile_serials`, so recording what a customer
           * address *was* adds no exposure - and it is the only way to answer
           * "who changed this, and from what", which is the entire question an
           * append-only trail exists to answer. A field-name-only entry would
           * be a log that can tell you something happened but not what.
           */
          changes,
        },
      }),
    );
    return { kind: "updated" as const, row, changes };
  });

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "frozen") {
    return c.json(
      {
        error: `A licence in ${outcome.row.status} can no longer be edited; revoke it if the record must change.`,
        status: outcome.row.status,
      },
      409,
    );
  }
  if (outcome.kind === "invalid") return c.json({ error: outcome.error }, 400);
  return c.json({
    serial: jsonSerial(outcome.row),
    updatedFields: Object.keys(outcome.changes),
  });
});

/**
 * RESEND - re-distribute an already-issued licence email.
 *
 * §14's "Resend licence". The word that matters is *re*: this route never
 * generates anything. The key in the email is `row.public_number`, read from
 * the row that already holds it, so a resend cannot produce a second
 * credential for one licence - §48's "must not accidentally create multiple
 * valid licence credentials" is satisfied by not having a call to
 * `uniqueLicenceKey` anywhere in the handler, rather than by remembering not
 * to make one.
 *
 * Permission is `licence:issue`, i.e. SUPER_ADMIN and LICENCE_ADMIN and not
 * OPERATOR. It *is* a form of distribution: whatever the reason for the resend
 * (bounced inbox, a customer who deleted it), the recipient is about to receive
 * a working credential, and §41 does not hand that to someone who may not
 * issue one in the first place.
 *
 * WHICH STATES MAY BE RESENT
 * --------------------------
 * `ISSUED` and `ACTIVE` only. `KEY_GENERATED` is excluded because that key has
 * never been distributed - sending it here would put a credential in an inbox
 * before `/issue` had recorded the issuance, which is the exact order `/issue`
 * exists to enforce. `REVOKED` and `EXPIRED` are excluded because they are the
 * two states in which re-sending would hand a customer something that no longer
 * works. `SUSPENDED` is a deliberate stop, not a delivery problem.
 *
 * NOT IDEMPOTENT, DELIBERATELY. `issue` answers a repeat with "already done"
 * because a second issuance would be a second credential. A second *delivery*
 * is what the operator asked for - the customer did not receive the first one.
 * Each resend therefore writes its own audit row, which is also why the audit
 * row is written before the email goes out: see below.
 */
adminRoutes.post("/serials/:serialId/resend", async (c) => {
  const admin = await requireStaffPermission("licence:issue")(c);
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
  if (row.publicNumber === null) {
    return c.json(
      { error: "This licence has no key yet. Generate one before it can be re-sent." },
      409,
    );
  }
  if (!RESENDABLE.has(row.status)) {
    return c.json(
      {
        error: `A licence in ${row.status} is not re-sendable. Only ISSUED and ACTIVE licences may have their key re-distributed.`,
        status: row.status,
        allowed: [...RESENDABLE],
      },
      409,
    );
  }

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const fingerprint = await serialFingerprint(row.publicNumber);

  /*
   * TRAIL FIRST, EMAIL SECOND - the same order the reports route uses, and for
   * the same reason. The moment that matters is the moment a credential leaves
   * the building; if this write cannot commit, nothing is sent. Over-logging a
   * resend is recoverable (the outcome below corrects the record), a credential
   * mailed without a trail entry is not.
   *
   * The trail records the *attempt* and its destination. Whether it landed is
   * recorded where `/issue` already records it - `mobile_serials.emailed_at` /
   * `email_error` - so neither place is guessing about the other's contents.
   */
  await db.transaction(async (tx) => {
    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.resendLicence),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: {
          status: row.status,
          publicNumberFingerprint: fingerprint,
          emailedAt: iso(row.emailedAt),
        },
        newState: {
          status: row.status,
          publicNumberFingerprint: fingerprint,
          resentTo: row.customerEmail,
          resentBy: admin.email,
          attemptedAt: new Date().toISOString(),
        },
      }),
    );
  });

  const parsed = parseLicenceKey(row.publicNumber);
  const mail = await sendLicenceEmail(c.env, {
    email: row.customerEmail,
    licenceKey: row.publicNumber,
    slabLabel: parsed?.slabLabel ?? `1-${row.deviceMax}`,
    kind: row.customerKind,
    brandScope: row.brandScope,
    serialId: row.id,
  });
  const emailedAt = mail.sent ? new Date() : null;
  const emailError = mail.sent ? null : mail.error ?? "preview-no-email";
  await db
    .update(mobileSerials)
    .set({ emailedAt, emailMessageId: mail.id ?? null, emailError })
    .where(eq(mobileSerials.id, serialId));

  return c.json({
    serial: jsonSerial({ ...row, emailedAt, emailMessageId: mail.id ?? null, emailError }),
    emailed: mail.sent,
    emailError,
    message: mail.sent
      ? `Re-sent to ${row.customerEmail}. The key was not regenerated.`
      : `Not sent: ${emailError}. The key was not regenerated.`,
  });
});

/** Statuses whose key has already been distributed and may be sent again. */
const RESENDABLE: ReadonlySet<LicenceStatus> = new Set<LicenceStatus>([
  "ISSUED",
  "ACTIVE",
]);

/**
 * REQUEST REBIND - §10 ("one-host binding") and §35 ("HOST REBIND POLICY").
 *
 * NOT A §49 TRANSITION, AND NOT PRETENDING TO BE ONE
 * --------------------------------------------------
 * `host_binding_status` is a second, smaller lifecycle with its own authority.
 * `NOT_BOUND -> BOUND` belongs to `POST /v1/activation` and to no admin route,
 * and §49 does not mention host binding at all - so routing this through
 * `transition()` would mean either inventing edges the plan never listed or
 * making a licence-status check answer a question about host binding. The
 * guard is `transitionHostBinding` instead: two actions, four states, and a
 * refusal that is 409 for every case because what disagrees is always the
 * record's current state.
 *
 * `reason` is optional here. §35 asks the *customer* to state why; the
 * administrator confirming that a request exists is not making a §37 decision
 * about a credential, and the two 400-requiring routes in this file are
 * specifically the ones §37 names. When a reason is given it is recorded in
 * `new_state`, which is where the optional facts of an event belong.
 */
adminRoutes.post("/serials/:serialId/rebind/request", async (c) => {
  const admin = await requireStaffPermission("rebind:request")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const reason = readReason(await c.req.json().catch(() => ({})));
  const db = c.get("db");
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(mobileSerials)
      .where(eq(mobileSerials.id, serialId))
      .for("update")
      .limit(1);
    if (!previous) return { kind: "not-found" as const };

    const verdict = transitionHostBinding("request", previous.hostBindingStatus);
    if (!verdict.ok) return { kind: "conflict" as const, refusal: verdict.refusal };
    // §48 replay, decided before anything is written: `REBIND_REQUEST ->`
    // itself is unambiguous, so a second click says "already requested" rather
    // than writing a second request for one customer.
    if (verdict.replay) return { kind: "replay" as const, row: previous };

    const [row] = await tx
      .update(mobileSerials)
      .set({ hostBindingStatus: verdict.next, updatedBy: admin.email })
      .where(eq(mobileSerials.id, serialId))
      .returning();
    if (!row) return { kind: "not-found" as const };

    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.requestRebind),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: { hostBindingStatus: previous.hostBindingStatus },
        newState: {
          hostBindingStatus: row.hostBindingStatus,
          requestedBy: admin.email,
          ...(reason === "" ? {} : { reason }),
        },
        reason: reason || null,
      }),
    );
    return { kind: "requested" as const, row };
  });

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "conflict") {
    return c.json(
      { error: outcome.refusal.message, current: outcome.refusal.current },
      HOST_BINDING_CONFLICT_STATUS,
    );
  }
  if (outcome.kind === "replay") {
    return c.json({
      serial: jsonSerial(outcome.row),
      replayed: true,
      message: "A rebind request is already pending for this licence.",
    });
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

/**
 * APPROVE REBIND - `REBIND_REQUEST -> NOT_BOUND`, invalidating the old host.
 *
 * This is the step §35 calls "old binding invalidated, then new host
 * activation allowed". Three columns move together and they are not
 * interchangeable:
 *
 *   `host_fingerprint`   -> NULL. This is the one-host limit's *subject*
 *                           (§10); leaving it in place would keep the old
 *                           workstation bound while the status claimed
 *                           otherwise, i.e. the exact split-brain §10 exists
 *                           to prevent.
 *   `device_token_hash`  -> NULL. The digest of the bearer secret the old host
 *                           authenticates with. If it survived the rebind the
 *                           previous machine would keep working against a
 *                           binding we have just said is gone.
 *   `first_activ_at`     -> UNCHANGED, deliberately. §10 states it is "set
 *                           once, on the first successful binding, never
 *                           overwritten" - a rebind is not a first binding, and
 *                           zeroing it would erase the date the licence was
 *                           originally claimed, which is the one date nobody
 *                           can reconstruct afterwards.
 *   `devices_bound`      -> 0. Nothing is bound until the new host activates;
 *                           reporting the old count next to a NULL fingerprint
 *                           would be two parts of one row disagreeing.
 *
 * NO REPLAY DETECTION, DELIBERATELY. Approving twice cannot duplicate a
 * credential the way `/issue` can, so §48 does not require it - and there is
 * no column that could distinguish "already approved" from "never requested":
 * both are `NOT_BOUND`. Fabricating a detector here would mean writing a
 * guess into an immutable trail, which is worse than answering 409 to a double
 * click. Only `REBIND_REQUEST` is approvable; everything else is 409 naming
 * what is actually true.
 *
 * `reason` optional, recorded in `new_state`, exactly as `/rebind/request`.
 */
adminRoutes.post("/serials/:serialId/rebind/approve", async (c) => {
  const admin = await requireStaffPermission("rebind:approve")(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const reason = readReason(await c.req.json().catch(() => ({})));
  const db = c.get("db");
  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);

  const outcome = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(mobileSerials)
      .where(eq(mobileSerials.id, serialId))
      .for("update")
      .limit(1);
    if (!previous) return { kind: "not-found" as const };

    const verdict = transitionHostBinding("approve", previous.hostBindingStatus);
    if (!verdict.ok) return { kind: "conflict" as const, refusal: verdict.refusal };

    const [row] = await tx
      .update(mobileSerials)
      .set({
        hostBindingStatus: verdict.next,
        hostFingerprint: null,
        deviceTokenHash: null,
        devicesBound: 0,
        updatedBy: admin.email,
      })
      .where(eq(mobileSerials.id, serialId))
      .returning();
    if (!row) return { kind: "not-found" as const };

    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.approveRebind),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: {
          hostBindingStatus: previous.hostBindingStatus,
          // Shapes, never values: an audit row is a record of what happened,
          // not a second place a host identity or a token digest lives.
          hostFingerprintPresent: previous.hostFingerprint !== null,
          deviceTokenHashPresent: previous.deviceTokenHash !== null,
          firstActivatedAt: iso(previous.firstActivatedAt),
          devicesBound: previous.devicesBound,
        },
        newState: {
          hostBindingStatus: row.hostBindingStatus,
          hostFingerprintPresent: row.hostFingerprint !== null,
          deviceTokenHashPresent: row.deviceTokenHash !== null,
          firstActivatedAt: iso(row.firstActivatedAt),
          devicesBound: row.devicesBound,
          approvedBy: admin.email,
          ...(reason === "" ? {} : { reason }),
        },
        reason: reason || null,
      }),
    );
    return { kind: "approved" as const, row };
  });

  if (outcome.kind === "not-found") return c.json({ error: "Serial not found." }, 404);
  if (outcome.kind === "conflict") {
    return c.json(
      { error: outcome.refusal.message, current: outcome.refusal.current },
      HOST_BINDING_CONFLICT_STATUS,
    );
  }
  return c.json({ serial: jsonSerial(outcome.row), replayed: false });
});

/**
 * VIEW ACTIVATION - `GET /serials/:serialId/activation`.
 *
 * §14's twelfth action is "View activation", and it is a **GET on purpose**.
 * It reads host-binding state and writes nothing: there is no
 * `audit_action_enum` value for "somebody looked", and inventing one would put
 * a row in an append-only trail asserting an event that never happened. It is
 * therefore absent from `ROUTE_ACTION_MAP` - see the comment there, which lists
 * all three GETs in this file and says which of them is audited and why.
 *
 * It is still gated (`serial:read`), because "may look at activation" is a
 * question §41 answers separately from "may edit the customer address".
 *
 * WHAT IT WILL NOT RETURN: the raw `host_fingerprint` or the
 * `device_token_hash`. The first is the one-host limit's matcher, the second
 * is the digest of a bearer secret, and neither belongs in a response just
 * because the caller is authenticated. What goes out is a derived, truncated
 * hash - enough to answer "is this the same machine as last time" by
 * comparison, useless as a matcher against a live session. `device_token_hash`
 * is reported only as present/absent, which is the question an operator
 * actually has ("is anything still bound?") and the only form that cannot be
 * replayed.
 */
adminRoutes.get("/serials/:serialId/activation", async (c) => {
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
    serialId: row.id,
    status: row.status,
    hostBinding: {
      status: row.hostBindingStatus,
      deviceMax: row.deviceMax,
      devicesBound: row.devicesBound,
      firstActivatedAt: iso(row.firstActivatedAt),
      // Truncated SHA-256 of the fingerprint, not the fingerprint. Comparable
      // across two responses, and worthless as a matcher in one.
      hostFingerprintFp: row.hostFingerprint
        ? (await sha256Hex(row.hostFingerprint)).slice(0, 16)
        : null,
      deviceTokenPresent: row.deviceTokenHash !== null,
    },
    // Why the licence exists at all: without it "1 of 1 devices bound" has no
    // denominator.
    plan: { planCode: row.planCode, customerKind: row.customerKind, brandScope: row.brandScope },
    distribution: { emailedAt: iso(row.emailedAt), emailError: row.emailError },
  });
});

/**
 * EXPORT ONE RECORD - `GET /serials/:serialId/export`.
 *
 * The third GET in this file, and unlike the other two it **is** audited:
 * taking a copy out of the building is an event even though the HTTP method is
 * a read. That is exactly why this route is in `ROUTE_ACTION_MAP` while
 * `/serials/:serialId` and `/serials/:serialId/activation` are not - the
 * distinction is "did anything leave", not "was the method a POST".
 *
 * It sits in no `CONDITIONAL_ROUTES` exemption because the export is
 * unconditional: there is no JSON variant of this endpoint to be confused
 * with, so every request for it is an export and every request writes a row.
 *
 * The projection is `reportRows`, i.e. the same masked list projection the
 * register and `/reports/licences` use - so a single-record export cannot
 * become a quiet way to enumerate keys. The full key path out of this API is
 * still `GET /serials/:serialId` (one row, `serial:read`) plus `/issue`
 * (email), unchanged from Phase 1.
 *
 * Written before the bytes, exactly as `/reports/licences` does: if the audit
 * row cannot commit, no file goes out.
 */
adminRoutes.get("/serials/:serialId/export", async (c) => {
  const admin = await requirePermission("report:export")(c);
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

  const frame = await requireAuditContext(c);
  if ("error" in frame) return c.json({ error: frame.error }, frame.status);
  const generatedAt = new Date();
  // Single licence, single payment row - a one-entry map rather than the batch
  // lookup, so the export and the drawer read the same value through the same
  // ordering rule without paying for a query that could only ever return one.
  const mapped = await reportRows(
    [row],
    new Map([[row.id, await paymentStatusFor(db, serialId)]]),
  );

  await db.transaction(async (tx) => {
    await writeAudit(
      tx,
      auditEntry(frame, {
        action: actionFor(ROUTE.exportSerial),
        entityType: ENTITY_LICENCE,
        entityId: row.id,
        previousState: null,
        newState: {
          /*
           * The five fields the brief requires of every export row. `actor`
           * deliberately repeats the `actor_email` column: as a standalone
           * JSON blob this object should answer "who took this copy" without
           * the reader having to join it back to a column that may be
           * projected away by whatever reads the log.
           */
          actor: frame.actorEmail,
          format: "csv",
          rowCount: mapped.length,
          filters: { serialId: row.id, status: row.status },
          generatedAt: generatedAt.toISOString(),
        },
      }),
    );
  });

  return c.body(toCsv(mapped), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="cyvra-mobile-licence-${row.id}.csv"`,
  });
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
  const mapped = await reportRows(
    rows,
    await paymentStatusesFor(db, rows.map((row) => row.id)),
  );
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
    const generatedAt = new Date();
    await db.transaction(async (tx) => {
      await writeAudit(
        tx,
        auditEntry(frame, {
          action: actionFor(ROUTE.exportLicences),
          entityType: ENTITY_LICENCE_EXPORT,
          entityId: AGGREGATE_ENTITY_ID,
          previousState: null,
          newState: {
            /*
             * The same five fields `GET /serials/:id/export` writes, so an
             * auditor reading either row answers the same five questions in
             * the same shape: who, in what format, how many rows, under what
             * filters, when. `filters` carries the query as parsed rather than
             * as sent, so `from=` and a malformed `from=` that fell back to the
             * default cannot both look like the same range.
             */
            actor: frame.actorEmail,
            format: "csv",
            rowCount: mapped.length,
            filters: { from: from.toISOString(), to: to.toISOString() },
            generatedAt: generatedAt.toISOString(),
            // Kept alongside `filters` because it is the range *as requested*
            // - the two together say whether the caller narrowed the window.
            from: from.toISOString(),
            to: to.toISOString(),
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
