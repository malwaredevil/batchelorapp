---
name: Cross-SPA login unification
description: How unauthenticated redirects and post-login returns work across separate Vite SPA bundles sharing one session (pottery/quilting/travels -> root /login).
---

When multiple separately-built Vite SPAs share one session cookie under one domain (e.g. `/pottery`, `/quilting`, `/travels` all authenticating against a root `/login`), any navigation that crosses from one app's bundle into another's must use `window.location.href`, never a client-side router's `navigate()`/`Link` (wouter, react-router, etc.). The target route does not exist in the current bundle's router, so client-side navigation 404s or no-ops silently.

This applies to every exit point, not just the main "redirect to login" case: logout handlers, forgot-password/reset-password "back to login" links, and any other in-app link pointing at a route owned by a different sub-app.

**Why:** each sub-app is a distinct build with its own router instance; only a full page load re-resolves which bundle serves a given path.

**How to apply:** grep the whole app for the target path string (e.g. `"/login"`) across all sub-apps, not just the obvious login-check component — reference sites accumulate in shells/layouts, auth pages, and error pages over time. When adding `returnTo` support for post-login redirect back into a sub-app, sanitize server-side (reject values not starting with `/` or starting with `//`) before ever using it in a redirect.

A brief loading spinner after redirect-eligible unauthenticated page loads is expected, not a bug, if the app's query client uses `retry: 1` (or more) on the current-user query — the spinner persists through the retry backoff (~1s) before the redirect effect fires. Don't mistake normal query-retry timing for a broken redirect; check the app's `QueryClient` `retry` setting before assuming a hang.
