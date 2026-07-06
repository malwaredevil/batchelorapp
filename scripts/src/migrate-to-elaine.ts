/**
 * migrate-to-elaine.ts
 *
 * One-time migration: copies data from the old travels-only assistant tables
 * (travels_assistant_conversations, travels_assistant_settings,
 * travels_household_memory, travels_assistant_nudges) into the new shared
 * Elaine tables (elaine_conversations, elaine_settings, elaine_memory,
 * elaine_nudges), then — only with --drop-old passed explicitly — drops the
 * old tables.
 *
 * Safe to re-run for the copy step (uses ON CONFLICT DO NOTHING / idempotent
 * upserts). The DROP step is gated behind an explicit flag and should only be
 * run after:
 *   1. This script has been run once without --drop-old and the row counts
 *      have been manually verified to match.
 *   2. A fresh Supabase -> Replit backup has been taken
 *      (`pnpm --filter @workspace/scripts run backup-to-replit`).
 *
 * USAGE:
 *   pnpm --filter @workspace/scripts run migrate-to-elaine
 *   pnpm --filter @workspace/scripts run migrate-to-elaine -- --drop-old
 */

import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const { Client } = pg;

async function main() {
  const dropOld = process.argv.includes("--drop-old");

  const client = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    // --- elaine_conversations <- travels_assistant_conversations ---
    const convRes = await client.query(
      `SELECT user_id, messages, updated_at FROM travels_assistant_conversations`,
    );
    for (const row of convRes.rows) {
      await client.query(
        `INSERT INTO elaine_conversations (user_id, messages, updated_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           messages = EXCLUDED.messages,
           updated_at = EXCLUDED.updated_at
         WHERE elaine_conversations.updated_at < EXCLUDED.updated_at`,
        [row.user_id, JSON.stringify(row.messages), row.updated_at],
      );
    }
    console.log(
      `[migrate-to-elaine] copied ${convRes.rows.length} row(s) into elaine_conversations`,
    );

    // --- elaine_settings <- travels_assistant_settings ---
    const settingsRes = await client.query(
      `SELECT user_id, enabled, action_confirmation_mode, updated_at FROM travels_assistant_settings`,
    );
    for (const row of settingsRes.rows) {
      await client.query(
        `INSERT INTO elaine_settings (user_id, enabled, action_confirmation_mode, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           action_confirmation_mode = EXCLUDED.action_confirmation_mode,
           updated_at = EXCLUDED.updated_at`,
        [
          row.user_id,
          row.enabled,
          row.action_confirmation_mode,
          row.updated_at,
        ],
      );
    }
    console.log(
      `[migrate-to-elaine] copied ${settingsRes.rows.length} row(s) into elaine_settings`,
    );

    // --- elaine_memory <- travels_household_memory ---
    const memoryRes = await client.query(
      `SELECT content, created_by_user_id, created_at FROM travels_household_memory ORDER BY id`,
    );
    let memoryCopied = 0;
    for (const row of memoryRes.rows) {
      const exists = await client.query(
        `SELECT 1 FROM elaine_memory WHERE content = $1 AND created_by_user_id = $2 AND created_at = $3`,
        [row.content, row.created_by_user_id, row.created_at],
      );
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO elaine_memory (content, created_by_user_id, created_at) VALUES ($1, $2, $3)`,
          [row.content, row.created_by_user_id, row.created_at],
        );
        memoryCopied++;
      }
    }
    console.log(
      `[migrate-to-elaine] copied ${memoryCopied}/${memoryRes.rows.length} row(s) into elaine_memory`,
    );

    // --- elaine_nudges <- travels_assistant_nudges (tripId -> sourceApp/sourceId) ---
    const nudgesRes = await client.query(
      `SELECT user_id, trip_id, nudge_key, message, created_at, seen_at FROM travels_assistant_nudges`,
    );
    for (const row of nudgesRes.rows) {
      const sourceApp = row.trip_id !== null ? "travels" : null;
      await client.query(
        `INSERT INTO elaine_nudges (user_id, source_app, source_id, nudge_key, message, created_at, seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, nudge_key) DO NOTHING`,
        [
          row.user_id,
          sourceApp,
          row.trip_id,
          row.nudge_key,
          row.message,
          row.created_at,
          row.seen_at,
        ],
      );
    }
    console.log(
      `[migrate-to-elaine] copied ${nudgesRes.rows.length} row(s) into elaine_nudges`,
    );

    await client.query("COMMIT");

    // Verification counts
    const counts = await client.query(`
      SELECT
        (SELECT count(*) FROM travels_assistant_conversations) AS old_conversations,
        (SELECT count(*) FROM elaine_conversations) AS new_conversations,
        (SELECT count(*) FROM travels_assistant_settings) AS old_settings,
        (SELECT count(*) FROM elaine_settings) AS new_settings,
        (SELECT count(*) FROM travels_household_memory) AS old_memory,
        (SELECT count(*) FROM elaine_memory) AS new_memory,
        (SELECT count(*) FROM travels_assistant_nudges) AS old_nudges,
        (SELECT count(*) FROM elaine_nudges) AS new_nudges
    `);
    console.table(counts.rows[0]);

    if (dropOld) {
      const c = counts.rows[0];
      if (
        Number(c.new_conversations) < Number(c.old_conversations) ||
        Number(c.new_settings) < Number(c.old_settings) ||
        Number(c.new_memory) < Number(c.old_memory) ||
        Number(c.new_nudges) < Number(c.old_nudges)
      ) {
        throw new Error(
          "Refusing to drop old tables: new table row counts are lower than old table row counts. Investigate before retrying with --drop-old.",
        );
      }
      console.log(
        "[migrate-to-elaine] row counts verified — dropping old travels_assistant_* tables",
      );
      await client.query("BEGIN");
      await client.query(`DROP TABLE IF EXISTS travels_assistant_nudges`);
      await client.query(`DROP TABLE IF EXISTS travels_household_memory`);
      await client.query(`DROP TABLE IF EXISTS travels_assistant_settings`);
      await client.query(
        `DROP TABLE IF EXISTS travels_assistant_conversations`,
      );
      await client.query("COMMIT");
      console.log("[migrate-to-elaine] old tables dropped");
    } else {
      console.log(
        "[migrate-to-elaine] copy complete. Re-run with --drop-old (after backup) to remove the old tables.",
      );
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate-to-elaine] failed:", err);
  process.exit(1);
});
