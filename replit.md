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

- `artifacts/api-server/` — single Express API server serving both apps' routes
- `lib/db/` — shared Drizzle schema + bootstrap (pottery + quilting tables)
- `scripts/src/backup-to-replit.ts` — Supabase → Replit DB snapshot
- `scripts/src/restore-from-replit.ts` — restore from snapshot
- `scripts/post-merge.sh` — runs after every agent merge: install → bootstrap → backup
- `MERGE_HANDOFF_PROMPT.md` — prompt to extract handoff manifests from pottery/quilting Repls

## Database layout (shared Supabase project: gadhlfluflknlwgmlmos)

| Prefix                               | Owned by       |
| ------------------------------------ | -------------- |
| `pottery_*`                          | Pottery app    |
| `quilting_*`                         | Quilting app   |
| `app_users`, `password_reset_tokens` | Shared (login) |

## Architecture decisions

- **One Supabase, two namespaced table sets.** Pottery and quilting already share one Supabase project. The merge adds nothing to the DB — just consolidates the code that talks to it.
- **Additive-only migrations.** `bootstrap.ts` uses `CREATE TABLE IF NOT EXISTS` exclusively. `drizzle-kit push --force` is permanently banned (it introspects all tables and will silently drop the other app's tables).
- **Backup before publish.** `post-merge.sh` snapshots Supabase → built-in Replit DB after every merge. Embedding columns are excluded (not in Replit DB's pgvector). Regenerate via each app's Bulk Re-analyse.
- **Single Google OAuth client** shared by both apps. Redirect URI: `{host}/api/auth/google/callback`.
- **DATABASE_URL → Supabase; PG\* → Replit built-in DB.** Never swap these.

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
- Single combined domain: app.batchelor.app (target), pottery.batchelor.app + quilting.batchelor.app (decommissioned after go-live)
- When the user has queued multiple feature requests, don't silently barrel from one to the next. If a step needs something from the user (a manual action, a confirmation, a choice), stop and ask a simple yes/no or short question via user_query before proceeding — don't let the queue push past unanswered questions.
- Pre-publish checklist — run this every time before creating a checkpoint (or immediately after), not just when explicitly asked:
  1. Log in with `AGENT_LOGIN_EMAIL`/`AGENT_LOGIN_PASSWORD` whenever UI browsing is needed — always allowed, no need to ask.
  2. Deep end-to-end code review of everything added/changed.
  3. Full E2E UI/UX testing of new/changed features (diff Replit vs GitHub if unsure what changed).
  4. Confirm the change cannot harm the shared production Supabase DB (pottery + quilting also live there) — no `drizzle-kit push --force`, additive-only migrations only.
  5. Run the Supabase → Replit built-in DB backup (`pnpm --filter @workspace/scripts run backup-to-replit`).
  6. Sync GitHub repo + Issues, address any findings, and repeat steps 2-6 until Replit and GitHub are in sync with all checks passing on the latest state.
  7. Only then (re)publish.

## Gotchas

- `DATABASE_URL` is claimed by Replit's built-in DB — must be manually overridden in the Secrets tab to point at Supabase
- Replit's network sandbox blocks direct Postgres connections (port 5432/6543) — use Supabase REST API or the pooler via the app server; `pg` client works only from deployed app, not from bash/scripts in dev
- Secrets are per-Repl, not shared across separate Repls — pottery and quilting Repl secrets did not carry over here automatically
- pgvector is enabled in Supabase but unavailable in the Replit built-in DB — backup excludes `embedding` and `visual_embedding` columns
- Quilting uses both `embedding` (1536-dim, text) and `visual_embedding` (1024-dim, image) on fabrics and patterns

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `MERGE_HANDOFF_PROMPT.md` for the prompt to run in each existing app before merging code
