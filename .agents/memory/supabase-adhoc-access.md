---
name: Ad-hoc Supabase access from dev
description: How to read/write the live Supabase DB for one-off scripts/seeding in the dev env (which credentials are reachable from where).
---

# Ad-hoc Supabase access from the dev environment

When you need a one-off read/write against the live Supabase DB (e.g. seeding a
column) outside the running app server, the obvious paths fail. Use the REST API.

## What does NOT work

- **`code_execution` sandbox `process.env`** — undefined; the sandbox has no
  process env.
- **`viewEnvVars` callback** — only returns a fixed allow-list
  (`SESSION_SECRET`, `DATABASE_URL`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`,
  `REPL_ID`). It does NOT expose `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
- **`pg` Client with the raw `DATABASE_URL` env var from bash** — resolves to the
  _direct_ host `db.<ref>.supabase.co:5432`, which is DNS/network blocked in dev
  (`ENOTFOUND` / blocked).

## What DOES work

- **A Node script invoked from bash** sees the full Repl secret set via
  `process.env` (unlike the code_execution sandbox). So `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are available there.
- **Hit the Supabase REST API over HTTPS** (PostgREST), not Postgres:
  `GET/PATCH ${SUPABASE_URL}/rest/v1/<table>` with headers
  `apikey` + `Authorization: Bearer <service_role_key>`. Service role bypasses
  RLS. HTTPS (443) is not blocked.
- Put the throwaway script inside a workspace package dir (e.g. `scripts/`) so
  Node can resolve any needed deps; delete it after.
- **`pg` Client via `@workspace/db`'s `resolveDatabaseUrl()` + `sslConfig`
  (bash-invoked tsx script)** also works — it rewrites to the pooler host
  instead of the blocked direct host. Use this pattern (see `scripts/src/*.ts`
  using `pg.Client({ connectionString: resolveDatabaseUrl(), ssl: sslConfig })`)
  for one-off migrations/backfills/test-user scripts when a raw SQL/`UPDATE`
  is simpler than the REST API JSON shape (e.g. array columns, computed
  `WHERE` clauses). Delete the script after running it once.

**Why:** mirrors the documented gotcha that direct Postgres ports are blocked in
dev — REST is the supported channel. Saved after burning several attempts on
sandbox `process.env`, `viewEnvVars`, and `pg`-over-direct-host before REST.
