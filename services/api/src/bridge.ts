/**
 * WORKSTREAM A - THE LICENCE-CREATION BRIDGE
 * ==========================================
 *
 * ## The journey this closes
 *
 * A customer registered at `cyvoriq.co.in` and the row went nowhere. `users`
 * gained a row, `sessions` gained a row, and `mobile_serials` - the table the
 * admin console's registry, KPI strip and Needs Action queue all read - gained
 * nothing. The operator could not see the customer at all until they thought to
 * type that address into `POST /serials` themselves.
 *
 * The frozen design says the customer registers, a row reflects in the admin
 * console, and the admin confirms payment and issues. Registration-driven
 * creation is the default path - the admin approves and issues - while
 * admin-side creation remains a controlled fallback for authorised exceptional
 * cases and explicitly "is not the normal customer journey" (design freeze
 * 05 Oct 2026 §7.1, §49 "Create/import request"). Step two of that journey was
 * simply missing, and this module is it: registration now produces the row the
 * admin approves.
 *
 * ## What is created, and why that state
 *
 * `PAYMENT_PENDING`, for the reason RULING R1 in `admin.ts:1645` gives at length
 * - nothing about a licence is real before a payment row exists, and
 * `PAYMENT_PENDING` is the first state the record can honestly occupy. `DRAFT`
 * is deliberately not written here for the same deliberate reason it is
 * deliberately not written there: no code in this repository produces it.
 *
 * A `payments` row with `status: "PENDING"` is written in the same transaction
 * (decision A3). Without it the record could never satisfy the Green Key Rule,
 * because there would be nothing to ever mark PAID.
 *
 * ## ONE shared creation function
 *
 * Two callers, one implementation:
 *
 *   1. `POST /auth/verify` - the verified user gets their row immediately;
 *   2. `GET /v1/me/entitlement` - any signed-in customer who somehow has no row
 *      gets it on their next authenticated dashboard load. This is what repairs
 *      accounts registered before this module existed.
 *
 * Both paths call `ensureSerialForUser`. The second exists because the first is
 * a one-shot event that already happened for every existing customer, and a
 * migration that backfilled rows would be inventing commercial records for
 * people who may never have bought anything.
 *
 * ## Idempotency
 *
 * The existence check runs twice: once before opening a transaction (the fast
 * path, so a replay never writes at all) and once again inside it (so two
 * concurrent requests cannot both insert). A replay returns the row it found and
 * performs no insert, no payment row and no audit row.
 *
 * The residual race - two requests both passing the outside check before either
 * opens its transaction - is closed by the inside check. What it cannot close is
 * two requests that reach the inside check *simultaneously*, because
 * `mobile_serials` carries no unique constraint on `customer_email` and adding
 * one would forbid an operator from ever issuing a second licence to an existing
 * customer. Email scoping on the read path already tolerates more than one row
 * (`findSerialForCustomer` takes the newest), so this stays a documented
 * limitation rather than a schema change with a much larger blast radius.
 *
 * ## The actor model
 *
 * `audit_events.actor_role` is NOT NULL and was, until now, four staff values.
 * A customer registering themselves is not a staff act, and pinning it on
 * whichever operator happens to be nearest - or on `SUPER_ADMIN` by default -
 * would be the fabricated actor that `requireAuditContext` exists to refuse.
 *
 * The model chosen is one new value, `SYSTEM`:
 *
 *   * `actor_role = "SYSTEM"` - the software performed this on the customer's
 *     behalf; no human staff member did.
 *   * `actor_id = NULL` - there is no `staff_operators` row to point at, and
 *     fabricating one to satisfy a column is the defect E3 removed. The column
 *     is nullable for exactly this class of event.
 *   * `actor_email` is not a column. The customer's address is recorded in
 *     `new_state.customerEmail`, where it is queryable rather than denormalised.
 *
 * `SYSTEM` is a value of `staff_role_enum` because that is the same enum
 * `audit_events.actor_role` declares, and it is *not* a staff role: `POST /staff`
 * refuses it, `permissionsFor("SYSTEM")` grants nothing, and no `staff_operators`
 * row can hold it. The alternative - making `actor_role` nullable - was rejected
 * because it weakens the invariant `audit.ts:301-303` states plainly ("no
 * state-changing route may ever be reachable without a staff session") in order
 * to describe an event that *does* have an accountable actor: the system.
 *
 * ## Why `licenceDraftError` is not reused
 *
 * `licenceDraftError` validates an operator's typed form: a full name of at
 * least two characters, and a `paymentNoted` that is "a human note that payment
 * transferred". A self-registration row can satisfy neither without lying -
 * `users.full_name` is nullable, and no payment has been transferred. Reusing it
 * would either refuse backfill for every customer who left their name blank or
 * force a fabricated note into a field that asserts money moved. The invariants
 * that *are* real - the email, and the slab - are checked here instead.
 */

import type { Context } from "hono";
import { desc, eq } from "drizzle-orm";
import { mobileSerials, payments } from "@cyvra/database/schema";
import type { Database } from "./db";
import type { Env } from "./env";
import {
  ENTITY_LICENCE,
  ROUTE,
  actionFor,
  auditEntry,
  selfServiceAuditContext,
  writeAudit,
  type AuditExecutor,
  type StaffAuditContext,
} from "./admin/audit";
import type { PaymentStatus } from "./admin/state-machine";
import { isIssuableSlab, planCodeFor } from "./licenceKey";

/**
 * The actor every bridge column points at.
 *
 * It is shaped like the addresses actors are written as elsewhere - free text,
 * an email - so an operator reading `registration@cyvoriq.co.in` learns what
 * actually happened. Today it lands in `created_by`, which the registry and the
 * XLSX export render (design freeze §56, "Created By"). `issued_by` stays NULL:
 * nothing has issued the row. It is not a mailbox.
 */
export const REGISTRATION_ACTOR = "registration@cyvoriq.co.in";

/**
 * The note `payment_noted` carries.
 *
 * `payment_noted` is NOT NULL, and the only honest thing to write on a row whose
 * payment has not happened is that it has not happened. `payments.status` stays
 * `PENDING`, which is the fact this note defers to.
 */
const PAYMENT_NOTE = "Registered online; no payment recorded at registration.";

/** The bridge's own request context - the same one every route in this repo uses. */
export type BridgeContext = Context<{ Bindings: Env; Variables: { db: Database } }>;

/**
 * Everything the row is copied from the `users` record, per the ratified spec:
 * company, name and address come from the user, not from the form's snapshot,
 * so a profile corrected after registration still produces a correct licence.
 */
export interface SerialSeed {
  readonly email: string;
  readonly userId: string | null;
  readonly fullName: string | null;
  readonly companyName: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly pincode: string | null;
  readonly state: string | null;
  readonly deviceMax: number;
}

/** The read both the bridge and the entitlement route share. */
export interface CustomerSerial {
  readonly serial: typeof mobileSerials.$inferSelect;
  readonly paymentStatus: PaymentStatus | null;
}

export interface BridgeResult extends CustomerSerial {
  /** `false` on every replay: the row already existed and nothing was written. */
  readonly created: boolean;
}

/**
 * The invariants a bridge row must satisfy before it may be written.
 *
 * Mirrors the shape of `licenceDraftError` so the two read side by side, and
 * says so in its refusals rather than silently accepting a slab no key could
 * ever encode or a LEGACY plan code a record born today may not claim (design
 * freeze RULE 4).
 *
 * The set is narrower than `licenceDraftError`'s on purpose. That one validates
 * an operator's form, where an operator may legitimately re-open a legacy
 * record; this one runs on customer registrations, which are always new.
 */
export function bridgeDraftError(seed: SerialSeed): string | null {
  const email = seed.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return "customerEmail is required.";
  if (!isIssuableSlab(seed.deviceMax)) {
    return "deviceMax slab must be 1, 5, 10, 25 or 50 (1-1 / 1-5 / 1-10 / 1-25 / 1-50).";
  }
  return null;
}

/**
 * The one serial this customer owns, and its payment status.
 *
 * Scoped by `customer_email` and newest-first for the same reason
 * `GET /v1/me/entitlement` scopes that way: it is the only join that works until
 * every row carries `user_id`, and taking the newest means a customer who
 * somehow has two rows still sees one coherent answer rather than a coin flip.
 */
export async function findSerialForCustomer(
  db: Database,
  email: string,
): Promise<CustomerSerial | null> {
  const [serial] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.customerEmail, email))
    .orderBy(desc(mobileSerials.createdAt))
    .limit(1);
  if (!serial) return null;
  // One `payments` row per serial (schema.ts), newest wins if a migration ever
  // leaves more than one behind.
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.licenceId, serial.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return { serial, paymentStatus: payment?.status ?? null };
}

/**
 * Create the customer's licence record if they do not have one, and return it
 * either way. The single implementation both bridge entry points call.
 *
 * Throws only when the seed cannot honestly produce a row; every caller treats
 * that as "the bridge did not run" and carries on, because a failed backfill
 * must never be able to fail a sign-in or turn a working dashboard into an
 * error page.
 */
export async function ensureSerialForUser(
  c: BridgeContext,
  seed: SerialSeed,
): Promise<BridgeResult> {
  const draftError = bridgeDraftError(seed);
  if (draftError) throw new Error(`bridge seed refused: ${draftError}`);

  const db = c.get("db");
  const email = seed.email.trim().toLowerCase();

  // FAST PATH - a replay stops here, before a transaction is ever opened, so
  // "replay writes nothing" is true at the level of statement count and not
  // merely at the level of rows that end up in the table.
  const existing = await findSerialForCustomer(db, email);
  if (existing) return { ...existing, created: false };

  // The frame is built only on the path that is about to write: `ipAddress` and
  // `route` describe the request that triggered the creation, so deriving them
  // on requests that create nothing would be work whose result is discarded.
  const frame = await selfServiceAuditContext(c, {
    actorId: null,
    actorRole: "SYSTEM",
    actorEmail: email,
  });

  const deviceMax = seed.deviceMax;
  const id = crypto.randomUUID();
  const createdAt = new Date();

  return await db.transaction(async (tx) => {
    // INSIDE CHECK - closes the window the fast path leaves open.
    const raced = await findSerialForCustomer(tx, email);
    if (raced) return { ...raced, created: false };

    /*
     * ONE TRANSACTION, THREE WRITES, NO PARTIAL CREATION - the same shape
     * `POST /serials` uses, for the same stated reason: the licence row, its
     * payment row, and the audit row for the creation either all land or none
     * of them does. If the trail cannot be written, the licence does not exist.
     */
    await tx.insert(mobileSerials).values({
      id,
      // A1: no key until `generate-key` runs. NULL is the truthful projection
      // of "nothing has been generated".
      publicNumber: null,
      status: "PAYMENT_PENDING",
      customerEmail: email,
      // WRITTEN NOW. The column existed and was always NULL; every bridge row
      // carries it from birth. The read path is unchanged and still scopes by
      // `customer_email`, so flipping that scoping later is a follow-up rather
      // than a requirement of this commit.
      userId: seed.userId,
      paymentNoted: PAYMENT_NOTE,
      // NULL from birth, written only by `POST .../issue`. Migration 0008
      // dropped the NOT NULL this used to have, because a placeholder here is
      // a statement about an issuance that has not happened: design freeze §6,
      // §56 and acceptance criterion 17 make "Issued By" answer *who issued
      // this licence*, and nobody has. `created_by` below is what carries "who
      // made this row" out to the registry and the XLSX export.
      issuedBy: null,
      issuedAt: null,
      revokedAt: null,
      createdAt,
      createdBy: REGISTRATION_ACTOR,
      generatedBy: null,
      approvedBy: null,
      hostBindingStatus: "NOT_BOUND",
      planCode: planCodeFor(deviceMax),
      // No validity window until issuance. Backfilling one would invent a start
      // date the system never recorded.
      validityStartsAt: null,
      validityEndsAt: null,
      updatedBy: null,
      rowVersion: 1,
      // Registration collects no bulk purchase, so every bridge row is SINGLE.
      customerKind: "SINGLE",
      deviceMax,
      // The schema default, and >= 2 characters, which is what the brand-scope
      // check asks for: no brand has been scoped by a customer who has not paid.
      brandScope: "UNSPECIFIED",
      // Nullable in the schema on purpose: `users.full_name` is nullable, and
      // inventing a name to satisfy a form validator would put a person in the
      // record who never gave one.
      customerFullName: seed.fullName,
      companyName: seed.companyName,
      addressLine1: seed.addressLine1,
      addressLine2: seed.addressLine2,
      pincode: seed.pincode,
      state: seed.state,
      devicesBound: 0,
      emailedAt: null,
      emailMessageId: null,
      emailError: null,
      hostFingerprint: null,
      firstActivatedAt: null,
      deviceTokenHash: null,
    } satisfies typeof mobileSerials.$inferInsert);

    await tx.insert(payments).values({
      licenceId: id,
      status: "PENDING",
    });

    await writeBridgeAudit(tx, frame, {
      id,
      email,
      planCode: planCodeFor(deviceMax),
      deviceMax,
    });

    return {
      serial: await loadInserted(tx, id),
      paymentStatus: "PENDING" as PaymentStatus,
      created: true,
    };
  });
}

/** Read back what the transaction committed, so the return type cannot drift. */
async function loadInserted(
  db: Database,
  id: string,
): Promise<typeof mobileSerials.$inferSelect> {
  const [serial] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.id, id))
    .limit(1);
  if (!serial) throw new Error("bridge inserted a licence row it cannot read back");
  return serial;
}

/**
 * The audit row for a bridge creation, written by `writeAudit` on the caller's
 * transaction handle - never by middleware, which runs outside it and could only
 * guess the states.
 *
 * The action is `actionFor(ROUTE.createSerial)`: this *is* a serial creation,
 * exactly the event `POST /serials` records. Reusing the declared action rather
 * than a string literal keeps the vocabulary in one place. What distinguishes a
 * registration-created row from an operator-created one is
 * `new_state.source`, not a second enum value the trail would have to grow.
 */
async function writeBridgeAudit(
  tx: AuditExecutor,
  frame: StaffAuditContext,
  row: { id: string; email: string; planCode: string; deviceMax: number },
): Promise<void> {
  await writeAudit(
    tx,
    auditEntry(frame, {
      action: actionFor(ROUTE.createSerial),
      entityType: ENTITY_LICENCE,
      entityId: row.id,
      // No previous state: the row did not exist. A creation has no "before".
      previousState: null,
      newState: {
        status: "PAYMENT_PENDING",
        planCode: row.planCode,
        deviceMax: row.deviceMax,
        // Recorded explicitly so the trail shows the licence was created
        // without a key, not that a key went missing later.
        publicNumber: null,
        // The customer's address, since `actor_email` is not a column.
        customerEmail: row.email,
        source: "registration",
      },
    }),
  );
}
