import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * G2 authentication + G5 evidence ingest.
 *
 * Auth (`users`, `email_otp_challenges`, `sessions`) lives in the Worker, not
 * Neon Auth. Evidence tables store S1 batches; `collected_at` is the client
 * collection time and is never updated on idempotent re-upload. Report /
 * sanitization tables wait for later gates.
 */

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

export type User = typeof users.$inferSelect;
export type EmailOtpChallenge = typeof emailOtpChallenges.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type DeviceLifecycle = typeof deviceLifecycles.$inferSelect;
export type ProcessingSession = typeof processingSessions.$inferSelect;
export type CapabilityProfileRow = typeof capabilityProfiles.$inferSelect;
export type EvidenceRecordRow = typeof evidenceRecords.$inferSelect;
export type EvidenceBatchRow = typeof evidenceBatches.$inferSelect;
