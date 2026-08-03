# Batchelor App

Combined pnpm monorepo serving both the Pottery and Quilting collection apps under one domain (app.batchelor.app). Users log in once and access both apps.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run bootstrap` — idempotent schema bootstrap (CREATE IF NOT EXISTS only — safe to re-run)

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

## Database layout

| Prefix                               | Owned by       |
| ------------------------------------ | -------------- |
| `pottery_*`                          | Pottery app    |
| `quilting_*`                         | Quilting app   |
| `app_users`, `password_reset_tokens` | Shared (login) |

## Architecture decisions

- **Composition and configuration is the highest-priority design rule after safety and data integrity.** "Write Once, Use Everywhere." Every feature, repair, refactor, PR review, GitHub sync, and pre-publishing task begins with a monorepo-wide search for existing shared behavior. This rule is hardwired and takes precedence from here on.

  **Mandatory search-first workflow — do this before writing any code:**
  1. `grep -r "the thing you are about to implement" artifacts/ lib/` — find any existing implementation.
  2. If it exists in one place: import and configure it; never copy it.
  3. If it exists in two or more places already: extract it to the narrowest appropriate `lib/*` package first, then replace both copies.
  4. If it is genuinely new: implement it once in `lib/*` (or a focused server library for server-only code), then wire in domain-specific behavior through typed props, callbacks, adapters, slots, or small wrappers.
  5. If the new shared mechanism is worth protecting: add a boundary to `scripts/src/check-domain-composition.ts` **in the same change** — not a follow-up.
  6. Run `pnpm --filter @workspace/scripts run check-domain-composition` before committing.

  **Specific banned patterns — the automated guard detects these in any file:**
  - `Sentry.init(` anywhere except `lib/web-core/src/sentry.ts` and `artifacts/api-server/src/instrument.ts`. Use `initBrowserMonitoring()` from `@workspace/web-core/sentry` in all SPA bundles.
  - `new OpenAI(` in any file under `artifacts/api-server/src/routes/`. Route handlers must import `getOpenRouterClient()` or `callModel()` from `lib/ai-client.ts`.
  - `usePageAssistantContext` in a new `.tsx` page file without importing `formatElaineContextList` from `@workspace/elaine-ui`. Never build the context string with inline `.join()` or `.slice().map()`.

  **Enrollment rule:** Every new `lib/*` export that two or more domains will consume must have a corresponding boundary in `check-domain-composition.ts` added in the same PR/commit. A shared mechanism without an enrolled check is incomplete.

  **Pre-publishing:** `pre-publish.sh` runs `check-domain-composition` as a blocking parallel gate. No sync or publish may proceed if it fails. This rule applies to repairs and refactors made during the pre-publishing checklist too.

  See `docs/composition-and-configuration.md` for the full decision order, review questions, accepted/rejected examples, and the list of currently protected boundaries.

- **Pottery, quilting, and travels data are fully household-shared.** Every authenticated user can view, create, edit, and delete any record in these apps — there is no per-user ownership boundary. `user_id` columns are retained only for insert attribution (who created a record), never used to filter/scope reads, writes, or deletes. This is intentional: the app has one household, not per-user tenants. See `threat_model.md` for the full security implications.
- **One Supabase, two namespaced table sets.** Pottery and quilting already share one Supabase project. The merge adds nothing to the DB — just consolidates the code that talks to it.
- **Additive-only migrations.** `bootstrap.ts` uses `CREATE TABLE IF NOT EXISTS` exclusively. `drizzle-kit push --force` is permanently banned (it introspects all tables and will silently drop the other app's tables).
- **Backup before publish.** `post-merge.sh` snapshots Supabase → built-in Replit DB after every merge. Embedding columns are excluded (not in Replit DB's pgvector). Regenerate via each app's Bulk Re-analyse.
- **Single Google OAuth client** shared by both apps. Redirect URI: `{host}/api/auth/google/callback`.
- **DATABASE_URL → Supabase; PG\* → Replit built-in DB.** Never swap these.
- **`travels.ts`'s trips/packing hooks were fully migrated to orval-generated hooks.** The ~42 duplicated names (trips + packing) that used to be hand-written in `lib/api-client-react/src/travels.ts` and shadowed by a disambiguation re-export block in `index.ts` have been deleted; all consuming pages now import the generated `Travels*` hooks/types directly from `@workspace/api-client-react`, adjusted for orval's mutation payload shapes (`{data}` for create, `{id,data}` for update, `{id,docId,data}` for nested document updates, etc.) and generated type names (e.g. `TravelsCreateTripBody`, `TravelsTrip`, `TravelsTripDetail`). The OpenAPI spec (`lib/api-spec/sources/travels.yaml`) was the source of several schema-drift fixes uncovered during migration (missing fields like `todoList`, `iconOverride`, document `title`/`documentType` on the PATCH body, `TravelsStatsResponse.nextTrip`, etc.) — always cross-check spec vs actual server route handler when a generated type appears to be missing a field the server accepts. `travels.ts` now only retains wishlist hooks and `useGetTripDocumentWalletPass`, which were never part of the overlap. The `check-travels-overlap` script and its CI guard have been removed since there is no longer any shadowing to drift out of sync.
- **Fabric tile vectorization uses "Max Detail" tuning as the enforced production default.** The `/fabrics/:id/tile-image` route calls `generateProductionFabricTile()` (`artifacts/api-server/src/lib/image.ts`), which wraps `generateFabricTileVectorizedTuned` with `DIRECTION_A_MAX_DETAIL_TUNING` and serves `image/svg+xml`. This is the single shared production pipeline for all fabric tile rendering across the hub/sub-apps — not a dev-only experiment.

## Product

- **Pottery app** — catalogue and AI-search a pottery collection (photos, categories, semantic search)
- **Quilting app** — catalogue fabrics, patterns, finished quilts; plan layouts; track shopping list
- Both apps share user accounts and run under one domain

## User preferences

- When requesting missing secrets, prompt for them ONE at a time (name + short description of what it's for), never as a single bulk multi-field form.

- Replit is primary source of truth; GitHub (`malwaredevil/batchelorapp`) is backup + issue tracker
- **"Repo" ambiguity safeguard:** if the user says "repo" (or "the repository") without specifying which one, ask for clarification before acting — do not assume it means the Replit workspace or the GitHub repo (`malwaredevil/batchelorapp`). These are two distinct things with their own git history, and background task agents plus GitHub-side automation (e.g. Dependabot auto-merge) can each move independently, so guessing wrong risks pushing/reverting changes in the wrong place.
- Never run `drizzle-kit push --force` — ever
- Always run backup before any schema change or publish
- DATABASE_URL must point to the live Supabase (not the Replit built-in helium DB)
- All three "optional" AI secrets (OPENROUTER_API_KEY, JINA_API_KEY, VOYAGE_API_KEY) are required
- Legacy pre-migration rows with NULL `user_id` were backfilled to the owner account (`app_users.isOwner=true`) as the attributed creator
- Single combined domain: app.batchelor.app (target), pottery.batchelor.app + quilting.batchelor.app (decommissioned after go-live)
- When the user has queued multiple feature requests, don't silently barrel from one to the next. If a step needs something from the user (a manual action, a confirmation, a choice), stop and ask a simple yes/no or short question via user_query before proceeding — don't let the queue push past unanswered questions.
- **Architecture roadmap maintenance (standard procedure for ALL code changes):** `.agents/architecture/ARCHITECTURE.md` is the agent-internal map of URL routing, artifacts/ports, shared-lib consumers, scripts, env layout, and debug fast-paths (never synced to GitHub — `.agents/` is excluded). Whenever a change touches routing, artifact structure, workflows, shared libs, API contracts, scripts, or environment configuration, update that doc in the same commit. `pre-publish.sh` Step 0 warns when the doc is older than the latest structural change.
- Pre-publish checklist — run this automatically every time before creating a checkpoint (or immediately after), without waiting to be asked. Gated in stages; do not move to the next stage until the current one passes:

  **Session start — always do these first, in order:**
  - Check for a pending Stage 4: run `pnpm --filter @workspace/scripts run sentry-baseline check-pending-stage4`. If it exits with code 2, a publish happened in a prior session and Stage 4 was never completed. Do the Sentry delta check now (see Stage 4 below), then delete the file with `pnpm --filter @workspace/scripts run sentry-baseline clear`.
  - **Security baseline (mandatory):** Before doing any work, record the current counts of open security alerts so Stage 3e can tell what's net-new vs pre-existing. Run all three in one pass:
    ```
    echo "Dependabot:"; curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/dependabot/alerts?state=open&per_page=50" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'open')"
    echo "Code scanning:"; curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/code-scanning/alerts?state=open&per_page=50" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'open')"
    echo "Secret scanning:"; curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/secret-scanning/alerts?state=open&per_page=50" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'open')"
    ```
    **If any secret-scanning alert is open, stop immediately — rotate that secret before any other work.** Note the baseline counts; at Stage 3e, verify the counts haven't increased.
  - **Bot-created GitHub issue scan (mandatory):** Query open issues and look for any created by bots or automated tools (Dependabot, GitHub Actions, CodeQL, Seer, etc.) using: `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/issues?state=open&per_page=50" | jq '[.[] | select(.pull_request == null) | {number: .number, title: .title, user: .user.login}]'`. For each bot-created issue: triage it immediately if straightforward, fix it if the fix is small, or surface it to the user now (not after publishing) if it needs discussion.

  **Stage 1 — review (manual steps first, then run the automated gate):**
  1. Sentry baseline: use the Sentry MCP tools to query open/unresolved issues. **Triage EVERY open issue — regardless of when it was first seen or whether it appeared in this session.** Every issue must receive an explicit disposition before publishing. Use `mcpSentry_updateIssue` with a `reason` to document the decision:
     - **Fixed by this session's changes**: set `status: "resolvedInNextRelease"` — Sentry will auto-close it once the new release is annotated.
     - **Already fixed in a prior release or confirmed not a real bug**: set `status: "resolved"` with a brief `reason`.
     - **Confirmed dev/infra noise** (environment=development, 0 users impacted, Seer actionability = super_low, cold-start or test artefact): set `status: "resolved"` with reason. These must not clutter the production baseline.
     - **Real unfixed bug (cannot fix this session)**: leave `status: "unresolved"` but call `mcpSentry_updateIssue` with a `reason` that documents: (a) what the root cause is, (b) what the fix would be, (c) why it isn't fixed now. This ensures the issue isn't just ignored — it's acknowledged with a plan. Do NOT leave issues in an uninvestigated state just because they predate the current session.
       After triaging, record the remaining open IDs: `pnpm --filter @workspace/scripts run sentry-baseline write <count> <comma-separated-ids>`. The baseline must contain only genuine unresolved production issues when the release lands.
  2. UI browsing / screenshots — **canonical Method 1** (works regardless of artifact registration state):

     ```
     # a) Get token and domain (parallel)
     TOKEN=$(viewEnvVars DEV_SCREENSHOT_TOKEN, environment: "development")
     DOMAIN=$(echo $REPLIT_DEV_DOMAIN)

     # b) Screenshot any page:
     Screenshot({ source: { type: "externalUrl",
       url: `https://${DOMAIN}/<path>?screenshotToken=${TOKEN}` } })
     ```

     Pages: `/` (hub), `/modules/pottery`, `/modules/quilting`, `/modules/travels`, `/modules/ornaments`, `/modules/office`, `/elaine`, `/owner`.
     `DEV_SCREENSHOT_TOKEN` **must stay a plain env var** (development environment) — never a Replit secret. See `.agents/memory/screenshot-tool-cookie-bypass.md` for full reference and the secondary `app_preview` method.
     Fallback for interactive flows only: `runTest()` or curl with `AGENT_LOGIN_EMAIL`/`AGENT_LOGIN_PASSWORD` against `https://$REPLIT_DEV_DOMAIN`.

  3. Deep end-to-end code review of everything added/changed (verify it works as intended, not just that it typechecks). Diff Replit vs GitHub if unsure what changed.
     - **Composition review (mandatory):** for every changed component, provider integration, page-context formatter, query policy, API wrapper, upload flow, and domain page structure, search for sibling implementations. Replace duplication with a shared mechanism plus typed domain configuration. A passing UI test does not excuse architectural duplication.
  4. **Full E2E UI/UX visual verification — non-skippable gate before declaring any feature or fix done:**
     - Screenshot every page/component that was added or changed using Method 1 above. Batch independent pages into one response.
     - **BROKEN IMAGE RULE (mandatory):** Explicitly scan every screenshot for `<img>` elements showing alt text or broken-image icons. If ANY broken image is visible, it is a real bug — investigate and fix before declaring done. Confirm with `curl -I "https://$REPLIT_DEV_DOMAIN/api/..."` that the endpoint returns 200 + valid image bytes. Never assume a broken image is a screenshot-tool artifact.
     - Verify layout, live data, and interactions match the intent of the change.
     - **This step applies during development (before each "done") AND during pre-publish.** It is not optional and cannot be deferred to the pre-publish pass. If a feature cannot be screenshotted (e.g. modal only reachable after a multi-step flow), document why and verify via curl/API test instead.
  5. Services page review: if any new external API service was added or removed this session, update `artifacts/web/src/pages/services-catalog.tsx` (service name, purpose, modules, env vars, implementation paths). This is the canonical owner-visible record of all integrations.
  6. Run the automated pre-publish gate: `pnpm --filter @workspace/scripts run pre-publish`. The local guards include the composition-and-configuration boundary check; GitHub CI supplies the full repository checks. Typecheck is excluded locally because GitHub CI already runs it and the gate verifies CI is green. Do not skip this step or substitute individual manual checks. Fix every failure before proceeding to Stage 2.
  7. **Replit-file leak check (mandatory):** confirm `.replit`, `.replitignore`, and `replit.nix` are NOT present in the public GitHub repo. Run: `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/git/trees/main?recursive=1" | jq '[.tree[] | select(.path | test("^\\.replit$|\\.replitignore$|replit\\.nix$|\\.upm/")) | .path]'` — the result must be `[]`. If any Replit-specific file appears, delete it immediately via the Git Data API (create a tree with `sha: null` for each offending path) before proceeding. These files have historically contained plaintext webhook secrets and personal email addresses and must never be in a public repo. The `github-sync.ts` script already excludes them, but they can re-appear if pushed by other means.

  **Stage 2 — DB safety (only after Stage 1 passes):** 8. Confirm the change cannot harm the shared production Supabase DB — no `drizzle-kit push --force`, additive-only migrations only.

  **Stage 3 — backup + GitHub sync (only after Stage 2 passes), in this exact order:**
  - 3a. Run the Supabase → Replit built-in DB backup: `pnpm --filter @workspace/scripts run backup-to-replit`.
  - 3b. If a GitHub issue was opened for this session's work, close it. On routine sessions with no pre-opened issues this is a quick no-op scan.
  - 3b2. **Open PR review + Dependabot merges + branch hygiene (required every session — no exceptions):**
    List all open PRs: `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/pulls?state=open&per_page=100" | jq '[.[] | {number: .number, title: .title, user: .user.login, head: .head.ref}]'`
    For each open PR:
    - **Dependabot PRs with all CI checks green:** merge immediately using squash (`PUT /repos/.../pulls/:n/merge` with `merge_method: "squash"`). Verify CI first by checking the PR head SHA's check-runs. Do not skip — letting Dependabot PRs pile up defeats security hardening.
    - **Dependabot PRs with failing CI:** investigate; fix simple conflicts, surface blockers to user.
    - **Superseded `sync/…` PRs (check EVERY time — this is the most commonly forgotten step):** when a sync PR fails CI and the fix lands via a later PR, the original stays open indefinitely with its branch dangling. For every open `sync/…` PR: check whether its head SHA is already an ancestor of main (`GET /repos/.../compare/main...{head-sha}` → `status: "behind"` means it's already merged). If so, close it with comment "Superseded by later squash merge" AND delete its head branch immediately.
    - **Human/bot PRs that this session's changes already fixed:** close with a comment.
      After handling all PRs: confirm only `main` branch exists. `curl -s -H "Authorization: Bearer $GH_PAT" "https://api.github.com/repos/malwaredevil/batchelorapp/branches?per_page=100" | jq '[.[].name]'` must return `["main"]`. Delete any stale branch: `DELETE /repos/malwaredevil/batchelorapp/git/refs/heads/{branch}`.
    - **Human/bot PRs that surface an unfixed issue:** fix it now before publishing.
      (Note: Sentry is on the Free plan — Seer auto-draft PRs are a Business-tier feature and no longer active.)
  - 3b3. **Branch cleanup (required after every PR merge or close):** `delete_branch_on_merge` is enabled on the repo, so merging via API auto-deletes the head branch. For PRs that were **closed without merging** (including any you abandoned this session), explicitly delete the head branch: `DELETE /repos/malwaredevil/batchelorapp/git/refs/heads/{branch}`. Then confirm no stale branches remain beyond `main`: `GET /repos/malwaredevil/batchelorapp/branches?per_page=100`. Any `sync/…` or `agent/…` branch without an open PR is stale and must be deleted. Do not let closed PRs linger open — close them with a comment and delete the branch in the same step.
  - 3c. Sync changed files to GitHub using `pnpm --filter @workspace/scripts run github-sync "commit message"`. The script runs prettier --write on every changed file, detects what differs from GitHub HEAD, and opens a pull request. **Every file goes through a PR — no exceptions, including `.github/workflows/` files.** There is no `--direct-to-main` flag; passing it now causes a hard error. Branch protection (`enforce_admins: true`, `strict: true`) enforces this at the GitHub level — even the admin token cannot bypass it.
    - **Never** use the GitHub Contents API per-file (each call triggers its own CI run) or loop `git push` per file. Excluded paths (`.local/`, `.agents/`, `threat_model.md`, `.replit`, `.replitignore`, `replit.nix`, `.upm/`) are enforced by the script — Replit-specific files must never reach the public repo.
    - 🔴 **RED BUTTON:** there is no standing bypass of the PR+CI gate. If a genuine emergency ever makes the gate itself the obstacle, ask the owner directly for one-time permission before touching branch protection — see `.agents/memory/emergency-bypass-protocol.md`.
    - After the PR is merged on GitHub, Replit fetches those changes into an **isolated background-task workspace** and presents the normal **Apply/Merge dialogue**. Accept it to bring the merged changes into Replit main. Replit-only files are never overwritten by this process.
  - 3d. Wait for GitHub CI to go fully green (all checks including CodeQL): `pnpm --filter @workspace/scripts run check-ci-status`. This is a hard stop — do not publish until this passes.
  - 3e. **Security scan (required):** Compare against the session-start baseline counts. Any increase means a net-new finding was introduced this session — investigate before publishing.
    - Dependabot: `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/dependabot/alerts?state=open&per_page=50"` — merge the generated Dependabot PR or add an `overrides` entry in the affected `package.json` and run `npm install --package-lock-only`. For transitive deps in non-pnpm dirs (e.g. `apify-actors/*/package-lock.json`), the override goes in that dir's `package.json`.
    - Code scanning (CodeQL): `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/code-scanning/alerts?state=open&per_page=50"` — fix real findings; dismiss false positives via `PATCH /repos/.../code-scanning/alerts/{n}` with `state: dismissed`, `dismissed_reason` (`false positive` / `used in tests` / `won't fix`), and a clear `dismissed_comment`. See `.agents/memory/github-security-and-branch-hygiene.md` for dismiss patterns specific to this repo.
      - **"Commit Suggestion" shortcut:** when GitHub shows a "Commit Suggestion" button next to a CodeQL finding in the PR UI, the user can apply it with one click — point it out to them rather than implementing the fix from scratch, since GitHub's suggested fix is pre-vetted by CodeQL. I cannot apply these via the REST API (UI-only feature).
      - **"52 relatedLocations were ignored" warning in the CodeQL status page:** this is a known CodeQL limitation on large TypeScript monorepos — diagnostic path metadata is silently truncated when it exceeds internal limits. It does not affect finding correctness and requires no action.
    - Secret scanning: `curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/malwaredevil/batchelorapp/secret-scanning/alerts?state=open&per_page=50"` — any open alert here is a critical stop: rotate the secret immediately before doing anything else.

  - 3f. **Sync GitHub secrets (mandatory every publish):** `pnpm --filter @workspace/scripts run sync-github-secrets`. All required secrets must show ✓. If any show ✗ (missing from Replit env), set them in the Replit Secrets tab first, then re-run. This keeps GitHub Actions' encrypted secret store in sync with Replit's runtime secrets so CI always has what it needs and GitHub serves as an encrypted backup.

  **Publish:** only after all stages pass, verify `VITE_SENTRY_DSN` is set in Replit Secrets (it is baked in at Vite build time — a missing secret silently disables all browser error tracking in production). Then call `suggest_deploy`. Immediately after calling suggest_deploy, run `pnpm --filter @workspace/scripts run sentry-baseline mark-published` — this writes the pending-stage4 file AND automatically POSTs the current git SHA to Sentry's release webhook (`SENTRY_RELEASE_WEBHOOK_URL`), creating a Release entity in Sentry so issues are annotated with the deploy version. Both actions happen in one command.

  **Stage 4 — post-publish Sentry delta check (after publishing):**
  Wait ~5 minutes for production traffic, then use Sentry MCP tools to check for issues that are NEW since the baseline written in Step 1. Compare against the IDs in `.local/state/sentry-baseline.json`. Look specifically at routes/features that changed. Check browser and server separately — filter by `platform:javascript` to surface client-side JS errors from the three frontend apps (modules/web/elaine). If new issues appear, fix them before considering the release stable. When done, clear state: `pnpm --filter @workspace/scripts run sentry-baseline clear`.

## Gotchas

- `DATABASE_URL` is claimed by Replit's built-in DB — must be manually overridden in the Secrets tab to point at Supabase
- Replit's network sandbox blocks direct Postgres connections (port 5432/6543) — use Supabase REST API or the pooler via the app server; `pg` client works only from deployed app, not from bash/scripts in dev
- Secrets are per-Repl, not shared across separate Repls — pottery and quilting Repl secrets did not carry over here automatically
- pgvector is enabled in Supabase but unavailable in the Replit built-in DB — backup excludes `embedding` and `visual_embedding` columns
- Quilting uses both `embedding` (1536-dim, text) and `visual_embedding` (1024-dim, image) on fabrics and patterns

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `MERGE_HANDOFF_PROMPT.md` for the prompt to run in each existing app before merging code
- See `.local/ops-runbook.md` for the full pre-publish checklist, secrets checklist, GitHub PII protection layers, and backup/restore procedures (excluded from GitHub sync)
