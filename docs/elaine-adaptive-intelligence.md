# Elaine adaptive-intelligence rollout

This is the owner/Replit handoff for programme #352, wave #355. It preserves
Elaine's existing app capabilities while adding source-aware answers,
trustworthy scoped memory, and durable background research.

## What changes

- Current questions use an explicit source order: screen context, Batchelor App
  data, connected first-party providers, specialized APIs, public web, then
  model synthesis.
- Current claims require a successful retrieved observation. Failed preferred
  sources produce a deliberate fallback and a visible limitation.
- Memory is selected by user scope, lexical relevance, confidence, recency, and
  explicit provenance. Elaine no longer silently turns model-inferred facts
  into permanent memory.
- Remember is explicit. Correct and forget require the existing action
  confirmation flow and leave an audit event.
- Multi-search work can become a confirmed `elaine.research` task. It uses the
  existing `app_jobs` queue, checkpoints each query, skips completed queries on
  retry, fences writes to the active lease, and can be cancelled by its owner.
- The Elaine app exposes `/tasks` for progress, results, citations, and
  cancellation.
- The owner-only `GET /api/elaine/diagnostics` endpoint returns 30-day aggregate
  counts only. It never returns prompts, memory contents, tool payloads, or raw
  provider errors.

## Database migration

`lib/db/migrations/0005_elaine_adaptive_intelligence.sql` is additive and
idempotent:

- adds provenance, freshness, confidence, and correction linkage to
  `elaine_memory`;
- creates the append-only `elaine_memory_events` audit table;
- adds source route and sanitized observations to `elaine_turn_traces`.

Existing code ignores these objects, and existing memories receive
`source = 'legacy'`. No table, column, policy, or household row is removed.
Do not run `drizzle-kit push`.

## Replit deployment checklist

1. Review the GitHub PR and all linked issues (#355, #361, #362, #363).
2. Confirm every required GitHub check is green, then merge the PR in GitHub.
3. Pull the merged GitHub `main` into the Repl. Do not push a separate Replit
   implementation over the reviewed GitHub code.
4. Install dependencies if the lockfile requires it, build the full workspace,
   and restart the API and web processes.
5. Confirm `startup-migrate` completes without errors and the runtime becomes
   ready. The startup sequence must finish additive schema statements before
   starting the `ai` worker.
6. Perform the smoke tests below.

## Smoke tests

Use invented/non-sensitive text for tests.

1. Ask a stable general question. Elaine should answer without unnecessary
   tools.
2. Ask for the current status of a household trip. Elaine should prefer app
   data over public web search.
3. Ask a current public-information question. The plan panel should show a live
   source route and at least one successful evidence source.
4. Explicitly ask Elaine to remember a personal preference. Confirm it appears
   on `/memory` with personal scope and explicit provenance.
5. Ask to correct that preference. Elaine must list/find the exact memory,
   present a confirmation card, and preserve only the corrected active fact.
6. Ask to forget the test memory. It must require confirmation and disappear
   from the active Memory page.
7. Ask for multi-source background research. Confirm the proposal, open
   `/tasks`, and watch it move from queued/running to completed or a truthful
   blocked state. Verify citations open.
8. Start another test task and cancel it from `/tasks`. It must stop changing
   after cancellation.
9. As the app owner, load `GET /api/elaine/diagnostics`. Confirm it returns
   counts and no household text.
10. Recheck representative legacy actions in Travels, Pottery, Quilting,
    Ornaments, Office, notifications, widgets, and navigation.

## Rollback and cleanup

If application behavior regresses, redeploy the prior application commit. The
additive database objects remain compatible with that code and must not be
dropped during an incident. Track any later removal of temporary compatibility
reads in cleanup ledger #364 and use a separate reviewed forward migration.
