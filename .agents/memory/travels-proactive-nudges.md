---
name: elAIne proactive nudges architecture
description: How unprompted assistant messages (nudges) get from a background job into the chat UI and badge
---

Proactive assistant messages (elAIne speaking without being asked) are implemented as a
separate dedup'd table, not by writing directly into the conversation history from the
background job.

**Why:** The job that detects nudge-worthy conditions (e.g. "trip starts soon, packing
list empty") runs on a timer and must be idempotent — it can't know whether its output
has already been shown. Writing straight into the conversation's jsonb messages array
would require diffing to avoid duplicates. A separate table with a unique
`(user_id, nudge_key)` index makes re-running the job trivially safe (`ON CONFLICT DO
NOTHING`), and a `seen_at` column tracks delivery independently of chat history mutation.

**How to apply:**

- Background job only inserts candidate rows; it never touches the conversation table.
- The read path that the client already polls/fetches (here: `GET
/assistant/conversation`) is responsible for folding unseen rows into the visible
  chat history and marking them seen, atomically, in the same request — that's the
  single moment a nudge "becomes real" to the user.
- A separate lightweight `unseen-count` endpoint (not the full conversation) backs a
  UI badge, so simply checking for a badge never consumes the nudge — only actually
  opening the widget does.
- Same reliability pattern as reminder emails: an in-process hourly scheduler is only a
  best-effort fallback since autoscale instances sleep; pair it with a call from the
  existing Scheduled Deployment script so proactive nudges don't silently stop firing
  when no instance happens to be warm.
