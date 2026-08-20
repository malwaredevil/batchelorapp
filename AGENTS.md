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

🔴 **RED BUTTON (emergency escalation, not a bypass):** if a genuine emergency
ever makes the normal PR+CI gate itself the obstacle (e.g. a broken workflow
file is blocking every PR from merging), do not act unilaterally — stop and
ask the owner directly for one-time explicit permission before touching
branch protection or pushing outside the PR flow. See
`.agents/memory/emergency-bypass-protocol.md`. There is no standing bypass
list; this is a per-incident judgment call made together with the owner.

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

### 2.10 Scheduler task names must be statically verifiable

Every task name passed to `shouldRunScheduledTask()` or `recordScheduledTaskSuccess()`
must be **statically resolvable** by the `check-scheduler-names` CI guardrail. The
guardrail supports exactly two forms:

```typescript
// ✅ Pattern A — inline string literal (preferred)
await shouldRunScheduledTask("birthday-emails", ONE_DAY_MS);

// ✅ Pattern B — module-level same-file const assignment (no shadowing anywhere in the file)
const TASK_NAME = "birthday-emails";
await shouldRunScheduledTask(TASK_NAME, ONE_DAY_MS);
```

These forms are **never** allowed — they cause a CI violation with a clear message:

```typescript
// ✖ imported variable — cross-file resolution is not supported
import { TASK_NAME } from "./constants";
await shouldRunScheduledTask(TASK_NAME, ONE_DAY_MS);

// ✖ object-property reference — const objects are mutable, properties cannot be verified
const NAMES = { BIRTHDAY: "birthday-emails" };
await shouldRunScheduledTask(NAMES.BIRTHDAY, ONE_DAY_MS);

// ✖ template literal — not statically verifiable
await shouldRunScheduledTask(`${prefix}-scan`, INTERVAL_MS);

// ✖ computed expression
await shouldRunScheduledTask(getTaskName(), INTERVAL_MS);

// ✖ Pattern B with shadowing — a parameter, catch variable, or inner const
//   with the same name anywhere in the file makes the binding ambiguous
function run(TASK_NAME: string) {
  await shouldRunScheduledTask(TASK_NAME, ONE_DAY_MS); // ✖ shadowed by parameter
}
```

In addition, the name must be listed in `KNOWN_SCHEDULER_NAMES` in
`artifacts/api-server/src/lib/scheduler-guard.ts`. Add it there when introducing a
new scheduler and remove it when retiring one.

---

## 3. Feature Completion Gate — mandatory before every "done"

**This applies to every feature, fix, refactor, and task — no exceptions. Do not declare work complete until all four checks pass.**

### 3a. Visual verification (non-skippable)

Take a screenshot of every page or component that was added or changed. Use Method 1:

```bash
# Step 1: prove the bypass is healthy, then get an agent-safe derived token.
# DEV_SCREENSHOT_TOKEN is a Replit Secret. Never print or try to read its raw value.
pnpm --filter @workspace/scripts run check-agent-screenshot-access
TOKEN=$(pnpm --filter @workspace/scripts run print-agent-screenshot-token --silent | tail -1)
DOMAIN=$REPLIT_DEV_DOMAIN
```

```typescript
// Step 2: screenshot (batch independent pages into one response)
Screenshot({
  source: {
    type: "externalUrl",
    url: `https://${DOMAIN}/<path>?screenshotToken=${TOKEN}`,
  },
});
```

Page paths: `/` (hub), `/modules/pottery`, `/modules/quilting`, `/modules/travels`,
`/modules/ornaments`, `/modules/office`, `/elaine/`, `/owner-panel`.

Full reference: `.agents/memory/screenshot-tool-cookie-bypass.md`

### 3b. Authenticated browser interaction

For a known-good, read-only browser capability check, run:

```bash
pnpm --filter @workspace/e2e run agent:browser-smoke
```

It launches the workspace's installed Chromium through the existing Playwright E2E
package, derives the development screenshot token internally, makes a harmless
authenticated search interaction after the collection has loaded, and saves
a uniquely named `/tmp/agent-browser-smoke-<timestamp>.png` file. View the exact path
reported by the command after it passes. This is the preferred fallback when the
built-in browser testing runner has an infrastructure outage.

For an authenticated visual check on any direct route, run:

```bash
AGENT_BROWSER_PATH=/elaine/ pnpm --filter @workspace/e2e run agent:browser-page
```

Change the path for the page under review; the command prints a fresh screenshot path.
For a feature-specific or multi-step flow, create a temporary Playwright script that
imports `artifacts/e2e/agent-browser-helpers.mjs`. Use its
`launchAgentBrowser()`, `openAuthenticatedPage()`, `collectConsoleErrors()`, and
`uniqueScreenshotPath()` helpers rather than copying token derivation or Chromium launch
code. Do not use the optional `browser-use` CLI as the sole interaction path. For flows
that must exercise the real login form, tell the testing runner to use
`AGENT_LOGIN_EMAIL` and `AGENT_LOGIN_PASSWORD` by name; never read, print, or paste
either secret into a command or report.

**Broken image rule:** scan every screenshot for `<img>` elements showing alt text or
broken-image icons. Any broken image is a real bug — fix it before declaring done.
Confirm with `curl -I "https://$REPLIT_DEV_DOMAIN/api/..."` that the endpoint returns
200 + valid bytes. Never assume it is a screenshot-tool artifact.

**Multi-step, modal, and stateful UI flows must still receive real browser coverage.**
Start on the route with `agent:browser-page` or a temporary script importing the shared
helpers, perform the needed clicks and form input, then capture a unique screenshot of the
result. Curl/API checks complement this work but never replace physical UI verification
when the application can be exercised in Chromium. Only an unavoidable external or
hardware-only constraint may block it, and that constraint must be recorded explicitly.

### 3b. Tests pass

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run test   # after any api-server change
```

### 3c. No raw fetch violations

```bash
pnpm --filter @workspace/scripts run check-raw-fetch
```

### 3d. Code review

Deep-read everything added or changed. Verify it works as intended, not just that it
typechecks. Diff Replit vs GitHub (`git diff`) if unsure what changed. Check for
architectural duplication — search for sibling implementations before adding new ones.

### 3e. Unrelated issues discovered while working

Stay scoped: do not fix code outside your assigned task just because you noticed it.
But "out of scope to fix" is never "out of scope to report." Triage anything you notice
in code you touch or in check output (lint/typecheck/test) you run:

- **Cosmetic or stylistic** (formatting, a complexity/style lint rule, a naming
  nitpick) — skip silently. Not worth a task.
- **A real bug, security issue, data-correctness risk, or a check that is silently
  passing when it shouldn't be** — never just note it in your own reasoning and move
  on. Call `proposeFollowUpTasks` (see the `follow-up-tasks` skill) before marking your
  task complete, even though it's unrelated to what you were asked to build. If you are
  unsure which bucket a finding falls into, treat it as the second bucket.
- **A composition/DRY violation you notice in code you're already touching**
  (duplicated logic, a hand-copied structure that should have used a
  generator, a missing adapter) — if the fix is small and contained to the
  file(s) you're already editing, fix it inline as part of the same change.
  If it's large enough to need its own review (a multi-file extraction, a new
  shared package), do not fold it into your current task's diff and do not
  silently leave it either — file a scoped follow-up task via
  `proposeFollowUpTasks` before marking your task complete. Never defer this
  kind of finding to "a future cleanup pass" with no task behind it — that is
  how duplication accumulates.

### 3f. New or changed logic needs its own test

Passing the existing suite (3b) only proves you didn't break what was already covered.
It does not prove the thing you just built works, or will keep working when something
else changes later. Do not defer this to a future `test_gaps` follow-up when it is
reasonably within your reach right now:

- Any new or materially changed non-trivial logic (a new code path, a bugfix, a changed
  branch/condition) ships with a matching unit or integration test in the **same**
  task, colocated the way this repo already does it (`*.test.ts` beside the source
  file; see `api-server-route-testing.md` in `.agents/memory/` for the
  vitest+supertest pattern used for routes).
- **Elaine SSE route tests (`POST /api/elaine/chat` via supertest):** if the test file
  uses a `selectQueue` + `primeDb*` helper to feed sequential `db.select()` results to
  the real chat handler, it **must** also include `assertSelectQueueDrained()` in an
  `afterEach`. A queue slot left over (or missing) causes cryptic ECONNRESET failures
  in a later test rather than a clear assertion error in the failing one. See
  `chat-dropped-action.test.ts`, `reminder-doubt.test.ts`, and
  `chat-reminder-doubt.test.ts` for the canonical implementation. Files that mock
  `chatCreate` directly (e.g. `scheduling-doubt-tool-forcing.test.ts`) or that drive
  other `/api/elaine/*` endpoints without a `primeDb*` helper do **not** need this.
- A bugfix's test must fail against the old code and pass against the fix — a
  regression test, not just a happy-path check.
- Reserve a `test_gaps` follow-up for coverage that is genuinely out of reach in this
  environment — e.g. full end-to-end browser tests, which this sandbox cannot run
  (see `playwright-nixos-noop.md`) and which are validated via GitHub Actions instead —
  not as a substitute for a unit test you could write now.
- This is not a 100%-coverage mandate. Do not write tests for trivial code (simple
  getters, type-only wiring, generated code) just to move a coverage number — that
  produces shallow tests without reducing real regression risk. Spend the effort on
  business logic, edge cases, and anything with a failure mode a user would notice.

---

## 4. Required Commands — run these at the right times

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
pre-publishing task. It applies equally to the main agent, future sessions,
background task agents, and code reviewers. A task that introduces a
preventable second source of truth is incomplete until the behavior is
consolidated or the duplication is explicitly justified.

This design rule is built from seven concrete techniques. Apply the one that
fits, in this rough order of preference:

1. **DRY (Don't Repeat Yourself)** — the same logic, string, or literal never
   exists in two places on purpose. A second copy is a bug waiting to drift.
2. **Reusable modules/components** — a self-contained unit with a stable
   interface, published from `lib/*`, consumed by every domain that needs it.
3. **Generic programming** — when the same _shape_ of logic must handle
   different data types or entities, parameterize it (TypeScript generics, a
   typed config object, a keyed lookup) instead of writing one near-identical
   function per entity. If you find yourself writing `getPotteryFoo`,
   `getQuiltingFoo`, and `getOrnamentsFoo` with the same body and a different
   table name, that is a generic function with one type parameter, not three
   functions.
4. **Composition** — build a feature by assembling small, focused pieces
   (hooks, components, middleware) rather than one large bespoke
   implementation per call site.
5. **Shared layouts / page shells** — page-level structure (chrome, headers,
   detail-page skeletons, collection-page skeletons) is owned by a shared
   component (`@workspace/app-shell`, `@workspace/collection-ui`); a domain
   supplies content and callbacks, never a parallel hand-rolled layout.
6. **Adapter / strategy pattern** — when domains genuinely need different
   _behavior_ behind the same shared mechanism (e.g. a different query
   predicate, a different provider), express that as an injected
   adapter/strategy object with a shared interface, not as `if (domain ===
"pottery")` branches sprinkled through a shared implementation.
7. **Scaffolding / code generation** — for a small number of well-understood,
   frequently repeated structures (a new Elaine action tool, a new collection
   module, a new shared `lib/*` package), start from the repo's generator
   (see "Scaffolding and code generation" below) instead of hand-copying an
   existing example and renaming fields. A generator that encodes the
   checklist cannot forget a step; a human copying a similar file can.

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

| Prohibited                                                                                                    | Correct alternative                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Sentry.init(` in any SPA file                                                                                | `initBrowserMonitoring()` from `@workspace/web-core/sentry`                                      |
| `new OpenAI(` in `routes/**`                                                                                  | `getOpenRouterClient()` / `callModel()` from `lib/ai-client.ts`                                  |
| `usePageAssistantContext` in a new `.tsx` without `@workspace/elaine-ui`                                      | `formatElaineContextList()` + `formatElaineContextEntity()` from `@workspace/elaine-ui`          |
| Inline `.join()` / `.slice().map()` to build Elaine context                                                   | `formatElaineContextList()` from `@workspace/elaine-ui`                                          |
| Local `Sentry.replayIntegration` config                                                                       | Stays in `lib/web-core/src/sentry.ts` only                                                       |
| Route handler reimplementing household data query                                                             | `queryHouseholdData()` / `searchHouseholdData()` from elaine shared fns                          |
| Literal limit/timeout/budget/threshold/cap baked into business-logic code                                     | Owner-configurable field on `elaineGlobalConfig` — see "No hardcoded config" below               |
| A function/component whose body is near-identical to one elsewhere in the repo, with only names/table changed | Extract to `lib/*` and parameterize (generic programming) — see "Duplicate-code detection" below |

#### Scaffolding and code generation

Three structures recur often enough, and are error-prone enough to hand-copy,
that they have (or will have) a generator instead of a manual checklist:

- **A new Elaine action tool** — `pnpm --filter @workspace/scripts run scaffold:elaine-action -- <name>`.
  Encodes the 9-step checklist in §7 (schema, union, label, executor, tool
  definition, nav paths, system prompt, app map, exclusion check) so none of
  the 9 steps can be silently skipped.
- **A new collection module** (a new domain like pottery/quilting/ornaments) —
  `pnpm --filter @workspace/scripts run scaffold:module -- <name>`. Encodes the
  conformity checklist in the `new-batchelor-module` skill (schema, routes,
  UI, feature-nav registry entry, Elaine parity).
- **A new shared `lib/*` package** — `pnpm --filter @workspace/scripts run scaffold:lib -- <name>`.
  Wires `package.json`, `tsconfig.json`, exports, and the workspace reference
  so a new shared package is importable on the first try.

If a generator exists for what you are building, start from it. If you hand-write
one of these three structures instead, you are responsible for completing every
step its checklist requires — the generator existing does not relax the rule,
it just makes following it the path of least resistance. These generators are a
starting point, not a constraint: edit the generated code freely to fit the
feature. Propose a new generator (as a follow-up task) when you notice a fourth
structure being hand-copied three or more times.

#### Duplicate-code detection

- **Enforced by** `scripts/src/check-duplicate-code.ts` — a diff-scoped,
  heuristic guard (only inspects files touched in the current diff), run via
  `pnpm --filter @workspace/scripts run check-duplicate-code -- --base origin/main`,
  the GitHub Guardrails workflow, and `pre-publish.sh`. It flags new or
  changed functions/components whose normalized body is a near-exact match
  (structure-only: identifiers, literals, and comments stripped before
  comparing) for one already in the repo.
- This check is **heuristic by design** — it catches copy-paste-and-rename
  duplication with a name change, not every conceptual duplication a human
  reviewer would catch, and it can occasionally flag legitimately similar
  but independent code (e.g. two short functions that happen to share a
  common shape by coincidence).
- **Fix:** extract the shared logic to the narrowest appropriate `lib/*`
  package (or a focused server lib) and parameterize the difference via
  generic programming, configuration, or an adapter — then have both call
  sites import it.
- **Genuine exceptions** (independently-evolving code that is only
  superficially similar today) go in `DUPLICATE_CODE_ALLOWLIST` in the
  script, with a comment explaining why extraction would make the contract
  less coherent — never rename/reformat around the check.

#### No hardcoded config values

Limits, timeouts, budgets, caps, thresholds, and similar tunable numbers in
`artifacts/**` or `lib/**` business logic must be owner-adjustable, not
literals. This rule exists because of a real incident: Elaine's per-turn
runtime budget (`maxModelRounds`/`maxToolCalls`/`maxReplans`/`maxElapsedMs`)
was a literal object at the chat call site, invisible to the owner and
impossible to raise without a code change.

- **Enforced by** `scripts/src/check-hardcoded-config.ts` — a diff-scoped
  guard (only inspects files touched in the current diff), run via
  `pnpm --filter @workspace/scripts run check-hardcoded-config -- --base origin/main`,
  the GitHub Guardrails workflow, and `pre-publish.sh`. It flags (a) 2+
  sibling object-literal keys with tunable-looking names assigned bare
  numeric literals, and (b) standalone `MAX_*`/`*_TIMEOUT_MS`/`*_BUDGET`-style
  constants outside a recognized config/defaults/schema file.
- **Fix:** add the field to `AdminConfigBody`
  (`artifacts/api-server/src/elaine/admin-config.ts`), a default in
  `ELAINE_CONFIG_DEFAULTS` (`artifacts/api-server/src/lib/elaine-config.ts`),
  and read it via `getElaineGlobalConfig()` at the call site. Because Elaine's
  own logic already loads `elaineConfig` broadly, wiring a new value in here
  is what keeps her aware of it automatically — do not build a parallel
  config surface.
- **Audit the existing backlog** (report-only, does not fail CI) with
  `pnpm --filter @workspace/scripts run check-hardcoded-config-audit`.
- **Genuine exceptions** (a fixed algorithm parameter that should never be
  owner-facing) go in `HARDCODED_CONFIG_ALLOWLIST` in the script, with a
  comment explaining why — never rename/reformat around the check.

#### Enforcement gates (all three must pass; none can be skipped)

1. **`pnpm run lint`** — `check-domain-composition` and `check-duplicate-code`
   both run; any violation fails the lint run.
2. **`scripts/src/pre-publish.sh`** — runs `check-domain-composition` and
   `check-duplicate-code` as blocking parallel gates before sync or publish.
3. **GitHub CI Guardrails workflow** — runs the same checks on every PR; the
   PR cannot merge until they pass.

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
- The Supabase project reference is embedded in `DATABASE_URL` — the hostname segment has the form `<ref>.supabase.co` (never hard-code the reference in public files; derive it from the env var)
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
