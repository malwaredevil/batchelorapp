---
name: Zod .partial() does not strip .default()
description: Why a PATCH schema built via CreateSchema.partial() can silently reset omitted fields to their defaults, corrupting data on single-field updates.
---

# Zod `.partial()` + `.default()` silently resets omitted fields

`SomeSchema.partial()` wraps every field in `.optional()`, but if a field
already has `.default(x)`, the default still fires whenever the key is
missing from the input — because "missing key" and "explicit `undefined`"
both trigger a default-wrapped schema's default value. The result: a PATCH
body that only sends one changed field will still get every defaulted field
reset to its default value on write.

**Why:** discovered because a per-field inline-edit UI stopped sending the
full object on every save (by design — send only the changed field). Any
route whose update schema is `CreateSchema.partial()` and whose create
schema has `.default(...)` on some fields is at risk, and the bug is silent
(200 OK, just wrong data) until you diff before/after field values.

**How to apply:** before building or trusting a per-field PATCH/update route,
check whether its schema is derived via `.partial()` from a schema with any
`.default()` fields. If so, override those specific fields in the update
schema with plain `.optional()` (no default) so omitted keys are left
untouched. Verify with a curl PATCH that sends only one field and confirms
unrelated fields are unchanged in the response — don't just trust typecheck
or a 200 status.
