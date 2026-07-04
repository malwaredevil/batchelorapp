---
name: React hook called after an early return
description: Deterministic "Rendered more hooks than during the previous render" crash pattern — a hook call placed after a loading/null guard, not an HMR artifact.
---

A component-level custom hook (e.g. one that wraps `useEffect`/`useState` internally, named `useXyz`) placed textually _after_ an `if (isLoading) return ...` or `if (!data) return ...` guard violates React's Rules of Hooks: the hook is skipped on the render where the guard fires and executes for the first time on a later render, so React sees an extra hook and throws `Rendered more hooks than during the previous render`.

**Why:** This crash survives a full page reload (it's not stale Fast Refresh/HMR state) because it reproduces on every fresh mount that passes through a loading state before data arrives. Don't dismiss a hooks-order console warning as a benign dev-only HMR artifact without checking every hook call site's position relative to early returns — a real occurrence can look identical to a transient one until it's reproduced.

**How to apply:** When debugging this error, grep the suspect page/component tree for all `use[A-Z]` call sites and check each is unconditional — called before any `if (...) return` in that component, with only the _value passed into_ the hook (not the call itself) allowed to depend on loading/null state (e.g. `useThing(isLoading ? undefined : value)` is fine, gating the call itself is not). In this codebase, the recurring `usePageAssistantContext(pageId, text)` pattern across travels pages already does this correctly almost everywhere — the one violation found was `TripDetail.tsx`, where the whole call had been placed after the loading/not-found guards.
