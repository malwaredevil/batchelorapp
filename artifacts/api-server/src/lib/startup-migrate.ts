/**
 * Startup migration health gate.
 *
 * Runs before the HTTP server starts. The repository-owned migration runner
 * applies the historical additive baseline plus numbered migrations under an
 * advisory lock and records checksums in app_schema_migrations. Startup fails
 * closed if migrations cannot be verified/applied.
 *
 * After the schema migration, setupKeepaliveCron() runs as a best-effort
 * optional step: it schedules a pg_cron job that pings /api/healthz every
 * 5 minutes so Replit's autoscale container stays warm and the in-process
 * schedulers (reminders, calendar scan, etc.) always fire on time. If pg_cron
 * or pg_net aren't enabled on the Supabase project it logs a notice and skips
 * — it never blocks startup.
 */

import { applyMigrations, pool, type MigrationStatus } from "@workspace/db";
import { logger } from "./logger";

const KEEPALIVE_URL = "https://app.batchelor.app/api/healthz";
const KEEPALIVE_JOB = "batchelor-keepalive";
const KEEPALIVE_SCHEDULE = "*/5 * * * *"; // every 5 minutes

let migrationStatus: MigrationStatus | null = null;

export function getStartupMigrationStatus(): MigrationStatus | null {
  return migrationStatus;
}

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
  logger.info("startup-migrate: applying ordered migration ledger");
  migrationStatus = await applyMigrations();
  if (
    migrationStatus.pending.length > 0 ||
    migrationStatus.checksumErrors.length > 0
  ) {
    throw new Error(
      `Migration health is not clean: pending=${migrationStatus.pending.length} checksumErrors=${migrationStatus.checksumErrors.length}`,
    );
  }
  logger.info(
    {
      latest: migrationStatus.appliedLatestVersion,
      expected: migrationStatus.expectedLatestVersion,
    },
    "startup-migrate: migration ledger clean",
  );

  // Optional keepalive cron — runs after the schema migration in its own
  // connection so a failure never rolls back the table work above.
  await setupKeepaliveCron();
}
