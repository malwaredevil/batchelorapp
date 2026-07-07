---
name: DISPROVEN — screenshot tool was not the cause of fixed-widget drift
description: Earlier theory that app_preview mislays position:fixed elements on tall pages was WRONG for the Elaine widget case; see cross-app-shared-tailwind-positioning.md for the real causes and fix.
---

An earlier investigation concluded that `app_preview` screenshots lay out `position: fixed` elements against full document `scrollHeight` instead of the real viewport on tall pages, and that this was purely a capture-tool artifact rather than a real app bug.

**This conclusion was later disproven** (2026-07) when the same drift was reproduced with live `getComputedStyle`/`getBoundingClientRect` debug logging inside the actual running app (not just screenshots) on the Travels app. The rect data showed the same numeric pattern (`bottom` computed to match `-scrollHeight`), but this happened in the live browser too — end users would have seen the same drift, not just the screenshot tool.

The real causes were two genuine bugs, documented in `cross-app-shared-tailwind-positioning.md`:

1. A real browser bug where `position: fixed` + a CSS `bottom` offset can drift to track full document scroll height instead of the viewport in some layouts.
2. Tailwind's automatic content-scanning failing to generate specific utility classes (`.bottom-4` was completely missing from generated CSS in some apps sharing a component from a lib package, while `.right-4` was present) — a real per-app build gap, not a screenshot issue.

**Why this file is kept (not deleted):** to prevent re-deriving the same wrong "it's just the screenshot tool" conclusion in a future session if the drift symptom resurfaces. If you see this pattern again, do NOT assume it's a capture artifact — instrument the live app directly first (see `cross-app-shared-tailwind-positioning.md`), and only fall back to the screenshot-artifact theory if the live-app rect data (not just a screenshot) actually differs from what real users would see.

**How to apply:** Before concluding a `position:fixed` element's mislayout is a screenshot-tool quirk, inject a temporary console.log of `getBoundingClientRect()` inside the actual running page and check it there — not just via the screenshot. If the drift shows up in real DOM measurements taken live, it's a real bug, not a capture artifact.
