import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { setCookie } from "hono/cookie";
import {
  emailOtpChallenges,
  sessions,
  users,
} from "@cyvra/database/schema";
import { connect, type Database } from "./db";
import {
  generateOtpCode,
  generateSessionToken,
  sha256Hex,
  timingSafeEqualHex,
} from "./crypto";
import { mailConfigured, mailFromHost, sendOtpEmail } from "./email";
import { adminRoutes } from "./admin";
import { activationRoutes } from "./activation";
import { entitlementRoutes } from "./entitlement";
import { evidenceRoutes } from "./evidence";
import { licenceRequestRoutes } from "./licenceRequests";
import { licenseRoutes } from "./license";
import { reportRoutes } from "./reports";
import type { Env } from "./env";
import {
  parseRegistration,
  profileColumns,
  REGISTRATION_DEFAULT_SLAB,
} from "./registration";
import { ensureSerialForUser } from "./bridge";
import { isAllowedOrigin } from "./origins";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  readSessionToken,
  sessionCookieOptions,
} from "./session";
import { lookupSessionUser } from "./user";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

type Variables = { db: Database };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  return cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env) ? origin : ""),
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Email"],
  })(c, next);
});

/** Open a DB connection for the request and close it after the response. */
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const { db, client } = await connect(c.env.HYPERDRIVE.connectionString);
  c.set("db", db);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

app.get("/health", async (c) => {
  const db = c.get("db");
  const result = await db.execute(sql`select 1 as ok`);
  const ok = result.rows[0]?.ok === 1;
  return c.json({
    status: ok ? "ok" : "degraded",
    service: "cyvra-mobile-api",
    env: c.env.API_ENV,
    database: ok ? "connected" : "unreachable",
    mailConfigured: mailConfigured(c.env),
    mailFromHost: mailFromHost(c.env),
    time: new Date().toISOString(),
  });
});

app.post("/auth/request", async (c) => {
  const db = c.get("db");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseRegistration(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const profile = parsed.value;

  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [challenge] = await db
    .insert(emailOtpChallenges)
    .values({
      email: profile.email,
      codeHash,
      expiresAt,
      // Snapshotted with the profile for the same reason the profile is
      // snapshotted: `/auth/verify` applies whatever this row recorded, so a
      // plan cannot be changed between asking for a code and entering it.
      deviceMax: profile.deviceMax,
      ...profileColumns(profile),
    })
    .returning({ id: emailOtpChallenges.id });

  const result = await sendOtpEmail(c.env, {
    email: profile.email,
    code,
    challengeId: challenge.id,
  });

  if (!result.sent && c.env.API_ENV === "production") {
    return c.json({ error: `Could not send sign-in code: ${result.error ?? "email failed"}` }, 502);
  }

  return c.json({
    challengeId: challenge.id,
    delivery: result.sent ? "email" : "dev-log",
    mailConfigured: mailConfigured(c.env),
    mailError: result.error ?? null,
    // Only present in preview when Resend did not deliver.
    devCode: result.devCode,
    message: result.sent
      ? "We emailed you a 6-digit sign-in code. Check Inbox, Spam, and Promotions."
      : `Email was not sent (${result.error ?? "preview"}). API_ENV is still preview, so the on-screen code works until Resend delivers.`,
  });
});

app.post("/auth/verify", async (c) => {
  const db = c.get("db");
  const body = (await c.req.json().catch(() => ({}))) as {
    challengeId?: string;
    code?: string;
  };
  const challengeId = (body.challengeId ?? "").trim();
  const code = (body.code ?? "").trim();

  if (!challengeId || !/^\d{6}$/.test(code)) {
    return c.json({ error: "challengeId and a 6-digit code are required." }, 400);
  }

  const [challenge] = await db
    .select()
    .from(emailOtpChallenges)
    .where(eq(emailOtpChallenges.id, challengeId))
    .limit(1);

  if (!challenge) {
    return c.json({ error: "Unknown or expired sign-in request." }, 400);
  }
  if (challenge.consumedAt) {
    return c.json({ error: "This code was already used." }, 400);
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "This code has expired. Request a new one." }, 400);
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    return c.json({ error: "Too many attempts. Request a new code." }, 429);
  }

  const codeHash = await sha256Hex(code);
  if (!timingSafeEqualHex(codeHash, challenge.codeHash)) {
    await db
      .update(emailOtpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(emailOtpChallenges.id, challengeId));
    return c.json({ error: "Incorrect code." }, 400);
  }

  await db
    .update(emailOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(emailOtpChallenges.id, challengeId));

  // Upsert the user (auth lives in the Worker, not Neon Auth).
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, challenge.email))
    .limit(1);

  const isNewUser = !user;
  const profile = {
    fullName: challenge.fullName ?? user?.fullName ?? null,
    companyName: challenge.companyName ?? user?.companyName ?? null,
    addressLine1: challenge.addressLine1 ?? user?.addressLine1 ?? null,
    addressLine2: challenge.addressLine2 ?? user?.addressLine2 ?? null,
    pincode: challenge.pincode ?? user?.pincode ?? null,
    state: challenge.state ?? user?.state ?? null,
  };

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        email: challenge.email,
        lastLoginAt: new Date(),
        ...profile,
      })
      .returning();
  } else {
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        ...profile,
      })
      .where(eq(users.id, user.id));
  }

  /*
   * WORKSTREAM A - THE LICENCE-CREATION BRIDGE.
   *
   * The verified user now gets the `PAYMENT_PENDING` record the admin console's
   * registry, KPI strip and Needs Action queue read, so registering reflects in
   * the admin instead of vanishing into `users`. Everything the row carries is
   * copied from the `users` row rather than from the OTP challenge's snapshot,
   * so a profile corrected after registration still produces a correct licence.
   *
   * This runs for every sign-in, not only new ones, and that is deliberate: it
   * is what repairs accounts registered before this bridge existed. On an
   * account that already has a row it performs no insert, no payment row and no
   * audit row.
   *
   * A failure here is logged and swallowed. Registration must not be turned into
   * an error page by the row it is meant to produce, and the ensure-on-session
   * backfill in `GET /v1/me/entitlement` is the repair path for exactly this
   * case - a customer who signs in and loads their dashboard still gets their
   * record created.
   */
  try {
    await ensureSerialForUser(c, {
      email: user.email,
      userId: user.id,
      fullName: profile.fullName,
      companyName: profile.companyName,
      addressLine1: profile.addressLine1,
      addressLine2: profile.addressLine2,
      pincode: profile.pincode,
      state: profile.state,
      deviceMax: challenge.deviceMax ?? REGISTRATION_DEFAULT_SLAB,
    });
  } catch (error) {
    console.error(
      "[auth/verify] licence bridge failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(sessions)
    .values({ userId: user.id, tokenHash, expiresAt: sessionExpiresAt });

  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c));

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: profile.fullName,
      companyName: profile.companyName,
      addressLine1: profile.addressLine1,
      addressLine2: profile.addressLine2,
      pincode: profile.pincode,
      state: profile.state,
    },
    isNewUser,
    // Returned so Pages preview (pages.dev → workers.dev) can auth without
    // third-party cookies. Cookie still set for same-site custom domains.
    token,
  });
});

app.get("/me", async (c) => {
  const token = readSessionToken(c);
  if (!token) return c.json({ user: null }, 200);
  const user = await lookupSessionUser(c.get("db"), token);
  return c.json({ user });
});

app.route("/evidence", evidenceRoutes);
app.route("/reports", reportRoutes);
app.route("/license", licenseRoutes);
app.route("/admin", adminRoutes);
// Desktop activation. Unauthenticated - it authenticates on the licence key.
// Path matches `Endpoints::default().activate` = "v1/activation"
// (live_client.rs:105), which is the desktop's *assumed* path and is
// overridable there if the deployed route ever has to differ.
app.route("/v1", activationRoutes);
// The customer's own entitlement, for the dashboard.
//
// Same `/v1` prefix - this adds no new route group, only a new path under the
// one that exists. It is deliberately *not* folded into `activationRoutes`:
// that module authenticates on a device token presented by the desktop, this
// one on the customer's browser session, and putting a browser credential in
// the desktop protocol's file would make the two auth models look
// interchangeable when they are not.
//
// `GET /license` below is superseded by this route but stays mounted until a
// hygiene commit retires it.
app.route("/v1", entitlementRoutes);

// WS-K3 - the customer's licence request (spec 9/10), mounted on the same
// `/v1` prefix as the entitlement read so both live on the customer surface
// and neither is mistaken for part of the desktop activation protocol.
app.route("/v1", licenceRequestRoutes);

app.post("/auth/logout", async (c) => {
  const db = c.get("db");
  const token = readSessionToken(c);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
  setCookie(c, SESSION_COOKIE, "", { ...sessionCookieOptions(c), maxAge: 0 });
  return c.json({ ok: true });
});

// Housekeeping endpoint kept internal/simple: clears expired, unconsumed OTPs.
app.post("/internal/prune", async (c) => {
  const db = c.get("db");
  await db
    .delete(emailOtpChallenges)
    .where(
      and(
        isNull(emailOtpChallenges.consumedAt),
        sql`${emailOtpChallenges.expiresAt} < now()`,
      ),
    );
  return c.json({ ok: true });
});

export default app;
