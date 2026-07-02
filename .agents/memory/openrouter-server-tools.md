---
name: OpenRouter server tools (advisor/subagent)
description: How to wire openrouter:advisor and openrouter:subagent server tools into callModel() call sites. OpenRouter-only, no direct-provider fallback to worry about.
---

OpenRouter's `openrouter:advisor` and `openrouter:subagent` server tools (beta, June 2026) are OpenRouter-specific `tools` array entries executed by OpenRouter itself, not by our code — the model decides mid-generation whether to invoke them.

- `advisor`: lets a cheap/fast model escalate UP to a stronger model on a hard case (e.g. ambiguous backstamp, illegible date). Only fires when the model is actually unsure, so normal-case cost is unchanged.
- `subagent`: lets a frontier/orchestrator model delegate DOWN a self-contained sub-task to a cheap worker model, so it doesn't burn its own expensive tokens on busywork.

**Why this needed a wrapper, not just passing `tools` inline:** these tool types aren't part of the OpenAI SDK's `ChatCompletionTool` union (SDK only knows `type: "function"`), so any call site that wants these tools needs a type cast at the request site.

**How to apply:** use `callModelWithAdvisor(model, instructions, fn)` / `callModelWithSubagent(model, instructions, fn)` in `artifacts/api-server/src/lib/ai-client.ts` — they mirror `callModel()` but pass a third `tools: OpenRouterServerTool[]` argument into `fn` (always defined — there is no direct-provider fallback path anymore), spread into the `chat.completions.create()` call via `...({ tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] })`. Best candidates are vision/extraction tasks with a real ambiguity axis (maker's marks, illegible dates) for advisor, and multi-turn assistants with delegable sub-lookups for subagent — not every call site needs one.
