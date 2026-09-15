import { eq, desc } from "drizzle-orm";
import { Hono } from "hono";
import { mobileSerials } from "@cyvra/database/schema";
import type { Database } from "./db";
import type { Env } from "./env";
import { requireUser } from "./user";

export const licenseRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

licenseRoutes.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");

  // Fetch mobile serials linked to user ID or email
  const [activeSerial] = await db
    .select()
    .from(mobileSerials)
    .where(eq(mobileSerials.customerEmail, user.email))
    .orderBy(desc(mobileSerials.createdAt))
    .limit(1);

  if (!activeSerial) {
    // Return standard initial trial or single entitlement record
    return c.json({
      licenseId: `LIC-${user.id.slice(0, 8).toUpperCase()}`,
      serialNumber: "CYVRA-PREVIEW-TRIAL-1-3",
      customerEmail: user.email,
      customerName: user.fullName,
      companyName: user.companyName,
      planName: "3 Device Scans",
      deviceScanEntitlement: 3,
      scansUsed: 0,
      scansRemaining: 3,
      revision: 1,
      status: "ACTIVE",
      lastVerifiedAt: new Date().toISOString(),
    });
  }

  const scansRemaining = Math.max(0, activeSerial.deviceMax - activeSerial.devicesBound);

  return c.json({
    licenseId: `LIC-${activeSerial.id.slice(0, 8).toUpperCase()}`,
    serialNumber: activeSerial.publicNumber,
    customerEmail: activeSerial.customerEmail,
    customerName: activeSerial.customerFullName || user.fullName,
    companyName: activeSerial.companyName || user.companyName,
    planName: `${activeSerial.deviceMax} Device Scans`,
    deviceScanEntitlement: activeSerial.deviceMax,
    scansUsed: activeSerial.devicesBound,
    scansRemaining,
    revision: 1,
    status: activeSerial.status === "ISSUED" ? "ACTIVE" : activeSerial.status,
    lastVerifiedAt: new Date().toISOString(),
  });
});
