ALTER TABLE travels_google_calendar_connections
  ADD COLUMN IF NOT EXISTS needs_reauth boolean NOT NULL DEFAULT false;
-- Set when a refresh token refresh fails with invalid_grant (revoked/expired).
-- Cleared when the user completes a new OAuth connect flow.
-- Used by the API to return tokenExpired:true in the calendar status response
-- so the frontend can show a "Reconnect Google Calendar" prompt immediately,
-- and to avoid hammering event endpoints known to be broken.
