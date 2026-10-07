-- MANUAL RUNBOOK - NOT a drizzle migration; Chief Engineer approval only
-- =====================================================================================
-- 0010_backfill_drizzle_tracker  --  LEDGER REPAIR ONLY. CONTAINS NO SCHEMA CHANGE.
-- =====================================================================================
--
-- Status      : DRAFT. NOT APPLIED. Do not run against Neon without explicit
--               Chief Engineer approval (07-Oct-2026, Task C).
-- Purpose     : Close finding N1 (tracker desync) and unblock D4.
--
-- ------------------------------------------------------------------------------------
-- THE DEFECT
-- ------------------------------------------------------------------------------------
-- Neon's physical schema is at migration 0009, but drizzle.__drizzle_migrations only
-- records through 0007. Observed 07-Oct-2026 (read-only):
--
--     id 6..13, created_at matching journal idx 0..7 (0000 .. 0007)
--     idx 8  0008_registration_bridge   -> ABSENT from tracker
--     idx 9  0009_payment_method        -> ABSENT from tracker
--
-- Both migrations ARE applied to the database:
--   * 0008 -> 'SYSTEM' present in staff_role_enum (enumsortorder 5);
--              email_otp_challenges.device_max exists;
--              mobile_serials.issued_by is nullable.
--   * 0009 -> public.payment_method_enum exists (typtype 'e'), 7 labels in ruling
--              order UPI, BANK_TRANSFER, CARD, NET_BANKING, CASH, CHEQUE, OTHER;
--              payments.payment_method is payment_method_enum.
-- They were applied outside drizzle, so no tracker row was ever written.
--
-- ------------------------------------------------------------------------------------
-- WHY IT CRASHES
-- ------------------------------------------------------------------------------------
-- database/node_modules/drizzle-orm/pg-core/dialect.js:56-70:
--
--     select id, hash, created_at from drizzle.__drizzle_migrations
--       order by created_at desc limit 1
--     ...
--     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
--         -> execute the migration, then
--         -> insert into drizzle.__drizzle_migrations ("hash", "created_at") values (...)
--
-- Today max(created_at) = 1790947610665 (0007), so:
--   * 0008 folderMillis 1791170168082 -> 1790947610665 < it -> RE-RUNS
--       ALTER TYPE staff_role_enum ADD VALUE 'SYSTEM'    -> duplicate enum label
--       ALTER TABLE email_otp_challenges ADD COLUMN ...  -> column already exists
--   * 0009 folderMillis 1791286350771 -> 1790947610665 < it -> RE-RUNS
--       CREATE TYPE payment_method_enum ...              -> type already exists
--                                       (0009 has NO IF NOT EXISTS)
-- drizzle-kit migrate therefore aborts, records nothing, and every retry is
-- byte-identical: the chain cannot self-heal until the ledger is repaired.
--
-- ------------------------------------------------------------------------------------
-- WHY THESE TWO ROWS ARE EXACTLY RIGHT
-- ------------------------------------------------------------------------------------
-- hash algorithm is verbatim from database/node_modules/drizzle-orm/migrator.js:
--
--     hash: crypto.createHash("sha256").update(query).digest("hex")
--     folderMillis: journalEntry.when
--
-- i.e. sha256 of the raw UTF-8 bytes of the migration .sql file, and created_at is the
-- journal 'when'. Both were reproduced against three rows ALREADY in the tracker:
--
--     0005_mobile_licences        expected 5cb8b060...79a30    -> MATCH
--     0006_dashing_vertigo        expected d95f7f84...8e8e3c   -> MATCH
--     0007_w5_admin_control_plane expected fdea2038...486338b3  -> MATCH
--
-- Reproduction was byte-identical whether hashed from the working tree or from
-- `git show main:<path>`, so the values below are checkout-independent.
--
-- ------------------------------------------------------------------------------------
-- (a) FILE-NUMBERING HAZARD -- FLAGGED, UNRESOLVED
-- ------------------------------------------------------------------------------------
-- This file is named 0010_* by order. drizzle-kit's next `generate` will also be
-- numbered 0010 (snapshots currently end at 0009), producing a second 0010_* file.
-- They would not collide by filename but would share a numeric prefix.
-- RENAME TO A NON-MIGRATORY PATH (e.g. scripts/) OR RESERVE 0010 BEFORE MERGING.
--
-- ------------------------------------------------------------------------------------
-- (b) THIS FILE MUST NOT BE ADDED TO migrations/meta/_journal.json
-- ------------------------------------------------------------------------------------
-- drizzle only applies migrations listed in the journal. Leaving this file unjournaled
-- is deliberate: it stops `drizzle-kit migrate` from ever treating a ledger repair as a
-- schema migration. Apply manually, in one transaction, then verify.
--
-- ------------------------------------------------------------------------------------
-- (c) ALREADY-RUN GUARD
-- ------------------------------------------------------------------------------------
-- Every INSERT below is `WHERE NOT EXISTS`, keyed on created_at. Re-running is a no-op.
-- =====================================================================================

BEGIN;

-- 0008_registration_bridge  (journal idx 8, when 1791170168082)
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
    '108aa662f2e12d349427bcc61e4cf698a1b59fdfeaaf384dc52443afad9b0647',
    1791170168082::bigint
WHERE NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1791170168082
);
--> statement-breakpoint

-- 0009_payment_method  (journal idx 9, when 1791286350771)
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
    '72317c26f96bb50079923ded2d794daef199835bc65d9ae51d646c0d7312b763',
    1791286350771::bigint
WHERE NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1791286350771
);
--> statement-breakpoint

-- ------------------------------------------------------------------------------------
-- POST-CONDITION CHECKS. Run after COMMIT. Any unexpected result means STOP and
-- re-diagnose rather than proceeding to `drizzle-kit migrate`.
-- ------------------------------------------------------------------------------------
-- Expect: row_count 10, min_id 6, max_id 15, max_created_at 1791286350771.
SELECT
    count(*)        AS row_count,
    min(id)         AS min_id,
    max(id)         AS max_id,
    max(created_at) AS max_created_at
FROM drizzle.__drizzle_migrations;
--> statement-breakpoint

-- Expect 0 rows. A hit means a duplicate ledger row exists and drizzle's
-- `order by created_at desc limit 1` could resolve ambiguously.
SELECT created_at, count(*) AS n
FROM drizzle.__drizzle_migrations
WHERE created_at IN (1791170168082, 1791286350771)
GROUP BY created_at
HAVING count(*) > 1;
--> statement-breakpoint

-- Expect 0 rows: every journal 'when' must be backed by a tracker row.
-- VALUES mirrors migrations/meta/_journal.json idx 0..9 exactly, taken from
-- `git show main:database/migrations/meta/_journal.json`. Literals are used
-- instead of pg_read_file() so this runs without superuser rights and without
-- depending on the server's data-directory layout.
WITH expected(idx, tag, journal_when) AS (
    VALUES (0,  '0000_young_darkstar',         1788876182994::bigint),
           (1,  '0001_next_maverick',          1788952901990::bigint),
           (2,  '0002_sturdy_salo',            1788970153672::bigint),
           (3,  '0003_smiling_gideon',         1789013263083::bigint),
           (4,  '0004_happy_centennial',       1789016546386::bigint),
           (5,  '0005_mobile_licences',        1789126500000::bigint),
           (6,  '0006_dashing_vertigo',        1790863606076::bigint),
           (7,  '0007_w5_admin_control_plane', 1790947610665::bigint),
           (8,  '0008_registration_bridge',    1791170168082::bigint),
           (9,  '0009_payment_method',         1791286350771::bigint)
)
SELECT e.idx, e.tag, e.journal_when
FROM expected e
WHERE NOT EXISTS (
    SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = e.journal_when
)
ORDER BY e.idx;
--> statement-breakpoint

-- ------------------------------------------------------------------------------------
-- PROOF THE CRASH IS CLEARED. Expect zero rows (every migration already applied).
-- This is the exact predicate drizzle-orm/pg-core/dialect.js:62 uses.
-- ------------------------------------------------------------------------------------
WITH last_db AS (
    SELECT created_at FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC LIMIT 1
),
expected(idx, tag, folder_millis) AS (
    VALUES (0,  '0000_young_darkstar',         1788876182994::bigint),
           (1,  '0001_next_maverick',          1788952901990::bigint),
           (2,  '0002_sturdy_salo',            1788970153672::bigint),
           (3,  '0003_smiling_gideon',         1789013263083::bigint),
           (4,  '0004_happy_centennial',       1789016546386::bigint),
           (5,  '0005_mobile_licences',        1789126500000::bigint),
           (6,  '0006_dashing_vertigo',        1790863606076::bigint),
           (7,  '0007_w5_admin_control_plane', 1790947610665::bigint),
           (8,  '0008_registration_bridge',    1791170168082::bigint),
           (9,  '0009_payment_method',         1791286350771::bigint)
)
SELECT e.idx, e.tag, e.folder_millis, (SELECT created_at FROM last_db) AS last_db_created_at
FROM expected e, last_db
WHERE last_db.created_at < e.folder_millis
ORDER BY e.idx;

COMMIT;

-- =====================================================================================
-- ROLLBACK (only if the two inserts were applied in error). Removes the LEDGER ROWS
-- ONLY and never touches schema objects:
--
--   BEGIN;
--   DELETE FROM drizzle.__drizzle_migrations
--    WHERE created_at IN (1791170168082, 1791286350771);
--   COMMIT;
--
-- Rolling back re-creates defect N1 in full.
-- =====================================================================================
