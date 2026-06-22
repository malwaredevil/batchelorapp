---
name: Supabase connection (pooler rewrite)
description: How the merged app connects to the shared Supabase DB from Replit
---

# Supabase connection on Replit

The `DATABASE_URL` secret holds the **direct** Supabase host (`db.<ref>.supabase.co:5432`),
which is **IPv6-only and unreachable from Replit's IPv4-only network** (ENOTFOUND / blocked).

`lib/db/src/resolve-url.ts` rewrites that at runtime to the **Supavisor pooler**:
- host → `SUPABASE_POOLER_HOST` (`aws-0-eu-west-1.pooler.supabase.com`)
- username → `postgres.<ref>` (pooler requires the ref in the username)
- port → 5432 (session pooler)
- SSL → explicit Supabase CA chain (inlined PEM), `rejectUnauthorized: true`

**Why:** setting `SUPABASE_POOLER_HOST` alone does nothing unless `@workspace/db` actually
calls `resolveDatabaseUrl()`. A freshly scaffolded `lib/db/index.ts` uses
`process.env.DATABASE_URL` directly and will fail against the direct host. Both original
apps (pottery, quilting) shipped this exact helper — keep `index.ts` using it.

**How to apply / test:** `pg` won't resolve from `/tmp` or arbitrary dirs under pnpm.
Run a connectivity test from `lib/db/` with `node --experimental-strip-types`, importing
`./src/resolve-url.ts`. Direct `pg` connections never work from dev bash regardless — only
the rewritten pooler URL connects.
