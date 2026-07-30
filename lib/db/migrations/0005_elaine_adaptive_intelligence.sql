ALTER TABLE elaine_memory
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy';
ALTER TABLE elaine_memory
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz;
ALTER TABLE elaine_memory
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3) NOT NULL DEFAULT 0.500;
ALTER TABLE elaine_memory
  ADD COLUMN IF NOT EXISTS correction_of_id integer;
CREATE INDEX IF NOT EXISTS elaine_memory_confirmed_idx
  ON elaine_memory (last_confirmed_at DESC)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS elaine_memory_events (
  id serial PRIMARY KEY,
  memory_id integer REFERENCES elaine_memory(id) ON DELETE SET NULL,
  previous_memory_id integer,
  user_id integer NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE elaine_memory_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE elaine_memory_events FROM anon;
REVOKE ALL ON TABLE elaine_memory_events FROM authenticated;
CREATE INDEX IF NOT EXISTS elaine_memory_events_memory_idx
  ON elaine_memory_events (memory_id);
CREATE INDEX IF NOT EXISTS elaine_memory_events_user_created_idx
  ON elaine_memory_events (user_id, created_at DESC);

ALTER TABLE elaine_turn_traces
  ADD COLUMN IF NOT EXISTS source_route jsonb;
ALTER TABLE elaine_turn_traces
  ADD COLUMN IF NOT EXISTS observations jsonb NOT NULL DEFAULT '[]'::jsonb;
