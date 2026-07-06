---
name: Cross-app shared component positioning must use inline styles, not Tailwind utilities
description: A position:fixed floating widget shared via a lib package drifted off-screen in some apps but not others; root cause was a real fixed+bottom viewport-drift bug plus real per-app Tailwind content-scan gaps.
---

A floating widget (Elaine assistant) shared across multiple Vite artifacts via a `lib/*` package used Tailwind utility classes (`fixed bottom-4 right-4`, `justify-end`) for positioning. It rendered correctly in some apps and drifted far off-screen (bottom offset matching negative document scrollHeight) in others.

Two independent real bugs were found, confirmed via live `getComputedStyle`/`getBoundingClientRect()` + `document.styleSheets` scanning injected into the running app (not just screenshots — see the disproven theory in `screenshot-fixed-position-fullpage-artifact.md`):

1. **Fixed + bottom viewport drift**: `position: fixed` combined with a CSS `bottom` value can, in some layouts, resolve against full document scroll height instead of the viewport — a genuine browser layout bug, not tied to any particular ancestor `transform`/`filter`/`contain`.
2. **Per-app Tailwind content-scan gaps**: because each artifact is a separate Vite build with its own Tailwind content-scan, a utility class used only inside a shared `lib/*` component is not guaranteed to be picked up identically by every consuming app. Confirmed directly: `.bottom-4` was completely absent from the generated CSS in some apps while `.right-4` was present in the same file; `justify-end` also failed to generate in another app when tried as an intermediate fix.

**Fix**: replace positioning-critical classes with inline styles, which bypass Tailwind's content-scan entirely and can't drift the same way:

- Wrap the floating element in an outer `position: fixed; inset: 0` full-viewport container (inline style) with `pointerEvents: "none"`.
- Anchor the actual widget inside with `position: absolute; bottom/right: <value>; pointerEvents: "auto"` (inline style), so it's positioned relative to the fixed full-viewport container rather than relying on `fixed` + `bottom` directly.
- Keep only generic, well-exercised utility classes (e.g. `flex flex-col items-end gap-3`) that are used broadly enough across the app to reliably survive content-scanning — avoid relying on utilities that are exclusive to one shared/rarely-used component.
- If responsive offsets are needed (e.g. larger margin on desktop), don't rely on `sm:` variants for the inline-styled properties — use a `window.matchMedia` + resize/change listener in JS to pick the inline style value instead.

**Why:** Any component shared across multiple independently-built frontend artifacts cannot assume its Tailwind classes will be generated identically everywhere — each app's build only scans its own content graph. For structurally load-bearing styles (fixed positioning, viewport anchoring) on shared components, inline styles are strictly safer than utility classes.

**How to apply:** When a shared `lib/*` component's positioning/layout looks correct in one artifact but wrong in another, suspect (a) missing generated Tailwind classes in the affected app's CSS bundle (verify via `document.styleSheets` scan or curling the built CSS) before assuming it's a component logic bug, and (b) don't trust screenshot-only symptoms — reproduce with live in-page rect logging first.
