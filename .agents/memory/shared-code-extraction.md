---
name: Sharing code across artifacts vs within one artifact
description: Where shared code must live in this monorepo, and the safe pattern for deduping without breaking import surfaces.
---

# Sharing code in the Batchelor monorepo

## Rule
- **Across leaf artifacts** (e.g. `artifacts/pottery` ↔ `artifacts/quilting`): shared code MUST live in a `lib/*` workspace package. Leaf artifacts may not import each other — that is a hard repo constraint (see `pnpm-workspace` skill). Frontend shared UI/util/hooks/context go in `lib/web-core` (composite lib).
- **Within a single artifact** (e.g. duplication between `api-server/src/lib/openai.ts` and `api-server/src/lib/pottery/openai.ts`): a plain local module in that artifact's `src/lib/` is already "shared" — no workspace package needed.

## Safe dedup pattern (no churn to callers)
- Convert the old file into a **thin re-export adapter** so every existing `@/lib/*` / `@/hooks/*` import keeps working unchanged: `export * from "@workspace/web-core/<subpath>";`.
- **Why:** dozens of downstream imports reference the old paths; re-export adapters preserve the import surface so the dedup is mechanical and low-risk.

## Adding a composite frontend lib (checklist that actually mattered)
- `tsconfig.json`: `composite`, `declarationMap`, `emitDeclarationOnly`, and `jsx: "react-jsx"` if it has `.tsx`.
- Add the lib to the **root** `tsconfig.json` `references`.
- Add `@types/react: catalog:` to the lib's devDependencies — without it the lib's `.tsx` fails with TS2307 "cannot find module 'react'" even though apps compile.
- Add `react`/`react-dom` as **peerDependencies** (not deps) on the lib.
- Subpath exports: plain-string `exports` map entries resolve under both Vite and TS here (`customConditions: ["workspace"]` is set in `tsconfig.base`).
- Add `@workspace/web-core: workspace:*` to each consuming app's devDependencies, then `pnpm install`.

## Keep genuinely-different domain logic separate
- Only the truly identical bits were extracted. The pottery vs quilting vision prompts, `VisionAnalysis` shapes, and compare logic are different domains — left separate on purpose. Storage modules were ~95% identical (only the bucket differed) → consolidated behind a class `ImageStorageService(bucket)`, but each app keeps its own data-URL helper (pottery shrinks for AI; quilting bounded re-encode).
