# Batchelor App — Copilot Code Review Context

> **Using Copilot for implementation work?** Read `AGENTS.md` in the repo root instead.
> This document is for code review sessions only. For campaign execution order, STOP GATE
> protocol, prohibited commands, and branch names, see `AGENTS.md` and issue #260.

Use this document as your full context before beginning any code review of this repository.
Paste it at the start of a Copilot chat session, then ask Copilot to review specific files
or areas. Each finding should be formatted as a GitHub Issue (template at the bottom).

---

## 1. What This App Is

**Batchelor App** is a household hobby-management platform. One family uses it to manage
a pottery collection, a fabric/quilting inventory, a Christmas ornaments collection, a
travel planner, and an AI assistant (Elaine). It is not a multi-tenant SaaS product — it
has exactly one "household" with a handful of user accounts.

- **Repo:** `malwaredevil/batchelorapp` (public GitHub)
- **Runtime:** Node 24, TypeScript 5.9, pnpm workspaces
- **API:** Express 5, Drizzle ORM, PostgreSQL (hosted on Supabase)
- **Frontends:** React 18 + Vite (3 separate SPA bundles: `modules`, `web`, `elaine`)
- **AI:** OpenRouter (unified proxy for all LLM calls); Voyage (embeddings); Jina (CLIP)
- **Auth:** Session cookie (express-session + bcrypt) + Google OAuth
- **Email:** Resend
- **Storage:** Supabase private buckets (`pottery`, `quilting`, `ornaments`, `travels`)
- **Deployment:** Replit autoscale + Replit reverse proxy (path-based routing)

---

## 2. Intentional Architecture Decisions — Do NOT Flag These

These are deliberate design choices, not bugs. Flagging them wastes review time.

### 2a. Household-Shared Data Model

Every authenticated user can read, create, edit, and delete **any** pottery, quilting,
ornaments, or travels record — there is no per-user ownership filter by design. The family
shares one collection. `user_id` columns exist **only** for insert attribution (who created
a record) and are never used to scope reads or writes. **Do not flag missing per-user
ownership checks on these tables.**

### 2b. Two Completely Different Authentication Mechanisms

- **Session routes** (`/api/pottery`, `/api/quilting`, `/api/ornaments`, `/api/travels`,
  `/api/hub`, `/api/elaine`, `/api/auth`, `/api/config`) use the `requireAuth` middleware
  (Express session cookie). Missing `requireAuth` here IS a bug.
- **Webhook routes** (`/api/agentphone/webhook`, `/api/elaine/email-webhook`) use
  **HMAC-SHA256 signature verification**, NOT a session cookie. They must NOT have
  `requireAuth`. Do not flag the absence of `requireAuth` on these routes.
- **Share-token route** (`GET /api/travels/trips/:id/share?token=...`) is intentionally
  public — a bearer token is the only gate. Do not flag this as missing auth.
- **Dev-only route** (`/api/dev/screenshot-login`) only exists in development and is
  guarded by `NODE_ENV`. Do not flag this.

### 2c. OpenRouter is the Only AI Gateway

All LLM calls (chat completions, vision, some embeddings) route through OpenRouter.
`OPENAI_API_KEY` is present but unused — it is kept for potential future use. Do not
suggest adding direct OpenAI API calls or suggest the key is dead.

### 2d. Elaine Restricted Channels

`runRestrictedElaineTurn` in `artifacts/api-server/src/elaine/index.ts` deliberately limits
what tools AgentPhone SMS/voice and inbound email can invoke. `RESTRICTED_EXCLUDED_ACTION_TYPES`
is an intentional security boundary. Do not suggest expanding it.

### 2e. Database Migrations Are Additive-Only by Design

`lib/db/src/bootstrap.ts` uses only `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT
EXISTS`. `drizzle-kit push --force` is permanently banned — it would silently drop another
app's tables on the shared Supabase instance. Do not suggest Drizzle push/migrate commands.

### 2f. Gmail Access Is Single-Owner Even Though Trip Data Is Shared

Gmail OAuth tokens, scan decisions, label management, and inbox access are always scoped to
the specific user who connected Gmail. Other household members cannot see another member's
Gmail data, even though the resulting trip documents are household-shared. This asymmetry
is intentional.

### 2g. The Screenshot Token Bypass Is Dev-Only

`installScreenshotImageAutoAuth` in `lib/api-client-react/src/custom-fetch.ts` patches
`HTMLImageElement.prototype.src` globally in development only. It is gated by `NODE_ENV`
and removed from production builds. Do not flag this as a security issue.

---

## 3. Tech Stack Details (for "modern best practices" context)

| Layer            | What We Use                 | Relevant Versions |
| ---------------- | --------------------------- | ----------------- |
| Package manager  | pnpm workspaces             | v10               |
| Runtime          | Node.js                     | 24                |
| Language         | TypeScript                  | 5.9 (strict)      |
| API framework    | Express                     | 5.x               |
| ORM              | Drizzle ORM                 | 0.39+             |
| DB driver        | `drizzle-orm/node-postgres` | —                 |
| React            | React 18                    | —                 |
| Build (frontend) | Vite 6                      | —                 |
| Build (API)      | esbuild                     | —                 |
| Validation       | Zod v4 (`zod/v4`)           | —                 |
| API contract     | OpenAPI 3.1 → Orval codegen | —                 |
| Query client     | TanStack Query v5           | —                 |
| Styling          | Tailwind CSS v4             | —                 |
| Testing          | Vitest + Testing Library    | —                 |
| Logging          | Pino                        | —                 |
| Error tracking   | Sentry                      | —                 |
| Session          | express-session             | —                 |

---

## 4. Repository Structure

```
artifacts/
  api-server/          # Single Express API server (all routes)
    src/
      elaine/          # Elaine AI assistant engine + action executors
      lib/             # Shared server utilities (AI, storage, email, OAuth, etc.)
      routes/          # Route handlers grouped by domain
        agentphone.ts  # HMAC-authenticated AgentPhone webhook
        auth.ts        # Login, OAuth, password reset
        config.ts      # App config CRUD (admin only)
        elaine-email.ts # HMAC-authenticated Resend email webhook
        elaine.ts      # Elaine chat routes (session-authenticated)
        health.ts      # /api/healthz
        hub.ts         # Hub/dashboard routes
        index.ts       # Route registration + middleware ordering
        office.ts      # Office (Gmail inbox client) routes
        ornaments.ts   # Ornaments collection routes
        pottery.ts     # Pottery collection routes
        quilting.ts    # Quilting collection routes
        travels/       # Travels sub-routes (split across multiple files)
          ai.ts, documents.ts, gmail.ts, packing.ts, settings.ts, ...
        users.ts       # User management
  modules/             # React SPA: pottery, quilting, ornaments, travels, office
  web/                 # React SPA: Hub (app switcher, dashboard)
  elaine/              # React SPA: Elaine AI assistant chat UI

lib/
  api-client-react/    # TanStack Query hooks (orval-generated + hand-written)
  api-spec/            # OpenAPI spec (YAML sources → merged openapi.yaml)
  api-zod/             # Zod schemas (orval-generated)
  db/                  # Drizzle schema + bootstrap
  elaine-ui/           # Shared Elaine chat widget
  gmail-ui/            # Gmail inbox React components
  travels-settings-ui/ # Travels settings UI components
  web-core/            # Shared navigation, layout, auth hooks

scripts/               # Utility scripts (backup, restore, CI checks, etc.)
```

---

## 5. Database Schema (Supabase PostgreSQL)

Tables are grouped by prefix. All tables use `serial` or `uuid` PKs unless noted.
`user_id` is an attribution foreign key (not an ownership filter) on household-shared tables.

### Auth

| Table                   | Key Columns                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `app_users`             | `id`, `email`, `passwordHash`, `name`, `phoneNumber`, `isOwner`, `createdAt` |
| `password_reset_tokens` | `id`, `userId`, `token`, `expiresAt`, `usedAt`                               |

### App Config

| Table        | Key Columns                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `app_config` | `id`, `module`, `key`, `value`, `updatedAt` (singleton rows per module+key) |

### Pottery (household-shared)

| Table                     | Key Columns                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pottery_items`           | `id`, `userId`, `name`, `description`, `category`, `maker`, `year`, `glazeType`, `dominantColors`, `aiDescription`, `lockedFields`, `embedding`, `zoneEmbedding`, `createdAt` |
| `pottery_categories`      | `id`, `name`                                                                                                                                                                  |
| `pottery_item_categories` | `itemId`, `categoryId`                                                                                                                                                        |
| `pottery_images`          | `id`, `itemId`, `storagePath`, `isPrimary`                                                                                                                                    |

### Quilting (household-shared)

| Table                      | Key Columns                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quilting_fabrics`         | `id`, `userId`, `name`, `brand`, `colorFamily`, `dominantColors`, `fabricType`, `quantity`, `embedding`, `visualEmbedding`, `lockedFields`, `createdAt` |
| `quilting_patterns`        | `id`, `userId`, `name`, `designer`, `patternType`, `embedding`, `visualEmbedding`, `createdAt`                                                          |
| `quilting_finished_quilts` | `id`, `userId`, `name`, `completedAt`                                                                                                                   |
| `quilting_blocks`          | `id`, `name`, `defaultSize`, `cellStructure` (JSON)                                                                                                     |
| `quilting_block_templates` | `id`, `name`, `blockId`, `fabricAssignments` (JSON)                                                                                                     |
| `quilting_layouts`         | `id`, `name`, `blockTemplateId`, `rows`, `cols`, `cellColors` (JSON)                                                                                    |
| `quilting_shopping_items`  | `id`, `name`, `quantity`, `purchased`, `notes`                                                                                                          |
| `quilting_categories`      | `id`, `name`                                                                                                                                            |
| `quilting_images`          | `id`, `entityType`, `entityId`, `storagePath`, `isPrimary`                                                                                              |

### Ornaments (household-shared)

| Table                       | Key Columns                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ornaments_items`           | `id`, `userId`, `name`, `series`, `year`, `dominantColors`, `motifs`, `aiDescription`, `upc`, `bookValue`, `lockedFields`, `createdAt` |
| `ornaments_categories`      | `id`, `name`                                                                                                                           |
| `ornaments_item_categories` | `itemId`, `categoryId`                                                                                                                 |
| `ornaments_images`          | `id`, `itemId`, `storagePath`, `isPrimary`                                                                                             |
| `ornaments_barcode_cache`   | `upc`, `productData` (JSON), `cachedAt`                                                                                                |
| `ornaments_hallmark_events` | (Hallmark ornament metadata)                                                                                                           |

### Travels (household-shared, with some single-owner exceptions)

| Table                                 | Key Columns                                                                                                       | Shared?         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------- |
| `travels_trips`                       | `id`, `userId`, `name`, `destination`, `startDate`, `endDate`, `status`, `shareToken`, `iconOverride`, `todoList` | ✅ shared       |
| `travels_trip_documents`              | `id`, `tripId`, `userId`, `title`, `documentType`, `storagePath`, `extractedData` (JSON), `status`                | ✅ shared       |
| `travels_doc_chunks`                  | `id`, `documentId`, `chunkIndex`, `text`, `embedding`                                                             | ✅ shared       |
| `travels_trip_photos`                 | `id`, `tripId`, `userId`, `storagePath`, `caption`                                                                | ✅ shared       |
| `travels_reminders`                   | `id`, `tripId`, `userId`, `text`, `dueAt`, `sent`                                                                 | ✅ shared       |
| `travels_wishlist`                    | `id`, `userId`, `destination`, `notes`                                                                            | ✅ shared       |
| `travels_custom_document_types`       | `id`, `label`, `userId`                                                                                           | ✅ shared       |
| `travels_calendar_trip_suggestions`   | `id`, `tripId`, `userId`, `calendarEventId`, `dismissed`                                                          | ✅ shared       |
| `travels_google_calendar_connections` | `id`, `userId`, `accessToken`, `refreshToken`, `scope`                                                            | ⛔ single-owner |
| `travels_connected_calendars`         | `id`, `userId`, `connectionId`, `calendarId`, `isSharedTravelCalendar`                                            | ⛔ single-owner |
| `travels_gmail_connections`           | `id`, `userId`, `accessToken`, `refreshToken`                                                                     | ⛔ single-owner |
| `travels_gmail_scan_decisions`        | `id`, `userId`, `gmailMessageId`, `decision`, `tripDocumentId`                                                    | ⛔ single-owner |
| `travels_card_layout_preferences`     | `id`, `userId`, `layout` (JSON)                                                                                   | ⛔ single-owner |
| `travels_trip_card_collapse_state`    | `id`, `userId`, `tripId`, `collapsed`                                                                             | ⛔ single-owner |

### Elaine AI Assistant

| Table                          | Key Columns                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `elaine_conversations`         | `id`, `userId`, `pageContext`, `messages` (JSON), `createdAt`                           |
| `elaine_history_conversations` | `id`, `userId`, `title`, `summary`, `createdAt`                                         |
| `elaine_history_messages`      | `id`, `conversationId`, `role`, `content`, `createdAt`                                  |
| `elaine_memory`                | `id`, `userId`, `content`, `createdAt`                                                  |
| `elaine_nudges`                | `id`, `userId`, `content`, `seen`, `createdAt`                                          |
| `elaine_global_config`         | singleton (id=1): `chatModel`, `subagentModel`, `requestTimeoutMs`, `maxResponseTokens` |
| `elaine_settings`              | `id`, `userId`, `notificationsEnabled`                                                  |
| `elaine_daily_briefs`          | `id`, `userId`, `content`, `date`                                                       |
| `elaine_email_conversations`   | `id`, `userId`, `messages` (JSON), history per email thread                             |

### Office (Gmail inbox client — fully single-owner)

| Table                   | Key Columns                                            |
| ----------------------- | ------------------------------------------------------ |
| `app_gmail_connections` | `id`, `userId`, `accessToken`, `refreshToken`, `email` |
| `office_notes`          | `id`, `userId`, `threadId`, `content`, `createdAt`     |

### Webhook Dedup

| Table                             | Key Columns                                         |
| --------------------------------- | --------------------------------------------------- |
| `agentphone_webhook_deliveries`   | `id`, `webhookId`, `processedAt`                    |
| `agentphone_conversations`        | `id`, `phoneNumber`, `messages` (JSON), `updatedAt` |
| `elaine_email_webhook_deliveries` | `id`, `webhookId`, `processedAt`                    |

---

## 6. What to Review — Full Scope

Perform a thorough expert-level code review across **all** of the following categories.
This is not just a security scan — it is a full engineering audit.

### 6.1 Security & Authentication

- Missing `requireAuth` on session-gated routes (see §2b for which routes are exempt)
- HMAC signature verification on webhook routes: runs on raw bytes before JSON parse?
- Replay protection: are webhook dedup tables checked before any side effects?
- Timestamp freshness checks (5-minute window) on webhooks
- Input validation: are all route handler inputs validated with Zod before use?
- SSRF: any server-side URL fetch that accepts a user-supplied URL without validation?
  (Check `ssrf-safe-fetch.ts` is used for user-controlled destinations)
- SQL injection: any raw SQL strings with template literals? (Drizzle parameterizes by
  default, but raw SQL escapes or `sql` template literals deserve scrutiny)
- Stored XSS: any user content rendered without escaping in email templates or Elaine replies?
- Secret exposure: any route that could return tokens, keys, or hashes in responses?
- Rate limiting: are the public auth endpoints (login, forgot-password, reset) rate-limited?
- Session fixation: is the session ID regenerated on login?
- Password reset token: single-use enforcement, expiry enforcement?
- Elaine tool allowlist: can any code path invoke a tool outside `AGENTPHONE_ACTION_TYPES`
  in the AgentPhone/email channels?

### 6.2 Runtime Safety & Crash Risks

- Unhandled promise rejections in route handlers (missing `try/catch` or `.catch()`)
- `!` non-null assertions on values that could realistically be null/undefined at runtime
- Array access without bounds checking (e.g. `arr[0].foo` without checking `arr.length`)
- Type assertions (`as SomeType`) that hide real type mismatches
- Missing null checks before accessing nested properties
- JSON.parse without try/catch
- Synchronous code that could block the event loop (large loops, sync file I/O)
- Missing `await` on async calls inside route handlers
- Express 5 async route handlers: are all errors propagated to `next(err)`?

### 6.3 Data Integrity

- DB writes without transactions where multiple rows should succeed or fail together
- Missing uniqueness constraints (are there any DB inserts that should be upserts?)
- Soft-delete patterns that could leave orphan rows (e.g. deleting a trip without
  cleaning up its documents, reminders, photos, calendar events, Gmail scan decisions)
- Race conditions in "check then insert" patterns (use `ON CONFLICT DO NOTHING` or
  `INSERT ... WHERE NOT EXISTS` instead of a read-then-write)
- Embedding columns: are they ever partially updated, leaving stale vectors for live rows?

### 6.4 External I/O Error Handling

- Supabase Storage calls without error handling (upload, download, delete, getSignedUrl)
- OpenRouter/LLM calls without timeout, retry, or graceful degradation
- Gmail API calls without handling token expiry (401 → token refresh → retry)
- Resend email sends without checking for delivery errors
- Google Calendar API calls without handling revoked grants (401/403)
- Barcode lookup (api.upcitemdb.com) — is the 8-second abort timeout enforced?
- Any `fetch()` call without a timeout or abort signal

### 6.5 Performance & Efficiency

- **N+1 query patterns**: loops that issue one DB query per item instead of a single
  batched query (e.g. `for (const id of ids) { await db.select().where(eq(t.id, id)) }`)
- Fetching entire tables when only a subset is needed (missing `.limit()` or pagination)
- Redundant DB round-trips: data fetched and immediately re-fetched within the same request
- Embedding generation called on every save instead of only when relevant fields change
- Large JSON columns (e.g. `messages` JSON arrays on conversation tables) that grow without
  bound and are loaded in full on every request — should they be paginated/pruned?
- Missing database indexes on frequently filtered columns
- Supabase signed URL generation inside a loop (should be batched or cached)
- React: components that re-render on every parent render due to missing `useMemo`/
  `useCallback` for stable references passed as props
- React Query: queries without `staleTime` that refetch more aggressively than needed
- Large bundle imports: are any heavy libraries imported at the top level when they
  could be lazy-loaded? (e.g. PDF processing, heavy chart libraries)

### 6.6 Code Duplication & DRY Violations

- Functions or utilities that do the same thing in two or more files — identify the pair
  and suggest which file should own it
- Repeated error-response shape construction (should be a shared `sendError` helper)
- Repeated auth/ownership check patterns that could be a reusable middleware or helper
- Parallel implementations of the same concept (e.g. two different "get signed image URL"
  helpers, two different "build category list" functions)
- Copy-pasted route structures across pottery/quilting/ornaments that could share a factory
- Near-identical React components across pottery/quilting/ornaments (collection pages,
  maintenance pages, add pages) — identify what is common and what genuinely differs
- Repeated inline Zod schemas that could be extracted to `lib/api-zod/`

### 6.7 Dead & Unreachable Code

- Exported functions, types, or constants that are never imported anywhere
- React components or hooks that are defined but never rendered/called
- Environment variables that are read but whose values are never actually used
- Feature flags or config values that always evaluate to the same branch
- `console.log` / `console.error` calls in production code (should use `logger` / `req.log`)
- Commented-out code blocks that should be deleted
- Imports that are listed but not used (TypeScript's `noUnusedLocals` catches some, but
  re-exported items are missed — check barrel `index.ts` files for stale re-exports)
- Database columns that exist in the schema but are never read or written by any route

### 6.8 TypeScript Quality

- `any` types that could be replaced with a real type or `unknown` + type guard
- `@ts-ignore` or `@ts-expect-error` suppressions — are they still needed?
- Weak return types (functions that return `object` or `{}` instead of a specific type)
- Missing generics where the same function is called with different concrete types
- Type assertions (`as T`) that bypass runtime safety — should be replaced with a
  Zod parse or a type guard
- Inconsistent use of `interface` vs `type` where one would be more appropriate
- Overly broad union types that make callers do excessive narrowing

### 6.9 Outdated or Deprecated Patterns

- Express 4 patterns that should be updated for Express 5 (e.g. error handling,
  async route handlers — Express 5 auto-catches rejected promises)
- React patterns that are outdated in React 18 (class components, legacy context API,
  `ReactDOM.render` instead of `createRoot`, `componentDidMount` lifecycle)
- Drizzle patterns that have better equivalents in recent versions (check Drizzle 0.39+ API)
- `Promise.resolve().then()` chains that could be `async/await`
- Callback-style async code that could be promisified
- `var` declarations (should be `const` or `let`)
- Lodash or underscore usage where native JS/TS methods suffice
- Polyfills for features that Node 24 / modern browsers support natively

### 6.10 API Design & Consistency

- Routes that return different error shapes (some return `{error: string}`, others
  `{message: string}`, others a plain status code) — should be unified
- Endpoints that do too much (violate single responsibility) and should be split
- Endpoints that return more data than the client needs (over-fetching)
- Missing HTTP status codes (using 200 for errors, using 500 for client errors)
- Inconsistent naming conventions across routes (camelCase vs snake_case in response bodies)
- OpenAPI spec (`lib/api-spec/sources/`) missing or incorrect for any route that exists
  in the server — spec drift means Orval-generated hooks are wrong
- Endpoints that modify state via GET requests

### 6.11 Memory Leaks & Resource Cleanup

- `setInterval` / `setTimeout` that are started but never cleared when the module
  is stopped or reloaded
- Event listeners added without corresponding cleanup
- Streams opened without being closed on error paths
- Database connections or cursors that are not released on error
- In-memory caches that grow without bound (no TTL, no size limit, no eviction)

### 6.12 Database Schema & Query Quality

This is the Supabase PostgreSQL database. Analyze the Drizzle schema files in `lib/db/src/schema/`
and the query patterns in `artifacts/api-server/src/routes/` and `artifacts/api-server/src/lib/`.

Look for:

- Tables that should have indexes but don't (columns used in `WHERE`, `ORDER BY`, or
  `JOIN` clauses that aren't primary keys or already indexed)
- Foreign keys that are not enforced at the DB level (Drizzle references that have no
  actual constraint — check `.references()` calls)
- JSON columns that store data that should be relational (and would benefit from
  normalization or at least a GIN index)
- Columns with no `NOT NULL` constraint where null would be semantically invalid
- Conversation/message tables (`messages` JSON array) that grow unbounded — queries
  that load the full array when only recent messages are needed
- Embedding columns (1536-dim `real[]`) — are they loaded in queries that don't need them?
  This is expensive data transfer. Suggest selecting specific columns.
- `travels_doc_chunks` with embedding — is similarity search using a vector index
  (`ivfflat` or `hnsw`) or a full-table scan?
- Any soft-delete pattern without a partial index on `deletedAt IS NULL`

### 6.13 Architectural & Module-Level Concerns

- Server-side modules (`artifacts/api-server/src/lib/`) that have grown too large and
  should be split (look for files >300 lines that mix concerns)
- Circular dependencies between lib packages
- Shared state (module-level singletons) that could cause issues in tests or restarts
- Business logic living inside route handlers instead of extracted service functions
- Configuration accessed directly from `process.env` in multiple places instead of going
  through the central `getConfig()` / `lib/env.ts` pattern
- Frontend components that mix UI rendering with data fetching in ways that make them
  hard to test or reuse

---

## 7. What to Skip

Do **not** flag:

- Formatting, indentation, or whitespace issues (Prettier handles this)
- Missing JSDoc / TSDoc comments
- Test coverage gaps (missing tests for covered functionality)
- The household-sharing model (see §2a)
- The webhook routes lacking `requireAuth` (see §2b)
- The OpenRouter-only AI routing (see §2c)
- The `RESTRICTED_EXCLUDED_ACTION_TYPES` set (see §2d)
- The `drizzle-kit push --force` ban (see §2e)
- The dev-only screenshot token bypass (see §2g)
- `replit.md` or `.agents/` directory contents — these are agent/platform files

---

## 8. GitHub Issue Output Format

For every finding, produce a GitHub Issue using this exact format. Be specific — a vague
issue title like "Improve error handling" is not actionable. Each issue must name the exact
file(s) and line(s) so a developer can go directly to the problem.

```markdown
## Title

[Category]: Short, specific description — e.g. "Runtime: Missing await on db.insert() in travels/packing.ts:142"

## Priority

P1 – Critical (security hole, data loss, crash in production path)
P2 – Important (likely bug, significant performance problem, meaningful duplication)
P3 – Nice-to-have (code quality, minor optimization, cleanup)

## Category

One of: Security | Runtime | DataIntegrity | ErrorHandling | Performance | Duplication |
DeadCode | TypeScript | Pattern | ApiDesign | MemoryLeak | Database | Architecture

## Files

- `artifacts/api-server/src/routes/travels/packing.ts` lines 140–145
- (add more files if the issue spans multiple)

## Problem

Clear description of what is wrong and why it matters. Include the actual code snippet
that illustrates the problem.

\`\`\`typescript
// Example of the problem
const result = db.insert(travelsReminders).values(data); // missing await
res.json({ ok: true });
\`\`\`

## Suggested Fix

Concrete description of how to fix it. Show the corrected code if possible.

\`\`\`typescript
// Fixed version
const result = await db.insert(travelsReminders).values(data);
res.json({ ok: true });
\`\`\`

## Context

Any additional context: why this pattern was likely introduced, what other files have
the same problem, what tests should be added after the fix, etc.
```

---

## 9. Review Approach

1. Start with **P1 Security and Runtime** issues — these are highest risk.
2. Then work through **P2 Database, Performance, and Duplication** — these have the
   biggest impact on product quality and maintainability.
3. Finish with **P3 TypeScript, Pattern, and Architecture** improvements.
4. When you find a pattern that appears in multiple files, create **one issue** that
   lists all affected files rather than one issue per file.
5. Do not create issues for things that are already addressed by the existing CI pipeline
   (Prettier formatting, TypeScript compilation errors, codegen drift).
6. If you are unsure whether something is intentional (like an odd auth pattern), describe
   it as a question in the issue body rather than stating it is definitely a bug.

---

## 10. Suggested Review Sessions

To avoid overwhelming Copilot's context window, review one area at a time:

| Session          | Files / Directories to Review                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Auth & webhooks  | `artifacts/api-server/src/routes/auth.ts`, `agentphone.ts`, `elaine-email.ts`, `lib/session.ts`                   |
| Travels routes   | `artifacts/api-server/src/routes/travels/` (all files)                                                            |
| Elaine engine    | `artifacts/api-server/src/elaine/index.ts`, all `*-actions.ts` files                                              |
| API server lib   | `artifacts/api-server/src/lib/` — focus on `ai-client.ts`, `storage.ts`, `reminder-scheduler.ts`, `app-config.ts` |
| DB schema        | `lib/db/src/schema/` (all files) + `lib/db/src/bootstrap.ts`                                                      |
| Frontend modules | `artifacts/modules/src/pottery/`, `quilting/`, `ornaments/` (look for duplication across the three)               |
| Travels frontend | `artifacts/modules/src/travels/`                                                                                  |
| Hub & Elaine UI  | `artifacts/web/src/`, `artifacts/elaine/src/`, `lib/elaine-ui/src/`                                               |
| Shared libs      | `lib/api-client-react/src/`, `lib/web-core/src/`                                                                  |

---

_Last updated: 2026-07-12. Prompt version for Batchelor App commit `9050bce41d`._
