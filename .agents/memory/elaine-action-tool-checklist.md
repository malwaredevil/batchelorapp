---
name: Elaine action tool addition checklist
description: The full set of touchpoints in artifacts/api-server/src/elaine/index.ts that must all be updated together when adding a new Elaine chat-widget action tool.
---

Adding one new Elaine action (a chat-tool the model can call to write data, confirmed via the existing confirm/destructive-action UI) requires touching ALL of these in `artifacts/api-server/src/elaine/index.ts`, or the action will silently misbehave (parse error, mislabeled confirmation card, "not implemented" 500, or — worse — accidentally reachable from the unattended AgentPhone SMS/voice channel):

1. A Zod payload schema + `type: z.literal("...")` entry.
2. Add it to the `ActionBody` discriminated union.
3. Add a `buildActionLabel` switch case (drives the confirmation-card text shown before execution).
4. Add an executor function to `TRAVEL_ACTION_EXECUTORS` (or the relevant per-app executor map) — mirror the equivalent hand-written REST route's authorization exactly: household-shared data (trips, photos, share links) must NOT filter by userId; personal-preference data (card layout/collapse, dashboard prefs) MUST filter by userId, matching threat_model.md's household-sharing boundary.
5. Add a JSON-schema tool definition to `ACTION_TOOLS` (name/description/parameters) — the description is the only place destructiveness is communicated (no code-level "destructive" flag exists), so state explicitly in prose when an action can't be undone.
6. If the action introduces a new in-app path the model might navigate to, update `NAVIGATE_ALLOWED_PATHS_BY_APP` and `NAVIGATE_PATH_RE_BY_APP` for that app.
7. Add/update a paragraph in the system prompt's per-topic instructions section (near REMINDERS/ITINERARY/CALENDAR) explaining when to call it and what ids must be visible on screen first.
8. Update the system prompt's "APP MAP" section if a page's purpose changed.
9. **Explicitly confirm the new action type is NOT added to `AGENTPHONE_ACTION_TYPES`** unless it's a deliberate, reviewed addition — this allowlist is the sole guard keeping the unattended phone channel restricted to non-destructive actions (see threat_model.md Elevation of Privilege section). Missing this step is not an error TypeScript will catch.

Verify end-to-end with curl against `POST /api/elaine/action` (see `elaine-action-verification-via-curl.md`), not just typecheck — the executor's DB scoping logic can't be checked statically.
