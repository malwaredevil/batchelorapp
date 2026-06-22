---
name: Quilting SVG fabric-texture previews
description: How fab:N fabric cells render as SVG patterns in quilting block/layout previews, and the per-SVG id-scoping rule that prevents wrong texture scaling.
---

# Quilting SVG fabric-texture previews

Block/layout/composer previews encode a fabric-backed cell as the string `fab:N`
(N = fabric id). That string is NOT a valid SVG color — it must be resolved to a
`<pattern>` fill, never passed to `fill={...}` raw.

## Rules

- Every SVG component that paints cells builds a `userSpaceOnUse` `<pattern>` per
  used fabric id (an `<image href={fabricUrlMap[N]}>` sized to the cell px), then
  routes ALL fills through a resolver `rf(c)`:
  `fab:N` → `url(#<prefix>-N)` when `fabricUrlMap[N]` exists, else `#D1D5DB`;
  plain hex passes through. `fabricUrlMap` comes from `useListFabrics()` +
  `buildFabricUrlMap` (FabricPicker).
- **Scope pattern ids per-SVG instance** with
  `` const patternPrefix = `<base>-${useId().replace(/:/g, "")}` `` and thread it
  to child `SvgCell`s via a `patternPrefix` prop.
  **Why:** pattern ids are global within the document; many same-id patterns
  (e.g. `fab-3`) across list/grid previews of different cell sizes make browsers
  bind `url(#fab-3)` to the first match → visibly wrong texture scale. useId()
  makes each preview's ids unique.
- Cover EVERY fill path: solid/half/quad/triangle — and the triangle has two
  branches (`nwse` and `nesw`) at different indentation, so a `replace_all` on one
  indentation silently misses the other. Grep `fill=\{p\.` afterwards to confirm
  none are raw.
- Layout trims (border/sashing/cornerstone) can also be `fab:N` (the composer lets
  users pick fabric trims) — resolve them too and add their ids to the `<defs>`
  collection, not just block cells.
- The static export (`buildLayoutSvgString`) renders block cells as flat
  placeholders by design (no embedded fabric images); fab-backed trims there are
  sanitized to a solid swatch so the export never emits invalid `fill="fab:N"`.

**How to apply:** when adding any new SVG that paints quilt cells, copy this
resolver + per-instance `useId()` prefix pattern; don't reintroduce global ids.
