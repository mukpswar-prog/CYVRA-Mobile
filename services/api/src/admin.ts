import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { mobileSerials } from "@cyvra/database/schema";
import { isUuid } from "@cyvra/evidence";
import { sha256Hex, timingSafeEqualHex } from "./crypto";
import type { Database } from "./db";
import type { Env } from "./env";

export const SUPER_ADMIN_EMAIL = "ceo@cyvoriq.com";

const SERIAL_STATUSES = ["PENDING", "ISSUED", "REVOKED"] as const;
type SerialStatus = (typeof SERIAL_STATUSES)[number];

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function formatSerialNumber(id: string, at: Date): string {
  const year = at.getUTCFullYear();
  const unique = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `CYVRA-M-${year}-${unique}`;
}

function jsonSerial(row: typeof mobileSerials.$inferSelect) {
  return {
    serialId: row.id,
    publicNumber: row.publicNumber,
    status: row.status,
    customerEmail: row.customerEmail,
    userId: row.userId,
    paymentNoted: row.paymentNoted,
    issuedBy: row.issuedBy,
    issuedAt: iso(row.issuedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt),
  };
}

async function requireAdmin(
  c: {
    env: Env;
    req: { header: (name: string) => string | undefined };
  },
): Promise<{ email: string } | { error: string; status: 401 | 503 }> {
  const configured = (c.env.ADMIN_API_TOKEN ?? "").trim();
  if (!configured) {
    return { error: "ADMIN_API_TOKEN is not configured.", status: 503 };
  }
  const header = c.req.header("Authorization") ?? "";
  const token =
    header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7).trim() : "";
  if (!token) {
    return { error: "Admin token required.", status: 401 };
  }
  const expected = await sha256Hex(configured);
  const got = await sha256Hex(token);
  if (!timingSafeEqualHex(expected, got)) {
    return { error: "Admin token required.", status: 401 };
  }
  const email = (c.req.header("X-Admin-Email") ?? "").trim().toLowerCase();
  if (email !== SUPER_ADMIN_EMAIL) {
    return { error: `X-Admin-Email must be ${SUPER_ADMIN_EMAIL}.`, status: 401 };
  }
  return { email };
}

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

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
  const body = (await c.req.json().catch(() => ({}))) as {
    customerEmail?: string;
    paymentNoted?: string;
  };
  const customerEmail = (body.customerEmail ?? "").trim().toLowerCase();
  const paymentNoted = (body.paymentNoted ?? "").trim();
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

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const row = {
    id,
    publicNumber: formatSerialNumber(id, createdAt),
    status: "PENDING" as SerialStatus,
    customerEmail,
    userId: null,
    paymentNoted,
    issuedBy: admin.email,
    issuedAt: null,
    revokedAt: null,
    createdAt,
  };
  const db = c.get("db");
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
  const issuedAt = new Date();
  const [updated] = await db
    .update(mobileSerials)
    .set({
      status: "ISSUED",
      issuedBy: admin.email,
      issuedAt,
    })
    .where(eq(mobileSerials.id, serialId))
    .returning();
  return c.json({ serial: jsonSerial(updated), replayed: false });
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
