# GitHub Copilot Instructions — Batchelor App

This file is automatically loaded by GitHub Copilot when working in this repository.
For the full implementation guide, read `AGENTS.md` in the repo root first.

---

## Quick-reference prohibitions (full list in AGENTS.md §2)

- **NEVER** run `drizzle-kit push` or `drizzle-kit push --force` — it will wipe the shared Supabase database
- **NEVER** commit files matching `.agents/`, `.local/`, `threat_model.md`, `.env`
- **NEVER** add `new OpenAI(...)` calls — use `artifacts/api-server/src/lib/ai-client.ts` (OpenRouter only)
- **NEVER** add raw `fetch('/api/...')` in frontend artifacts — use generated hooks from `@workspace/api-client-react`
- **NEVER** push directly to `main` — use the campaign branch for your current work
- **NEVER** add `passOnStoreError: true` to rate limiters
- **NEVER** shrink `RESTRICTED_EXCLUDED_ACTION_TYPES` in `artifacts/api-server/src/elaine/index.ts`

## Required after every change

```bash
pnpm run typecheck                          # after any .ts/.tsx change
pnpm --filter @workspace/api-spec run codegen  # after any change to lib/api-spec/sources/*.yaml
```

## STOP Gate Protocol

When an issue body contains a "STOP GATE" section:
1. Ask the user: "Have you completed all manual steps in issue #NNN? Reply YES when done."
2. Do not write any code until the user replies YES.
3. Run the specified verification script.
4. If it exits 1: stop, report every failure, do not continue until user confirms it passes.

## Campaign branches

| Campaign | Branch | Issues |
|---|---|---|
| 1 — Quick wins | `feat/batch-quick-wins` | #244, #247, #253, #245, #248, #251, #243, #250, #252 |
| 2A — Search quality | `feat/epic-241-search-quality` | #246, then #254 |
| 2B — Elaine tools | `feat/epic-242-elaine-completeness` | #255, then #256 |
| 3 — Strategic Phase 1 | `feat/strategic-phase1` | #257→#258→#223→#224→#225→#226→#227→#228 |

## Intentional patterns — do not flag these

- Missing `requireAuth` on `/api/agentphone/webhook` and `/api/elaine/email-webhook` — uses HMAC auth instead
- Missing per-user ownership filters on pottery/quilting/ornaments/travels routes — household-shared by design
- `OPENAI_API_KEY` present but unused — kept for future use, all calls go through OpenRouter
- Dev-only `installScreenshotImageAutoAuth` patching `HTMLImageElement.prototype.src` — gated by `NODE_ENV`
- Email webhook router mounted before the `/elaine` session-auth router — this is a security control

See `AGENTS.md` §4 for the full list of intentional architecture decisions.
