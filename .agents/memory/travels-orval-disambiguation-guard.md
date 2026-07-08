---
name: travels.ts vs orval-generated hooks disambiguation guard
description: why lib/api-client-react/src/travels.ts still shadows orval-generated travels hooks, and how the drift guard works
---

`lib/api-client-react/src/travels.ts` is a hand-maintained parallel implementation of ~40 travels hooks/functions (trips, packing) that orval also now generates from the OpenAPI spec. A full migration to the generated hooks was evaluated and rejected: the generated mutation hooks use `{data}` / `{id, data}` payload shapes (orval convention) vs `travels.ts`'s positional args, and generated body/response type names differ (`TravelsCreateTripBody` vs `CreateTripBody`, with some fields required in one and optional in the other) — migrating every consumer call site was judged higher-risk than the drift it would fix.

**Decision:** `travels.ts` stays authoritative for the colliding names; `index.ts` explicitly re-exports the `travels.ts` versions to win over the ambiguous `export *`. A guard script (`pnpm --filter @workspace/scripts run check-travels-overlap`, wired into root `typecheck`/CI) fails the build if the actual name-overlap between `travels.ts` and the generated files ever drifts out of sync with `index.ts`'s disambiguation list — this is what prevents the "spec changes silently have no effect" bug class from recurring silently.

**How to apply:** If a *new* travels endpoint is added to the OpenAPI spec, wire consumers directly to the generated hook rather than hand-writing a `travels.ts` duplicate — only add to `travels.ts` if there's a strong reason (and then add the name to `index.ts`'s disambiguation block, or the guard script will fail CI).
