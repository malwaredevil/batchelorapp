---
name: runTest sandbox DNS failure — fall back to curl+cookies
description: What to do when runTest() (Playwright e2e) fails with getaddrinfo ENOTFOUND on the Supabase/db host before any browser action runs
---

`runTest()` can fail before running any browser step with:
`Worker uncaught error: getaddrinfo ENOTFOUND db.<project>.supabase.co`

This is a failure in the testing tool's own sandbox environment (its notebook
worker trying to resolve a DB host directly), not a bug in the app under
test — it happens even when the app's own workflows are healthy and the
feature works correctly via curl.

**Why:** The `runTest` execution sandbox has different network egress than
the app's own server process. A DNS failure there says nothing about whether
the app-level DB connection (which goes through Supabase's pooler/REST, not
direct DNS from the test sandbox) is broken.

**How to apply:**

- Retry once if you hit this — it can be transient — but don't loop on the
  identical error more than twice.
- If it persists, fall back to `curl` with a cookie jar against
  `https://$REPLIT_DEV_DOMAIN` (see `session-cookie-https-only.md` and
  `agent-login-credentials.md`) to log in and exercise the API surface
  end-to-end. This validates business logic, validation, and persistence
  even though it doesn't exercise the actual browser UI.
- Note in the commit message / task summary that the UI-level Playwright
  pass was blocked by sandbox infra, and what was verified instead, so a
  follow-up can pick up the real browser pass later.
