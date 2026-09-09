import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { sessions, users } from "@cyvra/database/schema";
import { sha256Hex } from "./crypto";
import type { Database } from "./db";
import type { Env } from "./env";
import { readSessionToken } from "./session";

export type AppContext = Context<{
  Bindings: Env;
  Variables: { db: Database };
}>;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  state: string | null;
  lastLoginAt: Date | null;
};

export async function lookupSessionUser(
  db: Database,
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      companyName: users.companyName,
      addressLine1: users.addressLine1,
      addressLine2: users.addressLine2,
      pincode: users.pincode,
      state: users.state,
      lastLoginAt: users.lastLoginAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);
  return row ?? null;
}

export async function requireUser(c: AppContext): Promise<SessionUser | null> {
  const token = readSessionToken(c);
  if (!token) return null;
  return lookupSessionUser(c.get("db"), token);
}
