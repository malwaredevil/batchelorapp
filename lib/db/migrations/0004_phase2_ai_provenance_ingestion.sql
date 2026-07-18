-- Phase 2 EPIC (#220): AI provenance (#229), ingestion framework (#230),
-- document evidence (#232), search feedback (#233).
-- All statements are additive only — no DROP, TRUNCATE, or destructive DDL.
-- Safe to re-run; all tables/indexes/columns use IF NOT EXISTS guards.

-- ============================================================
-- #229 — AI provenance: generation runs, field candidates, decisions
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id serial PRIMARY KEY,
  module text NOT NULL,
  feature text NOT NULL,
  target_type text NOT NULL,
  target_id integer,
  job_id integer REFERENCES app_jobs(id) ON DELETE SET NULL,
  operation_event_id integer REFERENCES external_operation_events(id) ON DELETE SET NULL,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  model_provider_run_id text,
  prompt_template_id text,
  prompt_version_hash text,
  tool_schema_version integer NOT NULL DEFAULT 1,
  input_artifact_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_generation_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_generation_runs_target_idx ON ai_generation_runs (target_type, target_id);
CREATE INDEX IF NOT EXISTS ai_generation_runs_module_feature_idx ON ai_generation_runs (module, feature);
CREATE INDEX IF NOT EXISTS ai_generation_runs_created_at_idx ON ai_generation_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS ai_field_candidates (
  id serial PRIMARY KEY,
  generation_run_id integer NOT NULL REFERENCES ai_generation_runs(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id integer,
  field_path text NOT NULL,
  candidate_value jsonb,
  normalized_value_hash text,
  confidence_score numeric(5, 4),
  confidence_method text,
  authority_class text NOT NULL DEFAULT 'vision',
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  disposition text NOT NULL DEFAULT 'proposed',
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_field_candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_field_candidates_run_idx ON ai_field_candidates (generation_run_id);
CREATE INDEX IF NOT EXISTS ai_field_candidates_target_field_idx ON ai_field_candidates (target_type, target_id, field_path);
CREATE INDEX IF NOT EXISTS ai_field_candidates_disposition_idx ON ai_field_candidates (disposition);

CREATE TABLE IF NOT EXISTS ai_field_decisions (
  id serial PRIMARY KEY,
  candidate_id integer NOT NULL REFERENCES ai_field_candidates(id) ON DELETE CASCADE,
  deciding_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  decision_type text NOT NULL,
  prior_value jsonb,
  final_value jsonb,
  correction_category text,
  context_source text NOT NULL DEFAULT 'manual_edit',
  decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_field_decisions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_field_decisions_candidate_idx ON ai_field_decisions (candidate_id);
CREATE INDEX IF NOT EXISTS ai_field_decisions_user_idx ON ai_field_decisions (deciding_user_id);

-- ============================================================
-- #230 — Ingestion framework: sources, runs, candidates
-- ============================================================

CREATE TABLE IF NOT EXISTS ingestion_sources (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  adapter_type text NOT NULL,
  adapter_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_schema_version integer NOT NULL DEFAULT 1,
  module text NOT NULL,
  feature text,
  enabled boolean NOT NULL DEFAULT true,
  owner_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ingestion_sources ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_sources_slug_idx ON ingestion_sources (slug);
CREATE INDEX IF NOT EXISTS ingestion_sources_module_idx ON ingestion_sources (module);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id serial PRIMARY KEY,
  source_id integer NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
  job_id integer REFERENCES app_jobs(id) ON DELETE SET NULL,
  triggered_by integer REFERENCES app_users(id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  items_fetched integer NOT NULL DEFAULT 0,
  items_matched integer NOT NULL DEFAULT 0,
  items_merged integer NOT NULL DEFAULT 0,
  items_rejected integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx ON ingestion_runs (source_id);
CREATE INDEX IF NOT EXISTS ingestion_runs_status_idx ON ingestion_runs (status);
CREATE INDEX IF NOT EXISTS ingestion_runs_created_at_idx ON ingestion_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_candidates (
  id serial PRIMARY KEY,
  run_id integer NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  source_id integer NOT NULL REFERENCES ingestion_sources(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  target_type text,
  target_id integer,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric(5, 4),
  status text NOT NULL DEFAULT 'pending',
  matched_at timestamptz,
  merged_at timestamptz,
  rejected_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ingestion_candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ingestion_candidates_run_idx ON ingestion_candidates (run_id);
CREATE INDEX IF NOT EXISTS ingestion_candidates_target_idx ON ingestion_candidates (target_type, target_id);
CREATE INDEX IF NOT EXISTS ingestion_candidates_status_idx ON ingestion_candidates (status);
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_candidates_source_key_idx ON ingestion_candidates (source_id, source_key);

-- ============================================================
-- #232 — Travel document source spans (evidence for extracted fields)
-- ============================================================

ALTER TABLE travels_trip_documents
  ADD COLUMN IF NOT EXISTS source_spans jsonb;

-- ============================================================
-- #233 — Search feedback (similarity/duplicate votes)
-- ============================================================

CREATE TABLE IF NOT EXISTS search_feedback (
  id serial PRIMARY KEY,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  module text NOT NULL,
  item_a_type text NOT NULL,
  item_a_id integer NOT NULL,
  item_b_type text NOT NULL,
  item_b_id integer NOT NULL,
  verdict text NOT NULL,
  weight numeric(4, 3) NOT NULL DEFAULT 1.0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE search_feedback ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS search_feedback_module_idx ON search_feedback (module);
CREATE INDEX IF NOT EXISTS search_feedback_items_idx ON search_feedback (item_a_type, item_a_id, item_b_type, item_b_id);
CREATE UNIQUE INDEX IF NOT EXISTS search_feedback_pair_user_idx ON search_feedback (user_id, item_a_type, item_a_id, item_b_type, item_b_id);
