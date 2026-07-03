---
name: elAIne magnet duplicate-photo check lives in the chat widget, not the tool-call loop
description: How image-upload features are added to elAIne when the underlying task needs a real photo, not text.
---

The elAIne assistant chat (`/assistant/chat`) is text-only — `ChatBody` only
accepts `message`/`pageContext`, and there's no multer/base64 image path in
that route. For "magnet duplicate-photo checking", we did NOT extend the chat
endpoint to accept images. Instead we added a small camera-icon button
directly in `AssistantWidget`'s composer that calls the existing
`useCheckMagnet` mutation (same `/api/travels/magnets/check` endpoint the
standalone `MagnetCheckDialog` uses) and renders the verdict/matches as a
local, ephemeral UI card below the chat log — not appended to the persisted
`messages` array.

**Why:** Reusing the existing vision endpoint avoids duplicating the
Jina-CLIP-embedding + pgvector logic, and keeps the LLM tool-calling loop
(which only handles JSON actions) unchanged. The result card is ephemeral
(resets on send/new-conversation, doesn't survive a reload) because there's
no schema for storing "assistant sent an image-check result" as a persisted
chat message.

**How to apply:** When a checklist item asks elAIne to "do" something that
fundamentally requires a photo/file upload (not just text), look first for an
existing REST endpoint + React Query hook that already does the vision work
(e.g. `useCheckMagnet`, pottery/quilting reanalyze). Wire a dedicated
UI affordance straight to that hook inside the assistant widget rather than
teaching the general chat pipeline to accept multipart bodies. Add a short
system-prompt paragraph telling elAIne to point users at that UI control when
asked in plain text, since she still can't see or analyze the photo herself.
