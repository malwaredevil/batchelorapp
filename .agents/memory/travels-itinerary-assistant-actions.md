---
name: elAIne itinerary actions
description: How add_itinerary_day / regenerate_itinerary_day were wired into the elAIne assistant action pattern, and the shared-logic extraction that made it possible.
---

The itinerary regeneration prompt/model-call logic previously lived only inline inside the `POST /trips/:id/itinerary` route handler in `ai.ts`. It was extracted into an exported `generateItineraryForTrip(tripId, style, interests, regenerateDay?)` function (throwing a typed `ItineraryActionError` instead of writing directly to `res`) so the assistant's `regenerate_itinerary_day` action tool could reuse the exact same AI logic instead of duplicating the prompt.

**Why:** `assistant.ts`'s confirm-then-execute action executors must not fork business logic that already exists in a hand-written route — divergence is how the two paths silently drift (e.g. different prompt wording, different day-index handling).

**How to apply:** When adding a new elAIne action that needs logic already implemented in a route handler, first extract that handler's core logic into an exported function that throws a typed error (status + message) rather than touching `res` directly, then have both the original route and the new executor call it.

Also relevant:
- `itinStyle`/`itinInterests` are per-session React state in `TripDetail.tsx`, never persisted server-side — the assistant executor has no way to see a user's UI style/interest picks, so it always regenerates with hardcoded defaults (`"balanced"`, `["food","history","culture"]`). The tool description explicitly tells the model this.
- The assistant tool takes a 1-based `dayNumber` (matching what's shown on screen, e.g. "Day 3") and the executor subtracts 1 before calling the shared function, which is 0-based — natural-language day numbers are always 1-based.
- `AssistantActionType`/`AssistantAction` in `lib/api-client-react/src/travels.ts` is a **hand-maintained** type union, not codegen'd (consistent with the already-broken orval codegen noted elsewhere) — it was already stale (missing `add_reminder`/`sync_reminder_to_calendar`) before this addition; when adding a new assistant action type, always update this file too or the frontend type will silently allow invalid `.type` values.

When touching `assistant.ts`, check that every frontend hook calling an `/assistant/*` endpoint has a matching server route — a prior session added `useDeleteHouseholdMemory()` in `Settings.tsx` calling `DELETE /assistant/memory/:id` without ever adding the server route; the gap went unnoticed until an unrelated task's completion review caught it. Frontend hooks referencing assistant endpoints are not proof the endpoint exists.

All itinerary/trip-mutating action executors intentionally scope with `and(eq(travelsTrips.id, tripId), eq(travelsTrips.userId, userId))`, even though `GET /trips` itself is household-shared (no owner filter) per `travels-shared-household-scoping.md`. This means elAIne can propose an action while viewing a trip owned by another household member, but execution 404s as "Trip not found" — this is existing, deliberate behavior (verified by testing `regenerate_itinerary_day` against a same-household, different-owner trip), not a bug to fix. When testing new trip-write actions via curl, always confirm the logged-in test account is the trip's actual `userId` first (check via a harmless owned-trip action like `add_itinerary_day`), or every test will 404 for the wrong reason.

`generate_itinerary` (full-trip AI itinerary generation/overwrite, added alongside `confirm_itinerary_activity`/`remove_itinerary_activity` for document-sync cleanup) reuses `generateItineraryForTrip(tripId, style, interests)` with no `regenerateDay` arg — the function already supported full generation, no `ai.ts` changes were needed, only a new action wrapping it. `confirm_itinerary_activity`/`remove_itinerary_activity` read-modify-write the `itinerary` jsonb column directly by 1-based day/activity index (validated in-range, 400 on out-of-range) since there's no per-activity route to reuse.
