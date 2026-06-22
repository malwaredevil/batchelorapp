---
name: Merge architecture
description: How the pottery + quilting apps consolidate into the batchelorapp monorepo, and where the source code comes from.
---

# Batchelor merge architecture

## Topology (decided)
- **Landing shell** = `@workspace/web` react-vite artifact at `/` (the Batchelor App Launcher). Config-driven: apps live in `APPS[]` and widgets in `WIDGETS[]` in `artifacts/web/src/config/apps.tsx` — adding either is one entry. Dark mode is `useTheme` (light default, `localStorage` key `batchelor-theme`, `.dark` on `document.documentElement`) plus a pre-mount inline script in `index.html` to avoid first-paint flash.
- **Sub-apps** mount as their own artifacts at `/pottery` and `/quilting`. Landing cards hard-navigate via `<a href>` (cross-artifact links go through the shared proxy, so a full-page nav is correct — not wouter client routing).
- Leaf artifacts must not import each other; shared code goes in `lib/*`.

**Why:** path-based proxy routing makes separate artifacts the clean unit; the landing only needs to link out, not own the sub-apps.

## Where the source lives
- Real app code is NOT in this monorepo yet — it lives in `malwaredevil/pottery` and `malwaredevil/quilting` GitHub repos (both already pnpm monorepos, both accessible via the connected github token).
- Each source repo has a `MERGE_HANDOFF.md` at its root written specifically to guide this merge — read it first.
- In BOTH source repos the frontend app artifact is literally named `artifacts/pottery` (`@workspace/pottery`, builds to `artifacts/pottery/dist/public`). The quilting repo forked the pottery template and kept the dir name — confirm actual contents per repo before transplanting; do not assume the dir name reflects which app it is.

## Shared production DB — critical
- One Supabase project `gadhlfluflknlwgmlmos` is shared by BOTH live apps. The DB already contains `pottery_*`, `quilting_*`, shared `app_users`/`password_reset_tokens`, plus legacy unprefixed `categories`/`item_categories` (orphaned remnants) and three session tables (`pottery_sessions`, `quilting_sessions`, `user_sessions`).
- Bringing in app code (T2+) means connecting to the LIVE shared prod DB. Always backup before schema work; bootstrap is CREATE IF NOT EXISTS only; `drizzle-kit push --force` is permanently banned (introspects all tables, drops the other app's).

## Single DDL source of truth
- All bootstrap DDL lives in ONE exported `STATEMENTS` list in `lib/db` (`schema-statements.ts`), re-exported from the db index. BOTH the bootstrap CLI and the api-server startup self-healing migration import and run that same list.

**Why:** the merged server mounts both `/pottery/*` and `/quilting/*`, but the original startup migration only created quilting+shared tables. Two divergent DDL copies = split-brain: the server could boot with pottery tables missing and pottery routes would fail on missing relations. One list keeps every entrypoint provisioning the identical superset.

**How to apply:** any new table/column goes in `schema-statements.ts` only (additive, idempotent — `CREATE/ALTER ... IF NOT EXISTS`). Never add DDL to the startup migration or bootstrap CLI directly; they must stay thin wrappers over the shared list.

## api-server dev = build-once, no watch
- The api-server workflow `dev` script does `build` then `start` (one shot, NOT tsx/nodemon watch). Source edits do NOT hot-reload — you must `restart_workflow "artifacts/api-server: API Server"` to pick them up.

**Why:** stale routes manifest as **404** (the old bundle only has whatever routes existed at its build time), which looks exactly like a mount/routing bug and sends you debugging the wrong thing. After any api-server route/lib change, restart first, then probe.

## DB connectivity reality (corrects the "pg blocked in dev" caveat)
- The Supavisor pooler IS reachable from the running dev **app-server workflow**: startup-migrate connects and reports "all tables verified / created successfully". The "Postgres blocked in the dev sandbox" caveat applies to one-off **bash/scripts** (and the IPv6-only direct host), NOT the long-running app server going through the pooler.

**Why:** earlier notes implied the live DB could only be reached from the deployed app; in fact the dev api-server already talks to live Supabase. Don't waste time assuming dev can't reach the DB — check the startup-migrate log line instead.

## Sub-app URL literals must carry the namespace prefix
- Any server code that EMITS `/api/...` URL strings for a sub-app (image URLs in serializers, image-upload response `url` fields) must include the mount namespace: `/api/pottery/...` or `/api/quilting/...`. Routers mount under `/api/<app>/`, so an un-namespaced literal like `/api/fabrics/:id/image` 404s.

**Why:** the transplant correctly namespaced pottery's serializer but missed quilting's (`lib/serialize.ts` + the `fabrics/patterns/quilts` image-upload routes) — the bug is invisible to typecheck and only shows as broken images at runtime.

**How to apply:** after any route transplant, grep server code for backtick `/api/` literals and confirm each carries the app prefix; route *definitions* (relative to mount) are fine, only emitted absolute URLs need the prefix.

## GitHub tracking
- Umbrella issue #1; pillar issues #4–#10; milestone "Batchelor Merge". Project board needs `project` token scope (token lacks it) — use the milestone instead. Workflow YAML files need a `workflow`-scoped token to push.
