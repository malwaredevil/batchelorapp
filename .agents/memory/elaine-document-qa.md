---
name: elAIne document Q&A via pageContext
description: How trip document Q&A (confirmation numbers, hotel names, etc.) is exposed to the travels assistant, and how to test it without real OCR.
---

Document Q&A ("what's our confirmation number for the Rome hotel?") is implemented by summarizing each document's already-parsed `extractedData` fields (provider, reference/confirmation number, check-in/out, flight numbers, etc.) as plain text and appending it into the existing single `"trip-detail"` pageContext string in `TripDetail.tsx` — no new assistant tool, no raw file access, no extra round trip.

**Why:** The assistant already answers from whatever text is in pageContext (see the reminders precedent). Reusing that channel keeps the page-context model consistent (see the winner-take-all pageContext memory) and avoids giving the model raw file bytes it can't use anyway.

**How to apply:** When adding more assistant-visible data from a trip subresource, extend the same `documentsSummary`-style block (list only non-null fields, cap the number of items) rather than introducing a second `usePageAssistantContext` call or a new read tool. For live e2e testing, don't rely on real OCR output (vision model may fail to read a synthetic test image) — upload any placeholder file via `POST /trips/:id/documents` to create the row, then `PATCH /trips/:id/documents/:docId` with a fabricated `extractedData` object to simulate a specific parsed document, then hit `/api/travels/assistant/chat` with a matching `pageContext` string to confirm the model answers correctly from it.
