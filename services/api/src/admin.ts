import { and, desc, eq, gte, lte } from "drizzle-orm";
import { deleteCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import {
  mobileSerials,
  staffOperators,
  staffOtpChallenges,
  staffSessions,
} from "@cyvra/database/schema";
import { isUuid } from "@cyvra/evidence";
import {
  generateOtpCode,
  generateSessionToken,
  sha256Hex,
  timingSafeEqualHex,
} from "./crypto";
import { sendLicenceEmail, sendOtpEmail } from "./email";
import type { Database } from "./db";
import type { Env } from "./env";
import {
  generateLicenceKey,
  isLicenceSlab,
  parseLicenceKey,
  type LicenceKind,
  type LicenceSlabMax,
} from "./licenceKey";
import {
  STAFF_COOKIE,
  STAFF_TTL_MS,
  readStaffToken,
  staffCookieOptions,
} from "./session";

export const SUPER_ADMIN_EMAIL = "ceo@cyvoriq.com";
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

type SerialStatus = "PENDING" | "ISSUED" | "REVOKED";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isCyvoriqEmail(email: string): boolean {
  return email.endsWith("@cyvoriq.com");
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function jsonSerial(row: typeof mobileSerials.$inferSelect) {
  const parsed = parseLicenceKey(row.publicNumber);
  return {
    serialId: row.id,
    publicNumber: row.publicNumber,
    licenceKey: row.publicNumber,
    status: row.status,
    customerKind: row.customerKind,
    deviceMax: row.deviceMax,
    slabLabel: parsed?.slabLabel ?? `1-${row.deviceMax}`,
    brandScope: row.brandScope,
    customerEmail: row.customerEmail,
    customerFullName: row.customerFullName,
    companyName: row.companyName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    pincode: row.pincode,
    state: row.state,
    userId: row.userId,
    paymentNoted: row.paymentNoted,
    devicesBound: row.devicesBound,
    issuedBy: row.issuedBy,
    issuedAt: iso(row.issuedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt),
    emailedAt: iso(row.emailedAt),
    emailMessageId: row.emailMessageId,
    emailError: row.emailError,
  };
}

async function isApprovedOperator(db: Database, email: string): Promise<boolean> {
  if (email === SUPER_ADMIN_EMAIL) return true;
  if (!isCyvoriqEmail(email)) return false;
  const [row] = await db
    .select({ status: staffOperators.status })
    .from(staffOperators)
    .where(eq(staffOperators.email, email))
    .limit(1);
  return row?.status === "APPROVED";
}

async function lookupStaffEmail(
  db: Database,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(staffSessions)
    .where(eq(staffSessions.tokenHash, tokenHash))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  if (!(await isApprovedOperator(db, row.email))) return null;
  return row.email;
}

async function requireAdmin(
  c: Context<{ Bindings: Env; Variables: { db: Database } }>,
): Promise<{ email: string } | { error: string; status: 401 | 503 }> {
  const db = c.get("db");
  const staffEmail = await lookupStaffEmail(db, readStaffToken(c));
  if (staffEmail) return { email: staffEmail };

  const configured = (c.env.ADMIN_API_TOKEN ?? "").trim();
  const header = c.req.header("Authorization") ?? "";
  const token =
    header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7).trim() : "";
  if (!token) {
    return { error: "Admin token required.", status: 401 };
  }
  if (!configured) {
    return { error: "ADMIN_API_TOKEN is not configured.", status: 503 };
  }
  const expected = await sha256Hex(configured);
  const got = await sha256Hex(token);
  if (!timingSafeEqualHex(expected, got)) {
    return { error: "Admin token required.", status: 401 };
  }
  const email = normalizeEmail(c.req.header("X-Admin-Email") ?? "");
  if (!(await isApprovedOperator(db, email))) {
    return {
      error: `X-Admin-Email must be ${SUPER_ADMIN_EMAIL} or a nominated @cyvoriq.com operator.`,
      status: 401,
    };
  }
  return { email };
}

async function uniqueLicenceKey(
  db: Database,
  kind: LicenceKind,
  slabMax: LicenceSlabMax,
  at: Date,
): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const key = generateLicenceKey({ at, kind, slabMax });
    const [existing] = await db
      .select({ id: mobileSerials.id })
      .from(mobileSerials)
      .where(eq(mobileSerials.publicNumber, key))
      .limit(1);
    if (!existing) return key;
  }
  throw new Error("Could not allocate a unique licence key.");
}

function parseReportDate(raw: string, endOfDay: boolean): Date | null {
  if (!raw) return endOfDay ? new Date() : new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T${endOfDay ? "23:59:59.999Z" : "00:00:00.000Z"}`);
  }
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

function reportRows(rows: (typeof mobileSerials.$inferSelect)[]) {
  return rows.map((row) => jsonSerial(row));
}

function toCsv(rows: ReturnType<typeof jsonSerial>[]): string {
  const headers = [
    "licenceKey",
    "status",
    "customerKind",
    "slabLabel",
    "deviceMax",
    "devicesBound",
    "brandScope",
    "customerEmail",
    "customerFullName",
    "companyName",
    "addressLine1",
    "addressLine2",
    "pincode",
    "state",
    "paymentNoted",
    "issuedBy",
    "createdAt",
    "issuedAt",
    "revokedAt",
    "emailedAt",
    "emailMessageId",
    "emailError",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers.map((key) => csvCell(row[key as keyof typeof row] as string | number | null)).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

adminRoutes.post("/auth/request", async (c) => {
  const email = normalizeEmail(
    String(((await c.req.json().catch(() => ({}))) as { email?: string }).email ?? ""),
  );
  if (!isCyvoriqEmail(email)) {
    return c.json({ error: "Only @cyvoriq.com emails can sign in to ops." }, 403);
  }
  const db = c.get("db");
  if (!(await isApprovedOperator(db, email))) {
    return c.json(
      { error: "This email is not nominated by ceo@cyvoriq.com." },
      403,
    );
  }
  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const [challenge] = await db
    .insert(staffOtpChallenges)
    .values({
      email,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    })
    .returning({ id: staffOtpChallenges.id });
  const result = await sendOtpEmail(c.env, {
    email,
    code,
    challengeId: challenge.id,
    purpose: "staff",
  });
  if (result.error) {
    return c.json({ error: `Could not send ops code: ${result.error}` }, 502);
  }
  return c.json({
    challengeId: challenge.id,
    delivery: result.sent ? "email" : "dev-log",
    devCode: result.devCode,
    message: result.sent
      ? "We emailed a 6-digit ops sign-in code."
      : "Preview mode: use the code shown below.",
  });
});

adminRoutes.post("/auth/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    challengeId?: string;
    code?: string;
  };
  const challengeId = (body.challengeId ?? "").trim();
  const code = (body.code ?? "").trim();
  if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) {
    return c.json({ error: "challengeId and 6-digit code are required." }, 400);
  }
  const db = c.get("db");
  const [challenge] = await db
    .select()
    .from(staffOtpChallenges)
    .where(eq(staffOtpChallenges.id, challengeId))
    .limit(1);
  if (!challenge || challenge.consumedAt) {
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    return c.json({ error: "Too many attempts. Request a new code." }, 401);
  }
  const got = await sha256Hex(code);
  if (!timingSafeEqualHex(challenge.codeHash, got)) {
    await db
      .update(staffOtpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(staffOtpChallenges.id, challengeId));
    return c.json({ error: "Invalid or expired code." }, 401);
  }
  if (!(await isApprovedOperator(db, challenge.email))) {
    return c.json({ error: "This email is not nominated by ceo@cyvoriq.com." }, 403);
  }
  await db
    .update(staffOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(staffOtpChallenges.id, challengeId));
  const token = generateSessionToken();
  await db.insert(staffSessions).values({
    email: challenge.email,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + STAFF_TTL_MS),
  });
  setCookie(c, STAFF_COOKIE, token, staffCookieOptions(c));
  return c.json({
    operator: { email: challenge.email, superAdmin: challenge.email === SUPER_ADMIN_EMAIL },
    token,
  });
});

adminRoutes.post("/auth/logout", async (c) => {
  const token = readStaffToken(c);
  if (token) {
    const db = c.get("db");
    await db
      .delete(staffSessions)
      .where(eq(staffSessions.tokenHash, await sha256Hex(token)));
  }
  deleteCookie(c, STAFF_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

adminRoutes.get("/me", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  return c.json({
    email: admin.email,
    superAdmin: admin.email === SUPER_ADMIN_EMAIL,
    superAdminEmail: SUPER_ADMIN_EMAIL,
  });
});

adminRoutes.get("/staff", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const db = c.get("db");
  const rows = await db
    .select()
    .from(staffOperators)
    .orderBy(desc(staffOperators.nominatedAt));
  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    operators: rows.map((row) => ({
      staffId: row.id,
      email: row.email,
      status: row.status,
      nominatedBy: row.nominatedBy,
      nominatedAt: iso(row.nominatedAt),
      revokedAt: iso(row.revokedAt),
    })),
  });
});

adminRoutes.post("/staff", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  if (admin.email !== SUPER_ADMIN_EMAIL) {
    return c.json({ error: "Only ceo@cyvoriq.com can nominate operators." }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = normalizeEmail(body.email ?? "");
  if (!isCyvoriqEmail(email) || email === SUPER_ADMIN_EMAIL) {
    return c.json({ error: "Nominate a @cyvoriq.com address other than the super admin." }, 400);
  }
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.email, email))
    .limit(1);
  if (existing && existing.status === "APPROVED") {
    return c.json({
      operator: {
        staffId: existing.id,
        email: existing.email,
        status: existing.status,
        nominatedBy: existing.nominatedBy,
        nominatedAt: iso(existing.nominatedAt),
      },
      replayed: true,
    });
  }
  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(staffOperators)
      .set({
        status: "APPROVED",
        nominatedBy: admin.email,
        nominatedAt: now,
        revokedAt: null,
      })
      .where(eq(staffOperators.id, existing.id))
      .returning();
    return c.json({
      operator: {
        staffId: updated.id,
        email: updated.email,
        status: updated.status,
        nominatedBy: updated.nominatedBy,
        nominatedAt: iso(updated.nominatedAt),
      },
      replayed: false,
    });
  }
  const id = crypto.randomUUID();
  await db.insert(staffOperators).values({
    id,
    email,
    status: "APPROVED",
    nominatedBy: admin.email,
    nominatedAt: now,
  });
  return c.json({
    operator: {
      staffId: id,
      email,
      status: "APPROVED",
      nominatedBy: admin.email,
      nominatedAt: iso(now),
    },
    replayed: false,
  }, 201);
});

adminRoutes.post("/staff/:staffId/revoke", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  if (admin.email !== SUPER_ADMIN_EMAIL) {
    return c.json({ error: "Only ceo@cyvoriq.com can revoke operators." }, 403);
  }
  const staffId = c.req.param("staffId");
  if (!isUuid(staffId)) return c.json({ error: "staffId must be a UUID." }, 400);
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(staffOperators)
    .where(eq(staffOperators.id, staffId))
    .limit(1);
  if (!existing) return c.json({ error: "Operator not found." }, 404);
  const [updated] = await db
    .update(staffOperators)
    .set({ status: "REVOKED", revokedAt: new Date() })
    .where(eq(staffOperators.id, staffId))
    .returning();
  return c.json({
    operator: {
      staffId: updated.id,
      email: updated.email,
      status: updated.status,
      revokedAt: iso(updated.revokedAt),
    },
  });
});

adminRoutes.get("/serials", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const db = c.get("db");
  const rows = await db
    .select()
    .from(mobileSerials)
    .orderBy(desc(mobileSerials.createdAt));
  return c.json({
    superAdmin: SUPER_ADMIN_EMAIL,
    actor: admin.email,
    serials: rows.map(jsonSerial),
  });
});

adminRoutes.post("/serials", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const customerEmail = normalizeEmail(String(body.customerEmail ?? ""));
  const paymentNoted = String(body.paymentNoted ?? "").trim();
  const customerKind = String(body.customerKind ?? "SINGLE").toUpperCase();
  const deviceMax = Number(body.deviceMax ?? body.slabMax ?? 3);
  const brandScope = String(body.brandScope ?? "").trim().toUpperCase();
  if (!customerEmail || !customerEmail.includes("@")) {
    return c.json({ error: "customerEmail is required." }, 400);
  }
  if (paymentNoted.length < 4) {
    return c.json(
      {
        error:
          "paymentNoted is required. This is a human note that payment transferred, not a gateway proof.",
      },
      400,
    );
  }
  if (customerKind !== "SINGLE" && customerKind !== "BULK") {
    return c.json({ error: "customerKind must be SINGLE or BULK." }, 400);
  }
  const kind: LicenceKind = customerKind === "BULK" ? "BULK" : "SINGLE";
  if (!isLicenceSlab(deviceMax)) {
    return c.json({ error: "deviceMax slab must be 3, 5, 7 or 25 (1-3 / 1-5 / 1-7 / 1-25)." }, 400);
  }
  if (brandScope.length < 2) {
    return c.json({ error: "brandScope is required (same key, same brand, up to the slab)." }, 400);
  }

  const createdAt = new Date();
  const db = c.get("db");
  let publicNumber: string;
  try {
    publicNumber = await uniqueLicenceKey(db, kind, deviceMax, createdAt);
  } catch {
    return c.json({ error: "Could not allocate a unique licence key." }, 500);
  }
  const id = crypto.randomUUID();
  const row = {
    id,
    publicNumber,
    status: "PENDING" as SerialStatus,
    customerEmail,
    userId: null,
    paymentNoted,
    issuedBy: admin.email,
    issuedAt: null,
    revokedAt: null,
    createdAt,
    customerKind: kind,
    deviceMax,
    brandScope,
    customerFullName: String(body.customerFullName ?? "").trim() || null,
    companyName: String(body.companyName ?? "").trim() || null,
    addressLine1: String(body.addressLine1 ?? "").trim() || null,
    addressLine2: String(body.addressLine2 ?? "").trim() || null,
    pincode: String(body.pincode ?? "").trim() || null,
    state: String(body.state ?? "").trim() || null,
    devicesBound: 0,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
  };
  await db.insert(mobileSerials).values(row);
  return c.json({ serial: jsonSerial(row) }, 201);
});

adminRoutes.post("/serials/:serialId/issue", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.id, serialId))
    .limit(1);
  if (!existing) return c.json({ error: "Serial not found." }, 404);
  if (existing.status === "REVOKED") {
    return c.json({ error: "Revoked serials cannot be issued." }, 409);
  }
  if (existing.status === "ISSUED" && existing.issuedAt) {
    return c.json({
      serial: jsonSerial(existing),
      replayed: true,
    });
  }
  const parsed = parseLicenceKey(existing.publicNumber);
  const mail = await sendLicenceEmail(c.env, {
    email: existing.customerEmail,
    licenceKey: existing.publicNumber,
    slabLabel: parsed?.slabLabel ?? `1-${existing.deviceMax}`,
    kind: existing.customerKind,
    brandScope: existing.brandScope,
    serialId: existing.id,
  });
  if (!mail.sent && c.env.API_ENV === "production") {
    await db
      .update(mobileSerials)
      .set({ emailError: mail.error ?? "email failed" })
      .where(eq(mobileSerials.id, serialId));
    return c.json({ error: "Could not email the licence key. Not issued." }, 502);
  }
  const issuedAt = new Date();
  const [updated] = await db
    .update(mobileSerials)
    .set({
      status: "ISSUED",
      issuedBy: admin.email,
      issuedAt,
      emailedAt: mail.sent ? issuedAt : null,
      emailMessageId: mail.id ?? null,
      emailError: mail.sent ? null : mail.error ?? "preview-no-email",
    })
    .where(eq(mobileSerials.id, serialId))
    .returning();
  return c.json({ serial: jsonSerial(updated), replayed: false, emailed: mail.sent });
});

adminRoutes.post("/serials/:serialId/revoke", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const serialId = c.req.param("serialId");
  if (!isUuid(serialId)) {
    return c.json({ error: "serialId must be a UUID." }, 400);
  }
  const db = c.get("db");
  const [existing] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.id, serialId))
    .limit(1);
  if (!existing) return c.json({ error: "Serial not found." }, 404);
  if (existing.status === "REVOKED" && existing.revokedAt) {
    return c.json({ serial: jsonSerial(existing), replayed: true });
  }
  const revokedAt = new Date();
  const [updated] = await db
    .update(mobileSerials)
    .set({
      status: "REVOKED",
      revokedAt,
    })
    .where(eq(mobileSerials.id, serialId))
    .returning();
  return c.json({ serial: jsonSerial(updated), replayed: false });
});

adminRoutes.get("/reports/licences", async (c) => {
  const admin = await requireAdmin(c);
  if ("error" in admin) return c.json({ error: admin.error }, admin.status);
  const fromRaw = (c.req.query("from") ?? "").trim();
  const toRaw = (c.req.query("to") ?? "").trim();
  const from = parseReportDate(fromRaw, false);
  const to = parseReportDate(toRaw, true);
  if (!from || !to) {
    return c.json({ error: "from and to must be ISO dates." }, 400);
  }
  const db = c.get("db");
  const rows = await db
    .select()
    .from(mobileSerials)
    .where(and(gte(mobileSerials.createdAt, from), lte(mobileSerials.createdAt, to)))
    .orderBy(desc(mobileSerials.createdAt));
  const mapped = reportRows(rows);
  if ((c.req.query("format") ?? "") === "csv") {
    return c.body(toCsv(mapped), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cyvra-mobile-licences.csv"`,
    });
  }
  return c.json({
    actor: admin.email,
    from: from.toISOString(),
    to: to.toISOString(),
    count: mapped.length,
    rows: mapped,
  });
});
