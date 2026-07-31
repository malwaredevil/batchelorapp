ALTER TABLE elaine_history_conversations
  ADD COLUMN IF NOT EXISTS openai_last_response_id text;
ALTER TABLE elaine_history_conversations
  ADD COLUMN IF NOT EXISTS openai_state_model text;
ALTER TABLE elaine_history_conversations
  ADD COLUMN IF NOT EXISTS openai_state_updated_at timestamptz;
