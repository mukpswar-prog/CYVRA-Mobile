import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL_DIRECT ??
  process.env.DATABASE_URL ??
  "postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile";

async function main() {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = drizzle(pool);
  const migrationsFolder = resolve(__dirname, "../migrations");
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("[migrate] done");
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
