/**
 * One-shot script: apply the shared idempotent schema DDL directly to the
 * PRODUCTION Supabase database (the same STATEMENTS the api-server's
 * startup-migrate runs on every boot).
 *
 * Why this exists: the editor's dev workflow connects to DEV_DATABASE_URL
 * (see lib/db/src/resolve-url.ts), not production. Production's schema only
 * advances automatically when the *deployed* app boots against DATABASE_URL.
 * That means between merging a schema change and actually publishing, the
 * production database can lag the code — which breaks pre-publish steps that
 * read/write the new columns directly against production (e.g.
 * backup-to-replit.ts). Running this script closes that gap on demand,
 * without doing a full deploy.
 *
 * Every statement in STATEMENTS is additive and idempotent (CREATE TABLE/
 * INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, ENABLE ROW LEVEL SECURITY).
 * It NEVER issues DROP, TRUNCATE, or any destructive DDL, and never touches
 * existing rows — safe to run at any time, including right before a backup.
 *
 * Run via `pnpm --filter @workspace/scripts run migrate-production`.
 */
import pg from "pg";
import {
  resolveProductionDatabaseUrl,
  sslConfig,
  STATEMENTS,
} from "@workspace/db";

const { Pool } = pg;

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: resolveProductionDatabaseUrl(),
    ssl: sslConfig,
  });
  pool.on("error", (err) => {
    console.error(
      "[migrate-production] pool error on idle client (non-fatal):",
      err,
    );
  });
  try {
    for (const statement of STATEMENTS) {
      const preview = statement.replace(/\s+/g, " ").slice(0, 80);
      console.log(`[migrate-production] ${preview}...`);
      await pool.query(statement);
    }
    console.log(
      "[migrate-production] done — production schema brought up to date (no data touched)",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate-production] failed:", err);
  process.exit(1);
});
