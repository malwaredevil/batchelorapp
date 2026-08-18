# Adding a new `lib/*` package (scaffold-lib generator)

Extracting shared logic into a `lib/*` package requires several easy-to-miss
wiring steps (composite tsconfig flags, root `tsconfig.json` references,
`@workspace/*` naming, consumer references + dependency). Use the generator
instead of doing it by hand:

```bash
pnpm --filter @workspace/scripts run scaffold-lib -- --name <name> \
  [--react] [--with-tests] \
  [--consumers artifacts/modules,lib/other] \
  [--dep-type dependencies|devDependencies] \
  [--run-install]
```

What it does in one step:

- Creates `lib/<name>/` with:
  - `package.json` named `@workspace/<name>` (React variant adds
    `react`/`react-dom` as `peerDependencies` per the lib convention)
  - `tsconfig.json` with `composite`, `declarationMap`, `emitDeclarationOnly`
    (React variant adds `jsx: "react-jsx"` and the `dom` lib)
  - `src/index.ts` barrel export (and `src/index.test.ts` + `vitest` with
    `--with-tests`)
- Registers the package in the root `tsconfig.json` `references` array.
- For each `--consumers` entry (workspace-relative dir), idempotently adds:
  - a project reference to the new lib in the consumer's `tsconfig.json`
    (comment-tolerant textual insertion, safe for JSONC artifact tsconfigs)
  - `"@workspace/<name>": "workspace:*"` in the consumer's `package.json`
    under `--dep-type` (default `devDependencies`; use `dependencies` for
    server artifacts that import the lib at runtime)

Afterwards run `pnpm install` (or pass `--run-install`) to link the package,
then `pnpm run typecheck:libs` — a freshly scaffolded empty package passes
with no manual fixup.

Variants:

- Plain TS lib (default) — matches `lib/ornaments-shared`.
- React-component lib (`--react`) — matches `lib/collection-ui`.

Source: `scripts/src/scaffold-lib.ts` (tests in `scripts/src/scaffold-lib.test.ts`).
