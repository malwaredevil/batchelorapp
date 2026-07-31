/**
 * Composition-and-configuration architecture guard.
 *
 * Two complementary sections:
 *
 * 1. Named-file requirements — every listed file must contain (or must NOT
 *    contain) a specific string token.  These protect boundaries that were
 *    actively established and must not regress.
 *
 * 2. General pattern scans — walk source directories and flag any file that
 *    violates a shared-mechanism policy, regardless of whether that file was
 *    named when the check was written.  This catches NEW duplication before it
 *    ships, not only regressions in files we already know about.
 *
 * Adding a new shared mechanism in lib/*:
 *   Add a named-file requirement OR a general scan (or both) in the SAME
 *   change that creates the mechanism.  Do not merge the new lib code without
 *   enrolling it here — that is what "Write once, use everywhere" means in
 *   practice.
 *
 * Fixing a violation:
 *   Each violation message contains a FIX: clause that explains exactly what
 *   to do.  Do not work around the check by adding an exemption unless the
 *   file genuinely predates the rule (in which case add it to the appropriate
 *   LEGACY_EXEMPT set with a comment).
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-domain-composition
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

/** Recursively collect files with the given extensions, skipping build dirs. */
function walkFiles(dir: string, extensions: string[]): string[] {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".turbo", ".cache"]);
  const results: string[] = [];

  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry)) continue;
      const full = join(current, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (extensions.includes(extname(entry))) {
        results.push(relative(root, full));
      }
    }
  }

  walk(resolve(root, dir));
  return results;
}

const violations: string[] = [];

// ────────────────────────────────────────────────────────────────────────────
// Section 1 — Named-file requirements
//
// Each entry checks that a specific file contains (includes[]) or does NOT
// contain (excludes[]) a string token.  These protect established boundaries.
// When you establish a new boundary, add it here in the same change.
// ────────────────────────────────────────────────────────────────────────────

const requirements: Array<{
  path: string;
  includes: string[];
  excludes?: string[];
  fix?: string;
}> = [
  // ── Feature registry: all SPAs must use the shared createFeatureRegistry ──
  {
    path: "artifacts/modules/src/features/registry.ts",
    includes: ["createFeatureRegistry"],
    fix: "Import createFeatureRegistry from @workspace/web-core/feature-registry and use it to build the nav registry. Do not inline a hand-written registry object.",
  },
  {
    path: "artifacts/elaine/src/features/registry.ts",
    includes: ["createFeatureRegistry"],
    fix: "Import createFeatureRegistry from @workspace/web-core/feature-registry and use it to build the nav registry. Do not inline a hand-written registry object.",
  },

  // ── Collection detail pages: must use shared layout primitives ────────────
  ...[
    "artifacts/modules/src/pottery/pages/detail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
    "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
    "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
  ].map((path) => ({
    path,
    includes: ["CollectionDetailHero", "CollectionDetailPanelStack"],
    fix: "Use CollectionDetailHero and CollectionDetailPanelStack from @workspace/collection-ui. Domain pages supply fields, actions, and categories — not their own layout shell.",
  })),

  // ── Quick-edit sheets: must use shared frame and category picker ──────────
  ...[
    "artifacts/modules/src/pottery/components/quick-edit-sheet.tsx",
    "artifacts/modules/src/ornaments/components/quick-edit-ornament-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-fabric-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-pattern-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-quilt-sheet.tsx",
  ].map((path) => ({
    path,
    includes: ["QuickEditSheetFrame", "CategoryChipPicker"],
    fix: "Use QuickEditSheetFrame and CategoryChipPicker from @workspace/collection-ui. Do not reimplement the sheet chrome or the chip-selection UI.",
  })),

  // ── Tag selectors: must use the shared CategoryTagSelector ────────────────
  ...[
    "artifacts/modules/src/pottery/components/tag-selector.tsx",
    "artifacts/modules/src/quilting/components/tag-selector.tsx",
  ].map((path) => ({
    path,
    includes: ["CategoryTagSelector"],
    fix: "Use CategoryTagSelector from @workspace/collection-ui. Do not maintain a domain-local tag selector.",
  })),

  // ── Route handlers: must use shared category + string-array utilities ─────
  ...[
    "artifacts/api-server/src/routes/quilting/fabrics.ts",
    "artifacts/api-server/src/routes/quilting/patterns.ts",
    "artifacts/api-server/src/routes/quilting/quilts.ts",
  ].map((path) => ({
    path,
    includes: ["parseStringArray", "resolveOrCreateQuiltingCategories"],
    excludes: ["function parseStringArray", "function resolveOrCreateCategories"],
    fix: "Import parseStringArray and resolveOrCreateQuiltingCategories from the shared server lib. Route handlers must not reimplement string-array parsing or category resolution.",
  })),

  // ── AI analysis: all collection routes must use the shared evidence runner ─
  ...[
    "artifacts/api-server/src/routes/pottery/pottery.ts",
    "artifacts/api-server/src/routes/ornaments/ornaments.ts",
    "artifacts/api-server/src/routes/quilting/fabrics.ts",
  ].map((path) => ({
    path,
    includes: ["runAnalysisWithEvidence"],
    fix: "Call runAnalysisWithEvidence from the shared AI analysis lib. Route handlers must not inline their own AI analysis pipeline.",
  })),

  // ── Layout Composer: collapsed panel structure must be preserved ──────────
  {
    path: "artifacts/modules/src/quilting/pages/layouts/composer.tsx",
    includes: [
      'aria-controls="layout-block-palette"',
      'aria-controls="layout-library-templates"',
      "lg:sticky",
    ],
    fix: "The Layout Composer collapsed-panel structure (aria-controls attributes and lg:sticky) must not be removed. These control accessible keyboard navigation and the sticky side-panel layout.",
  },

  // ── Repository hygiene: Replit platform files must be gitignored ─────────
  {
    path: ".gitignore",
    includes: [".replit", "**/.replit-artifact/"],
    fix: "Add .replit and **/.replit-artifact/ to .gitignore. These are Replit-internal files that must never appear in the public GitHub repository.",
  },

  // ── Architecture documentation must be referenced in both agent guides ────
  {
    path: "AGENTS.md",
    includes: [
      "Composition and Configuration Is the Default Architecture",
      "docs/composition-and-configuration.md",
    ],
    fix: "AGENTS.md must contain §4.10 'Composition and Configuration Is the Default Architecture' with a reference to docs/composition-and-configuration.md. This section is the primary instruction for GitHub Copilot and Codex.",
  },
  {
    path: "replit.md",
    includes: [
      "Composition and configuration is the highest-priority design rule",
      "check-domain-composition",
    ],
    fix: "replit.md must state the composition rule as the highest-priority design rule and reference check-domain-composition. Replit Agent reads this file at the start of every session.",
  },
  {
    path: "docs/composition-and-configuration.md",
    includes: ["Required decision order", "Review questions"],
    fix: "docs/composition-and-configuration.md must contain 'Required decision order' and 'Review questions' sections. Do not delete these sections.",
  },

  // ── Pre-publish gate must run the composition check ──────────────────────
  {
    path: "scripts/src/pre-publish.sh",
    includes: ["run_bg composition", "check-domain-composition"],
    fix: "pre-publish.sh must include 'run_bg composition pnpm --filter @workspace/scripts run check-domain-composition'. This gate prevents composition drift from being published.",
  },

  // ── Elaine context formatters must remain in the shared lib ──────────────
  {
    path: "lib/elaine-ui/src/page-context-formatters.ts",
    includes: ["formatElaineContextList", "formatElaineContextEntity"],
    fix: "lib/elaine-ui/src/page-context-formatters.ts must export formatElaineContextList and formatElaineContextEntity. Do not rename, split, or delete these exports — they are the single source of truth for Elaine page context formatting.",
  },

  // ── Domain pages that have been migrated must use the shared formatters ───
  ...[
    "artifacts/modules/src/ornaments/pages/categories.tsx",
    "artifacts/modules/src/ornaments/pages/collection.tsx",
    "artifacts/modules/src/ornaments/pages/maintenance.tsx",
    "artifacts/modules/src/travels/pages/Dashboard.tsx",
    "artifacts/modules/src/travels/pages/TravelCalendar.tsx",
    "artifacts/modules/src/travels/pages/Trips.tsx",
  ].map((path) => ({
    path,
    includes: ["formatElaineContextList"],
    fix: `${path} was migrated to use formatElaineContextList from @workspace/elaine-ui. Do not revert to inline .join() or .slice().map() context construction.`,
  })),

  // ── Browser monitoring must go through the shared initBrowserMonitoring ───
  {
    path: "lib/web-core/src/sentry.ts",
    includes: ["initBrowserMonitoring", "Sentry.replayIntegration"],
    fix: "lib/web-core/src/sentry.ts must export initBrowserMonitoring() and must contain Sentry.replayIntegration. This is the single source of truth for browser monitoring policy.",
  },

  // ── SPA sentry wrappers must use the shared function, never Sentry.init ──
  ...[
    "artifacts/modules/src/sentry.ts",
    "artifacts/web/src/sentry.ts",
    "artifacts/elaine/src/sentry.ts",
  ].map((path) => ({
    path,
    includes: ["initBrowserMonitoring"],
    excludes: ["Sentry.init", "Sentry.replayIntegration"],
    fix: `${path} must call initBrowserMonitoring() from @workspace/web-core/sentry and must not contain a local Sentry.init() or Sentry.replayIntegration call. All monitoring policy lives in lib/web-core/src/sentry.ts.`,
  })),

  // ── Public-route error boundary must remain in App.tsx ───────────────────
  {
    path: "artifacts/modules/src/App.tsx",
    includes: ["PublicRouteBoundary"],
    fix: "artifacts/modules/src/App.tsx must use PublicRouteBoundary. Do not replace it with inline error boundaries or duplicate the public-route error handling.",
  },

  // ── Elaine household data: shared facade must not be reimplemented ────────
  {
    path: "artifacts/api-server/src/elaine/index.ts",
    includes: ["queryHouseholdData", "searchHouseholdData"],
    excludes: [
      "async function queryHouseholdData",
      "async function searchHouseholdData",
    ],
    fix: "elaine/index.ts must call queryHouseholdData and searchHouseholdData from the shared household-counts.ts / household-search.ts — it must not reimplement them locally.",
  },
  {
    path: "artifacts/api-server/src/elaine/household-counts.ts",
    includes: ["export async function queryHouseholdData", "isNull"],
    fix: "household-counts.ts must export queryHouseholdData and must use isNull to exclude soft-deleted records. Do not remove either.",
  },
  {
    path: "artifacts/api-server/src/elaine/household-search.ts",
    includes: ["export async function searchHouseholdData", "isNull"],
    fix: "household-search.ts must export searchHouseholdData and must use isNull to exclude soft-deleted records. Do not remove either.",
  },
];

for (const requirement of requirements) {
  const contents = read(requirement.path);
  for (const marker of requirement.includes) {
    if (!contents.includes(marker)) {
      violations.push(
        `${requirement.path}: missing ${JSON.stringify(marker)}` +
          (requirement.fix ? `\n  FIX: ${requirement.fix}` : ""),
      );
    }
  }
  for (const marker of requirement.excludes ?? []) {
    if (contents.includes(marker)) {
      violations.push(
        `${requirement.path}: superseded local implementation ${JSON.stringify(marker)}` +
          (requirement.fix ? `\n  FIX: ${requirement.fix}` : ""),
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Section 2 — General pattern scans
//
// These walk source directories looking for violations in ANY file, not only
// files that were named when this check was written.  This is how new
// duplication is caught before it ships.
//
// When you establish a new shared mechanism and want the same protection:
//   1. Add the mechanism to lib/* (or a focused server library).
//   2. Add a scan here in the SAME change.
//   3. That's it — the scan will cover all future files automatically.
// ────────────────────────────────────────────────────────────────────────────

// Collect all TypeScript/TSX source files, excluding generated files and tests.
const allSourceFiles = [
  ...walkFiles("artifacts", [".ts", ".tsx"]),
  ...walkFiles("lib", [".ts", ".tsx"]),
].filter(
  (f) =>
    !f.endsWith(".test.ts") &&
    !f.endsWith(".test.tsx") &&
    !f.endsWith(".spec.ts") &&
    !f.endsWith(".spec.tsx") &&
    !f.includes("/node_modules/") &&
    !f.includes("/dist/") &&
    !f.includes("/build/"),
);

// ── Scan A: Sentry.init() must only appear in two designated files ────────
//
// Anywhere else it appears means Sentry privacy settings, sampling rates, and
// integration configuration have been duplicated.  The shared function
// initBrowserMonitoring() in lib/web-core/src/sentry.ts is the single owner.
//
const SENTRY_INIT_ALLOWED = new Set([
  "lib/web-core/src/sentry.ts",           // THE shared implementation
  "artifacts/api-server/src/instrument.ts", // server-side Sentry (separate concern)
]);

for (const file of allSourceFiles) {
  if (SENTRY_INIT_ALLOWED.has(file)) continue;
  const contents = read(file);
  if (contents.includes("Sentry.init(")) {
    violations.push(
      `${file}: contains Sentry.init() outside the two permitted files\n` +
        "  FIX: Remove the local Sentry.init() block. In SPA bundles, call\n" +
        "       initBrowserMonitoring({ dsn, release, enabled }) from\n" +
        "       @workspace/web-core/sentry instead. All replay, privacy,\n" +
        "       sampling, and HTTP-filter settings stay in lib/web-core/src/sentry.ts.",
    );
  }
}

// ── Scan B: new OpenAI() must not appear in route handlers ───────────────
//
// Route handlers receive HTTP requests and should delegate AI work to the
// shared provider facade (lib/ai-client.ts, lib/openai-responses.ts).
// Instantiating a client in a route bakes provider configuration (model,
// timeout, retry logic) into the route — the same duplication the facade was
// introduced to prevent.
//
const routeSourceFiles = walkFiles("artifacts/api-server/src/routes", [".ts"]).filter(
  (f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"),
);

for (const file of routeSourceFiles) {
  const contents = read(file);
  if (contents.includes("new OpenAI(")) {
    violations.push(
      `${file}: instantiates an OpenAI client directly in a route handler\n` +
        "  FIX: Import getOpenRouterClient() or callModel() from lib/ai-client.ts\n" +
        "       (or callModelWithResponses() from lib/openai-responses.ts for the\n" +
        "       Responses API).  Route handlers must not own provider configuration.",
    );
  }
}

// ── Scan C: New page files must use shared Elaine context formatters ──────
//
// Any .tsx page file that calls usePageAssistantContext must import from
// @workspace/elaine-ui to get formatElaineContextList and formatElaineContextEntity.
// Inline .join() / .slice().map() patterns create per-page formatting drift —
// Elaine sees inconsistent entity-ID labels across domains.
//
// The files below predate this rule and are tracked as migration candidates.
// DO NOT add new files to this set.  New pages must use the shared formatters.
// When a file is migrated, remove it from this set so the protection holds.
//
const ELAINE_CONTEXT_LEGACY_EXEMPT = new Set([
  // ── Ornaments — migration candidates ──────────────────────────────────────
  "artifacts/modules/src/ornaments/pages/camera-add.tsx",
  "artifacts/modules/src/ornaments/pages/hallmark-events.tsx",
  "artifacts/modules/src/ornaments/pages/scan.tsx",
  "artifacts/modules/src/ornaments/pages/stats.tsx",
  // ── Pottery — migration candidates ────────────────────────────────────────
  "artifacts/modules/src/pottery/pages/categories.tsx",
  "artifacts/modules/src/pottery/pages/compare.tsx",
  "artifacts/modules/src/pottery/pages/detail.tsx",
  "artifacts/modules/src/pottery/pages/scan.tsx",
  "artifacts/modules/src/pottery/pages/stats.tsx",
  // ── Quilting — migration candidates ───────────────────────────────────────
  "artifacts/modules/src/quilting/pages/blocks/cut-pattern.tsx",
  "artifacts/modules/src/quilting/pages/blocks/designer.tsx",
  "artifacts/modules/src/quilting/pages/blocks/detail.tsx",
  "artifacts/modules/src/quilting/pages/blocks/index.tsx",
  "artifacts/modules/src/quilting/pages/blocks/whole-quilt-list.tsx",
  "artifacts/modules/src/quilting/pages/blocks/whole-quilt.tsx",
  "artifacts/modules/src/quilting/pages/categories.tsx",
  "artifacts/modules/src/quilting/pages/compare.tsx",
  "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
  "artifacts/modules/src/quilting/pages/layouts/composer.tsx",
  "artifacts/modules/src/quilting/pages/layouts/detail.tsx",
  "artifacts/modules/src/quilting/pages/layouts/index.tsx",
  "artifacts/modules/src/quilting/pages/library/blocks.tsx",
  "artifacts/modules/src/quilting/pages/patterns/add.tsx",
  "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
  "artifacts/modules/src/quilting/pages/patterns/index.tsx",
  "artifacts/modules/src/quilting/pages/quilts/add.tsx",
  "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
  "artifacts/modules/src/quilting/pages/quilts/index.tsx",
  "artifacts/modules/src/quilting/pages/shopping/index.tsx",
  "artifacts/modules/src/quilting/pages/tools/yardage.tsx",
  // ── Travels — migration candidates ────────────────────────────────────────
  "artifacts/modules/src/travels/pages/Destinations.tsx",
  "artifacts/modules/src/travels/pages/Documents.tsx",
  "artifacts/modules/src/travels/pages/Explore.tsx",
  "artifacts/modules/src/travels/pages/GmailReview.tsx",
  "artifacts/modules/src/travels/pages/TripDetail.tsx",
  "artifacts/modules/src/travels/pages/Wishlist.tsx",
  "artifacts/modules/src/travels/pages/WorldMap.tsx",
  // ── Hub / web artifact — migration candidates ──────────────────────────────
  "artifacts/web/src/components/AppLauncher.tsx",
  "artifacts/web/src/pages/control-panel.tsx",
  "artifacts/web/src/pages/google-apis-demo.tsx",
]);

const pageFiles = allSourceFiles.filter(
  (f) =>
    f.endsWith(".tsx") &&
    (f.startsWith("artifacts/modules/src/") ||
      f.startsWith("artifacts/web/src/") ||
      f.startsWith("artifacts/elaine/src/")),
);

for (const file of pageFiles) {
  if (ELAINE_CONTEXT_LEGACY_EXEMPT.has(file)) continue;
  const contents = read(file);
  if (
    contents.includes("usePageAssistantContext") &&
    !contents.includes("@workspace/elaine-ui")
  ) {
    violations.push(
      `${file}: uses usePageAssistantContext without importing from @workspace/elaine-ui\n` +
        "  FIX: Add 'import { formatElaineContextList, formatElaineContextEntity }'\n" +
        "       from '@workspace/elaine-ui' and use those functions to build the\n" +
        "       context string.  Never pass inline .join() or .slice().map() output\n" +
        "       to usePageAssistantContext — Elaine needs consistent entity-ID labels\n" +
        "       to invoke the correct app operations.  See docs/composition-and-\n" +
        "       configuration.md §Elaine page context.",
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error(
    `\nComposition and configuration drift detected (${violations.length} violation${
      violations.length === 1 ? "" : "s"
    }):\n`,
  );
  for (const v of violations) {
    console.error(`✗ ${v}\n`);
  }
  console.error(
    "Each violation message contains a FIX: clause.\n" +
      "See docs/composition-and-configuration.md for the decision order\n" +
      "and examples of the correct pattern.\n",
  );
  process.exitCode = 1;
} else {
  console.log("✓ Domain composition boundaries are intact");
}
