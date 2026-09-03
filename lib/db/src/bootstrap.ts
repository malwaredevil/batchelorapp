/**
 * Idempotent schema bootstrap CLI for the merged Batchelor monorepo (pottery +
 * quilting). Safe, additive-only alternative to the banned force-push command,
 * followed by explicitly reviewed destructive migrations.
 *
 * The actual DDL lives in `./schema-statements` (the single source of truth,
 * also consumed by the api-server startup self-healing migration). This file is
 * just the CLI entrypoint: connect, run every statement in order, disconnect.
 *
 * Run via `pnpm --filter @workspace/db run bootstrap` and from post-merge.sh.
 */
import pg from "pg";
import { DESTRUCTIVE_MIGRATIONS } from "./destructive-migrations";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";
import { STATEMENTS } from "./schema-statements";

const { Pool } = pg;

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });
  // See lib/db/src/index.ts for why this listener is required: an
  // unhandled Pool 'error' event becomes an uncaught exception.
  pool.on("error", (err) => {
    console.error("[bootstrap] pool error on idle client (non-fatal):", err);
  });
  try {
    for (const statement of STATEMENTS) {
      const preview = statement.replace(/\s+/g, " ").slice(0, 80);
      console.log(`[bootstrap] ${preview}...`);
      await pool.query(statement);
    }
    for (const migration of DESTRUCTIVE_MIGRATIONS) {
      console.log(`[bootstrap] destructive migration: ${migration.name}...`);
      await pool.query(migration.sql);
    }
    console.log(
      "[bootstrap] done — schema ensured and reviewed migrations applied",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
