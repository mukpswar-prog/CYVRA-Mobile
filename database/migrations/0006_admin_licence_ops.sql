-- =====================================================================================
-- 0006_admin_licence_ops  --  SKELETON, NOT YET GENERATED OR APPLIED
-- =====================================================================================
--
-- Status      : DRAFT. Tables specified by docs/admin-cyvoriq-upgrade-plan.txt §5.4.
-- How to ship : run `drizzle-kit generate` from `database/` so this file is produced
--               (or reconciled) *with* `migrations/meta/0006_snapshot.json` and a new
--               `_journal.json` entry. Do NOT hand-register a journal entry - a journal
--               row without a matching snapshot desynchronises `drizzle-kit migrate`.
-- Applies to   : next free number is **0006** (confirmed: `_journal.json` ends at idx 5,
--               `0005_mobile_licences`). The existing 0005 is untouched by this file.
--
-- ------------------------------------------------------------------------------------
-- IMPORTANT DEVIATION FROM THE PLAN
-- ------------------------------------------------------------------------------------
-- §5.4 writes `licence_id fk` but never names the target table. The plan was written
-- assuming a `licences` table; **no such table exists** (see
-- docs/ADMIN_OPS_RECON_2026-10-01.md §3). The only real licence row in this schema is
-- `mobile_serials`, so these FKs target `mobile_serials(id)`.
--
-- If a dedicated `licences` table is introduced later, these FKs must be repointed in a
-- follow-up migration. That is an open decision, not something to guess here.
--
-- `admin_audit_log.licence_id` deliberately carries **no** foreign key: an audit row
-- that disappears when the record it describes is deleted is not an audit trail.
--
-- ------------------------------------------------------------------------------------
-- TABLES THE PLAN SPECIFIES, CREATED BELOW
--   licence_verification_events, licence_decisions, mobile_admin_sessions, admin_audit_log
--
-- TABLES *NOT* CREATED HERE - `host_bindings`, `payments`, `communications`
-- These were named in the W4 brief as "§5.4 tables", but §5.4 does not contain them and
-- no column specification for them exists anywhere in this repository or the plan.
-- Inventing columns for them would be fabrication. They remain genuine gaps (recon §3)
-- and need a schema decision first.
-- =====================================================================================

--> statement-breakpoint
-- One verification per licence. `licence_id` is UNIQUE so a re-verification cannot
-- create a second row: the write-once rule T-03 depends on this constraint, not on
-- application discipline.
CREATE TABLE IF NOT EXISTS "licence_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"coverage" text,
	"honesty" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" text NOT NULL,
	"session_id" text,
	CONSTRAINT "licence_verification_events_licence_id_unique" UNIQUE("licence_id")
);
--> statement-breakpoint
-- The decision log. Two constraints carry the plan's guarantees:
--   * UNIQUE("licence_id","decision")  -> write-once per decision (T-06)
--   * UNIQUE("idempotency_key")        -> a replayed click returns the original row
--     instead of recording a second decision.
-- `decided_at` is DEFAULT now() and intended never to be overwritten: the replay path
-- reads it back rather than recomputing it.
CREATE TABLE IF NOT EXISTS "licence_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text NOT NULL,
	"session_id" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "licence_decisions_decision_check" CHECK ("decision" IN ('APPROVE', 'REJECT')),
	CONSTRAINT "licence_decisions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "licence_decisions_licence_id_decision_unique" UNIQUE("licence_id", "decision")
);
--> statement-breakpoint
-- Scoped ops session. The existing `staff_sessions` (0005) has no `scope` column, which
-- is why the plan's scope-mismatch 403 was previously unimplementable (recon §4).
-- `scope` defaults to 'mobile-admin' exactly as §5.4 specifies.
CREATE TABLE IF NOT EXISTS "mobile_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_email" text NOT NULL,
	"scope" text DEFAULT 'mobile-admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"otp_challenge_id" uuid
);
--> statement-breakpoint
-- Append-only audit log (T-10 / T-14 audit rows).
--
-- `id` is `bigserial` per §5.4 so ordering under concurrent inserts needs no extra
-- index. `licence_id` has NO foreign key - see the header.
--
-- APPEND-ONLY ENFORCEMENT IS NOT YET HERE. §5.4 requires "no UPDATE/DELETE grants to
-- app role". That statement names the application role, which is environment-specific
-- and must be supplied when this migration is applied:
--
--   REVOKE UPDATE, DELETE ON TABLE "admin_audit_log" FROM <app_role>;
--   GRANT  INSERT, SELECT ON TABLE "admin_audit_log" TO <app_role>;
--
-- Leaving it out is deliberate: a placeholder role name would silently grant nothing.
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" bigserial PRIMARY KEY,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text NOT NULL,
	"licence_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb,
	"ip" text,
	"ua" text,
	"token_fp" text,
	CONSTRAINT "admin_audit_log_actor_kind_check" CHECK ("actor_kind" IN ('session', 'token'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licence_verification_events_checked_at_idx" ON "licence_verification_events" ("checked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licence_decisions_licence_id_idx" ON "licence_decisions" ("licence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licence_decisions_decided_at_idx" ON "licence_decisions" ("decided_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_admin_sessions_staff_email_idx" ON "mobile_admin_sessions" ("staff_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_admin_sessions_otp_challenge_id_idx" ON "mobile_admin_sessions" ("otp_challenge_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_ts_idx" ON "admin_audit_log" ("ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_licence_id_idx" ON "admin_audit_log" ("licence_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_action_idx" ON "admin_audit_log" ("action");
--> statement-breakpoint
ALTER TABLE "licence_verification_events" ADD CONSTRAINT "licence_verification_events_licence_id_mobile_serials_id_fk"
	FOREIGN KEY ("licence_id") REFERENCES "public"."mobile_serials"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "licence_decisions" ADD CONSTRAINT "licence_decisions_licence_id_mobile_serials_id_fk"
	FOREIGN KEY ("licence_id") REFERENCES "public"."mobile_serials"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "mobile_admin_sessions" ADD CONSTRAINT "mobile_admin_sessions_otp_challenge_id_staff_otp_challenges_id_fk"
	FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."staff_otp_challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
