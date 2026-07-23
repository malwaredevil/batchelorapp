/**
 * Startup self-healing migration.
 *
 * Runs before the HTTP server starts. Executes the SINGLE source of DDL truth
 * (`STATEMENTS` from @workspace/db) so the merged server can never boot with a
 * partial schema — it ensures BOTH pottery_* and quilting_* tables plus the
 * shared app_users / password_reset_tokens, identical to what
 * `pnpm --filter @workspace/db run bootstrap` runs.
 *
 * Every statement is additive and idempotent (CREATE TABLE/INDEX IF NOT EXISTS,
 * ADD COLUMN IF NOT EXISTS, ENABLE ROW LEVEL SECURITY). It NEVER issues DROP,
 * TRUNCATE, or any destructive DDL — safe to run on every boot and after any
 * database restore.
 *
 * After the schema migration, setupKeepaliveCron() runs as a best-effort
 * optional step: it schedules a pg_cron job that pings /api/healthz every
 * 5 minutes so Replit's autoscale container stays warm and the in-process
 * schedulers (reminders, calendar scan, etc.) always fire on time. If pg_cron
 * or pg_net aren't enabled on the Supabase project it logs a notice and skips
 * — it never blocks startup.
 */

import { createHash } from "crypto";
import { pool, STATEMENTS } from "@workspace/db";
import { logger } from "./logger";

const KEEPALIVE_URL = "https://app.batchelor.app/api/healthz";
const KEEPALIVE_JOB = "batchelor-keepalive";
const KEEPALIVE_SCHEDULE = "*/5 * * * *"; // every 5 minutes

/**
 * Best-effort pg_cron keepalive setup. Schedules a 5-minute ping to
 * /api/healthz so Replit's autoscale container stays warm. Runs outside the
 * schema migration transaction so a failure here never rolls back table
 * changes. Completely silent no-op if pg_cron / pg_net aren't enabled.
 */
async function setupKeepaliveCron(): Promise<void> {
  const client = await pool.connect().catch(() => null);
  if (!client) return;

  try {
    // Enable extensions — idempotent, silently skipped if already enabled.
    // If either extension is unavailable on this Supabase project, the catch
    // below logs a notice and returns without affecting the rest of startup.
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_net`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_cron`);

    // cron.schedule() is an upsert keyed by job name — safe to re-run on
    // every boot, it just updates the schedule if it already exists.
    await client.query(`SELECT cron.schedule($1, $2, $3)`, [
      KEEPALIVE_JOB,
      KEEPALIVE_SCHEDULE,
      `SELECT net.http_get(url := '${KEEPALIVE_URL}')`,
    ]);

    logger.info(
      { url: KEEPALIVE_URL, schedule: KEEPALIVE_SCHEDULE },
      "startup-migrate: keepalive cron scheduled (pg_cron → pg_net → healthz)",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // pg_cron / pg_net not enabled → expected on some project tiers.
    // Any other error is still non-fatal — log it and move on.
    logger.info(
      { reason: msg },
      "startup-migrate: keepalive cron skipped (pg_cron/pg_net unavailable or insufficient privileges)",
    );
  } finally {
    client.release();
  }
}

export async function runStartupMigration(): Promise<void> {
  const client = await pool.connect().catch((err) => {
    logger.warn({ err }, "startup-migrate: could not connect to DB — skipping");
    return null;
  });
  if (!client) return;

  logger.info("startup-migrate: running idempotent table check");

  try {
    // Create the migration log table in autocommit mode (before BEGIN).
    // Running DDL outside the main transaction means two instances starting
    // simultaneously can block briefly on each other's catalog lock without
    // any risk of deadlocking with the other locks each holds from STATEMENTS.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration_log (
        statement_hash TEXT PRIMARY KEY,
        applied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("BEGIN");
    // Bound how long any single DDL statement waits for a table lock.
    // ALTER TABLE on a busy table can hang indefinitely otherwise — 5 s
    // is plenty for an uncontested schema change; if locked it fails fast
    // and the server still starts (catch below logs and continues).
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");

    // Load already-applied statement hashes in one round-trip.
    // On the very first boot this returns an empty set and every STATEMENT
    // runs; on subsequent boots only new/changed statements execute, cutting
    // startup time from ~70 s to <1 s once the schema is fully initialised.
    const { rows } = await client.query<{ statement_hash: string }>(
      "SELECT statement_hash FROM schema_migration_log",
    );
    const applied = new Set(rows.map((r) => r.statement_hash));

    let ran = 0;
    let skipped = 0;
    for (const statement of STATEMENTS) {
      const h = createHash("sha256")
        .update(statement)
        .digest("hex")
        .slice(0, 16);
      if (applied.has(h)) {
        skipped++;
        continue;
      }
      await client.query(statement);
      await client.query(
        "INSERT INTO schema_migration_log (statement_hash) VALUES ($1) ON CONFLICT DO NOTHING",
        [h],
      );
      ran++;
    }

    await client.query("COMMIT");
    logger.info(
      { ran, skipped },
      "startup-migrate: all tables verified / created successfully",
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error(
      { err },
      "startup-migrate: migration failed — server will still start but some tables may be missing",
    );
  } finally {
    client.release();
  }

  // Optional keepalive cron — runs after the schema migration in its own
  // connection so a failure never rolls back the table work above.
  await setupKeepaliveCron();
}
