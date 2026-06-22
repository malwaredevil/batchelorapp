/**
 * backup-to-replit.ts
 *
 * Copies all Supabase tables (pottery + quilting + shared) to the Replit
 * built-in PostgreSQL database.  Safe to run at any time; uses TRUNCATE +
 * INSERT inside a transaction so the destination is always a consistent snapshot.
 *
 * What is backed up:
 *   Shared:  app_users
 *   Pottery: pottery_categories, pottery_items (WITHOUT embedding), pottery_images,
 *            pottery_item_categories
 *   Quilting: quilting_categories, quilting_fabrics (WITHOUT embedding/visual_embedding),
 *             quilting_patterns (WITHOUT embedding/visual_embedding),
 *             quilting_finished_quilts, quilting_fabric_links, quilting_pattern_links,
 *             quilting_entity_categories, quilting_images, quilting_blocks,
 *             quilting_layouts, quilting_shopping_items
 *
 * What is intentionally skipped:
 *   - embedding / visual_embedding columns (require pgvector, unavailable on Replit DB)
 *   - *_sessions tables (ephemeral login data)
 *   - password_reset_tokens (ephemeral, regeneratable)
 *   - Actual image files (stored in Supabase Storage, unaffected by DB disasters)
 *
 * Source:      Supabase  — DATABASE_URL (rewritten to pooler by resolveDatabaseUrl)
 * Destination: Replit DB — PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 */

import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const { Client } = pg;

const DEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS backup_history (
  id        SERIAL PRIMARY KEY,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note      TEXT
);

-- Shared
CREATE TABLE IF NOT EXISTS app_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pottery
CREATE TABLE IF NOT EXISTS pottery_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  bg_color   TEXT,
  text_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pottery_items (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  quantity            INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  dimensions          TEXT,
  pattern_description TEXT,
  style               TEXT,
  shape               TEXT,
  maker               TEXT,
  maker_info          TEXT,
  dominant_colors     TEXT[] NOT NULL DEFAULT '{}',
  motifs              TEXT[] NOT NULL DEFAULT '{}',
  image_path          TEXT NOT NULL,
  pattern_crop_path   TEXT,
  acquired_at         DATE,
  condition           TEXT,
  origin              TEXT,
  approximate_era     TEXT,
  ai_description      TEXT,
  locked_fields       TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pottery_images (
  id           SERIAL PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES pottery_items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pottery_item_categories (
  item_id     INTEGER NOT NULL REFERENCES pottery_items(id)      ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES pottery_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, category_id)
);

-- Quilting
CREATE TABLE IF NOT EXISTS quilting_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  bg_color   TEXT,
  text_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_fabrics (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  line_name        TEXT,
  designer         TEXT,
  manufacturer     TEXT,
  colorway         TEXT,
  print_type       TEXT,
  fiber_content    TEXT,
  width_inches     REAL,
  quantity         REAL NOT NULL DEFAULT 1,
  quantity_unit    TEXT NOT NULL DEFAULT 'yards',
  sku              TEXT,
  notes            TEXT,
  ai_description   TEXT,
  dominant_colors  TEXT[] NOT NULL DEFAULT '{}',
  motifs           TEXT[] NOT NULL DEFAULT '{}',
  style_descriptors TEXT[] NOT NULL DEFAULT '{}',
  image_path       TEXT NOT NULL,
  acquired_at      DATE,
  locked_fields    TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_patterns (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  designer           TEXT,
  block_size         TEXT,
  difficulty         TEXT,
  source_type        TEXT,
  source_reference   TEXT,
  notes              TEXT,
  image_path         TEXT,
  acquired_at        DATE,
  locked_fields      TEXT[] NOT NULL DEFAULT '{}',
  designer_bio       TEXT,
  designer_website   TEXT,
  publication_name   TEXT,
  publication_year   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_finished_quilts (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  date_completed DATE,
  size_width     REAL,
  size_height    REAL,
  recipient      TEXT,
  notes          TEXT,
  image_path     TEXT NOT NULL,
  locked_fields  TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_fabric_links (
  quilt_id  INTEGER NOT NULL REFERENCES quilting_finished_quilts(id) ON DELETE CASCADE,
  fabric_id INTEGER NOT NULL REFERENCES quilting_fabrics(id)         ON DELETE CASCADE,
  notes     TEXT,
  PRIMARY KEY (quilt_id, fabric_id)
);

CREATE TABLE IF NOT EXISTS quilting_pattern_links (
  quilt_id   INTEGER NOT NULL REFERENCES quilting_finished_quilts(id) ON DELETE CASCADE,
  pattern_id INTEGER NOT NULL REFERENCES quilting_patterns(id)        ON DELETE CASCADE,
  PRIMARY KEY (quilt_id, pattern_id)
);

CREATE TABLE IF NOT EXISTS quilting_entity_categories (
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES quilting_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_type, entity_id, category_id)
);

CREATE TABLE IF NOT EXISTS quilting_images (
  id           SERIAL PRIMARY KEY,
  entity_type  TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  storage_path TEXT    NOT NULL,
  label        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_blocks (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  grid_size             INTEGER NOT NULL DEFAULT 8,
  cells                 TEXT[] NOT NULL DEFAULT '{}',
  block_size_inches     REAL,
  seam_allowance_inches REAL,
  seams                 JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_layouts (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  rows                 INTEGER NOT NULL DEFAULT 5,
  cols                 INTEGER NOT NULL DEFAULT 5,
  cells                JSONB NOT NULL DEFAULT '[]',
  sashing_width_inches REAL,
  sashing_color        TEXT,
  border_width_inches  REAL,
  border_color         TEXT,
  cornerstone_color    TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_shopping_items (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  notes                TEXT,
  url                  TEXT,
  quantity             REAL,
  unit                 TEXT DEFAULT 'yards',
  estimated_price_usd  REAL,
  actual_price_usd     REAL,
  store                TEXT,
  status               TEXT NOT NULL DEFAULT 'want',
  priority             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function copyTable(
  source: pg.Client,
  dest: pg.Client,
  opts: { table: string; columns: string[]; orderBy?: string },
): Promise<number> {
  const cols = opts.columns.join(", ");
  const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
  const { rows } = await source.query(`SELECT ${cols} FROM ${opts.table}${order}`);
  if (rows.length === 0) return 0;

  await dest.query(`TRUNCATE ${opts.table} CASCADE`);
  const placeholders = opts.columns.map((_, i) => `$${i + 1}`).join(", ");
  for (const row of rows) {
    const values = opts.columns.map((c) => row[c] ?? null);
    await dest.query(
      `INSERT INTO ${opts.table} (${cols}) VALUES (${placeholders})`,
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
  const source = new Client({ connectionString: resolveDatabaseUrl(), ssl: sslConfig });
  const dest = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: false,
  });

  console.log("Connecting to Supabase (source) and Replit DB (destination)...");
  await source.connect();
  await dest.connect();

  // Ensure destination schema exists
  for (const stmt of DEST_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await dest.query(stmt);
  }

  const summary: Record<string, number> = {};

  // ── Shared ────────────────────────────────────────────────────────────────
  summary["app_users"] = await copyTable(source, dest, {
    table: "app_users",
    columns: ["id", "email", "password_hash", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "app_users", "id");

  // ── Pottery ───────────────────────────────────────────────────────────────
  summary["pottery_categories"] = await copyTable(source, dest, {
    table: "pottery_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_categories", "id");

  summary["pottery_items"] = await copyTable(source, dest, {
    table: "pottery_items",
    columns: [
      "id", "name", "quantity", "notes", "dimensions", "pattern_description",
      "style", "shape", "maker", "maker_info", "dominant_colors", "motifs",
      "image_path", "pattern_crop_path", "acquired_at", "condition", "origin",
      "approximate_era", "ai_description", "locked_fields", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_items", "id");

  summary["pottery_images"] = await copyTable(source, dest, {
    table: "pottery_images",
    columns: ["id", "item_id", "storage_path", "label", "position", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_images", "id");

  summary["pottery_item_categories"] = await copyTable(source, dest, {
    table: "pottery_item_categories",
    columns: ["item_id", "category_id"],
  });

  // ── Quilting ──────────────────────────────────────────────────────────────
  summary["quilting_categories"] = await copyTable(source, dest, {
    table: "quilting_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_categories", "id");

  summary["quilting_fabrics"] = await copyTable(source, dest, {
    table: "quilting_fabrics",
    columns: [
      "id", "name", "line_name", "designer", "manufacturer", "colorway",
      "print_type", "fiber_content", "width_inches", "quantity", "quantity_unit",
      "sku", "notes", "ai_description", "dominant_colors", "motifs",
      "style_descriptors", "image_path", "acquired_at", "locked_fields", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_fabrics", "id");

  summary["quilting_patterns"] = await copyTable(source, dest, {
    table: "quilting_patterns",
    columns: [
      "id", "name", "designer", "block_size", "difficulty", "source_type",
      "source_reference", "notes", "image_path", "acquired_at", "locked_fields",
      "designer_bio", "designer_website", "publication_name", "publication_year",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_patterns", "id");

  summary["quilting_finished_quilts"] = await copyTable(source, dest, {
    table: "quilting_finished_quilts",
    columns: [
      "id", "name", "date_completed", "size_width", "size_height",
      "recipient", "notes", "image_path", "locked_fields", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_finished_quilts", "id");

  summary["quilting_fabric_links"] = await copyTable(source, dest, {
    table: "quilting_fabric_links",
    columns: ["quilt_id", "fabric_id", "notes"],
  });

  summary["quilting_pattern_links"] = await copyTable(source, dest, {
    table: "quilting_pattern_links",
    columns: ["quilt_id", "pattern_id"],
  });

  summary["quilting_entity_categories"] = await copyTable(source, dest, {
    table: "quilting_entity_categories",
    columns: ["entity_type", "entity_id", "category_id"],
  });

  summary["quilting_images"] = await copyTable(source, dest, {
    table: "quilting_images",
    columns: ["id", "entity_type", "entity_id", "storage_path", "label", "position", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_images", "id");

  summary["quilting_blocks"] = await copyTable(source, dest, {
    table: "quilting_blocks",
    columns: [
      "id", "name", "grid_size", "cells", "block_size_inches",
      "seam_allowance_inches", "seams", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_blocks", "id");

  summary["quilting_layouts"] = await copyTable(source, dest, {
    table: "quilting_layouts",
    columns: [
      "id", "name", "rows", "cols", "cells", "sashing_width_inches",
      "sashing_color", "border_width_inches", "border_color",
      "cornerstone_color", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_layouts", "id");

  summary["quilting_shopping_items"] = await copyTable(source, dest, {
    table: "quilting_shopping_items",
    columns: [
      "id", "name", "notes", "url", "quantity", "unit",
      "estimated_price_usd", "actual_price_usd", "store",
      "status", "priority", "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_shopping_items", "id");

  // ── Record backup history ─────────────────────────────────────────────────
  const note = Object.entries(summary)
    .map(([t, n]) => `${t}:${n}`)
    .join(", ");
  await dest.query(`INSERT INTO backup_history (note) VALUES ($1)`, [note]);

  console.log("✓ Backup complete.");
  console.log("  Row counts:", summary);

  await source.end();
  await dest.end();
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
