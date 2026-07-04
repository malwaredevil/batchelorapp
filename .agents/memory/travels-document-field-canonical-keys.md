---
name: Travels document extracted-field canonical keys
description: Which extractedData keys the travel-document AI actually produces, vs dead UI keys that always render empty.
---

# Travels document extracted-field canonical keys

The travel-document AI extraction (`travel-document-extraction.ts` RESPONSE_SCHEMA_BLOCK) produces a **single** name field and a **single** reference field for every document type:

- `providerName` — airline OR hotel OR rental-company name (one field, reused across types)
- `referenceNumber` — booking / confirmation / ticket number (one field, reused across types)

**Dead keys** that the extraction NEVER emits (so any UI field bound to them renders permanently empty): `airline`, `hotelName`, `confirmationNumber`. Backend consumers already know this — `google-wallet.ts` and `documents.ts` read `providerName`/`referenceNumber` with the dead keys only as a legacy fallback (`ed.hotelName || provider`, `ed.confirmationNumber || ed.referenceNumber`).

**Why:** A user reported "Airline is empty" on an uploaded flight itinerary. Root cause was not missing data — `providerName` held "Eurowings" — it was the TripDetail DocumentRow `keyFields` list binding the "Airline"/"Hotel"/"Confirmation" display rows to the dead keys.

**How to apply:** When adding or fixing document-field display in `TripDetail.tsx` DocumentRow, bind name→`providerName` and confirmation/ref→`referenceNumber`. Disambiguate airline-vs-hotel by `doc.documentType` (there is only one underlying key, so both labels can't point at `providerName` in a single flat list). If you must preserve legacy manually-typed values, read `providerName || airline || hotelName` for display but still write to the canonical key.
