---
name: travels.ts trips/packing hooks fully migrated to orval-generated hooks
description: history of the travels.ts vs orval-generated hooks duplication and how it was fully resolved
---

`lib/api-client-react/src/travels.ts` used to hand-maintain ~42 travels hooks/functions (trips, packing) that orval also generated from the OpenAPI spec, with `index.ts` shadowing the generated versions and a guard script (`check-travels-overlap`) failing CI if the shadow list drifted. This has since been **fully migrated**: the duplicated hooks were deleted from `travels.ts`, the shadowing re-export block was removed from `index.ts`, the guard script was deleted, and every consumer was moved onto the orval-generated `Travels*` hooks/types.

**Key adjustments made during the migration:**

- Orval mutation hooks use `{data}` (create) / `{id, data}` (update) / `{id, docId, data}` (nested resource update) payload shapes, vs. `travels.ts`'s old positional-args / `{tripId, body}` shapes — every consumer call site needed reshaping, not just the import path.
- Generated type names differ from the old local ones (e.g. `TravelsCreateTripBody` vs `CreateTripBody`, `TravelsTrip`/`TravelsTripDetail` vs `Trip`/`TripDetail`) — consumers alias on import (`type TravelsTrip as Trip`).
- The migration surfaced real OpenAPI spec drift vs. the actual server route handlers (missing fields like `todoList`, `iconOverride`, document `title`/`documentType`, `TravelsStatsResponse.nextTrip`). When a generated type is missing a field a consumer needs, check the real Express route handler's accepted body fields before deciding whether it's a spec bug or an intentionally absent field.

`travels.ts` now only retains hooks that were never part of the overlap: wishlist hooks and `useGetTripDocumentWalletPass`.

**How to apply:** If a new travels endpoint is added to the spec, wire consumers directly to the generated hook — there is no more hand-written parallel implementation to keep in sync.
