---
name: API contract packaging (batchelor merge)
description: How the unified OpenAPI contract is composed for the merged pottery+quilting monorepo, and why.
---

# Unified API contract — composition strategy

**Decision:** ONE shared API contract (`@workspace/api-spec` → `@workspace/api-client-react` + `@workspace/api-zod`), built by a **deterministic composition script**, NOT hand-edited YAML and NOT per-app client libs.

**Why:** Target architecture is single-login / single API surface with namespaced runtime routes. A single source-of-truth contract avoids duplicate auth contracts and authz drift across two apps. Per-app client libs were rejected (extra package graph + shared-auth duplication). Hand-merging the 3600-line YAML was rejected (duplicate keys / dangling $ref risk).

**How to apply (namespacing matrix):**

- Shared, deduped once (take from quilting, the superset): `/healthz`, `/auth/*`. Stay un-namespaced. Schemas referenced by these stay unprefixed (the only "shared" schemas).
- Pottery feature paths → prefixed `/pottery/*`. The pottery item root `/pottery` is renamed to `/pottery/items` (avoids ugly `/api/pottery/pottery`). `/categories`→`/pottery/categories`, `/compare`→`/pottery/compare`, `/stats`→`/pottery/stats`.
- Quilting feature paths → prefixed `/quilting/*` (fabrics, patterns, quilts, categories, stats, blocks, layouts, shopping, compare).
- operationIds: only rename COLLISIONS (categories/stats/compare CRUD + healthCheck/auth which are deduped). Prefix `Pottery`/`Quilting`. Unique opIds keep their names so frontends need minimal hook-rename churn.
- Schema component keys: prefix only colliding (non-shared) names with `Pottery`/`Quilting`; rewrite all `$ref`s in that app's subtree. Harmless duplication (e.g. ErrorResponse) is acceptable over collision risk.
- Server runtime: shared auth/health at root `/api`; Express sub-routers mounted at `/api/pottery` and `/api/quilting`; route files use namespace-relative paths (`/items`, `/categories`, ...).

**Codegen:** orval forces `info.title = "Api"` → generated `api.ts`; do not change title. If api-zod hits TS2308, apply quilting's `patch-index.cjs` (strips the `generated/types` re-export). Acceptance gate for the build: `codegen` succeeds AND `pnpm run typecheck:libs` passes.

**Source of truth lives in-repo** (copies of both source specs under `lib/api-spec/`), regenerated via a committed build step wired into the `codegen` script — never read from /tmp at build time.
