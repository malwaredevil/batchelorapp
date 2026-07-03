---
name: elAIne assistant page-context is winner-take-all
description: usePageAssistantContext on the travels assistant registers one context string per page, keyed by highest `order` — it does not merge multiple calls.
---

`usePageAssistantContext(pageId, text, { order })` (in `artifacts/travels/src/lib/assistant-context.tsx`) picks a single winner per page — the registration with the highest `order` value replaces all others, it does not concatenate them.

**Why:** A subcomponent that calls the hook a second time with its own page id (e.g. a `RemindersSection` registering `"trip-detail-reminders"` alongside the parent's `"trip-detail"`) will silently clobber whichever context has the lower `order`, so elAIne loses visibility into whatever context lost the race — with no error or warning.

**How to apply:** When a page needs to expose more data to the assistant (e.g. reminder ids so a tool call can act on them), lift the data into the single existing top-level `usePageAssistantContext` call for that page and append it to the same string, rather than adding a second call with a new page id. Only introduce a second page id if it's genuinely a different page/route.
