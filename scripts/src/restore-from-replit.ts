/**
 * restore-from-replit.ts
 *
 * Restores all pottery + quilting data from the Replit built-in PostgreSQL
 * backup database back into Supabase. Use this only when Supabase data has
 * been accidentally wiped or corrupted by a bad migration.
 *
 * USAGE:
 *   pnpm --filter @workspace/scripts run restore-from-replit -- --confirm
 *
 * The --confirm flag is a required deliberate safety gate.
 *
 * AFTER RESTORING:
 *   - AI embeddings are NOT restored (require pgvector; regenerate via each
 *     app's Settings > Maintenance > Bulk Re-analyse).
 *   - Image files are stored in Supabase Storage (not in the DB) and are
 *     unaffected by database disasters.
 *
 * Source:      Replit DB — PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 * Destination: Supabase  — DATABASE_URL (rewritten to pooler by resolveDatabaseUrl)
 */

import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const { Client } = pg;

async function copyTable(
  source: pg.Client,
  dest: pg.Client,
  opts: { table: string; columns: string[]; orderBy?: string },
): Promise<number> {
  const cols = opts.columns.join(", ");
  const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
  const { rows } = await source.query(
    `SELECT ${cols} FROM ${opts.table}${order}`,
  );
  const placeholders = opts.columns.map((_, i) => `$${i + 1}`).join(", ");
  for (const row of rows) {
    const values = opts.columns.map((c) => row[c] ?? null);
    await dest.query(
      `INSERT INTO ${opts.table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return rows.length;
}

async function resetSequence(dest: pg.Client, table: string, col: string) {
  await dest.query(`
    SELECT setval(
      pg_get_serial_sequence('${table}', '${col}'),
      COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1,
      false
    )
  `);
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "ERROR: --confirm flag required.\n\n" +
        "This script overwrites live Supabase data with the Replit DB backup.\n" +
        "Verify the backup is good first, then run:\n\n" +
        "  pnpm --filter @workspace/scripts run restore-from-replit -- --confirm\n",
    );
    process.exit(1);
  }

  const source = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: false,
  });
  const dest = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });

  console.log("Connecting to Replit DB (source) and Supabase (destination)...");
  await source.connect();
  await dest.connect();

  const { rows: histRows } = await source.query(
    "SELECT ran_at, note FROM backup_history ORDER BY ran_at DESC LIMIT 1",
  );
  if (histRows.length > 0) {
    console.log(`Last backup: ${histRows[0].ran_at}`);
    console.log(`Contents:   ${histRows[0].note}`);
  } else {
    console.error("No backup history found in Replit DB. Aborting.");
    process.exit(1);
  }

  console.log("\nRestoring to Supabase (TRUNCATE + INSERT per table)...");

  // Disable triggers so FK order doesn't matter
  await dest.query("SET session_replication_role = replica");

  // ── Shared ────────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE app_users CASCADE");
  await copyTable(source, dest, {
    table: "app_users",
    columns: ["id", "email", "password_hash", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "app_users", "id");

  // ── Pottery ───────────────────────────────────────────────────────────────
  await dest.query("TRUNCATE pottery_item_categories CASCADE");
  await dest.query("TRUNCATE pottery_images CASCADE");
  await dest.query("TRUNCATE pottery_items CASCADE");
  await dest.query("TRUNCATE pottery_categories CASCADE");

  await copyTable(source, dest, {
    table: "pottery_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_categories", "id");

  await copyTable(source, dest, {
    table: "pottery_items",
    columns: [
      "id",
      "name",
      "quantity",
      "notes",
      "dimensions",
      "pattern_description",
      "style",
      "shape",
      "maker",
      "maker_info",
      "dominant_colors",
      "motifs",
      "image_path",
      "pattern_crop_path",
      "acquired_at",
      "condition",
      "origin",
      "approximate_era",
      "ai_description",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_items", "id");

  await copyTable(source, dest, {
    table: "pottery_images",
    columns: [
      "id",
      "item_id",
      "storage_path",
      "label",
      "position",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_images", "id");

  await copyTable(source, dest, {
    table: "pottery_item_categories",
    columns: ["item_id", "category_id"],
  });

  // ── Quilting ──────────────────────────────────────────────────────────────
  await dest.query(
    "TRUNCATE quilting_entity_categories, quilting_fabric_links, quilting_pattern_links, quilting_images, quilting_blocks, quilting_layouts, quilting_shopping_items CASCADE",
  );
  await dest.query("TRUNCATE quilting_finished_quilts CASCADE");
  await dest.query("TRUNCATE quilting_fabrics CASCADE");
  await dest.query("TRUNCATE quilting_patterns CASCADE");
  await dest.query("TRUNCATE quilting_categories CASCADE");

  await copyTable(source, dest, {
    table: "quilting_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_categories", "id");

  await copyTable(source, dest, {
    table: "quilting_fabrics",
    columns: [
      "id",
      "name",
      "line_name",
      "designer",
      "manufacturer",
      "colorway",
      "print_type",
      "fiber_content",
      "width_inches",
      "quantity",
      "quantity_unit",
      "sku",
      "notes",
      "ai_description",
      "dominant_colors",
      "motifs",
      "style_descriptors",
      "image_path",
      "acquired_at",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_fabrics", "id");

  await copyTable(source, dest, {
    table: "quilting_patterns",
    columns: [
      "id",
      "name",
      "designer",
      "block_size",
      "difficulty",
      "source_type",
      "source_reference",
      "notes",
      "image_path",
      "acquired_at",
      "locked_fields",
      "designer_bio",
      "designer_website",
      "publication_name",
      "publication_year",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_patterns", "id");

  await copyTable(source, dest, {
    table: "quilting_finished_quilts",
    columns: [
      "id",
      "name",
      "date_completed",
      "size_width",
      "size_height",
      "recipient",
      "notes",
      "image_path",
      "locked_fields",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_finished_quilts", "id");

  await copyTable(source, dest, {
    table: "quilting_fabric_links",
    columns: ["quilt_id", "fabric_id", "notes"],
  });
  await copyTable(source, dest, {
    table: "quilting_pattern_links",
    columns: ["quilt_id", "pattern_id"],
  });
  await copyTable(source, dest, {
    table: "quilting_entity_categories",
    columns: ["entity_type", "entity_id", "category_id"],
  });

  await copyTable(source, dest, {
    table: "quilting_images",
    columns: [
      "id",
      "entity_type",
      "entity_id",
      "storage_path",
      "label",
      "position",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_images", "id");

  await copyTable(source, dest, {
    table: "quilting_blocks",
    columns: [
      "id",
      "name",
      "grid_size",
      "cells",
      "block_size_inches",
      "seam_allowance_inches",
      "seams",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_blocks", "id");

  await copyTable(source, dest, {
    table: "quilting_layouts",
    columns: [
      "id",
      "name",
      "rows",
      "cols",
      "cells",
      "sashing_width_inches",
      "sashing_color",
      "border_width_inches",
      "border_color",
      "cornerstone_color",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_layouts", "id");

  await copyTable(source, dest, {
    table: "quilting_shopping_items",
    columns: [
      "id",
      "name",
      "notes",
      "url",
      "quantity",
      "unit",
      "estimated_price_usd",
      "actual_price_usd",
      "store",
      "status",
      "priority",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_shopping_items", "id");

  await dest.query("SET session_replication_role = DEFAULT");

  console.log("\n✓ Restore complete.");
  console.log(
    "  Remember to run Bulk Re-analyse in each app to rebuild AI embeddings.",
  );

  await source.end();
  await dest.end();
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
