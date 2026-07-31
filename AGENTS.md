# AGENTS.md — Batchelor App: AI IDE Implementation Guide

> **Read this entire file before writing a single line of code.**
> This file is the primary context document for GitHub Copilot, Codex, and any
> other AI IDE working in this repository. It covers every prohibited operation,
> every key architecture decision, and every command you need.

---

## 1. What This App Is

**Batchelor App** is a household hobby-management platform used by one family.
It manages a pottery collection, fabric/quilting inventory, Christmas ornaments,
a travel planner, and an AI assistant (Elaine). It is **not** a multi-tenant SaaS
product — there is exactly one household with a handful of user accounts.

- **Repo:** `malwaredevil/batchelorapp` (public GitHub)
- **Runtime:** Node 24, TypeScript 5.9, pnpm workspaces (v10)
- **API:** Express 5, Drizzle ORM, PostgreSQL on Supabase
- **Frontends:** Three React 18 + Vite SPAs (`modules`, `web`, `elaine`)
- **AI:** OpenAI Responses (Elaine + selected reasoning); OpenRouter (fallback
  and broad model access); Voyage (reranking); Jina (CLIP embeddings)
- **Auth:** Session cookie (express-session + bcrypt) + Google OAuth
- **Storage:** Supabase private buckets (`pottery`, `quilting`, `ornaments`, `travels`)
- **Deployment:** Replit autoscale + path-based reverse proxy

---

## 2. 🔴 Absolute Prohibitions — CI will fail if you violate these

These are hard rules. Violating any one of them will cause CI to fail and the PR
will not merge. Do not attempt workarounds.

### 2.1 Never run drizzle-kit push

```
BANNED: drizzle-kit push
BANNED: drizzle-kit push --force
BANNED: any command that drops or auto-syncs database objects
```

The Supabase database is **shared between multiple apps**. `drizzle-kit push` will
introspect all tables and silently drop any table not in the current schema — wiping
the other app's data permanently.

**The only permitted schema change method:**
Add a `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
statement to `lib/db/src/schema-statements.ts`. The bootstrap script applies these
at startup: `pnpm --filter @workspace/db run bootstrap`.

### 2.2 Never commit restricted paths

These paths must never appear in any PR diff:

- `.agents/` — agent memory files
- `.local/` — Replit platform files
- `threat_model.md` — security document (local only)
- `.env`, `.env.local`, `.env.*.local` — local secrets

The `guardrails` CI workflow will fail the PR if any of these appear.

### 2.3 Never push directly to main — no exceptions, including workflow files

All work happens on a named `sync/…` or `feat/…` branch. Open a PR. This applies
to every file in the repository, including `.github/workflows/` files. There is no
direct-to-main escape hatch. Branch protection enforces this at the GitHub level
(`enforce_admins: true`, `strict: true`) — even an admin token cannot bypass it.

Branch naming convention:

- `sync/<date>-<slug>` — GitHub sync batches (created automatically by `github-sync.ts`)
- `feat/batch-quick-wins` — Campaign 1
- `feat/epic-241-search-quality` — Campaign 2A
- `feat/epic-242-elaine-completeness` — Campaign 2B
- `feat/strategic-phase1` — Campaign 3

### 2.4 Never add ad-hoc direct OpenAI SDK calls

```typescript
// BANNED — never do this in routes or elaine/ code:
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

Direct OpenAI Responses calls must go through the shared client in
`artifacts/api-server/src/lib/openai-responses.ts`; OpenRouter calls must go
through `artifacts/api-server/src/lib/ai-client.ts`. Routes and Elaine runtime
code consume those facades and must never construct provider clients or read
provider keys directly. The owner AI Lab's image-edit client is a separate,
pre-existing Images API exception. Jina and Voyage retain dedicated clients.

### 2.5 Never add raw fetch('/api/...') in frontend artifacts

Frontend code must use the generated TanStack Query hooks from
`@workspace/api-client-react`. The `check-raw-fetch` CI check will catch violations.

```typescript
// BANNED in artifacts/modules/src, artifacts/web/src, artifacts/elaine/src:
const data = await fetch("/api/pottery/items");

// CORRECT — use the generated hook:
import { useGetPotteryItems } from "@workspace/api-client-react";
const { data } = useGetPotteryItems();
```

### 2.6 Never add passOnStoreError: true to rate limiters

Rate limiters must fail closed (deny requests) if the store is unavailable, not
fail open (allow all requests through). Any `passOnStoreError: true` config will
be caught by the guardrails CI check.

### 2.7 Never shrink RESTRICTED_EXCLUDED_ACTION_TYPES

In `artifacts/api-server/src/elaine/index.ts`, the `RESTRICTED_EXCLUDED_ACTION_TYPES`
array is a deliberate security boundary for the AgentPhone SMS/voice and inbound
email channels. Do not remove entries from it. Additions require a comment explaining
the security decision.

### 2.8 Never perform storage deletes inside a database transaction

Supabase Storage operations must happen **after** a DB transaction commits, not inside
it. Storage deletes cannot be rolled back if the surrounding DB transaction fails.

### 2.9 Never swap DATABASE_URL and PG\* variables

- `DATABASE_URL` → always points to Supabase (the live production database)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` → always point to the
  Replit built-in PostgreSQL (used only for backups)

Never swap these. Never hardcode either connection string.

---

## 3. Required Commands — run these at the right times

```bash
# After ANY TypeScript change — must pass before committing:
pnpm run typecheck

# After ANY change to lib/api-spec/sources/*.yaml:
pnpm --filter @workspace/api-spec run codegen

# After adding a new app_config key:
pnpm --filter @workspace/api-server run lint:config

# To run the API server test suite:
pnpm --filter @workspace/api-server run test

# To add a schema change (new table or column):
# 1. Add the CREATE/ALTER statement to lib/db/src/schema-statements.ts
# 2. Update the Drizzle schema in lib/db/src/schema/
# 3. Run: pnpm --filter @workspace/db run bootstrap
# 4. Run: pnpm --filter @workspace/api-spec run codegen (if API changes)

# To verify GitHub Secrets are set (before Campaign 1+):
pnpm --filter @workspace/scripts run verify-github-secrets

# To verify Supabase prerequisites (before Campaign 3 only):
pnpm --filter @workspace/scripts run verify-supabase-prerequisites
```

---

## 4. Architecture Decisions — Do NOT flag or change these

### 4.1 Household-Shared Data Model

Every authenticated user can read, create, edit, and delete **any** pottery, quilting,
ornaments, or travels record — there is no per-user ownership filter. `user_id` columns
exist only for insert attribution, never for access control.

**Do not add per-user ownership checks to pottery, quilting, ornaments, or travels routes.**

### 4.2 Two Different Auth Mechanisms (both correct)

| Route type                                                                                                                               | Auth method                      | Missing auth = bug? |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------- |
| `/api/pottery/*`, `/api/quilting/*`, `/api/ornaments/*`, `/api/travels/*`, `/api/hub/*`, `/api/elaine/*`, `/api/auth/*`, `/api/config/*` | `requireAuth` session middleware | ✅ Yes — flag it    |
| `/api/agentphone/webhook`, `/api/elaine/email-webhook`                                                                                   | HMAC-SHA256 signature            | ❌ No — intentional |
| `GET /api/travels/trips/:id/share?token=...`                                                                                             | Bearer token in query param      | ❌ No — intentional |
| `GET /api/dev/screenshot-login`                                                                                                          | `NODE_ENV` guard                 | ❌ No — dev only    |

### 4.3 AI Provider Routing Is Centralized

Elaine's primary web chat and selected high-value reasoning/vision workflows
use the OpenAI Responses API through `lib/openai-responses.ts`, with
owner-controlled rollout flags and the existing OpenRouter implementation as
fallback. Other LLM calls and embeddings remain on OpenRouter unless explicitly
migrated through that shared facade. `OPENAI_API_KEY` is therefore live
configuration, but it must never be logged, exposed to a frontend, or read by a
route.

### 4.4 Gmail Access is Single-Owner Even Though Trips Are Shared

Gmail OAuth tokens, scan decisions, and inbox access are always scoped to the specific
user who connected Gmail. Other household members cannot see another member's Gmail data.
The resulting trip documents are household-shared, but Gmail access itself is not.

### 4.5 Elaine Restricted Channels Have a Deliberate Action Allowlist

`runRestrictedElaineTurn` in `artifacts/api-server/src/elaine/index.ts` limits what tools
AgentPhone SMS/voice and inbound email can invoke. `RESTRICTED_EXCLUDED_ACTION_TYPES` is
an intentional security boundary. Do not suggest expanding it.

### 4.6 The Dev Screenshot Token Bypass is Intentional

`installScreenshotImageAutoAuth` in `lib/api-client-react/src/custom-fetch.ts` patches
`HTMLImageElement.prototype.src` globally in development only. Gated by `NODE_ENV`.
Do not flag this as a security issue.

### 4.7 Webhook Route Mounting Order is a Security Control

In `artifacts/api-server/src/routes/index.ts`, the email webhook router is mounted
**before** the session-gated `/elaine` router. This is intentional — reversing the order
would make the webhook unreachable. Do not refactor route registration order.

### 4.8 Elaine Universal App Operations Are OpenAPI-Governed

Elaine's dedicated tools remain preferred. Reviewed JSON operations without a
dedicated tool use `app-operation-tools.ts`, whose runtime catalog is generated
from the committed OpenAPI specification and
`website-operation-inventory.json`. Never add a model-supplied URL/method,
direct database bypass, binary operation, or restricted-channel access to this
bridge. After changing OpenAPI operations or the inventory, regenerate and
check both the capability report and operation catalog.

### 4.9 Global App Chrome Uses the Shared Application Shell

Hub, Modules, and Elaine are separate SPA bundles but one user experience.
Global header behavior lives in `lib/app-shell` and must be composed through
`ApplicationHeader`. Never create an artifact-local global `<header>`, account
menu, Owner Panel item, theme control, communication shortcut, or sign-out
implementation.

Apps supply specialized navigation and actions through the shell's typed slots.
Domain-specific toolbars, page-local headers, dialogs, and printable headers do
not belong in the global shell. After changing SPA chrome or auth-root wiring,
run `pnpm --filter @workspace/scripts run check-app-shell` and the app-shell
tests. See `docs/shared-application-shell.md` for the contract.

### 4.10 Composition and Configuration Is the Default Architecture

After the absolute safety, data-integrity, and security rules above, this is the
**highest-priority design rule** for all new and changed code. "Write Once, Use
Everywhere." Batchelor App is one application: implement a shared mechanism once,
then let domains and SPA bundles configure or extend it through typed props,
callbacks, adapters, slots, and small wrappers. This rule is **hardwired** and
applies to every feature, repair, refactor, PR review, GitHub sync, and
pre-publishing task.

#### Mandatory search-first checklist — complete every step before writing code

1. **Search** — `grep -r "<the behavior>" artifacts/ lib/` to find any existing
   implementation.
2. **Reuse** — if it exists in one place, import and configure it; never copy it.
3. **Extract** — if it exists in two or more places, extract it to the narrowest
   appropriate `lib/*` package and replace all copies before adding your feature.
4. **Implement once** — if it is genuinely new, implement it in `lib/*` (or a
   focused server lib for server-only code); wire in domain differences through
   configuration, not branching.
5. **Enroll** — add a boundary to `scripts/src/check-domain-composition.ts` in
   the **same PR/commit** that creates the shared mechanism. Do not merge
   without the enrolled check.
6. **Verify** — run `pnpm --filter @workspace/scripts run check-domain-composition`
   before committing. Fix all reported violations; each message contains a
   `FIX:` clause.

#### Specifically prohibited patterns (the automated guard detects these)

| Prohibited                                                               | Correct alternative                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `Sentry.init(` in any SPA file                                           | `initBrowserMonitoring()` from `@workspace/web-core/sentry`                             |
| `new OpenAI(` in `routes/**`                                             | `getOpenRouterClient()` / `callModel()` from `lib/ai-client.ts`                         |
| `usePageAssistantContext` in a new `.tsx` without `@workspace/elaine-ui` | `formatElaineContextList()` + `formatElaineContextEntity()` from `@workspace/elaine-ui` |
| Inline `.join()` / `.slice().map()` to build Elaine context              | `formatElaineContextList()` from `@workspace/elaine-ui`                                 |
| Local `Sentry.replayIntegration` config                                  | Stays in `lib/web-core/src/sentry.ts` only                                              |
| Route handler reimplementing household data query                        | `queryHouseholdData()` / `searchHouseholdData()` from elaine shared fns                 |

#### Enforcement gates (all three must pass; none can be skipped)

1. **`pnpm run lint`** — `check-domain-composition` is the last step; any
   violation fails the lint run.
2. **`scripts/src/pre-publish.sh`** — runs `check-domain-composition` as a
   blocking parallel gate before sync or publish.
3. **GitHub CI Guardrails workflow** — runs the same check on every PR; the PR
   cannot merge until it passes.

See `docs/composition-and-configuration.md` for the decision order, review
questions, accepted/rejected examples, and the current list of protected
boundaries and migration candidates.

---

## 5. Repository Structure

```
artifacts/
  api-server/          # Single Express 5 API (all routes for all apps)
    src/
      elaine/          # Elaine AI engine + action executors
      lib/             # Shared server utilities (AI, storage, email, OAuth)
      routes/          # Route handlers by domain
        agentphone.ts  # HMAC-authenticated AgentPhone webhook
        auth.ts        # Login, OAuth, password reset
        config.ts      # App config CRUD (admin only)
        elaine-email.ts # HMAC-authenticated Resend email webhook
        elaine.ts      # Elaine chat (session-authenticated)
        health.ts      # /api/healthz
        hub.ts         # Hub/dashboard routes
        index.ts       # Route registration (mounting order matters — see §4.7)
        office.ts      # Office Gmail inbox client routes
        ornaments.ts   # Ornaments collection routes
        pottery.ts     # Pottery collection routes
        quilting.ts    # Quilting collection routes
        travels/       # Travels (multiple files)
        users.ts       # User management
  modules/             # React SPA: pottery, quilting, ornaments, travels, office
  web/                 # React SPA: Hub (app switcher, dashboard)
  elaine/              # React SPA: Elaine AI chat UI

lib/
  app-shell/           # Shared global header, account menu, theme preference sync
  api-client-react/    # TanStack Query hooks (Orval-generated + hand-written)
  api-spec/            # OpenAPI spec (YAML sources → merged openapi.yaml)
  api-zod/             # Zod schemas (Orval-generated)
  db/                  # Drizzle schema + bootstrap
  elaine-ui/           # Shared Elaine chat widget (used by modules + elaine SPAs)
  gmail-ui/            # Gmail inbox React components
  travels-settings-ui/ # Travels settings UI components
  web-core/            # Shared navigation, layout, auth hooks

scripts/               # Utility scripts (backup, restore, CI checks, verification)
```

---

## 6. Database Schema Rules

- All schema changes go in `lib/db/src/schema-statements.ts` as `CREATE ... IF NOT EXISTS`
- Then mirror the change in the Drizzle schema file under `lib/db/src/schema/`
- Never use `drizzle-kit push` in any form (see §2.1)
- The Supabase project reference is `gadhlfluflknlwgmlmos`
- Table naming: `pottery_*`, `quilting_*`, `ornaments_*`, `travels_*`, `app_*`
- `user_id` on shared tables is attribution only — never used as an access filter

---

## 7. How to Add a New Action Tool to Elaine (9-step checklist)

Every new Elaine action tool must follow all 9 steps. Reference:
`artifacts/api-server/src/elaine/pottery-actions.ts` as the canonical pattern.

1. **Zod schema** — add input schema to the relevant `*-actions.ts` file
2. **Union** — add to the `AssistantAction` union type in `lib/api-client-react/src/types.ts`
3. **Label** — add display label to the action label map in `elaine/index.ts`
4. **Executor** — implement the action executor function in `*-actions.ts`
5. **Tool definition** — add to `ACTION_TOOLS` array in `elaine/index.ts`
6. **Nav paths** — if the action can navigate, update the nav-path map
7. **System prompt** — update the Elaine system prompt to describe the new tool
8. **App map** — update `CROSS_APP_NAVIGATE_RE` if new routes are involved
9. **Exclusion check** — decide whether to add to `RESTRICTED_EXCLUDED_ACTION_TYPES`
   (add it if it requires a browser session or OAuth interaction; document the reason)

---

## 8. Campaign Execution Order

See the master execution order issue (search GitHub issues for `[PROGRAMME] Master
execution order`) for the complete campaign structure, branch names, and the
exact sequence of issues to implement.

**Quick reference:**

- Campaign 1 branch: `feat/batch-quick-wins` — issues #244, #247, #245, #248, #251, #243, #250, #252, #261
- Campaign 2A branch: `feat/epic-241-search-quality` — issues #246, then #254
- Campaign 2B branch: `feat/epic-242-elaine-completeness` — issues #255, then #256
- Campaign 3 branch: `feat/strategic-phase1` — issues #257→#258→#223→#224→#225→#226→#227→#228 ✅ COMPLETE (PR #269 merged)

**Before starting any campaign:** run `pnpm --filter @workspace/scripts run verify-github-secrets`
**Before starting Campaign 3:** also run `pnpm --filter @workspace/scripts run verify-supabase-prerequisites`

> **Copilot note — STOP GATE verification scripts:** These scripts require secrets injected
> as environment variables. They **cannot run in the Copilot sandbox** (no `.env` file is
> present there — secrets live in Replit only). If a STOP GATE script fails with
> `node: .env: not found` or similar, type a custom reply:
> _"The secrets are configured in the Replit environment, not as a .env file. The
> verification script cannot run in the Copilot sandbox. This STOP GATE is confirmed
> cleared from prior campaign runs. Proceed to the next issue."_

### 8.1 Batching — implement multiple issues per session

**Preferred approach:** implement all issues for a campaign branch in a single batch
session. List every issue URL in the prompt. Copilot will implement them in sequence
and open a single PR covering all of them.

**CRITICAL — always use this exact prompt template.** Deviating from this wording has
caused Copilot to push directly to the campaign branch and PR to `main` instead of
creating its own working branch. Copy the template verbatim and only fill in the
`<BATCH_BRANCH>`, `<CAMPAIGN_BRANCH>`, and `<ISSUE LIST>` placeholders:

```
Read AGENTS.md in full before writing any code.

Create a new branch called <BATCH_BRANCH> from <CAMPAIGN_BRANCH>.
Implement ALL of the following on that new branch. Do not create the PR until every item is done:

<ISSUE LIST — one GitHub issue URL per line>

When everything is done, create ONE pull request from <BATCH_BRANCH> targeting
<CAMPAIGN_BRANCH> (NOT main).
```

**Example filled-in values:**

- `<BATCH_BRANCH>` = `copilot/campaign1-batch2`
- `<CAMPAIGN_BRANCH>` = `feat/batch-quick-wins`
- Issue list = one URL per line, e.g. `https://github.com/malwaredevil/batchelorapp/issues/247`

**PR base branch:** every PR must target the campaign branch (`feat/batch-quick-wins`,
etc.), **never `main`**. If Copilot targets `main`, close the PR without merging and
ask Copilot to redo it with the correct template above.

**One PR per campaign branch at a time:** do not open multiple PRs against the same
campaign branch in parallel — they will conflict. Finish and merge one PR before
starting the next batch on the same branch.

**Leftover branches:** after each PR merges, GitHub may leave behind Copilot's working
branch (e.g. `copilot/campaign1-batch2`). These can be deleted via the GitHub API or
the Branches page — they serve no further purpose after the merge.

---

## 9. STOP Gate Protocol

When an issue is marked as a STOP GATE:

1. **Ask the user:** "Have you completed all manual steps in issue #[NNN]? Reply YES when done."
2. **Wait for YES.** Do not write any code before receiving confirmation.
3. **Run the verification script** specified in the issue.
4. **If exit code 0:** continue to implementation.
5. **If exit code 1:** STOP. Report every failed check verbatim. Tell the user:
   "Please complete issue #[NNN] and reply YES again when the verification passes."
   Do not attempt to fix failures by modifying the verification script itself.

---

_Last updated: 2026-07-17. For the current issue list and campaign status, see the
`[PROGRAMME] Master execution order` issue on GitHub._
