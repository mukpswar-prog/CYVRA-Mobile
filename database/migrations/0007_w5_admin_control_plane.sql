-- =====================================================================================
-- 0007_w5_admin_control_plane  --  W5 PHASE 0: schema + backfill
-- =====================================================================================
-- Produced by `drizzle-kit generate`, then CORRECTED BY HAND, exactly as 0006
-- was. Read this before editing, and before re-running generate.
--
-- WHY IT WAS CORRECTED
-- --------------------
-- The raw generated file was wrong in two ways that would both have failed
-- mid-migration, and one that would have failed silently. All three are data
-- problems, not syntax problems, which is why `generate` could not see them:
--
--   1. `ALTER COLUMN "status" SET DATA TYPE licence_status_enum USING
--      "status"::licence_status_enum` runs BEFORE any backfill. The legacy
--      literal `PENDING` is not a member of `licence_status_enum`, so the cast
--      aborts on the first row that still holds it. Same for `staff_operators`
--      holding `APPROVED`, which is not in `staff_status_enum`.
--
--   2. `ADD COLUMN "plan_code" plan_code_enum NOT NULL` has no default, so on a
--      table that already has rows PostgreSQL has no value to fill and the
--      statement fails.
--
--   3. The column rename `status -> licence_status` is not emitted at all by
--      `generate`: drizzle-kit resolves a rename through an interactive prompt
--      (`promptColumnsConflicts`) which has no TTY here, so it was elided.
--
-- ORDER IS LOAD-BEARING
-- ---------------------
--   guards  ->  types  ->  tables  ->  DDL  ->  backfill  ->  casts  ->  indexes -> triggers
--
-- The guards run first so that a database whose contents do not match the
-- assumed shape aborts before anything has been touched. The backfill runs
-- before the casts because that is what makes the casts legal. `plan_code` is
-- added nullable, backfilled, then narrowed - the only way to add a NOT NULL
-- column without a default to a populated table.
--
-- RE-RUN BEHAVIOUR (frozen directive: IDEMPOTENCY)
-- -------------------------------------------------
-- Drizzle's `_journal` is what makes this run once, and the DDL statements
-- (`CREATE TYPE`, `CREATE TABLE`, `ADD COLUMN`, `ADD CONSTRAINT`, `RENAME
-- COLUMN`) fail loudly rather than corrupting if applied twice. The *data*
-- statements are additionally idempotent by construction - every `UPDATE` has a
-- `WHERE` naming the pre-migration value, and the `INSERT` is guarded by `NOT
-- EXISTS` - because those are the ones that would damage rows if they ran a
-- second time. Indexes use `IF NOT EXISTS`, following 0006's precedent.
--
-- TIME (frozen directive: UTC ISO-8601)
-- -------------------------------------
-- All timestamps are `timestamp with time zone`. `now()` appears only as a
-- column default and inside `updated_at`, matching `DEFAULT now()` used across
-- the other 14 tables; no application clock is involved in this migration.
--
-- DECISIONS CARRIED IN THIS FILE
-- ------------------------------
--   A1  `public_number` becomes NULLABLE. Records are created in DRAFT with no
--       key; `POST /admin/serials/:id/generate-key` allocates one. Postgres
--       unique indexes permit unlimited NULLs, so coexisting DRAFT rows are
--       legal. Every pre-W5 row already has a key - no existing data changes.
--
--   A2  Ten licence states. `CANCELLED` exists only in `payment_status_enum`;
--       design plan 7 forbids folding payment state into licence state.
--
--   A3  Two fields, two truths. `payments.status` is financial,
--       `mobile_serials.licence_status` is workflow, and
--       `PAYMENT_CONFIRMED` may only ever be written as a consequence of
--       `payments.status = 'PAID'`.
--
--   A4  Additive plan codes. `CAP-3` and `CAP-7` are retained as LEGACY
--       because slabs 3 and 7 are encoded in licence keys real customers hold
--       (`-1-3`, `-1-7`); re-mapping 3->5 or 7->10 would change an entitlement
--       mid-key. `CAP-10` exists in the enum but has no slab yet, so nothing
--       can produce it - see `planCodeFor` in `licenceKey.ts`.
--
--   A5  `validity_starts_at` / `validity_ends_at` added. Without them `EXPIRED`
--       is unreachable: the table never stored an expiry.
--
-- PERMANENT DATA LOSS - DOCUMENTED, NOT PAPERED OVER (C3)
-- -------------------------------------------------------
-- Before W5, `issued_by` was the only actor column and `POST /admin/serials`
-- wrote it at create time (admin.ts `issuedBy: admin.email`) while
-- `POST /admin/serials/:id/issue` **overwrote it** (admin.ts
-- `issuedBy: admin.email` again). Every successful therefore destroyed the
-- creator's identity.
--
-- The damage is recoverable in one direction only, and this migration recovers
-- exactly what the data supports:
--
--   * `issued_at IS NULL`  -> the row was never issued, so `issued_by` still
--                             holds the CREATOR. Recovered into `created_by`.
--   * `issued_at IS NOT NULL` -> `issued_by` was overwritten by the ISSUER, so
--                             it survives only as `approved_by`. The creator of
--                             an issued row is GONE and stays NULL forever.
--
-- `created_by` / `generated_by` are therefore NULL on every issued row and will
-- never be filled. They are not guessed from `created_at` or from the
-- `nominated_by` column: there is no remaining evidence of who they were.
-- =====================================================================================


-- =====================================================================================
-- SECTION 1 - PRECONDITION GUARDS. No writes. Aborts the transaction outright if
-- the data does not match the shape this migration assumes.
-- =====================================================================================
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE "status" NOT IN ('PENDING', 'ISSUED', 'REVOKED');
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007: % mobile_serials row(s) hold a status outside {PENDING, ISSUED, REVOKED}; refusing to invent a mapping',
      bad;
  END IF;

  SELECT count(*) INTO bad FROM "staff_operators"
   WHERE "status" NOT IN ('APPROVED', 'REVOKED');
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007: % staff_operators row(s) hold a status outside {APPROVED, REVOKED}; refusing to invent a mapping',
      bad;
  END IF;

  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE "device_max" NOT IN (1, 3, 5, 7, 25, 50);
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007: % mobile_serials row(s) have device_max outside the slab set; plan_code cannot be derived without inventing it',
      bad;
  END IF;

  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE "status" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'W5 0007: % mobile_serials row(s) have a NULL status', bad;
  END IF;
END $$;
--> statement-breakpoint
-- Capture the pre-backfill row count so section 10 can prove that nothing was
-- lost. Session-scoped and dropped first, so it is correct even if a previous
-- attempt left one behind. Drizzle's pg dialect runs every pending migration
-- inside ONE `session.transaction`, so this temp table, the backfill and the
-- section-10 assertions all see the same snapshot and share one fate: if any
-- assertion raises, the DDL, the backfill and the journal row all roll back
-- together and the database is exactly as it was.
DROP TABLE IF EXISTS "w5_mobile_serials_before";--> statement-breakpoint
CREATE TEMP TABLE "w5_mobile_serials_before" AS
  SELECT count(*)::integer AS n FROM "mobile_serials";--> statement-breakpoint


-- =====================================================================================
-- SECTION 2 - ENUM TYPES. Value sets are documented in `database/src/schema.ts`;
-- the schema file is the single source and this section must match it.
-- =====================================================================================
CREATE TYPE "public"."audit_action_enum" AS ENUM('SERIAL_CREATED', 'SERIAL_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_UPDATED', 'KEY_GENERATED', 'LICENCE_APPROVED', 'LICENCE_ISSUED', 'LICENCE_RESENT', 'LICENCE_SUSPENDED', 'LICENCE_REVOKED', 'REBIND_REQUESTED', 'REBIND_APPROVED', 'HOST_LOCKED', 'EXPORT_GENERATED', 'STAFF_INVITED', 'STAFF_ROLE_CHANGED', 'STAFF_SUSPENDED', 'STAFF_REVOKED');--> statement-breakpoint
CREATE TYPE "public"."host_binding_enum" AS ENUM('NOT_BOUND', 'BOUND', 'REBIND_REQUEST', 'LOCKED');--> statement-breakpoint
-- NOTE: no CANCELLED here. See decision A2 in the header.
CREATE TYPE "public"."licence_status_enum" AS ENUM('DRAFT', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'READY_TO_GENERATE', 'KEY_GENERATED', 'ISSUED', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."payment_status_enum" AS ENUM('PENDING', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
-- Ordered numerically. CAP-3 and CAP-7 are LEGACY (decision A4) - reachable by
-- backfill below, never offered to a new record.
CREATE TYPE "public"."plan_code_enum" AS ENUM('CAP-1', 'CAP-3', 'CAP-5', 'CAP-7', 'CAP-10', 'CAP-25', 'CAP-50');--> statement-breakpoint
CREATE TYPE "public"."staff_role_enum" AS ENUM('SUPER_ADMIN', 'LICENCE_ADMIN', 'OPERATOR', 'AUDITOR');--> statement-breakpoint
-- ACTIVE replaces the pre-W5 literal APPROVED; backfilled in section 6.
CREATE TYPE "public"."staff_status_enum" AS ENUM('INVITED', 'EMAIL_VERIFIED', 'ACTIVE', 'SUSPENDED', 'REVOKED');--> statement-breakpoint


-- =====================================================================================
-- SECTION 3 - NEW TABLES.
-- =====================================================================================
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" "staff_role_enum" NOT NULL,
	"action" "audit_action_enum" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"previous_state" jsonb,
	"new_state" jsonb,
	"ip_address" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"status" "payment_status_enum" DEFAULT 'PENDING' NOT NULL,
	-- NULL on every backfilled row: pre-W5 records never captured a figure.
	-- Leaving it NULL is the honest value; populating it would be fabricating
	-- financial history. See section 6g.
	"amount" numeric(12, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"reference" text,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_licence_id_mobile_serials_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."mobile_serials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint


-- =====================================================================================
-- SECTION 4 - mobile_serials structural changes.
-- =====================================================================================
-- A1. DRAFT rows carry no key. Legal under the existing unique index.
ALTER TABLE "mobile_serials" ALTER COLUMN "public_number" DROP NOT NULL;--> statement-breakpoint
-- Design plan 5. Renamed rather than dropped-and-re-added, which is what keeps
-- `mobile_serials_status_idx` valid: PostgreSQL follows a column rename through
-- to every index that references it, so no index work is needed here.
ALTER TABLE "mobile_serials" RENAME COLUMN "status" TO "licence_status";--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "generated_by" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "host_binding_status" "host_binding_enum" DEFAULT 'NOT_BOUND' NOT NULL;--> statement-breakpoint
-- Added NULLABLE on purpose: there is no default to fill on a populated table,
-- and inventing one would put a real-looking plan code on every existing row
-- before section 6d had a chance to derive it. Narrowed in section 7.
ALTER TABLE "mobile_serials" ADD COLUMN "plan_code" "plan_code_enum";--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "validity_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "validity_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint


-- =====================================================================================
-- SECTION 5 - staff_operators structural changes.
-- =====================================================================================
-- `status` keeps its name; only its value set changes (section 6b).
ALTER TABLE "staff_operators" ADD COLUMN "role" "staff_role_enum" DEFAULT 'OPERATOR' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_operators" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_operators" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint


-- =====================================================================================
-- SECTION 6 - BACKFILL. Every statement is idempotent: the WHERE clause names the
-- pre-migration value, so a second run matches nothing.
-- =====================================================================================

-- 6a. Legacy licence literals -> the ten-state vocabulary.
--     PENDING  -> PAYMENT_PENDING (its meaning was always "created, awaiting
--                 payment"; there is no DRAFT equivalent because pre-W5 rows
--                 were never held without a key).
--     ISSUED   -> ACTIVE where a host actually claimed it (`host_fingerprint`
--                 IS NOT NULL is the proof), otherwise left as ISSUED.
--     REVOKED  -> itself.
UPDATE "mobile_serials" SET "licence_status" = 'PAYMENT_PENDING' WHERE "licence_status" = 'PENDING';--> statement-breakpoint
UPDATE "mobile_serials" SET "licence_status" = 'ACTIVE' WHERE "licence_status" = 'ISSUED' AND "host_fingerprint" IS NOT NULL;--> statement-breakpoint

-- 6b. APPROVED -> ACTIVE. Nothing to do for REVOKED.
UPDATE "staff_operators" SET "status" = 'ACTIVE' WHERE "status" = 'APPROVED';--> statement-breakpoint

-- 6c. Host binding state is fully derivable from `host_fingerprint`.
UPDATE "mobile_serials" SET "host_binding_status" = 'BOUND' WHERE "host_fingerprint" IS NOT NULL;--> statement-breakpoint

-- 6d. Plan code derived from the slab the licence was issued against.
--     Section 1 already proved device_max is inside the slab set, so the CASE
--     cannot return NULL, which is what makes section 7's SET NOT NULL safe.
--     CAP-3 and CAP-7 are deliberate, not oversights - see decision A4.
UPDATE "mobile_serials"
   SET "plan_code" = CASE "device_max"
     WHEN 1  THEN 'CAP-1'::"public"."plan_code_enum"
     WHEN 3  THEN 'CAP-3'::"public"."plan_code_enum"
     WHEN 5  THEN 'CAP-5'::"public"."plan_code_enum"
     WHEN 7  THEN 'CAP-7'::"public"."plan_code_enum"
     WHEN 25 THEN 'CAP-25'::"public"."plan_code_enum"
     WHEN 50 THEN 'CAP-50'::"public"."plan_code_enum"
   END
 WHERE "plan_code" IS NULL;--> statement-breakpoint

-- 6e. Actor recovery - see the C3 note in the header.
--     Split on `issued_at`, the only surviving evidence of which of the two
--     meanings `issued_by` currently carries. Issued rows: the creator is
--     unrecoverable and stays NULL. Never-issued rows: `issued_by` still holds
--     the creator, because nothing has overwritten it yet.
UPDATE "mobile_serials"
   SET "created_by" = "issued_by"
 WHERE "issued_at" IS NULL
   AND "created_by" IS NULL;--> statement-breakpoint
UPDATE "mobile_serials"
   SET "approved_by" = "issued_by"
 WHERE "issued_at" IS NOT NULL
   AND "approved_by" IS NULL;--> statement-breakpoint

-- 6f. Staff roles.
--
--     Before W5 there was exactly one tier: an APPROVED row could do everything
--     the admin console offered (the only distinction was that revocation was
--     hard-coded to the super-admin address). Backfilling those rows to
--     OPERATOR would silently DEMOTE every existing operator the moment this
--     deploys and break live issuance; backfilling to SUPER_ADMIN would hand
--     out domain and staff-revocation powers nobody was granted. LICENCE_ADMIN
--     is the only value that preserves the powers these rows already hold.
--
--     The super-admin address itself becomes SUPER_ADMIN if it has a row at
--     all; `requireAdmin` historically short-circuits on the address without
--     consulting the table, so its absence is expected, not an error.
--
--     `WHERE role = 'OPERATOR'` matches the column default, which makes this a
--     no-op on a re-run.
UPDATE "staff_operators"
   SET "role" = CASE
     WHEN lower("email") = 'ceo@cyvoriq.com' THEN 'SUPER_ADMIN'::"public"."staff_role_enum"
     ELSE 'LICENCE_ADMIN'::"public"."staff_role_enum"
   END
 WHERE "role" = 'OPERATOR';--> statement-breakpoint

-- 6g. One payments row per licence.
--
--     PAID is inferred from `issued_at IS NOT NULL` - a licence that reached
--     issuance was paid for under the pre-W5 flow, which recorded payment as a
--     free-text note at issue. Everything else is PENDING. `amount` and
--     `reference` are left NULL because they were never captured; `notes` says
--     so out loud, so an operator meeting an empty amount for the first time
--     reads why rather than assuming the column is broken.
--
--     NOT EXISTS makes this safe to re-run and harmless if Phase 1 has already
--     begun writing real payment rows.
INSERT INTO "payments"
  ("licence_id", "status", "currency", "confirmed_by", "confirmed_at", "notes", "created_at", "updated_at")
SELECT
  ms."id",
  CASE WHEN ms."issued_at" IS NOT NULL
       THEN 'PAID'::"public"."payment_status_enum"
       ELSE 'PENDING'::"public"."payment_status_enum" END,
  'INR',
  ms."approved_by",
  ms."issued_at",
  'Backfilled by migration 0007 from pre-W5 issuance state. amount/reference were never captured and are left NULL.',
  ms."created_at",
  ms."created_at"
FROM "mobile_serials" ms
WHERE NOT EXISTS (
  SELECT 1 FROM "payments" p WHERE p."licence_id" = ms."id"
);--> statement-breakpoint


-- =====================================================================================
-- SECTION 7 - NARROW TO ENUM TYPES. Legal only because section 6 already moved
-- every value into the target vocabulary.
-- =====================================================================================
ALTER TABLE "mobile_serials" ALTER COLUMN "licence_status" SET DATA TYPE "public"."licence_status_enum" USING "licence_status"::"public"."licence_status_enum";--> statement-breakpoint
ALTER TABLE "staff_operators" ALTER COLUMN "status" SET DATA TYPE "public"."staff_status_enum" USING "status"::"public"."staff_status_enum";--> statement-breakpoint
-- Section 6d proved no row is NULL and the section-1 guard proved device_max is
-- inside the slab set, so this cannot fail here.
ALTER TABLE "mobile_serials" ALTER COLUMN "plan_code" SET NOT NULL;--> statement-breakpoint


-- =====================================================================================
-- SECTION 8 - INDEXES. `IF NOT EXISTS` added by hand (drizzle does not emit it),
-- following 0006's precedent, so each stays idempotent if created out-of-band.
-- =====================================================================================
CREATE INDEX IF NOT EXISTS "idx_audit_events_entity" ON "audit_events" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_action" ON "audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_events_actor" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_licence_id" ON "payments" USING btree ("licence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_open_status" ON "payments" USING btree ("status") WHERE "payments"."status" IN ('PENDING', 'PARTIALLY_PAID');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_serials_plan_code_idx" ON "mobile_serials" USING btree ("plan_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_serials_host_binding_status_idx" ON "mobile_serials" USING btree ("host_binding_status");--> statement-breakpoint
-- Partial because `validity_ends_at` is NULL on every pre-W5 row (decision A5),
-- and a NULL can never satisfy the "Expiring Soon" predicate it serves.
CREATE INDEX IF NOT EXISTS "idx_mobile_serials_validity_ends_at" ON "mobile_serials" USING btree ("validity_ends_at") WHERE "mobile_serials"."validity_ends_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_operators_role_idx" ON "staff_operators" USING btree ("role");--> statement-breakpoint


-- =====================================================================================
-- SECTION 9 - TRIGGERS. This is where "append-only" stops being a convention and
-- becomes a property of the database.
-- =====================================================================================
-- Design plan 20 requires `audit_events` to be immutable from the normal UI.
-- A route that never issues UPDATE/DELETE is not that guarantee: a hand-written
-- psql session, a future migration, or a forgotten Drizzle builder would all
-- pass silently. Raising from the trigger means the only way to alter the trail
-- is to drop the trigger first, which is loud, deliberate, and visible in
-- `pg_trigger`.
--
-- TRUNCATE is covered separately because a row-level trigger never fires for it.
CREATE OR REPLACE FUNCTION "public"."enforce_audit_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only: % on % is forbidden',
    TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update" BEFORE UPDATE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_audit_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "audit_events_no_delete" BEFORE DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_audit_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "public"."enforce_audit_events_append_only"();--> statement-breakpoint
-- `payments.updated_at` has no application writer until Phase 1. A trigger
-- keeps it true regardless of which code path mutates a payment, so it cannot
-- be forgotten by a route that only sets `status`.
CREATE OR REPLACE FUNCTION "public"."set_payments_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "payments_set_updated_at" BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_payments_updated_at"();--> statement-breakpoint


-- =====================================================================================
-- SECTION 10 - POST-MIGRATION ASSERTIONS. The backfill proving itself.
--
-- These are not documentation: they execute inside the same transaction as the
-- backfill, so a migration that produced the wrong data does not commit. Each
-- one is the machine-checkable form of a claim made in the header - which rows
-- were recovered, which were not, that no amount was invented, and that the
-- append-only guarantee is really installed rather than merely requested.
--
-- If one of these fires, nothing has been applied. Read the exception, fix the
-- data or the backfill, and re-run; there is no partially-migrated state to
-- unwind.
-- =====================================================================================
DO $$
DECLARE
  bad     integer;
  licences integer;
  payment_rows integer;
  before_count integer;
BEGIN
  -- A. No row was lost.
  SELECT n INTO before_count FROM "w5_mobile_serials_before";
  SELECT count(*) INTO bad FROM "mobile_serials";
  IF bad <> before_count THEN
    RAISE EXCEPTION
      'W5 0007 assert A: mobile_serials had % row(s) before the backfill and % after',
      before_count, bad;
  END IF;

  -- B. Every plan_code is the one its slab implies. This is decision A4 made
  --    executable: slabs 3 and 7 map to CAP-3 and CAP-7, and nothing was
  --    quietly re-pointed at a neighbouring commercial plan.
  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE "plan_code"::text <> CASE "device_max"
           WHEN 1  THEN 'CAP-1'
           WHEN 3  THEN 'CAP-3'
           WHEN 5  THEN 'CAP-5'
           WHEN 7  THEN 'CAP-7'
           WHEN 25 THEN 'CAP-25'
           WHEN 50 THEN 'CAP-50'
         END;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert B: % row(s) have a plan_code that does not match device_max', bad;
  END IF;

  -- C. Nothing is ACTIVE without a host to prove it. 6a only promoted an
  --    ISSUED row when `host_fingerprint` was present.
  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE "licence_status" = 'ACTIVE' AND "host_fingerprint" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert C: % row(s) are ACTIVE with no host binding', bad;
  END IF;

  -- D. Host binding state agrees with the fingerprint on every row - both
  --    directions, so a BOUND row with no fingerprint is caught too.
  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE ("host_binding_status" = 'BOUND') <> ("host_fingerprint" IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert D: % row(s) disagree with their own host fingerprint', bad;
  END IF;

  -- E. Exactly one payment row per licence.
  SELECT count(*) INTO licences FROM "mobile_serials";
  SELECT count(*) INTO payment_rows FROM "payments";
  IF payment_rows <> licences THEN
    RAISE EXCEPTION
      'W5 0007 assert E: % licence(s) but % payment row(s)', licences, payment_rows;
  END IF;

  -- F. PAID only where the licence actually reached issuance.
  SELECT count(*) INTO bad
    FROM "payments" p
    JOIN "mobile_serials" ms ON ms."id" = p."licence_id"
   WHERE p."status" = 'PAID' AND ms."issued_at" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert F: % payment(s) are PAID for a licence that was never issued', bad;
  END IF;

  -- G. No amount was invented. Pre-W5 never captured a figure, so every row
  --    this migration wrote must still have one - the honesty rule made
  --    checkable instead of asserted in prose.
  SELECT count(*) INTO bad FROM "payments"
   WHERE "notes" LIKE 'Backfilled by migration 0007%'
     AND "amount" IS NOT NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert G: % backfilled payment(s) carry an amount that was never captured', bad;
  END IF;

  -- H. Actor recovery is exclusive - the machine form of the C3 data-loss
  --    note. 6e may write `created_by` only where the row was never issued, and
  --    `approved_by` only where it was; a violation means an issued row was
  --    given a creator the data does not actually support.
  SELECT count(*) INTO bad FROM "mobile_serials"
   WHERE ("issued_at" IS NULL AND "approved_by" IS NOT NULL)
      OR ("issued_at" IS NOT NULL AND "created_by" IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert H: % row(s) have actor columns that contradict issued_at', bad;
  END IF;

  -- I. No staff row was left on the column default, i.e. 6f reached all of
  --    them. Leaving a row as OPERATOR would silently deny an existing
  --    operator the powers they already had the moment this deploys.
  SELECT count(*) INTO bad FROM "staff_operators" WHERE "role" = 'OPERATOR';
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert I: % staff row(s) still carry the OPERATOR default', bad;
  END IF;

  -- J. The super-admin address, if it has a row at all, is SUPER_ADMIN.
  SELECT count(*) INTO bad FROM "staff_operators"
   WHERE lower("email") = 'ceo@cyvoriq.com' AND "role" <> 'SUPER_ADMIN';
  IF bad > 0 THEN
    RAISE EXCEPTION 'W5 0007 assert J: the super-admin address was not promoted';
  END IF;

  -- K. audit_events is still empty. Migration 0007 backfills business tables;
  --    it must not manufacture history for events that predate the audit log.
  SELECT count(*) INTO bad FROM "audit_events";
  IF bad > 0 THEN
    RAISE EXCEPTION
      'W5 0007 assert K: audit_events holds % row(s); backfill must not write history', bad;
  END IF;

  -- L. The append-only guarantee is installed, not merely requested. A CREATE
  --    TRIGGER that quietly did not land would leave `audit_events` mutable
  --    while every reader of this file believed otherwise - so ask pg_trigger.
  SELECT count(*) INTO bad FROM "pg_trigger"
   WHERE tgname IN ('audit_events_no_update', 'audit_events_no_delete', 'audit_events_no_truncate')
     AND NOT tgisinternal;
  IF bad <> 3 THEN
    RAISE EXCEPTION
      'W5 0007 assert L: expected 3 append-only triggers on audit_events, found %', bad;
  END IF;
END $$;

