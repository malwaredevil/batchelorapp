/**
 * SINGLE SOURCE OF DDL TRUTH for the merged Batchelor monorepo (pottery +
 * quilting). Consumed by BOTH `bootstrap.ts` (the CLI bootstrap, run via
 * `pnpm --filter @workspace/db run bootstrap` and in post-merge.sh) AND the
 * api-server startup self-healing migration. Keeping one list prevents a
 * split-brain where one entrypoint creates only a subset of tables.
 *
 * Safe, additive-only alternative to the banned force-push command. The Supabase
 * DB is SHARED by both apps and `app_users` / `password_reset_tokens` are shared
 * between them. The banned command introspects EVERY table and auto-confirms
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
  // Birthday as "MM-DD" text (year omitted). Used for birthday banner and email.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS birthday text`,

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
  // Prevent two simultaneous forgot-password requests from both issuing a
  // valid token for the same user. The partial index (WHERE NOT used) means
  // at most one active token can exist per user; a concurrent INSERT from a
  // second parallel request hits a unique constraint violation, which the
  // handler catches and swallows — only the first request's token is active.
  `CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_user_active_idx
     ON password_reset_tokens (user_id)
     WHERE NOT used`,
  // Additive back-fills (each app historically created a partial version):
  `ALTER TABLE password_reset_tokens
     ADD COLUMN IF NOT EXISTS used boolean NOT NULL DEFAULT false`,
  `ALTER TABLE password_reset_tokens
     ADD COLUMN IF NOT EXISTS used_at timestamptz`,

  // Persisted last-run guard for in-process schedulers (hallmark events scan,
  // gmail scan, calendar trip scan, nudges, reminders). Prevents an
  // AI-calling scheduled run from firing again immediately after every
  // workflow restart — see schema/users.ts for the full rationale.
  `CREATE TABLE IF NOT EXISTS scheduler_runs (
    name text PRIMARY KEY,
    last_run_at timestamptz NOT NULL
  )`,
  `ALTER TABLE scheduler_runs ENABLE ROW LEVEL SECURITY`,

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
  // is_hallmark_calendar: exactly one row system-wide may be designated the
  // shared "Hallmark" calendar (owner-only assignment). Hallmark events are
  // now written directly to Google Calendar via CRUD routes; no local table.
  `ALTER TABLE travels_connected_calendars ADD COLUMN IF NOT EXISTS is_hallmark_calendar BOOLEAN NOT NULL DEFAULT false`,

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
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS type        text      NOT NULL DEFAULT 'fact'`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS scope       text      NOT NULL DEFAULT 'household'`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS category    text      NOT NULL DEFAULT 'fact'`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS sensitivity text      NOT NULL DEFAULT 'low'`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS owner_user_id INTEGER`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS active      BOOLEAN   NOT NULL DEFAULT true`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ`,
  `ALTER TABLE elaine_memory ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS elaine_memory_scope_active_idx ON elaine_memory (scope, active)`,
  `CREATE INDEX IF NOT EXISTS elaine_memory_owner_idx        ON elaine_memory (owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS elaine_memory_expires_idx      ON elaine_memory (expires_at) WHERE active = true`,

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
  `ALTER TABLE elaine_history_conversations ADD COLUMN IF NOT EXISTS is_widget_default boolean NOT NULL DEFAULT false`,
  `ALTER TABLE elaine_history_conversations ADD COLUMN IF NOT EXISTS summary text`,
  `ALTER TABLE elaine_history_conversations ADD COLUMN IF NOT EXISTS summarized_up_to_id integer`,
  `CREATE UNIQUE INDEX IF NOT EXISTS elaine_history_conversations_widget_default_idx ON elaine_history_conversations (user_id) WHERE is_widget_default = true`,

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
  // Enforce uniqueness on verified phone numbers so that no two accounts can
  // share the same number. The AgentPhone webhook resolves household identity
  // purely by matching the caller's number against this column — duplicates
  // would cause an ambiguous match and could let one user's SMS/voice session
  // execute actions attributed to a different household member.
  // The partial index (WHERE phone_number IS NOT NULL) is required because
  // phone_number is optional: multiple users may have no number set (NULL),
  // and PostgreSQL UNIQUE constraints treat NULLs as distinct, but a partial
  // index makes the intent explicit and is consistent with the AgentPhone
  // lookup (which only matches non-NULL numbers).
  `CREATE UNIQUE INDEX IF NOT EXISTS app_users_phone_number_unique_idx
     ON app_users (phone_number)
     WHERE phone_number IS NOT NULL`,

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

  // ── Elaine inbound email (Resend) ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS elaine_email_conversations (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE,
    messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_message_id TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_email_conversations ENABLE ROW LEVEL SECURITY`,
  `CREATE TABLE IF NOT EXISTS elaine_email_webhook_deliveries (
    id          TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE elaine_email_webhook_deliveries ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS elaine_email_webhook_deliveries_received_at_idx
     ON elaine_email_webhook_deliveries (received_at)`,

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

  // ── Realtime replication (issue #128) ───────────────────────────────────────
  // Adds the household-shared collection tables to Supabase's built-in
  // `supabase_realtime` publication so the api-server's Realtime relay
  // (server-side only, service-role key, never exposed to the browser) can
  // receive postgres_changes events and re-broadcast lightweight
  // invalidation signals over the existing authenticated SSE endpoint. Wrapped
  // in an existence check because `ALTER PUBLICATION ... ADD TABLE` errors if
  // the table is already a member — this must stay idempotent like every
  // other statement here.
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pottery_items'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE pottery_items;
     END IF;
   END $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quilting_fabrics'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE quilting_fabrics;
     END IF;
   END $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quilting_patterns'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE quilting_patterns;
     END IF;
   END $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quilting_finished_quilts'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE quilting_finished_quilts;
     END IF;
   END $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'travels_trips'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE travels_trips;
     END IF;
   END $$`,

  // Unmatched-documents triage queue: forwarded booking-confirmation emails
  // with attachments that Elaine couldn't confidently match to a trip.
  `ALTER TABLE travels_trip_documents ALTER COLUMN trip_id DROP NOT NULL`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'linked'`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS source_email_from TEXT`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS source_email_subject TEXT`,
  `ALTER TABLE travels_trip_documents ADD COLUMN IF NOT EXISTS source_received_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS travels_trip_documents_status_idx ON travels_trip_documents (status)`,

  // ── Office notes (issue #146) ───────────────────────────────────────────────
  // Genuinely new household-shared feature (not ported from another app).
  // created_by_user_id is attribution-only, per the household-sharing model.
  `CREATE TABLE IF NOT EXISTS office_notes (
    id                  SERIAL PRIMARY KEY,
    title               TEXT NOT NULL,
    body                TEXT NOT NULL DEFAULT '',
    created_by_user_id  INTEGER REFERENCES app_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS office_notes_created_by_user_id_idx ON office_notes (created_by_user_id)`,
  `ALTER TABLE office_notes ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE office_notes ADD COLUMN IF NOT EXISTS background_color TEXT`,

  // ── App-wide configurable constants (issue #171) ─────────────────────────
  // Key/value pairs keyed by (module, key). Admin can override any row via
  // PUT /api/config/:module/:key (isOwner only).
  // NOT for security-critical limits — those stay hardcoded.
  `CREATE TABLE IF NOT EXISTS app_config (
    id          SERIAL PRIMARY KEY,
    module      TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'string',
    label       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(module, key)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_config_module_key_idx ON app_config (module, key)`,

  // Dedup key for the reminder alert log: prevents concurrent scheduler runs
  // (login-triggered + hourly cron) from inserting duplicate rows and sending
  // the same alert email/SMS twice. Matches the uniqueIndex in travels.ts schema.
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_reminder_alert_log_dedup_idx
     ON travels_reminder_alert_log (reminder_id, alert_type, channel)`,
  // Track deliberate admin overrides so the Control Panel "customised" badge
  // doesn't fire just because a developer renamed a default value between
  // deploys. Null = never intentionally changed; non-null = human override.
  `ALTER TABLE app_config ADD COLUMN IF NOT EXISTS customised_at TIMESTAMPTZ`,

  // Per-user hub app card order — JSON-serialised string[] of app IDs in display order.
  `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS hub_app_card_order TEXT`,

  // Seed default config rows — ON CONFLICT DO NOTHING so admin overrides
  // are never clobbered on re-bootstrap. Values here must stay in sync with
  // APP_CONFIG_DEFAULTS in artifacts/api-server/src/lib/app-config.ts.
  `INSERT INTO app_config (module, key, value, type, label, description) VALUES
    ('web_search',  'search_timeout_ms',             '15000',   'integer', 'Web search timeout (ms)',                      'AbortController timeout for Perplexity Sonar web-search calls via OpenRouter.'),
    ('openrouter',  'model_fetch_timeout_ms',         '8000',    'integer', 'OpenRouter model list fetch timeout (ms)',      'AbortController timeout when fetching the OpenRouter model catalogue for the admin UI.'),
    ('openrouter',  'model_list_cache_ttl_ms',        '3600000', 'integer', 'OpenRouter model list cache TTL (ms)',          'How long to keep the OpenRouter model catalogue in-memory (default 1 h).'),
    ('ornaments',   'barcode_fetch_timeout_ms',       '8000',    'integer', 'Barcode lookup fetch timeout (ms)',             'AbortController timeout for UPCitemdb barcode lookup calls.'),
    ('quilting',    'color_suggestion_max_tokens',    '200',     'integer', 'Colour suggestion AI max tokens',               'max_tokens cap for the fabric colour-suggestion vision call (quilting tools).'),
    ('quilting',    'pattern_import_max_tokens',      '400',     'integer', 'Pattern import AI max tokens',                  'max_tokens cap for the quilting pattern-import AI extraction call.'),
    ('quilting',    'reranker_timeout_ms',            '10000',   'integer', 'Voyage reranker timeout (ms)',                  'AbortSignal.timeout value for Voyage AI rerank calls (fabric Compare).'),
    ('travels',     'doc_type_suggestion_max_tokens', '400',     'integer', 'Document type suggestion AI max tokens',        'max_tokens cap for the AI call that suggests a custom document type name.'),
    ('travels',     'packing_ai_max_tokens',          '1000',    'integer', 'Packing list AI max tokens',                    'max_tokens cap for AI-generated packing list suggestions.'),
    ('travels',     'itinerary_gen_max_tokens',       '4000',    'integer', 'Itinerary generation AI max tokens',            'max_tokens cap for AI-generated day-by-day itinerary plans.'),
    ('travels',     'place_activities_max_tokens',    '2000',    'integer', 'Place activities AI max tokens',                'max_tokens cap for AI-generated destination activity suggestions.'),
    ('travels',     'place_summary_max_tokens',       '300',     'integer', 'Place summary AI max tokens',                   'max_tokens cap for brief AI-generated destination summaries.'),
    ('travels',     'explore_overview_max_tokens',    '600',     'integer', 'Explore destination overview AI max tokens',    'max_tokens cap for the AI-generated explore-mode destination overview paragraph.'),
    ('travels',     'full_itinerary_max_tokens',      '3000',    'integer', 'Full itinerary text AI max tokens',             'max_tokens cap for the full AI-generated itinerary text block.')
  ON CONFLICT (module, key) DO NOTHING`,

  // Messenger: household group chat with @Elaine AI integration.
  `CREATE TABLE IF NOT EXISTS messenger_conversations (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS messenger_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES messenger_conversations(id),
    sender_id       INTEGER REFERENCES app_users(id),
    body            TEXT NOT NULL DEFAULT '',
    read_at         TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
  `ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `CREATE INDEX IF NOT EXISTS messenger_messages_conv_created_idx
     ON messenger_messages (conversation_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS messenger_attachments (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    storage_path    TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS messenger_link_previews (
    id              SERIAL PRIMARY KEY,
    url             TEXT NOT NULL UNIQUE,
    title           TEXT,
    description     TEXT,
    image_url       TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT FALSE`,

  `CREATE TABLE IF NOT EXISTS messenger_conversation_participants (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, user_id)
  )`,

  `CREATE INDEX IF NOT EXISTS messenger_conv_participants_user_idx
     ON messenger_conversation_participants (user_id)`,

  // Migrate existing conversations: add every household member to any conversation
  // that currently has no participant rows (backward-compatible one-time migration).
  // ON CONFLICT DO NOTHING makes this idempotent.
  `INSERT INTO messenger_conversation_participants (conversation_id, user_id)
   SELECT mc.id, au.id
   FROM messenger_conversations mc
   CROSS JOIN app_users au
   WHERE NOT EXISTS (
     SELECT 1 FROM messenger_conversation_participants p
     WHERE p.conversation_id = mc.id
   )
   ON CONFLICT DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS messenger_push_subscriptions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    keys        JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS messenger_push_subs_user_idx
     ON messenger_push_subscriptions (user_id)`,

  // ── Operations: job queue + external operation tracking ──────────────────

  `CREATE TABLE IF NOT EXISTS app_schema_migrations (
    version         BIGINT PRIMARY KEY,
    name            TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by      TEXT,
    execution_ms    INTEGER,
    app_commit_sha  TEXT
  )`,
  `ALTER TABLE app_schema_migrations ENABLE ROW LEVEL SECURITY`,

  `CREATE TABLE IF NOT EXISTS app_jobs (
    id                    SERIAL PRIMARY KEY,
    type                  TEXT NOT NULL,
    queue                 TEXT NOT NULL DEFAULT 'default',
    status                TEXT NOT NULL DEFAULT 'queued',
    priority              INTEGER NOT NULL DEFAULT 0,
    payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_schema_version INTEGER NOT NULL DEFAULT 1,
    idempotency_key       TEXT,
    created_by_user_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    domain                TEXT,
    scheduled_for         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count         INTEGER NOT NULL DEFAULT 0,
    max_attempts          INTEGER NOT NULL DEFAULT 3,
    lease_owner           TEXT,
    lease_expires_at      TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    progress_percent      INTEGER NOT NULL DEFAULT 0,
    progress_message      TEXT,
    last_error_code       TEXT,
    last_error_message    TEXT,
    provider_request_id   TEXT,
    parent_job_id         INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE app_jobs ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS app_jobs_status_scheduled_idx
     ON app_jobs (status, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS app_jobs_type_status_idx
     ON app_jobs (type, status)`,
  `CREATE INDEX IF NOT EXISTS app_jobs_parent_idx
     ON app_jobs (parent_job_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_jobs_idempotency_idx
     ON app_jobs (type, idempotency_key)`,

  `CREATE TABLE IF NOT EXISTS app_job_attempts (
    id             SERIAL PRIMARY KEY,
    job_id         INTEGER NOT NULL REFERENCES app_jobs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status         TEXT NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ,
    error_code     TEXT,
    error_message  TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
  )`,
  `ALTER TABLE app_job_attempts ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS app_job_attempts_job_idx
     ON app_job_attempts (job_id)`,

  `CREATE TABLE IF NOT EXISTS external_operation_events (
    id                   SERIAL PRIMARY KEY,
    provider             TEXT NOT NULL,
    operation            TEXT NOT NULL,
    model_or_actor       TEXT,
    feature              TEXT NOT NULL,
    module               TEXT NOT NULL,
    user_id              INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    request_id           TEXT,
    job_id               INTEGER REFERENCES app_jobs(id) ON DELETE SET NULL,
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
  )`,
  `ALTER TABLE external_operation_events ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS external_operation_events_provider_created_idx
     ON external_operation_events (provider, created_at)`,
  `CREATE INDEX IF NOT EXISTS external_operation_events_job_idx
     ON external_operation_events (job_id)`,
  `CREATE INDEX IF NOT EXISTS external_operation_events_module_feature_idx
     ON external_operation_events (module, feature)`,

  `CREATE TABLE IF NOT EXISTS external_provider_pricing (
    id               SERIAL PRIMARY KEY,
    provider         TEXT NOT NULL,
    operation        TEXT NOT NULL,
    model_or_actor   TEXT,
    unit_type        TEXT NOT NULL,
    price_usd        NUMERIC(18,8) NOT NULL,
    effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to     TIMESTAMPTZ,
    source           TEXT NOT NULL DEFAULT 'manual',
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS external_provider_pricing_lookup_idx
     ON external_provider_pricing (provider, operation, model_or_actor, effective_from)`,

  `CREATE TABLE IF NOT EXISTS external_budget_policies (
    id                    SERIAL PRIMARY KEY,
    scope                 TEXT NOT NULL,
    scope_value           TEXT,
    period                TEXT NOT NULL,
    soft_threshold_usd    NUMERIC(18,2) NOT NULL,
    hard_threshold_usd    NUMERIC(18,2) NOT NULL,
    warning_policy        TEXT NOT NULL DEFAULT 'owner_dashboard',
    degradation_action    TEXT NOT NULL DEFAULT 'warn_only',
    enabled               BOOLEAN NOT NULL DEFAULT true,
    override_until        TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS external_budget_policies_scope_idx
     ON external_budget_policies (scope, scope_value)`,

  // ── Phase 2: AI provenance (#229) ────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS ai_generation_runs (
    id                    SERIAL PRIMARY KEY,
    module                TEXT NOT NULL,
    feature               TEXT NOT NULL,
    target_type           TEXT NOT NULL,
    target_id             INTEGER,
    job_id                INTEGER REFERENCES app_jobs(id) ON DELETE SET NULL,
    operation_event_id    INTEGER REFERENCES external_operation_events(id) ON DELETE SET NULL,
    user_id               INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    provider              TEXT NOT NULL,
    model                 TEXT NOT NULL,
    model_provider_run_id TEXT,
    prompt_template_id    TEXT,
    prompt_version_hash   TEXT,
    tool_schema_version   INTEGER NOT NULL DEFAULT 1,
    input_artifact_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                TEXT NOT NULL DEFAULT 'pending',
    error_code            TEXT,
    error_message         TEXT,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    duration_ms           INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ai_generation_runs ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ai_generation_runs_target_idx
     ON ai_generation_runs (target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS ai_generation_runs_module_feature_idx
     ON ai_generation_runs (module, feature)`,
  `CREATE INDEX IF NOT EXISTS ai_generation_runs_created_at_idx
     ON ai_generation_runs (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ai_field_candidates (
    id                    SERIAL PRIMARY KEY,
    generation_run_id     INTEGER NOT NULL REFERENCES ai_generation_runs(id) ON DELETE CASCADE,
    target_type           TEXT NOT NULL,
    target_id             INTEGER,
    field_path            TEXT NOT NULL,
    candidate_value       JSONB,
    normalized_value_hash TEXT,
    confidence_score      NUMERIC(5,4),
    confidence_method     TEXT,
    authority_class       TEXT NOT NULL DEFAULT 'vision',
    source_references     JSONB NOT NULL DEFAULT '[]'::jsonb,
    disposition           TEXT NOT NULL DEFAULT 'proposed',
    applied_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ai_field_candidates ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ai_field_candidates_run_idx
     ON ai_field_candidates (generation_run_id)`,
  `CREATE INDEX IF NOT EXISTS ai_field_candidates_target_field_idx
     ON ai_field_candidates (target_type, target_id, field_path)`,
  `CREATE INDEX IF NOT EXISTS ai_field_candidates_disposition_idx
     ON ai_field_candidates (disposition)`,

  `CREATE TABLE IF NOT EXISTS ai_field_decisions (
    id                SERIAL PRIMARY KEY,
    candidate_id      INTEGER NOT NULL REFERENCES ai_field_candidates(id) ON DELETE CASCADE,
    deciding_user_id  INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    decision_type     TEXT NOT NULL,
    prior_value       JSONB,
    final_value       JSONB,
    correction_category TEXT,
    context_source    TEXT NOT NULL DEFAULT 'manual_edit',
    decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ai_field_decisions ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ai_field_decisions_candidate_idx
     ON ai_field_decisions (candidate_id)`,
  `CREATE INDEX IF NOT EXISTS ai_field_decisions_user_idx
     ON ai_field_decisions (deciding_user_id)`,

  // ── Phase 2: AI prompt versions (#229) ───────────────────────────────────

  `CREATE TABLE IF NOT EXISTS ai_prompt_versions (
    id               SERIAL PRIMARY KEY,
    template_id      TEXT NOT NULL,
    version          INTEGER NOT NULL DEFAULT 1,
    hash             TEXT NOT NULL,
    schema_version   INTEGER NOT NULL DEFAULT 1,
    effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until  TIMESTAMPTZ,
    release_notes    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ai_prompt_versions ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_prompt_versions_template_version_idx
     ON ai_prompt_versions (template_id, version)`,
  `CREATE INDEX IF NOT EXISTS ai_prompt_versions_hash_idx
     ON ai_prompt_versions (hash)`,

  // ── Phase 2: Ingestion framework (#230) ──────────────────────────────────

  `CREATE TABLE IF NOT EXISTS ingestion_sources (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    slug                  TEXT NOT NULL,
    adapter_type          TEXT NOT NULL,
    adapter_config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    config_schema_version INTEGER NOT NULL DEFAULT 1,
    module                TEXT NOT NULL,
    feature               TEXT,
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    owner_notes           TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ingestion_sources ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ingestion_sources_slug_idx
     ON ingestion_sources (slug)`,
  `CREATE INDEX IF NOT EXISTS ingestion_sources_module_idx
     ON ingestion_sources (module)`,

  `CREATE TABLE IF NOT EXISTS ingestion_runs (
    id              SERIAL PRIMARY KEY,
    source_id       INTEGER NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
    job_id          INTEGER REFERENCES app_jobs(id) ON DELETE SET NULL,
    triggered_by    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    trigger_type    TEXT NOT NULL DEFAULT 'manual',
    status          TEXT NOT NULL DEFAULT 'pending',
    items_fetched   INTEGER NOT NULL DEFAULT 0,
    items_matched   INTEGER NOT NULL DEFAULT 0,
    items_merged    INTEGER NOT NULL DEFAULT 0,
    items_rejected  INTEGER NOT NULL DEFAULT 0,
    error_code      TEXT,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx
     ON ingestion_runs (source_id)`,
  `CREATE INDEX IF NOT EXISTS ingestion_runs_status_idx
     ON ingestion_runs (status)`,
  `CREATE INDEX IF NOT EXISTS ingestion_runs_created_at_idx
     ON ingestion_runs (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ingestion_candidates (
    id               SERIAL PRIMARY KEY,
    run_id           INTEGER NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    source_id        INTEGER NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
    source_key       TEXT NOT NULL,
    target_type      TEXT,
    target_id        INTEGER,
    normalized_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score NUMERIC(5,4),
    status           TEXT NOT NULL DEFAULT 'pending',
    matched_at       TIMESTAMPTZ,
    merged_at        TIMESTAMPTZ,
    rejected_reason  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE ingestion_candidates ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ingestion_candidates_run_idx
     ON ingestion_candidates (run_id)`,
  `CREATE INDEX IF NOT EXISTS ingestion_candidates_target_idx
     ON ingestion_candidates (target_type, target_id)`,
  `CREATE INDEX IF NOT EXISTS ingestion_candidates_status_idx
     ON ingestion_candidates (status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ingestion_candidates_source_key_idx
     ON ingestion_candidates (source_id, source_key)`,

  // ── Phase 2: Document evidence (#232) ────────────────────────────────────

  `ALTER TABLE travels_trip_documents
     ADD COLUMN IF NOT EXISTS source_spans JSONB`,

  `CREATE TABLE IF NOT EXISTS travels_document_pages (
    id                   SERIAL PRIMARY KEY,
    trip_document_id     INTEGER NOT NULL
                           REFERENCES travels_trip_documents(id) ON DELETE CASCADE,
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
  )`,
  `ALTER TABLE travels_document_pages ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_document_pages_doc_idx
     ON travels_document_pages (trip_document_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS travels_document_pages_doc_page_idx
     ON travels_document_pages (trip_document_id, page_index)`,

  `CREATE TABLE IF NOT EXISTS travels_document_field_evidence (
    id                   SERIAL PRIMARY KEY,
    candidate_id         INTEGER NOT NULL
                           REFERENCES ai_field_candidates(id) ON DELETE CASCADE,
    document_page_id     INTEGER
                           REFERENCES travels_document_pages(id) ON DELETE SET NULL,
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
  )`,
  `ALTER TABLE travels_document_field_evidence ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_document_field_evidence_candidate_idx
     ON travels_document_field_evidence (candidate_id)`,
  `CREATE INDEX IF NOT EXISTS travels_document_field_evidence_page_idx
     ON travels_document_field_evidence (document_page_id)`,

  `CREATE TABLE IF NOT EXISTS travels_field_conflicts (
    id                        SERIAL PRIMARY KEY,
    trip_id                   INTEGER NOT NULL
                                REFERENCES travels_trips(id) ON DELETE CASCADE,
    field_path                TEXT NOT NULL,
    accepted_candidate_id     INTEGER
                                REFERENCES ai_field_candidates(id) ON DELETE SET NULL,
    accepted_value            JSONB,
    competing_candidate_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
    conflict_type             TEXT NOT NULL,
    recommended_candidate_id  INTEGER
                                REFERENCES ai_field_candidates(id) ON DELETE SET NULL,
    recommended_rationale     TEXT,
    status                    TEXT NOT NULL DEFAULT 'open',
    deciding_user_id          INTEGER
                                REFERENCES app_users(id) ON DELETE SET NULL,
    decided_at                TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE travels_field_conflicts ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_field_conflicts_trip_idx
     ON travels_field_conflicts (trip_id)`,
  `CREATE INDEX IF NOT EXISTS travels_field_conflicts_status_idx
     ON travels_field_conflicts (status)`,
  `CREATE INDEX IF NOT EXISTS travels_field_conflicts_field_path_idx
     ON travels_field_conflicts (field_path)`,

  // ── Disruption monitoring (#238) ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS travels_reservations (
    id                    SERIAL PRIMARY KEY,
    trip_id               INTEGER NOT NULL REFERENCES travels_trips(id) ON DELETE CASCADE,
    document_id           INTEGER,
    reservation_type      TEXT NOT NULL DEFAULT 'general',
    status                TEXT NOT NULL DEFAULT 'confirmed',
    provider_name         TEXT,
    confirmation_ref      TEXT,
    passenger_names       JSONB NOT NULL DEFAULT '[]',
    segments              JSONB NOT NULL DEFAULT '[]',
    check_in_date         DATE,
    check_out_date        DATE,
    destination_iata      TEXT,
    origin_iata           TEXT,
    raw_extracted         JSONB NOT NULL DEFAULT '{}',
    monitoring_enabled    BOOLEAN NOT NULL DEFAULT true,
    monitoring_policy     TEXT NOT NULL DEFAULT 'standard',
    last_baseline_at      TIMESTAMPTZ,
    last_checked_at       TIMESTAMPTZ,
    created_by_user_id    INTEGER NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE travels_reservations ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_reservations_trip_idx    ON travels_reservations (trip_id)`,
  `CREATE INDEX IF NOT EXISTS travels_reservations_type_idx    ON travels_reservations (reservation_type)`,
  `CREATE INDEX IF NOT EXISTS travels_reservations_status_idx  ON travels_reservations (status)`,

  `CREATE TABLE IF NOT EXISTS travel_monitoring_baselines (
    id                    SERIAL PRIMARY KEY,
    reservation_id        INTEGER NOT NULL REFERENCES travels_reservations(id) ON DELETE CASCADE,
    normalized_data       JSONB NOT NULL DEFAULT '{}',
    schema_version        TEXT NOT NULL DEFAULT '1',
    content_hash          TEXT,
    confirmed_by          TEXT NOT NULL DEFAULT 'auto',
    confirmed_by_user_id  INTEGER,
    source_refs           JSONB NOT NULL DEFAULT '[]',
    effective_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE travel_monitoring_baselines ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travel_monitoring_baselines_reservation_idx    ON travel_monitoring_baselines (reservation_id)`,
  `CREATE INDEX IF NOT EXISTS travel_monitoring_baselines_effective_at_idx   ON travel_monitoring_baselines (effective_at DESC)`,

  `CREATE TABLE IF NOT EXISTS travel_monitoring_observations (
    id                  SERIAL PRIMARY KEY,
    reservation_id      INTEGER NOT NULL REFERENCES travels_reservations(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    external_record_id  TEXT,
    observed_data       JSONB NOT NULL DEFAULT '{}',
    observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash        TEXT,
    authority           TEXT NOT NULL DEFAULT 'document',
    raw_snapshot        JSONB NOT NULL DEFAULT '{}',
    job_id              INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE travel_monitoring_observations ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travel_monitoring_observations_reservation_idx  ON travel_monitoring_observations (reservation_id)`,
  `CREATE INDEX IF NOT EXISTS travel_monitoring_observations_observed_at_idx  ON travel_monitoring_observations (observed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS travel_change_events (
    id                       SERIAL PRIMARY KEY,
    reservation_id           INTEGER NOT NULL REFERENCES travels_reservations(id) ON DELETE CASCADE,
    baseline_id              INTEGER,
    previous_observation_id  INTEGER,
    new_observation_id       INTEGER,
    change_type              TEXT NOT NULL,
    severity                 TEXT NOT NULL DEFAULT 'informational',
    field_diffs              JSONB NOT NULL DEFAULT '[]',
    materiality_reason       TEXT,
    downstream_impacts       JSONB NOT NULL DEFAULT '[]',
    state                    TEXT NOT NULL DEFAULT 'detected',
    decided_by_user_id       INTEGER,
    decided_at               TIMESTAMPTZ,
    decision_notes           TEXT,
    notification_event_id    INTEGER,
    dedup_key                TEXT UNIQUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE travel_change_events ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travel_change_events_reservation_idx  ON travel_change_events (reservation_id)`,
  `CREATE INDEX IF NOT EXISTS travel_change_events_state_idx         ON travel_change_events (state)`,
  `CREATE INDEX IF NOT EXISTS travel_change_events_severity_idx      ON travel_change_events (severity)`,

  `CREATE TABLE IF NOT EXISTS travels_monitoring_preferences (
    id                                  SERIAL PRIMARY KEY,
    user_id                             INTEGER NOT NULL UNIQUE,
    monitoring_enabled                  BOOLEAN NOT NULL DEFAULT true,
    weather_alerts                      BOOLEAN NOT NULL DEFAULT true,
    check_in_reminders                  BOOLEAN NOT NULL DEFAULT true,
    document_reminders                  BOOLEAN NOT NULL DEFAULT true,
    min_severity                        TEXT NOT NULL DEFAULT 'attention',
    notify_channels                     JSONB NOT NULL DEFAULT '{"inApp":true,"email":false}',
    schedule_change_threshold_minutes   INTEGER NOT NULL DEFAULT 30,
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE travels_monitoring_preferences ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS travels_monitoring_prefs_user_idx ON travels_monitoring_preferences (user_id)`,

  // ── Phase 2: Search feedback + similarity evaluations (#233) ─────────────

  `CREATE TABLE IF NOT EXISTS search_feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    module      TEXT NOT NULL,
    item_a_type TEXT NOT NULL,
    item_a_id   INTEGER NOT NULL,
    item_b_type TEXT NOT NULL,
    item_b_id   INTEGER NOT NULL,
    verdict     TEXT NOT NULL,
    weight      NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE search_feedback ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS search_feedback_module_idx
     ON search_feedback (module)`,
  `CREATE INDEX IF NOT EXISTS search_feedback_items_idx
     ON search_feedback (item_a_type, item_a_id, item_b_type, item_b_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS search_feedback_pair_user_idx
     ON search_feedback (user_id, item_a_type, item_a_id, item_b_type, item_b_id)`,

  // ── Phase 2: Similarity evaluations (#233) ───────────────────────────────
  // Records per-query, per-result component scores from compare endpoints so
  // calibration drift is observable without manual logging.
  `CREATE TABLE IF NOT EXISTS similarity_evaluations (
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
    user_verdict              TEXT CHECK (user_verdict IN ('same','similar','different')),
    user_id                   INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS similarity_evaluations_module_workflow_idx
     ON similarity_evaluations (module, workflow)`,
  `CREATE INDEX IF NOT EXISTS similarity_evaluations_query_idx
     ON similarity_evaluations (query_artifact_type, query_artifact_id)`,
  `CREATE INDEX IF NOT EXISTS similarity_evaluations_candidate_idx
     ON similarity_evaluations (candidate_target_type, candidate_target_id)`,
  `CREATE INDEX IF NOT EXISTS similarity_evaluations_recorded_at_idx
     ON similarity_evaluations (recorded_at DESC)`,

  // ── Phase 3: Market intelligence (#234) ──────────────────────────────────

  `CREATE TABLE IF NOT EXISTS market_observations (
    id                     SERIAL PRIMARY KEY,
    module                 TEXT NOT NULL,
    item_type              TEXT NOT NULL,
    item_id                INTEGER,
    ingestion_candidate_id INTEGER REFERENCES ingestion_candidates(id) ON DELETE SET NULL,
    platform               TEXT NOT NULL,
    listing_url            TEXT,
    listing_title          TEXT,
    observed_price         NUMERIC(12,2),
    currency               TEXT NOT NULL DEFAULT 'USD',
    condition              TEXT,
    listing_status         TEXT NOT NULL DEFAULT 'active'
                             CHECK (listing_status IN ('active','sold','expired','unknown')),
    listed_at              TIMESTAMPTZ,
    sold_at                TIMESTAMPTZ,
    source_json            JSONB,
    confidence_score       NUMERIC(4,3),
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS market_observations_module_item_idx
     ON market_observations (module, item_type, item_id)`,
  `CREATE INDEX IF NOT EXISTS market_observations_platform_idx
     ON market_observations (platform)`,
  `CREATE INDEX IF NOT EXISTS market_observations_status_idx
     ON market_observations (listing_status)`,
  `CREATE INDEX IF NOT EXISTS market_observations_created_at_idx
     ON market_observations (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS market_observations_candidate_idx
     ON market_observations (ingestion_candidate_id)`,

  `CREATE TABLE IF NOT EXISTS market_valuations (
    id                SERIAL PRIMARY KEY,
    module            TEXT NOT NULL,
    item_type         TEXT NOT NULL,
    item_id           INTEGER,
    valuation_method  TEXT NOT NULL DEFAULT 'median'
                        CHECK (valuation_method IN ('median','mean','weighted','manual')),
    estimated_value   NUMERIC(12,2) NOT NULL,
    value_low         NUMERIC(12,2),
    value_high        NUMERIC(12,2),
    currency          TEXT NOT NULL DEFAULT 'USD',
    sample_size       INTEGER,
    observation_ids   JSONB,
    valid_until       TIMESTAMPTZ,
    notes             TEXT,
    created_by        INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS market_valuations_module_item_idx
     ON market_valuations (module, item_type, item_id)`,
  `CREATE INDEX IF NOT EXISTS market_valuations_computed_at_idx
     ON market_valuations (computed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS market_watches (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
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
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS market_watches_user_idx
     ON market_watches (user_id)`,
  `CREATE INDEX IF NOT EXISTS market_watches_module_item_idx
     ON market_watches (module, item_type, item_id)`,
  `CREATE INDEX IF NOT EXISTS market_watches_enabled_idx
     ON market_watches (enabled)`,

  // ── Security: revoke public execute on auto_enable_rls() (#258) ──────────
  // This Supabase-created SECURITY DEFINER function must not be callable by
  // the anon or authenticated roles. Run idempotently — no-op if function
  // does not exist or already has the privilege revoked.
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'auto_enable_rls'
     ) THEN
       REVOKE EXECUTE ON FUNCTION public.auto_enable_rls() FROM anon, authenticated, PUBLIC;
     END IF;
   END $$`,

  // ── Phase 3 Step 2: Unified notification center (#235) ───────────────────

  `CREATE TABLE IF NOT EXISTS notification_events (
    id            SERIAL PRIMARY KEY,
    event_type    TEXT NOT NULL,
    module        TEXT NOT NULL,
    severity      TEXT NOT NULL DEFAULT 'informational'
                    CHECK (severity IN ('informational','attention','important','critical')),
    scope         TEXT NOT NULL DEFAULT 'household'
                    CHECK (scope IN ('household','personal')),
    subject_type  TEXT,
    subject_id    INTEGER,
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL,
    action_url    TEXT,
    action_label  TEXT,
    payload       JSONB,
    dedup_key     TEXT UNIQUE,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ,
    superseded_by INTEGER REFERENCES notification_events(id) ON DELETE SET NULL,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS notification_events_type_idx
     ON notification_events (event_type)`,
  `CREATE INDEX IF NOT EXISTS notification_events_module_idx
     ON notification_events (module)`,
  `CREATE INDEX IF NOT EXISTS notification_events_occurred_at_idx
     ON notification_events (occurred_at DESC)`,

  `CREATE TABLE IF NOT EXISTS notification_recipients (
    id                SERIAL PRIMARY KEY,
    event_id          INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
    user_id           INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    read_at           TIMESTAMPTZ,
    acknowledged_at   TIMESTAMPTZ,
    dismissed_at      TIMESTAMPTZ,
    snoozed_until     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS notification_recipients_user_idx
     ON notification_recipients (user_id)`,
  `CREATE INDEX IF NOT EXISTS notification_recipients_event_idx
     ON notification_recipients (event_id)`,
  `CREATE INDEX IF NOT EXISTS notification_recipients_unread_idx
     ON notification_recipients (user_id, created_at DESC)
     WHERE read_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id                  SERIAL PRIMARY KEY,
    recipient_id        INTEGER NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
    event_id            INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
    channel             TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
    status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','queued','sending','delivered',
                                            'failed_retryable','failed_terminal',
                                            'suppressed','cancelled')),
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    scheduled_at        TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    failure_class       TEXT,
    provider_message_id TEXT,
    idempotency_key     TEXT UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_recipient_idx
     ON notification_deliveries (recipient_id)`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_status_idx
     ON notification_deliveries (status)`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_channel_status_idx
     ON notification_deliveries (channel, status)`,

  `CREATE TABLE IF NOT EXISTS notification_preferences (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    scope                 TEXT NOT NULL DEFAULT 'global'
                            CHECK (scope IN ('global','module','event_type')),
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
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_global_idx
     ON notification_preferences (user_id)
     WHERE scope = 'global'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_module_idx
     ON notification_preferences (user_id, scope_value)
     WHERE scope = 'module'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_type_idx
     ON notification_preferences (user_id, scope_value)
     WHERE scope = 'event_type'`,
  `CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
     ON notification_preferences (user_id)`,

  // -------------------------------------------------------------------------
  // #236 Ornaments: canonical series catalog + identity research
  // -------------------------------------------------------------------------

  `CREATE TABLE IF NOT EXISTS ornament_series (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    brand                TEXT NOT NULL DEFAULT 'Hallmark',
    description          TEXT,
    start_year           INTEGER,
    end_year             INTEGER,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    total_known_entries  INTEGER,
    source_url           TEXT,
    source_authority     TEXT,
    is_provisional       BOOLEAN NOT NULL DEFAULT false,
    last_confirmed_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE ornament_series ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ornament_series_brand_idx ON ornament_series (brand)`,
  `CREATE INDEX IF NOT EXISTS ornament_series_name_idx  ON ornament_series (name)`,

  `CREATE TABLE IF NOT EXISTS ornament_series_entries (
    id               SERIAL PRIMARY KEY,
    series_id        INTEGER NOT NULL REFERENCES ornament_series(id) ON DELETE CASCADE,
    sequence_number  INTEGER,
    year             INTEGER NOT NULL,
    official_name    TEXT NOT NULL,
    catalog_number   TEXT,
    upc              TEXT,
    artist           TEXT,
    retail_price_usd NUMERIC(10,2),
    release_type     TEXT,
    is_exclusive     BOOLEAN NOT NULL DEFAULT false,
    notes            TEXT,
    source_url       TEXT,
    is_provisional   BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE ornament_series_entries ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ornament_series_entries_series_idx  ON ornament_series_entries (series_id)`,
  `CREATE INDEX IF NOT EXISTS ornament_series_entries_year_idx    ON ornament_series_entries (year)`,
  `CREATE INDEX IF NOT EXISTS ornament_series_entries_catalog_idx ON ornament_series_entries (catalog_number)`,

  `CREATE TABLE IF NOT EXISTS ornament_item_series_links (
    item_id             INTEGER PRIMARY KEY REFERENCES ornaments_items(id) ON DELETE CASCADE,
    series_entry_id     INTEGER NOT NULL REFERENCES ornament_series_entries(id) ON DELETE RESTRICT,
    confirmed_by_user_id INTEGER,
    confirmed_at        TIMESTAMPTZ,
    confidence          TEXT NOT NULL DEFAULT 'manual',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE ornament_item_series_links ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ornament_item_series_links_entry_idx ON ornament_item_series_links (series_entry_id)`,

  `CREATE TABLE IF NOT EXISTS ornament_identity_research (
    id                       SERIAL PRIMARY KEY,
    item_id                  INTEGER NOT NULL REFERENCES ornaments_items(id) ON DELETE CASCADE,
    status                   TEXT NOT NULL DEFAULT 'pending',
    candidates               JSONB NOT NULL DEFAULT '[]',
    selected_candidate_index INTEGER,
    decided_by_user_id       INTEGER,
    decided_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE ornament_identity_research ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS ornament_identity_research_item_idx ON ornament_identity_research (item_id)`,

  // -------------------------------------------------------------------------
  // #237 Quilting: fabric identifiers, pattern requirements, analysis runs
  // -------------------------------------------------------------------------

  `CREATE TABLE IF NOT EXISTS quilting_fabric_identifiers (
    id                    SERIAL PRIMARY KEY,
    fabric_id             INTEGER NOT NULL REFERENCES quilting_fabrics(id) ON DELETE CASCADE,
    identifier_type       TEXT NOT NULL,
    identifier_value      TEXT NOT NULL,
    source_url            TEXT,
    confirmed_by_user_id  INTEGER,
    confirmed_at          TIMESTAMPTZ,
    confidence            TEXT NOT NULL DEFAULT 'manual',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE quilting_fabric_identifiers ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_fabric_identifiers_fabric_idx    ON quilting_fabric_identifiers (fabric_id)`,
  `CREATE INDEX IF NOT EXISTS quilting_fabric_identifiers_type_val_idx  ON quilting_fabric_identifiers (identifier_type, identifier_value)`,

  `CREATE TABLE IF NOT EXISTS quilting_pattern_variants (
    id               SERIAL PRIMARY KEY,
    pattern_id       INTEGER NOT NULL REFERENCES quilting_patterns(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    finished_width   REAL,
    finished_height  REAL,
    size_unit        TEXT NOT NULL DEFAULT 'inches',
    block_count      INTEGER,
    skill_level      TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE quilting_pattern_variants ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_pattern_variants_pattern_idx ON quilting_pattern_variants (pattern_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_pattern_requirements (
    id                         SERIAL PRIMARY KEY,
    variant_id                 INTEGER NOT NULL REFERENCES quilting_pattern_variants(id) ON DELETE CASCADE,
    role                       TEXT NOT NULL,
    color_description          TEXT,
    quantity_yards             REAL,
    quantity_fat_quarters      REAL,
    width_assumption_inches    REAL DEFAULT 44,
    seam_allowance_inches      REAL DEFAULT 0.25,
    notes                      TEXT,
    is_extracted               BOOLEAN NOT NULL DEFAULT false,
    extraction_confidence      TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE quilting_pattern_requirements ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_pattern_requirements_variant_idx ON quilting_pattern_requirements (variant_id)`,

  `CREATE TABLE IF NOT EXISTS quilting_analyses (
    id                   SERIAL PRIMARY KEY,
    pattern_id           INTEGER NOT NULL REFERENCES quilting_patterns(id) ON DELETE CASCADE,
    variant_id           INTEGER REFERENCES quilting_pattern_variants(id) ON DELETE SET NULL,
    created_by_user_id   INTEGER,
    status               TEXT NOT NULL DEFAULT 'pending',
    readiness            TEXT,
    stash_snapshot_at    TIMESTAMPTZ,
    assumptions          JSONB NOT NULL DEFAULT '{}',
    requirement_rows     JSONB NOT NULL DEFAULT '[]',
    shopping_proposal    JSONB NOT NULL DEFAULT '[]',
    applied_at           TIMESTAMPTZ,
    applied_by_user_id   INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE quilting_analyses ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_analyses_pattern_idx    ON quilting_analyses (pattern_id)`,
  `CREATE INDEX IF NOT EXISTS quilting_analyses_created_at_idx ON quilting_analyses (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS quilting_fabric_identity_research (
    id                       SERIAL PRIMARY KEY,
    fabric_id                INTEGER NOT NULL REFERENCES quilting_fabrics(id) ON DELETE CASCADE,
    status                   TEXT NOT NULL DEFAULT 'pending',
    candidates               JSONB NOT NULL DEFAULT '[]',
    selected_candidate_index INTEGER,
    decided_by_user_id       INTEGER,
    decided_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE quilting_fabric_identity_research ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS quilting_fabric_identity_research_fabric_idx ON quilting_fabric_identity_research (fabric_id)`,

  // ---------------------------------------------------------------------------
  // #213 / #214 — eBay market-value cache on pottery_items and ornaments_items
  // ---------------------------------------------------------------------------
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS ebay_price_min_usd    NUMERIC(10,2)`,
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS ebay_price_max_usd    NUMERIC(10,2)`,
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS ebay_price_median_usd NUMERIC(10,2)`,
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS ebay_price_cached_at  TIMESTAMPTZ`,
  `ALTER TABLE pottery_items ADD COLUMN IF NOT EXISTS ebay_price_listings   JSONB`,

  `ALTER TABLE ornaments_items ADD COLUMN IF NOT EXISTS ebay_price_min_usd    NUMERIC(10,2)`,
  `ALTER TABLE ornaments_items ADD COLUMN IF NOT EXISTS ebay_price_max_usd    NUMERIC(10,2)`,
  `ALTER TABLE ornaments_items ADD COLUMN IF NOT EXISTS ebay_price_median_usd NUMERIC(10,2)`,
  `ALTER TABLE ornaments_items ADD COLUMN IF NOT EXISTS ebay_price_cached_at  TIMESTAMPTZ`,
  `ALTER TABLE ornaments_items ADD COLUMN IF NOT EXISTS ebay_price_listings   JSONB`,

  // ---------------------------------------------------------------------------
  // #215 — Etsy price-suggestion cache on quilting_shopping_items
  // ---------------------------------------------------------------------------
  `ALTER TABLE quilting_shopping_items ADD COLUMN IF NOT EXISTS etsy_price_suggestion_usd REAL`,
  `ALTER TABLE quilting_shopping_items ADD COLUMN IF NOT EXISTS etsy_price_cached_at      TIMESTAMPTZ`,
  `ALTER TABLE quilting_shopping_items ADD COLUMN IF NOT EXISTS etsy_price_listings        JSONB`,

  // ---------------------------------------------------------------------------
  // #216 — Flight price cache on travels_wishlist
  // ---------------------------------------------------------------------------
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS flight_origin_iata    TEXT`,
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS flight_price_min_usd  NUMERIC(10,2)`,
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS flight_price_cached_at TIMESTAMPTZ`,
  `ALTER TABLE travels_wishlist ADD COLUMN IF NOT EXISTS flight_price_options   JSONB`,

  // ---------------------------------------------------------------------------
  // #249 — Pottery marketplace watchlist
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS pottery_watchlist_items (
    id                   SERIAL PRIMARY KEY,
    created_by_user_id   INTEGER,
    title                TEXT NOT NULL,
    keywords             TEXT NOT NULL,
    price_min_usd        NUMERIC(10,2),
    price_max_usd        NUMERIC(10,2),
    active               BOOLEAN NOT NULL DEFAULT true,
    last_checked_at      TIMESTAMPTZ,
    last_alert_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE pottery_watchlist_items ENABLE ROW LEVEL SECURITY`,
  `CREATE INDEX IF NOT EXISTS pottery_watchlist_active_idx ON pottery_watchlist_items (active)`,
  `CREATE INDEX IF NOT EXISTS pottery_watchlist_user_idx   ON pottery_watchlist_items (created_by_user_id)`,

  `CREATE TABLE IF NOT EXISTS pottery_watchlist_alerts (
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
    seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed         BOOLEAN NOT NULL DEFAULT false
  )`,
  `ALTER TABLE pottery_watchlist_alerts ENABLE ROW LEVEL SECURITY`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pottery_watchlist_alerts_dedup_idx
    ON pottery_watchlist_alerts (watchlist_item_id, platform, listing_id)`,
  `CREATE INDEX IF NOT EXISTS pottery_watchlist_alerts_item_idx ON pottery_watchlist_alerts (watchlist_item_id)`,
];
