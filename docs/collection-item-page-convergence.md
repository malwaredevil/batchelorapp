# Collection item-page convergence audit

Goal: a collection item's add / detail / gallery / categories UI looks and behaves
the same regardless of collection (Pottery, Quilting, Ornaments, future types), so a
new collection is mostly configuration, not a UI rebuild.

Pottery is the **gold standard** and is deliberately left unmodified — the shared
lib (`@workspace/collection-ui`) was extracted _from_ pottery's patterns
(see `.agents/memory/collection-ui-coverage.md`).

> **Pottery drift warning:** pottery's detail page keeps its own local
> field/section markup and is **not** wired to the shared components. No
> automated check compares them, so any deliberate visual change to
> `CollectionDetailField`/`CollectionDetailSection` (or a pottery tweak)
> must be checked against the Pottery detail page by eye.

## Shared building blocks

| Concern                                                     | Shared component                                                               | Package                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| Page shell (back / hero / panels / sections)                | `CollectionDetailLayout`, `CollectionDetailHero`, `CollectionDetailPanelStack` | `@workspace/collection-ui` |
| Loading / error                                             | `CollectionDetailSkeleton`, `CollectionErrorState`                             | `@workspace/collection-ui` |
| Field rows (view/edit toggle + per-field lock)              | `CollectionDetailField`                                                        | `@workspace/collection-ui` |
| Card panels                                                 | `CollectionDetailSection`                                                      | `@workspace/collection-ui` |
| Categories                                                  | `CategoryTagSelector`, `CategoryChipPicker`                                    | `@workspace/collection-ui` |
| Quick edit                                                  | `QuickEditSheetFrame`                                                          | `@workspace/collection-ui` |
| Reminders                                                   | `ReminderBellButton` / `reminder` prop                                         | `@workspace/collection-ui` |
| Photo gallery (add / relabel / set-primary / delete / zoom) | `ItemImageGallery`                                                             | `@workspace/image-capture` |

## Audit result (2026-08-16)

- **Ornaments detail** — already converged: `CollectionDetailLayout` + `Skeleton` +
  `Field` + `Section`, `ItemImageGallery`, shared tag selector.
- **Quilting fabrics detail** — was the largest diverger; now migrated:
  - Bespoke main-image + thumbnail-strip gallery (~200 lines, crown = set-default,
    `confirm()` deletes, blob-fetch crop flow) → `ItemImageGallery`. This also
    _added_ photo-label editing, which fabrics previously lacked despite the API
    supporting it (`PATCH /fabrics/:id/images/:imageId`).
  - Hand-written label/value rows in Inventory / Fabric details / Characteristics →
    `CollectionDetailField` (with built-in per-field lock, replacing the local
    `LockButton` in those rows).
  - Bespoke loading skeleton → `CollectionDetailSkeleton`; bespoke error block →
    `CollectionErrorState`.
  - Kept per-collection features: rename-in-title, AI Enhance (crease remover),
    `FabricPairings`, `FabricIdentityResearchPanel`, colours/motifs hero chips
    (which still use the local `LockButton` since they aren't field rows).
- **Add pages** (pottery / ornaments / fabrics) — intentionally per-collection:
  field sets differ by domain, but all share the tag selector and upload flow.
  Not a convergence target.
- **Quilting patterns / quilts detail** — converged in the follow-up pass
  (2026-08-16): bespoke field rows → `CollectionDetailField`/`Section`; bespoke
  skeleton/error → `CollectionDetailSkeleton`/`CollectionErrorState`; single
  legacy `imageUrl` display → `ItemImageGallery` backed by the existing
  `quiltingImages` routes, plus new `POST /patterns|quilts/:id/images/:imageId/set-default`
  promote-to-primary routes mirroring fabrics. Kept per-collection features:
  enrich-designer, extract-blocks, `PatternAnalysisPanel`, WIP progress slider,
  linked fabrics, `ShareModal`.

## Enforcement

`scripts/src/check-domain-composition.ts` now requires:

- `ItemImageGallery` in ornaments, fabrics, patterns, and quilts detail pages.
- `CollectionDetailField` + `CollectionDetailSection` in ornaments, fabrics,
  patterns, and quilts detail pages.
- `CategoryTagSelector` in pottery, quilting, **and ornaments** tag selectors.
- (pre-existing) `CollectionDetailHero`/`PanelStack` in all quilting + pottery detail
  pages; `QuickEditSheetFrame`/`CategoryChipPicker` in all quick-edit sheets.

## Adding a new collection type

1. Build the gallery page from `CollectionCard`/`Grid`/`SearchBar`/`StatBar`.
2. Build the detail page from `CollectionDetailLayout` (or `Hero`+`PanelStack`),
   `CollectionDetailField`/`Section`, `ItemImageGallery`, `CategoryTagSelector`,
   and the `reminder` prop.
3. Customize via typed props/config (field list, category colors, AI affordances) —
   never by forking a shared component.
4. Enroll the new files in `scripts/src/check-domain-composition.ts` in the same PR.
