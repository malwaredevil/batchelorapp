---
name: Automated screenshot tool needs a cookie-free auth path
description: app_preview screenshots hit the app over plain HTTP internally, so Secure+SameSite=None session cookies never survive; use a header-based dev-only bypass instead.
---

The `screenshot` tool's `app_preview` type resolves to `http://localhost:80{path}` — plain HTTP against the container directly, not the HTTPS dev domain the real preview iframe uses. If the app's session cookie is `Secure` + `SameSite=None`, the browser silently refuses to store or send it here. A dev-only "login and set a cookie, then redirect" endpoint will look correct under curl but still show the logged-out page when screenshotted.

**Why:** Relaxing the cookie's `Secure`/`SameSite` flags to make it work over plain HTTP would break real login inside the actual HTTPS preview iframe — not an acceptable tradeoff for a screenshot convenience feature.

**How to apply:** Build a cookie-free bypass instead: a dev-only secret token passed as a URL query param, forwarded by the frontend as a request header on every API call (add once in the shared fetch client — read `?screenshotToken=` from `window.location.search` at module load and attach it as `X-Screenshot-Token` header), and validated server-side in the same auth-check function used by all protected routes.

**Confirmed working pattern (as of July 2026):**

```
screenshot({
  type: "app_preview",
  artifact_dir_name: "web",           // ALWAYS "web" — never the sub-app artifact
  path: "/api/dev/screenshot-login?token=<SCREENSHOT_AUTH_TOKEN>&next=<DEST>"
})
```

- `artifact_dir_name` must **always be `"web"`** regardless of which app you're navigating to. The tool prepends the artifact's base path to the `path` parameter, so using `artifact_dir_name: "pottery"` turns `/api/dev/screenshot-login` into `/pottery/api/dev/screenshot-login` — which doesn't exist. The `/api/` namespace is always under the `web` artifact (mounted at `/`).
- `next` can target any app: `/` (hub), `/gmail`, `/pottery/`, `/quilting/`, `/travels/` — trailing slash required for sub-app Vite roots.
- When `next` itself needs query params (e.g. `/gmail?label=STARRED`), URL-encode the `?` and `=`: `next=/gmail%3Flabel%3DSTARRED`.
- After the redirect the browser lands at `DEST?screenshotToken=TOKEN`; `custom-fetch.ts` reads it from `window.location.search` at module load and attaches it as `X-Screenshot-Token` on every `customFetch` call.
- Only works in dev — hard-gated by `NODE_ENV !== "production"` on both server (`tryScreenshotTokenAuth`) and client (`custom-fetch.ts`).
- Images loaded via `<img src="...">` still fail (401) in the screenshot HTTP context — browser can't attach custom headers on image loads. This is expected and pre-existing for pottery/quilting; their data API calls succeed fine.
