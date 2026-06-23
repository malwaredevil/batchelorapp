---
name: OpenRouter model routing
description: How vision AI calls are routed through OpenRouter (Gemini Flash) with OpenAI fallback; which functions to use and which to avoid.
---

## The rule

All vision tasks in both pottery and quilting use `callModel(MODELS.FAST_VISION, ...)` or `callModel(MODELS.SMART_VISION, ...)` from `artifacts/api-server/src/lib/ai-client.ts`.

Never use the raw `callWithFallback()` for new vision work — that passes the same model string to both providers.

```typescript
import { callModel, MODELS } from "../ai-client";

// Fast/cheap vision (most tasks):
const completion = await callModel(MODELS.FAST_VISION, (c, model) =>
  c.chat.completions.create({ model, ... })
);

// Smart vision (comparison, complex analysis):
const completion = await callModel(MODELS.SMART_VISION, (c, model) =>
  c.chat.completions.create({ model, ... })
);
```

## MODELS constants

```typescript
MODELS.FAST_VISION  = { openrouter: "google/gemini-2.0-flash-001", openai: "gpt-4o-mini" }
MODELS.SMART_VISION = { openrouter: "google/gemini-2.0-flash-001", openai: "gpt-4o" }
```

**Why:** OpenRouter routes to Gemini Flash (cheaper, supports json_object response_format) and falls back to OpenAI gpt-4o-mini/gpt-4o on 429/503. `callWithFallback` passes the same model to both providers, which breaks when provider model identifiers differ.

**How to apply:** Any new vision call (image analysis, comparison, zone analysis, backstamp ID) should use `callModel(MODELS.FAST_VISION, ...)`. Use `SMART_VISION` only for multi-image comparison or complex multi-step reasoning.
