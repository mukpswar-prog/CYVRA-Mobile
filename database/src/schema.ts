import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * G2 authentication slice of the CYVRA Mobile Evidence schema.
 *
 * This is intentionally the minimal subset needed for Resend OTP sign-in:
 * `users`, `email_otp_challenges`, and `sessions`. The full logical model
 * (organizations, device_lifecycles, evidence_records, reports, ...) from the
 * engineering guideline is layered on later gates.
 *
 * Auth lives in the Worker (not Neon Auth) so OTP + sessions stay in one place.
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

export type User = typeof users.$inferSelect;
export type EmailOtpChallenge = typeof emailOtpChallenges.$inferSelect;
export type Session = typeof sessions.$inferSelect;
