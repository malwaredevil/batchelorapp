# Composition and Configuration Architecture

Batchelor App is one application with several domains and three SPA bundles.
Shared behavior must therefore be implemented once and consumed through typed
composition points. A domain should normally configure a shared capability; it
should not copy and rename the capability.

This is the highest-priority design rule for new and changed code after the
repository's safety, data-integrity, and security boundaries in `AGENTS.md`.

## The seven techniques behind the rule

"Composition and configuration" is shorthand for seven concrete techniques.
`AGENTS.md` §4.10 has the full detail; in one line each:

1. **DRY** — the same logic/string/literal never exists in two places on purpose.
2. **Reusable modules/components** — a stable-interface unit published from `lib/*`.
3. **Generic programming** — parameterize by type/config instead of writing one
   near-identical function per entity (`getPotteryFoo`/`getQuiltingFoo`/... is a
   smell; a single generic function with a type parameter is the fix).
4. **Composition** — assemble small focused pieces instead of one bespoke
   implementation per call site.
5. **Shared layouts/page shells** — `@workspace/app-shell` and
   `@workspace/collection-ui` own page structure; domains supply content.
6. **Adapter/strategy pattern** — inject differing behavior behind a shared
   interface instead of branching inside a shared implementation.
7. **Scaffolding/code generation** — start a new Elaine action tool, collection
   module, or shared `lib/*` package from `pnpm --filter @workspace/scripts run
scaffold:*` instead of hand-copying an existing example.

## Required decision order

Before adding or changing behavior:

1. Search for the same user interaction, policy, data transformation, provider
   integration, or page structure elsewhere in the monorepo.
2. Reuse an existing shared primitive if its contract already fits.
3. If several consumers need the same mechanism, put the mechanism in the
   narrowest appropriate shared package or server library.
4. Express domain differences through typed configuration, callbacks, adapters,
   slots, and small wrappers.
5. Extend a shared contract only when the domain difference is genuine. Do not
   add conditionals for one domain to an unrelated shared primitive.
6. Keep a local implementation only when it is truly page-specific. Document
   why sharing would make the contract less coherent.

## What belongs together

| Concern                                    | Shared mechanism                                   | Domain-owned configuration                                 |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------- |
| Global navigation and account controls     | `@workspace/app-shell`                             | Navigation entries, labels, destinations, optional actions |
| Collection item presentation and editing   | `@workspace/collection-ui` and collection helpers  | Fields, categories, labels, domain mutations               |
| Elaine page context                        | `@workspace/elaine-ui` context formatters/provider | Entity name, ID, visible fields, page summary              |
| Browser monitoring                         | `@workspace/web-core/sentry`                       | DSN, release, environment enablement                       |
| AI providers and Responses API             | Server provider facades                            | Model/task options and rollout configuration               |
| Upload, capture, validation, and downloads | Existing shared packages/helpers                   | Bucket, MIME policy, file naming, domain callbacks         |
| Repeated database/query policy             | Focused server library                             | Table/schema adapter and domain predicates                 |

## Review questions

Every implementation and pre-publish review must answer:

- Did this change copy a component, formatter, API wrapper, query policy, or
  provider setup that already exists?
- If two or more domains need it, is the behavior implemented once?
- Are differences data/configuration instead of branches scattered through the
  shared implementation?
- Does the shared contract have focused tests, with domain tests limited to
  adapter-specific behavior?
- Did the change update `check-domain-composition.ts` when it established a new
  architectural boundary worth protecting?

## Accepted examples

- `ApplicationHeader` owns global chrome while each SPA supplies typed slots.
- Collection pages use shared hero, panel, quick-edit, category, and upload
  primitives while domain pages supply their fields and actions.
- `formatElaineContextList` owns bounded list formatting while domain pages
  describe which entity fields Elaine needs.
- `initBrowserMonitoring` owns Sentry privacy, sampling, and HTTP policy while
  each SPA supplies only its environment values.

## Rejected examples

- Three artifact-local copies of the same global menu or Sentry initialization.
- Pottery, quilting, and ornaments each implementing their own generic upload,
  category picker, or detail shell.
- Repeated page-local `slice().map().join()` conventions for Elaine context.
- A new route constructing an OpenAI client instead of using the provider
  facade.
- Copying a server query and changing only table names when a typed adapter or a
  shared policy function would remain coherent.

## Scaffolding and code generation

Three structures recur often enough to warrant a generator instead of a manual
checklist. Start from these when building one of them, and complete the same
checklist by hand if you don't use the generator:

- **New Elaine action tool** — `pnpm --filter @workspace/scripts run scaffold:elaine-action -- <name>`
  (encodes the 9-step checklist in `AGENTS.md` §7).
- **New collection module** — `pnpm --filter @workspace/scripts run scaffold:module -- <name>`
  (encodes the `new-batchelor-module` skill's conformity checklist).
- **New shared `lib/*` package** — `pnpm --filter @workspace/scripts run scaffold:lib -- <name>`
  (wires `package.json`/`tsconfig.json`/exports/workspace references).

## Automated detection

`scripts/src/check-domain-composition.ts` runs two complementary sections.
`scripts/src/check-duplicate-code.ts` runs a third, described in
[Section 3](#section-3--heuristic-duplicate-code-detection) below.

### Section 1 — Named-file requirements

Specific files must contain (or must not contain) designated string tokens.
These protect boundaries that have been explicitly established. When you create
a new shared mechanism, add a named-file requirement in the **same change**.

### Section 2 — General pattern scans

Source directories are walked and every file is tested regardless of whether it
was named when the check was written. These scans catch new violations before
they ship.

| What is scanned                                    | What triggers a violation                                                                       | Correct pattern                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| All `.ts` / `.tsx` files                           | `Sentry.init(` outside `lib/web-core/src/sentry.ts` or `artifacts/api-server/src/instrument.ts` | `initBrowserMonitoring()` from `@workspace/web-core/sentry`                             |
| `artifacts/api-server/src/routes/**/*.ts`          | `new OpenAI(` in a route handler                                                                | `getOpenRouterClient()` / `callModel()` from `lib/ai-client.ts`                         |
| All `.tsx` page files not in the legacy-exempt set | `usePageAssistantContext` present without `@workspace/elaine-ui` import                         | `formatElaineContextList()` + `formatElaineContextEntity()` from `@workspace/elaine-ui` |

### Migration candidates

The following pages predate the Elaine context formatting rule and still use
inline `.join()` / `.slice().map()`. They are in the general-scan exempt set
and tracked as migration candidates. When each is migrated, remove it from
`ELAINE_CONTEXT_LEGACY_EXEMPT` in the check script so future changes to that
page are covered.

**Ornaments:** `camera-add`, `hallmark-events`, `scan`, `stats`
**Pottery:** `categories`, `compare`, `detail`, `scan`, `stats`
**Quilting:** `blocks/cut-pattern`, `blocks/designer`, `blocks/detail`,
`blocks/index`, `blocks/whole-quilt-list`, `blocks/whole-quilt`, `categories`,
`compare`, `fabrics/detail`, `layouts/composer`, `layouts/detail`,
`layouts/index`, `library/blocks`, `patterns/add`, `patterns/detail`,
`patterns/index`, `quilts/add`, `quilts/detail`, `quilts/index`,
`shopping/index`, `tools/yardage`
**Travels:** `Destinations`, `Documents`, `Explore`, `GmailReview`,
`TripDetail`, `Wishlist`, `WorldMap`
**Hub:** `AppLauncher`, `control-panel`, `google-apis-demo`

### Enrollment rule

Every new shared mechanism in `lib/*` must be enrolled in this check in the
**same change** that creates it. A shared function or component without an
enrolled boundary is incomplete — the next agent or contributor will not know
it exists and may duplicate it. The check script header explains how to add
both named-file requirements and general scans.

### Failure reporting

Every violation message contains a `FIX:` clause that explains exactly what to
do. The check also prints a reference to this document. Do not work around a
failure by adding an exemption unless the file genuinely predates the rule; in
that case add it to the appropriate `LEGACY_EXEMPT` set with a comment and a
migration note.

The automated check is intentionally a boundary check, not a complete design
review. Passing it does not permit copy/paste architecture that the review
questions would reject.

### Section 3 — Heuristic duplicate-code detection

`scripts/src/check-duplicate-code.ts` is diff-scoped (only inspects files
touched in the current diff, the same pattern as
`check-hardcoded-config.ts`). For each function/component added or changed in
the diff, it strips identifiers/literals/comments to a structural fingerprint
and compares it against the same fingerprint computed for every function in
the rest of the repository. A near-exact structural match is reported as a
likely duplicate.

This complements Section 1/2 above: those sections protect boundaries that
were explicitly named when the check was written (Sentry init, OpenAI client
construction, Elaine context formatting). Section 3 has no fixed list — it can
flag a brand-new kind of duplication the day it's introduced, at the cost of
being an imprecise heuristic (structural similarity, not semantic
understanding). Treat a flagged match as a prompt to look, not as proof that
extraction is always the right call — genuinely independent code that happens
to be shaped similarly today is a valid reason to allowlist a match (see
`DUPLICATE_CODE_ALLOWLIST` in the script), not to force an artificial shared
abstraction.
