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
 *             travels_calendar_trip_suggestions,
 *             travels_reservations, travel_monitoring_baselines,
 *             travel_monitoring_observations, travel_change_events,
 *             travels_monitoring_preferences
 *   Notifications: notification_events, notification_recipients, notification_deliveries,
 *                  notification_preferences
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

CREATE TABLE IF NOT EXISTS pottery_watchlist_items (
  id                  SERIAL PRIMARY KEY,
  created_by_user_id  INTEGER,
  title               TEXT NOT NULL,
  keywords            TEXT NOT NULL,
  price_min_usd       NUMERIC(10,2),
  price_max_usd       NUMERIC(10,2),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at     TIMESTAMPTZ,
  last_alert_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pottery_watchlist_alerts (
  id                SERIAL PRIMARY KEY,
  watchlist_item_id INTEGER NOT NULL REFERENCES pottery_watchlist_items(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  listing_id        TEXT NOT NULL,
  title             TEXT NOT NULL,
  price_usd         NUMERIC(10,2),
  condition         TEXT,
  image_url         TEXT,
  listing_url       TEXT NOT NULL,
  sold_at           TIMESTAMPTZ,
  seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed         BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (watchlist_item_id, platform, listing_id)
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

-- Messenger
CREATE TABLE IF NOT EXISTS messenger_conversations (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messenger_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES messenger_conversations(id),
  sender_id       INTEGER REFERENCES app_users(id),
  body            TEXT NOT NULL DEFAULT '',
  read_at         TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messenger_attachments (
  id           SERIAL PRIMARY KEY,
  message_id   INTEGER NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messenger_link_previews (
  id          SERIAL PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  title       TEXT,
  description TEXT,
  image_url   TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS travels_reservations (
  id                   SERIAL PRIMARY KEY,
  trip_id              INTEGER NOT NULL,
  document_id          INTEGER,
  reservation_type     TEXT NOT NULL DEFAULT 'general',
  status               TEXT NOT NULL DEFAULT 'confirmed',
  provider_name        TEXT,
  confirmation_ref     TEXT,
  passenger_names      JSONB NOT NULL DEFAULT '[]'::jsonb,
  segments             JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_in_date        DATE,
  check_out_date       DATE,
  destination_iata     TEXT,
  origin_iata          TEXT,
  raw_extracted        JSONB NOT NULL DEFAULT '{}'::jsonb,
  monitoring_enabled   BOOLEAN NOT NULL DEFAULT true,
  monitoring_policy    TEXT NOT NULL DEFAULT 'standard',
  last_baseline_at     TIMESTAMPTZ,
  last_checked_at      TIMESTAMPTZ,
  created_by_user_id   INTEGER NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_monitoring_baselines (
  id                   SERIAL PRIMARY KEY,
  reservation_id       INTEGER NOT NULL,
  normalized_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version       TEXT NOT NULL DEFAULT '1',
  content_hash         TEXT,
  confirmed_by         TEXT NOT NULL DEFAULT 'auto',
  confirmed_by_user_id INTEGER,
  source_refs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_monitoring_observations (
  id                   SERIAL PRIMARY KEY,
  reservation_id       INTEGER NOT NULL,
  provider             TEXT NOT NULL,
  external_record_id   TEXT,
  observed_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash         TEXT,
  authority            TEXT NOT NULL DEFAULT 'document',
  raw_snapshot         JSONB DEFAULT '{}'::jsonb,
  job_id               INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travel_change_events (
  id                       SERIAL PRIMARY KEY,
  reservation_id           INTEGER NOT NULL,
  baseline_id              INTEGER,
  previous_observation_id  INTEGER,
  new_observation_id       INTEGER,
  change_type              TEXT NOT NULL,
  severity                 TEXT NOT NULL DEFAULT 'informational',
  field_diffs              JSONB NOT NULL DEFAULT '[]'::jsonb,
  materiality_reason       TEXT,
  downstream_impacts       JSONB NOT NULL DEFAULT '[]'::jsonb,
  state                    TEXT NOT NULL DEFAULT 'detected',
  decided_by_user_id       INTEGER,
  decided_at               TIMESTAMPTZ,
  decision_notes           TEXT,
  notification_event_id    INTEGER,
  dedup_key                TEXT UNIQUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_monitoring_preferences (
  id                               SERIAL PRIMARY KEY,
  user_id                          INTEGER NOT NULL UNIQUE,
  monitoring_enabled               BOOLEAN NOT NULL DEFAULT true,
  weather_alerts                   BOOLEAN NOT NULL DEFAULT true,
  check_in_reminders               BOOLEAN NOT NULL DEFAULT true,
  document_reminders               BOOLEAN NOT NULL DEFAULT true,
  min_severity                     TEXT NOT NULL DEFAULT 'attention',
  notify_channels                  JSONB NOT NULL DEFAULT '{"inApp":true,"email":false}'::jsonb,
  schedule_change_threshold_minutes INTEGER NOT NULL DEFAULT 30,
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS icon_override TEXT;

ALTER TABLE elaine_settings ADD COLUMN IF NOT EXISTS chat_window_size TEXT NOT NULL DEFAULT 'compact';
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS extra_models JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS timeouts JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Phase 2: Operations (job queue + external cost tracking)
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  version         BIGINT PRIMARY KEY,
  name            TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by      TEXT,
  execution_ms    INTEGER,
  app_commit_sha  TEXT
);

CREATE TABLE IF NOT EXISTS app_jobs (
  id                      SERIAL PRIMARY KEY,
  type                    TEXT NOT NULL,
  queue                   TEXT NOT NULL DEFAULT 'default',
  status                  TEXT NOT NULL DEFAULT 'queued',
  priority                INTEGER NOT NULL DEFAULT 0,
  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_schema_version  INTEGER NOT NULL DEFAULT 1,
  idempotency_key         TEXT,
  created_by_user_id      INTEGER,
  domain                  TEXT,
  scheduled_for           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count           INTEGER NOT NULL DEFAULT 0,
  max_attempts            INTEGER NOT NULL DEFAULT 3,
  lease_owner             TEXT,
  lease_expires_at        TIMESTAMPTZ,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  progress_percent        INTEGER NOT NULL DEFAULT 0,
  progress_message        TEXT,
  last_error_code         TEXT,
  last_error_message      TEXT,
  provider_request_id     TEXT,
  parent_job_id           INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_job_attempts (
  id              SERIAL PRIMARY KEY,
  job_id          INTEGER NOT NULL,
  attempt_number  INTEGER NOT NULL,
  status          TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_code      TEXT,
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS external_operation_events (
  id                   SERIAL PRIMARY KEY,
  provider             TEXT NOT NULL,
  operation            TEXT NOT NULL,
  model_or_actor       TEXT,
  feature              TEXT NOT NULL,
  module               TEXT NOT NULL,
  user_id              INTEGER,
  request_id           TEXT,
  job_id               INTEGER,
  parent_job_id        INTEGER,
  status               TEXT NOT NULL,
  error_code           TEXT,
  started_at           TIMESTAMPTZ NOT NULL,
  completed_at         TIMESTAMPTZ NOT NULL,
  duration_ms          INTEGER NOT NULL,
  attempt_number       INTEGER NOT NULL DEFAULT 1,
  retry_count          INTEGER NOT NULL DEFAULT 0,
  cache_status         TEXT NOT NULL DEFAULT 'not_applicable',
  input_units          INTEGER,
  output_units         INTEGER,
  billed_units         NUMERIC(18,6),
  estimated_cost_usd   NUMERIC(18,8),
  actual_cost_usd      NUMERIC(18,8),
  currency             TEXT NOT NULL DEFAULT 'USD',
  pricing_version_at   TIMESTAMPTZ,
  provider_request_id  TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_provider_pricing (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL,
  operation       TEXT NOT NULL,
  model_or_actor  TEXT,
  unit_type       TEXT NOT NULL,
  price_usd       NUMERIC(18,8) NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,
  source          TEXT NOT NULL DEFAULT 'manual',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_budget_policies (
  id                   SERIAL PRIMARY KEY,
  scope                TEXT NOT NULL,
  scope_value          TEXT,
  period               TEXT NOT NULL,
  soft_threshold_usd   NUMERIC(18,2) NOT NULL,
  hard_threshold_usd   NUMERIC(18,2) NOT NULL,
  warning_policy       TEXT NOT NULL DEFAULT 'owner_dashboard',
  degradation_action   TEXT NOT NULL DEFAULT 'warn_only',
  enabled              BOOLEAN NOT NULL DEFAULT true,
  override_until       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: AI provenance (#229)
CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id                      SERIAL PRIMARY KEY,
  module                  TEXT NOT NULL,
  feature                 TEXT NOT NULL,
  target_type             TEXT NOT NULL,
  target_id               INTEGER,
  job_id                  INTEGER,
  operation_event_id      INTEGER,
  user_id                 INTEGER,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  model_provider_run_id   TEXT,
  prompt_template_id      TEXT,
  prompt_version_hash     TEXT,
  tool_schema_version     INTEGER NOT NULL DEFAULT 1,
  input_artifact_hashes   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'pending',
  error_code              TEXT,
  error_message           TEXT,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  duration_ms             INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_field_candidates (
  id                      SERIAL PRIMARY KEY,
  generation_run_id       INTEGER NOT NULL,
  target_type             TEXT NOT NULL,
  target_id               INTEGER,
  field_path              TEXT NOT NULL,
  candidate_value         JSONB,
  normalized_value_hash   TEXT,
  confidence_score        NUMERIC(5,4),
  confidence_method       TEXT,
  authority_class         TEXT NOT NULL DEFAULT 'vision',
  source_references       JSONB NOT NULL DEFAULT '[]'::jsonb,
  disposition             TEXT NOT NULL DEFAULT 'proposed',
  applied_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_field_decisions (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL,
  deciding_user_id      INTEGER,
  decision_type         TEXT NOT NULL,
  prior_value           JSONB,
  final_value           JSONB,
  correction_category   TEXT,
  context_source        TEXT NOT NULL DEFAULT 'manual_edit',
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: AI prompt versions (#229)
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id               SERIAL PRIMARY KEY,
  template_id      TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  hash             TEXT NOT NULL,
  schema_version   INTEGER NOT NULL DEFAULT 1,
  effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until  TIMESTAMPTZ,
  release_notes    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: Ingestion framework (#230)
CREATE TABLE IF NOT EXISTS ingestion_sources (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  adapter_type            TEXT NOT NULL,
  adapter_config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_schema_version   INTEGER NOT NULL DEFAULT 1,
  module                  TEXT NOT NULL,
  feature                 TEXT,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  owner_notes             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id               SERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL,
  job_id           INTEGER,
  triggered_by     INTEGER,
  trigger_type     TEXT NOT NULL DEFAULT 'manual',
  status           TEXT NOT NULL DEFAULT 'pending',
  items_fetched    INTEGER NOT NULL DEFAULT 0,
  items_matched    INTEGER NOT NULL DEFAULT 0,
  items_merged     INTEGER NOT NULL DEFAULT 0,
  items_rejected   INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_candidates (
  id                SERIAL PRIMARY KEY,
  run_id            INTEGER NOT NULL,
  source_id         INTEGER NOT NULL,
  source_key        TEXT NOT NULL,
  target_type       TEXT,
  target_id         INTEGER,
  normalized_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score  NUMERIC(5,4),
  status            TEXT NOT NULL DEFAULT 'pending',
  matched_at        TIMESTAMPTZ,
  merged_at         TIMESTAMPTZ,
  rejected_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: Document evidence (#232)
CREATE TABLE IF NOT EXISTS travels_document_pages (
  id                   SERIAL PRIMARY KEY,
  trip_document_id     INTEGER NOT NULL,
  page_index           INTEGER NOT NULL,
  media_type           TEXT NOT NULL DEFAULT 'application/pdf',
  width_px             INTEGER,
  height_px            INTEGER,
  extracted_text       TEXT,
  ocr_engine           TEXT,
  ocr_engine_version   TEXT,
  extraction_status    TEXT NOT NULL DEFAULT 'pending',
  extraction_warnings  TEXT,
  content_hash         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_document_field_evidence (
  id                   SERIAL PRIMARY KEY,
  candidate_id         INTEGER NOT NULL,
  document_page_id     INTEGER,
  evidence_kind        TEXT NOT NULL,
  text_start           INTEGER,
  text_end             INTEGER,
  bbox                 JSONB,
  snippet              TEXT,
  ocr_confidence       NUMERIC(5,4),
  evidence_hash        TEXT,
  source_timestamp     TIMESTAMPTZ,
  effective_timestamp  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS travels_field_conflicts (
  id                        SERIAL PRIMARY KEY,
  trip_id                   INTEGER NOT NULL,
  field_path                TEXT NOT NULL,
  accepted_candidate_id     INTEGER,
  accepted_value            JSONB,
  competing_candidate_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflict_type             TEXT NOT NULL,
  recommended_candidate_id  INTEGER,
  recommended_rationale     TEXT,
  status                    TEXT NOT NULL DEFAULT 'open',
  deciding_user_id          INTEGER,
  decided_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: Search feedback (#233)
CREATE TABLE IF NOT EXISTS search_feedback (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER,
  module       TEXT NOT NULL,
  item_a_type  TEXT NOT NULL,
  item_a_id    INTEGER NOT NULL,
  item_b_type  TEXT NOT NULL,
  item_b_id    INTEGER NOT NULL,
  verdict      TEXT NOT NULL,
  weight       NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2: Similarity evaluations (#233)
CREATE TABLE IF NOT EXISTS similarity_evaluations (
  id                        SERIAL PRIMARY KEY,
  module                    TEXT NOT NULL,
  workflow                  TEXT NOT NULL,
  query_artifact_type       TEXT NOT NULL,
  query_artifact_id         INTEGER,
  candidate_target_type     TEXT NOT NULL,
  candidate_target_id       INTEGER NOT NULL,
  search_config_version     TEXT,
  text_embedding_model      TEXT,
  text_cosine_score         NUMERIC(5,4),
  text_rank                 INTEGER,
  visual_embedding_model    TEXT,
  visual_cosine_score       NUMERIC(5,4),
  visual_rank               INTEGER,
  zone_cosine_score         NUMERIC(5,4),
  zone_rank                 INTEGER,
  rrf_score                 NUMERIC(8,6),
  reranker_model            TEXT,
  reranker_score            NUMERIC(7,4),
  reranker_rank             INTEGER,
  user_verdict              TEXT,
  user_id                   INTEGER,
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 3: Market intelligence (#234)
CREATE TABLE IF NOT EXISTS market_observations (
  id                     SERIAL PRIMARY KEY,
  module                 TEXT NOT NULL,
  item_type              TEXT NOT NULL,
  item_id                INTEGER,
  ingestion_candidate_id INTEGER,
  platform               TEXT NOT NULL,
  listing_url            TEXT,
  listing_title          TEXT,
  observed_price         NUMERIC(12,2),
  currency               TEXT NOT NULL DEFAULT 'USD',
  condition              TEXT,
  listing_status         TEXT NOT NULL DEFAULT 'active',
  listed_at              TIMESTAMPTZ,
  sold_at                TIMESTAMPTZ,
  source_json            JSONB,
  confidence_score       NUMERIC(4,3),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_valuations (
  id                SERIAL PRIMARY KEY,
  module            TEXT NOT NULL,
  item_type         TEXT NOT NULL,
  item_id           INTEGER,
  valuation_method  TEXT NOT NULL DEFAULT 'median',
  estimated_value   NUMERIC(12,2) NOT NULL,
  value_low         NUMERIC(12,2),
  value_high        NUMERIC(12,2),
  currency          TEXT NOT NULL DEFAULT 'USD',
  sample_size       INTEGER,
  observation_ids   JSONB,
  valid_until       TIMESTAMPTZ,
  notes             TEXT,
  created_by        INTEGER,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_watches (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER,
  module                TEXT NOT NULL,
  item_type             TEXT,
  item_id               INTEGER,
  search_query          TEXT,
  platforms             JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  alert_threshold_low   NUMERIC(12,2),
  alert_threshold_high  NUMERIC(12,2),
  alert_currency        TEXT NOT NULL DEFAULT 'USD',
  last_run_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_events (
  id             SERIAL PRIMARY KEY,
  event_type     TEXT NOT NULL,
  module         TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'informational',
  scope          TEXT NOT NULL DEFAULT 'household',
  subject_type   TEXT,
  subject_id     INTEGER,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL,
  action_url     TEXT,
  action_label   TEXT,
  payload        JSONB,
  dedup_key      TEXT UNIQUE,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  superseded_by  INTEGER,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id               SERIAL PRIMARY KEY,
  event_id         INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL,
  read_at          TIMESTAMPTZ,
  acknowledged_at  TIMESTAMPTZ,
  dismissed_at     TIMESTAMPTZ,
  snoozed_until    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  SERIAL PRIMARY KEY,
  recipient_id        INTEGER NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
  event_id            INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  scheduled_at        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_class       TEXT,
  provider_message_id TEXT,
  idempotency_key     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL,
  scope                 TEXT NOT NULL DEFAULT 'global',
  scope_value           TEXT,
  channel_in_app        BOOLEAN NOT NULL DEFAULT true,
  channel_email         BOOLEAN NOT NULL DEFAULT false,
  channel_sms           BOOLEAN NOT NULL DEFAULT false,
  channel_push          BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_enabled   BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_timezone  TEXT NOT NULL DEFAULT 'America/New_York',
  quiet_hours_start     TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end       TEXT NOT NULL DEFAULT '08:00',
  critical_override     BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornament_series (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  brand                 TEXT NOT NULL DEFAULT 'Hallmark',
  description           TEXT,
  start_year            INTEGER,
  end_year              INTEGER,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  total_known_entries   INTEGER,
  source_url            TEXT,
  source_authority      TEXT,
  is_provisional        BOOLEAN NOT NULL DEFAULT false,
  last_confirmed_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornament_series_entries (
  id                    SERIAL PRIMARY KEY,
  series_id             INTEGER NOT NULL REFERENCES ornament_series(id) ON DELETE CASCADE,
  sequence_number       INTEGER,
  year                  INTEGER NOT NULL,
  official_name         TEXT NOT NULL,
  catalog_number        TEXT,
  upc                   TEXT,
  artist                TEXT,
  retail_price_usd      NUMERIC(10,2),
  release_type          TEXT,
  is_exclusive          BOOLEAN NOT NULL DEFAULT false,
  notes                 TEXT,
  source_url            TEXT,
  is_provisional        BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ornament_item_series_links (
  item_id               INTEGER NOT NULL,
  series_entry_id       INTEGER NOT NULL REFERENCES ornament_series_entries(id) ON DELETE RESTRICT,
  confirmed_by_user_id  INTEGER,
  confirmed_at          TIMESTAMPTZ,
  confidence            TEXT NOT NULL DEFAULT 'manual',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id)
);

CREATE TABLE IF NOT EXISTS ornament_identity_research (
  id                        SERIAL PRIMARY KEY,
  item_id                   INTEGER NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending',
  candidates                JSONB NOT NULL DEFAULT '[]',
  selected_candidate_index  INTEGER,
  decided_by_user_id        INTEGER,
  decided_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_fabric_identifiers (
  id                    SERIAL PRIMARY KEY,
  fabric_id             INTEGER NOT NULL,
  identifier_type       TEXT NOT NULL,
  identifier_value      TEXT NOT NULL,
  source_url            TEXT,
  confirmed_by_user_id  INTEGER,
  confirmed_at          TIMESTAMPTZ,
  confidence            TEXT NOT NULL DEFAULT 'manual',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_pattern_variants (
  id                    SERIAL PRIMARY KEY,
  pattern_id            INTEGER NOT NULL,
  name                  TEXT NOT NULL,
  finished_width        REAL,
  finished_height       REAL,
  size_unit             TEXT NOT NULL DEFAULT 'inches',
  block_count           INTEGER,
  skill_level           TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_pattern_requirements (
  id                        SERIAL PRIMARY KEY,
  variant_id                INTEGER NOT NULL REFERENCES quilting_pattern_variants(id) ON DELETE CASCADE,
  role                      TEXT NOT NULL,
  color_description         TEXT,
  quantity_yards            REAL,
  quantity_fat_quarters     REAL,
  width_assumption_inches   REAL DEFAULT 44,
  seam_allowance_inches     REAL DEFAULT 0.25,
  notes                     TEXT,
  is_extracted              BOOLEAN NOT NULL DEFAULT false,
  extraction_confidence     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_analyses (
  id                    SERIAL PRIMARY KEY,
  pattern_id            INTEGER NOT NULL,
  variant_id            INTEGER,
  created_by_user_id    INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending',
  readiness             TEXT,
  stash_snapshot_at     TIMESTAMPTZ,
  assumptions           JSONB NOT NULL DEFAULT '{}',
  requirement_rows      JSONB NOT NULL DEFAULT '[]',
  shopping_proposal     JSONB NOT NULL DEFAULT '[]',
  applied_at            TIMESTAMPTZ,
  applied_by_user_id    INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quilting_fabric_identity_research (
  id                        SERIAL PRIMARY KEY,
  fabric_id                 INTEGER NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending',
  candidates                JSONB NOT NULL DEFAULT '[]',
  selected_candidate_index  INTEGER,
  decided_by_user_id        INTEGER,
  decided_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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

  summary["pottery_watchlist_items"] = await copyTable(source, dest, {
    table: "pottery_watchlist_items",
    columns: [
      "id",
      "created_by_user_id",
      "title",
      "keywords",
      "price_min_usd",
      "price_max_usd",
      "active",
      "last_checked_at",
      "last_alert_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_watchlist_items", "id");

  summary["pottery_watchlist_alerts"] = await copyTable(source, dest, {
    table: "pottery_watchlist_alerts",
    columns: [
      "id",
      "watchlist_item_id",
      "platform",
      "listing_id",
      "title",
      "price_usd",
      "condition",
      "image_url",
      "listing_url",
      "sold_at",
      "seen_at",
      "dismissed",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "pottery_watchlist_alerts", "id");

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

  summary["ornament_series"] = await copyTable(source, dest, {
    table: "ornament_series",
    columns: [
      "id",
      "name",
      "brand",
      "description",
      "start_year",
      "end_year",
      "is_active",
      "total_known_entries",
      "source_url",
      "source_authority",
      "is_provisional",
      "last_confirmed_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornament_series", "id");

  summary["ornament_series_entries"] = await copyTable(source, dest, {
    table: "ornament_series_entries",
    columns: [
      "id",
      "series_id",
      "sequence_number",
      "year",
      "official_name",
      "catalog_number",
      "upc",
      "artist",
      "retail_price_usd",
      "release_type",
      "is_exclusive",
      "notes",
      "source_url",
      "is_provisional",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornament_series_entries", "id");

  summary["ornament_item_series_links"] = await copyTable(source, dest, {
    table: "ornament_item_series_links",
    columns: [
      "item_id",
      "series_entry_id",
      "confirmed_by_user_id",
      "confirmed_at",
      "confidence",
      "created_at",
    ],
    orderBy: "item_id",
  });

  summary["ornament_identity_research"] = await copyTable(source, dest, {
    table: "ornament_identity_research",
    columns: [
      "id",
      "item_id",
      "status",
      "candidates",
      "selected_candidate_index",
      "decided_by_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ornament_identity_research", "id");

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

  summary["quilting_fabric_identifiers"] = await copyTable(source, dest, {
    table: "quilting_fabric_identifiers",
    columns: [
      "id",
      "fabric_id",
      "identifier_type",
      "identifier_value",
      "source_url",
      "confirmed_by_user_id",
      "confirmed_at",
      "confidence",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_fabric_identifiers", "id");

  summary["quilting_pattern_variants"] = await copyTable(source, dest, {
    table: "quilting_pattern_variants",
    columns: [
      "id",
      "pattern_id",
      "name",
      "finished_width",
      "finished_height",
      "size_unit",
      "block_count",
      "skill_level",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_pattern_variants", "id");

  summary["quilting_pattern_requirements"] = await copyTable(source, dest, {
    table: "quilting_pattern_requirements",
    columns: [
      "id",
      "variant_id",
      "role",
      "color_description",
      "quantity_yards",
      "quantity_fat_quarters",
      "width_assumption_inches",
      "seam_allowance_inches",
      "notes",
      "is_extracted",
      "extraction_confidence",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "quilting_pattern_requirements", "id");

  summary["quilting_analyses"] = await copyTable(source, dest, {
    table: "quilting_analyses",
    columns: [
      "id",
      "pattern_id",
      "variant_id",
      "created_by_user_id",
      "status",
      "readiness",
      "stash_snapshot_at",
      "assumptions",
      "requirement_rows",
      "shopping_proposal",
      "applied_at",
      "applied_by_user_id",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["assumptions", "requirement_rows", "shopping_proposal"],
  });
  await resetSequence(dest, "quilting_analyses", "id");

  summary["quilting_fabric_identity_research"] = await copyTable(source, dest, {
    table: "quilting_fabric_identity_research",
    columns: [
      "id",
      "fabric_id",
      "status",
      "candidates",
      "selected_candidate_index",
      "decided_by_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["candidates"],
  });
  await resetSequence(dest, "quilting_fabric_identity_research", "id");

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

  // ── Disruption monitoring ──────────────────────────────────────────────────
  summary["travels_reservations"] = await copyTable(source, dest, {
    table: "travels_reservations",
    columns: [
      "id",
      "trip_id",
      "document_id",
      "reservation_type",
      "status",
      "provider_name",
      "confirmation_ref",
      "passenger_names",
      "segments",
      "check_in_date",
      "check_out_date",
      "destination_iata",
      "origin_iata",
      "raw_extracted",
      "monitoring_enabled",
      "monitoring_policy",
      "last_baseline_at",
      "last_checked_at",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["passenger_names", "segments", "raw_extracted"],
  });
  await resetSequence(dest, "travels_reservations", "id");

  summary["travel_monitoring_baselines"] = await copyTable(source, dest, {
    table: "travel_monitoring_baselines",
    columns: [
      "id",
      "reservation_id",
      "normalized_data",
      "schema_version",
      "content_hash",
      "confirmed_by",
      "confirmed_by_user_id",
      "source_refs",
      "effective_at",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["normalized_data", "source_refs"],
  });
  await resetSequence(dest, "travel_monitoring_baselines", "id");

  summary["travel_monitoring_observations"] = await copyTable(source, dest, {
    table: "travel_monitoring_observations",
    columns: [
      "id",
      "reservation_id",
      "provider",
      "external_record_id",
      "observed_data",
      "observed_at",
      "content_hash",
      "authority",
      "raw_snapshot",
      "job_id",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["observed_data", "raw_snapshot"],
  });
  await resetSequence(dest, "travel_monitoring_observations", "id");

  summary["travel_change_events"] = await copyTable(source, dest, {
    table: "travel_change_events",
    columns: [
      "id",
      "reservation_id",
      "baseline_id",
      "previous_observation_id",
      "new_observation_id",
      "change_type",
      "severity",
      "field_diffs",
      "materiality_reason",
      "downstream_impacts",
      "state",
      "decided_by_user_id",
      "decided_at",
      "decision_notes",
      "notification_event_id",
      "dedup_key",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["field_diffs", "downstream_impacts"],
  });
  await resetSequence(dest, "travel_change_events", "id");

  summary["travels_monitoring_preferences"] = await copyTable(source, dest, {
    table: "travels_monitoring_preferences",
    columns: [
      "id",
      "user_id",
      "monitoring_enabled",
      "weather_alerts",
      "check_in_reminders",
      "document_reminders",
      "min_severity",
      "notify_channels",
      "schedule_change_threshold_minutes",
      "updated_at",
    ],
    orderBy: "id",
    jsonbColumns: ["notify_channels"],
  });
  await resetSequence(dest, "travels_monitoring_preferences", "id");

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

  // ── Phase 2: Operations ───────────────────────────────────────────────────
  summary["app_schema_migrations"] = await copyTable(source, dest, {
    table: "app_schema_migrations",
    columns: [
      "version",
      "name",
      "checksum_sha256",
      "applied_at",
      "applied_by",
      "execution_ms",
      "app_commit_sha",
    ],
    orderBy: "version",
  });

  summary["app_jobs"] = await copyTable(source, dest, {
    table: "app_jobs",
    columns: [
      "id",
      "type",
      "queue",
      "status",
      "priority",
      "payload",
      "payload_schema_version",
      "idempotency_key",
      "created_by_user_id",
      "domain",
      "scheduled_for",
      "attempt_count",
      "max_attempts",
      "lease_owner",
      "lease_expires_at",
      "started_at",
      "completed_at",
      "progress_percent",
      "progress_message",
      "last_error_code",
      "last_error_message",
      "provider_request_id",
      "parent_job_id",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_jobs", "id");

  summary["app_job_attempts"] = await copyTable(source, dest, {
    table: "app_job_attempts",
    columns: [
      "id",
      "job_id",
      "attempt_number",
      "status",
      "started_at",
      "completed_at",
      "error_code",
      "error_message",
      "metadata",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "app_job_attempts", "id");

  summary["external_operation_events"] = await copyTable(source, dest, {
    table: "external_operation_events",
    columns: [
      "id",
      "provider",
      "operation",
      "model_or_actor",
      "feature",
      "module",
      "user_id",
      "request_id",
      "job_id",
      "parent_job_id",
      "status",
      "error_code",
      "started_at",
      "completed_at",
      "duration_ms",
      "attempt_number",
      "retry_count",
      "cache_status",
      "input_units",
      "output_units",
      "billed_units",
      "estimated_cost_usd",
      "actual_cost_usd",
      "currency",
      "pricing_version_at",
      "provider_request_id",
      "metadata",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_operation_events", "id");

  summary["external_provider_pricing"] = await copyTable(source, dest, {
    table: "external_provider_pricing",
    columns: [
      "id",
      "provider",
      "operation",
      "model_or_actor",
      "unit_type",
      "price_usd",
      "effective_from",
      "effective_to",
      "source",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_provider_pricing", "id");

  summary["external_budget_policies"] = await copyTable(source, dest, {
    table: "external_budget_policies",
    columns: [
      "id",
      "scope",
      "scope_value",
      "period",
      "soft_threshold_usd",
      "hard_threshold_usd",
      "warning_policy",
      "degradation_action",
      "enabled",
      "override_until",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "external_budget_policies", "id");

  // ── Phase 2: AI provenance ────────────────────────────────────────────────
  summary["ai_generation_runs"] = await copyTable(source, dest, {
    table: "ai_generation_runs",
    columns: [
      "id",
      "module",
      "feature",
      "target_type",
      "target_id",
      "job_id",
      "operation_event_id",
      "user_id",
      "provider",
      "model",
      "model_provider_run_id",
      "prompt_template_id",
      "prompt_version_hash",
      "tool_schema_version",
      "input_artifact_hashes",
      "status",
      "error_code",
      "error_message",
      "started_at",
      "completed_at",
      "duration_ms",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_generation_runs", "id");

  summary["ai_field_candidates"] = await copyTable(source, dest, {
    table: "ai_field_candidates",
    columns: [
      "id",
      "generation_run_id",
      "target_type",
      "target_id",
      "field_path",
      "candidate_value",
      "normalized_value_hash",
      "confidence_score",
      "confidence_method",
      "authority_class",
      "source_references",
      "disposition",
      "applied_at",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_field_candidates", "id");

  summary["ai_field_decisions"] = await copyTable(source, dest, {
    table: "ai_field_decisions",
    columns: [
      "id",
      "candidate_id",
      "deciding_user_id",
      "decision_type",
      "prior_value",
      "final_value",
      "correction_category",
      "context_source",
      "decided_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_field_decisions", "id");

  summary["ai_prompt_versions"] = await copyTable(source, dest, {
    table: "ai_prompt_versions",
    columns: [
      "id",
      "template_id",
      "version",
      "hash",
      "schema_version",
      "effective_from",
      "effective_until",
      "release_notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ai_prompt_versions", "id");

  // ── Phase 2: Ingestion ────────────────────────────────────────────────────
  summary["ingestion_sources"] = await copyTable(source, dest, {
    table: "ingestion_sources",
    columns: [
      "id",
      "name",
      "slug",
      "adapter_type",
      "adapter_config",
      "config_schema_version",
      "module",
      "feature",
      "enabled",
      "owner_notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_sources", "id");

  summary["ingestion_runs"] = await copyTable(source, dest, {
    table: "ingestion_runs",
    columns: [
      "id",
      "source_id",
      "job_id",
      "triggered_by",
      "trigger_type",
      "status",
      "items_fetched",
      "items_matched",
      "items_merged",
      "items_rejected",
      "error_code",
      "error_message",
      "started_at",
      "completed_at",
      "metadata",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_runs", "id");

  summary["ingestion_candidates"] = await copyTable(source, dest, {
    table: "ingestion_candidates",
    columns: [
      "id",
      "run_id",
      "source_id",
      "source_key",
      "target_type",
      "target_id",
      "normalized_data",
      "confidence_score",
      "status",
      "matched_at",
      "merged_at",
      "rejected_reason",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "ingestion_candidates", "id");

  // ── Phase 2: Search feedback ──────────────────────────────────────────────
  summary["search_feedback"] = await copyTable(source, dest, {
    table: "search_feedback",
    columns: [
      "id",
      "user_id",
      "module",
      "item_a_type",
      "item_a_id",
      "item_b_type",
      "item_b_id",
      "verdict",
      "weight",
      "notes",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "search_feedback", "id");

  // ── Phase 2: Document evidence ────────────────────────────────────────────
  summary["travels_document_pages"] = await copyTable(source, dest, {
    table: "travels_document_pages",
    columns: [
      "id",
      "trip_document_id",
      "page_index",
      "media_type",
      "width_px",
      "height_px",
      "extracted_text",
      "ocr_engine",
      "ocr_engine_version",
      "extraction_status",
      "extraction_warnings",
      "content_hash",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_document_pages", "id");

  summary["travels_document_field_evidence"] = await copyTable(source, dest, {
    table: "travels_document_field_evidence",
    columns: [
      "id",
      "candidate_id",
      "document_page_id",
      "evidence_kind",
      "text_start",
      "text_end",
      "bbox",
      "snippet",
      "ocr_confidence",
      "evidence_hash",
      "source_timestamp",
      "effective_timestamp",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_document_field_evidence", "id");

  summary["travels_field_conflicts"] = await copyTable(source, dest, {
    table: "travels_field_conflicts",
    columns: [
      "id",
      "trip_id",
      "field_path",
      "accepted_candidate_id",
      "accepted_value",
      "competing_candidate_ids",
      "conflict_type",
      "recommended_candidate_id",
      "recommended_rationale",
      "status",
      "deciding_user_id",
      "decided_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "travels_field_conflicts", "id");

  // ── Phase 2: Similarity evaluations (#233) ────────────────────────────────
  summary["similarity_evaluations"] = await copyTable(source, dest, {
    table: "similarity_evaluations",
    columns: [
      "id",
      "module",
      "workflow",
      "query_artifact_type",
      "query_artifact_id",
      "candidate_target_type",
      "candidate_target_id",
      "search_config_version",
      "text_embedding_model",
      "text_cosine_score",
      "text_rank",
      "visual_embedding_model",
      "visual_cosine_score",
      "visual_rank",
      "zone_cosine_score",
      "zone_rank",
      "rrf_score",
      "reranker_model",
      "reranker_score",
      "reranker_rank",
      "user_verdict",
      "user_id",
      "recorded_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "similarity_evaluations", "id");

  // ── Phase 3: Market intelligence (#234) ──────────────────────────────────
  summary["market_observations"] = await copyTable(source, dest, {
    table: "market_observations",
    columns: [
      "id",
      "module",
      "item_type",
      "item_id",
      "ingestion_candidate_id",
      "platform",
      "listing_url",
      "listing_title",
      "observed_price",
      "currency",
      "condition",
      "listing_status",
      "listed_at",
      "sold_at",
      "source_json",
      "confidence_score",
      "notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_observations", "id");

  summary["market_valuations"] = await copyTable(source, dest, {
    table: "market_valuations",
    columns: [
      "id",
      "module",
      "item_type",
      "item_id",
      "valuation_method",
      "estimated_value",
      "value_low",
      "value_high",
      "currency",
      "sample_size",
      "observation_ids",
      "valid_until",
      "notes",
      "created_by",
      "computed_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_valuations", "id");

  summary["market_watches"] = await copyTable(source, dest, {
    table: "market_watches",
    columns: [
      "id",
      "user_id",
      "module",
      "item_type",
      "item_id",
      "search_query",
      "platforms",
      "enabled",
      "alert_threshold_low",
      "alert_threshold_high",
      "alert_currency",
      "last_run_at",
      "notes",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "market_watches", "id");

  // ── Notifications ─────────────────────────────────────────────────────────
  summary["notification_events"] = await copyTable(source, dest, {
    table: "notification_events",
    columns: [
      "id",
      "event_type",
      "module",
      "severity",
      "scope",
      "subject_type",
      "subject_id",
      "title",
      "summary",
      "action_url",
      "action_label",
      "payload",
      "dedup_key",
      "last_seen_at",
      "expires_at",
      "superseded_by",
      "occurred_at",
      "created_by",
      "created_at",
    ],
    orderBy: "id",
    jsonbColumns: ["payload"],
  });
  await resetSequence(dest, "notification_events", "id");

  summary["notification_recipients"] = await copyTable(source, dest, {
    table: "notification_recipients",
    columns: [
      "id",
      "event_id",
      "user_id",
      "read_at",
      "acknowledged_at",
      "dismissed_at",
      "snoozed_until",
      "created_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_recipients", "id");

  summary["notification_deliveries"] = await copyTable(source, dest, {
    table: "notification_deliveries",
    columns: [
      "id",
      "recipient_id",
      "event_id",
      "channel",
      "status",
      "attempt_count",
      "scheduled_at",
      "sent_at",
      "delivered_at",
      "failed_at",
      "failure_class",
      "provider_message_id",
      "idempotency_key",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_deliveries", "id");

  summary["notification_preferences"] = await copyTable(source, dest, {
    table: "notification_preferences",
    columns: [
      "id",
      "user_id",
      "scope",
      "scope_value",
      "channel_in_app",
      "channel_email",
      "channel_sms",
      "channel_push",
      "quiet_hours_enabled",
      "quiet_hours_timezone",
      "quiet_hours_start",
      "quiet_hours_end",
      "critical_override",
      "created_at",
      "updated_at",
    ],
    orderBy: "id",
  });
  await resetSequence(dest, "notification_preferences", "id");

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
