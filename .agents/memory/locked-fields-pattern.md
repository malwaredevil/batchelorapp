---
name: Per-field locked_fields pattern
description: Recurring convention for letting users lock individual AI-extracted fields against overwrite during re-analysis, used in pottery, quilting, and travels.
---

## Pattern

- Add a `locked_fields` column: `text("locked_fields").array().notNull().default('{}')` on the record's table (additive migration, `CREATE ... IF NOT EXISTS` style per this project's schema rules).
- Expose it via a PATCH endpoint that accepts an optional `lockedFields: string[]` (kept independent from the data-correction body field, e.g. `extractedData`), so the client can toggle one lock without resending all data.
- In the AI re-analysis/rescan route: build a `Set` from `lockedFields`, then merge fresh AI output into existing data field-by-field, skipping any key in the set and skipping null/empty AI values (`locked.has(key) ? keep existing : ai value`).
- UI: a small lock/unlock icon button rendered per displayed field (both in read mode and in an edit-fields form), toggling calls the PATCH with the updated `lockedFields` array; a separate "rescan" action button re-triggers AI extraction respecting the locks.

**Why:** users correct AI-extracted fields by hand and don't want a future re-scan to clobber their correction; this exact shape (column + PATCH + merge-skip + icon toggle) has now been implemented three times (pottery items, quilting fabrics/patterns/quilts, travels trip documents) and should be reused rather than re-invented per feature.

**How to apply:** when adding "AI re-analyze/rescan" to any new record type in this repo, look for this shape first — table column, merge-skip logic, and lock icon UI — instead of designing a new locking mechanism.
