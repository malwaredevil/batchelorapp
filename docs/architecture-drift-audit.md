# Architecture Drift Audit

Companion audit for [Issue #130](https://github.com/malwaredevil/batchelorapp/issues/130), part of the
Batchelor architecture consolidation EPIC ([#158](https://github.com/malwaredevil/batchelorapp/issues/158)).

This document catalogs every structural drift/inconsistency point found across
`artifacts/pottery`, `artifacts/quilting`, `artifacts/travels`, `artifacts/ornaments`,
`artifacts/elaine`, and `artifacts/web`, **before** the modules merge / Office module /
unified settings work begins. It supersedes the "known so far" list quoted in issue #130 —
the findings below are the actual, verified result of the scan.

## 1. Raw `fetch()` calls bypassing generated hooks

Confirmed and corrected the original 3-item list. The actual count is **9** call sites,
not 3:

| File                                                              | Line       | Endpoint                                                                      | Covered by              |
| ----------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- | ----------------------- |
| `artifacts/pottery/src/hooks/use-pottery.ts`                      | 36, 63, 86 | `/api/pottery/items`, `/api/pottery/compare`, `/api/pottery/items/:id/images` | Issue #131 (B1)         |
| `artifacts/travels/src/pages/Trips.tsx`                           | 387        | `/api/travels/trips/plan`                                                     | Issue #132 (B2)         |
| `artifacts/travels/src/components/OneThingInput.tsx`              | 75         | `/api/travels/highlights/suggest`                                             | Issue #133 (B3)         |
| `artifacts/pottery/src/pages/add.tsx`                             | 162        | `/api/pottery/items/:id/images` (FormData image upload)                       | **New — filed as #159** |
| `artifacts/ornaments/src/pages/detail.tsx`                        | 69         | `/api/ornaments/items/:id/images` (FormData image upload)                     | **New — filed as #159** |
| `artifacts/elaine/src/pages/Chat.tsx`                             | 194        | `/api/elaine/conversations/:id/messages`                                      | **New — filed as #159** |
| `artifacts/travels/src/pages/TripDetail.tsx`                      | 3048       | `/api/travels/trips/:id/documents` (FormData document upload)                 | **New — filed as #159** |
| `artifacts/travels/src/components/trip-detail/PackingSection.tsx` | 346        | `/api/travels/trips/:id/packing/generate`                                     | **New — filed as #159** |

Not counted as drift (reviewed and excluded deliberately):

- `artifacts/web/src/components/AppLauncher.tsx:687` — `fetch(\`${base}api/auth/logout\`)`. Trivial fire-and-forget logout call; low value to route through a generated hook, left as-is unless a future logout-flow change touches this file anyway.
- `artifacts/web/src/components/widgets.tsx:852` — fetches an external RSS feed URL through the hub's own RSS proxy endpoint, not a generated-hook-covered internal API contract in the OpenAPI sense (there's no fixed request/response schema to codegen against). Not drift.
- `artifacts/api-server/src/lib/*.ts` fetch() calls — these are legitimate server-side outbound calls to third-party APIs (Gmail, Calendar, Wallet, OpenRouter, barcode lookup), not internal `/api/*` calls. Out of scope for this check by definition.

**Action:** the ESLint rule in issue #134 (B4) should be scoped to also catch these newly found 5 files once #159 lands, not just B1–B3's files — added as a note there.

## 2. Duplicated Tailwind theme tokens

Confirmed: `@theme inline` blocks exist independently in all 6 modules
(`pottery`, `quilting`, `travels`, `ornaments`, `elaine`, `web`). Already scoped by issue #135 (B5)
— no additional modules found beyond what B5 already covers.

## 3. Settings-adjacent pages

Confirmed inventory, matches issue #148 (E1)'s starting assumption:

- `pottery`: `settings.tsx`, `maintenance.tsx`, `categories.tsx`
- `ornaments`: `settings.tsx`, `maintenance.tsx`, `categories.tsx`
- `quilting`: `maintenance.tsx`, `categories.tsx` (**no** dedicated `settings.tsx` — confirmed gap, already flagged in E1)
- `travels`: `Settings.tsx`
- `elaine`: `Settings.tsx`
- `web`: `account.tsx`

No new settings-adjacent pages found beyond what E1 already scopes to audit in detail.

## 4. Favicon / PWA icon consistency

All 6 artifacts (`pottery`, `ornaments`, `elaine`, `web`, `travels`, `quilting`) reference the
same pattern: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`. **No drift found** —
this axis is already consistent, contrary to the possibility flagged in #130. No follow-up needed.

## 5. Nav/layout shell component naming

Each module has its own shell/layout component: `pottery/components/app-shell.tsx`,
`quilting/components/app-shell.tsx`, `ornaments/components/app-shell.tsx`,
`travels/components/Layout.tsx`, `elaine/components/Header.tsx`. Naming is inconsistent
(`app-shell.tsx` vs `Layout.tsx` vs `Header.tsx`) but this is expected pre-merge — each
module is still a separate artifact today. This will naturally resolve during the modules
merge (issue #136, C1) when all four converge on the single `ModuleShell` component — **no
separate issue needed**, tracked as a natural byproduct of C1 instead.

## 6. AppSwitcher / Hub launcher entries

Not independently re-verified beyond what's already covered by issue #141 (C7), which
explicitly re-points every AppSwitcher/launcher entry during the migration. No standalone
finding here.

## Summary of new issues filed as a direct result of this audit

- **#159** — Fix additional raw fetch() drift found during A1 audit (5 files: pottery/add.tsx,
  ornaments/detail.tsx, elaine/Chat.tsx, travels/TripDetail.tsx, travels/PackingSection.tsx)

## Conclusion

The original "known so far" list in issue #130 undercounted the raw-fetch() drift (3 vs. the
real 9) but was otherwise accurate on theme tokens and settings-page structure. Favicon/PWA
consistency and nav-shell naming were checked as additional candidate drift axes and found to
be either already consistent or self-resolving as a byproduct of the planned merge — no further
issues needed for those two axes.
