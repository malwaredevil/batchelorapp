---
name: API server dev workflow has no hot reload
description: pottery/quilting/travels API server `dev` script builds once then starts the compiled bundle — code edits require a manual workflow restart to take effect
---

`artifacts/api-server`'s `dev` script is `build && start` (esbuild → `dist/index.mjs`, then `node dist/index.mjs`) — it is not a watch/reload setup. If the workflow was already running before you edit server-side code (routes, Elaine tools/executors, etc.), the live process keeps serving the old compiled build until you explicitly restart the workflow.

**Why:** Discovered when a newly-added Elaine tool (`merge_pottery_categories`) was fully correct in source and passed typecheck, but the live chat model insisted the tool "doesn't exist" — the running server was still serving a build from before the tool was added. A few isolated curl tests looked like a real LLM tool-selection bug before the stale-build explanation was found.

**How to apply:** After editing any file under `artifacts/api-server/src/**`, restart the `artifacts/api-server: API Server` workflow before testing behavior live (curl/chat/UI) — don't assume typecheck-passing code is already running. If a live behavior contradicts what the source code clearly does, suspect a stale build before suspecting a logic/prompt bug.
