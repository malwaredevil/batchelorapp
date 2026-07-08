---
name: OpenRouter model routing
description: All AI calls (chat, vision, embeddings) go through OpenRouter exclusively — no direct OpenAI fallback. Which functions to use.
---

## The rule

Every AI call in the API server — chat, vision, and embeddings — routes through OpenRouter using `artifacts/api-server/src/lib/ai-client.ts`. There is no direct-provider fallback: `OPENROUTER_API_KEY` is a required env var, and `OPENAI_API_KEY` is not used anywhere in the app.

```typescript
import { callModel, MODELS } from "../ai-client";

const completion = await callModel(MODELS.FAST_VISION, (client, model) =>
  client.chat.completions.create({ model, ... })
);
```

`MODELS` values are plain OpenRouter model identifier strings (e.g. `"google/gemini-2.5-flash"`), not `{openrouter, openai}` pairs — that dual-provider shape was removed. `callModelWithAdvisor`/`callModelWithSubagent` follow the same one-provider pattern and always pass their OpenRouter server-tool array (never `undefined`).

Embeddings also go through OpenRouter's unified embeddings endpoint (`MODELS.EMBEDDING = "openai/text-embedding-3-small"`), called via `getOpenRouterClient().embeddings.create(...)` — OpenRouter proxies OpenAI's embedding models too, so no direct OpenAI key is needed for that either.

**Why:** User wants all AI token spend/billing tracked in one place (OpenRouter) instead of split across OpenAI/Gemini/OpenRouter accounts. Direct-OpenAI fallback was removed entirely — if OpenRouter is unavailable, calls now fail rather than silently billing a different provider.

**Exceptions (left untouched, not OpenRouter-routable):** Voyage AI reranking (`lib/reranker.ts`) and Jina visual/CLIP embeddings (`lib/visual-embed.ts`) remain direct API calls — OpenRouter doesn't offer either capability.

**How to apply:** Any new AI call site must use `callModel`/`callModelWithAdvisor`/`callModelWithSubagent` with a `MODELS.*` OpenRouter identifier. Never instantiate a raw `new OpenAI({apiKey: ...})` client pointed at OpenAI's API directly — add a new `MODELS` entry with an OpenRouter model string instead.

**Perplexity `return_images` passthrough is undocumented/best-effort on OpenRouter.** Sonar (research model) is called through OpenRouter, so adding Perplexity-only request extensions like `return_images: true` isn't guaranteed to reach the underlying provider or come back populated — treat any `raw.images`-style field as optional/absent-by-default, never assume it's reliably populated just because the direct Perplexity API docs say so.
