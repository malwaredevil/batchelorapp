---
name: Orval codegen broken by js-yaml major bump
description: pnpm-workspace.yaml overrides using an unbounded floor (">=4.2.0") can silently jump a transitive dep to a breaking major version; orval + js-yaml is a concrete instance.
---

Orval's CLI does `import yaml from "js-yaml"` (default-export/CJS-interop style). js-yaml@5 is ESM-only with no default export, so once a workspace `overrides:` entry resolved to js-yaml@5, `orval` failed at import time with an opaque error, and codegen got silently abandoned in favor of hand-patching generated files.

**Why:** A security/version override like `js-yaml: ">=4.2.0"` has no upper bound, so a routine `pnpm install` can jump multiple majors the moment a new one is published — the override was written to satisfy a security floor, not to pin a working major.

**How to apply:** When a workspace-wide `overrides:` entry only has a `>=` floor, treat it as latent risk for any tool that has strict interop expectations (CJS default-export imports, etc.). If a devDependency-only tool starts failing after `pnpm install` with import/interop errors, check `pnpm-workspace.yaml` `overrides:` for an unbounded floor on the failing package first. Fix by adding an explicit upper bound (e.g. `">=4.2.0 <5.0.0"`) with a comment explaining why, not by pinning an exact version (which would lose future patches).

Separately: after fixing codegen and regenerating, an ambiguous-export TS2308 error can surface in a hand-maintained barrel (`index.ts`) if a hand-written parallel implementation (e.g. a large hooks file written while codegen was broken) defines the same names the generator now produces again. Fix by explicitly re-exporting the hand-written names from the barrel (explicit named exports win over ambiguous `export *`), not by touching generated output. Don't assume the hand-written file is redundant — check every consumer import before deleting.
