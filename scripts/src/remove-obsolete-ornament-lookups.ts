/**
 * Removes only retired, scraped ornament lookup data.
 *
 * This is intentionally separate from the additive startup migration. It is
 * idempotent, verifies the household collection boundary before and after the
 * drop, and requires an explicit acknowledgement that a backup was completed.
 *
 * Run a backup first:
 *   pnpm --filter @workspace/scripts run backup-to-replit
 *
 * Dry-run (default, no writes):
 *   pnpm --filter @workspace/scripts run remove-obsolete-ornament-lookups
 *
 * Apply to development:
 *   pnpm --filter @workspace/scripts run remove-obsolete-ornament-lookups -- --confirm --backup-confirmed
 *
 * Apply to production:
 *   pnpm --filter @workspace/scripts run remove-obsolete-ornament-lookups -- --production --confirm --backup-confirmed
 */
import pg from "pg";
import {
  resolveDatabaseUrl,
  resolveProductionDatabaseUrl,
  sslConfig,
} from "@workspace/db";

const { Pool } = pg;

const RETIRED_TABLES = [
  "ornament_upc_corrections",
  "ornaments_barcode_cache",
  "hallmark_ornaments",
  "hallmark_hooh_catalog",
  "hallmark_historical_catalog",
  "hallmark_catalog",
] as const;

const PRESERVED_TABLES = [
  "ornaments_items",
  "ornaments_images",
  "ornaments_categories",
  "ornaments_item_categories",
  "ornaments_hallmark_events",
] as const;

type TableCounts = Record<string, number | null>;

async function getCounts(pool: pg.Pool, tables: readonly string[]) {
  const counts: TableCounts = {};
  for (const table of tables) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`,
    );
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

async function getExistingTables(pool: pg.Pool) {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])`,
    [RETIRED_TABLES],
  );
  return rows.map((row) => row.tablename).sort();
}

function sameCounts(before: TableCounts, after: TableCounts) {
  return PRESERVED_TABLES.every((table) => before[table] === after[table]);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const production = args.has("--production");
  const confirmed = args.has("--confirm") && args.has("--backup-confirmed");
  const target = production ? "production" : "development";
  const pool = new Pool({
    connectionString: production
      ? resolveProductionDatabaseUrl()
      : resolveDatabaseUrl(),
    ssl: sslConfig,
  });
  pool.on("error", (err) => {
    console.error(
      "[remove-obsolete-ornament-lookups] pool error on idle client:",
      err,
    );
  });

  try {
    const existing = await getExistingTables(pool);
    const preservedBefore = await getCounts(pool, PRESERVED_TABLES);

    console.log(
      `[remove-obsolete-ornament-lookups] ${target} preserved rows: ${JSON.stringify(preservedBefore)}`,
    );
    console.log(
      `[remove-obsolete-ornament-lookups] ${target} retired tables present: ${existing.join(", ") || "(none)"}`,
    );

    if (!confirmed) {
      console.log(
        "[remove-obsolete-ornament-lookups] dry run only. First run backup-to-replit, then re-run with --confirm --backup-confirmed to drop only the listed retired lookup tables.",
      );
      return;
    }

    await pool.query("BEGIN");
    try {
      for (const table of RETIRED_TABLES) {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      const preservedAfter = await getCounts(pool, PRESERVED_TABLES);
      if (!sameCounts(preservedBefore, preservedAfter)) {
        throw new Error(
          `Preserved ornament data changed during cleanup: before=${JSON.stringify(preservedBefore)} after=${JSON.stringify(preservedAfter)}`,
        );
      }
      await pool.query("COMMIT");
      console.log(
        `[remove-obsolete-ornament-lookups] ${target} cleanup complete; preserved rows verified: ${JSON.stringify(preservedAfter)}`,
      );
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[remove-obsolete-ornament-lookups] failed:", error);
  process.exit(1);
});
