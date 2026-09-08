import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
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
import type { Env } from "./env";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_OTP_ATTEMPTS = 5;
const SESSION_COOKIE = "cyvra_session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Variables = { db: Database };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  return cors({
    origin: c.env.APP_ORIGIN ?? "http://localhost:5173",
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

/** Open a DB connection for the request and close it after the response. */
app.use("*", async (c, next) => {
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
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return c.json({ error: "A valid email address is required." }, 400);
  }

  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [challenge] = await db
    .insert(emailOtpChallenges)
    .values({ email, codeHash, expiresAt })
    .returning({ id: emailOtpChallenges.id });

  const result = await sendOtpEmail(c.env, {
    email,
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
      : "Dev mode: no email sent. Use the code shown below (also in the API logs).",
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

  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: challenge.email })
      .returning();
  }

  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(sessions)
    .values({ userId: user.id, tokenHash, expiresAt: sessionExpiresAt });

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: c.env.API_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });

  return c.json({
    user: { id: user.id, email: user.email },
    isNewUser: !user.lastLoginAt,
  });
});

app.get("/me", async (c) => {
  const db = c.get("db");
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ user: null }, 200);

  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({ id: users.id, email: users.email, lastLoginAt: users.lastLoginAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return c.json({ user: row ?? null });
});

app.post("/auth/logout", async (c) => {
  const db = c.get("db");
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
  setCookie(c, SESSION_COOKIE, "", { path: "/", maxAge: 0 });
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
