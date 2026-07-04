---
name: Elaine brand casing migration
description: Where the assistant's name-casing lives across the codebase and why fixing display strings alone isn't enough.
---

The travel assistant's display name was stylized "elAIne" and later migrated to "Elaine" (proper capitalization). The casing/styling of this name is NOT centralized in one place — it independently appears in three kinds of surfaces that must all be updated together:

1. **UI components** — `artifacts/travels/src/components/assistant/ElaineAvatar.tsx` exports `ElaineName`/`ElaineWordmark`, which both reference a single shared `AI_HIGHLIGHT_CLASS` constant. Any styling change (e.g. removing italics) here fixes every UI occurrence at once since all consumers import these two components rather than hardcoding spans.
2. **Outbound email copy** — `artifacts/api-server/src/lib/email.ts` hardcodes the display name in the `FROM` header, HTML body, and plain-text signature independently of the UI strings above.
3. **AI system prompts** — `artifacts/api-server/src/routes/travels/assistant.ts` (main chat system prompt + subagent instructions) and `artifacts/api-server/src/lib/expert-consult.ts` tell the model what to call itself. If these still say "elAIne", the model will keep writing the old casing into its own generated replies/emails even after every hardcoded UI/email string is fixed.

**Why:** the model's self-reference is generative, not a template substitution — it mirrors whatever name the system prompt gives it, independent of surrounding UI code.

**How to apply:** for any future rename/style change to the assistant's name, check all three surfaces (components, email templates, system prompts) — grep for the old string across `artifacts/api-server` and `artifacts/travels`, not just the obvious UI file.
