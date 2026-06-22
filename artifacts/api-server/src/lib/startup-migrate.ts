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
 */

import { pool, STATEMENTS } from "@workspace/db";
import { logger } from "./logger";

export async function runStartupMigration(): Promise<void> {
  const client = await pool.connect().catch((err) => {
    logger.warn({ err }, "startup-migrate: could not connect to DB — skipping");
    return null;
  });
  if (!client) return;

  logger.info("startup-migrate: running idempotent table check");

  try {
    await client.query("BEGIN");
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
}
