/**
 * Idempotent schema bootstrap CLI for the merged Batchelor monorepo (pottery +
 * quilting). SAFE replacement for `drizzle-kit push --force`.
 *
 * The actual DDL lives in `./schema-statements` (the single source of truth,
 * also consumed by the api-server startup self-healing migration). This file is
 * just the CLI entrypoint: connect, run every statement in order, disconnect.
 *
 * Run via `pnpm --filter @workspace/db run bootstrap` and from post-merge.sh.
 */
import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "./resolve-url";
import { STATEMENTS } from "./schema-statements";

const { Pool } = pg;

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });
  try {
    for (const statement of STATEMENTS) {
      const preview = statement.replace(/\s+/g, " ").slice(0, 80);
      console.log(`[bootstrap] ${preview}...`);
      await pool.query(statement);
    }
    console.log(
      "[bootstrap] done — pottery + quilting schema ensured (no data touched)",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
