---
name: code-review
description: Repository-specific code review instructions for the Batchelor App. Use this skill when reviewing pull requests to enforce DRY/extraction rules, scaffolding uniformity, Elaine parity, and this repository's specific security and architecture boundaries.
---

# Batchelor App — Code Review Skill

This skill provides project-specific context for Copilot code review.
The full engineering audit checklist is in `.github/copilot-review-prompt.md`.

---

## Intentional Patterns — Do NOT Flag

| Pattern                                                                                                                                                                               | Reason                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `requireAuth` on `/api/agentphone/webhook` or `/api/elaine/email-webhook`                                                                                                          | HMAC-SHA256 auth — flagging is a false positive                                                                                                                                                    |
| No per-user ownership filters on pottery/quilting/ornaments/travels                                                                                                                   | Household-shared by design; `user_id` is attribution only                                                                                                                                          |
| `OPENAI_API_KEY` actively used for Elaine's primary reasoning path via OpenAI Responses API; selected vision workflows (e.g. quilting analyses, fabric identity) also use this facade | OpenRouter handles only paths not yet explicitly migrated to the Responses API — do not suggest removing the key, consolidating to one gateway, or moving Responses-backed workflows to OpenRouter |
| `installScreenshotImageAutoAuth` patching `HTMLImageElement.prototype.src`                                                                                                            | Dev-only, gated by `NODE_ENV`                                                                                                                                                                      |
| Email webhook router mounted before the session-auth `/elaine` router                                                                                                                 | Security control — must remain first                                                                                                                                                               |
| `RESTRICTED_EXCLUDED_ACTION_TYPES` limits tools on SMS/email/voice                                                                                                                    | Intentional security boundary                                                                                                                                                                      |
| No `drizzle-kit push` anywhere                                                                                                                                                        | Permanently banned — would wipe the shared Supabase DB                                                                                                                                             |

---

## Top Priorities When Reviewing

### DRY / Shared-Lib Extraction

- Logic appearing in two or more of `pottery`, `quilting`, `ornaments`, `travels` **must** live in a `lib/*` package
- Leaf artifacts (`artifacts/web`, `artifacts/modules`, `artifacts/elaine`) cannot import from each other — cross-artifact sharing only through `lib/*`
- Near-identical route handlers, React components, or utilities across collections should be flagged for extraction

### Scaffolding Uniformity

Every new collection module must follow the pottery gold-standard pattern:

- Feature navigation registered in `features/registry.ts`, never hardcoded
- OpenAPI spec in `lib/api-spec/sources/` for every route
- `locked_fields text[]` column for the per-field lock pattern

### Elaine Parity

Every user-facing feature must ship with a matching Elaine capability in the **same PR**.
Dedicated tools are preferred; for reviewed JSON operations the OpenAPI-generated
`app-operation-tools.ts` bridge also satisfies parity (see `AGENTS.md §4.8`).

Flag only when Elaine **cannot do what the UI can do at all** — i.e., neither exists:

- No entry in `capability-registry.ts` **and** no matching `website-operation-inventory.json` row
  with a disposition that Elaine's tool routing actively supports. A row alone is not sufficient —
  some dispositions (e.g. `attachment_or_camera`) have no mapped tools and provide no real
  Elaine capability; verify the disposition is handled, not just that a row is present.
- Destructive actions must appear in `RESTRICTED_EXCLUDED_ACTION_TYPES` or the restricted allowlist

### Security Boundaries

- `requireAuth` is mandatory on all session routes: pottery, quilting, ornaments, travels, hub, elaine, config, users
- Within `/api/auth`, login, registration, forgot-password, reset-password, and OAuth callbacks are **intentionally public** — only state-changing authenticated routes (e.g. change-password, logout) need `requireAuth`
- Every webhook endpoint must check the dedup table **before** any side effects
- User-supplied URLs must pass through `ssrf-safe-fetch.ts`
- Zod validation before every DB write

### Runtime Safety

- No `!` non-null assertions on realistically-null values
- Every `new Pool(...)` needs `pool.on("error", ...)` — missing listener causes uncaught exception
- No `setInterval` delay >~24 days (32-bit overflow fires immediately)
- Multi-row operations that must succeed or fail together need a DB transaction
