---
name: Agent login credentials for authenticated testing
description: How to log in to the Batchelor apps (Travels/Pottery/Quilting/Web) as a real user for e2e tests and screenshots
---

The user provided real login credentials as secrets: `AGENT_LOGIN_EMAIL` / `AGENT_LOGIN_PASSWORD` (a real account — currently Jonathan Batchelor's).

**Why:** The standalone `screenshot` (app_preview) tool always opens a fresh, logged-out browser context — it cannot hold a session, so it can never get past a login screen no matter what credentials exist. Authenticated screenshots/flows require going through `runTest()` with explicit login steps, or curl with cookie storage for API-level checks.

**How to apply:**
- For `runTest()` test plans: reference the env vars by name in the plan text (e.g. "enter the email from env var AGENT_LOGIN_EMAIL") — do NOT try to read `process.env.AGENT_LOGIN_EMAIL` from the `code_execution` sandbox, it is not populated there.
- For curl-based API verification: log in via `POST /api/auth/login` with `-c cookies.txt` against `https://$REPLIT_DEV_DOMAIN` (must be HTTPS, not localhost — see session-cookie-https-only.md), then reuse the cookie jar for authenticated requests.
- Secret values are never viewable by the agent (per environment-secrets skill) — only usable indirectly through tools/scripts that read `process.env` at runtime (bash, the running app) or by name reference in `runTest` plans.
