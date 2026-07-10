# Unified Profile & Settings — Scope Audit

Prepared for #148 (child of Epic #158). Documentation-only deliverable: no code
changes. This audits every settings-like surface across the five modules
(Pottery, Quilting, Ornaments, Travels, Office/Hub/Elaine) and account-level
settings, and proposes a target location for each.

## Legend

- **Global** — belongs on the single unified Profile & Settings page, shown
  once regardless of which module the user is in.
- **Per-module section** — belongs on the unified page, but scoped to a
  named module section/tab (e.g. "Travels", "Quilting").
- **Stays in module (data mgmt)** — not a setting; it's day-to-day data
  management (CRUD screens, bulk tools) that happens to currently live under
  a "Settings" nav link. Should stay where it is, just re-labeled/re-grouped
  in nav so it's not confused with real settings.

## 1. Global / account-level settings (`artifacts/web/src/pages/account.tsx`)

| Setting                                                                     | Current location                                                                                  | Target                                                                                         | Backing endpoint                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Display name                                                                | account.tsx `ProfileCard`                                                                         | Global                                                                                         | `PATCH /api/auth/me`                                               |
| Test email send                                                             | account.tsx `ProfileCard`                                                                         | Global                                                                                         | `POST /api/auth/test-email` (verify exact path in route file)      |
| Phone number + verification                                                 | account.tsx `PhoneCard`                                                                           | Global                                                                                         | `/api/auth/phone/*`                                                |
| Test SMS send                                                               | account.tsx `PhoneCard`                                                                           | Global                                                                                         | `/api/auth/phone/test-sms` (verify)                                |
| Theme (light/dark/system)                                                   | account.tsx `AppearanceCard`; duplicated in `artifacts/elaine/src/pages/Settings.tsx`             | Global (single copy; Elaine's local copy becomes a link, not a duplicate)                      | client-only (localStorage/theme provider), no API                  |
| Password change                                                             | account.tsx `PasswordCard`                                                                        | Global                                                                                         | `/api/auth/change-password`                                        |
| Elaine personal preferences (name Elaine calls you, tone, etc.)             | `ElaineSettingsCard` (from `lib/elaine-ui`, embedded in both account.tsx and elaine/Settings.tsx) | Global (single copy embedded once; Elaine's Settings page links to it instead of re-embedding) | Elaine settings endpoints in `elaine-ui` lib (verify exact path)   |
| Elaine global AI config (chatModel/subagentModel/timeouts) — **owner-only** | `GlobalConfigCard` (from `lib/elaine-ui`, embedded in account.tsx only)                           | Global, gated by `isOwner` (already gated)                                                     | `GET/PUT /api/elaine/admin/config`, `GET /api/elaine/admin/models` |

**Notes:**

- Elaine's own Settings page (`artifacts/elaine/src/pages/Settings.tsx`) already
  duplicates `AppearanceCard` and `ElaineSettingsCard`, and links out to the
  hub's `/account` for the owner-only Global Config. This is the pattern to
  generalize: once there's one unified page, every module's local settings
  page becomes a thin "Open Settings" link (or is removed and replaced by a
  cross-app nav entry), not a duplicate implementation.

## 2. Travels (`artifacts/modules/src/travels/pages/Settings.tsx`)

| Setting                                                                       | Target                      | Backing endpoint                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reminder email address + test-send                                            | Per-module section: Travels | `travels` reminder-email routes (verify exact path)                                                                                                                              |
| Timezone                                                                      | Per-module section: Travels | `travels` settings route (verify exact path)                                                                                                                                     |
| Gmail connect/disconnect/status (`GmailSyncCard`)                             | Per-module section: Travels | `/api/travels/gmail/*` — **single-owner**, must stay scoped to `req.session.userId`, never household-shared (see threat model)                                                   |
| Google Calendar: connect/list/add calendars                                   | Per-module section: Travels | `/api/travels/calendar/*` (Calendar OAuth connect must remain a full browser redirect — cannot be automated/assistant-triggered, see `travels-calendar-oauth-constraint` memory) |
| Per-calendar color assignment                                                 | Per-module section: Travels | calendar color-update route (verify)                                                                                                                                             |
| Designate shared "Travel calendar" (owner-only action, household-wide effect) | Per-module section: Travels | `useSetTravelCalendar` → `PUT`-style route (matches the reusable "designated shared calendar" pattern also used by Ornaments/Hallmark)                                           |
| Delete a connected calendar                                                   | Per-module section: Travels | calendar delete route (verify)                                                                                                                                                   |

**Notes:** Gmail tokens/connections and Calendar OAuth tokens are
single-owner per the threat model even though the resulting data (synced
trip suggestions, the designated shared Travel calendar) is household-shared.
The unified page must preserve that boundary — i.e., a Travels settings
section shows each user their _own_ Gmail/Calendar connection status, never
another household member's.

## 3. Pottery (`artifacts/modules/src/pottery/pages/settings.tsx`)

| Item                                  | Current location | Target                                                               | Rationale                                                                  |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Link to Categories                    | settings.tsx     | Stays in module (data mgmt)                                          | category CRUD, not a setting                                               |
| Link to Collection Stats              | settings.tsx     | Stays in module (data mgmt)                                          | read-only stats/reporting, not a setting                                   |
| Link to Maintenance (bulk re-analyze) | settings.tsx     | Stays in module (data mgmt)                                          | bulk AI operation, not a setting                                           |
| Link to Account                       | settings.tsx     | Removed — replaced by direct nav to the unified Global settings page | avoids a redundant hop through a module page just to reach global settings |
| Insurance PDF export button           | settings.tsx     | Stays in module (data mgmt / export action)                          | one-off export action, not a persisted setting                             |

**Pottery has no real per-module settings today** — its "Settings" page is
actually a landing/index page linking out to data-management tools plus the
global Account page. Once the unified page exists, Pottery's nav "Settings"
entry can point straight there; the data-management links (Categories,
Stats, Maintenance) should move to a "main" nav group rather than "settings"
group (mirrors the Quilting nav-grouping issue below).

## 4. Ornaments (`artifacts/modules/src/ornaments/pages/settings.tsx`)

Same shape as Pottery, plus one extra link:

| Item                     | Target                                                      | Rationale                                      |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------- |
| Link to Categories       | Stays in module (data mgmt)                                 | same as Pottery                                |
| Link to Collection Stats | Stays in module (data mgmt)                                 | same as Pottery                                |
| Link to Maintenance      | Stays in module (data mgmt)                                 | same as Pottery                                |
| Link to Hallmark Events  | Stays in module (data mgmt)                                 | ornaments-specific data feature, not a setting |
| Link to Account          | Removed — replaced by direct nav to unified Global settings | same as Pottery                                |

## 5. Quilting — no dedicated settings page today

Quilting has no `settings.tsx`. Instead, `Categories` and `Maintenance`
pages are nav-grouped under `group: "settings"` in
`artifacts/modules/src/quilting/features.ts` (confirmed by direct read).
This is the exact ambiguity the issue's acceptance criteria calls out:

- **Resolution:** Both `quilting-categories` and `quilting-maintenance` are
  data-management screens (category CRUD/merge/color-assignment;
  bulk AI re-analysis of fabrics/patterns/quilts), functionally identical in
  kind to Pottery's and Ornaments' Categories/Maintenance pages. They contain
  **no persisted user preference or configuration toggle** — every control on
  both pages mutates collection data (categories, embeddings), not settings
  state.
- **Target:** Both stay exactly where they are (`/quilting/categories`,
  `/quilting/maintenance`), but should be re-grouped from nav `group:
"settings"` to `group: "main"` (or an equivalent non-settings nav group) so
  the nav no longer implies they're part of "Settings" once a real, unified
  Settings page exists elsewhere. This is a nav-grouping fix, not a
  data-model or route change.
- Quilting should gain a nav entry pointing to the new unified Global
  settings page, consistent with the other modules (once it exists).

## 6. Cross-cutting nav-grouping fix (applies to Pottery, Ornaments, Quilting)

All three modules currently label their "Settings" nav group with a mix of:
(a) genuinely global settings that duplicate the Hub's Account page (Account
link), and (b) module-local data-management tools (Categories, Maintenance,
Stats, Hallmark Events) that are not settings at all. Once the unified page
ships, the fix is:

1. Remove each module's local "Account" link from its settings-group nav —
   users reach global settings via one consistent cross-app nav entry
   (mirrors `elaine-cross-app-navigation` pattern already used for Elaine).
2. Re-group Categories/Maintenance/Stats/Hallmark-Events nav entries out of
   the `"settings"` nav group into `"main"` (or a new `"tools"` group if the
   registry supports it), so "Settings" in nav only ever means real settings.
3. Elaine's own local Settings page (`AppearanceCard` + `ElaineSettingsCard`
   duplicated locally) collapses to a link into the unified page, following
   the pattern it already partially uses for Global Config.

## Summary table

| Module                   | Real settings found                                                                 | Data-mgmt mislabeled as "settings"                       | Action needed                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Global (Hub/account.tsx) | Profile, phone, theme, password, Elaine prefs, Elaine global config (owner)         | —                                                        | Becomes the unified page's content                                                                                  |
| Travels                  | Reminder email, timezone, Gmail connection, Calendar connections/colors/designation | —                                                        | Becomes a per-module section on the unified page; single-owner boundaries (Gmail/Calendar tokens) must be preserved |
| Pottery                  | None (only a link to global Account)                                                | Categories, Stats, Maintenance, Insurance export         | Nav re-group only; no new settings section needed                                                                   |
| Ornaments                | None (only a link to global Account)                                                | Categories, Stats, Maintenance, Hallmark Events          | Nav re-group only; no new settings section needed                                                                   |
| Quilting                 | None                                                                                | Categories, Maintenance (both nav-grouped as "settings") | Nav re-group only; no new settings section needed                                                                   |
| Elaine                   | Duplicates of global Appearance + ElaineSettingsCard                                | —                                                        | Collapse to a link into the unified page                                                                            |

## Out of scope for this audit

- Actual implementation of the unified page (separate child issue).
- Any change to API endpoints — this document only maps existing endpoints
  to a target UI location, per the acceptance criteria of #148.
