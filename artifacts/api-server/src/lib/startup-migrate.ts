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
    await client.query("BEGIN");
    // Bound how long any single DDL statement waits for a table lock.
    // ALTER TABLE on a busy table can hang indefinitely otherwise — 5 s
    // is plenty for an uncontested schema change; if locked it fails fast
    // and the server still starts (catch below logs and continues).
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    for (const statement of STATEMENTS) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    logger.info("startup-migrate: all tables verified / created successfully");
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
