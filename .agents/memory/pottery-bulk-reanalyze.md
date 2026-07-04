---
name: Pottery bulk reanalyze route ordering
description: Express router ordering rule for the bulk-reanalyze endpoint vs /:id param routes.
---

# Pottery bulk reanalyze — route ordering

## Rule

`router.post("/items/bulk-reanalyze", ...)` must be declared **before** any `router.X("/items/:id", ...)` route.

**Why:** Express matches routes top-to-bottom. If `/:id` comes first, the literal string `"bulk-reanalyze"` is captured as the `:id` param and the bulk route is never reached.

**How to apply:** Whenever adding a new fixed sub-path under `/items/`, place it above the `/:id` family in `pottery.ts`. Check the same pattern applies in the quilting routers (fabrics, patterns).
