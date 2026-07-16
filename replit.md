# Batchelor App

Combined pnpm monorepo serving both the Pottery and Quilting collection apps under one domain (app.batchelor.app). Users log in once and access both apps.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run bootstrap` — idempotent schema bootstrap (CREATE IF NOT EXISTS only — safe to re-run)
- `pnpm --filter @workspace/scripts run backup-to-replit` — snapshot Supabase → Replit built-in DB
- `pnpm --filter @workspace/scripts run restore-from-replit -- --confirm` — restore Replit DB → Supabase (destructive, use with care)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM, hosted on Supabase (shared with pottery + quilting apps)
- Image storage: Supabase Storage — private buckets `pottery` and `quilting`
- Auth: email/password (bcrypt) + Google OAuth (shared single OAuth client)
- Email: Resend
- AI: OpenAI (vision + embeddings), OpenRouter, Jina, Voyage
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/` — single Express API server serving all apps' routes (pottery, quilting, travels, ornaments, hub, elaine, auth)
- `artifacts/modules/` — single consolidated web artifact serving pottery, quilting, travels, and ornaments under one `/modules` base path (each app still namespaced at `/modules/pottery`, `/modules/quilting`, `/modules/travels`, `/modules/ornaments`). The standalone `artifacts/pottery`, `artifacts/quilting`, `artifacts/travels`, and `artifacts/ornaments` artifacts were decommissioned and removed once `/modules` reached full parity.
- `artifacts/web/` — Hub app (app switcher, launcher, dashboard widgets)
- `artifacts/elaine/` — standalone Elaine AI assistant app (not merged into modules)
- Only 4 artifacts remain registered: `api-server`, `modules`, `web`, `elaine`
- `lib/db/` — shared Drizzle schema + bootstrap (pottery + quilting + travels + ornaments tables)
- `scripts/src/backup-to-replit.ts` — Supabase → Replit DB snapshot
- `scripts/src/restore-from-replit.ts` — restore from snapshot
- `scripts/post-merge.sh` — runs after every agent merge: install → bootstrap → backup
- `MERGE_HANDOFF_PROMPT.md` — prompt to extract handoff manifests from pottery/quilting Repls (historical; apps are now fully merged)

## Database layout (shared Supabase project: gadhlfluflknlwgmlmos)

| Prefix                               | Owned by       |
| ------------------------------------ | -------------- |
| `pottery_*`                          | Pottery app    |
| `quilting_*`                         | Quilting app   |
| `app_users`, `password_reset_tokens` | Shared (login) |

## Architecture decisions

- **Pottery, quilting, and travels data are fully household-shared.** Every authenticated user can view, create, edit, and delete any record in these apps — there is no per-user ownership boundary. `user_id` columns are retained only for insert attribution (who created a record), never used to filter/scope reads, writes, or deletes. This is intentional: the app has one household, not per-user tenants. See `threat_model.md` for the full security implications.
- **One Supabase, two namespaced table sets.** Pottery and quilting already share one Supabase project. The merge adds nothing to the DB — just consolidates the code that talks to it.
- **Additive-only migrations.** `bootstrap.ts` uses `CREATE TABLE IF NOT EXISTS` exclusively. `drizzle-kit push --force` is permanently banned (it introspects all tables and will silently drop the other app's tables).
- **Backup before publish.** `post-merge.sh` snapshots Supabase → built-in Replit DB after every merge. Embedding columns are excluded (not in Replit DB's pgvector). Regenerate via each app's Bulk Re-analyse.
- **Single Google OAuth client** shared by both apps. Redirect URI: `{host}/api/auth/google/callback`.
- **DATABASE_URL → Supabase; PG\* → Replit built-in DB.** Never swap these.
- **`travels.ts`'s trips/packing hooks were fully migrated to orval-generated hooks.** The ~42 duplicated names (trips + packing) that used to be hand-written in `lib/api-client-react/src/travels.ts` and shadowed by a disambiguation re-export block in `index.ts` have been deleted; all consuming pages now import the generated `Travels*` hooks/types directly from `@workspace/api-client-react`, adjusted for orval's mutation payload shapes (`{data}` for create, `{id,data}` for update, `{id,docId,data}` for nested document updates, etc.) and generated type names (e.g. `TravelsCreateTripBody`, `TravelsTrip`, `TravelsTripDetail`). The OpenAPI spec (`lib/api-spec/sources/travels.yaml`) was the source of several schema-drift fixes uncovered during migration (missing fields like `todoList`, `iconOverride`, document `title`/`documentType` on the PATCH body, `TravelsStatsResponse.nextTrip`, etc.) — always cross-check spec vs actual server route handler when a generated type appears to be missing a field the server accepts. `travels.ts` now only retains wishlist hooks and `useGetTripDocumentWalletPass`, which were never part of the overlap. The `check-travels-overlap` script and its CI guard have been removed since there is no longer any shadowing to drift out of sync.
- **Fabric tile vectorization uses "Max Detail" tuning as the enforced production default.** The `/fabrics/:id/tile-image` route calls `generateProductionFabricTile()` (`artifacts/api-server/src/lib/image.ts`), which wraps `generateFabricTileVectorizedTuned` with `DIRECTION_A_MAX_DETAIL_TUNING` and serves `image/svg+xml`. This is the single shared production pipeline for all fabric tile rendering across the hub/sub-apps — not a dev-only experiment. The separate dev comparison route (`fabric-compare.tsx`) still exists for evaluating tuning variants but does not affect the production path.
- **Screenshot-tool image auth is a real fix, not a documented limitation.** `tryScreenshotTokenAuth` (`artifacts/api-server/src/middleware/auth.ts`) accepts the dev screenshot token via `?screenshotToken=` query param in addition to the `X-Screenshot-Token` header. `installScreenshotImageAutoAuth()` (`lib/api-client-react/src/custom-fetch.ts`) is a dev-only global patch on `HTMLImageElement.prototype.src` and `Element.prototype.setAttribute`/`setAttributeNS` that auto-appends the token to every raw image URL app-wide (covers `<img>` tags and SVG `<image href>`), so the automated screenshot tool renders real images instead of 401s. Wired into all three frontend entrypoints (`modules`, `web`, `elaine`) before `createRoot(...).render`.
- **Elaine global config is admin-only, one row, cached.** `elaine_global_config` (singleton, id=1) holds chatModel/subagentModel/requestTimeoutMs/maxResponseTokens, editable only by `app_users.isOwner` accounts via `/api/elaine/admin/config` (GET/PUT) and `/api/elaine/admin/models` (OpenRouter model list, public REST API, 1hr cache). Reuses the existing isOwner-gating pattern from travel-calendar routes. Server-side config cache has a 30s TTL with safe hardcoded defaults as fallback.

## Product

- **Pottery app** — catalogue and AI-search a pottery collection (photos, categories, semantic search)
- **Quilting app** — catalogue fabrics, patterns, finished quilts; plan layouts; track shopping list
- Both apps share user accounts and run under one domain

## User preferences

- Replit is primary source of truth; GitHub (`malwaredevil/batchelorapp`) is backup + issue tracker
- Never run `drizzle-kit push --force` — ever
- Always run backup before any schema change or publish
- DATABASE_URL must point to the live Supabase (not the Replit built-in helium DB)
- All three "optional" AI secrets (OPENROUTER_API_KEY, JINA_API_KEY, VOYAGE_API_KEY) are required
- Legacy pre-migration rows with NULL `user_id` were backfilled to Jonathan Batchelor (`batchelorjc@gmail.com`, `app_users.id=4`, `isOwner=true`) as the attributed creator
- Single combined domain: app.batchelor.app (target), pottery.batchelor.app + quilting.batchelor.app (decommissioned after go-live)
- GitHub syncs from this sandbox must always batch every changed file into a single commit via the Git Data API — never loop the Contents API once per file. Per-file commits each independently trigger the full CI suite plus CodeQL, causing workflow pileups. Before every push, run the local pre-push gate (lint, typecheck, build, codegen-drift check) and fix everything it finds — see `github-backup-issue-tracking` skill for the exact steps. `ci.yml` also has `concurrency: cancel-in-progress` as a backstop.
- When the user has queued multiple feature requests, don't silently barrel from one to the next. If a step needs something from the user (a manual action, a confirmation, a choice), stop and ask a simple yes/no or short question via user_query before proceeding — don't let the queue push past unanswered questions.
- Pre-publish checklist — run this automatically every time before creating a checkpoint (or immediately after), without waiting to be asked. Gated in stages; do not move to the next stage until the current one passes:

  **Session start — always do this first:**
  - Check for a pending Stage 4: run `pnpm --filter @workspace/scripts run sentry-baseline check-pending-stage4`. If it exits with code 2, a publish happened in a prior session and Stage 4 was never completed. Do the Sentry delta check now (see Stage 4 below), then delete the file with `pnpm --filter @workspace/scripts run sentry-baseline clear`.

  **Stage 1 — review (manual steps first, then run the automated gate):**
  1. Sentry baseline: use the Sentry MCP tools to query open/unresolved issues. Record the count and IDs by running `pnpm --filter @workspace/scripts run sentry-baseline write <count> <comma-separated-ids>`. Fix any pre-existing issues before proceeding — they must not be left unresolved when the new release lands. This file persists across sessions so Stage 4 always has a real baseline to diff against.
  2. UI browsing / screenshots: always use the DEV_SCREENSHOT_TOKEN cookie-free bypass via `/api/dev/screenshot-login?token=<DEV_SCREENSHOT_TOKEN literal value>&next=<path>` — always allowed, no need to ask permission first. This works around the Secure+SameSite=None cookie drop on the internal HTTP preview. Must stay a plain (non-secret) env var so the agent can read its literal value — see `.agents/memory/screenshot-tool-cookie-bypass.md`. Fallback: `runTest()` interactive login or curl with `AGENT_LOGIN_EMAIL`/`AGENT_LOGIN_PASSWORD` against `https://$REPLIT_DEV_DOMAIN`.
  3. Deep end-to-end code review of everything added/changed (verify it works as intended, not just that it typechecks). Diff Replit vs GitHub if unsure what changed.
  4. Full E2E UI/UX testing of new/changed features using the screenshot-login path above. If unsure of scope, diff Replit vs GitHub to see exactly what changed. **BROKEN IMAGE RULE (mandatory):** In every screenshot, explicitly scan for `<img>` elements showing alt text (broken-image icon + text label) instead of the actual image. If ANY such element is visible, it is a real bug — investigate and fix immediately. Never assume a broken image is a screenshot-tool artifact without confirming via curl that the endpoint returns 200 + valid image bytes (e.g. `curl -I 'https://$REPLIT_DEV_DOMAIN/api/...'`). This rule applies even when the rest of the page looks correct.
  5. Services page review: if any new external API service was added or removed this session, update `artifacts/web/src/pages/services-catalog.tsx` (service name, purpose, modules, env vars, implementation paths). This is the canonical owner-visible record of all integrations.
  6. Run the automated pre-publish gate: `pnpm --filter @workspace/scripts run pre-publish`. This script runs in order and stops hard on first failure: (a) typecheck, (b) prettier --write + lint, (c) codegen drift, (d) app-config drift, (e) GitHub CI status. Do not skip this step or substitute individual manual checks — the script is the single enforced gate. Fix any failure before proceeding to Stage 2.

  **Stage 2 — DB safety (only after Stage 1 passes):** 7. Confirm the change cannot harm the shared production Supabase DB — no `drizzle-kit push --force`, additive-only migrations only.

  **Stage 3 — backup + GitHub sync (only after Stage 2 passes), in this exact order:**
  - 3a. Run the Supabase → Replit built-in DB backup: `pnpm --filter @workspace/scripts run backup-to-replit`.
  - 3b. Scan open GitHub issues for any completed this session and close them.
  - 3c. Batch-sync all changed files to GitHub in a **single commit** using `pnpm --filter @workspace/scripts run github-sync "commit message"`. This script: runs prettier --write on every changed file, creates one Git tree with all changes, pushes one commit, and triggers exactly one CI run. **Never** use the GitHub Contents API per-file (each file triggers its own CI run) or loop `git push` per file. The excluded paths (.local/, .agents/, threat_model.md) are enforced by the script.
  - 3d. Wait for GitHub CI to go fully green (all checks including CodeQL): `pnpm --filter @workspace/scripts run check-ci-status`. This is a hard stop — do not publish until this passes.

  **Publish:** only after all stages pass, call `suggest_deploy`. Immediately after calling suggest_deploy, run `pnpm --filter @workspace/scripts run sentry-baseline mark-published` to write the pending-stage4 file so Stage 4 survives a session boundary.

  **Stage 4 — post-publish Sentry delta check (after publishing):**
  Wait ~5 minutes for production traffic, then use Sentry MCP tools to check for issues that are NEW since the baseline written in Step 1. Compare against the IDs in `.local/state/sentry-baseline.json`. Look specifically at routes/features that changed. If new issues appear, fix them before considering the release stable. When done, clear state: `pnpm --filter @workspace/scripts run sentry-baseline clear`.

## Secrets checklist (for moving to a Team Workspace, or any new environment)

Names only — values must be re-entered manually in the new environment's Secrets tab, never copied through chat/code:

- `DATABASE_URL` — must point to Supabase, not the new workspace's built-in DB
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — shared OAuth client
- `GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`
- `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_POOLER_HOST`
- `SESSION_SECRET`
- `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `JINA_API_KEY`, `VOYAGE_API_KEY` (all required, not optional — see below)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REMINDER_FROM_EMAIL`
- `SENTRY_DSN`
- `GITHUB_PAT`
- `AGENTPHONE_API_KEY`, `AGENTPHONE_WEBHOOK_SECRET`
- `DEV_SCREENSHOT_TOKEN` (dev-only cookie-free login bypass — must be a plain env var, never a Replit secret, so the agent can read its literal value)
- `AGENT_LOGIN_EMAIL`, `AGENT_LOGIN_PASSWORD` (dev-only test login fallback)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — these back the Replit built-in DB used for backups; a new workspace provisions its own automatically, but re-run `pnpm --filter @workspace/scripts run backup-to-replit` after moving to repopulate it from Supabase

Secrets are per-Repl/per-workspace and do not carry over automatically on a move — this list must be manually re-entered.

## Gotchas

- `DATABASE_URL` is claimed by Replit's built-in DB — must be manually overridden in the Secrets tab to point at Supabase
- Replit's network sandbox blocks direct Postgres connections (port 5432/6543) — use Supabase REST API or the pooler via the app server; `pg` client works only from deployed app, not from bash/scripts in dev
- Secrets are per-Repl, not shared across separate Repls — pottery and quilting Repl secrets did not carry over here automatically
- pgvector is enabled in Supabase but unavailable in the Replit built-in DB — backup excludes `embedding` and `visual_embedding` columns
- Quilting uses both `embedding` (1536-dim, text) and `visual_embedding` (1024-dim, image) on fabrics and patterns

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `MERGE_HANDOFF_PROMPT.md` for the prompt to run in each existing app before merging code
