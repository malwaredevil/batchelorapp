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
  `CREATE TABLE IF NOT EXISTS quilting_sessions (
    sid    VARCHAR   NOT NULL COLLATE "default",
    sess   JSON      NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    CONSTRAINT quilting_session_pkey PRIMARY KEY (sid)
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_quilting_session_expire ON quilting_sessions (expire)`,
  `ALTER TABLE quilting_sessions ENABLE ROW LEVEL SECURITY`,

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
    locked_fields    TEXT[] NOT NULL DEFAULT '{}',
    embedding        vector(1536),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_patterns ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_patterns ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}'`,
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
    locked_fields  TEXT[] NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE quilting_finished_quilts ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE quilting_finished_quilts ADD COLUMN IF NOT EXISTS locked_fields TEXT[] NOT NULL DEFAULT '{}'`,

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

  // ── Visual embeddings (Jina CLIP v2, 1024-dim) ──────────────────────────────
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
];
