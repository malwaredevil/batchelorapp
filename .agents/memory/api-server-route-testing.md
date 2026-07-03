---
name: Testing Express routes against shared Supabase DB
description: How to write vitest+supertest integration tests for artifacts/api-server routes without touching the live shared Supabase database.
---

The `@workspace/api-server` package had no test infrastructure before this. The safe pattern for adding route-level integration tests:

- Add `vitest` + `supertest` as devDependencies on the specific artifact package (no workspace catalog entry existed for vitest; `artifacts/quilting` pins its own version — match that).
- `vitest.config.ts` per artifact, `include: ["src/**/*.test.ts"]`, `environment: "node"`.
- Mock **only** the `db` export of `@workspace/db`, not the whole module:
  ```ts
  vi.mock("@workspace/db", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@workspace/db")>();
    return { ...actual, db: dbMock };
  });
  ```
  The real schema table objects (`travelsTrips`, etc.) are inert Drizzle metadata — safe to import for real. This lets route code call `eq(travelsTrips.id, x)` unmodified while `db.select()/.update()/.delete()/.insert()` hit an in-memory fake you control per test (a scriptable select-result queue plus recorded insert/update/delete calls works well for asserting call order, e.g. cancel_trip's photo/document/reminder/trip cleanup sequence).
- Also mock any storage helpers (`deleteTripPhoto`, `deleteDocument`, etc.) and `requireAuth` (just check `req.session.userId` and call `next()`) to keep the suite hermetic — no real Supabase Storage or session store calls.
- `importOriginal()` on `@workspace/db` does run the real module's top-level code (`new Pool(...)`, `resolveDatabaseUrl()`), which requires `DATABASE_URL`/`SESSION_SECRET`/etc. to be set — they are, in this workspace's dev sandbox, and constructing a `Pool` doesn't open a connection by itself. If those secrets were ever absent, this approach would need a full-module mock instead.

**Why:** Direct Postgres access from dev/test tooling is DNS-blocked in this sandbox, and even if it weren't, tests must never write to the shared production-linked Supabase tables. Mocking just the query surface (not the schema) keeps tests exercising real route logic (discriminated union parsing, 404 branches, cleanup ordering) while staying fully isolated from the database.

**How to apply:** Reuse this pattern for any new `artifacts/api-server` route test file. See `artifacts/api-server/src/routes/travels/assistant.test.ts` for a full worked example.
