---
name: Travels Trip list vs TripDetail schema mismatch
description: The generated Trip (list) type omits fields that TripDetail has, even though the DB row and JSON response include them.
---

The OpenAPI-generated `Trip` type (from `GET /api/travels/trips`, used by `useListTrips`) does not declare fields like `itinerary` — only `TripDetail` (from `GET /api/travels/trips/:id`, `useGetTrip`) does — even though the actual DB row/JSON response for both endpoints includes the column.

**Why:** the OpenAPI spec intentionally trims the list-endpoint response schema for brevity; the field is still physically present in the wire response, so `as { itinerary?: unknown }` casts on `Trip`-typed data would compile but are semantically fragile if the spec ever tightens serialization to match the schema.

**How to apply:** if a feature needs a full-record field that's only typed on `TripDetail`/`*Detail` schemas, fetch via the `useGetX(id, { query: { enabled, queryKey: getGetXQueryKey(id) } })` singular hook rather than reading it off list data — and note that Orval-generated hooks require an explicit `queryKey` in the `query` options object even when you only want to set `enabled`, or TS raises "Property 'queryKey' is missing" (TS2741).
