---
name: Google Maps shared loader + custom marker icons
description: How to share the @googlemaps/js-api-loader singleton across multiple map components, and how to render custom SVG marker icons (stars, non-pin shapes) with AdvancedMarkerElement.
---

When a workspace has more than one Google Maps component (e.g. a single-trip location map and a multi-point world map), extract the `setOptions`/`importLibrary` loader singleton (API key, `maps` + `marker` library promises) into one shared module rather than duplicating the module-level `let optionsSet` / `let mapsLibraryPromise` state per component. Duplicating it is harmless functionally (each copy still dedupes its own calls) but wastes an extra script-load path and drifts if the API key handling logic changes later.

**Why:** Found while migrating a second Leaflet-based map (a world map plotting many trip/wishlist pins) to Google Maps, after an earlier single-destination map had already been migrated with its own inline loader. Consolidating avoided copy-pasted API key/version logic.

**How to apply:** Put `loadGoogleMaps()` in a shared `lib/google-maps-loader.ts` returning `Promise.all([importLibrary("maps"), importLibrary("marker")])`. `AdvancedMarkerElement`'s `content` option is not limited to `PinElement` — for custom shapes (stars, brand icons) build an SVG string and convert it to a DOM node via `new DOMParser().parseFromString(svg, "image/svg+xml").documentElement`, then pass that element as `content`. This avoids `PinElement`'s pin-only shape constraint and reuses any existing Leaflet-era `L.icon()` SVG strings almost verbatim (just drop the `L.icon()` wrapper).
