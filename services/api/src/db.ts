import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@cyvra/database/schema";
import pg from "pg";

export type Database = NodePgDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  client: pg.Client;
}

/**
 * Open a per-request Postgres connection. In production `connectionString`
 * comes from the Hyperdrive binding (Neon pooled URL); locally it is the
 * Hyperdrive `localConnectionString`. Callers must close the client, ideally
 * via `ctx.waitUntil(client.end())` so the response isn't blocked.
 */
export async function connect(connectionString: string): Promise<DbConnection> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return { db: drizzle(client, { schema }), client };
}
