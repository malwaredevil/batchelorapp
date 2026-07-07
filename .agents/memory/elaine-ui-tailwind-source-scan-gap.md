---
name: Shared elaine-ui classes need explicit @source in every consuming app
description: The "ai" in Elaine's wordmark rendered black instead of red across all 5 apps because Tailwind v4 never scanned lib/elaine-ui/src for class usage.
---

`lib/elaine-ui` is consumed by 5 separate Vite apps (web/hub, elaine, travels, pottery, quilting) via a pnpm workspace symlink into each app's `node_modules/@workspace/elaine-ui`. Tailwind v4's automatic content-detection skips anything under `node_modules` by default, so utility classes used only inside `elaine-ui` source files (e.g. `text-red-600 dark:text-red-500` on the "ai" highlight span) were never generated in _any_ app's CSS — confirmed by curling each app's built `index.css` and finding `.text-red-600` completely absent (any apparent match was a false positive from unrelated same-named classes in that app's own code).

**Fix:** add `@source "../../../lib/elaine-ui/src";` to every consuming app's `index.css` (right after the `@import "tailwindcss"` block). This is the general form of the same gap documented in `cross-app-shared-tailwind-positioning.md` (which worked around it with inline styles instead) — `@source` is the direct fix and should be preferred for any future shared-lib Tailwind classes instead of reaching for inline styles every time.

**Why:** Tailwind v4 content-scanning is per-app and symlink-resolved workspace packages read as "node_modules" get excluded by default; there is no automatic cross-package detection in this monorepo layout.

**How to apply:** Whenever a new Tailwind utility class is added inside `lib/elaine-ui` (or any future shared `lib/*` UI package) and it doesn't visually apply in some/all consuming apps, verify by curling `<app>/src/index.css` and grepping for the exact class before assuming it's a component logic bug. If missing, either confirm the app's CSS already has a matching `@source` directive for that lib, or add one.
