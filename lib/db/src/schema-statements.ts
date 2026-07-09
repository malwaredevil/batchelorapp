/**
 * SINGLE SOURCE OF DDL TRUTH for the merged Batchelor monorepo (pottery +
 * quilting). Consumed by BOTH `bootstrap.ts` (the CLI bootstrap, run via
 * `pnpm --filter @workspace/db run bootstrap` and in post-merge.sh) AND the
 * api-server startup self-healing migration. Keeping one list prevents a
 * split-brain where one entrypoint creates only a subset of tables.
 *
 * SAFE replacement for `drizzle-kit push --force`. The Supabase DB is SHARED by
 * both apps and `app_users` / `password_reset_tokens` are shared between them.
 * `drizzle-kit push --force` introspects EVERY table and auto-confirms
 * destructive DDL, so on this shared DB it tries to DROP the other app's tables
 * and wipes data on every publish. `tablesFilter` does not reliably stop this —
 * so force push is permanently banned. These statements are all additive and
 * idempotent: `CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN
 * IF NOT EXISTS`, and `ENABLE ROW LEVEL SECURITY`. They NEVER drop or alter
 * existing tables, columns, or data.
 *
 * Keep these statements in sync with the drizzle schema — ADDITIVE changes only.
 */
export const STATEMENTS: string[] = [
  // ── Extensions ─────────────────────────────────────────────────────────────
  `CREATE EXTENSION IF NOT EXISTS vector`,

  // ── Shared user accounts (used by BOTH apps — never drop this table) ────────
  `CREATE TABLE IF NOT EXISTS app_users (
    id serial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE app_users ENABLE ROW LEVEL SECURITY`,
  // Account settings (shared across both apps): per-user display name + theme.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name text`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS theme_preference text`,
  // Per-user hub dashboard widget configuration (JSON array of widget IDs in order).
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS hub_widget_ids text`,
  // Per-user weather widget location config (JSON: { city, country, lat, lon, unit }).
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS hub_weather_config text`,

  // ── Shared password reset tokens (superset of both apps' definitions) ──────
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used boolean NOT NULL DEFAULT false,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
     ON password_reset_tokens (user_id)`,
  // Additive back-fills (each app historically created a partial version):
  `ALTER TABLE password_reset_tokens
     ADD COLUMN IF NOT EXISTS used boolean NOT NULL DEFAULT false`,
  `ALTER TABLE password_reset_tokens
     ADD COLUMN IF NOT EXISTS used_at timestamptz`,

  // ── Session stores (owned by connect-pg-simple, never altered by drizzle) ──
  `CREATE TABLE IF NOT EXISTS pottery_sessions (
    sid varchar NOT NULL COLLATE "default",
    sess json NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT pottery_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
  ) WITH (OIDS=FALSE)`,
  `CREATE INDEX IF NOT EXISTS pottery_sessions_expire_idx
     ON pottery_sessions (expire)`,
  `ALTER TABLE pottery_sessions ENABLE ROW LEVEL SECURITY`,
  `CREATE TABLE IF NOT EXISTS quilting_sessions (
    sid    VARCHAR   NOT NULL COLLATE "default",
    sess   JSON      NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT quilting_session_pkey PRIMARY KEY (sid)
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_quilting_session_expire ON quilting_sessions (expire)`,
  `ALTER TABLE quilting_sessions ENABLE ROW LEVEL SECURITY`,

  // Shared, cross-instance rate limiting counters. Backs express-rate-limit's
  // Store interface so limits are enforced across the whole autoscaled
  // deployment instead of per-process. `key` is `${limiterName}:${clientKey}`.
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    points integer NOT NULL DEFAULT 0,
    reset_at timestamptz NOT NULL
  )`,
  `ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON rate_limits (reset_at)`,

  // ═══════════════════════════════════════════════════════════════════════════
  // POTTERY TABLES
  // ═══════════════════════════════════════════════════════════════════════════
  `CREATE TABLE IF NOT EXISTS pottery_items (
    id serial PRIMARY KEY,
    name text NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    notes text,
    dimensions text,
    pattern_description text,
    style text,
    shape text,
    maker text,
    maker_info text,
    dominant_colors text[] NOT NULL DEFAULT '{}'::text[],
    motifs text[] NOT NULL DEFAULT '{}'::text[],
    image_path text NOT NULL,
    pattern_crop_path text,
    acquired_at date,
    condition text,
    origin text,
    approximate_era text,
    ai_description text,
    locked_fields text[] NOT NULL DEFAULT '{}'::text[],
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pottery_categories (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    bg_color text,
    text_color text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pottery_item_categories (
    item_id integer NOT NULL REFERENCES pottery_items(id) ON DELETE CASCADE,
    category_id integer NOT NULL REFERENCES pottery_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, category_id)
  )`,
  `CREATE TABLE IF NOT EXISTS pottery_images (
    id serial PRIMARY KEY,
    item_id integer NOT NULL REFERENCES pottery_items(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    label text,
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS pottery_embedding_idx
     ON pottery_items USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS item_categories_category_id_idx
     ON pottery_item_categories (category_id)`,
  `CREATE INDEX IF NOT EXISTS pottery_images_item_idx
     ON pottery_images (item_id)`,
  `ALTER TABLE pottery_items ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE pottery_categories ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE pottery_item_categories ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE pottery_images ENABLE ROW LEVEL SECURITY`,

  // ═══════════════════════════════════════════════════════════════════════════
  // QUILTING TABLES
  // ═══════════════════════════════════════════════════════════════════════════
  `CREATE TABLE IF NOT EXISTS quilting_categories (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    bg_color   TEXT,
    text_color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_categories ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS quilting_fabrics (
    id                SERIAL PRIMARY KEY,
    name              TEXT NOT NULL,
    line_name         TEXT,
    designer          TEXT,
    manufacturer      TEXT,
    colorway          TEXT,
    print_type        TEXT,
    fiber_content     TEXT,
    width_inches      REAL,
    quantity          REAL NOT NULL DEFAULT 1,
    quantity_unit     TEXT NOT NULL DEFAULT 'yards',
    sku               TEXT,
    notes             TEXT,
    ai_description    TEXT,
    dominant_colors   TEXT[] NOT NULL DEFAULT '{}',
    motifs            TEXT[] NOT NULL DEFAULT '{}',
    style_descriptors TEXT[] NOT NULL DEFAULT '{}',
    image_path        TEXT NOT NULL,
    acquired_at       DATE,
    locked_fields     TEXT[] NOT NULL DEFAULT '{}',
    embedding         vector(1536),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_fabrics ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_fabrics_embedding_idx
     ON quilting_fabrics USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS quilting_patterns (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    designer         TEXT,
    block_size       TEXT,
    difficulty       TEXT,
    source_type      TEXT,
    source_reference TEXT,
    notes            TEXT,
    image_path       TEXT,
    acquired_at      DATE,
    dominant_colors  TEXT[] NOT NULL DEFAULT '{}',
    locked_fields    TEXT[] NOT NULL DEFAULT '{}',
    embedding        vector(1536),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_patterns ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS dominant_colors TEXT[] NOT NULL DEFAULT '{}'`,
  `CREATE INDEX IF NOT EXISTS quilting_patterns_embedding_idx
     ON quilting_patterns USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS quilting_finished_quilts (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    date_completed DATE,
    size_width     REAL,
    size_height    REAL,
    recipient      TEXT,
    notes          TEXT,
    image_path     TEXT NOT NULL,
    dominant_colors TEXT[] NOT NULL DEFAULT '{}',
    locked_fields  TEXT[] NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_finished_quilts ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_finished_quilts ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE quilting_finished_quilts ADD COLUMN IF NOT EXISTS dominant_colors TEXT[] NOT NULL DEFAULT '{}'`,

  `CREATE TABLE IF NOT EXISTS quilting_fabric_links (
    quilt_id  INTEGER NOT NULL REFERENCES quilting_finished_quilts(id) ON DELETE CASCADE,
    fabric_id INTEGER NOT NULL REFERENCES quilting_fabrics(id) ON DELETE CASCADE,
    notes     TEXT,
    PRIMARY KEY (quilt_id, fabric_id)
  )`,
  `ALTER TABLE quilting_fabric_links ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_fabric_links_fabric_idx
     ON quilting_fabric_links (fabric_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_pattern_links (
    quilt_id   INTEGER NOT NULL REFERENCES quilting_finished_quilts(id) ON DELETE CASCADE,
    pattern_id INTEGER NOT NULL REFERENCES quilting_patterns(id) ON DELETE CASCADE,
    PRIMARY KEY (quilt_id, pattern_id)
  )`,
  `ALTER TABLE quilting_pattern_links ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_pattern_links_pattern_idx
     ON quilting_pattern_links (pattern_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_entity_categories (
    entity_type TEXT    NOT NULL,
    entity_id   INTEGER NOT NULL,
    category_id INTEGER NOT NULL REFERENCES quilting_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_type, entity_id, category_id)
  )`,
  `ALTER TABLE quilting_entity_categories ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_entity_categories_cat_idx
     ON quilting_entity_categories (category_id)`,
  `CREATE INDEX IF NOT EXISTS quilting_entity_categories_entity_idx
     ON quilting_entity_categories (entity_type, entity_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_images (
    id           SERIAL PRIMARY KEY,
    entity_type  TEXT    NOT NULL,
    entity_id    INTEGER NOT NULL,
    storage_path TEXT    NOT NULL,
    label        TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_images ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_images_entity_idx
     ON quilting_images (entity_type, entity_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_blocks (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    grid_size             INTEGER NOT NULL DEFAULT 8,
    cells                 TEXT[] NOT NULL DEFAULT '{}',
    block_size_inches     REAL,
    seam_allowance_inches REAL,
    seams                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_blocks ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_blocks ADD COLUMN IF NOT EXISTS block_size_inches REAL`,
  `ALTER TABLE quilting_blocks ADD COLUMN IF NOT EXISTS seam_allowance_inches REAL`,
  `ALTER TABLE quilting_blocks ADD COLUMN IF NOT EXISTS seams JSONB NOT NULL DEFAULT '[]'::jsonb`,

  `CREATE TABLE IF NOT EXISTS quilting_layouts (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    rows                 INTEGER NOT NULL DEFAULT 5,
    cols                 INTEGER NOT NULL DEFAULT 5,
    cells                JSONB NOT NULL DEFAULT '[]'::jsonb,
    sashing_width_inches REAL,
    sashing_color        TEXT,
    border_width_inches  REAL,
    border_color         TEXT,
    cornerstone_color    TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_layouts ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS sashing_width_inches REAL`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS sashing_color TEXT`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS border_width_inches REAL`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS border_color TEXT`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS cornerstone_color TEXT`,

  `CREATE TABLE IF NOT EXISTS quilting_shopping_items (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    notes               TEXT,
    url                 TEXT,
    quantity            REAL,
    unit                TEXT DEFAULT 'yards',
    estimated_price_usd REAL,
    actual_price_usd    REAL,
    store               TEXT,
    status              TEXT NOT NULL DEFAULT 'want',
    priority            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_shopping_items ENABLE ROW LEVEL SECURITY`,

  // ── Per-user ownership columns (tenant isolation) ───────────────────────────
  // These columns are nullable so the additive migration is safe on existing data.
  // All application queries filter by user_id; rows with user_id IS NULL are
  // legacy data that become inaccessible to any session after this migration.
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS pottery_items_user_id_idx ON pottery_items (user_id)`,
  `ALTER TABLE pottery_categories ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS pottery_categories_user_id_idx ON pottery_categories (user_id)`,
  `ALTER TABLE quilting_fabrics ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_fabrics_user_id_idx ON quilting_fabrics (user_id)`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_patterns_user_id_idx ON quilting_patterns (user_id)`,
  `ALTER TABLE quilting_finished_quilts ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_finished_quilts_user_id_idx ON quilting_finished_quilts (user_id)`,
  `ALTER TABLE quilting_finished_quilts ADD COLUMN IF NOT EXISTS completion_percentage SMALLINT NOT NULL DEFAULT 0`,
  `ALTER TABLE quilting_blocks ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_blocks_user_id_idx ON quilting_blocks (user_id)`,
  `ALTER TABLE quilting_layouts ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_layouts_user_id_idx ON quilting_layouts (user_id)`,
  `ALTER TABLE quilting_shopping_items ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_shopping_items_user_id_idx ON quilting_shopping_items (user_id)`,
  `ALTER TABLE quilting_categories ADD COLUMN IF NOT EXISTS user_id integer REFERENCES app_users(id)`,
  `CREATE INDEX IF NOT EXISTS quilting_categories_user_id_idx ON quilting_categories (user_id)`,

  // ── Visual embeddings (Jina CLIP v2, 1024-dim) ──────────────────────────────
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS visual_embedding vector(1024)`,
  `CREATE INDEX IF NOT EXISTS pottery_visual_embedding_idx
     ON pottery_items USING hnsw (visual_embedding vector_cosine_ops)`,
  `ALTER TABLE quilting_fabrics ADD COLUMN IF NOT EXISTS visual_embedding vector(1024)`,
  `CREATE INDEX IF NOT EXISTS quilting_fabrics_visual_embedding_idx
     ON quilting_fabrics USING hnsw (visual_embedding vector_cosine_ops)`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS visual_embedding vector(1024)`,
  `CREATE INDEX IF NOT EXISTS quilting_patterns_visual_embedding_idx
     ON quilting_patterns USING hnsw (visual_embedding vector_cosine_ops)`,

  // ── Pattern enrichment fields (designer bio / website / publication) ─────────
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS designer_bio TEXT`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS designer_website TEXT`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS publication_name TEXT`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS publication_year TEXT`,

  // ═══════════════════════════════════════════════════════════════════════════
  // TRAVELS TABLES
  // ═══════════════════════════════════════════════════════════════════════════
  `CREATE TABLE IF NOT EXISTS travels_sessions (
    sid    VARCHAR   NOT NULL COLLATE "default",
    sess   JSON      NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT travels_sessions_pkey PRIMARY KEY (sid)
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_travels_session_expire ON travels_sessions (expire)`,
  `ALTER TABLE travels_sessions ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS travels_trips (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL,
    title            TEXT NOT NULL,
    destination      TEXT NOT NULL,
    lat              REAL,
    lng              REAL,
    status           TEXT NOT NULL DEFAULT 'wishlist',
    start_date       DATE,
    end_date         DATE,
    transport_to     TEXT,
    has_rental_car   BOOLEAN NOT NULL DEFAULT false,
    accommodation_name TEXT,
    accommodation_area TEXT,
    notes            TEXT,
    traveller_count  INTEGER NOT NULL DEFAULT 2,
    itinerary        JSONB,
    packing_list     JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_trips ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_trips_user_id_idx ON travels_trips (user_id)`,
  `CREATE INDEX IF NOT EXISTS travels_trips_status_idx ON travels_trips (status)`,

  `CREATE TABLE IF NOT EXISTS travels_trip_documents (
    id                SERIAL PRIMARY KEY,
    trip_id           INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    storage_path      TEXT NOT NULL,
    document_type     TEXT,
    original_filename TEXT,
    extracted_data    JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_trip_documents ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_trip_documents_trip_id_idx ON travels_trip_documents (trip_id)`,
  `CREATE INDEX IF NOT EXISTS travels_trip_documents_user_id_idx ON travels_trip_documents (user_id)`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS gmail_message_id TEXT`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS title TEXT`,

  // ── Travels enhancements ────────────────────────────────────────────────────
  // chat_history: per-trip AI conversation (array of {role, content} objects)
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS chat_history JSONB`,
  // travelers: named family members who went on the trip (string[])
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS travelers JSONB`,
  // the_one_thing: memorable highlights of the trip (string[])
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS the_one_thing JSONB`,
  // travels_wishlist: bucket-list destinations
  `CREATE TABLE IF NOT EXISTS travels_wishlist (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    destination TEXT NOT NULL,
    target_date DATE,
    notes       TEXT,
    done        BOOLEAN NOT NULL DEFAULT false,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_wishlist ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_wishlist_user_id_idx ON travels_wishlist (user_id)`,

  // ── Travels 2.0 enhancements ────────────────────────────────────────────────
  // fun_fact: memorable fact or story from the trip
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS fun_fact text`,
  // travels_trip_photos: multiple photos per trip stored in Supabase Storage
  `CREATE TABLE IF NOT EXISTS travels_trip_photos (
    id          SERIAL PRIMARY KEY,
    trip_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    caption     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_trip_photos ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_trip_photos_trip_id_idx ON travels_trip_photos (trip_id)`,
  `CREATE INDEX IF NOT EXISTS travels_trip_photos_user_id_idx ON travels_trip_photos (user_id)`,
  // photo_type: distinguishes regular memory photos from "magnet" photos usable as the trip icon
  `ALTER TABLE travels_trip_photos ADD COLUMN IF NOT EXISTS photo_type TEXT NOT NULL DEFAULT 'photo'`,
  // icon_photo_id: id of a travels_trip_photos row (photo_type = 'magnet') shown beside the trip title
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS icon_photo_id INTEGER`,
  // visual_embedding: Jina CLIP v2 vector, only populated for photo_type = 'magnet',
  // used to check whether a magnet is already owned before buying a duplicate.
  `ALTER TABLE travels_trip_photos ADD COLUMN IF NOT EXISTS visual_embedding vector(1024)`,
  `CREATE INDEX IF NOT EXISTS travels_trip_photos_visual_embedding_idx
     ON travels_trip_photos USING hnsw (visual_embedding vector_cosine_ops)`,
  // travels_reminders: per-trip alerts/reminders with due dates
  `CREATE TABLE IF NOT EXISTS travels_reminders (
    id          SERIAL PRIMARY KEY,
    trip_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    due_date    DATE,
    done        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_reminders ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_reminders_trip_id_idx ON travels_reminders (trip_id)`,
  `CREATE INDEX IF NOT EXISTS travels_reminders_user_id_idx ON travels_reminders (user_id)`,

  // ── Pottery AI enhancements ──────────────────────────────────────────────────
  // glaze_type: Jina CLIP zero-shot decoration/glaze classification
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS glaze_type text`,
  // surface_zones: JSON breakdown of decorative zones (rim, body, shoulder, foot)
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS surface_zones jsonb`,
  // zone_embedding: Jina CLIP embedding of the dominant body zone crop
  // (third search lane, tuned to surface pattern rather than whole-piece appearance)
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS zone_embedding vector(1024)`,
  `CREATE INDEX IF NOT EXISTS pottery_zone_embedding_idx
     ON pottery_items USING hnsw (zone_embedding vector_cosine_ops)`,

  // travels_trips.todo_list: JSON array of { item, done } objects
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS todo_list JSONB`,

  // travels_trips.transport_details: free-text carrier name / number (airline, train line, etc.)
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS transport_details TEXT`,

  // travels_wishlist lat/lng for map pins
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS lat REAL`,
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS lng REAL`,

  // ── Travels reminder email alerts ─────────────────────────────────────────
  // Per-user email address to receive trip-reminder alerts (14-day, 7-day, 3-day).
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS travels_reminder_email TEXT`,
  // Audit log so each (reminder, threshold) is emailed exactly once.
  `CREATE TABLE IF NOT EXISTS travels_reminder_alert_log (
    id          SERIAL PRIMARY KEY,
    reminder_id INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    alert_type  TEXT    NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_reminder_alert_log ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_reminder_alert_log_reminder_id_idx
     ON travels_reminder_alert_log (reminder_id)`,
  `CREATE INDEX IF NOT EXISTS travels_reminder_alert_log_user_id_idx
     ON travels_reminder_alert_log (user_id)`,

  // travels_reminders.recipient_emails: per-reminder list of email addresses to
  // alert (picked from app_users' login emails, or freeform custom addresses).
  // Replaces the old single per-user travels_reminder_email as the alert target.
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS recipient_emails TEXT[] NOT NULL DEFAULT '{}'`,

  // ── Travels Google Calendar sync ────────────────────────────────────────────
  // sync_to_calendar: whether this reminder should have a matching event on the
  // shared Travel Calendar (created via the Google Calendar integration).
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS sync_to_calendar BOOLEAN NOT NULL DEFAULT true`,
  // google_event_id: Google Calendar event id for update/delete; null if sync is
  // off, not yet attempted, or the last sync attempt failed.
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS google_event_id TEXT`,
  // description: optional rich text (TipTap HTML) notes for the reminder,
  // shown only in the detail dialog (not inline in reminder lists).
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS description TEXT`,
  // travels_calendar_settings: singleton row (id = 1) holding the household's
  // chosen shared Travel Calendar for auto-synced reminders.
  // Superseded by travels_google_calendar_connections (per-user OAuth) below;
  // left in place (unused) rather than dropped, per additive-only policy.
  `CREATE TABLE IF NOT EXISTS travels_calendar_settings (
    id               INTEGER PRIMARY KEY DEFAULT 1,
    calendar_id      TEXT,
    calendar_summary TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── Travels per-user Google Calendar connections ────────────────────────────
  // Each household member connects their own Google account (OAuth, offline
  // access) and picks which of their own calendars reminders sync to.
  `CREATE TABLE IF NOT EXISTS travels_google_calendar_connections (
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
  )`,
  `ALTER TABLE travels_google_calendar_connections ENABLE ROW LEVEL SECURITY`,

  // is_household_shared: marks this connection's calendar as the household's
  // shared Travel Calendar — every app_user can view/add/edit/delete events
  // on it via the app, proxied through this connection owner's Google token.
  // Application logic (not a DB constraint) enforces at most one shared row.
  `ALTER TABLE travels_google_calendar_connections ADD COLUMN IF NOT EXISTS is_household_shared BOOLEAN NOT NULL DEFAULT false`,

  // travels_reminder_calendar_events: one reminder can fan out into multiple
  // connected users' calendars, so this tracks the Google event id per
  // (reminder, user) pair for update/delete.
  `CREATE TABLE IF NOT EXISTS travels_reminder_calendar_events (
    id               SERIAL PRIMARY KEY,
    reminder_id      INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    google_event_id  TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_reminder_calendar_events ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_reminder_calendar_events_reminder_id_idx
     ON travels_reminder_calendar_events (reminder_id)`,
  `CREATE INDEX IF NOT EXISTS travels_reminder_calendar_events_user_id_idx
     ON travels_reminder_calendar_events (user_id)`,

  // travel_color_id: which Google Calendar event colorId (Google's fixed
  // "1".."11" palette) the household has chosen to mean "Travel". Only
  // meaningful on the connection row currently marked is_household_shared.
  `ALTER TABLE travels_google_calendar_connections ADD COLUMN IF NOT EXISTS travel_color_id TEXT`,

  // travels_trip_calendar_events: maps a trip's itinerary content to the
  // Google Calendar event(s) synced for it — one row for the trip-level
  // event plus one per itinerary activity. Keyed by a content-derived
  // item_key (not array index) so reordering/editing itinerary days or
  // activities doesn't desync the mapping; content_hash lets the
  // reconciler skip no-op updates.
  `CREATE TABLE IF NOT EXISTS travels_trip_calendar_events (
    id                SERIAL PRIMARY KEY,
    trip_id           INTEGER NOT NULL,
    item_key          TEXT NOT NULL,
    kind              TEXT NOT NULL,
    content_hash      TEXT NOT NULL,
    google_event_id   TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_trip_calendar_events ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_trip_calendar_events_trip_id_idx
     ON travels_trip_calendar_events (trip_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_trip_calendar_events_trip_id_item_key_idx
     ON travels_trip_calendar_events (trip_id, item_key)`,

  // travels_calendar_trip_suggestions: AI-detected candidate trips found by
  // scanning connected calendars for travel-looking events (flights,
  // hotels, etc) that aren't already linked to a trip. dedupe_key makes
  // repeated scans (daily scheduler + manual button) idempotent.
  `CREATE TABLE IF NOT EXISTS travels_calendar_trip_suggestions (
    id                 SERIAL PRIMARY KEY,
    suggested_title    TEXT NOT NULL,
    destination        TEXT,
    start_date         DATE,
    end_date           DATE,
    related_event_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    dedupe_key         TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_calendar_trip_suggestions ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_calendar_trip_suggestions_dedupe_key_idx
     ON travels_calendar_trip_suggestions (dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS travels_calendar_trip_suggestions_status_idx
     ON travels_calendar_trip_suggestions (status)`,

  // travels_calendar_trip_suggestions.user_id / is_from_shared_calendar:
  // user_id records which household member's personal calendar connection
  // produced the suggestion (insert attribution only). Suggestions are
  // household-shared trip data like everything else in travels — every
  // authenticated household member can view/dismiss/accept any suggestion
  // regardless of which calendar it came from.
  `ALTER TABLE travels_calendar_trip_suggestions ADD COLUMN IF NOT EXISTS user_id INTEGER`,
  `ALTER TABLE travels_calendar_trip_suggestions ADD COLUMN IF NOT EXISTS is_from_shared_calendar BOOLEAN NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS travels_calendar_trip_suggestions_user_id_idx
     ON travels_calendar_trip_suggestions (user_id)`,

  // ── Elaine assistant ───────────────────────────────────────────────────────
  // Elaine's tables (elaine_conversations, elaine_settings, elaine_memory,
  // elaine_nudges) are defined further below as a shared, non-namespaced
  // schema. The former travels_assistant_* / travels_household_memory tables
  // were migrated into those tables and explicitly dropped — see
  // scripts/src/migrate-to-elaine.ts. Do not recreate them here.

  // --- Multi-Calendar Travel Rework ---------------------------------------
  // is_owner: the single app owner (batchelorjc@gmail.com) is the only
  // account allowed to assign/reassign the shared "Travel" calendar.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false`,
  `UPDATE app_users SET is_owner = true WHERE email = 'batchelorjc@gmail.com' AND is_owner = false`,

  // travels_connected_calendars: unlimited per-user connected Google
  // calendars, each with its own chosen primary color. Exactly one row
  // system-wide may have is_travel_calendar = true (enforced in app code) —
  // that is the shared "Travel" calendar every app_user can see/edit.
  `CREATE TABLE IF NOT EXISTS travels_connected_calendars (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL,
    google_calendar_id   TEXT NOT NULL,
    summary              TEXT NOT NULL,
    source               TEXT NOT NULL DEFAULT 'picked',
    primary_color        TEXT NOT NULL DEFAULT '#4285f4',
    is_travel_calendar   BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_connected_calendars ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_connected_calendars_user_id_idx
     ON travels_connected_calendars (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_connected_calendars_user_id_google_calendar_id_idx
     ON travels_connected_calendars (user_id, google_calendar_id)`,

  // One-time (idempotent) backfill: migrate each existing single-calendar
  // connection (old travels_google_calendar_connections.calendar_id /
  // is_household_shared / travel_color_id model) into the new per-calendar
  // table, preserving the previous household/Travel assignment. Safe to
  // re-run every boot — the NOT EXISTS guard means it only inserts once per
  // (user_id, google_calendar_id).
  `INSERT INTO travels_connected_calendars
     (user_id, google_calendar_id, summary, source, primary_color, is_travel_calendar)
   SELECT c.user_id,
          c.calendar_id,
          COALESCE(c.calendar_summary, c.calendar_id),
          'picked',
          CASE WHEN c.is_household_shared THEN '#f59e0b' ELSE '#4285f4' END,
          c.is_household_shared
     FROM travels_google_calendar_connections c
    WHERE c.calendar_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM travels_connected_calendars cc
         WHERE cc.user_id = c.user_id AND cc.google_calendar_id = c.calendar_id
      )`,

  // travels_reminders.alert_days_before: configurable per-reminder alert
  // day-offsets (replaces the previously hardcoded 14/7/3-day thresholds),
  // bidirectionally synced with the reminder's Google Calendar event
  // notification overrides.
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS alert_days_before INTEGER[] NOT NULL DEFAULT '{14,7,3}'`,

  // travels_reminder_calendar_events.calendar_id: a user may now have more
  // than one connected calendar, so each synced reminder copy must record
  // which calendar it was written to (backfilled best-effort from whichever
  // calendar that user had connected at migration time).
  `ALTER TABLE travels_reminder_calendar_events ADD COLUMN IF NOT EXISTS calendar_id TEXT NOT NULL DEFAULT ''`,
  `UPDATE travels_reminder_calendar_events rce
     SET calendar_id = cc.google_calendar_id
     FROM travels_connected_calendars cc
    WHERE rce.calendar_id = ''
      AND cc.user_id = rce.user_id`,

  // --- Ornaments: shared Hallmark events calendar -------------------------
  // is_hallmark_calendar: mirrors is_travel_calendar — exactly one row
  // system-wide may be designated the shared "Hallmark" calendar (owner-only
  // assignment). Events created/edited on ornaments_hallmark_events are
  // best-effort pushed to this calendar via the same connected user's token.
  `ALTER TABLE travels_connected_calendars ADD COLUMN IF NOT EXISTS is_hallmark_calendar BOOLEAN NOT NULL DEFAULT false`,

  // ornaments_hallmark_events: the app's own source of truth for major
  // Hallmark collector events (Keepsake Ornament Premiere / Open House,
  // etc). Household-shared like all other ornaments data — any authenticated
  // user may create/edit/delete. google_event_id links to a mirrored event
  // on the designated shared Hallmark calendar (nullable — a row may exist
  // locally without ever having synced, e.g. calendar not yet designated).
  `CREATE TABLE IF NOT EXISTS ornaments_hallmark_events (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER,
    title            TEXT NOT NULL,
    description      TEXT,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    google_event_id  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ornaments_hallmark_events ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ornaments_hallmark_events_start_date_idx
     ON ornaments_hallmark_events (start_date)`,

  // --- Gmail travel-document scanning -------------------------------------
  // Per-user IANA timezone, used to render dates/times extracted from
  // scanned Gmail travel documents (and elsewhere in Travels).
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS timezone TEXT`,

  `CREATE TABLE IF NOT EXISTS travels_gmail_connections (
    id                       SERIAL PRIMARY KEY,
    user_id                  INTEGER NOT NULL UNIQUE,
    google_email             TEXT NOT NULL,
    refresh_token            TEXT NOT NULL,
    access_token             TEXT,
    access_token_expires_at  TIMESTAMPTZ,
    last_history_id          TEXT,
    last_scan_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_gmail_connections ENABLE ROW LEVEL SECURITY`,
  // Cached Gmail label ids ("Travel" / "Batchelor App") for this user's own
  // mailbox — added after initial launch, so additive ALTER rather than in
  // the CREATE TABLE above.
  `ALTER TABLE travels_gmail_connections ADD COLUMN IF NOT EXISTS travel_label_id TEXT`,
  `ALTER TABLE travels_gmail_connections ADD COLUMN IF NOT EXISTS reviewed_label_id TEXT`,

  `CREATE TABLE IF NOT EXISTS travels_gmail_scan_decisions (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL,
    gmail_message_id    TEXT NOT NULL,
    thread_id           TEXT,
    subject             TEXT,
    from_address        TEXT,
    received_at         TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'pending',
    extracted_data      JSONB,
    dedupe_key          TEXT,
    suggested_trip_id   INTEGER,
    trip_id             INTEGER,
    trip_document_id    INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_gmail_scan_decisions ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_gmail_scan_decisions_user_id_idx
     ON travels_gmail_scan_decisions (user_id)`,
  `CREATE INDEX IF NOT EXISTS travels_gmail_scan_decisions_status_idx
     ON travels_gmail_scan_decisions (status)`,
  `CREATE INDEX IF NOT EXISTS travels_gmail_scan_decisions_dedupe_key_idx
     ON travels_gmail_scan_decisions (dedupe_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_gmail_scan_decisions_user_id_gmail_message_id_idx
     ON travels_gmail_scan_decisions (user_id, gmail_message_id)`,

  // ── Trip Detail card layout (per-user reorder + collapse) ──────────────────
  // Lets each household member choose their own display order for the
  // movable Trip Detail page cards (top trip-info card is always first and
  // is not reorderable). One row per user; card_order is validated/
  // whitelisted server-side before being persisted.
  `CREATE TABLE IF NOT EXISTS travels_card_layout_preferences (
    user_id     INTEGER PRIMARY KEY,
    card_order  TEXT[] NOT NULL DEFAULT '{}'::text[],
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_card_layout_preferences ENABLE ROW LEVEL SECURITY`,

  // Per-trip, per-user collapse state for Trip Detail page cards — lets each
  // household member collapse cards they aren't using on a given trip (e.g.
  // hide "Packing List" once packing is done) without affecting what other
  // household members see, since trips themselves are shared.
  `CREATE TABLE IF NOT EXISTS travels_trip_card_collapse_state (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL,
    trip_id           INTEGER NOT NULL,
    collapsed_cards   TEXT[] NOT NULL DEFAULT '{}'::text[],
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_trip_card_collapse_state ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_trip_card_collapse_state_user_id_trip_id_idx
     ON travels_trip_card_collapse_state (user_id, trip_id)`,

  // ── Per-document icon override ────────────────────────────────────────────
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS icon_override TEXT`,

  // ── User-defined (trained) custom document types ──────────────────────────
  `CREATE TABLE IF NOT EXISTS travels_custom_document_types (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    type_key     TEXT NOT NULL,
    type_name    TEXT NOT NULL,
    description  TEXT,
    icon_name    TEXT,
    color_key    TEXT,
    fields       JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_custom_document_types ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_custom_document_types_user_id_type_key_idx
     ON travels_custom_document_types (user_id, type_key)`,
  `CREATE INDEX IF NOT EXISTS travels_custom_document_types_user_id_idx
     ON travels_custom_document_types (user_id)`,

  // ── Elaine — shared AI assistant (Pottery + Quilting + Travels + hub) ─────
  // Replaces the old travels-only travels_assistant_* tables (dropped via a
  // one-time, explicit named migration script after a verified data copy —
  // see scripts/src/migrate-elaine.ts). Not namespaced per-app: Elaine keeps
  // one continuous conversation/memory per user across every surface.
  `CREATE TABLE IF NOT EXISTS elaine_conversations (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL UNIQUE,
    messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_conversations ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS elaine_settings (
    user_id                   INTEGER PRIMARY KEY,
    enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
    action_confirmation_mode  TEXT NOT NULL DEFAULT 'one_by_one',
    chat_window_size          TEXT NOT NULL DEFAULT 'compact',
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_settings ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE elaine_settings ADD COLUMN IF NOT EXISTS chat_window_size TEXT NOT NULL DEFAULT 'compact'`,

  `CREATE TABLE IF NOT EXISTS elaine_memory (
    id                  SERIAL PRIMARY KEY,
    content             TEXT NOT NULL,
    created_by_user_id  INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_memory ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS elaine_nudges (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    source_app  TEXT,
    source_id   INTEGER,
    nudge_key   TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seen_at     TIMESTAMPTZ
  )`,
  `ALTER TABLE elaine_nudges ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS elaine_nudges_user_id_idx
     ON elaine_nudges (user_id)`,
  `CREATE INDEX IF NOT EXISTS elaine_nudges_user_id_seen_at_idx
     ON elaine_nudges (user_id, seen_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS elaine_nudges_user_id_nudge_key_idx
     ON elaine_nudges (user_id, nudge_key)`,

  // Single-row (id=1) global config, admin-editable (app owner only). Started
  // as Elaine-only config; now also the whole app's global AI configuration
  // (models/timeouts/features/thresholds for Pottery, Quilting, Travels) —
  // see lib/global-config.ts. Applies across every user/app, unlike
  // elaine_settings above which is per-user (enabled/confirmation mode).
  `CREATE TABLE IF NOT EXISTS elaine_global_config (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    chat_model          TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
    subagent_model      TEXT NOT NULL DEFAULT 'z-ai/glm-5.2',
    request_timeout_ms  INTEGER NOT NULL DEFAULT 12000,
    max_response_tokens INTEGER NOT NULL DEFAULT 700,
    extra_models        JSONB NOT NULL DEFAULT '{}'::jsonb,
    timeouts            JSONB NOT NULL DEFAULT '{}'::jsonb,
    features            JSONB NOT NULL DEFAULT '{}'::jsonb,
    thresholds          JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id  INTEGER,
    CONSTRAINT elaine_global_config_singleton CHECK (id = 1)
  )`,
  `ALTER TABLE elaine_global_config ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS extra_models JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS timeouts JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE elaine_global_config ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `INSERT INTO elaine_global_config (id) VALUES (1)
     ON CONFLICT (id) DO NOTHING`,

  // ── Hub webmail Gmail connections ────────────────────────────────────────────
  // Separate from travels_gmail_connections — uses https://mail.google.com/
  // scope for full read/write/send/delete inbox access (not just travel scanning).
  `CREATE TABLE IF NOT EXISTS app_gmail_connections (
    id                     SERIAL PRIMARY KEY,
    user_id                INTEGER NOT NULL UNIQUE,
    google_email           TEXT NOT NULL,
    refresh_token          TEXT NOT NULL,
    access_token           TEXT,
    access_token_expires_at TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE app_gmail_connections ENABLE ROW LEVEL SECURITY`,

  // travels_trips.share_token: random hex token for public read-only itinerary share links.
  // Null until the user generates a share link for the first time.
  `ALTER TABLE travels_trips ADD COLUMN IF NOT EXISTS share_token TEXT`,

  // ── Packing Lists ────────────────────────────────────────────────────────────
  // One packing list per trip (auto-created on first use). Separate from the
  // legacy travels_trips.packing_list jsonb column which was used before this
  // feature; new rows use these tables exclusively.
  `CREATE TABLE IF NOT EXISTS travels_packing_lists (
    id          SERIAL PRIMARY KEY,
    trip_id     INTEGER NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT 'Packing List',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_packing_lists ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_packing_lists_trip_id_idx ON travels_packing_lists (trip_id)`,

  `CREATE TABLE IF NOT EXISTS travels_packing_items (
    id                SERIAL PRIMARY KEY,
    list_id           INTEGER NOT NULL REFERENCES travels_packing_lists(id) ON DELETE CASCADE,
    text              TEXT NOT NULL,
    packed            BOOLEAN NOT NULL DEFAULT false,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    added_by_user_id  INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_packing_items ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_packing_items_list_id_idx ON travels_packing_items (list_id)`,

  // ── Block Templates (reusable block library) ─────────────────────────────
  // Household-shared (no per-user filter on reads). created_by_user_id is
  // attribution metadata only, consistent with the rest of the quilting app.
  `CREATE TABLE IF NOT EXISTS quilting_block_templates (
    id                    SERIAL PRIMARY KEY,
    created_by_user_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    name                  TEXT NOT NULL,
    tags                  TEXT[] NOT NULL DEFAULT '{}',
    grid_w                INTEGER NOT NULL DEFAULT 8,
    grid_h                INTEGER NOT NULL DEFAULT 8,
    cells                 TEXT[] NOT NULL DEFAULT '{}',
    seams                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    block_size_inches     REAL,
    seam_allowance_inches REAL,
    thumbnail_svg         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_block_templates ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS travels_packing_templates (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    items       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_packing_templates ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_packing_templates_user_id_idx ON travels_packing_templates (user_id)`,

  `CREATE TABLE IF NOT EXISTS elaine_history_conversations (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL DEFAULT 'New conversation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_history_conversations ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS elaine_history_conversations_user_updated_idx ON elaine_history_conversations (user_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS elaine_history_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES elaine_history_conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    attachment_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_history_messages ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS elaine_history_messages_conversation_id_idx ON elaine_history_messages (conversation_id)`,

  // Daily morning brief — generated once per user per UTC day, cached until
  // midnight. The unique functional index prevents duplicate generation even
  // under concurrent requests; ON CONFLICT DO NOTHING is the safe insert path.
  `CREATE TABLE IF NOT EXISTS elaine_daily_briefs (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    content      TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dismissed    BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `ALTER TABLE elaine_daily_briefs ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS elaine_daily_briefs_user_day_idx
     ON elaine_daily_briefs (user_id, (date_trunc('day', generated_at AT TIME ZONE 'UTC')))`,

  // ── Phone numbers + SMS (AgentPhone integration) ───────────────────────────
  // Per-user phone number for SMS reminders/notifications, verified via a
  // one-time code sent through AgentPhone before it can be used to send.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_number TEXT`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ`,
  // A2P 10DLC compliance: timestamp of the most recent explicit SMS opt-in
  // consent checkbox submission, recorded by the send-code endpoint. Serves
  // as evidence of opt-in for carrier campaign registration.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ`,

  // Short-lived one-time codes for verifying a candidate phone number. The
  // candidate number is stored on the row itself (not read from app_users)
  // so a user can verify a NEW number before it overwrites their existing
  // one — verification only commits to app_users once the code matches.
  `CREATE TABLE IF NOT EXISTS phone_verification_codes (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    phone_number  TEXT NOT NULL,
    code_hash     TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    used          BOOLEAN NOT NULL DEFAULT false,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE phone_verification_codes ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS phone_verification_codes_user_id_idx ON phone_verification_codes (user_id)`,

  // A2P 10DLC compliance: set when this number replies STOP/STOPALL/
  // UNSUBSCRIBE/CANCEL/END/QUIT via the AgentPhone webhook; cleared on
  // START/UNSTOP/YES. Every outbound SMS send path must skip a set number.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ`,

  // ── AgentPhone webhook (SMS/voice) — rolling conversation + dedup log ──────
  `CREATE TABLE IF NOT EXISTS agentphone_conversations (
    id           SERIAL PRIMARY KEY,
    phone_number TEXT NOT NULL UNIQUE,
    user_id      INTEGER NOT NULL,
    messages     JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE agentphone_conversations ENABLE ROW LEVEL SECURITY`,
  `CREATE TABLE IF NOT EXISTS agentphone_webhook_deliveries (
    id          TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE agentphone_webhook_deliveries ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS agentphone_webhook_deliveries_received_at_idx
     ON agentphone_webhook_deliveries (received_at)`,

  // travels_reminders.sms_recipient_user_ids: app_users.id values (must have a
  // verified phone number) who should also get an SMS alert for this
  // reminder, alongside/instead of the email recipients above.
  `ALTER TABLE travels_reminders ADD COLUMN IF NOT EXISTS sms_recipient_user_ids INTEGER[] NOT NULL DEFAULT '{}'`,
  // Dedup log reused for both channels — 'email' (default, preserves
  // existing rows) or 'sms'. A (reminder, user, alertType, channel) tuple is
  // sent at most once.
  `ALTER TABLE travels_reminder_alert_log ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email'`,

  // ── Document RAG (issue #99) ────────────────────────────────────────────────
  // Store the raw extracted text from PDFs/images so we can chunk + embed it.
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS raw_text TEXT`,
  // One chunk per ~500-char passage with ~100-char overlap; each gets a
  // 1536-dim text embedding for semantic search.
  `CREATE TABLE IF NOT EXISTS travels_doc_chunks (
    id                  SERIAL PRIMARY KEY,
    trip_document_id    INTEGER NOT NULL REFERENCES travels_trip_documents(id) ON DELETE CASCADE,
    chunk_index         INTEGER NOT NULL,
    content             TEXT NOT NULL,
    embedding           vector(1536),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_doc_chunks ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_doc_chunks_doc_id_idx
     ON travels_doc_chunks (trip_document_id)`,
  `CREATE INDEX IF NOT EXISTS travels_doc_chunks_embedding_idx
     ON travels_doc_chunks USING hnsw (embedding vector_cosine_ops)`,

  // ── Ornaments app ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ornaments_items (
    id                     SERIAL PRIMARY KEY,
    user_id                INTEGER REFERENCES app_users(id),
    name                   TEXT NOT NULL,
    brand                  TEXT NOT NULL DEFAULT 'Hallmark',
    series_or_collection   TEXT,
    year                   INTEGER,
    barcode_value          TEXT,
    quantity               INTEGER NOT NULL DEFAULT 1,
    notes                  TEXT,
    dimensions             TEXT,
    condition              TEXT,
    origin                 TEXT,
    acquired_at            DATE,
    ai_description         TEXT,
    dominant_colors        TEXT[] NOT NULL DEFAULT '{}',
    motifs                 TEXT[] NOT NULL DEFAULT '{}',
    image_path             TEXT NOT NULL,
    locked_fields          TEXT[] NOT NULL DEFAULT '{}',
    book_value             NUMERIC(10,2),
    book_value_source      TEXT,
    book_value_updated_at  TIMESTAMPTZ,
    embedding              vector(1536),
    visual_embedding       vector(1024),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ornaments_categories (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES app_users(id),
    name        TEXT NOT NULL,
    bg_color    TEXT,
    text_color  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ornaments_item_categories (
    item_id     INTEGER NOT NULL REFERENCES ornaments_items(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES ornaments_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, category_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ornaments_images (
    id           SERIAL PRIMARY KEY,
    item_id      INTEGER NOT NULL REFERENCES ornaments_items(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    label        TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ornaments_barcode_cache (
    barcode              TEXT PRIMARY KEY,
    found                INTEGER NOT NULL DEFAULT 0,
    name                 TEXT,
    brand                TEXT,
    series_or_collection TEXT,
    year                 INTEGER,
    description          TEXT,
    image_url            TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ornaments_embedding_idx
     ON ornaments_items USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS ornaments_visual_embedding_idx
     ON ornaments_items USING hnsw (visual_embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS ornaments_items_user_id_idx
     ON ornaments_items (user_id)`,
  `CREATE INDEX IF NOT EXISTS ornaments_items_series_idx
     ON ornaments_items (series_or_collection)`,
  `CREATE INDEX IF NOT EXISTS ornaments_item_categories_category_id_idx
     ON ornaments_item_categories (category_id)`,
  `CREATE INDEX IF NOT EXISTS ornaments_images_item_idx
     ON ornaments_images (item_id)`,
  `ALTER TABLE ornaments_items ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE ornaments_categories ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE ornaments_item_categories ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE ornaments_images ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE ornaments_barcode_cache ENABLE ROW LEVEL SECURITY`,
];
