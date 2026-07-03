---
name: Quilting IDOR fix pattern
description: How cross-user authorization bugs were found and fixed across quilting API routes, and what to check for in similar multi-tenant route files.
---

Helper functions can have docstrings/comments claiming they filter by ownership
(e.g. "Prevents horizontal privilege escalation") while the actual `.where()`
clause omits the `userId` condition entirely. Always read the real query, not
the comment above it, when auditing authorization.

**Why:** In quilts.ts, `filterOwnedFabricIds`/`filterOwnedPatternIds` had exactly
this bug — the docstring described ownership filtering, but `eq(fabrics.userId,
userId)` was missing from the `.where(and(inArray(...)))` clause, so any
authenticated user could link another user's fabrics/patterns into their own quilt.

**How to apply:** When auditing a route file for IDOR/authorization gaps:
1. Grep for every `.where(` and check whether `userId` appears in the same clause.
2. For polymorphic/join tables with no `userId` column (e.g. `quiltingImages`,
   `entityCategories`, `quiltFabricLinks`), ownership must instead be verified by
   checking the parent entity's `userId` before touching the child row — this is
   correct on its own, no schema change needed.
3. Raw SQL (`sql\`...\``) needs the same scrutiny — a `WHERE` clause built with
   template literals can just as easily omit the tenant filter as an ORM query.
4. Don't trust a helper's name or comment as proof it does what it says.
