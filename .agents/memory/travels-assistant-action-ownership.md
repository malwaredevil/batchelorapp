---
name: elAIne assistant action executor ownership checks
description: Confirm-then-execute action executors in travels/assistant.ts silently trusted raw resource IDs; ownership must be enforced per-executor even though userId is already threaded through.
---

Fixed a horizontal-access-control gap in `ACTION_EXECUTORS` (assistant.ts): most executors looked up trips/reminders/wishlist items by `eq(table.id, id)` only, never checking `table.userId` against the session's user, even though the `ActionExecutor` type signature already passes `userId` as a second argument to every executor.

**Why:** the two "creator" actions (`create_trip`, `add_wishlist`) already used `userId` correctly (insert with `userId: userId`), which made it easy to assume the pattern was followed everywhere — but every other executor (updates/deletes/inserts against an existing resource) ignored the param entirely. A shared type signature having a `userId` parameter is not proof every implementation uses it; each executor's WHERE clause has to be checked individually.

**How to apply:** when auditing or adding a new confirm-then-execute action (or any executor pattern with a shared function signature across many implementations), verify each individual executor's DB query includes an ownership predicate — don't infer correctness from the type signature or from sibling executors that do it right. Prefer `and(eq(table.id, id), eq(table.userId, userId))` and return 404 (not 403) on mismatch to avoid confirming another user's resource exists. For lookups from a child table (e.g. a reminder keyed by `reminderId` with its own `userId` column), check the child row's own `userId`, not just its parent trip's.
