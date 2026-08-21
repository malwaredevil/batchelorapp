# code-review — Batchelor App Review Skill

This skill provides project-specific context for GitHub Copilot code review.
For the full review checklist, see `.github/copilot-review-prompt.md`.

---

## What This App Is

**Batchelor App** is a household hobby-management platform (pottery, quilting, ornaments, travels, AI assistant "Elaine"). One family, a handful of user accounts, **not** a multi-tenant SaaS product. All collection data (pottery/quilting/ornaments/travels) is household-shared — `user_id` is attribution only, never an ownership filter on reads or writes.

---

## Intentional Patterns — Do NOT Flag These

| Pattern | Why it's intentional |
|---|---|
| Missing `requireAuth` on `/api/agentphone/webhook` and `/api/elaine/email-webhook` | HMAC-SHA256 auth instead — flagging is a false positive |
| No per-user ownership filters on pottery/quilting/ornaments/travels routes | Household-shared by design |
| `OPENAI_API_KEY` present but unused | Kept for future use; all calls go through OpenRouter |
| `installScreenshotImageAutoAuth` patching `HTMLImageElement.prototype.src` | Dev-only, gated by `NODE_ENV` |
| Email webhook router mounted before the `/elaine` session-auth router | Security control — must remain first |
| `RESTRICTED_EXCLUDED_ACTION_TYPES` limits available tools in SMS/email/voice channels | Intentional security boundary — do not suggest expanding |
| `drizzle-kit push --force` absent everywhere | Permanently banned — would wipe the shared Supabase DB |

---

## Highest-Priority Review Checklist

### 1. DRY / Shared-Lib Extraction (most important for this repo)

- Any logic that appears in two or more of `pottery`, `quilting`, `ornaments`, `travels` **must** live in a `lib/*` package — not be copy-pasted
- Shared React components (gallery cards, detail layouts, search bars) belong in `lib/collection-ui/`; server utilities in `lib/` subpackages
- Near-identical route handlers across collections should share a factory or base helper
- Leaf artifacts (`artifacts/web`, `artifacts/modules`, `artifacts/elaine`) cannot import from each other — cross-artifact sharing must go through `lib/*`

### 2. Scaffolding Uniformity

Every new collection module (pottery/quilting/ornaments/travels) must follow the same scaffolding:
- Feature navigation registered in `features/registry.ts` (not hardcoded arrays)
- Gallery, detail, add, edit, and maintenance pages following the pattern from the gold-standard pottery implementation
- OpenAPI spec in `lib/api-spec/sources/` for every route; Orval codegen for every endpoint
- `locked_fields text[]` column on the item table for the per-field lock pattern

### 3. Elaine Parity (non-negotiable)

Every user-facing feature must ship with a matching Elaine update in the **same PR**:
- New action registered in `artifacts/api-server/src/elaine/capability-registry.ts`
- Tool added to `artifacts/api-server/src/elaine/planner-tool-catalog.ts`
- If the action is destructive, it must appear in `RESTRICTED_EXCLUDED_ACTION_TYPES` or be explicitly in the restricted allowlist
- Page context updated so Elaine knows the feature exists

### 4. Security Boundaries

- `requireAuth` is mandatory on all session routes — `/api/pottery`, `/api/quilting`, `/api/ornaments`, `/api/travels`, `/api/hub`, `/api/elaine`, `/api/auth`, `/api/config`, `/api/users`
- Webhook routes use HMAC, not session cookies — never add `requireAuth` there
- Every webhook endpoint must check the dedup table **before** executing any side effects
- All user-supplied URLs must pass through `ssrf-safe-fetch.ts`
- Input validation with Zod before any DB write

### 5. Runtime Safety

- No `!` non-null assertions on values that could realistically be null
- No unhandled promise rejections — every route handler needs `try/catch` or Express 5 async propagation
- No `JSON.parse` without `try/catch`
- Every `new Pool(...)` needs `pool.on("error", ...)` — missing listener = uncaught exception kills the process
- No `setInterval` >~24 days (32-bit ms overflow silently fires immediately)

### 6. Data Integrity

- Multi-row DB operations that must succeed or fail together need a transaction
- "Check then insert" patterns need `ON CONFLICT DO NOTHING` or `INSERT ... WHERE NOT EXISTS`
- Deleting a parent record must clean up all child rows (trips → documents, reminders, photos, calendar events, Gmail scan decisions)

### 7. API Contract

- Every new route needs an entry in `lib/api-spec/sources/*.yaml`
- Run `pnpm --filter @workspace/api-spec run codegen` after any YAML change or generated hooks will be stale
- Error responses must use `{error: string}` consistently — not `{message: string}` or bare status codes

---

## What to Skip

- Formatting / whitespace (Prettier handles it)
- Missing JSDoc/TSDoc
- Test coverage gaps
- The household-sharing model
- The HMAC webhook routes
- The OpenRouter-only routing
- The dev-only screenshot bypass
- `replit.md` and `.agents/` contents
