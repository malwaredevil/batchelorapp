---
name: Screenshot tool captures pixels before late async browser callbacks
description: Why a single app_preview screenshot can show a stale UI even though console logs prove a JS handler already ran (e.g. Google Maps gm_authFailure)
---

The `screenshot` tool (`type: app_preview`) appears to capture the pixel
snapshot at a fixed, relatively early point (around page load / short idle),
but keeps the headless browser open a bit longer afterward just to drain the
console log buffer before returning both together. This means the returned
console logs can include events that happened *after* the screenshot pixels
were taken.

**Symptom this caused:** a React state update triggered by Google Maps'
async `window.gm_authFailure` callback (which only fires after Maps' own
auth check round-trip, not synchronously) never appeared in the screenshot —
Google's own native "Oops! Something went wrong" map error overlay was still
showing — even though the console log in the *same* tool response clearly
showed our handler executing (`console.error(...)` + `setLoadError(...)`).
Repeated screenshots gave the identical result every time, which is what you
should expect from "captured too early" (deterministic-ish relative timing),
not what you'd expect from a real race/bug (which would be flaky).

**Why:** there is no way to pass extra wait time to the screenshot tool, and
each call is a brand-new browser/session, so retrying doesn't change the
pixel-capture timing relative to the async event.

**How to apply:** when verifying a fix for an async, network-dependent
failure mode (auth callbacks, webhooks landing client-side, delayed
third-party SDK errors), don't trust a single screenshot's pixels alone to
falsify a fix — cross-check the console log content for evidence the handler
ran and no uncaught exception occurred. If you need pixel-level confirmation
of the *settled* state, you need `runTest` (Playwright, which can
explicitly wait for a selector/state) rather than `app_preview` screenshots —
but see `runtest-dns-failure-fallback.md` for a known sandbox limitation with
DB-backed authenticated pages.
