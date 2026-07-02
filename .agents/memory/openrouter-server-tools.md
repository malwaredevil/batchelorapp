---
name: OpenRouter server tools (advisor/subagent)
description: How to wire openrouter:advisor and openrouter:subagent server tools into existing callModel() call sites without breaking the direct-OpenAI fallback.
---

OpenRouter's `openrouter:advisor` and `openrouter:subagent` server tools (beta, June 2026) are OpenRouter-specific `tools` array entries executed by OpenRouter itself, not by our code — the model decides mid-generation whether to invoke them.

- `advisor`: lets a cheap/fast model escalate UP to a stronger model on a hard case (e.g. ambiguous backstamp, illegible date). Only fires when the model is actually unsure, so normal-case cost is unchanged.
- `subagent`: lets a frontier/orchestrator model delegate DOWN a self-contained sub-task to a cheap worker model, so it doesn't burn its own expensive tokens on busywork.

**Why this needed a wrapper, not just passing `tools` inline:** these tool types aren't part of the OpenAI SDK's `ChatCompletionTool` union (SDK only knows `type: "function"`), and the plain OpenAI API errors if it receives them at all. Any call site that wants these tools needs (1) a type cast at the request site, and (2) to omit `tools` entirely on the direct-OpenAI fallback path (no `OPENROUTER_API_KEY`, or OpenRouter unavailable/rate-limited).

**How to apply:** use `callModelWithAdvisor(models, instructions, fn)` / `callModelWithSubagent(models, instructions, fn)` in `artifacts/api-server/src/lib/ai-client.ts` — they mirror `callModel()` but pass a third `tools: OpenRouterServerTool[] | undefined` argument into `fn`, spread conditionally (`...(tools ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] } : {})`) into the `chat.completions.create()` call. Best candidates are vision/extraction tasks with a real ambiguity axis (maker's marks, illegible dates) for advisor, and multi-turn assistants with delegable sub-lookups for subagent — not every call site needs one.
