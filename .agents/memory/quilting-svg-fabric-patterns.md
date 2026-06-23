---
name: Quilting SVG fabric-texture previews
description: How fab:N fabric cells render as SVG <pattern> fills in quilting block/layout previews, and the STATIC pattern-id scheme that must be kept (useId() scoping breaks it → black blocks).
---

# Quilting SVG fabric-texture previews

Block/layout/composer previews encode a fabric-backed cell as the string `fab:N`
(N = fabric id). That string is NOT a valid SVG color — it must be resolved to a
`<pattern>` fill, never passed to `fill={...}` raw (raw → renders black).

## The pattern-id scheme is STATIC and must stay static

The shared renderer `components/CellShape.tsx` **hardcodes** `url(#fab-${id})` and
takes NO `patternPrefix` prop. The page-local `SvgCell` renderers use a static
`patternPrefix` default per surface: `"fab"` (blocks/index, layouts/index),
`"mini-fab"` (composer `BlockMini`), `"layout-fab"` (composer `LayoutGrid`, also
its default). Each SVG's `<defs>` must declare `<pattern id="<prefix>-${id}">`
matching exactly what its renderer emits:
- blocks/index & layouts/index thumbnails → defs `fab-${id}` + `SvgCell` default `fab`.
- composer `BlockMini` → defs `mini-fab-${id}` + `SvgCell patternPrefix="mini-fab"`.
- composer `LayoutGrid` → defs `layout-fab-${id}` + `SvgCell` default `layout-fab`;
  trims via `resolveFabricFill` → `url(#layout-fab-${id})`.

**Do NOT introduce `useId()`-scoped pattern ids** (e.g. `fab-${useId()}-N`).
**Why:** it makes the `<defs>` ids no longer match the `url(#fab-N)` that
`CellShape` (and the static-default `SvgCell`s) emit → fills reference a
non-existent pattern → **black blocks**. A 2026-06 in-session "fix" added useId
scoping to prevent a theoretical cross-preview mis-scale and instead caused the
black-block regression across composer.tsx + blocks/index.tsx + layouts/index.tsx.
The duplicate-global-id mis-scale concern did not justify the breakage.

## Canonical source of truth

The standalone repo **`malwaredevil/quilting`** is the reference for this app's
rendering (the quilting app lives under `artifacts/pottery/` there). When in doubt,
diff against it. In this monorepo the same code lives under `artifacts/quilting/`,
and these render files are byte-identical to upstream EXCEPT the merge-required
`Quilting*` API renames: `useListCategories`→`useListQuiltingCategories`,
`Category`→`QuiltingCategory`, `CreateBlockInputGridSize`→
`QuiltingCreateBlockInputGridSize`. `CellShape.tsx`, `cell-parser.ts`,
`FabricPicker.tsx`, `svg-export.ts` are identical to upstream — never the bug site.

## Known non-bug

Upstream layouts/index `LayoutPreview` + `buildLayoutSvgString` paint layout TRIMS
(border/sashing/cornerstone) with the raw color string, so a `fab:N` trim would
render black in list thumbnails/exports. This is a rarely-hit trims-only edge case
left faithful to upstream; do not re-add a per-instance resolver here just to
"fix" it — that reintroduces divergence. Block-cell fabric previews are correct.

**How to apply:** when adding any new SVG that paints quilt cells, copy the static
`fab-${id}` / `<prefix>-${id}` resolver and matching `<defs>`; keep ids static.
