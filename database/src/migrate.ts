import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load gitignored `database/.env` without overwriting variables already set. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function hostPort(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}`;
  } catch {
    return "the configured database";
  }
}

function isRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current === "object") {
      const rec = current as {
        code?: string;
        message?: string;
        stack?: string;
        cause?: unknown;
      };
      if (rec.code === "ECONNREFUSED") return true;
      if (/ECONNREFUSED/.test(`${rec.message ?? ""}\n${rec.stack ?? ""}`)) {
        return true;
      }
      current = rec.cause;
      continue;
    }
    if (/ECONNREFUSED/.test(String(current))) return true;
    break;
  }
  return false;
}

loadDotEnv(resolve(__dirname, "../.env"));

const connectionString =
  process.env.DATABASE_URL_DIRECT ??
  process.env.DATABASE_URL ??
  "postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile";

async function main() {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  const db = drizzle(pool);
  const migrationsFolder = resolve(__dirname, "../migrations");
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  console.log(`[migrate] target ${hostPort(connectionString)}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("[migrate] done");
}

main().catch((error) => {
  if (isRefused(error)) {
    const target = hostPort(connectionString);
    console.error(
      `[migrate] cannot connect to Postgres at ${target} (connection refused).`,
    );
    console.error(
      "Codespaces does not start local Postgres. For the local ingest test run:",
    );
    console.error("  bash scripts/run-local-evidence.sh");
    console.error(
      "That installs/starts the local cluster, migrates, starts wrangler if needed, then tests.",
    );
    console.error(
      "For live Neon, put DATABASE_URL_DIRECT in gitignored database/.env (direct host, no -pooler) and never commit it.",
    );
    process.exit(1);
  }
  console.error("[migrate] failed:", error);
  process.exit(1);
});
