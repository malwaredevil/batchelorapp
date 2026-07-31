# Composition and Configuration Architecture

Batchelor App is one application with several domains and three SPA bundles.
Shared behavior must therefore be implemented once and consumed through typed
composition points. A domain should normally configure a shared capability; it
should not copy and rename the capability.

This is the highest-priority design rule for new and changed code after the
repository's safety, data-integrity, and security boundaries in `AGENTS.md`.

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

The automated check is intentionally a boundary check, not a complete design
review. Passing it does not permit copy/paste architecture that the review
questions would reject.
