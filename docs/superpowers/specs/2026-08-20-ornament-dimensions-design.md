# Ornament AI Dimensions Enrichment — Design

## Goal

Every ornament workflow that analyzes photos and writes catalog data will populate
the existing `dimensions` field with the physical ornament's published
measurements whenever they can be established reliably. The field remains one
human-readable value, such as `3.5 in H × 2 in W × 1.25 in D`.

This explicitly excludes eBay price, sold-listing, and icon-specific behavior.

## Scope

The shared analysis behavior will cover:

- photo-based ornament creation, including camera-add and uploaded-photo flows;
- a single item's Refresh AI action;
- detail-page Refresh All, including the shared image-analysis portion;
- primary-photo replacement;
- collection bulk refresh;
- maintenance-page bulk refresh; and
- Elaine's bulk ornament refresh, which uses the same server-side batch helper.

Barcode-only photo scanning does not have an ornament item to update, so it
continues to return only a barcode. Non-AI barcode catalog enrichment remains
unchanged.

## Data and source rules

1. Keep the current `dimensions` string field; do not add height, width, depth,
   box-size, source, or confidence columns.
2. Store the ornament's physical dimensions, never the shipping-box dimensions.
3. Never estimate dimensions from an unscaled image.
4. Prefer a clearly stated physical-ornament measurement visible in the analysis
   photos, provided the text identifies the measurement as belonging to the
   ornament.
5. When the visual analysis cannot establish dimensions, look up a matching
   published measurement through citation-grounded web research.
6. Accept a published result only when the name plus available series/year
   identifies the same ornament and the cited text clearly describes the
   ornament's measurement. Ambiguous, box-only, or missing evidence returns
   `null` and does not overwrite data.
7. A manually locked `dimensions` field is never read, searched for, changed, or
   cleared by AI. A user-supplied dimension during creation also wins.

## Architecture

### Shared research foundation

Create a focused ornament research helper that owns:

- the common ornament identity shape: name, series/collection, and year;
- grounded web-search execution through the existing `webSearch()` adapter;
- safe citation handling and source-domain extraction; and
- ordinary failure handling that returns no result rather than failing an
  otherwise successful ornament analysis.

Refactor the existing retail-value lookup to use this foundation. The new
published-dimensions lookup will use it too, so the app has one implementation
of how ornament facts are researched rather than two near-identical OpenRouter
web-search flows.

### Dimension resolver

Add one resolver responsible for:

1. normalizing a confirmed visual ornament measurement;
2. falling back to a typed, citation-grounded AI extraction from published search
   results; and
3. returning `null` when the measurement cannot be supported.

The extraction prompt will require strict JSON and reject:

- box/package/shipping dimensions;
- generic size claims not tied to the identified ornament;
- measurements from a similarly named but different year/series; and
- visual guesses without a scale.

The resolver will be called by the existing shared photo-analysis function,
behind an explicit `resolveDimensions` option. This keeps every supported
photo-analysis entry point uniform. Creation enables it unless the user
submitted dimensions; reanalysis enables it only when the field is not locked.

### Analysis pipeline

Update the vision prompt so its `dimensions` value can only describe the
physical ornament and only when photos contain explicit, reliable evidence.
The shared analysis function then passes the vision value and confirmed
identity to the resolver. It returns the final dimensions value alongside the
existing name, series, year, color, motif, description, and barcode fields.

The existing `lockedFields` merge remains the authority for writes. No
route-specific dimension assignment will be added.

## UI and behavior

No new UI is required. Existing screens continue to show the same editable,
lockable Dimensions field.

When a refresh finds dimensions, normal cache invalidation makes the value
visible in detail and collection views. When it cannot find a trustworthy
measurement, the existing value remains unchanged; a blank value stays blank.

As a related DRY cleanup, migrate the maintenance-page bulk reanalysis flow to
the existing shared bulk-run/status lifecycle used by the collection page. This
keeps refresh status, completion handling, and duplicate-call protection
consistent without changing the maintenance page's purpose or visual design.

## Error handling and cost control

- Vision-derived dimensions avoid a research lookup.
- Research is skipped when the visual analysis cannot confidently identify an
  ornament, when the user supplied dimensions on creation, or when dimensions
  are locked during reanalysis.
- Lookup failures, no-result searches, malformed AI output, or conflicting
  source text return `null` and are logged as non-fatal; all other catalog
  fields still update.
- The eBay pipeline is neither called nor changed by this feature.

## Tests

Add focused unit tests for:

- visual ornament dimensions are accepted and formatted;
- a missing visual measurement invokes published research with the identified
  ornament and accepts only a matching physical-ornament result;
- box dimensions, ambiguous citations, malformed output, and research failures
  return `null`;
- user-provided and locked dimensions are preserved without research;
- photo creation and shared reanalysis receive the resolved field;
- single, bulk, maintenance, primary-image, and Elaine-triggered reanalysis
  continue to reach the same shared analysis function; and
- retail-value research retains its current behavior after using the extracted
  shared research helper.

Run the targeted API and Modules tests, typecheck, the composition guard, and
the duplicate-code guard.

## Non-goals

- Historical backfill of every existing ornament without an explicit AI refresh.
- New separate dimensional database fields or a dimensions-source UI.
- eBay changes.
- Unverified visual estimates.
