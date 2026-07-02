---
name: Travels itinerary auto-sync from documents
description: How uploaded travel document dates become tentative itinerary entries, and how they're kept in sync on edit/delete.
---

Uploaded document dates (departureDateTime, checkInDate, checkOutDate, pickupDateTime, dropoffDateTime) are auto-inserted into the trip's `itinerary` jsonb as activities tagged `status: "tentative"`, `sourceDocumentId`, `sourceField`.

**Why:** user wants document-derived dates visible on the itinerary immediately, but not confused with manually-planned/confirmed items — so they're tagged distinctly and require an explicit "Mark as firm" action (sets `status: "confirmed"`) to blend in as trusted.

**How to apply:** Sync is idempotent and doc-scoped — `syncItineraryFromDocument(tripId, docId, extractedData)` always first strips any existing activities with that `sourceDocumentId` from all days, then re-adds fresh ones from `extractedData`. This one function handles all three cases: create (after upload), correction (after PATCH with merged extractedData), and purge (call with `{}` on document delete). Auto-created empty "Travel Day" placeholder days are pruned after sync. Any future doc-derived fields should follow the same candidate-based pattern in `computeDocumentActivities` rather than writing bespoke merge logic per field.

**Gotcha:** `computeDocumentActivities` bakes raw extracted values (e.g. `arrivalDateTime`) straight into an activity's `tip` string (e.g. "Arrives 2026-08-14T14:20:00") — unformatted, unlike the `time`/`dateStr` fields which go through `parseDateTime`. Since `tip` is stored as plain text in the `itinerary` jsonb, already-synced trips can't be fixed by changing the backend alone. Fix raw-ISO-in-tip display bugs at render time in TripDetail.tsx (regex-replace ISO substrings via the same `formatExtractedValue` used for Documents), not by reshaping backend generation.
