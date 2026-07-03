---
name: SSE streaming with mid-stream directive detection
description: Pattern for streaming a chat completion to the client while detecting an embedded machine-readable directive as soon as it fully arrives, not just at the end.
---

When a chat feature needs to show a proposed action (or any bracketed directive like `[[ACTION: ...]]`) as soon as it's ready, rather than waiting for the whole reply, stream the completion with `stream: true` and run the *same* directive regex against the growing accumulated buffer after every chunk. A regex that requires the closing delimiter (`]]`) naturally returns no match until the directive is complete — no special "is this JSON complete yet" parsing is needed, and it can't misfire on truncated JSON.

**Why:** The alternative (parse only after the full completion resolves) is what created the "actions only appear at the end" bug in the first place. Re-running the same finalization regex/parser incrementally is simpler and less bug-prone than writing a separate streaming-aware parser.

**How to apply:**
- OpenRouter's server tools (`openrouter:advisor`, `openrouter:subagent`) work fine combined with `stream: true` — no special handling needed, the tool execution is transparent to the streamed content.
- Express: SSE requires `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and `res.flushHeaders()` before writing; wrap the whole handler body in try/catch and emit an `error` SSE event + `res.end()` on failure — you can't fall back to `res.status().json()` once headers are sent.
- Client: don't force streaming endpoints through a JSON-only generated API client (e.g. orval/react-query codegen) — hand-write a small `fetch` + `ReadableStream` reader that splits on `\n\n`, parses `event:`/`data:` lines, and dispatches per event type. Keep using the generated hooks for every other (non-streaming) endpoint.
