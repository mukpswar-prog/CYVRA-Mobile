import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * G2 authentication + G5 evidence ingest + G6 reports + G7 serials.
 *
 * Auth (`users`, `email_otp_challenges`, `sessions`) lives in the Worker, not
 * Neon Auth. Evidence tables store S1 batches; `collected_at` is the client
 * collection time and is never updated on idempotent re-upload. Report 1
 * freeze tables (`reports`, `report_manifests`) are G6; sanitization waits.
 */

// =====================================================================================
// W5 enums - CYVRA Mobile Admin Control Plane.
//
// Declared as `pgEnum` rather than text + CHECK so the value set is enforced by
// PostgreSQL itself. The TypeScript state machine (Phase 1) is therefore a
// second, independent guard rather than the only one - a hand-written UPDATE
// or a future route that forgets the state machine still cannot write an
// illegal status.
//
// PLAN CODE, AND WHY CAP-3 / CAP-7 ARE IN HERE
// ---------------------------------------------
// `plan_code_enum` is derived from `mobile_serials.device_max`, whose canonical
// slab set is `[1, 3, 5, 7, 10, 25, 50]` (`services/api/src/licenceKey.ts:28`).
// The commercial plan list is CAP-1/5/10/25/50, but slabs 3 and 7 predate it
// and are encoded inside licence keys real customers already hold (`-1-3`,
// `-1-7`). Re-mapping 3->5 or 7->10 would silently change an entitlement the
// customer bought while their key still says `-1-3`, and would desynchronise
// `device_max` from the slab printed in the key. CAP-3 and CAP-7 are therefore
// retained as LEGACY values: reachable by backfill, never issuable to new
// records. The enum is ordered numerically so ORDER BY plan_code reads 1, 3, 5,
// 7, 10, 25, 50.
//
// CANCELLED LIVES ONLY IN `payment_status_enum`
// ---------------------------------------------
// `licence_status_enum` deliberately has no CANCELLED. Design plan 7 forbids
// combining payment state and licence state into one field; a cancelled payment
// is a financial outcome recorded in `payments`, never a licence lifecycle state.
// =====================================================================================

/**
 * Licence lifecycle - the 10-state workflow machine (design plan 7 / 49).
 *
 * Distinct from `payment_status_enum`: `PAYMENT_CONFIRMED` here is a workflow
 * marker that may only ever be written as a transactional consequence of
 * `payments.status = 'PAID'`, never asserted independently.
 */
export const licenceStatusEnum = pgEnum("licence_status_enum", [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "READY_TO_GENERATE",
  "KEY_GENERATED",
  "ISSUED",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "REVOKED",
]);

/** The 10 licence lifecycle states, as a type. Single source: the pgEnum above. */
export type LicenceStatus = (typeof licenceStatusEnum.enumValues)[number];

/** One-host binding state; `NOT_BOUND -> BOUND` happens only via `POST /v1/activation`. */
export const hostBindingStatusEnum = pgEnum("host_binding_enum", [
  "NOT_BOUND",
  "BOUND",
  "REBIND_REQUEST",
  "LOCKED",
]);

/**
 * Commercial plan codes. `CAP-1 | CAP-5 | CAP-10 | CAP-25 | CAP-50` are
 * issuable; `CAP-3 | CAP-7` are LEGACY (see header note) and are refused by the
 * state machine when a new record is created.
 */
export const planCodeEnum = pgEnum("plan_code_enum", [
  "CAP-1",
  "CAP-3",
  "CAP-5",
  "CAP-7",
  "CAP-10",
  "CAP-25",
  "CAP-50",
]);

/** Financial truth for a licence. One row in `payments` per `mobile_serials` row. */
export const paymentStatusEnum = pgEnum("payment_status_enum", [
  "PENDING",
  "PAID",
  "PARTIALLY_PAID",
  "REFUNDED",
  "CANCELLED",
]);

/**
 * HOW the money arrived - distinct from `paymentStatusEnum`, which says
 * WHETHER it did.
 *
 * ANOMALY, RECORDED NOT INVENTED QUIETLY: the Design Freeze never uses the
 * phrase "payment method" and never lists an allowed set. §18 PAYMENT CONTROL
 * enumerates what confirming a payment must record - Payment Status, Confirmed
 * By, Confirmed At, Reference, Notes, Amount, Currency, Payment Date - and
 * method is not among them. The column exists because WS-H2's brief asks for
 * one, so the value set below is a *code* decision, and it is made explicit so
 * the Chief Engineer can strike or amend it rather than discover it as an
 * assumed fact three releases later.
 *
 * Chosen from what the product already says about payments, not invented
 * afresh: the Confirm Payment placeholder is "UPI ref, bank reference, note"
 * and the legacy admin form reads "UPI / NEFT reference and date" - so UPI and
 * bank transfer are demonstrably real here. The rest are the standard Indian
 * settlement rails plus the fallbacks a business of this size actually
 * encounters.
 *
 * `OTHER` is included on purpose: a required field with no escape hatch
 * produces a lie, and the operator who cannot find their rail will write it
 * into `reference` instead, corrupting a field §18 does specify. One catch-all
 * keeps the specified fields clean.
 *
 * Declared as `pgEnum` rather than text + CHECK, per this file's line 27: the
 * value set belongs to the database so no future writer can accept a method
 * the register does not know.
 */
export const paymentMethodEnum = pgEnum("payment_method_enum", [
  "UPI",
  "BANK_TRANSFER",
  "CARD",
  "NET_BANKING",
  "CASH",
  "CHEQUE",
  "OTHER",
]);

/** The seven ways money can arrive, as a type. Single source: the pgEnum above. */
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

/**
 * The four roles of design plan 41, plus `SYSTEM`.
 *
 * `SYSTEM` is NOT a staff role and can never be held by a `staff_operators`
 * row - `POST /staff` refuses it. It exists for exactly one column:
 * `audit_events.actor_role`, which is NOT NULL, so that an event the software
 * performed on a customer's behalf (the registration bridge) can be recorded
 * truthfully instead of being pinned on whichever staff member happens to be
 * nearest. See `services/api/src/bridge.ts` for the ruling.
 */
export const staffRoleEnum = pgEnum("staff_role_enum", [
  "SUPER_ADMIN",
  "LICENCE_ADMIN",
  "OPERATOR",
  "AUDITOR",
  "SYSTEM",
]);

/** `ACTIVE` replaces the pre-W5 literal `APPROVED`; backfilled in 0007. */
export const staffStatusEnum = pgEnum("staff_status_enum", [
  "INVITED",
  "EMAIL_VERIFIED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
]);

/**
 * The audit vocabulary. Every state-changing admin route must map to exactly
 * one of these; an unmapped route is a load-time failure in Phase 1, not a
 * silently unaudited write.
 */
export const auditActionEnum = pgEnum("audit_action_enum", [
  "SERIAL_CREATED",
  "SERIAL_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_UPDATED",
  "KEY_GENERATED",
  "LICENCE_APPROVED",
  "LICENCE_ISSUED",
  "LICENCE_RESENT",
  "LICENCE_SUSPENDED",
  "LICENCE_REVOKED",
  "REBIND_REQUESTED",
  "REBIND_APPROVED",
  "HOST_LOCKED",
  "EXPORT_GENERATED",
  "STAFF_INVITED",
  "STAFF_ROLE_CHANGED",
  "STAFF_SUSPENDED",
  "STAFF_REVOKED",
  /**
   * WS-K3 - a customer submitted a licence request from the Workspace
   * (`POST /v1/licence-requests`).
   *
   * Appended rather than inserted beside `SERIAL_CREATED`: PostgreSQL cannot
   * reorder an enum's existing values without recreating the type, and
   * drizzle-kit emits a plain `ALTER TYPE ... ADD VALUE` for an append. The
   * value is a label, so its ordinal position carries no meaning - see
   * `idx_audit_events_action`, which indexes the value itself.
   *
   * `SERIAL_CREATED` stays reserved for the registration bridge and for
   * operator-created rows; conflating "a customer pressed a button" with
   * "a licence row came into existence" would lose the distinction the audit
   * log exists to keep.
   */
  "LICENCE_REQUESTED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    fullName: text("full_name"),
    companyName: text("company_name"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    pincode: text("pincode"),
    state: text("state"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  ],
);

export const emailOtpChallenges = pgTable(
  "email_otp_challenges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    // Snapshot of the registration form, applied to `users` on verify.
    fullName: text("full_name"),
    companyName: text("company_name"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    pincode: text("pincode"),
    state: text("state"),
    /**
     * The device slab the customer picked, snapshotted for the same reason the
     * profile fields are: `/auth/request` parses it and `/auth/verify` applies
     * it, and a value that had to survive the round trip in the client's memory
     * would be a value the client could change its mind about.
     *
     * NULL means the registration form offered no plan - which is every
     * registration today, because no checkout step exists yet. The bridge then
     * falls back to `REGISTRATION_DEFAULT_SLAB`.
     */
    deviceMax: integer("device_max"),
    // SHA-256 hex of the one-time code. Plaintext codes are never persisted.
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("email_otp_challenges_email_idx").on(table.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex of the opaque session token stored in the cookie.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

/**
 * G5 evidence ingest. IDs are not interchangeable
 * (PROCESSING_SESSION_ID ≠ DEVICE_LIFECYCLE_ID ≠ EVIDENCE_ID).
 * `collected_at` is the client collection time and is never updated on sync.
 */
export const deviceLifecycles = pgTable(
  "device_lifecycles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    manufacturer: text("manufacturer"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("device_lifecycles_user_id_idx").on(table.userId)],
);

export const processingSessions = pgTable(
  "processing_sessions",
  {
    id: uuid("id").primaryKey(),
    deviceLifecycleId: uuid("device_lifecycle_id")
      .notNull()
      .references(() => deviceLifecycles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("processing_sessions_lifecycle_idx").on(table.deviceLifecycleId),
    index("processing_sessions_user_id_idx").on(table.userId),
  ],
);

export const capabilityProfiles = pgTable(
  "capability_profiles",
  {
    id: uuid("id").primaryKey(),
    deviceLifecycleId: uuid("device_lifecycle_id")
      .notNull()
      .references(() => deviceLifecycles.id, { onDelete: "cascade" }),
    processingSessionId: uuid("processing_session_id")
      .notNull()
      .references(() => processingSessions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("capability_profiles_lifecycle_version").on(
      table.deviceLifecycleId,
      table.version,
    ),
  ],
);

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").primaryKey(),
    deviceLifecycleId: uuid("device_lifecycle_id")
      .notNull()
      .references(() => deviceLifecycles.id, { onDelete: "cascade" }),
    processingSessionId: uuid("processing_session_id")
      .notNull()
      .references(() => processingSessions.id, { onDelete: "cascade" }),
    testId: text("test_id").notNull(),
    source: text("source").notNull(),
    result: text("result").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    method: text("method").notNull(),
    limitation: text("limitation"),
    notes: text("notes"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    digest: text("digest"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evidence_records_session_idx").on(table.processingSessionId),
    index("evidence_records_test_id_idx").on(table.testId),
  ],
);

export const evidenceBatches = pgTable(
  "evidence_batches",
  {
    id: uuid("id").primaryKey(),
    deviceLifecycleId: uuid("device_lifecycle_id")
      .notNull()
      .references(() => deviceLifecycles.id, { onDelete: "cascade" }),
    processingSessionId: uuid("processing_session_id")
      .notNull()
      .references(() => processingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }).notNull(),
    recordCount: integer("record_count").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("evidence_batches_user_id_idx").on(table.userId)],
);

/**
 * G6 Report 1 freeze. `frozen_at` is set once and never updated.
 * The JSON snapshot is the SoT for the PDF/web view.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceLifecycleId: uuid("device_lifecycle_id")
      .notNull()
      .references(() => deviceLifecycles.id, { onDelete: "cascade" }),
    processingSessionId: uuid("processing_session_id")
      .notNull()
      .references(() => processingSessions.id, { onDelete: "cascade" }),
    publicNumber: text("public_number").notNull(),
    coverage: text("coverage").notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reports_session_unique").on(table.processingSessionId),
    uniqueIndex("reports_public_number_unique").on(table.publicNumber),
    index("reports_user_id_idx").on(table.userId),
  ],
);

export const reportManifests = pgTable("report_manifests", {
  reportId: uuid("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type EmailOtpChallenge = typeof emailOtpChallenges.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type DeviceLifecycle = typeof deviceLifecycles.$inferSelect;
export type ProcessingSession = typeof processingSessions.$inferSelect;
export type CapabilityProfileRow = typeof capabilityProfiles.$inferSelect;
export type EvidenceRecordRow = typeof evidenceRecords.$inferSelect;
export type EvidenceBatchRow = typeof evidenceBatches.$inferSelect;
/**
 * G7 mobile licences. Not Windows Erase licence rows.
 * public_number is the parseable licence key (CYVRAddmmyyyyKhhhh-1-N).
 *
 * W5 (0007) - four changes, all load-bearing:
 *
 * 1. `public_number` is now NULLABLE. Decision A1/Option A: a record is created
 *    in DRAFT with no key at all, and `POST /admin/serials/:id/generate-key`
 *    is what allocates one. A unique index still holds; PostgreSQL permits
 *    unlimited NULLs in a unique index, so several DRAFT rows coexist. Every
 *    pre-W5 row already carries a key, so no existing data changes.
 *
 * 2. `status` is retyped to `licence_status_enum` and its **physical column**
 *    is renamed `status -> licence_status` (design plan 5). The Drizzle
 *    property keeps the name `status` on purpose: it is the field name in the
 *    admin JSON contract, and renaming it would cascade into `apps/web/src/api.ts`
 *    and the AdminApp that W5 is about to demolish. The column is renamed; the
 *    wire format is not.
 *
 * 3. `created_by` / `generated_by` / `approved_by` split out of `issued_by`,
 *    which until now was overwritten at issue time and destroyed the original
 *    creator's identity. That identity is NOT recoverable for pre-W5 rows - see
 *    migration 0007 section C3 - so all three stay NULL on backfilled rows
 *    except `approved_by`, which takes the surviving `issued_by`.
 *
 * 4. `validity_starts_at` / `validity_ends_at` added. `EXPIRED` was unreachable
 *    without them: the table never stored an expiry (see `entitlementSigner.ts`
 *    for the documented gap). Nullable, because pre-W5 rows have no stored
 *    window - Phase 1 backfills from the one-year policy or leaves them NULL
 *    until a record is re-issued. Never invented.
 *
 * `updated_by` and `row_version` support optimistic locking (Phase 1 F2): every
 * write matches `WHERE id = $1 AND row_version = $2`, and zero rows affected is
 * a 409 rather than a silent lost update.
 */
export const mobileSerials = pgTable(
  "mobile_serials",
  {
    id: uuid("id").primaryKey(),
    /** NULL while `licence_status` is DRAFT - filled by generate-key (A1). */
    publicNumber: text("public_number"),
    status: licenceStatusEnum("licence_status").notNull(),
    customerEmail: text("customer_email").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    paymentNoted: text("payment_noted").notNull(),
    /**
     * Who issued the licence. NULL from creation until `POST .../issue` writes
     * it beside `issued_at`.
     *
     * It was `NOT NULL` from 0004 until migration 0008, which forced every
     * *create* to name an issuer before anything had been issued and made the
     * column carry two meanings: issuer on issued rows, creator on rows nobody
     * had issued yet (migration 0007 section 6e recovers that creator into
     * `created_by` for the rows where it survives). 0008 drops the constraint;
     * `jsonSerial` still gates the projected value on `issued_at`, because a
     * pre-0008 never-issued row still holds its creator in here.
     */
    issuedBy: text("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Creator at create time. NULL on pre-W5 rows - the value was destroyed. */
    createdBy: text("created_by"),
    /** Who ran generate-key. NULL until a key exists. */
    generatedBy: text("generated_by"),
    /** Who ran approve-and-issue. Backfilled from `issued_by` on existing rows. */
    approvedBy: text("approved_by"),
    hostBindingStatus: hostBindingStatusEnum("host_binding_status")
      .notNull()
      .default("NOT_BOUND"),
    planCode: planCodeEnum("plan_code").notNull(),
    /** NULL when no window is stored; never defaulted to "now" (no invented data). */
    validityStartsAt: timestamp("validity_starts_at", { withTimezone: true }),
    validityEndsAt: timestamp("validity_ends_at", { withTimezone: true }),
    updatedBy: text("updated_by"),
    rowVersion: integer("row_version").notNull().default(1),
    customerKind: text("customer_kind").notNull().default("SINGLE"),
    deviceMax: integer("device_max").notNull().default(3),
    brandScope: text("brand_scope").notNull().default("UNSPECIFIED"),
    customerFullName: text("customer_full_name"),
    companyName: text("company_name"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    pincode: text("pincode"),
    state: text("state"),
    /**
     * WS-K3 / spec 10 "Request date/time" - when this customer actively
     * submitted a licence request through `POST /v1/licence-requests`.
     *
     * `created_at` cannot answer that question: it is written by the
     * registration bridge when the ROW is born, which may be months before the
     * customer asks for anything. Stamping a request onto `created_at` would
     * date it from an event that is not the request.
     *
     * NULL means "never explicitly requested", which is the truthful state of
     * every row that exists today. It is deliberately nullable with no DEFAULT
     * and no backfill: filling it in for existing rows would assert that
     * somebody asked for something when nobody did.
     */
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    devicesBound: integer("devices_bound").notNull().default(0),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    emailMessageId: text("email_message_id"),
    emailError: text("email_error"),
    /**
     * One-host binding, written only by `POST /v1/activation`.
     *
     * `host_fingerprint` is the digest the desktop sends as
     * `device_fingerprint` (already a hardware digest - never a raw identifier,
     * see api.rs `ActivationRequest`). The `IS NULL` -> bound transition is the
     * entire one-host limit; `devices_bound` is NOT used for it, because that
     * column is read as `scansUsed` by `license.ts` and touching it would spend
     * a customer's scan allowance on an activation.
     */
    hostFingerprint: text("host_fingerprint"),
    /** Set once, on the first successful binding. Never overwritten. */
    firstActivatedAt: timestamp("first_activated_at", { withTimezone: true }),
    /**
     * SHA-256 of the issued `device_token`, never the token itself.
     *
     * The desktop round-trips `device_token` on revalidation; storing the
     * digest is what lets the server check it later without keeping a bearer
     * secret at rest. The plaintext is returned once and never persisted.
     */
    deviceTokenHash: text("device_token_hash"),
  },
  (table) => [
    uniqueIndex("mobile_serials_public_number_unique").on(table.publicNumber),
    index("mobile_serials_customer_email_idx").on(table.customerEmail),
    // Name unchanged by the column rename - PostgreSQL keeps the index valid
    // across `ALTER ... RENAME COLUMN`, which is why 0007 renames rather than
    // dropping and re-adding.
    index("mobile_serials_status_idx").on(table.status),
    index("mobile_serials_created_at_idx").on(table.createdAt),
    // Drives the dashboard "Pending Payment" / "Ready to Generate" KPIs and the
    // registry's multi-select payment filter. Without it every KPI is a seq scan.
    index("mobile_serials_plan_code_idx").on(table.planCode),
    // Drives the "Host Binding" column filter (NOT_BOUND / BOUND / ...).
    index("mobile_serials_host_binding_status_idx").on(table.hostBindingStatus),
    // Drives the "Expiring Soon" KPI. Partial for the same reason as the
    // fingerprint index below: rows with no stored window can never satisfy the
    // predicate, so indexing them only bloats the index. NULL is legal for
    // pre-W5 rows, so `IS NOT NULL` is required rather than optional.
    index("idx_mobile_serials_validity_ends_at")
      .on(table.validityEndsAt)
      .where(sql`${table.validityEndsAt} IS NOT NULL`),
    // Partial, because every row that would be looked up has already been
    // claimed. Binding a host flips `host_fingerprint` out of NULL exactly once
    // per licence, so a plain index would spend most of its pages indexing NULLs
    // that can never match a predicate. The `WHERE ... IS NOT NULL` keeps the
    // index to the rows that carry a binding, which is the only thing that makes
    // it worth having.
    index("idx_mobile_serials_host_fingerprint")
      .on(table.hostFingerprint)
      .where(sql`${table.hostFingerprint} IS NOT NULL`),
  ],
);

/**
 * @cyvoriq.com operators nominated by ceo@cyvoriq.com. Not customer users.
 *
 * W5 (0007): `role` added for RBAC, `status` retyped to `staff_status_enum`.
 *
 * NOTE ON THE SPEC'S `invited_by` / `invited_at`
 * ----------------------------------------------
 * Design plan 5 asks for those columns. They already exist under their current
 * names - `nominated_by` and `nominated_at` - and carry exactly that meaning.
 * Adding parallel columns would put two sources of truth on one fact and force
 * every writer to keep them in sync, so this migration reuses them instead of
 * duplicating. `email_verified_at` and `suspended_at` are genuinely new states
 * in `staff_status_enum` and are added.
 *
 * `status` keeps its physical name (only its value set changes):
 * `APPROVED -> ACTIVE`, `REVOKED -> REVOKED`. Pre-W5 rows also carry no role,
 * so `role` is backfilled SUPER_ADMIN where `nominated_by` is the super-admin
 * address, OPERATOR everywhere else - see migration 0007 section C2.
 */
export const staffOperators = pgTable(
  "staff_operators",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    status: staffStatusEnum("status").notNull(),
    role: staffRoleEnum("role").notNull().default("OPERATOR"),
    nominatedBy: text("nominated_by").notNull(),
    nominatedAt: timestamp("nominated_at", { withTimezone: true }).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_operators_email_unique").on(sql`lower(${table.email})`),
    index("staff_operators_status_idx").on(table.status),
    // Lets `requireRole` resolve a principal's role with an index seek rather
    // than a table scan on every authenticated admin request.
    index("staff_operators_role_idx").on(table.role),
  ],
);

export const staffOtpChallenges = pgTable(
  "staff_otp_challenges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("staff_otp_challenges_email_idx").on(table.email)],
);

export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("staff_sessions_token_hash_unique").on(table.tokenHash),
    index("staff_sessions_email_idx").on(table.email),
  ],
);

/**
 * W5 - append-only audit trail (design plan 6, 20, 51).
 *
 * IMMUTABLE AT THE DATABASE, NOT ONLY IN CODE
 * -------------------------------------------
 * A `BEFORE UPDATE OR DELETE` trigger and a `BEFORE TRUNCATE` trigger installed
 * by migration 0007 raise an exception on any mutation. Drizzle exports no
 * `update`/`delete` builder for this table, and no route accepts an audit id.
 * This is the only form of the guarantee that survives a future route, a
 * hand-written psql session, or a migration typo - which is what "immutable from
 * normal UI" actually requires, and it matches frozen directive 6 (IMMUTABILITY).
 *
 * `previous_state` / `new_state` are jsonb snapshots taken inside the same
 * transaction as the change they describe, so an audit row and its mutation
 * commit or roll back together. Nothing is ever backfilled into this table:
 * rows that did not happen are not written after the fact.
 *
 * `ip_address` is NULL for actor-less/system actions. `actor_id` is NULL when
 * the actor is not a `staff_operators` row (e.g. the super-admin address before
 * first nomination) - the actor is still named by `actor_role` plus the route's
 * own recorded email, never by trusting a browser-supplied header.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** `staff_operators.id`. NULL when no staff row exists for the actor. */
    actorId: uuid("actor_id"),
    /** Denormalised so the trail stays readable if a staff row is later revoked. */
    actorRole: staffRoleEnum("actor_role").notNull(),
    action: auditActionEnum("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
    newState: jsonb("new_state").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The drawer's Audit Timeline reads one entity's history newest-first.
    index("idx_audit_events_entity").on(table.entityId, table.createdAt),
    // Filter chips on the activity view.
    index("idx_audit_events_action").on(table.action, table.createdAt),
    index("idx_audit_events_actor").on(table.actorId, table.createdAt),
    index("audit_events_created_at_idx").on(table.createdAt),
  ],
);

/**
 * W5 - financial record, one row per `mobile_serials` row (design plan 5, 7).
 *
 * SEPARATE FROM LICENCE STATE
 * ---------------------------
 * This table is the financial truth. `mobile_serials.status` is the workflow
 * truth. Design plan 7 forbids collapsing them into one field, so
 * `licence_status` may only move to `PAYMENT_CONFIRMED` as a transactional
 * consequence of `payments.status = 'PAID'` - never asserted on its own.
 *
 * `amount` is NULLABLE AND LEFT NULL ON BACKFILL. Pre-W5 records never captured
 * a figure; inventing one to make the column look complete would be fabricating
 * financial data. `reference`, `confirmed_by` and `confirmed_at` are likewise
 * NULL where the fact was never recorded.
 *
 * `row_version` gives the same optimistic-lock guarantee as
 * `mobile_serials.row_version` - a concurrent "Confirm Payment" click resolves
 * as a 409 the client re-fetches, not as two conflicting writes.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    licenceId: uuid("licence_id")
      .notNull()
      .references(() => mobileSerials.id, { onDelete: "restrict" }),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    /*
     * Nullable on purpose, in both directions.
     *
     * Every `payments` row written before WS-H2 has no method and cannot have
     * one - backfilling them would mean asserting how a customer paid last
     * month, and a fabricated audit fact is worse than an empty cell. And a
     * `NOT NULL` with no default would break the 0007 seed INSERT and every
     * `INSERT ... DEFAULT VALUES` after it.
     *
     * Required-ness is enforced where the fact is known: at confirmation
     * time, in `confirm-payment`, inside the same transaction that flips
     * `status` to PAID. A row that is PAID and method-less can therefore only
     * be a pre-WS-H2 row.
     */
    paymentMethod: paymentMethodEnum("payment_method"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("INR"),
    reference: text("reference"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    notes: text("notes"),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_payments_licence_id").on(table.licenceId),
    index("idx_payments_status").on(table.status),
    // The "Pending Payment" KPI and the needs-action queue both ask the same
    // question: which payments are still open? A partial index over two of the
    // five statuses keeps that query off the rows that will never match.
    index("idx_payments_open_status")
      .on(table.status)
      .where(sql`${table.status} IN ('PENDING', 'PARTIALLY_PAID')`),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
export type ReportManifestRow = typeof reportManifests.$inferSelect;
export type MobileSerialRow = typeof mobileSerials.$inferSelect;
export type StaffOperatorRow = typeof staffOperators.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
