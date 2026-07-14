/**
 * backup-to-replit.ts
 *
 * Copies all Supabase tables (pottery + quilting + travels + shared) to the
 * Replit built-in PostgreSQL database.  Safe to run at any time; uses
 * TRUNCATE + INSERT inside a transaction so the destination is always a
 * consistent snapshot.
 *
 * What is backed up:
 *   Shared:  app_users (including phone/SMS opt-in fields), agentphone_conversations,
 *            agentphone_webhook_deliveries
 *   Pottery: pottery_categories, pottery_items (WITHOUT embedding/visual_embedding),
 *            pottery_images, pottery_item_categories
 *   Ornaments: ornaments_categories, ornaments_items (WITHOUT embedding/visual_embedding),
 *              ornaments_images, ornaments_item_categories, ornaments_barcode_cache,
 *              ornaments_hallmark_events
 *   Quilting: quilting_categories, quilting_fabrics (WITHOUT embedding/visual_embedding),
 *             quilting_patterns (WITHOUT embedding/visual_embedding),
 *             quilting_finished_quilts, quilting_fabric_links, quilting_pattern_links,
 *             quilting_entity_categories, quilting_images, quilting_blocks,
 *             quilting_block_templates, quilting_layouts, quilting_shopping_items
 *   Travels:  travels_trips, travels_trip_documents, travels_trip_photos,
 *             travels_wishlist, travels_reminders, travels_reminder_alert_log,
 *             travels_calendar_settings, travels_google_calendar_connections,
 *             travels_connected_calendars, travels_reminder_calendar_events,
 *             travels_gmail_connections,
 *             travels_gmail_scan_decisions, travels_card_layout_preferences,
 *             travels_trip_card_collapse_state, travels_custom_document_types,
 *             travels_calendar_trip_suggestions
 *   Messenger: messenger_conversations, messenger_messages, messenger_attachments,
 *              messenger_link_previews
 *   Elaine:   elaine_conversations, elaine_settings, elaine_memory, elaine_nudges,
 *             elaine_global_config, elaine_history_conversations, elaine_history_messages
 *             (shared assistant, not namespaced per-app)
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
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS theme_preference TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS hub_widget_ids TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS hub_weather_config TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS travels_reminder_email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ;

-- AgentPhone SMS/voice webhook
CREATE TABLE IF NOT EXISTS agentphone_conversations (
  id            SERIAL PRIMARY KEY,
  phone_number  TEXT NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL,
  messages      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agentphone_webhook_deliveries (
  id           TEXT PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_gmail_connections (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER NOT NULL UNIQUE,
  google_email            TEXT NOT NULL,
  refresh_token           TEXT NOT NULL,
  access_token            TEXT,
  access_token_expires_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Ornaments
CREATE TABLE IF NOT EXISTS ornaments_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  bg_color   TEXT,
  text_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornaments_items (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  brand                 TEXT NOT NULL DEFAULT 'Hallmark',
  series_or_collection  TEXT,
  year                  INTEGER,
  barcode_value         TEXT,
  quantity              INTEGER NOT NULL DEFAULT 1,
  notes                 TEXT,
  dimensions            TEXT,
  condition             TEXT,
  origin                TEXT,
  acquired_at           DATE,
  ai_description        TEXT,
  dominant_colors       TEXT[] NOT NULL DEFAULT '{}',
  motifs                TEXT[] NOT NULL DEFAULT '{}',
  image_path            TEXT NOT NULL,
  locked_fields         TEXT[] NOT NULL DEFAULT '{}',
  book_value            NUMERIC(10, 2),
  book_value_source     TEXT,
  book_value_updated_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornaments_images (
  id           SERIAL PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES ornaments_items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornaments_item_categories (
  item_id     INTEGER NOT NULL REFERENCES ornaments_items(id)      ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES ornaments_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, category_id)
);

CREATE TABLE IF NOT EXISTS ornaments_barcode_cache (
  barcode              TEXT PRIMARY KEY,
  found                INTEGER NOT NULL DEFAULT 0,
  name                 TEXT,
  brand                TEXT,
  series_or_collection TEXT,
  year                 INTEGER,
  description          TEXT,
  image_url            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Office
CREATE TABLE IF NOT EXISTS office_notes (
  id                  SERIAL PRIMARY KEY,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL DEFAULT '',
  created_by_user_id  INTEGER REFERENCES app_users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornaments_hallmark_events (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER,
  title            TEXT NOT NULL,
  description      TEXT,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  google_event_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS quilting_block_templates (
  id                    SERIAL PRIMARY KEY,
  created_by_user_id    INTEGER,
  name                  TEXT NOT NULL,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  grid_w                INTEGER NOT NULL DEFAULT 8,
  grid_h                INTEGER NOT NULL DEFAULT 8,
  cells                 TEXT[] NOT NULL DEFAULT '{}',
  seams                 JSONB NOT NULL DEFAULT '[]',
  block_size_inches     REAL,
  seam_allowance_inches REAL,
  thumbnail_svg         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Travels
CREATE TABLE IF NOT EXISTS travels_trips (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL,
  title              TEXT NOT NULL,
  destination        TEXT NOT NULL,
  lat                REAL,
  lng                REAL,
  status             TEXT NOT NULL DEFAULT 'wishlist',
  start_date         DATE,
  end_date           DATE,
  transport_to       TEXT,
  transport_details  TEXT,
  has_rental_car     BOOLEAN NOT NULL DEFAULT false,
  accommodation_name TEXT,
  accommodation_area TEXT,
  notes              TEXT,
  fun_fact           TEXT,
  traveller_count    INTEGER NOT NULL DEFAULT 2,
  travelers          JSONB,
  the_one_thing      JSONB,
  itinerary          JSONB,
  packing_list       JSONB,
  chat_history       JSONB,
  todo_list          JSONB,
  icon_photo_id      INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_trip_documents (
  id                SERIAL PRIMARY KEY,
  trip_id           INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  storage_path      TEXT NOT NULL,
  title             TEXT,
  document_type     TEXT,
  original_filename TEXT,
  extracted_data    JSONB,
  locked_fields     TEXT[] NOT NULL DEFAULT '{}',
  gmail_message_id  TEXT,
  icon_override     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_trip_photos (
  id           SERIAL PRIMARY KEY,
  trip_id      INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  caption      TEXT,
  photo_type   TEXT NOT NULL DEFAULT 'photo',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_wishlist (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  destination TEXT NOT NULL,
  target_date DATE,
  notes       TEXT,
  lat         REAL,
  lng         REAL,
  done        BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_reminders (
  id               SERIAL PRIMARY KEY,
  trip_id          INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  title            TEXT NOT NULL,
  due_date         DATE,
  done             BOOLEAN NOT NULL DEFAULT false,
  recipient_emails TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_reminder_alert_log (
  id          SERIAL PRIMARY KEY,
  reminder_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  alert_type  TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_calendar_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  calendar_id      TEXT,
  calendar_summary TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_google_calendar_connections (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL UNIQUE,
  google_email              TEXT NOT NULL,
  refresh_token             TEXT NOT NULL,
  access_token              TEXT,
  access_token_expires_at   TIMESTAMPTZ,
  calendar_id               TEXT,
  calendar_summary          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_connected_calendars (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL,
  google_calendar_id   TEXT NOT NULL,
  summary              TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'picked',
  primary_color        TEXT NOT NULL DEFAULT '#4285f4',
  is_travel_calendar   BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_reminder_calendar_events (
  id               SERIAL PRIMARY KEY,
  reminder_id      INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  google_event_id  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Elaine (shared assistant, not namespaced per-app)
CREATE TABLE IF NOT EXISTS elaine_conversations (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL UNIQUE,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elaine_settings (
  user_id                   INTEGER PRIMARY KEY,
  enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
  action_confirmation_mode  TEXT NOT NULL DEFAULT 'one_by_one',
  chat_window_size          TEXT NOT NULL DEFAULT 'compact',
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elaine_memory (
  id                  SERIAL PRIMARY KEY,
  content             TEXT NOT NULL,
  created_by_user_id  INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Elaine inbound email (Resend webhook)
CREATE TABLE IF NOT EXISTS elaine_email_conversations (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL UNIQUE,
  messages         JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_message_id  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elaine_email_webhook_deliveries (
  id           TEXT PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elaine_global_config (
  id                    INTEGER PRIMARY KEY DEFAULT 1,
  chat_model            TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  subagent_model        TEXT NOT NULL DEFAULT 'z-ai/glm-5.2',
  request_timeout_ms    INTEGER NOT NULL DEFAULT 12000,
  max_response_tokens   INTEGER NOT NULL DEFAULT 700,
  extra_models          JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeouts              JSONB NOT NULL DEFAULT '{}'::jsonb,
  features              JSONB NOT NULL DEFAULT '{}'::jsonb,
  thresholds            JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id    INTEGER
);

CREATE TABLE IF NOT EXISTS elaine_nudges (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  source_app  TEXT,
  source_id   INTEGER,
  nudge_key   TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS elaine_history_conversations (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT 'New conversation',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elaine_history_messages (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER NOT NULL REFERENCES elaine_history_conversations(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL DEFAULT '',
  attachment_urls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gmail travel-document scanning
CREATE TABLE IF NOT EXISTS travels_gmail_connections (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL UNIQUE,
  google_email              TEXT NOT NULL,
  refresh_token             TEXT NOT NULL,
  access_token              TEXT,
  access_token_expires_at   TIMESTAMPTZ,
  last_history_id           TEXT,
  last_scan_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_gmail_scan_decisions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL,
  gmail_message_id   TEXT NOT NULL,
  thread_id          TEXT,
  subject            TEXT,
  from_address       TEXT,
  received_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'pending',
  extracted_data     JSONB,
  dedupe_key         TEXT,
  suggested_trip_id  INTEGER,
  trip_id            INTEGER,
  trip_document_id   INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user Trip Detail card layout / collapse preferences
CREATE TABLE IF NOT EXISTS travels_card_layout_preferences (
  user_id     INTEGER PRIMARY KEY,
  card_order  TEXT[] NOT NULL DEFAULT '{}'::text[],
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_trip_card_collapse_state (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  trip_id           INTEGER NOT NULL,
  collapsed_cards   TEXT[] NOT NULL DEFAULT '{}'::text[],
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_custom_document_types (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  type_key    TEXT NOT NULL,
  type_name   TEXT NOT NULL,
  description TEXT,
  icon_name   TEXT,
  color_key   TEXT,
  fields      JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_calendar_trip_suggestions (
  id                       SERIAL PRIMARY KEY,
  suggested_title          TEXT NOT NULL,
  destination              TEXT,
  start_date               DATE,
  end_date                 DATE,
  related_event_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key               TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  user_id                  INTEGER,
  is_from_shared_calendar  BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS icon_override TEXT;

ALTER TABLE elaine_settings ADD COLUMN IF NOT EXISTS chat_window_size TEXT NOT NULL DEFAULT 'compact';
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS extra_models JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS timeouts JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb;
`;

async function copyTable(
  source: pg.Client,
  dest: pg.Client,
  opts: {
    table: string;
    columns: string[];
    orderBy?: string;
    jsonbColumns?: string[];
  },
): Promise<number> {
  const cols = opts.columns.join(", ");
  const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
  const { rows } = await source.query(
    `SELECT ${cols} FROM ${opts.table}${order}`,
  );
  if (rows.length === 0) return 0;

  await dest.query(`TRUNCATE ${opts.table} CASCADE`);
  const placeholders = opts.columns.map((_, i) => `$${i + 1}`).join(", ");
  const jsonbCols = new Set(opts.jsonbColumns ?? []);
  for (const row of rows) {
    const values = opts.columns.map((c) => {
      const v = row[c] ?? null;
      if (v !== null && jsonbCols.has(c) && typeof v === "object") {
        return JSON.stringify(v);
      }
      return v;
    });
    try {
      await dest.query(
        `INSERT INTO ${opts.table} (${cols}) VALUES (${placeholders})`,
        values,
      );
    } catch (err) {
      console.error(
        `[copyTable] failed on table="${opts.table}" row id=${row["id"] ?? "?"}`,
      );
      throw err;
    }
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
  const source = new Client({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
  });
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
  for (const stmt of DEST_SCHEMA.split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await dest.query(stmt);
  }

  const summary: Record<string, number> = {};

  // ── Shared ────────────────────────────────────────────────────────────────
  summary["app_users"] = await copyTable(source, dest, {
    table: "app_users",
    columns: [
      "id",
      "email",
      "password_hash",
      "display_name",
      "theme_preference",
      "hub_widget_ids",
      "hub_weather_config",
      "travels_reminder_email",
      "timezone",
      "is_owner",
      "phone_number",
      "phone_verified",
      "phone_verified_at",
      "sms_consent_at",
      "sms_opted_out_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_users", "id");

  summary["agentphone_conversations"] = await copyTable(source, dest, {
    table: "agentphone_conversations",
    columns: ["id", "phone_number", "user_id", "messages", "updated_at"],
    orderBy: "id",
    jsonbColumns: ["messages"],
  });
  await resetSequence(dest, "agentphone_conversations", "id");

  summary["agentphone_webhook_deliveries"] = await copyTable(source, dest, {
    table: "agentphone_webhook_deliveries",
    columns: ["id", "received_at"],
    orderBy: "received_at",
  });

  summary["app_gmail_connections"] = await copyTable(source, dest, {
    table: "app_gmail_connections",
    columns: [
      "id",
      "user_id",
      "google_email",
      "refresh_token",
      "access_token",
      "access_token_expires_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_gmail_connections", "id");

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

  summary["pottery_images"] = await copyTable(source, dest, {
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

  summary["pottery_item_categories"] = await copyTable(source, dest, {
    table: "pottery_item_categories",
    columns: ["item_id", "category_id"],
  });

  // ── Ornaments ─────────────────────────────────────────────────────────────
  summary["ornaments_categories"] = await copyTable(source, dest, {
    table: "ornaments_categories",
    columns: ["id", "name", "bg_color", "text_color", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_categories", "id");

  summary["ornaments_items"] = await copyTable(source, dest, {
    table: "ornaments_items",
    columns: [
      "id",
      "name",
      "brand",
      "series_or_collection",
      "year",
      "barcode_value",
      "quantity",
      "notes",
      "dimensions",
      "condition",
      "origin",
      "acquired_at",
      "ai_description",
      "dominant_colors",
      "motifs",
      "image_path",
      "locked_fields",
      "book_value",
      "book_value_source",
      "book_value_updated_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_items", "id");

  summary["ornaments_images"] = await copyTable(source, dest, {
    table: "ornaments_images",
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
  await resetSequence(dest, "ornaments_images", "id");

  summary["ornaments_item_categories"] = await copyTable(source, dest, {
    table: "ornaments_item_categories",
    columns: ["item_id", "category_id"],
  });

  summary["ornaments_barcode_cache"] = await copyTable(source, dest, {
    table: "ornaments_barcode_cache",
    columns: [
      "barcode",
      "found",
      "name",
      "brand",
      "series_or_collection",
      "year",
      "description",
      "image_url",
      "created_at",
    ],
    orderBy: "barcode",
  });

  summary["ornaments_hallmark_events"] = await copyTable(source, dest, {
    table: "ornaments_hallmark_events",
    columns: [
      "id",
      "user_id",
      "title",
      "description",
      "start_date",
      "end_date",
      "google_event_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornaments_hallmark_events", "id");

  // ── Office ────────────────────────────────────────────────────────────────
  summary["office_notes"] = await copyTable(source, dest, {
    table: "office_notes",
    columns: [
      "id",
      "title",
      "body",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "office_notes", "id");

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

  summary["quilting_patterns"] = await copyTable(source, dest, {
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

  summary["quilting_finished_quilts"] = await copyTable(source, dest, {
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

  summary["quilting_blocks"] = await copyTable(source, dest, {
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
    jsonbColumns: ["seams"],
  });
  await resetSequence(dest, "quilting_blocks", "id");

  summary["quilting_block_templates"] = await copyTable(source, dest, {
    table: "quilting_block_templates",
    columns: [
      "id",
      "created_by_user_id",
      "name",
      "tags",
      "grid_w",
      "grid_h",
      "cells",
      "seams",
      "block_size_inches",
      "seam_allowance_inches",
      "thumbnail_svg",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["seams"],
  });
  await resetSequence(dest, "quilting_block_templates", "id");

  summary["quilting_layouts"] = await copyTable(source, dest, {
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
    jsonbColumns: ["cells"],
  });
  await resetSequence(dest, "quilting_layouts", "id");

  summary["quilting_shopping_items"] = await copyTable(source, dest, {
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

  // ── Travels ───────────────────────────────────────────────────────────────
  summary["travels_trips"] = await copyTable(source, dest, {
    table: "travels_trips",
    columns: [
      "id",
      "user_id",
      "title",
      "destination",
      "lat",
      "lng",
      "status",
      "start_date",
      "end_date",
      "transport_to",
      "transport_details",
      "has_rental_car",
      "accommodation_name",
      "accommodation_area",
      "notes",
      "fun_fact",
      "traveller_count",
      "travelers",
      "the_one_thing",
      "itinerary",
      "packing_list",
      "chat_history",
      "todo_list",
      "icon_photo_id",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: [
      "travelers",
      "the_one_thing",
      "itinerary",
      "packing_list",
      "chat_history",
      "todo_list",
    ],
  });
  await resetSequence(dest, "travels_trips", "id");

  summary["travels_trip_documents"] = await copyTable(source, dest, {
    table: "travels_trip_documents",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "storage_path",
      "title",
      "document_type",
      "original_filename",
      "extracted_data",
      "locked_fields",
      "gmail_message_id",
      "icon_override",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["extracted_data"],
  });
  await resetSequence(dest, "travels_trip_documents", "id");

  summary["travels_trip_photos"] = await copyTable(source, dest, {
    table: "travels_trip_photos",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "storage_path",
      "caption",
      "photo_type",
      "sort_order",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trip_photos", "id");

  summary["travels_wishlist"] = await copyTable(source, dest, {
    table: "travels_wishlist",
    columns: [
      "id",
      "user_id",
      "destination",
      "target_date",
      "notes",
      "lat",
      "lng",
      "done",
      "sort_order",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_wishlist", "id");

  summary["travels_reminders"] = await copyTable(source, dest, {
    table: "travels_reminders",
    columns: [
      "id",
      "trip_id",
      "user_id",
      "title",
      "due_date",
      "done",
      "recipient_emails",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminders", "id");

  summary["travels_reminder_alert_log"] = await copyTable(source, dest, {
    table: "travels_reminder_alert_log",
    columns: ["id", "reminder_id", "user_id", "alert_type", "sent_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminder_alert_log", "id");

  summary["travels_calendar_settings"] = await copyTable(source, dest, {
    table: "travels_calendar_settings",
    columns: ["id", "calendar_id", "calendar_summary", "updated_at"],
    orderBy: "id",
  });

  summary["travels_google_calendar_connections"] = await copyTable(
    source,
    dest,
    {
      table: "travels_google_calendar_connections",
      columns: [
        "id",
        "user_id",
        "google_email",
        "refresh_token",
        "access_token",
        "access_token_expires_at",
        "calendar_id",
        "calendar_summary",
        "created_at",
        "updated_at",
      ],
      orderBy: "id",
    },
  );
  await resetSequence(dest, "travels_google_calendar_connections", "id");

  summary["travels_connected_calendars"] = await copyTable(source, dest, {
    table: "travels_connected_calendars",
    columns: [
      "id",
      "user_id",
      "google_calendar_id",
      "summary",
      "source",
      "primary_color",
      "is_travel_calendar",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_connected_calendars", "id");

  summary["travels_reminder_calendar_events"] = await copyTable(source, dest, {
    table: "travels_reminder_calendar_events",
    columns: ["id", "reminder_id", "user_id", "google_event_id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_reminder_calendar_events", "id");

  // ── Elaine (shared assistant, not namespaced per-app) ────────────────────
  summary["elaine_conversations"] = await copyTable(source, dest, {
    table: "elaine_conversations",
    columns: ["id", "user_id", "messages", "updated_at"],
    orderBy: "id",
    jsonbColumns: ["messages"],
  });
  await resetSequence(dest, "elaine_conversations", "id");

  summary["elaine_email_conversations"] = await copyTable(source, dest, {
    table: "elaine_email_conversations",
    columns: ["id", "user_id", "messages", "last_message_id", "updated_at"],
    orderBy: "id",
    jsonbColumns: ["messages"],
  });
  await resetSequence(dest, "elaine_email_conversations", "id");

  summary["elaine_email_webhook_deliveries"] = await copyTable(source, dest, {
    table: "elaine_email_webhook_deliveries",
    columns: ["id", "received_at"],
    orderBy: "received_at",
  });

  summary["elaine_settings"] = await copyTable(source, dest, {
    table: "elaine_settings",
    columns: [
      "user_id",
      "enabled",
      "action_confirmation_mode",
      "chat_window_size",
      "updated_at",
    ],
    orderBy: "user_id",
  });

  summary["elaine_memory"] = await copyTable(source, dest, {
    table: "elaine_memory",
    columns: ["id", "content", "created_by_user_id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_memory", "id");

  summary["elaine_nudges"] = await copyTable(source, dest, {
    table: "elaine_nudges",
    columns: [
      "id",
      "user_id",
      "source_app",
      "source_id",
      "nudge_key",
      "message",
      "created_at",
      "seen_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_nudges", "id");

  summary["elaine_global_config"] = await copyTable(source, dest, {
    table: "elaine_global_config",
    columns: [
      "id",
      "chat_model",
      "subagent_model",
      "request_timeout_ms",
      "max_response_tokens",
      "extra_models",
      "timeouts",
      "features",
      "thresholds",
      "updated_at",
      "updated_by_user_id",
    ],
    orderBy: "id",
    jsonbColumns: ["extra_models", "timeouts", "features", "thresholds"],
  });

  summary["elaine_history_conversations"] = await copyTable(source, dest, {
    table: "elaine_history_conversations",
    columns: ["id", "user_id", "title", "created_at", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "elaine_history_conversations", "id");

  summary["elaine_history_messages"] = await copyTable(source, dest, {
    table: "elaine_history_messages",
    columns: [
      "id",
      "conversation_id",
      "user_id",
      "role",
      "content",
      "attachment_urls",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["attachment_urls"],
  });
  await resetSequence(dest, "elaine_history_messages", "id");

  // ── Gmail travel-document scanning ───────────────────────────────────────
  summary["travels_gmail_connections"] = await copyTable(source, dest, {
    table: "travels_gmail_connections",
    columns: [
      "id",
      "user_id",
      "google_email",
      "refresh_token",
      "access_token",
      "access_token_expires_at",
      "last_history_id",
      "last_scan_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_gmail_connections", "id");

  summary["travels_gmail_scan_decisions"] = await copyTable(source, dest, {
    table: "travels_gmail_scan_decisions",
    columns: [
      "id",
      "user_id",
      "gmail_message_id",
      "thread_id",
      "subject",
      "from_address",
      "received_at",
      "status",
      "extracted_data",
      "dedupe_key",
      "suggested_trip_id",
      "trip_id",
      "trip_document_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["extracted_data"],
  });
  await resetSequence(dest, "travels_gmail_scan_decisions", "id");

  // ── Per-user Trip Detail card layout / collapse preferences ───────────────
  summary["travels_card_layout_preferences"] = await copyTable(source, dest, {
    table: "travels_card_layout_preferences",
    columns: ["user_id", "card_order", "updated_at"],
    orderBy: "user_id",
  });

  summary["travels_trip_card_collapse_state"] = await copyTable(source, dest, {
    table: "travels_trip_card_collapse_state",
    columns: ["id", "user_id", "trip_id", "collapsed_cards", "updated_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_trip_card_collapse_state", "id");

  summary["travels_custom_document_types"] = await copyTable(source, dest, {
    table: "travels_custom_document_types",
    columns: [
      "id",
      "user_id",
      "type_key",
      "type_name",
      "description",
      "icon_name",
      "color_key",
      "fields",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["fields"],
  });
  await resetSequence(dest, "travels_custom_document_types", "id");

  summary["travels_calendar_trip_suggestions"] = await copyTable(source, dest, {
    table: "travels_calendar_trip_suggestions",
    columns: [
      "id",
      "suggested_title",
      "destination",
      "start_date",
      "end_date",
      "related_event_ids",
      "dedupe_key",
      "status",
      "user_id",
      "is_from_shared_calendar",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["related_event_ids"],
  });
  await resetSequence(dest, "travels_calendar_trip_suggestions", "id");

  // ── Messenger ─────────────────────────────────────────────────────────────
  summary["messenger_conversations"] = await copyTable(source, dest, {
    table: "messenger_conversations",
    columns: ["id", "created_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_conversations", "id");

  summary["messenger_messages"] = await copyTable(source, dest, {
    table: "messenger_messages",
    columns: [
      "id",
      "conversation_id",
      "sender_id",
      "body",
      "read_at",
      "deleted_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_messages", "id");

  summary["messenger_attachments"] = await copyTable(source, dest, {
    table: "messenger_attachments",
    columns: [
      "id",
      "message_id",
      "storage_path",
      "mime_type",
      "file_name",
      "size_bytes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_attachments", "id");

  summary["messenger_link_previews"] = await copyTable(source, dest, {
    table: "messenger_link_previews",
    columns: ["id", "url", "title", "description", "image_url", "fetched_at"],
    orderBy: "id",
  });
  await resetSequence(dest, "messenger_link_previews", "id");

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
