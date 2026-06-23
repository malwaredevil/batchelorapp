---
name: Quilting SVG fabric-texture previews
description: How fab:N fabric cells render as SVG <pattern> fills, and the cell-parser token-splitting bug that turned fabric half-square-triangles into black blocks.
---

# Quilting SVG fabric-texture previews

Block/layout/composer previews encode a fabric-backed cell as the string `fab:N`
(N = fabric id). That string is NOT a valid SVG color — it must be resolved to a
`<pattern>` fill. The page-local `SvgCell` resolvers turn `fab:N` into
`url(#<prefix>-N)` (prefix `fab` in blocks/index & layouts/index, `mini-fab` in
composer `BlockMini`, `layout-fab` in composer `LayoutGrid`) and each SVG's
`<defs>` declares the matching `<pattern>`. The defs collectors scan raw cell
strings with a global `/fab:(\d+)/g` regex, so they always emit the right
patterns. **An unresolved `url(#missing)` paint ref falls back to the SVG default
fill, which is BLACK** (not transparent). Black blocks = the resolver emitted a
`url(#...)` / invalid color that doesn't match any rendered `<pattern>`.

## The real bug: parseCell mangled fab:N tokens inside composite cells

Composite cells store multiple colors joined by `:` —
e.g. a half-square triangle is `"nesw:fab:19:fab:10"` (two fabric tokens that
each ALSO contain a colon). The shared `lib/cell-parser.ts` `parseCell()` was
written assuming every color was a `#hex` value:

- triangle branch used `cell.indexOf(":", 5)` to find the a/b separator;
- quad/hsplit/vsplit/xsplit used `split(/:(?=#)/)` (split only before `#`).

Both split at the WRONG colon for `fab:N` tokens, yielding e.g. `a="fab"`,
`b="19:fab:10"` — invalid SVG colors → black fill. Pure `#hex` cells parsed fine,
which is why the bug only showed on fabric (not solid-color) triangles/splits.

**Fix:** a `splitColorTokens(s)` helper that splits on `:` then rejoins any
`"fab"` segment with its following numeric id, keeping `fab:<id>` intact. Used in
the triangle, quad, hsplit, vsplit, xsplit branches. Backward-compatible with
`#hex` cells. Because `parseCell` is shared, this fixes every surface at once
(Block Designer list, Layout Composer palette, Layout thumbnails, the live
designer canvas via `CellShape.tsx`, and SVG export).

**Why this took several tries:** an earlier session misdiagnosed it as
`useId()`-scoped pattern ids and "fixed" it by restoring files to upstream — but
**upstream `malwaredevil/quilting` has the byte-identical broken parser**, so
restoring to upstream changed nothing. "Byte-identical to upstream" does NOT mean
"not the bug site" — upstream can be wrong too. Diagnose from the actual stored
data, not from a diff against upstream.

## How to debug black blocks next time

1. Query the real cells: `quilting_blocks.cells` via Supabase REST
   (`$SUPABASE_URL/rest/v1/quilting_blocks?select=cells` with the service-role key
   as `apikey`+`Authorization` — direct PG is DNS-blocked from dev).
2. If cells contain composite `fab:N` encodings (`nesw:`/`quad:`/`*split:`),
   verify `parseCell` returns intact `fab:N` tokens for a/b (not `"fab"` / `"N:..."`).
3. Zero `/api/quilting/fabrics/:id/image` requests in api-server logs while blocks
   are black = the `<image>` hrefs are never emitted because the resolver got a
   mangled token, not because images are missing.

## Follow-up (not yet done)

No vitest harness exists in `@workspace/quilting`. A focused parser unit test
(mixed `fab:` + hex + malformed payloads across all composite kinds) would lock
this fix against regression.

**How to apply:** when touching cell encoding/decoding, remember a color token may
be `fab:<id>` (contains a colon) OR `#hex`; never split composite cells with a
naive `:`/`#`-only split — route through `splitColorTokens`.
