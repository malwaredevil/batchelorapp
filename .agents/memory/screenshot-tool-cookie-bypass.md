---
name: Automated screenshot tool needs a cookie-free auth path
description: app_preview screenshots hit the app over plain HTTP internally, so Secure+SameSite=None session cookies never survive; use a header-based dev-only bypass instead.
---

The `screenshot` tool's `app_preview` type resolves to `http://localhost:80{path}` — plain HTTP against the container directly, not the HTTPS dev domain the real preview iframe uses. If the app's session cookie is `Secure` + `SameSite=None` (often required for legitimate cross-origin iframe embedding), the browser silently refuses to store or send it here. A dev-only "login and set a cookie, then redirect" endpoint will look correct under curl (which doesn't enforce browser cookie policy) but will still show the logged-out page when screenshotted.

**Why:** Relaxing the cookie's `Secure`/`SameSite` flags to make it work over plain HTTP would break real login inside the actual HTTPS preview iframe — not an acceptable tradeoff for a screenshot convenience feature.

**How to apply:** Build a cookie-free bypass instead: a dev-only secret token passed as a URL query param, forwarded by the frontend as a request header on every API call (add this once in the shared fetch client, e.g. read `?screenshotToken=` from `window.location.search` at module load and attach it as a header), and validated server-side inside the same auth-check function used by all protected routes (so every route benefits without per-route changes). Gate hard on non-production and constant-time token comparison, and only ever resolve to one fixed automation account — never an arbitrary user ID from the request.
