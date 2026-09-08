import { defineConfig } from "drizzle-kit";

/**
 * Drizzle uses the DIRECT Neon connection for migrations (never the pooled /
 * Hyperdrive URL). Locally this points at the workspace Postgres cluster that
 * stands in for Neon project floral-art-02749206.
 */
const url =
  process.env.DATABASE_URL_DIRECT ??
  process.env.DATABASE_URL ??
  "postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
