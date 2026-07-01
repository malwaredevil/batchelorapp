---
name: Multer v2 req.params typing
description: In Express route handlers that use multer middleware, req.params is typed as string|string[] — use String() cast to avoid TS2345 errors.
---

## Rule
When a route handler uses multer middleware (e.g. `upload.single("photo")`), TypeScript types `req.params` as `Record<string, string | string[]>` rather than the normal `Record<string, string>`. Calling `parseInt(req.params.id, 10)` directly causes TS2345.

**Fix:** Use `parseInt(String(req.params["id"]), 10)` or `parseInt(req.params["id"] as string, 10)` in all multer-augmented handlers.

**Why:** Multer v2's type declarations augment the Express `Request` interface in a way that broadens the params type inside those handlers, even though at runtime the value is always a string.

**How to apply:** Any `router.post/patch/delete` that passes multer middleware as a second argument must use `String(req.params["key"])` for all params.
