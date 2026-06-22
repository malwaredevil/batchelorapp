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

## GitHub tracking
- Umbrella issue #1; pillar issues #4–#10; milestone "Batchelor Merge". Project board needs `project` token scope (token lacks it) — use the milestone instead. Workflow YAML files need a `workflow`-scoped token to push.
