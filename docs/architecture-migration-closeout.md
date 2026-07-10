# Architecture Migration Closeout — Final Drift Re-Scan (G1 / #156)

Date: 2026-07-10
Baseline: `docs/architecture-drift-audit.md` (A1, issue #130)
Scope: re-run A1's check categories against the final post-migration codebase
(4 registered artifacts: `api-server`, `modules`, `web`, `elaine`; standalone
`pottery`/`quilting`/`travels`/`ornaments` artifacts fully decommissioned).

## 1. Raw `fetch()` drift (bypassing generated API hooks)

Re-scanned all frontend artifacts (`artifacts/modules/src`, `artifacts/web/src`,
`artifacts/elaine/src`) for hand-rolled `fetch()` calls to internal `/api/*`
endpoints.

**Legitimate / excluded (not drift)** — consistent with A1's original exclusion
reasoning:
- Image/blob downloads with no JSON contract to codegen against:
  `pottery/lib/pdf-export.ts`, `ornaments/lib/pdf-export.ts`,
  `quilting/lib/svg-export.ts` (`downloadCollectionImage`).
- External third-party APIs, not internal: `travels/pages/WorldMap.tsx`
  (Nominatim geocoding), `web/components/studio-weather.tsx` (Open-Meteo
  forecast/geocoding — the two calls to `api.open-meteo.com` /
  `geocoding-api.open-meteo.com`).
- `web/components/AppLauncher.tsx` logout call and `web/components/widgets.tsx`
  RSS proxy call — previously excluded in A1, still excluded (same reasoning).
- `travels/pages/TripShare.tsx` → `GET /api/travels/trips/:id/share?token=...`
  — this is the intentionally public, unauthenticated bearer-token route
  (see `threat_model.md`'s "Public share-token boundary"). It has no OpenAPI
  entry by design (only the owner-side generate/revoke mutations are
  documented), so there's no generated hook to use here. Not drift.

**New drift found (not caught by A1) — fixed in this pass:**
- `artifacts/modules/src/quilting/components/PaletteMatchModal.tsx` was
  hand-rolling `fetch()` + `FormData` against
  `/api/quilting/tools/palette-match{,-patterns,-quilts}` even though fully
  generated hooks (`usePaletteMatchFabrics`, `usePaletteMatchPatterns`,
  `usePaletteMatchQuilts`) already existed in `@workspace/api-client-react`
  from the OpenAPI spec. Rewired the component to use the generated mutation
  hooks instead of raw `fetch`. Verified with `pnpm --filter @workspace/modules
  run typecheck` (passes) and via the running dev workflow (HMR picked up the
  change cleanly, no runtime errors in server/browser logs).

**New drift found — NOT fixed here, filed as a follow-up issue:**
- `artifacts/web/src/components/studio-weather.tsx` (`GET`/`PUT
  /api/hub/weather-config`) and `artifacts/web/src/hooks/use-widgets.ts`
  (`GET`/`PUT /api/hub/preferences`) hand-roll `fetch()` against real internal
  JSON endpoints that have **no OpenAPI spec file at all** — there is no
  `lib/api-spec/sources/hub.yaml`, unlike pottery/quilting/travels/ornaments/
  office. Fixing this properly requires authoring a hub OpenAPI spec and
  running codegen, which is a bigger lift than a component-level swap, so it's
  filed as its own issue rather than fixed inline during this audit pass.

## 2. Theme token duplication (B5)

No duplication found. `artifacts/modules` imports the shared
`lib/elaine-ui/src/theme.css` directly; `artifacts/web` and `artifacts/elaine`
each declare only their own `@theme inline` block with artifact-specific
tokens (chart colors in `web`, base semantic tokens in `elaine`) — no
copy-pasted overlapping token sets between artifacts.

## 3. Settings pages inventory (E1)

Consistent with the unified-settings work: a single `artifacts/web/src/pages/
account.tsx` covers account settings; no leftover per-module settings pages
were found outside that. `travels/pages/GmailReview.tsx` is a feature page
(Gmail scan review), not a settings duplicate.

## 4. Hardcoded nav arrays / feature registry conformance (C1/C7)

All nav construction goes through `@/features/registry`
(`getNavItemsByGroup`) in both `artifacts/modules/src/components/module-shell.tsx`
and `artifacts/elaine/src/components/Header.tsx`. No hardcoded nav-item arrays
were found outside the per-feature `features.ts` registry files. AppSwitcher/
launcher entries in `artifacts/web/src/components/AppLauncher.tsx` correctly
reference the current base paths for pottery/quilting/travels/ornaments/elaine
plus the newer `modules/office` prefix — no stale references to decommissioned
standalone artifact paths.

## 5. Orphaned code / stale references from decommissioned artifacts

No orphaned `artifacts/pottery`, `artifacts/quilting`, `artifacts/travels`, or
`artifacts/ornaments` directories remain. A grep for path-string references to
those decommissioned artifact directories only turned up historical code
comments documenting migration lineage (e.g. "Mirrors
artifacts/pottery/src/features/index.ts") — none are live imports, so no
action needed.

## 6. Favicon / PWA consistency

All three frontend artifacts (`modules`, `web`, `elaine`) reference the same
`/favicon.svg` — consistent, no drift (matches A1's original finding of no
drift in this category).

## Outstanding / follow-up

- New issue filed for the hub `/api/hub/weather-config` + `/api/hub/preferences`
  raw-fetch drift (no OpenAPI coverage yet) — see GitHub issue link in the
  EPIC #158 thread.
- Per the EPIC's sequencing, #155 (pre-publish checklist) is blocked pending a
  GitHub push + CI/CodeQL confirmation, which is paused for this session by
  explicit user instruction. #157 (Resend prod webhook cutover) is in turn
  blocked on #155. The audit substance of #156 (this document) is complete,
  but formal closure of #156/#157 should wait for the push-and-CI gate along
  with #155.
