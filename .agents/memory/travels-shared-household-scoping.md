---
name: Travels app is household-shared, not per-user siloed
description: Trips (and everything under them) are visible to every authenticated user, not scoped to the uploader — any new query must search across all users, not just req.session.userId.
---

# Travels app is household-shared, not per-user siloed

`GET /api/travels/trips` has no `WHERE user_id = ...` filter — every authenticated
user sees every trip. Photos/documents/reminders on a trip carry their own
`user_id` (who uploaded them), but that is provenance, not an access boundary.
Multiple `app_users` rows (one per family member) collaborate on the same trips.

**Why:** A magnet duplicate-check feature was initially scoped to
`eq(travelsTripPhotos.userId, req.session.userId)`, which silently only checked
the requester's own uploads — missing magnets uploaded by other family members
on shared trips, defeating the "do we already own this" purpose. Verified via
curl that a magnet uploaded by user A was invisible to user B's query until the
`user_id` filter was removed.

**How to apply:** Any new Travels feature that "searches the collection" (visual
similarity, full-text search, stats, etc.) must query across all users unless
there's an explicit reason to scope to just the requester. Don't assume
`req.session.userId` scoping is safe by default in this app — check whether the
existing list/read routes for that resource filter by user first.

**Follow-up (2026-07-06):** Two surfaces had slipped through this rule and were
fixed: `travels_custom_document_types` (was scoped `WHERE user_id = ...` on
list + upsert-conflict-target — converted to a household-wide upsert keyed by
`typeKey` alone, deduped by key on read) and `travels_calendar_trip_suggestions`
(had a `visibleToUser` filter excluding another member's personal-calendar-
sourced suggestions — removed; suggestions are trip data, not the calendar
connection itself, so they're now fully shared like trips). OAuth
connections/tokens (Calendar, Gmail) and personal UI prefs (card layout,
account settings) correctly remain single-owner — don't convert those.
