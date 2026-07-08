---
name: Verifying Elaine action/chat additions
description: Fast, reliable way to test new Elaine ACTION_TOOLS/executors without the UI; also notes a screenshot-tool limitation.
---

For backend-only Elaine work (new action tools, executors, soft/hard tool wiring), skip UI screenshot testing and verify directly over HTTP:

1. Log in: `POST /api/auth/login` with `AGENT_LOGIN_EMAIL`/`AGENT_LOGIN_PASSWORD`, save cookies (`-c cookies.txt`), against `https://$REPLIT_DEV_DOMAIN` (not localhost — cookies are Secure+SameSite=None).
2. Drive the model into proposing an action: `POST /api/elaine/chat` with `{"message": "...", "appId": "<app>"}`. Response is an SSE stream; look for an `event: action` frame with the `type`/`payload` the model chose.
3. Execute the action directly (bypassing the "confirm in UI" step) via `POST /api/elaine/action` with `{"type": "...", "payload": {...}}` — this calls the same `ACTION_EXECUTORS[type]` the UI would, so it's a faithful test of the executor logic, not just the prompt.
4. Verify side effects with a plain `GET` against the entity's normal REST endpoint, then clean up any test rows the same way.

**Why:** this exercises the exact server-side code path (Zod payload validation + executor) without needing a working chat UI session, and catches payload-shape mistakes (e.g. wrong key name) immediately via the executor's own error message.

**Screenshot-tool gotcha:** the `screenshot` tool's `path` parameter is not a shell — literal `$SCREENSHOT_AUTH_TOKEN` in a path string is sent as-is, not substituted, and fails auth ("Invalid or missing token"). If you need the cookie-free screenshot-login bypass in a screenshot call, the actual token value must be interpolated into the path string itself (not left as a shell-style variable reference).
