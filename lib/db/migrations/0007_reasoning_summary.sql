ALTER TABLE elaine_history_messages
  ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;
-- Null for user messages and for all rows written before this migration.
-- Surfaced as the collapsible "Thinking..." disclosure in the chat UI.
