/**
 * Hub link coverage — AUTOMATIC extraction from source files.
 *
 * Reads apps.tsx, AppLauncher.tsx, and widgets.tsx as plain text, extracts
 * every href that uses the `${base}` template variable or is a hardcoded
 * absolute path, and asserts each target matches a known route table.
 *
 * Catches the two most common failure modes without requiring manual
 * maintenance of a separate link list:
 *   1. Missing /modules/ prefix  — e.g. `/pottery/` instead of `/modules/pottery/`
 *   2. Double /modules/ prefix   — e.g. `/modules/modules/pottery/`
 *
 * NEW LINKS are picked up automatically.
 *
 * HOW TO MAINTAIN
 * When you add a new *route* to artifacts/web/src/App.tsx or
 * artifacts/modules/src/App.tsx, add it to HUB_ROUTES or MODULES_ROUTES
 * below — the extractor will find any new link automatically, but it cannot
 * know whether a new route is intentional unless you register it here.
 *
 * ASSUMPTION
 * The extractor understands three href forms found in the source files:
 *   a) Object / array literal:  href: `${base}path/here`
 *   b) JSX attribute:           href={`${base}path/here`}
 *   c) Hardcoded variable:      const href = `/path/here`
 * If a future change writes hrefs as plain string concatenation
 * (e.g. href={base + "path"}) this test will not catch those.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Locate source files
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename);

// artifacts/web/src/components → ../../../../ → workspace root
const WORKSPACE_ROOT = resolve(__dirname_local, "../../../..");

const SOURCE_FILES = [
  "artifacts/web/src/config/apps.tsx",
  "artifacts/web/src/components/AppLauncher.tsx",
  "artifacts/web/src/components/widgets.tsx",
];

// ---------------------------------------------------------------------------
// href extraction
// ---------------------------------------------------------------------------

/**
 * Extract every href string from a source file.
 *
 * Returns raw captures; dynamic expressions like `${piece.id}` are preserved
 * and normalised separately in `normalizePath()`.
 */
function extractHrefsFromSource(source: string): string[] {
  const results: string[] = [];

  // a) Object / array literal form:  href: `${base}path/here`
  //    Handles both single-line and no-trailing-backtick-edge-cases.
  for (const m of source.matchAll(/href:\s*`\$\{base\}([^`]*)`/g)) {
    results.push("/" + m[1]);
  }

  // b) JSX attribute form:  href={`${base}path/here`}
  for (const m of source.matchAll(/href=\{`\$\{base\}([^`]*)`\}/g)) {
    results.push("/" + m[1]);
  }

  // c) Hardcoded absolute path assigned to a local `href` const:
  //      const href = `/modules/ornaments/hallmark-events?view=month`;
  for (const m of source.matchAll(/const\s+href\s*=\s*`(\/[^`]*)`/g)) {
    results.push(m[1]);
  }

  // d) JSX attribute with a hardcoded absolute path (no ${base}):
  //      href={`/some/absolute`}
  for (const m of source.matchAll(/href=\{`(\/[^`]*)`\}/g)) {
    results.push(m[1]);
  }

  // e) Ternary assigned to a local `href` const with two hardcoded template
  //    literal branches (e.g. a dynamic deep-link vs a plain fallback):
  //      const href =
  //        cond
  //          ? `/path/a?x=${y}`
  //          : `/path/b`;
  for (const m of source.matchAll(
    /const\s+href\s*=\s*[^;`]*\?\s*`(\/[^`]*)`\s*:\s*`(\/[^`]*)`/g,
  )) {
    results.push(m[1]);
    results.push(m[2]);
  }

  return results;
}

/**
 * Normalise a raw extracted path for route matching:
 *   • Strip query string (we check the path portion only)
 *   • Replace inline template expressions like `${piece.id}` with `:id`
 */
function normalizePath(raw: string): string {
  const noQuery = raw.split("?")[0];
  return noQuery.replace(/\$\{[^}]+\}/g, ":id");
}

// ---------------------------------------------------------------------------
// Known route tables
// ---------------------------------------------------------------------------

// Hub (artifacts/web, mounted at /)
const HUB_ROUTES: string[] = [
  "/",
  "/account",
  "/owner-panel",
  "/control-panel",
  "/google-apis-demo",
  "/recycle-bin",
  "/login",
  "/forgot-password",
  "/reset-password",
];

// Modules app (artifacts/modules, mounted at /modules/ by the proxy).
// Patterns use the full browser path including the /modules/ prefix because
// that is what hrefs in the hub must contain.
const MODULES_ROUTES: string[] = [
  // pottery
  "/modules/pottery/",
  "/modules/pottery/add",
  "/modules/pottery/compare",
  "/modules/pottery/scan",
  "/modules/pottery/stats",
  "/modules/pottery/piece/:id",
  "/modules/pottery/categories",
  "/modules/pottery/maintenance",
  "/modules/pottery/watchlist",
  // quilting
  "/modules/quilting/",
  "/modules/quilting/fabrics",
  "/modules/quilting/fabrics/add",
  "/modules/quilting/fabrics/bulk-add",
  "/modules/quilting/fabrics/:id",
  "/modules/quilting/patterns",
  "/modules/quilting/patterns/add",
  "/modules/quilting/patterns/:id",
  "/modules/quilting/quilts",
  "/modules/quilting/quilts/add",
  "/modules/quilting/quilts/:id",
  "/modules/quilting/compare",
  "/modules/quilting/blocks",
  "/modules/quilting/blocks/new",
  "/modules/quilting/blocks/:id/cut-pattern",
  "/modules/quilting/blocks/:id/edit",
  "/modules/quilting/blocks/:id",
  "/modules/quilting/library/blocks",
  "/modules/quilting/library/blocks/new",
  "/modules/quilting/library/blocks/:id/edit",
  "/modules/quilting/layouts",
  "/modules/quilting/layouts/new",
  "/modules/quilting/layouts/:id/edit",
  "/modules/quilting/layouts/:id",
  "/modules/quilting/whole-quilt",
  "/modules/quilting/whole-quilt/designer",
  "/modules/quilting/shopping",
  "/modules/quilting/tools/yardage",
  "/modules/quilting/categories",
  "/modules/quilting/maintenance",
  // travels
  "/modules/travels/",
  "/modules/travels/trips",
  "/modules/travels/trips/:id",
  "/modules/travels/map",
  "/modules/travels/explore",
  "/modules/travels/wishlist",
  "/modules/travels/destinations",
  "/modules/travels/travel-calendar",
  "/modules/travels/gmail",
  "/modules/travels/documents",
  // ornaments
  "/modules/ornaments/",
  "/modules/ornaments/add",
  "/modules/ornaments/camera-add",
  "/modules/ornaments/scan",
  "/modules/ornaments/stats",
  "/modules/ornaments/categories",
  "/modules/ornaments/maintenance",
  "/modules/ornaments/hallmark-events",
  "/modules/ornaments/ornament/:id",
  // magnets
  "/modules/magnets/",
  "/modules/magnets/item/:id",
  "/modules/magnets/add",
  "/modules/magnets/bulk-add",
  "/modules/magnets/categories",
  // office
  "/modules/office/",
  "/modules/office/gmail",
  "/modules/office/calendar",
  "/modules/office/notes",
  "/modules/office/messenger",
  // misc
  "/modules/barcode-lookup",
];

// Elaine app (artifacts/elaine, mounted at /elaine/)
const ELAINE_ROUTES: string[] = ["/elaine/"];

const ALL_ROUTES = [...HUB_ROUTES, ...MODULES_ROUTES, ...ELAINE_ROUTES];

// ---------------------------------------------------------------------------
// Route matching helpers
// ---------------------------------------------------------------------------

/** Convert a route pattern (with :seg wildcards) to a regex. */
function patternToRegex(pattern: string): RegExp {
  const withoutTrailingSlash = pattern.replace(/\/$/, "");
  const escaped = withoutTrailingSlash.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/:([^/]+)/g, "[^/]+");
  return new RegExp(`^${withWildcards}/?$`);
}

const ROUTE_REGEXES = ALL_ROUTES.map(patternToRegex);

/**
 * Check whether a raw href (may include query string, may have ${...}
 * dynamic segments) resolves to a known route.
 */
function isKnownRoute(rawHref: string): boolean {
  const normalised = normalizePath(rawHref);
  if (/\/modules\/modules\//.test(normalised)) return false; // double-prefix
  return ROUTE_REGEXES.some((re) => re.test(normalised));
}

// ---------------------------------------------------------------------------
// Build the list of all extracted hrefs at module load time so test output
// shows individual failures per href rather than one big assertion.
// ---------------------------------------------------------------------------

interface ExtractedHref {
  file: string;
  raw: string;
}

const EXTRACTED: ExtractedHref[] = SOURCE_FILES.flatMap((relPath) => {
  const abs = resolve(WORKSPACE_ROOT, relPath);
  const source = readFileSync(abs, "utf-8");
  const hrefs = extractHrefsFromSource(source);
  return hrefs.map((raw) => ({ file: relPath, raw }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hub hero cards and quick links — extracted hrefs must resolve to known routes", () => {
  // ── Sanity: confirm the extractor is actually finding links ──────────────
  // Per-file minimums reflect how many hrefs each file is expected to contain.
  // If a file drops below its floor the regex likely stopped matching (e.g. the
  // href format changed) and the test would otherwise silently pass on nothing.
  const MIN_HREFS: Record<string, number> = {
    "artifacts/web/src/config/apps.tsx": 5, // 6 APPS entries
    "artifacts/web/src/components/AppLauncher.tsx": 15, // quick-links + stat hrefs
    "artifacts/web/src/components/widgets.tsx": 15, // widget anchor hrefs
  };

  it("extracts the expected minimum number of hrefs from each source file", () => {
    for (const relPath of SOURCE_FILES) {
      const count = EXTRACTED.filter((e) => e.file === relPath).length;
      const min = MIN_HREFS[relPath] ?? 5;
      expect(
        count,
        `Expected ≥${min} hrefs extracted from ${relPath} but found ${count}. ` +
          "If the href format changed, update the extraction regexes in this test.",
      ).toBeGreaterThanOrEqual(min);
    }
  });

  // ── Main: every extracted href must match a known route ──────────────────
  it.each(
    // One test case per unique raw href (deduped; file attr is for display)
    [...new Map(EXTRACTED.map((e) => [e.raw, e])).values()].map(
      ({ raw, file }) => ({ raw, file }),
    ),
  )("$raw  [from: $file]", ({ raw }) => {
    expect(
      isKnownRoute(raw),
      `"${raw}" does not match any known route.\n` +
        `Common causes:\n` +
        `  • Missing /modules/ prefix (e.g. "/pottery/" instead of "/modules/pottery/")\n` +
        `  • Double prefix          (e.g. "/modules/modules/pottery/")\n` +
        `  • New route not yet listed in MODULES_ROUTES / HUB_ROUTES in this file\n`,
    ).toBe(true);
  });

  // ── Explicit regression: these paths must be rejected ────────────────────
  it("rejects a missing /modules/ prefix", () => {
    expect(isKnownRoute("/pottery/")).toBe(false);
    expect(isKnownRoute("/quilting/fabrics")).toBe(false);
    expect(isKnownRoute("/travels/trips")).toBe(false);
    expect(isKnownRoute("/ornaments/categories")).toBe(false);
  });

  it("rejects a double /modules/ prefix", () => {
    expect(isKnownRoute("/modules/modules/pottery/")).toBe(false);
    expect(isKnownRoute("/modules/modules/quilting/fabrics")).toBe(false);
  });

  it("accepts a valid path with a query string", () => {
    expect(isKnownRoute("/modules/ornaments/hallmark-events?view=month")).toBe(
      true,
    );
  });

  it("accepts dynamic-segment paths that match a :id pattern", () => {
    expect(isKnownRoute("/modules/pottery/piece/${piece.id}")).toBe(true);
    expect(isKnownRoute("/modules/quilting/blocks/456/edit")).toBe(true);
    expect(isKnownRoute("/modules/quilting/layouts/789")).toBe(true);
  });

  it("accepts /elaine/ as a root-level (non-modules) route", () => {
    expect(isKnownRoute("/elaine/")).toBe(true);
  });

  it("keeps the Magnets Hub card fully registered", () => {
    const appsSource = readFileSync(
      resolve(WORKSPACE_ROOT, "artifacts/web/src/config/apps.tsx"),
      "utf-8",
    );
    const launcherSource = readFileSync(
      resolve(WORKSPACE_ROOT, "artifacts/web/src/components/AppLauncher.tsx"),
      "utf-8",
    );
    const widgetSource = readFileSync(
      resolve(WORKSPACE_ROOT, "artifacts/web/src/hooks/use-widgets.ts"),
      "utf-8",
    );

    expect(appsSource).toContain('id: "magnets"');
    expect(appsSource).toContain(
      "image: `${base}images/magnets-collection.png`",
    );
    expect(launcherSource).toContain(
      '{ label: "Magnet", href: `${base}modules/magnets/add` }',
    );
    expect(launcherSource).toContain("const MAGNETS_QUICK_LINKS");
    expect(launcherSource).toContain("magnets: {");
    expect(launcherSource).toContain("magnetsData?.total");
    expect(launcherSource).toContain("magnetsCategoriesData");
    expect(widgetSource).toContain('  "magnets",');
  });
});
