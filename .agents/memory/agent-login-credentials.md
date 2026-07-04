---
name: Agent login credentials for authenticated testing
description: How to log in to the Batchelor apps (Travels/Pottery/Quilting/Web) as a real user for e2e tests and screenshots
---

Preferred method: the dev-only `SCREENSHOT_AUTH_TOKEN` cookie-free bypass. The agent is always allowed to use it to browse/screenshot any authenticated page of the app or its sub-modules, without asking first. It authenticates as the fixed automation account (`AGENT_LOGIN_EMAIL`), is hard-disabled in production, and works around the fact that the standalone `screenshot` (app_preview) tool loads pages over plain HTTP against the container directly — a real session cookie (Secure+SameSite=None) can never be set/sent to it. See `artifacts/api-server/src/middleware/auth.ts` (`tryScreenshotTokenAuth`) and `lib/api-client-react/src/custom-fetch.ts` for the mechanism (`?screenshotToken=...` query param → `X-Screenshot-Token` header).

Fallback method (real credentials): `AGENT_LOGIN_EMAIL` / `AGENT_LOGIN_PASSWORD` secrets (a real account) still exist for flows the token bypass doesn't cover (e.g. `runTest()` interactive login steps, or verifying the password-login path itself). `AGENT_LOGIN_PASSWORD` is not referenced anywhere in code as of the token-bypass work — it's kept only for this manual/interactive fallback.

**How to apply:**
- For screenshots/manual browsing of authenticated pages: use the screenshot-token bypass — check how the frontend/app expects the token wired (query param on first load) rather than defaulting straight to `runTest()`.
- For `runTest()` test plans needing the real login form: reference the env vars by name in the plan text (e.g. "enter the email from env var AGENT_LOGIN_EMAIL") — do NOT try to read `process.env.AGENT_LOGIN_EMAIL` from the `code_execution` sandbox, it is not populated there.
- For curl-based API verification: log in via `POST /api/auth/login` with `-c cookies.txt` against `https://$REPLIT_DEV_DOMAIN` (must be HTTPS, not localhost — see session-cookie-https-only.md), then reuse the cookie jar for authenticated requests. The screenshot token can also be sent as an `X-Screenshot-Token` header directly in curl, skipping login entirely.
- Secret values are never viewable by the agent (per environment-secrets skill) — only usable indirectly through tools/scripts that read `process.env` at runtime (bash, the running app) or by name reference in `runTest` plans.
