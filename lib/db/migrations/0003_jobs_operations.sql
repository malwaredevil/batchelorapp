-- Purpose: create durable job and external-provider observability tables.
-- Preconditions: baseline application tables exist.
-- Compatibility: additive only; API code can run with empty tables.
-- Recovery: forward corrective migration; no down migration is provided.

CREATE TABLE IF NOT EXISTS app_jobs (
  id serial PRIMARY KEY,
  type text NOT NULL,
  queue text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_schema_version integer NOT NULL DEFAULT 1,
  idempotency_key text,
  created_by_user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  domain text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  progress_percent integer NOT NULL DEFAULT 0,
  progress_message text,
  last_error_code text,
  last_error_message text,
  provider_request_id text,
  parent_job_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS app_jobs_status_scheduled_idx ON app_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS app_jobs_type_status_idx ON app_jobs (type, status);
CREATE INDEX IF NOT EXISTS app_jobs_parent_idx ON app_jobs (parent_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS app_jobs_idempotency_idx ON app_jobs (type, idempotency_key);

CREATE TABLE IF NOT EXISTS app_job_attempts (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES app_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE app_job_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS app_job_attempts_job_idx ON app_job_attempts (job_id);

CREATE TABLE IF NOT EXISTS external_operation_events (
  id serial PRIMARY KEY,
  provider text NOT NULL,
  operation text NOT NULL,
  model_or_actor text,
  feature text NOT NULL,
  module text NOT NULL,
  user_id integer REFERENCES app_users(id) ON DELETE SET NULL,
  request_id text,
  job_id integer REFERENCES app_jobs(id) ON DELETE SET NULL,
  parent_job_id integer,
  status text NOT NULL,
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  retry_count integer NOT NULL DEFAULT 0,
  cache_status text NOT NULL DEFAULT 'not_applicable',
  input_units integer,
  output_units integer,
  billed_units numeric(18, 6),
  estimated_cost_usd numeric(18, 8),
  actual_cost_usd numeric(18, 8),
  currency text NOT NULL DEFAULT 'USD',
  pricing_version_at timestamptz,
  provider_request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE external_operation_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS external_operation_events_provider_created_idx ON external_operation_events (provider, created_at);
CREATE INDEX IF NOT EXISTS external_operation_events_job_idx ON external_operation_events (job_id);
CREATE INDEX IF NOT EXISTS external_operation_events_module_feature_idx ON external_operation_events (module, feature);

CREATE TABLE IF NOT EXISTS external_provider_pricing (
  id serial PRIMARY KEY,
  provider text NOT NULL,
  operation text NOT NULL,
  model_or_actor text,
  unit_type text NOT NULL,
  price_usd numeric(18, 8) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE external_provider_pricing ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS external_provider_pricing_lookup_idx ON external_provider_pricing (provider, operation, model_or_actor, effective_from);

CREATE TABLE IF NOT EXISTS external_budget_policies (
  id serial PRIMARY KEY,
  scope text NOT NULL,
  scope_value text,
  period text NOT NULL,
  soft_threshold_usd numeric(18, 2) NOT NULL,
  hard_threshold_usd numeric(18, 2) NOT NULL,
  warning_policy text NOT NULL DEFAULT 'owner_dashboard',
  degradation_action text NOT NULL DEFAULT 'warn_only',
  enabled boolean NOT NULL DEFAULT true,
  override_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE external_budget_policies ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS external_budget_policies_scope_idx ON external_budget_policies (scope, scope_value);
