---
name: OpenAPI source path remapping gotcha (batchelor monorepo)
description: Why a pottery.yaml path with an extra "/items" segment silently double-prefixed a generated URL
---

`lib/api-spec/build-spec.ts`'s `remapPotteryPath()` already expands any source path of the
form `/pottery/xxx` to `/pottery/items/xxx` (mirroring the real Express mount:
`/pottery` router → `/items/xxx` sub-route). If a path is authored in
`lib/api-spec/sources/pottery.yaml` as `/pottery/items/xxx` (already including the
`items` segment), the remap doubles it into `/pottery/items/items/xxx`, which 404s at
runtime but still typechecks and codegens cleanly — nothing catches this except an
actual authenticated curl against the generated URL.

**Why:** `pottery.yaml` paths are not 1:1 with the real Express route tree; they get
mechanically rewritten by `build-spec.ts`. Authoring a path exactly like the server's
literal mount path looks correct but silently miscompiles.

**How to apply:** when adding/editing a pottery path in the source spec, compare it
against sibling paths in the same file (they all use the bare `/pottery/...` form,
never `/pottery/items/...`) rather than copying the server's literal route string.
Same caution applies to `remapQuiltingPath`/`remapTravelsPath` if their prefixing logic
ever gets similarly special-cased. Verify new/changed paths with a live authenticated
curl call, not just typecheck — codegen has no way to know the URL is wrong.
