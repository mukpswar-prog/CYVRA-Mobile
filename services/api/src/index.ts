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
import { sendOtpEmail } from "./email";
import { evidenceRoutes } from "./evidence";
import type { Env } from "./env";
import {
  parseRegistration,
  profileColumns,
} from "./registration";
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
    allowHeaders: ["Content-Type", "Authorization"],
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
      ...profileColumns(profile),
    })
    .returning({ id: emailOtpChallenges.id });

  const result = await sendOtpEmail(c.env, {
    email: profile.email,
    code,
    challengeId: challenge.id,
  });

  if (result.error) {
    return c.json({ error: `Could not send sign-in code: ${result.error}` }, 502);
  }

  return c.json({
    challengeId: challenge.id,
    delivery: result.sent ? "email" : "dev-log",
    // Only present in dev mode (no verified Resend domain configured).
    devCode: result.devCode,
    message: result.sent
      ? "We emailed you a 6-digit sign-in code."
      : "Preview mode: no email sent (Resend key missing or domain unverified). Use the code shown below.",
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
