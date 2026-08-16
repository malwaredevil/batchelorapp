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
  const SKIP = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".turbo",
    ".cache",
  ]);
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

  // ── Item photo galleries: must use the shared ItemImageGallery ────────────
  // (Pottery's detail page is the gold-standard original and is deliberately
  // exempt — see .agents/memory/collection-ui-coverage.md.)
  ...[
    "artifacts/modules/src/ornaments/pages/detail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
    "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
    "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
  ].map((path) => ({
    path,
    includes: ["ItemImageGallery"],
    fix: "Use ItemImageGallery from @workspace/image-capture for the item photo gallery (add/edit/label/set-primary/delete). Do not hand-roll a per-domain gallery strip.",
  })),

  // ── Detail field rows: must use the shared CollectionDetailField ──────────
  ...[
    "artifacts/modules/src/ornaments/pages/detail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
    "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
    "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
  ].map((path) => ({
    path,
    includes: ["CollectionDetailField", "CollectionDetailSection"],
    fix: "Use CollectionDetailField / CollectionDetailSection from @workspace/collection-ui for record fields and panels instead of bespoke label/value markup.",
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
    "artifacts/modules/src/ornaments/components/tag-selector.tsx",
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
    excludes: [
      "function parseStringArray",
      "function resolveOrCreateCategories",
    ],
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

  // ── Domain pages that have been migrated must use the shared list formatter ─
  ...[
    "artifacts/modules/src/ornaments/pages/categories.tsx",
    "artifacts/modules/src/ornaments/pages/collection.tsx",
    "artifacts/modules/src/ornaments/pages/maintenance.tsx",
    "artifacts/modules/src/travels/pages/Dashboard.tsx",
    "artifacts/modules/src/travels/pages/TravelCalendar.tsx",
    "artifacts/modules/src/travels/pages/Trips.tsx",
    // Migrated in task #469 — list pages
    "artifacts/modules/src/pottery/pages/categories.tsx",
    "artifacts/modules/src/pottery/pages/compare.tsx",
    "artifacts/modules/src/pottery/pages/detail.tsx",
    "artifacts/modules/src/pottery/pages/scan.tsx",
    "artifacts/modules/src/pottery/pages/stats.tsx",
    "artifacts/modules/src/quilting/pages/categories.tsx",
    "artifacts/modules/src/quilting/pages/shopping/index.tsx",
    "artifacts/modules/src/quilting/pages/layouts/index.tsx",
    "artifacts/modules/src/quilting/pages/patterns/index.tsx",
    "artifacts/modules/src/quilting/pages/quilts/index.tsx",
    "artifacts/modules/src/quilting/pages/blocks/index.tsx",
    "artifacts/modules/src/travels/pages/Wishlist.tsx",
    "artifacts/modules/src/travels/pages/TripDetail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/index.tsx",
    "artifacts/modules/src/pottery/pages/add.tsx",
    "artifacts/modules/src/pottery/pages/collection.tsx",
  ].map((path) => ({
    path,
    includes: ["formatElaineContextList"],
    fix: `${path} was migrated to use formatElaineContextList from @workspace/elaine-ui. Do not revert to inline .join() or .slice().map() context construction.`,
  })),

  // ── Domain detail pages migrated to formatElaineContextEntity (single item) ─
  ...["artifacts/modules/src/ornaments/pages/detail.tsx"].map((path) => ({
    path,
    includes: ["formatElaineContextEntity"],
    fix: `${path} was migrated to use formatElaineContextEntity from @workspace/elaine-ui. Do not revert to inline entityId interpolation in the usePageAssistantContext context string.`,
  })),

  // ── Domain pages that have been migrated must use the shared entity formatter
  ...[
    // Migrated in task #472 — Office Gmail page surfaces the open thread ID
    "artifacts/modules/src/office/pages/gmail.tsx",
    // Migrated in task #469 — detail pages that surface a single entity ID
    "artifacts/modules/src/quilting/pages/layouts/composer.tsx",
    "artifacts/modules/src/quilting/pages/blocks/cut-pattern.tsx",
    "artifacts/modules/src/quilting/pages/blocks/designer.tsx",
    "artifacts/modules/src/quilting/pages/blocks/detail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
    "artifacts/modules/src/quilting/pages/layouts/detail.tsx",
    "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
    "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
    "artifacts/web/src/components/AppLauncher.tsx",
  ].map((path) => ({
    path,
    includes: ["formatElaineContextEntity"],
    fix: `${path} was migrated to use formatElaineContextEntity from @workspace/elaine-ui. Do not revert to inline entityId interpolation in the usePageAssistantContext context string.`,
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

  // ── Elaine doubt-test files: both must use the shared mock scaffold ───────
  //
  // chat-reminder-doubt.test.ts and scheduling-doubt-tool-forcing.test.ts
  // share almost identical mock scaffolds.  A single shared helper
  // (standard-mock-scaffold.ts) is the source of truth for those factories.
  // Both test files must import from it so that a mock update in one file
  // cannot silently diverge from the other.
  {
    path: "artifacts/api-server/src/elaine/chat-reminder-doubt.test.ts",
    includes: [
      "./test-helpers/standard-mock-scaffold",
      "elaineLessonsMockFactory",
    ],
    fix: "chat-reminder-doubt.test.ts must import elaineLessonsMockFactory (and other shared factories) from ./test-helpers/standard-mock-scaffold. Do not inline duplicate vi.mock() bodies that already exist in the shared scaffold.",
  },
  {
    path: "artifacts/api-server/src/elaine/scheduling-doubt-tool-forcing.test.ts",
    includes: [
      "./test-helpers/standard-mock-scaffold",
      "elaineLessonsMockFactory",
    ],
    fix: "scheduling-doubt-tool-forcing.test.ts must import elaineLessonsMockFactory (and other shared factories) from ./test-helpers/standard-mock-scaffold. Do not inline duplicate vi.mock() bodies that already exist in the shared scaffold.",
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

/**
 * Read a named-file requirement from disk and check its contents.
 *
 * Exported so unit tests can verify that a deleted or unreadable file produces
 * a structured violation (with the path clearly named) rather than an ENOENT
 * crash that looks identical to a broken CI run.
 *
 * @param req - The full requirement descriptor (including path).
 * @returns   An array of violation strings.  If the file cannot be read,
 *            returns exactly one violation: "<path>: file not found or unreadable".
 */
export function checkRequirementFile(req: {
  path: string;
  includes: string[];
  excludes?: string[];
  fix?: string;
}): string[] {
  let contents: string;
  try {
    contents = read(req.path);
  } catch {
    return [`${req.path}: file not found or unreadable`];
  }
  return checkRequirementContents(req.path, contents, req);
}

/**
 * Check a single named-file requirement against already-loaded file contents.
 *
 * Exported so unit tests can exercise the Section 1 loop logic against
 * synthetic file contents without touching the real filesystem.
 *
 * @param path     - The file path (used only for error message labels).
 * @param contents - The file's text content (pass "" to simulate an empty file).
 * @param req      - The requirement descriptor (includes, excludes, fix).
 * @returns        An array of violation strings (empty when the file satisfies all requirements).
 */
export function checkRequirementContents(
  path: string,
  contents: string,
  req: { includes: string[]; excludes?: string[]; fix?: string },
): string[] {
  const found: string[] = [];
  for (const marker of req.includes) {
    if (!contents.includes(marker)) {
      found.push(
        `${path}: missing ${JSON.stringify(marker)}` +
          (req.fix ? `\n  FIX: ${req.fix}` : ""),
      );
    }
  }
  for (const marker of req.excludes ?? []) {
    if (contents.includes(marker)) {
      found.push(
        `${path}: superseded local implementation ${JSON.stringify(marker)}` +
          (req.fix ? `\n  FIX: ${req.fix}` : ""),
      );
    }
  }
  return found;
}

for (const requirement of requirements) {
  violations.push(...checkRequirementFile(requirement));
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

/**
 * Scan A detector — exported for unit tests.
 * Returns true if the source contains a direct Sentry.init() call.
 */
export function hasSentryInit(contents: string): boolean {
  return contents.includes("Sentry.init(");
}

const SENTRY_INIT_ALLOWED = new Set([
  "lib/web-core/src/sentry.ts", // THE shared implementation
  "artifacts/api-server/src/instrument.ts", // server-side Sentry (separate concern)
  "lib/vite-config/src/index.ts", // only mentions Sentry.init in a comment, no actual call
]);

for (const file of allSourceFiles) {
  if (SENTRY_INIT_ALLOWED.has(file)) continue;
  const contents = read(file);
  if (hasSentryInit(contents)) {
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

/**
 * Scan B detector — exported for unit tests.
 * Returns true if the source instantiates an OpenAI client directly.
 */
export function hasDirectOpenAIClient(contents: string): boolean {
  return contents.includes("new OpenAI(");
}

const routeSourceFiles = walkFiles("artifacts/api-server/src/routes", [
  ".ts",
]).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));

for (const file of routeSourceFiles) {
  const contents = read(file);
  if (hasDirectOpenAIClient(contents)) {
    violations.push(
      `${file}: instantiates an OpenAI client directly in a route handler\n` +
        "  FIX: Import getOpenRouterClient() or callModel() from lib/ai-client.ts\n" +
        "       (or callModelWithResponses() from lib/openai-responses.ts for the\n" +
        "       Responses API).  Route handlers must not own provider configuration.",
    );
  }
}

// ── Scan C: New page files that build entity lists must use shared formatters ─
//
// A .tsx page file that calls usePageAssistantContext AND builds a list inline
// (evidenced by .join(", ") or .join("; ") in the file) must import the shared
// formatters from @workspace/elaine-ui.  Inline .join() / .slice().map() patterns
// create per-page formatting drift — Elaine sees inconsistent entity-ID labels.
//
// Pages with purely static context strings (no entity list building) do not need
// the import; they are not flagged.  Regression protection for migrated pages is
// provided by the named-file requirements in Section 1.
//
// DO NOT add an exempt set here.  Instead: migrate inline patterns to use the
// shared formatters, OR keep the context string static (no inline joining).
//
const pageFiles = allSourceFiles.filter(
  (f) =>
    f.endsWith(".tsx") &&
    (f.startsWith("artifacts/modules/src/") ||
      f.startsWith("artifacts/web/src/") ||
      f.startsWith("artifacts/elaine/src/")),
);

/**
 * Scan C detector — exported for unit tests.
 * Returns true if the source uses usePageAssistantContext with an inline
 * .join()-based entity list but does NOT import the shared formatters.
 */
export function hasInlineContextListBuilding(contents: string): boolean {
  // The `|| "none"` suffix is the canonical indicator that a .join() is
  // producing an entity list for the context string (not for JSX rendering).
  const hasInlineListPattern =
    contents.includes('.join(", ") || "none"') ||
    contents.includes('.join("; ") || "none"') ||
    contents.includes(".join(',') || \"none\"") ||
    contents.includes(".join(';') || \"none\"") ||
    contents.includes(".join(', ') || 'none'") ||
    contents.includes(".join('; ') || 'none'");
  return (
    contents.includes("usePageAssistantContext") &&
    hasInlineListPattern &&
    !contents.includes("formatElaineContextList") &&
    !contents.includes("formatElaineContextEntity")
  );
}

for (const file of pageFiles) {
  const contents = read(file);
  if (hasInlineContextListBuilding(contents)) {
    violations.push(
      `${file}: uses usePageAssistantContext with inline .join() list-building but does not call formatElaineContextList or formatElaineContextEntity\n` +
        "  FIX: Import and use formatElaineContextList / formatElaineContextEntity\n" +
        "       from '@workspace/elaine-ui' to build the context string.\n" +
        "       Simply importing another export from @workspace/elaine-ui does NOT\n" +
        "       satisfy this check — the formatter functions must be present in the file.\n" +
        "       Inline .join() / .slice().map() patterns create per-page formatting drift.\n" +
        "       Elaine needs consistent entity-ID labels to invoke the correct operations.\n" +
        "       See docs/composition-and-configuration.md §Elaine page context.",
    );
  }
}

// ── Scan D: Cross-artifact shared exports must be enrolled or acknowledged ──
//
// When a named export from @workspace/elaine-ui or @workspace/web-core/* is
// imported by code in two or more distinct top-level artifacts (modules, web,
// elaine, api-server), it is a shared mechanism.  Every shared mechanism must
// be either:
//
//   (a) ENROLLED — appears as a required marker in Section 1 (named-file
//       requirements), so its correct usage is mechanically verified, OR
//
//   (b) ACKNOWLEDGED — listed in KNOWN_SHARED_EXPORTS_NO_BOUNDARY_NEEDED
//       below, with a comment explaining why no boundary is needed (e.g.
//       it is a pure utility or a UI component whose shared use is the point).
//
// How the check works: it reads this script's own source and confirms that
// the export name appears as a string literal somewhere in this file.
// That makes the check self-referential in a useful way — any export that
// has been consciously handled (enrolled or acknowledged) will be present;
// any that slipped through without a conscious decision will not be.
//
// When you add a new cross-artifact export to elaine-ui or web-core:
//   1. If it carries domain policy (formatting, monitoring, auth patterns):
//      add a named-file requirement to Section 1.
//   2. If it is a pure utility or shared UI component: add it here with a
//      one-line comment explaining why no boundary is needed.
//   Do this in the SAME change that makes the export cross-artifact.
//
// IMPORTANT: do not add @workspace/collection-ui or @workspace/app-shell
// exports here — those are covered by named-file requirements in Section 1
// that verify the specific component names at their call sites.
//
const KNOWN_SHARED_EXPORTS_NO_BOUNDARY_NEEDED = new Set([
  // ── @workspace/web-core ──────────────────────────────────────────────────
  // Pure URL utility: builds cross-app link bases, no domain policy to drift.
  "crossAppUrl",
  // ── @workspace/elaine-ui ─────────────────────────────────────────────────
  // UI components: shared use is the point; no drift risk in the component itself.
  "ElaineWidget",
  "ElaineChatPanel",
  "ElaineHistoryPanel",
  "ElainePlanProgress",
  "ElaineAvatar",
  "ElaineWordmark",
  "ElaineName",
  "ElaineSettingsCard",
  "GlobalConfigCard",
  "AppSwitcher",
  "CommandPalette",
  "ChatWidgets",
  "MarkdownMessage",
  "AppId",
  // Hooks: provide shared capability; no domain-policy drift risk.
  "useElaineChat",
  "useAppConfigSummary", // reads app config for Elaine page context — sharing IS the design
  "useTTS",
  "useVoiceInput",
  "useTheme",
  // ── @workspace/web-core ──────────────────────────────────────────────────
  // Pure color utilities — no policy, no drift risk.
  "getCategoryPalette",
  "colorToHex",
  "autoTextColor",
  "CATEGORY_BG_PALETTE",
  // Standard SPA lifecycle helpers — expected to appear in every artifact entrypoint.
  "mountApp",
  "NotFound", // standard 404 component
  "InstallBanner", // PWA install prompt
  "useInstallPrompt", // PWA hook
  // Auth state hook — shared because the session model is shared.
  "useAuth",
  // Pure utilities — no domain policy.
  "cn",
  "useIsMobile",
  "downloadText",
  "downloadBlob",
  "downloadFile",
  "ElainePageContext", // context provider — shared use is the design
  "ElainePageContextProvider", // root-level context provider, mounted once per SPA
  "ThemeProvider", // root-level theme provider, mounted once per SPA
]);

// ── Import parsing helpers ────────────────────────────────────────────────────

/**
 * Extract the top-level artifact directory from a workspace-relative path.
 * Returns null for paths that don't belong to a top-level artifact.
 */
function topLevelArtifact(filePath: string): string | null {
  const m = filePath.match(/^artifacts\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Parse all named (non-type) imports from @workspace/elaine-ui or
 * @workspace/web-core/* in a source file and return them as an array of
 * export names.
 */
export function extractSharedLibImports(source: string): string[] {
  // Matches: import { ... } from '@workspace/elaine-ui'
  //          import { ... } from '@workspace/web-core/sentry'
  // Skips:   import type { ... } (type-only — no runtime coupling)
  //
  // Uses [^}]* (not [\s\S]*?) so the match STOPS at the first closing brace
  // and never spans across multiple import statements.  [\s\S]*? would
  // backtrack past } characters and capture names from unrelated imports.
  const re =
    /import(?!\s+type)\s*\{([^}]*)\}\s*from\s*['"]@workspace\/(?:elaine-ui|web-core(?:\/[^'"]*)?)['"]/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(",")) {
      // Strip inline // comments before trimming (e.g. "ElaineWidget, // used for X")
      const withoutComment = raw.split("//")[0];
      // Handle "X as Y" aliases → take the original export name (X)
      const name = withoutComment
        .trim()
        .replace(/\s+as\s+\S+$/, "") // strip "as Alias" suffix
        .replace(/^type\s+/, "") // strip inline "type" keyword
        .trim();
      if (name && !name.startsWith("*") && /^[A-Za-z_$]/.test(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

// ── Scan ─────────────────────────────────────────────────────────────────────

// Read this script's own source once so we can check whether an export name
// is mentioned anywhere in it (enrolled as a boundary OR acknowledged below).
const checkScriptSource = read("scripts/src/check-domain-composition.ts");

// Collect: exportName → Set of top-level artifact dirs that import it
const exportArtifacts = new Map<string, Set<string>>();

for (const file of allSourceFiles) {
  const artifact = topLevelArtifact(file);
  if (!artifact) continue;
  const source = read(file);
  for (const name of extractSharedLibImports(source)) {
    if (!exportArtifacts.has(name)) exportArtifacts.set(name, new Set());
    exportArtifacts.get(name)!.add(artifact);
  }
}

// Flag any export that spans 2+ artifacts but hasn't been consciously handled.
for (const [name, artifacts] of exportArtifacts) {
  if (artifacts.size < 2) continue; // single-artifact usage — not yet "shared"

  // Does this name appear anywhere in the check script source?
  // Named-file requirement markers appear as quoted strings in includes[].
  // KNOWN_SHARED_EXPORTS_NO_BOUNDARY_NEEDED entries appear as quoted strings above.
  // Either way the name IS present → consciously handled → no violation.
  if (checkScriptSource.includes(`"${name}"`)) continue;

  const artifactList = [...artifacts].sort().join(", ");
  violations.push(
    `@workspace shared export "${name}" is imported in ${artifacts.size} artifacts` +
      ` (${artifactList}) but is not enrolled or acknowledged in this check script\n` +
      "  FIX: In the SAME change that made this export cross-artifact, do ONE of:\n" +
      `    (a) ENROLL — if "${name}" carries domain policy (formatting, monitoring,\n` +
      "        analytics, auth patterns): add a named-file requirement to Section 1\n" +
      "        that verifies its correct usage at call sites.\n" +
      `    (b) ACKNOWLEDGE — if "${name}" is a pure utility or shared UI component\n` +
      "        with no drift risk: add it to KNOWN_SHARED_EXPORTS_NO_BOUNDARY_NEEDED\n" +
      "        in this script with a one-line comment explaining why no boundary\n" +
      "        is needed.  Do not skip the comment — it is the audit trail.\n" +
      "  See docs/composition-and-configuration.md §Enrollment rule.",
  );
}

// ── Scan E: usePageAssistantContext must not hard-code labeled entity IDs ─────
//
// A page that calls usePageAssistantContext and contains a labeled entity-ID
// interpolation — e.g.
//   `threadId: ${selectedThreadId}`
//   `fabricId: ${fabric.id}`
// — is bypassing formatElaineContextEntity.  The developer has correctly
// signalled that this is an entity reference (by naming it) but skipped the
// formatter.  Elaine sees the bare ID without the surrounding context
// (entity type, display label, noun) that the formatter provides.
//
// Detection — the "labeled entity ID" heuristic targets the exact pattern that
// matters without producing false-positives from URL path segments or JSX
// attribute values:
//
//   Pattern: \b(id|[a-z][a-zA-Z]*Id)\s*:\s*\${…}
//
//   Matches (real violations):
//     threadId: ${selectedThreadId}        ← explicit label in context string
//     fabricId: ${fabric.id}              ← explicit label in context string
//     id: ${item.id}                      ← bare id label in context string
//
//   Does NOT match (non-violations):
//     navigate(`/route/${item.id}`)        ← URL path, no label prefix
//     href={`/route/${item.id}`}           ← JSX attribute, no label prefix
//     htmlFor={`label-${item.id}`}         ← JSX attribute, no label prefix
//     ${dragOverId === panel.id && …}      ← multi-line JSX expression
//
// Three conditions must ALL be true to fire:
//   (a) file calls usePageAssistantContext, AND
//   (b) file contains the labeled-entity-ID pattern above, AND
//   (c) file does NOT import formatElaineContextEntity.
//
// Migrated pages in Section 1 are already protected by named-file requirements
// and will also be caught here if they regress.
//
// DO NOT add an exempt set here.  Migrate labeled entity-ID patterns to use
// formatElaineContextEntity from @workspace/elaine-ui instead.

/**
 * Scan E detector — exported for unit tests.
 * Returns true if the source uses usePageAssistantContext with a labeled
 * entity-ID interpolation (e.g. `threadId: ${id}`) but does NOT import
 * formatElaineContextEntity.
 *
 * Uses [^}\n]+ to avoid spanning across multi-line JSX expressions (which
 * would produce false-positives from JSX conditionals containing Id variables).
 */
export function hasLabeledEntityIdInContext(contents: string): boolean {
  // Matches `wordId: ${expr}` or `id: ${expr}` on a single line.
  const LABELED_ENTITY_ID_RE = /\b(?:[a-z][a-zA-Z]*Id|id)\s*:\s*\$\{[^}\n]+\}/;
  return (
    contents.includes("usePageAssistantContext") &&
    LABELED_ENTITY_ID_RE.test(contents) &&
    !contents.includes("formatElaineContextEntity")
  );
}

for (const file of pageFiles) {
  const contents = read(file);
  if (hasLabeledEntityIdInContext(contents)) {
    violations.push(
      `${file}: uses usePageAssistantContext with a labeled inline entity-ID` +
        ` interpolation (e.g. \`threadId: \${selectedThreadId}\`) but does not` +
        ` call formatElaineContextEntity\n` +
        "  FIX: Import formatElaineContextEntity from '@workspace/elaine-ui' and\n" +
        "       use it to embed the entity reference in the context string, e.g.:\n" +
        "         formatElaineContextEntity({ entity: 'Thread', id: selectedThreadId, label: subject })\n" +
        "       This gives Elaine the entity type and display label alongside the ID\n" +
        "       so she can invoke the correct operation unambiguously.\n" +
        "       See lib/elaine-ui/src/page-context-formatters.ts for the full API.",
    );
  }
}

// ── Scan F: bare .id property access in context strings ──────────────────────
//
// A page that calls usePageAssistantContext and embeds a bare .id property
// access — e.g. `${item.id}`, `${fabric.id}`, `${note.id}` — directly in
// the context string is bypassing formatElaineContextEntity without even a
// labeled prefix (unlike the labeled form `fabricId: ${fabric.id}` caught by
// Scan E).
//
// Detection strategy:
//   Pattern: `\${[^{}\n]+\.id\}` with two negative lookbehinds (see below).
//   The inner character class is `[^{}\n]+` (not `[^}\n]+`) so the match
//   stops at any nested `${…}` opening — this prevents a complex expression
//   like `${name || \`Fabric #${id}\`}` from matching as if the outer `${`
//   were a bare-id interpolation.
//
//   Three conditions must ALL be true to fire:
//     (a) file calls usePageAssistantContext, AND
//     (b) file contains ${expr.id} not excluded by the lookbehinds, AND
//     (c) file does NOT import formatElaineContextEntity.
//
// Excluded (non-violation) patterns:
//   (?<![\/\-#])   — URL path segments (/route/${id}),
//                    JSX template suffixes (htmlFor={`key-${id}`}),
//                    display labels  (`Fabric #${id}`)
//   (?<![?&][a-zA-Z][a-zA-Z0-9_]*=)
//                  — URL query params (?id=${id}, &filter=${id})
//
// Notably NOT excluded: a leading backtick — `usePageAssistantContext("p",
// \`${item.id}\`)` is a real violation (context string consisting solely of a
// bare ID) and must fire.
//
// Migrated pages that already import formatElaineContextEntity are safe.

/**
 * Scan F detector — exported for unit tests.
 * Returns true if the source uses usePageAssistantContext with a bare
 * .id property-accessor interpolation (e.g. `${item.id}`) but does NOT
 * import formatElaineContextEntity.
 *
 * Negative lookbehinds exclude known non-violation patterns:
 *   (?<![\/\-#])    — excludes URL path segments (/route/${id}),
 *                     JSX template suffixes (htmlFor={`key-${id}`}),
 *                     display labels with # (e.g. `Fabric #${id}`).
 *   (?<![?&][a-zA-Z][a-zA-Z0-9_]*=)
 *                   — excludes URL query params (?id=${id}, &filter=${id}).
 *
 * The inner class [^{}\n]+ (stops at { and }) prevents matching across
 * nested template expressions such as `${name || \`#${id}\`}`.
 */
export function hasBareEntityIdInContext(contents: string): boolean {
  const BARE_ID_RE =
    /(?<![\/\-#])(?<![?&][a-zA-Z][a-zA-Z0-9_]*=)\$\{[^{}\n]+\.id\}/;
  return (
    contents.includes("usePageAssistantContext") &&
    BARE_ID_RE.test(contents) &&
    !contents.includes("formatElaineContextEntity")
  );
}

for (const file of pageFiles) {
  const contents = read(file);
  if (hasBareEntityIdInContext(contents)) {
    violations.push(
      `${file}: uses usePageAssistantContext with a bare inline .id` +
        ` interpolation (e.g. \`\${item.id}\`) but does not call` +
        ` formatElaineContextEntity\n` +
        "  FIX: Import formatElaineContextEntity from '@workspace/elaine-ui' and\n" +
        "       use it to embed the entity reference in the context string, e.g.:\n" +
        "         formatElaineContextEntity({ entity: 'Item', id: item.id, label: item.name })\n" +
        "       This gives Elaine the entity type and display label alongside the ID\n" +
        "       so she can invoke the correct operation unambiguously.\n" +
        "       See lib/elaine-ui/src/page-context-formatters.ts for the full API.",
    );
  }
}

// ── Scan G: planner-tool-catalog mock completeness ────────────────────────────
//
// When a test file mocks `./planner-tool-catalog` with an inline factory
// (`vi.mock("./planner-tool-catalog", () => ({...}))`), the mock object must
// provide every named export that elaine/index.ts statically imports.  A
// missing export is silently `undefined` at runtime, which can be swallowed by
// production try-catch blocks and cause spies to receive 0 calls with no
// obvious error message.
//
// The check extracts the factory body between the opening marker and the
// closing `\n}));`, then verifies that each required key appears as `KEY:`
// somewhere in that body.

/**
 * The set of named exports that elaine/index.ts statically imports from
 * `./planner-tool-catalog`.  Every inline vi.mock factory for that module
 * in the test suite must include all of these as object keys.
 *
 * For string-typed constants, `value` holds the canonical string from
 * planner-tool-catalog.ts.  The guardrail uses it to verify that the mock
 * assigns the correct value — not just that the key is present.  When a
 * tool name changes in planner-tool-catalog.ts, update both the constant's
 * string there AND the `value` field here, then fix every mock factory.
 *
 * Keep this list in sync with the import block in elaine/index.ts.
 */
export const PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS: ReadonlyArray<{
  key: string;
  /** Canonical string value; present only for string-typed constants. */
  value?: string;
}> = [
  { key: "ACTION_CONFIRMATION_MODES" },
  { key: "ACTION_TOOL_NAMES" },
  { key: "ACTION_TOOLS" },
  { key: "ANALYZE_FABRIC_PHOTO_TOOL_NAME", value: "analyze_fabric_photo" },
  { key: "ANALYZE_ORNAMENT_PHOTO_TOOL_NAME", value: "analyze_ornament_photo" },
  { key: "ANALYZE_POTTERY_PHOTO_TOOL_NAME", value: "analyze_pottery_photo" },
  { key: "CALCULATE_YARDAGE_TOOL_NAME", value: "calculate_yardage" },
  {
    key: "CHECK_INTEGRATIONS_HEALTH_TOOL_NAME",
    value: "check_integrations_health",
  },
  { key: "GET_OWNER_SETTINGS_TOOL_NAME", value: "get_owner_settings" },
  {
    key: "UPDATE_OWNER_SETTING_TOOL_NAME",
    value: "update_owner_setting",
  },
  { key: "LIST_SENTRY_ISSUES_TOOL_NAME", value: "list_sentry_issues" },
  { key: "CONSULT_EXPERTS_TOOL_NAME", value: "consult_experts" },
  { key: "EBAY_SEARCH_TOOL_NAME", value: "ebay_search" },
  { key: "ELAINE_PLANNER_TOOL_CATALOG" },
  { key: "FETCH_PAGE_TOOL_NAME", value: "fetch_page" },
  { key: "FIND_NEARBY_PLACES_TOOL_NAME", value: "find_nearby_places" },
  { key: "GENERATE_DOCUMENT_TOOL_NAME", value: "generate_document" },
  { key: "GET_AIR_QUALITY_TOOL_NAME", value: "get_air_quality" },
  { key: "GET_EXCHANGE_RATE_TOOL_NAME", value: "get_exchange_rate" },
  { key: "GET_POLLEN_FORECAST_TOOL_NAME", value: "get_pollen_forecast" },
  { key: "GET_ROUTE_INFO_TOOL_NAME", value: "get_route_info" },
  { key: "GET_WEATHER_TOOL_NAME", value: "get_weather_forecast" },
  { key: "LOOKUP_BARCODE_TOOL_NAME", value: "lookup_product_barcode" },
  { key: "LOOKUP_BOOK_VALUE_TOOL_NAME", value: "lookup_book_value" },
  { key: "LOOKUP_RETAIL_VALUE_TOOL_NAME", value: "lookup_retail_value" },
  { key: "NAVIGATE_TOOL_NAME", value: "suggest_navigation" },
  { key: "QUERY_HOUSEHOLD_TOOL_NAME", value: "query_household_data" },
  { key: "RECORD_LESSON_TOOL_NAME", value: "remember_lesson" },
  { key: "REMEMBER_TOOL_NAME", value: "remember_household_fact" },
  { key: "SEARCH_FLIGHTS_TOOL_NAME", value: "search_flights" },
  { key: "SEARCH_HALLMARK_TOOL_NAME", value: "search_hallmark" },
  { key: "SEARCH_HOUSEHOLD_TOOL_NAME", value: "search_household_data" },
  { key: "SEARCH_TRIP_DOCUMENTS_TOOL_NAME", value: "search_trip_documents" },
  { key: "SET_MODE_TOOL_NAME", value: "set_action_confirmation_mode" },
  { key: "SHOW_DATA_CARD_TOOL_NAME", value: "show_data_card" },
  { key: "SHOW_DESTINATION_CARD_TOOL_NAME", value: "show_destination_card" },
  { key: "SHOW_FABRIC_SWATCH_TOOL_NAME", value: "show_fabric_swatch" },
  { key: "SHOW_ORNAMENT_ITEM_TOOL_NAME", value: "show_ornament_item" },
  { key: "SHOW_POTTERY_ITEM_TOOL_NAME", value: "show_pottery_item" },
  { key: "SHOW_TRIP_CARD_TOOL_NAME", value: "show_trip_card" },
  { key: "SOFT_TOOLS" },
  { key: "SOFT_TOOLS_EXTRA" },
  {
    key: "SUGGEST_CLOTHING_LAYERS_TOOL_NAME",
    value: "suggest_clothing_layers",
  },
  { key: "TRIP_STATUS_ENUM" },
  { key: "WEB_SEARCH_TOOL_NAME", value: "web_search" },
];

export const RUNTIME_REQUIRED_EXPORTS: ReadonlyArray<{ key: string }> = [
  { key: "aggregateElaineTraceEvaluations" },
  { key: "assertElaineToolFamilyCoverage" },
  { key: "buildClassifierDoubtLessonInput" },
  { key: "buildElaineSourceRoute" },
  { key: "buildSelfHealLessonInput" },
  { key: "classifierDoubtPatternKey" },
  { key: "classifyElaineRequest" },
  { key: "completedActionAcknowledgement" },
  { key: "createElaineTurnTrace" },
  { key: "createFallbackPlan" },
  { key: "decideElaineModelStreamRecovery" },
  { key: "detectClaimedCheckWithoutToolCall" },
  { key: "ELAINE_READ_CONCURRENCY" },
  { key: "ElaineTurnRuntime" },
  { key: "evaluateElaineTrace" },
  { key: "evaluateForecastDateCoverage" },
  { key: "findElaineSatisfiedFallback" },
  { key: "finishElaineTurnTrace" },
  { key: "generateElainePlan" },
  { key: "isReminderDoubtMessage" },
  { key: "isReusableElaineResponseState" },
  { key: "isSchedulingDoubtMessage" },
  { key: "loadElaineTurnTracesForMessages" },
  { key: "mapWithConcurrency" },
  { key: "MODEL_VISIBLE_HARD_TOOL_NAMES" },
  { key: "MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS" },
  { key: "persistElaineTraceBestEffort" },
  { key: "preparedActionAcknowledgement" },
  { key: "provenanceForTool" },
  { key: "requestNeedsStructuredPlan" },
  { key: "sanitizeRuntimeText" },
  { key: "selectElaineOpenAIRole" },
  { key: "selectElaineReplanTool" },
  { key: "selfHealPatternKey" },
  { key: "stripElaineCitationMetadata" },
];

/**
 * Parse all named (non-type) imports from `./planner-tool-catalog` in a
 * source file and return them as an array of export names.
 *
 * Handles:
 *   import { NAME, OTHER } from "./planner-tool-catalog";
 *   import { NAME } from './planner-tool-catalog';
 *   import type { ... } — skipped
 *   import { NAME as Alias } — returns the original name (NAME)
 *
 * Exported for unit tests so the cross-check for PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS
 * coverage can be exercised against synthetic source strings.
 */
export function extractPlannerToolCatalogImports(source: string): string[] {
  const re =
    /import(?!\s+type)\s*\{([^}]*)\}\s*from\s*['"]\.\/planner-tool-catalog['"]/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Strip single-line comments from the entire specifier block BEFORE splitting
    // on commas.  Splitting first then stripping per-token loses any name that
    // appears after a comment on the same line, e.g.:
    //   EXISTING, // rationale
    //   NEW_EXPORT,
    // → after comma-split: [" // rationale\n  NEW_EXPORT"] → the whole token is
    //   discarded because split("//")[0] is just whitespace.
    const block = m[1].replace(/\/\/[^\n]*/g, "");
    for (const raw of block.split(",")) {
      const trimmed = raw.trim();
      // Skip per-specifier type-only imports (e.g. `import { type Foo, VALUE }`).
      // The import-level `import(?!\s+type)` guard only handles `import type {…}`;
      // inline `type` qualifiers on individual specifiers must be excluded here.
      if (trimmed === "type" || trimmed.startsWith("type ")) continue;
      // Strip "as Alias" suffix — return the original export name.
      const name = trimmed.replace(/\s+as\s+\S+$/, "").trim();
      if (name && !name.startsWith("*") && /^[A-Za-z_$]/.test(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Extracts the source text of the PLANNER_TOOL_CATALOG_MOCK_DEFAULTS object
 * literal from a planner-tool-catalog-mock helper file.  Uses brace-counting
 * (not regex) so nested object literals are handled correctly.
 *
 * Returns null when the expected export declaration is not found.
 */
export function extractPlannerMockDefaultsBlock(source: string): string | null {
  // Use "export const PLANNER_TOOL_CATALOG_MOCK_DEFAULTS" as the anchor so that
  // occurrences of the name in JSDoc comments above the const declaration are
  // skipped — a bare indexOf would latch onto the comment and brace-count
  // into the wrong block.
  const anchor = source.indexOf(
    "export const PLANNER_TOOL_CATALOG_MOCK_DEFAULTS",
  );
  if (anchor === -1) return null;
  // Find the first '{' that opens the assigned object literal.
  const braceStart = source.indexOf("{", anchor);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null; // unmatched brace — malformed source
}

/**
 * Validates that PLANNER_TOOL_CATALOG_MOCK_DEFAULTS in the shared helper file
 * contains every key in PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.  Inspects only
 * the extracted object literal body (not the full file or the TypeScript
 * interface), so removing a key from the returned object is caught even when
 * the interface still declares it.
 *
 * Returns null when no PLANNER_TOOL_CATALOG_MOCK_DEFAULTS block is found.
 * Returns an empty set when all keys are present.
 *
 * Exported for unit tests.
 */
export function missingPlannerMockHelperKeys(
  source: string,
): Set<string> | null {
  const block = extractPlannerMockDefaultsBlock(source);
  if (block === null) return null;
  const missing = new Set<string>();
  for (const { key } of PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS) {
    if (!block.includes(`${key}:`)) missing.add(key);
  }
  return missing;
}

/**
 * Validates that canonical string values in PLANNER_TOOL_CATALOG_MOCK_DEFAULTS
 * match PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.  Operates only on the extracted
 * object literal body.
 *
 * Returns null when no PLANNER_TOOL_CATALOG_MOCK_DEFAULTS block is found.
 * Returns an empty map when all values are correct.
 *
 * Exported for unit tests.
 */
export function wrongPlannerMockHelperValues(
  source: string,
): Map<string, { expected: string; got: string }> | null {
  const block = extractPlannerMockDefaultsBlock(source);
  if (block === null) return null;
  const wrong = new Map<string, { expected: string; got: string }>();
  for (const { key, value } of PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS) {
    if (value === undefined) continue;
    const keyPos = block.indexOf(`${key}:`);
    if (keyPos === -1) continue;
    const afterKey = block.slice(keyPos + key.length + 1).trimStart();
    const m = /^"([^"]*)"/.exec(afterKey);
    if (m && m[1] !== value) {
      wrong.set(key, { expected: value, got: m[1] });
    }
  }
  return wrong;
}

/**
 * Given the full source text of a test file, returns the set of required
 * export names that are absent from ANY inline `vi.mock("./planner-tool-catalog",
 * () => ({...}))` factory body in the file.
 *
 * Handles:
 *   - Both single-quoted and double-quoted module paths.
 *   - Optional whitespace / newlines between the factory's call syntax elements.
 *   - Multiple factory calls in the same file (union of missing keys across all).
 *
 * Returns `null` when the file contains no inline factory mock for
 * `./planner-tool-catalog` (e.g. the module is not mocked at all, or only
 * mocked via `importActual`).
 */
export function missingPlannerToolCatalogMockKeys(
  contents: string,
): Set<string> | null {
  // Match every vi.mock invocation for ./planner-tool-catalog that uses an
  // inline factory returning an object literal.  Handles:
  //   vi.mock("./planner-tool-catalog", () => ({
  //   vi.mock('./planner-tool-catalog', () => ({
  //   vi.mock("./planner-tool-catalog", () =>
  //     ({
  // The \s* between parts tolerates re-formatted or multi-line variants.
  const FACTORY_RE =
    /vi\.mock\((['"])\.\/planner-tool-catalog\1\s*,\s*\(\)\s*=>\s*\(\{/g;

  let anyFactoryFound = false;
  const allMissing = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = FACTORY_RE.exec(contents)) !== null) {
    anyFactoryFound = true;
    const bodyStart = match.index + match[0].length;

    // Extract the body from the opening `({` to the closing `\n}));`.
    const closingIdx = contents.indexOf("\n}));", bodyStart);
    const body =
      closingIdx === -1
        ? contents.slice(bodyStart)
        : contents.slice(bodyStart, closingIdx);

    for (const entry of PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS) {
      // A key is present if it appears as `KEY:` anywhere in the body.
      if (!body.includes(`${entry.key}:`)) {
        allMissing.add(entry.key);
      }
    }
  }

  return anyFactoryFound ? allMissing : null;
}

/**
 * Given the full source text of a test file, returns a Map of required
 * string constants whose value in the mock factory does NOT match the
 * canonical value in PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.
 *
 * Each entry maps the constant name to `{ expected, got }`.
 *
 * Returns `null` when the file contains no inline factory mock for
 * `./planner-tool-catalog` (same semantics as missingPlannerToolCatalogMockKeys).
 */
export function wrongPlannerToolCatalogMockValues(
  contents: string,
): Map<string, { expected: string; got: string }> | null {
  const FACTORY_RE =
    /vi\.mock\((['"])\.\/planner-tool-catalog\1\s*,\s*\(\)\s*=>\s*\(\{/g;

  let anyFactoryFound = false;
  const allWrong = new Map<string, { expected: string; got: string }>();

  let match: RegExpExecArray | null;
  while ((match = FACTORY_RE.exec(contents)) !== null) {
    anyFactoryFound = true;
    const bodyStart = match.index + match[0].length;

    // Extract the body from the opening `({` to the closing `\n}));`.
    const closingIdx = contents.indexOf("\n}));", bodyStart);
    const body =
      closingIdx === -1
        ? contents.slice(bodyStart)
        : contents.slice(bodyStart, closingIdx);

    for (const entry of PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS) {
      if (!entry.value) continue;
      // Match KEY: "value" or KEY: 'value' in the body.
      const valueRE = new RegExp(`${entry.key}:\\s*["']([^"']+)["']`);
      const valueMatch = valueRE.exec(body);
      if (valueMatch && valueMatch[1] !== entry.value) {
        allWrong.set(entry.key, { expected: entry.value, got: valueMatch[1] });
      }
    }
  }

  return anyFactoryFound ? allWrong : null;
}

// ── Scan G (extended): stale tool names inside SOFT_TOOLS / ACTION_TOOLS mock arrays ──
//
// wrongPlannerToolCatalogMockValues verifies that exported string constants
// (e.g. NAVIGATE_TOOL_NAME: "suggest_navigation") have the correct canonical
// value in the mock factory.  But SOFT_TOOLS, ACTION_TOOLS, and SOFT_TOOLS_EXTRA
// in those same mocks may also contain full tool-definition objects with inline
// name: "..." strings.  If a tool is renamed in planner-tool-catalog.ts (or an
// imported tool file) but the mock object still uses the old string, the
// dispatch table in index.ts silently misses the call — and the existing
// constant-value check doesn't catch it.
//
// This sub-check extracts every `function: { name: "..." }` pattern from
// planner-tool-catalog mock factory bodies and verifies that each name is a
// known tool name in the real catalog.
//
// The canonical name set (CATALOG_TOOL_NAME_SET) is built at scan time by
// reading the real source files, so a tool rename is caught immediately.

/**
 * Extract all inline `name: "..."` values from tool definition objects inside
 * ANY planner-tool-catalog mock factory body in the given source text.
 *
 * Targets the ChatCompletionTool mock object pattern:
 *   { type: "function", function: { name: "tool_name", parameters: { ... } } }
 *
 * Uses `[^}]*` (greedy with backtracking) so the regex stops at the first
 * brace boundary and avoids crossing into nested parameter property definitions.
 * Parameter property names always map to objects (`name: { type: "string" }`),
 * not strings, so they do not match the `["']...["']` suffix.
 *
 * Returns null when the file contains no inline factory mock for
 * `./planner-tool-catalog` (same semantics as missingPlannerToolCatalogMockKeys).
 * Returns an empty Set when factory mocks exist but contain no inline tool objects.
 */
export function extractInlineToolNamesFromPlannerMock(
  contents: string,
): Set<string> | null {
  const FACTORY_RE =
    /vi\.mock\((['"])\.\/planner-tool-catalog\1\s*,\s*\(\)\s*=>\s*\(\{/g;

  let anyFactoryFound = false;
  const foundNames = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = FACTORY_RE.exec(contents)) !== null) {
    anyFactoryFound = true;
    const bodyStart = match.index + match[0].length;

    // Extract the body from the opening `({` to the closing `\n}));`.
    const closingIdx = contents.indexOf("\n}));", bodyStart);
    const body =
      closingIdx === -1
        ? contents.slice(bodyStart)
        : contents.slice(bodyStart, closingIdx);

    // Match `function: { name: "tool_name" }` patterns.
    // [^}]* is greedy but backtracks to let `\bname` match before the first `}`.
    // Parameter property names (`name: { ... }`) won't match because their
    // value is not a quoted string.
    const TOOL_FUNC_NAME_RE =
      /\bfunction\s*:\s*\{[^}]*\bname\s*:\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = TOOL_FUNC_NAME_RE.exec(body)) !== null) {
      foundNames.add(m[1]);
    }
  }

  return anyFactoryFound ? foundNames : null;
}

/**
 * Given source text and a canonical tool name set, returns the set of inline
 * tool names found in planner-tool-catalog mock factory bodies that are NOT
 * present in the canonical set.
 *
 * Exported separately from the canonical-set builder so unit tests can supply
 * a synthetic canonical set without reading real source files.
 *
 * Returns null when the file contains no inline factory mock.
 * Returns an empty Set when all inline names are recognised as canonical.
 */
export function staleInlineToolNamesInPlannerMock(
  contents: string,
  canonicalNames: ReadonlySet<string>,
): Set<string> | null {
  const found = extractInlineToolNamesFromPlannerMock(contents);
  if (found === null) return null;
  const stale = new Set<string>();
  for (const name of found) {
    if (!canonicalNames.has(name)) {
      stale.add(name);
    }
  }
  return stale;
}

/**
 * Elaine tool source files whose exported *_TOOL_NAME constants and inline
 * tool name strings are assembled into the planner/capability catalog via the
 * capability registry.  Defined at module scope so both buildCatalogToolNameSet
 * (Scan G), Scan I, and Scan J can share the same authoritative list.
 *
 * Exported so unit tests can verify real-file coverage without duplicating the
 * list.
 */
export const ELAINE_IMPORTED_TOOL_FILES: readonly string[] = [
  "artifacts/api-server/src/elaine/reminder-actions.ts",
  "artifacts/api-server/src/elaine/communication-actions.ts",
  "artifacts/api-server/src/elaine/universal-read-tools.ts",
  "artifacts/api-server/src/elaine/office-actions.ts",
  "artifacts/api-server/src/elaine/pottery-actions.ts",
  "artifacts/api-server/src/elaine/quilting-actions.ts",
  "artifacts/api-server/src/elaine/ornaments-actions.ts",
  "artifacts/api-server/src/elaine/universal-actions.ts",
  "artifacts/api-server/src/elaine/adaptive-actions.ts",
  "artifacts/api-server/src/elaine/app-operation-tools.ts",
];

/**
 * Build the canonical set of all valid tool name strings that may appear as
 * inline `name: "..."` values inside planner-tool-catalog mock tool objects.
 *
 * Reads real source files at scan time so that a tool rename is caught
 * immediately on the next CI run.  Includes:
 *
 *   1. String constant values from PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS
 *      (covers SOFT_TOOLS / SOFT_TOOLS_EXTRA entries that use exported constants).
 *   2. Inline `name: "..."` string literals from planner-tool-catalog.ts itself
 *      (ACTION_TOOLS entries are defined with string literals, not constants).
 *   3. Exported `_TOOL_NAME = "..."` constant values from imported elaine tool
 *      files assembled into the catalog via the capability registry
 *      (e.g. reminder-actions.ts, communication-actions.ts).
 *
 * Not exported — consumed only by the scan loop.  Tests use the exported
 * staleInlineToolNamesInPlannerMock function with a synthetic canonical set.
 */
function buildCatalogToolNameSet(): Set<string> {
  const names = new Set<string>();

  // 1. String constant values from PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS
  for (const entry of PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS) {
    if (entry.value) names.add(entry.value);
  }

  // 2. Inline `name: "..."` string literals from the real planner-tool-catalog.ts.
  //    Parameter property names use object values (`name: { type: "string" }`)
  //    and do not match `name:\s*"..."`, so this is safe.
  try {
    const catalogSource = read(
      "artifacts/api-server/src/elaine/planner-tool-catalog.ts",
    );
    const INLINE_NAME_RE = /\bname\s*:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = INLINE_NAME_RE.exec(catalogSource)) !== null) {
      names.add(m[1]);
    }
  } catch {
    // best-effort; catalog file should always be present
  }

  // 3. Both exported `_TOOL_NAME = "..."` constants AND inline `name: "..."`
  //    literals from every imported elaine tool file assembled into the catalog
  //    via the capability registry.  Many tools (e.g. create_reminder,
  //    update_pottery_item, call_contact) are defined as inline string literals
  //    inside ChatCompletionTool objects — not as exported *_TOOL_NAME constants
  //    — so both patterns must be captured.
  const IMPORTED_ELAINE_TOOL_FILES = ELAINE_IMPORTED_TOOL_FILES;
  // Pattern 1 – exported constant:  LIST_REMINDERS_TOOL_NAME = "list_reminders"
  const CONST_TOOL_NAME_RE = /_TOOL_NAME\s*=\s*"([^"]+)"/g;
  // Pattern 2 – inline object property:  name: "create_reminder"
  //   Same regex already used for planner-tool-catalog.ts above; safe because
  //   parameter property values use objects (`name: { type: "string" }`), not strings.
  const INLINE_NAME_RE_SRC = /\bname\s*:\s*"([^"]+)"/g;
  for (const file of IMPORTED_ELAINE_TOOL_FILES) {
    try {
      const src = read(file);
      const reConst = new RegExp(CONST_TOOL_NAME_RE.source, "g");
      let m: RegExpExecArray | null;
      while ((m = reConst.exec(src)) !== null) {
        names.add(m[1]);
      }
      const reInline = new RegExp(INLINE_NAME_RE_SRC.source, "g");
      while ((m = reInline.exec(src)) !== null) {
        names.add(m[1]);
      }
    } catch {
      // best-effort: file might not exist in all repo states
    }
  }

  return names;
}

/** Module-level canonical set, built once at scan startup from real source files. */
const CATALOG_TOOL_NAME_SET = buildCatalogToolNameSet();

const elaineTestFiles = walkFiles("artifacts/api-server/src/elaine", [
  ".ts",
]).filter((f) => f.endsWith(".test.ts"));

for (const file of elaineTestFiles) {
  const contents = read(file);
  const missing = missingPlannerToolCatalogMockKeys(contents);
  if (missing !== null && missing.size > 0) {
    violations.push(
      `${file}: vi.mock("./planner-tool-catalog") factory is missing ` +
        `${missing.size} required export(s): ${[...missing].sort().join(", ")}\n` +
        `  FIX: Use the shared factory — import { buildPlannerToolCatalogMock } from\n` +
        '       "./test-helpers/planner-tool-catalog-mock" and replace the inline block with\n' +
        '       vi.mock("./planner-tool-catalog", () => buildPlannerToolCatalogMock()).\n' +
        "       Pass test-specific values as overrides: buildPlannerToolCatalogMock({ ... }).\n" +
        "       When a new export is added to planner-tool-catalog.ts, add it to both\n" +
        "       buildPlannerToolCatalogMock in test-helpers/planner-tool-catalog-mock.ts AND\n" +
        "       PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in scripts/src/check-domain-composition.ts.",
    );
  }
  const wrong = wrongPlannerToolCatalogMockValues(contents);
  if (wrong !== null && wrong.size > 0) {
    const details = [...wrong.entries()]
      .map(([constName, value]) => `  - ${constName} ("${value}")`)
      .join("\n");
    violations.push(
      `${file}: vi.mock("./planner-tool-catalog") factory has ${wrong.size} wrong string value(s):\n${details}\n` +
        "  FIX: Update each listed constant's value to match the canonical export in\n" +
        "       planner-tool-catalog.ts.  Wrong values cause tool-dispatch routing in\n" +
        "       index.ts to silently fail — the test may pass while the real dispatch\n" +
        "       mismatch goes undetected.  When a tool name changes in planner-tool-catalog.ts,\n" +
        "       update the constant's string there AND the 'value' field for that key in\n" +
        "       PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in check-domain-composition.ts, then\n" +
        "       update PLANNER_TOOL_CATALOG_MOCK_DEFAULTS in test-helpers/planner-tool-catalog-mock.ts.",
    );
  }
  const stale = staleInlineToolNamesInPlannerMock(
    contents,
    CATALOG_TOOL_NAME_SET,
  );
  if (stale !== null && stale.size > 0) {
    violations.push(
      `${file}: vi.mock("./planner-tool-catalog") factory contains ${stale.size} stale inline tool name(s) in tool definition objects: ${[...stale].sort().join(", ")}\n` +
        "  FIX: Update each stale name string to match the current tool name in the real catalog.\n" +
        "       Stale inline names in SOFT_TOOLS/ACTION_TOOLS mock arrays cause the dispatch\n" +
        "       table in index.ts to silently miss the call — the test can pass while the\n" +
        "       real tool is never triggered.\n" +
        "       When a tool is renamed in planner-tool-catalog.ts or an imported tool file\n" +
        "       (reminder-actions.ts, communication-actions.ts, etc.), update every mock\n" +
        "       factory that uses the old name as an inline string in a tool object:\n" +
        "         { type: 'function', function: { name: 'old_name', ... } }",
    );
  }
  // ── Scan G (runtime extension): ./runtime mock completeness ─────────────
  const missingRuntime = missingRuntimeMockKeys(contents);
  if (missingRuntime !== null && missingRuntime.size > 0) {
    violations.push(
      `${file}: vi.mock("./runtime") factory is missing ` +
        `${missingRuntime.size} required export(s): ${[...missingRuntime].sort().join(", ")}\n` +
        `  FIX: Add each missing key to the vi.mock("./runtime", () => ({...}))\n` +
        "       factory in this file.  The required set mirrors what elaine/index.ts statically\n" +
        "       imports from ./runtime.  A missing key silently returns undefined at test time\n" +
        "       and can be swallowed by production try-catch blocks, causing spies to receive\n" +
        "       0 calls with no obvious error message.\n" +
        "       When a new export is added to the runtime module, update every mock factory\n" +
        "       AND add the key to RUNTIME_REQUIRED_EXPORTS in\n" +
        "       scripts/src/check-domain-composition.ts.",
    );
  }
  const wrongRuntime = wrongRuntimeMockValues(contents);
  if (wrongRuntime !== null && wrongRuntime.size > 0) {
    const details = [...wrongRuntime.entries()]
      .map(([constName, value]) => `  - ${constName} ("${value}")`)
      .join("\n");
    violations.push(
      `${file}: vi.mock("./runtime") factory has ${wrongRuntime.size} wrong string value(s):\n${details}\n` +
        "  FIX: Update each listed constant's value to match the canonical export in\n" +
        "       the runtime module.",
    );
  }
}

const elaineIndexPath = "artifacts/api-server/src/elaine/index.ts";
let elaineIndexSource: string | null = null;
try {
  elaineIndexSource = read(elaineIndexPath);
} catch {
  // violation reported below
}

if (elaineIndexSource === null) {
  violations.push(
    `${elaineIndexPath}: file not found or unreadable\n` +
      "  FIX: Scan H cannot verify PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS coverage without this file.",
  );
} else {
  const importedFromCatalog =
    extractPlannerToolCatalogImports(elaineIndexSource);
  const requiredSet = new Set<string>(
    PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered: string[] = [...importedFromCatalog].filter(
    (name) => !requiredSet.has(name),
  );
  if (uncovered.length > 0) {
    violations.push(
      `${elaineIndexPath}: imports ${uncovered.length} name(s) from ./planner-tool-catalog that are absent from PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS: ${uncovered.sort().join(", ")}\n` +
        "  FIX: Add each missing name to PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in\n" +
        "       scripts/src/check-domain-composition.ts.  Once listed, Scan G will\n" +
        "       automatically verify that every test mock also supplies the new export.",
    );
  }
}

// ── Scan I: exported *_TOOL_NAME constants must match a tool name: field ──────
//
// Every `export const FOO_TOOL_NAME = "some_name"` in an Elaine tool file
// acts as the single source of truth for that tool's dispatch name.  If the
// string value is changed without updating the matching tool definition (or
// vice versa), the capability registry registers the wrong name and the
// dispatcher silently misses calls — the model invokes the tool by one name,
// the router looks it up by another, and nothing happens.
//
// Detection strategy:
//   For each exported *_TOOL_NAME constant in a file, the constant is "in sync"
//   when the file also contains either:
//     (a) name: "value"     — the string literal appears as a tool name, OR
//     (b) name: CONST_NAME  — the constant is referenced directly in a tool object.
//   If neither pattern is present, the constant is flagged as orphaned / drifted.
//
// Covers every file in ELAINE_IMPORTED_TOOL_FILES (the same set used by
// buildCatalogToolNameSet) so that newly added tool files are included
// automatically.

/**
 * Extract all exported `*_TOOL_NAME` constant declarations from a source file.
 * Returns a Map from constant name to its string value.
 *
 * Handles both single-line and split-line declarations:
 *   export const FOO_TOOL_NAME = "some_value";
 *   export const BAR_TOOL_NAME =
 *     "some_value";
 *
 * Accepts both double-quoted and single-quoted string values.
 * Exported for unit tests.
 */
export function extractToolNameConstants(source: string): Map<string, string> {
  // \s* between `=` and the quoted value allows for a newline + indent.
  const re =
    /export\s+const\s+([A-Z][A-Z0-9_]*_TOOL_NAME)\s*=\s*["']([^"']+)["']/g;
  const result = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    result.set(m[1], m[2]);
  }
  return result;
}

/**
 * Given the source text of an Elaine tool file, returns a Map of
 * constant name → value for every exported `*_TOOL_NAME` constant whose
 * string value does NOT appear as a matching tool `name:` field anywhere
 * in the same file (neither as a string literal nor as a constant reference).
 *
 * A constant is considered "in sync" when the file contains EITHER:
 *   (a) `name: "value"` or `name: 'value'` — direct string literal, OR
 *   (b) `name: CONST_NAME`                 — the constant is used by reference.
 *
 * An empty Map means all constants are in sync with their tool definitions.
 * Exported for unit tests.
 */
export function findOrphanedToolNameConstants(
  source: string,
): Map<string, string> {
  const constants = extractToolNameConstants(source);
  const orphaned = new Map<string, string>();
  for (const [constName, value] of constants) {
    // Escape the value for safe regex use (tool names are snake_case but be
    // defensive).
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (a) String literal:   name: "value"  or  name: 'value'
    const literalRE = new RegExp(`\\bname\\s*:\\s*["']${escaped}["']`);
    // (b) Constant reference: name: CONST_NAME (with optional trailing whitespace/comma)
    const constRefRE = new RegExp(`\\bname\\s*:\\s*${constName}\\b`);
    if (!literalRE.test(source) && !constRefRE.test(source)) {
      orphaned.set(constName, value);
    }
  }
  return orphaned;
}

for (const file of ELAINE_IMPORTED_TOOL_FILES) {
  let src: string;
  try {
    src = read(file);
  } catch {
    violations.push(
      `${file}: file not found or unreadable\n` +
        "  FIX: Scan I cannot verify *_TOOL_NAME constant alignment without this file.",
    );
    continue;
  }
  const orphaned = findOrphanedToolNameConstants(src);
  if (orphaned.size > 0) {
    const details = [...orphaned.entries()]
      .map(([constName, value]) => `  - ${constName} ("${value}")`)
      .join("\n");
    violations.push(
      `${file}: ${orphaned.size} exported *_TOOL_NAME constant(s) have no matching ` +
        `tool name: field in the same file:\n${details}\n` +
        "  FIX: Make the constant's string value match the `name:` field in the\n" +
        "       corresponding tool definition object, or update the tool object's\n" +
        "       `name:` to use the constant by reference (name: FOO_TOOL_NAME).\n" +
        "       Both forms are accepted — the constant and the tool must agree.\n" +
        "       A mismatch means the capability registry registers the wrong name\n" +
        "       and the dispatcher silently misses calls from the model.",
    );
  }
}

/**
 * Extract action type discriminant strings from an action schema source file.
 *
 * Targets two forms of Zod discriminant:
 *   (a) String literal:   `type: z.literal("snake_case_value")`
 *   (b) Constant ref:     `type: z.literal(CONST_NAME)` — the constant's
 *       exported declaration in the SAME file is looked up and resolved.
 *
 * Exported for unit tests.
 */
export function extractActionTypeDiscriminants(source: string): Set<string> {
  const names = new Set<string>();
  const literalRE =
    /\btype\s*:\s*z\.literal\(\s*["']([a-z][a-z0-9_]*)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = literalRE.exec(source)) !== null) {
    names.add(m[1]);
  }
  const constRefRE = /\btype\s*:\s*z\.literal\(\s*([A-Z][A-Z0-9_]+)\s*\)/g;
  while ((m = constRefRE.exec(source)) !== null) {
    const constName = m[1];
    const constValueRE = new RegExp(
      `\\bexport\\s+const\\s+${constName}\\s*=\\s*["']([^"']+)["']`,
    );
    const valueMatch = constValueRE.exec(source);
    if (valueMatch) names.add(valueMatch[1]);
  }
  return names;
}

/**
 * Scan J inline-name detector — exported for unit tests.
 *
 * Returns true if `contents` contains at least one ChatCompletionTool-style
 * inline tool name definition, i.e. a `function: {` block whose first
 * named property is `name: "snake_case_name"`.
 *
 * Pattern rationale:
 *   - `function\s*:\s*\{` matches the object key that wraps OpenAI tool
 *     definitions (`function: { name: "...", description: "...", ... }`).
 *   - `\s*` between `{` and `name` matches only whitespace — the moment any
 *     non-whitespace character appears before `name` (another property, a
 *     closing brace, etc.) the pattern fails.  This bounds the match to the
 *     opening of the `function: {}` block and prevents spanning across object
 *     boundaries.
 *   - `\bname\s*:\s*"[a-z][a-z0-9_]*"` matches a string-valued name property
 *     whose value is a snake_case identifier — the canonical form for tool
 *     dispatch names.  Object-valued properties like `name: { type: "string" }`
 *     (Zod / JSON Schema parameter definitions) do NOT match.
 *
 * Bounding guarantee: `\s*` (not `[\s\S]*?`) between `{` and `name` ensures
 * the name property is the immediate first entry in the function block.  A
 * `function: {}` block with any other property before `name`, or one followed
 * later in the file by an unrelated `name: "value"`, will NOT match — no
 * cross-object false positives.
 *
 * The OpenAI ChatCompletionTool format always puts `name` as the FIRST
 * property inside `function: { name: "...", description: "...", parameters: {} }`,
 * so this constraint is correct for the target pattern.
 *
 * Does NOT flag files that use only `name: { type: "string" }` forms (those
 * are parameter schema definitions, not tool dispatch names).
 */
export function hasInlineToolNameDefinition(contents: string): boolean {
  // `\s*` (not `[\s\S]*?`) between `{` and `name` ensures the name property
  // is the immediate first entry in the function block — no cross-object leakage.
  const INLINE_TOOL_DEF_RE = /function\s*:\s*\{\s*name\s*:\s*"[a-z][a-z0-9_]*"/;
  return INLINE_TOOL_DEF_RE.test(contents);
}

/**
 * Given a map of elaine tool file paths → source contents and the current
 * ELAINE_IMPORTED_TOOL_FILES list, returns the paths of files that:
 *   (a) have a name ending in `-actions.ts` or `-tools.ts`, AND
 *   (b) define at least one tool name, either via an exported `*_TOOL_NAME`
 *       constant OR via an inline `function: { name: "..." }` tool definition
 *       object (detected by hasInlineToolNameDefinition), AND
 *   (c) are NOT in `importedList`.
 *
 * Exported for unit tests so the check can be exercised against synthetic
 * file maps without touching the real filesystem.
 *
 * @param filesWithContents - Map from workspace-relative file path to source.
 * @param importedList      - The current ELAINE_IMPORTED_TOOL_FILES list.
 * @returns Sorted array of unenrolled file paths.
 */
export function findUnregisteredElaineToolFiles(
  filesWithContents: Map<string, string>,
  importedList: readonly string[],
): string[] {
  const enrolled = new Set(importedList);
  const unenrolled: string[] = [];
  for (const [filePath, contents] of filesWithContents) {
    if (enrolled.has(filePath)) continue;
    // Only flag files named *-actions.ts or *-tools.ts
    if (!filePath.endsWith("-actions.ts") && !filePath.endsWith("-tools.ts"))
      continue;
    // Flag when the file defines tool names via exported constants OR inline definitions
    const constants = extractToolNameConstants(contents);
    if (constants.size > 0 || hasInlineToolNameDefinition(contents)) {
      unenrolled.push(filePath);
    }
  }
  return unenrolled.sort();
}

// Walk the elaine source directory and build the files-with-contents map.
const elaineActionToolFiles = walkFiles("artifacts/api-server/src/elaine", [
  ".ts",
]).filter(
  (f) =>
    (f.endsWith("-actions.ts") || f.endsWith("-tools.ts")) &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".spec.ts"),
);

const elaineActionToolContents = new Map<string, string>();
for (const f of elaineActionToolFiles) {
  try {
    elaineActionToolContents.set(f, read(f));
  } catch {
    // best-effort; unreadable files are not flagged here (Scan I will catch them)
  }
}

const unregistered = findUnregisteredElaineToolFiles(
  elaineActionToolContents,
  ELAINE_IMPORTED_TOOL_FILES,
);

for (const file of unregistered) {
  violations.push(
    `${file}: exports *_TOOL_NAME constants but is not listed in ELAINE_IMPORTED_TOOL_FILES\n` +
      "  FIX: Add this file to the ELAINE_IMPORTED_TOOL_FILES array in\n" +
      "       scripts/src/check-domain-composition.ts so that Scan G, Scan I,\n" +
      "       and buildCatalogToolNameSet() include its tool names in drift\n" +
      "       detection.  Without enrollment, renamed or orphaned constants in\n" +
      "       this file are silently ignored by every downstream guardrail.\n" +
      "       Add the entry in the SAME change that creates the new tool file.",
  );
}

const RESTRICTED_CHANNEL_CONFIG_PATH =
  "artifacts/api-server/src/elaine/restricted-channel-config.ts";

const PLANNER_TOOL_CATALOG_PATH =
  "artifacts/api-server/src/elaine/planner-tool-catalog.ts";

/**
 * Parse a named `readonly string[]` export from a TypeScript source file.
 * Block and line comments are stripped before extraction so a commented-out
 * entry does not falsely satisfy coverage.
 *
 * Returns `null` when the export is not found.
 * Exported for unit tests.
 */
export function extractStringArrayExport(
  source: string,
  exportName: string,
): string[] | null {
  const startIdx = source.indexOf(`export const ${exportName}`);
  if (startIdx === -1) return null;
  const eqIdx = source.indexOf("=", startIdx);
  if (eqIdx === -1) return null;
  const arrayStart = source.indexOf("[", eqIdx);
  if (arrayStart === -1) return null;
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }
  if (arrayEnd === -1) return null;
  const rawBody = source.slice(arrayStart + 1, arrayEnd);
  // Strip block comments first, then line comments.  Both must be removed so
  // that `/* "old_type" */` or `// "old_type"` cannot falsely satisfy coverage.
  const body = rawBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const values: string[] = [];
  const re = /["']([a-z][a-z0-9_]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) values.push(m[1]);
  return values;
}

/**
 * Extract action tool name strings from the ACTION_TOOLS array section of
 * planner-tool-catalog.ts source.
 *
 * Handles both literal names (`name: "snake_case"`) and constant references
 * (`name: SOME_TOOL_NAME_CONSTANT`) by resolving the constant's value from
 * the same source file.
 *
 * Exported for unit tests.
 */
export function extractActionToolNamesFromCatalogSection(
  source: string,
): Set<string> {
  const startMarker = "export const ACTION_TOOLS";
  const endMarker = "export const SOFT_TOOLS";
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) return new Set();
  const endIdx = source.indexOf(endMarker, startIdx);
  const section =
    endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx);
  const names = new Set<string>();
  let m: RegExpExecArray | null;

  // (a) Literal string: name: "snake_case_value"
  const literalRE = /\bname\s*:\s*["']([a-z][a-z0-9_]*)["']/g;
  while ((m = literalRE.exec(section)) !== null) names.add(m[1]);

  // (b) Constant reference: name: SOME_TOOL_NAME — resolve via export const in same file
  const constRefRE = /\bname\s*:\s*([A-Z][A-Z0-9_]+)\b/g;
  while ((m = constRefRE.exec(section)) !== null) {
    const constName = m[1];
    const constValueRE = new RegExp(
      `\\bexport\\s+const\\s+${constName}\\s*=\\s*["']([^"']+)["']`,
    );
    const valueMatch = constValueRE.exec(source);
    if (valueMatch) names.add(valueMatch[1]);
  }

  return names;
}

// ── Scan J: restricted-channel action-type coverage ──────────────────────────
{
  const restrictedConfigSource = (() => {
    try {
      return read(RESTRICTED_CHANNEL_CONFIG_PATH);
    } catch {
      violations.push(
        `${RESTRICTED_CHANNEL_CONFIG_PATH}: file not found or unreadable\n` +
          "  FIX: Restore the file or update RESTRICTED_CHANNEL_CONFIG_PATH in\n" +
          "       scripts/src/check-domain-composition.ts.",
      );
      return null;
    }
  })();

  if (restrictedConfigSource !== null) {
    const excludedList = extractStringArrayExport(
      restrictedConfigSource,
      "RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE",
    );
    const allowedList = extractStringArrayExport(
      restrictedConfigSource,
      "RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE",
    );

    if (excludedList === null) {
      violations.push(
        `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE export not found\n` +
          "  FIX: Ensure restricted-channel-config.ts exports a readonly string[] named\n" +
          "       RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE.",
      );
    }
    if (allowedList === null) {
      violations.push(
        `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE export not found\n` +
          "  FIX: Ensure restricted-channel-config.ts exports a readonly string[] named\n" +
          "       RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE.",
      );
    }

    if (excludedList !== null && allowedList !== null) {
      const excludedSet = new Set<string>();
      for (const name of excludedList) {
        if (excludedSet.has(name)) {
          violations.push(
            `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE contains duplicate entry "${name}"\n` +
              "  FIX: Remove the duplicate.",
          );
        }
        excludedSet.add(name);
      }
      const allowedSet = new Set<string>();
      for (const name of allowedList) {
        if (allowedSet.has(name)) {
          violations.push(
            `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE contains duplicate entry "${name}"\n` +
              "  FIX: Remove the duplicate.",
          );
        }
        allowedSet.add(name);
      }
      for (const name of excludedSet) {
        if (allowedSet.has(name)) {
          violations.push(
            `${RESTRICTED_CHANNEL_CONFIG_PATH}: "${name}" appears in both RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE and RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE\n` +
              "  FIX: Remove it from one of the two lists — each action type must appear in exactly one.",
          );
        }
      }
      const allKnownActionTypes = new Set<string>();
      for (const [, src] of elaineActionToolContents) {
        for (const name of extractActionTypeDiscriminants(src)) {
          allKnownActionTypes.add(name);
        }
      }
      try {
        const catalogSrc = read(PLANNER_TOOL_CATALOG_PATH);
        for (const name of extractActionToolNamesFromCatalogSection(
          catalogSrc,
        )) {
          allKnownActionTypes.add(name);
        }
      } catch {
        // best-effort
      }
      for (const name of allKnownActionTypes) {
        if (!excludedSet.has(name) && !allowedSet.has(name)) {
          violations.push(
            `${RESTRICTED_CHANNEL_CONFIG_PATH}: action type "${name}" is not enrolled in either ` +
              `RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE or RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE\n` +
              "  FIX: Add it to one of the two lists in restricted-channel-config.ts.\n" +
              "       RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE  — types the restricted channel may NOT perform.\n" +
              "       RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE   — types the restricted channel IS allowed to perform.\n" +
              "       Every action type must be in exactly one list so the channel-safety\n" +
              "       guardrail cannot silently skip it.",
          );
        }
      }
      const staleExcluded = [...excludedSet].filter(
        (n) => !allKnownActionTypes.has(n),
      );
      if (staleExcluded.length > 0) {
        violations.push(
          `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE contains ` +
            `${staleExcluded.length} type(s) not found in any action schema file or ACTION_TOOLS: ${staleExcluded.sort().join(", ")}\n` +
            "  FIX: If the action type was renamed, update both the schema file AND this list.\n" +
            "       If it was deleted, remove it from the list.",
        );
      }
      const staleAllowed = [...allowedSet].filter(
        (n) => !allKnownActionTypes.has(n),
      );
      if (staleAllowed.length > 0) {
        violations.push(
          `${RESTRICTED_CHANNEL_CONFIG_PATH}: RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE contains ` +
            `${staleAllowed.length} type(s) not found in any action schema file or ACTION_TOOLS: ${staleAllowed.sort().join(", ")}\n` +
            "  FIX: If the action type was renamed, update both the schema file AND this list.\n" +
            "       If it was deleted, remove it from the list.",
        );
      }
    }
  }
}

const PLANNER_MOCK_HELPER =
  "artifacts/api-server/src/elaine/test-helpers/planner-tool-catalog-mock.ts";
const RUNTIME_MOCK_HELPER =
  "artifacts/api-server/src/elaine/test-helpers/runtime-mock.ts";

{
  let helperContents: string;
  try {
    helperContents = read(PLANNER_MOCK_HELPER);
  } catch {
    violations.push(
      `${PLANNER_MOCK_HELPER}: file not found or unreadable\n` +
        "  FIX: Create the shared planner-tool-catalog mock helper that exports\n" +
        "       buildPlannerToolCatalogMock() and PLANNER_TOOL_CATALOG_MOCK_DEFAULTS.",
    );
    helperContents = "";
  }
  if (helperContents) {
    const missingKeys = missingPlannerMockHelperKeys(helperContents);
    if (missingKeys === null) {
      violations.push(
        `${PLANNER_MOCK_HELPER}: PLANNER_TOOL_CATALOG_MOCK_DEFAULTS export not found\n` +
          "  FIX: Export a const named PLANNER_TOOL_CATALOG_MOCK_DEFAULTS containing\n" +
          "       the canonical default values for every required planner-tool-catalog key.\n" +
          "       buildPlannerToolCatalogMock() should spread it: { ...PLANNER_TOOL_CATALOG_MOCK_DEFAULTS, ...overrides }.",
      );
    } else if (missingKeys.size > 0) {
      violations.push(
        `${PLANNER_MOCK_HELPER}: PLANNER_TOOL_CATALOG_MOCK_DEFAULTS is missing ${missingKeys.size} required key(s): ${[...missingKeys].sort().join(", ")}\n` +
          "  FIX: Add each missing key (with its canonical string value) to\n" +
          "       PLANNER_TOOL_CATALOG_MOCK_DEFAULTS in this file.\n" +
          "       The required set is defined by PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in\n" +
          "       scripts/src/check-domain-composition.ts.",
      );
    }
    const wrongValues = wrongPlannerMockHelperValues(helperContents);
    if (wrongValues !== null && wrongValues.size > 0) {
      const details = [...wrongValues.entries()]
        .map(([constName, value]) => `  - ${constName} ("${value}")`)
        .join("\n");
      violations.push(
        `${PLANNER_MOCK_HELPER}: PLANNER_TOOL_CATALOG_MOCK_DEFAULTS has ${wrongValues.size} wrong string value(s):\n${details}\n` +
          "  FIX: Update each listed value to match the canonical string in\n" +
          "       planner-tool-catalog.ts.  When a tool name changes, update the\n" +
          "       constant's string there AND the 'value' field for that key in\n" +
          "       PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in check-domain-composition.ts,\n" +
          "       then update PLANNER_TOOL_CATALOG_MOCK_DEFAULTS in this file.",
      );
    }
  }
}

{
  let helperContents: string;
  try {
    helperContents = read(RUNTIME_MOCK_HELPER);
  } catch {
    violations.push(
      `${RUNTIME_MOCK_HELPER}: file not found or unreadable\n` +
        "  FIX: Create the shared runtime mock helper that exports\n" +
        "       buildRuntimeMock() and RUNTIME_MOCK_DEFAULTS.",
    );
    helperContents = "";
  }
  if (helperContents) {
    const missingKeys = missingRuntimeMockHelperKeys(helperContents);
    if (missingKeys === null) {
      violations.push(
        `${RUNTIME_MOCK_HELPER}: RUNTIME_MOCK_DEFAULTS export not found\n` +
          "  FIX: Export a const named RUNTIME_MOCK_DEFAULTS containing\n" +
          "       the canonical default values for every required runtime key.\n" +
          "       buildRuntimeMock() should spread it: { ...RUNTIME_MOCK_DEFAULTS, ...overrides }.",
      );
    } else if (missingKeys.size > 0) {
      violations.push(
        `${RUNTIME_MOCK_HELPER}: RUNTIME_MOCK_DEFAULTS is missing ${missingKeys.size} required key(s): ${[...missingKeys].sort().join(", ")}\n` +
          "  FIX: Add each missing key (with its canonical value) to\n" +
          "       RUNTIME_MOCK_DEFAULTS in this file.\n" +
          "       The required set is defined by RUNTIME_REQUIRED_EXPORTS in\n" +
          "       scripts/src/check-domain-composition.ts.",
      );
    }
  }
}

/**
 * Extract all tool names referenced in `policies([...], ...)` calls in the
 * given source text.
 *
 * The first argument of every `policies()` call in capability-registry.ts is
 * a string array containing tool names.  The second argument is a policy
 * defaults object (not a string array), so this regex only captures the
 * first-argument bracket pair.
 *
 * Handles both single-line and multi-line array syntax:
 *   policies(["create_trip", "add_wishlist"], defaults)
 *   policies(
 *     [
 *       "create_trip",
 *       "add_wishlist",
 *     ],
 *     defaults,
 *   )
 *
 * Returns a deduplicated array of the extracted tool name strings.
 * Exported for unit tests.
 */
export function extractPolicyRowToolNames(source: string): string[] {
  // Match `policies(` then `[` (with optional whitespace) then capture
  // everything up to the first `]`.  `[^\]]*` (character class) matches any
  // character — including newlines — that is not `]`, so multi-line arrays
  // are handled correctly without needing the `s` flag.
  const POLICIES_RE = /\bpolicies\s*\(\s*\[([^\]]*)\]/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = POLICIES_RE.exec(source)) !== null) {
    // Extract every quoted snake_case string from the array contents.
    // Tool names are always snake_case (all lowercase + underscores).
    const TOOL_NAME_STR_RE = /["']([a-z][a-z0-9_]*)["']/g;
    let sm: RegExpExecArray | null;
    while ((sm = TOOL_NAME_STR_RE.exec(m[1])) !== null) {
      seen.add(sm[1]);
    }
  }
  return [...seen];
}

/**
 * Given a list of tool names extracted from POLICY_ROWS and the canonical set
 * of tool names defined in tool files, returns the subset of policy tool names
 * that have no corresponding definition.
 *
 * An empty array means all policy tool names are defined.
 * Exported for unit tests so a synthetic canonical set can be supplied without
 * reading real source files.
 */
export function findPhantomPolicyRowToolNames(
  policyToolNames: readonly string[],
  definedToolNames: ReadonlySet<string>,
): string[] {
  return policyToolNames.filter((name) => !definedToolNames.has(name));
}

const capabilityRegistryPath =
  "artifacts/api-server/src/elaine/capability-registry.ts";
let capabilityRegistrySource: string | null = null;
try {
  capabilityRegistrySource = read(capabilityRegistryPath);
} catch {
  // violation reported below
}

if (capabilityRegistrySource === null) {
  violations.push(
    `${capabilityRegistryPath}: file not found or unreadable\n` +
      "  FIX: Scan K cannot verify POLICY_ROWS tool name coverage without this file.",
  );
} else {
  const policyToolNames = extractPolicyRowToolNames(capabilityRegistrySource);
  const phantoms = findPhantomPolicyRowToolNames(
    policyToolNames,
    CATALOG_TOOL_NAME_SET,
  );
  if (phantoms.length > 0) {
    const listed = phantoms
      .sort()
      .map((p) => `    "${p}"`)
      .join("\n");
    violations.push(
      `${capabilityRegistryPath}: ${phantoms.length} tool name(s) in POLICY_ROWS have no ` +
        `corresponding definition in any Elaine tool file:\n${listed}\n` +
        '  FIX: Each name in a policies([...]) call must match a `name: "..."` field in\n' +
        "       one of the imported Elaine tool files (reminder-actions.ts,\n" +
        "       communication-actions.ts, universal-read-tools.ts, office-actions.ts,\n" +
        "       pottery-actions.ts, quilting-actions.ts, ornaments-actions.ts,\n" +
        "       universal-actions.ts, adaptive-actions.ts, app-operation-tools.ts)\n" +
        "       or in planner-tool-catalog.ts.\n" +
        "       A POLICY_ROW with no matching definition registers a capability that\n" +
        "       is never callable — the capability registry would enforce it at runtime,\n" +
        "       but a phantom entry in POLICY_ROWS means the tool name was either\n" +
        "       mistyped, renamed without updating the policy, or the tool file import\n" +
        "       was forgotten.  Add the tool definition or fix the tool name.",
    );
  }
}

export function extractRuntimeImports(source: string): string[] {
  const names: string[] = [];
  const importBlockRe =
    /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']\.\/runtime["']/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = importBlockRe.exec(source)) !== null) {
    if (blockMatch[1]) continue; // skip `import type { ... }`
    const block = blockMatch[2];
    // Split on commas, strip whitespace and inline `type` qualifiers
    const tokens = block
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tok of tokens) {
      const parts = tok.split(/\s+/);
      // Skip `type Foo` specifiers; keep plain names and `Foo as Bar` (use original)
      if (parts[0] === "type") continue;
      const name = parts[0];
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Given the full source text of a test file, returns a Map of required
 * runtime exports whose mock value does NOT match the canonical value.
 *
 * For structural parity with wrongPlannerToolCatalogMockValues.  Because
 * RUNTIME_REQUIRED_EXPORTS currently contains no `value` fields this function
 * always returns an empty Map when a factory is present, and `null` when no
 * factory is found.
 */
export function wrongRuntimeMockValues(
  contents: string,
): Map<string, { expected: string; got: string }> | null {
  const FACTORY_RE = /vi\.mock\((['"])\.\/runtime\1\s*,\s*\(\)\s*=>\s*\(\{/g;

  let anyFactoryFound = false;
  const allWrong = new Map<string, { expected: string; got: string }>();

  let match: RegExpExecArray | null;
  while ((match = FACTORY_RE.exec(contents)) !== null) {
    anyFactoryFound = true;
    void match;
  }

  return anyFactoryFound ? allWrong : null;
}

/**
 * Given the full source text of a test file, returns the set of required
 * export names that are absent from ANY inline `vi.mock("./runtime",
 * () => ({...}))` factory body in the file.
 *
 * Returns `null` when the file contains no inline factory mock for
 * `./runtime` (e.g. the module is not mocked at all, or only mocked via
 * `importActual`).
 */
export function missingRuntimeMockKeys(contents: string): Set<string> | null {
  const FACTORY_RE = /vi\.mock\((['"])\.\/runtime\1\s*,\s*\(\)\s*=>\s*\(\{/g;

  let anyFactoryFound = false;
  const allMissing = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = FACTORY_RE.exec(contents)) !== null) {
    anyFactoryFound = true;
    const bodyStart = match.index + match[0].length;

    const closingIdx = contents.indexOf("\n}));", bodyStart);
    const body =
      closingIdx === -1
        ? contents.slice(bodyStart)
        : contents.slice(bodyStart, closingIdx);

    for (const entry of RUNTIME_REQUIRED_EXPORTS) {
      if (!body.includes(`${entry.key}:`)) {
        allMissing.add(entry.key);
      }
    }
  }

  return anyFactoryFound ? allMissing : null;
}

export function extractRuntimeMockDefaultsBlock(source: string): string | null {
  const anchor = source.indexOf("export const RUNTIME_MOCK_DEFAULTS");
  if (anchor === -1) return null;
  const braceStart = source.indexOf("{", anchor);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null; // unmatched brace — malformed source
}
const runtimeElaineIndexPath = "artifacts/api-server/src/elaine/index.ts";
let runtimeElaineIndexSource: string | null = null;
try {
  runtimeElaineIndexSource = read(runtimeElaineIndexPath);
} catch {
  // violation reported below (same file as Scan H; if Scan H already reported
  // it, a second violation is not emitted here to avoid duplication)
}

if (runtimeElaineIndexSource !== null) {
  const importedFromRuntime = extractRuntimeImports(runtimeElaineIndexSource);
  const runtimeRequiredSet = new Set<string>(
    RUNTIME_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const runtimeUncovered = importedFromRuntime.filter(
    (name) => !runtimeRequiredSet.has(name),
  );

  if (runtimeUncovered.length > 0) {
    violations.push(
      `${runtimeElaineIndexPath}: ${runtimeUncovered.length} name(s) imported from ./runtime are absent from RUNTIME_REQUIRED_EXPORTS: ${runtimeUncovered.join(", ")}\n` +
        "  FIX: Add each name to the RUNTIME_REQUIRED_EXPORTS array in\n" +
        "       scripts/src/check-domain-composition.ts and supply a correct\n" +
        "       mock value so Scan G (runtime) tests can verify the mock.",
    );
  }
}

/**
 * Walk `source` starting at `startIndex`, tracking balanced parentheses while
 * lexically skipping string literals (`"…"`, `'…'`, `` `…` ``) and line/block
 * comments so that parens inside strings or comments do not skew the depth
 * counter.  Returns the index of the `)` that closes the outermost `(` opened
 * at or after `startIndex`.
 *
 * Template-literal expressions (`${…}`) are not recursed into — the factory
 * bodies we inspect are unlikely to contain complex nested template expressions
 * with unbalanced bare parens, so this limitation is acceptable.
 *
 * Exported for unit tests.
 */
export function findClosingParen(source: string, startIndex: number): number {
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let escaped = false;
  let i = startIndex;
  while (i < source.length) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\" && inString !== null) {
      escaped = true;
      i++;
      continue;
    }
    if (inString !== null) {
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    // Skip line comments — but only when not inside a string (already handled
    // above).  A `//' sequence here is always a real comment start.
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    // Skip block comments.
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (
        i + 1 < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      )
        i++;
      i += 2; // skip closing '*/'
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return source.length - 1; // unclosed — shouldn't happen in valid source
}

/**
 * Replace the *contents* of all string literals in `text` with empty markers
 * (keeping the surrounding quote characters) so that an identifier that
 * appears only inside a string cannot be found by a plain `.includes()`.
 *
 * Handles `"…"`, `'…'`, and `` `…` `` literals and `\"` / `\'` escapes.
 * Template expressions (`${…}`) are treated as opaque text and erased along
 * with the rest of the literal body.
 *
 * Exported for unit tests.
 */
export function eraseStringContents(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      out.push(ch); // opening quote
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2; // skip escape sequence
          continue;
        }
        if (text[i] === ch) break; // closing quote
        i++;
      }
      out.push(ch); // closing quote
      if (i < text.length) i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}
export function hasInlinedElaineLessonsMock(contents: string): boolean {
  // ── Step 1: lexically strip all comments from the full source so that:
  //   - A commented-out vi.mock call is never treated as active.
  //   - A factory name inside a comment (e.g. `// TODO: use elaineLessonsMockFactory`)
  //     cannot falsely satisfy the factory-reference check.
  // We use `findClosingParen`'s integrated comment-skipping logic by walking
  // the whole file and rebuilding without comment spans.  This avoids a plain
  // regex stripper that could misfire on `//` inside a URL string.
  const commentChars: string[] = [];
  {
    let inString: '"' | "'" | "`" | null = null;
    let escaped = false;
    let i = 0;
    while (i < contents.length) {
      const ch = contents[i];
      if (escaped) {
        escaped = false;
        commentChars.push(ch);
        i++;
        continue;
      }
      if (ch === "\\" && inString !== null) {
        escaped = true;
        commentChars.push(ch);
        i++;
        continue;
      }
      if (inString !== null) {
        if (ch === inString) inString = null;
        commentChars.push(ch);
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        commentChars.push(ch);
        i++;
        continue;
      }
      // Line comment: drop everything up to (but not including) the newline.
      if (ch === "/" && contents[i + 1] === "/") {
        while (i < contents.length && contents[i] !== "\n") i++;
        continue;
      }
      // Block comment: drop everything through the closing '*/'.
      if (ch === "/" && contents[i + 1] === "*") {
        i += 2;
        while (
          i + 1 < contents.length &&
          !(contents[i] === "*" && contents[i + 1] === "/")
        )
          i++;
        i += 2;
        continue;
      }
      commentChars.push(ch);
      i++;
    }
  }
  const withoutComments = commentChars.join("");

  // ── Step 2: locate ALL active vi.mock("../lib/elaine-lessons", …) calls.
  // Iterating every call prevents a compliant first mock from hiding a
  // violating second mock in the same file.
  const MOCK_RE = /vi\.mock\s*\(\s*["']\.\.\/lib\/elaine-lessons["']/g;
  let m: RegExpExecArray | null;
  let foundAnyMock = false;

  while ((m = MOCK_RE.exec(withoutComments)) !== null) {
    foundAnyMock = true;

    // ── Step 3: extract the full call using the lexical paren walker (handles
    // strings and comments inside the call body).
    const callEnd = findClosingParen(withoutComments, m.index);

    // ── Step 4: erase string contents from the call slice so a factory name
    // that appears only inside a string literal cannot satisfy the check.
    // Then verify the factory is used in a *return position*, not merely
    // referenced anywhere in the call body.  Valid return positions are:
    //
    //   (a) Direct 2nd argument:
    //         vi.mock("...", elaineLessonsMockFactory)
    //       → factory name immediately before the call's closing ")"
    //
    //   (b) Arrow-function returning a call:
    //         vi.mock("...", () => elaineLessonsMockFactory())
    //         vi.mock("...", () => (elaineLessonsMockFactory()))
    //       → factory name immediately follows "=>" (with optional whitespace / "(")
    //
    //   (c) Arrow-function returning an object with a spread:
    //         vi.mock("...", () => ({ ...elaineLessonsMockFactory() }))
    //       → factory name follows "..."
    //
    // Patterns deliberately excluded (bypass attempts):
    //   - `() => { elaineLessonsMockFactory(); return { inline }; }` — call
    //     result discarded, effective mock is inline
    //   - `() => ({ key: elaineLessonsMockFactory })` — identifier as a
    //     property value, not the spread/return source
    const callClean = eraseStringContents(
      withoutComments.slice(m.index, callEnd + 1),
    );
    const FACTORY_IN_RETURN_POSITION_RE =
      /(?:,\s*elaineLessonsMockFactory\s*\)|\.\.\.\s*elaineLessonsMockFactory\s*\(|=>\s*\(?\s*elaineLessonsMockFactory\s*\()/;
    if (!FACTORY_IN_RETURN_POSITION_RE.test(callClean)) return true;

    // Advance past this call so the next iteration finds a different mock.
    MOCK_RE.lastIndex = callEnd + 1;
  }

  if (!foundAnyMock) return false;

  // ── Step 5: require a *real named import* of elaineLessonsMockFactory from
  // exactly the canonical scaffold path.  This blocks bypasses where:
  //   - A local function is named elaineLessonsMockFactory.
  //   - The factory is imported from an unrelated module.
  //   - The import declaration is only present inside a comment.
  // Checked against the comment-stripped source so a commented-out canonical
  // import (e.g. `// import { elaineLessonsMockFactory } from "...scaffold"`)
  // cannot satisfy this gate and hide a local-definition bypass.
  const SCAFFOLD_IMPORT_RE =
    /import\s+\{[^}]*elaineLessonsMockFactory[^}]*\}\s+from\s+["']\.\/test-helpers\/standard-mock-scaffold["']/;
  return !SCAFFOLD_IMPORT_RE.test(withoutComments);
}

// ── Scan I (elaine-lessons): every vi.mock of elaine-lessons must use the scaffold ──

for (const file of elaineTestFiles) {
  const contents = read(file);
  if (hasInlinedElaineLessonsMock(contents)) {
    violations.push(
      `${file}: vi.mock("../lib/elaine-lessons") body is inlined instead of using the shared scaffold.\n` +
        "  FIX: Import elaineLessonsMockFactory from ./test-helpers/standard-mock-scaffold and\n" +
        '       replace the inline factory with: vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory()).\n' +
        "       For tests that need per-test overrides, spread the factory:\n" +
        '         vi.mock("../lib/elaine-lessons", () => ({ ...elaineLessonsMockFactory(), myKey: vi.fn() })).\n' +
        "       Using the scaffold keeps all Elaine test files in sync when the module's\n" +
        "       exports change.",
    );
  }
}

const UNIVERSAL_READ_TOOLS_PATH =
  "artifacts/api-server/src/elaine/universal-read-tools.ts";

try {
  const universalReadSource = read(UNIVERSAL_READ_TOOLS_PATH);
  const gaps = findUniversalReadDispatchGaps(universalReadSource);
  if (gaps.size > 0) {
    const details = [...gaps.entries()]
      .map(([constName, value]) => `  - ${constName} ("${value}")`)
      .join("\n");
    violations.push(
      `${UNIVERSAL_READ_TOOLS_PATH}: ${gaps.size} exported *_TOOL_NAME constant(s) have no` +
        ` matching dispatch branch in executeUniversalReadTool:\n${details}\n` +
        "  FIX: Add an \`if (name === CONST_NAME)\` branch inside executeUniversalReadTool\n" +
        "       for each listed constant.  A missing branch means Elaine silently\n" +
        "       receives null when she calls the tool — no error, no log entry, just\n" +
        "       an empty result the model cannot distinguish from 'no data found'.",
    );
  }
} catch {
  violations.push(
    `${UNIVERSAL_READ_TOOLS_PATH}: file not found or unreadable\n` +
      "  FIX: Ensure the file exists at the path above.",
  );
}

// ── Scan N: every executor prefix in POLICY_ROWS must be a known dispatch group ─
//
// Each policies([...], { executorPrefix: "X" }) call in POLICY_ROWS declares
// which dispatcher prefix routes calls for those tools.  If "X" does not
// correspond to a real executor group in the Elaine dispatch router
// (artifacts/api-server/src/elaine/index.ts), every tool call with that prefix
// is silently dropped at dispatch time — no error, no response.
//
// KNOWN_EXECUTOR_PREFIXES is the canonical enumeration of all executor groups
// that are actually registered in ACTION_EXECUTORS or handled by the inline
// hard-tool dispatch in index.ts.  When a new executor group is added:
//   1. Add the implementation in index.ts (or the appropriate action file).
//   2. Add the prefix here in the SAME change.
// This scan catches the "typo or rename on one side only" failure mode before
// it reaches production.

/**
 * Canonical set of executor prefix strings that have a real dispatcher
 * implementation in artifacts/api-server/src/elaine/index.ts.
 *
 * Prefixes are grouped by dispatch mechanism.  When a new executor group is
 * added to index.ts, add its prefix here in the same change.
 *
 * Exported for unit tests.
 */
export const KNOWN_EXECUTOR_PREFIXES: ReadonlySet<string> = new Set([
  // ── Spread into ACTION_EXECUTORS in index.ts ─────────────────────────────
  "travelAction", // TRAVEL_ACTION_EXECUTORS
  "potteryAction", // potteryActionExecutors
  "quiltingAction", // quiltingActionExecutors
  "ornamentAction", // ornamentActionExecutors
  "communicationAction", // communicationActionExecutors
  "reminderAction", // reminderActionExecutors
  "memoryAction", // universalActionExecutors (correct_memory, forget_memory)
  "researchTaskAction", // adaptiveActionExecutors (queue_research_task, cancel_elaine_task)
  // ── appOperation — executeAppOperationAction + discoverAppOperations ──────
  "appOperation",
  // ── Inline action dispatch in index.ts (not in a named executor object) ──
  "officeAction", // create_note, update_note, delete_note, send_email
  "notificationAction", // update_notification_state, bulk_update_notifications, update_notification_preferences
  "accountAction", // send_test_email, send_test_sms, send_phone_verification_code, verify_phone_code, update_elaine_settings
  "ownerAction", // update_app_config (owner-only)
  // ── Hard-tool (read/utility) inline dispatch in index.ts ─────────────────
  "travelRead", // search_trip_documents, search_flights, get_weather_forecast, find_nearby_places, …
  "widget", // show_trip_card, show_destination_card, show_data_card
  "collectionRead", // show_pottery_item, analyze_pottery_photo
  "quiltingRead", // show_fabric_swatch, calculate_yardage, analyze_fabric_photo
  "ornamentRead", // show_ornament_item, search_hallmark, lookup_product_barcode, analyze_ornament_photo, lookup_book_value, lookup_retail_value
  "officeRead", // list_notes, get_note (executeUniversalReadTool)
  "gmailRead", // summarize_inbox, find_emails_about_topic, get_email_detail (executeOfficeTool)
  "notificationRead", // list_notifications, get_notification_counts, get_notification_preferences (executeUniversalReadTool)
  "memory", // remember_household_fact (rememberElaineMemory)
  "lesson", // remember_lesson (recordElaineLesson)
  "memoryRead", // list_memories (executeUniversalReadTool)
  "researchTaskRead", // list_elaine_tasks, get_elaine_task (executeUniversalReadTool)
  "research", // web_search, fetch_page, consult_experts, ebay_search
  "documentGeneration", // generate_document (buildDocumentBuffer)
  "navigation", // suggest_navigation
  "settings", // set_action_confirmation_mode
  "adminRead", // check_integrations_health (getCachedHealthChecks)
  "reminderRead", // list_reminders (executeListRemindersTool)
  "communicationRead", // list_contact_channels, list_scheduled_contacts
]);

/**
 * Maps each action-class executor prefix to the JavaScript identifier of the
 * executor-map variable that is spread into ACTION_EXECUTORS in index.ts.
 *
 * Only the prefixes from the "Spread into ACTION_EXECUTORS" section of
 * KNOWN_EXECUTOR_PREFIXES are listed here — inline-dispatch and hard-tool
 * prefixes have no named executor-map variable and are excluded.
 *
 * Scan O uses this map to verify the reverse direction: every action-class
 * prefix in KNOWN_EXECUTOR_PREFIXES must still have a corresponding
 * ...executorVar spread inside ACTION_EXECUTORS in index.ts.  When an
 * executor variable is renamed or removed without updating this map, the
 * stale prefix passes Scan N silently — Scan O catches it.
 *
 * Exported for unit tests.
 */
export const ACTION_CLASS_EXECUTOR_MAP: ReadonlyMap<string, string> = new Map([
  ["travelAction", "TRAVEL_ACTION_EXECUTORS"],
  ["potteryAction", "potteryActionExecutors"],
  ["quiltingAction", "quiltingActionExecutors"],
  ["ornamentAction", "ornamentActionExecutors"],
  ["communicationAction", "communicationActionExecutors"],
  ["reminderAction", "reminderActionExecutors"],
  // memoryAction routes through universalActionExecutors (correct_memory, forget_memory)
  ["memoryAction", "universalActionExecutors"],
  // researchTaskAction routes through adaptiveActionExecutors (queue_research_task, cancel_elaine_task)
  ["researchTaskAction", "adaptiveActionExecutors"],
]);

// ── Scan N runner: every executor prefix in POLICY_ROWS must be a known dispatch group ─
if (capabilityRegistrySource !== null) {
  violations.push(
    ...scanNViolations(
      capabilityRegistrySource,
      KNOWN_EXECUTOR_PREFIXES,
      capabilityRegistryPath,
    ),
  );
}

// ── Scan O (action-executor reverse): every action-class prefix must still have a spread ─
//
// Tests may set CHECK_DOMAIN_SCAN_O_INDEX_PATH to a temp copy of index.ts that
// has a stale spread injected, so the e2e assertion never mutates the real file.
{
  const scanOIndexPathOverride = process.env["CHECK_DOMAIN_SCAN_O_INDEX_PATH"];
  const scanOSource =
    scanOIndexPathOverride != null
      ? (() => {
          try {
            return read(scanOIndexPathOverride);
          } catch {
            return null;
          }
        })()
      : elaineIndexSource;
  const scanOFilePath = scanOIndexPathOverride ?? elaineIndexPath;
  if (scanOSource !== null) {
    violations.push(
      ...scanOViolations(scanOSource, ACTION_CLASS_EXECUTOR_MAP, scanOFilePath),
    );
  }
}

/** All legacy-exempt inline mock files have been migrated. No entries remain. */
const INLINE_SENTRY_RATELIMIT_MOCK_LEGACY_EXEMPT = new Set<string>();

const LESSON_DOMAINS_SOURCE_PATH =
  "artifacts/api-server/src/lib/elaine-lessons.ts";
const LESSON_DOMAINS_MOCK_PATH =
  "artifacts/api-server/src/elaine/test-helpers/standard-mock-scaffold.ts";

const lessonDomainsSource = read(LESSON_DOMAINS_SOURCE_PATH);
const mockScaffoldSource = read(LESSON_DOMAINS_MOCK_PATH);

const canonicalDomains = extractStringArrayLiteral(
  lessonDomainsSource,
  "ELAINE_LESSON_DOMAINS = [",
);
const mockDomains = extractStringArrayLiteral(
  mockScaffoldSource,
  "ELAINE_LESSON_DOMAINS: [",
);

if (canonicalDomains === null) {
  violations.push(
    `${LESSON_DOMAINS_SOURCE_PATH}: could not extract ELAINE_LESSON_DOMAINS array literal\n` +
      "  FIX: Ensure ELAINE_LESSON_DOMAINS is declared as a direct array literal" +
      " assigned with '= ['.",
  );
} else if (mockDomains === null) {
  violations.push(
    `${LESSON_DOMAINS_MOCK_PATH}: could not extract ELAINE_LESSON_DOMAINS array` +
      " inside elaineLessonsMockFactory\n" +
      "  FIX: Ensure elaineLessonsMockFactory returns an object with a" +
      " ELAINE_LESSON_DOMAINS: [...] key.",
  );
} else {
  const canonicalSet = new Set(canonicalDomains);
  const mockSet = new Set(mockDomains);
  const missing = canonicalDomains.filter((d) => !mockSet.has(d));
  const extra = mockDomains.filter((d) => !canonicalSet.has(d));
  if (missing.length > 0 || extra.length > 0) {
    const lines: string[] = [
      `${LESSON_DOMAINS_MOCK_PATH}: elaineLessonsMockFactory's ELAINE_LESSON_DOMAINS` +
        " does not match the canonical list in lib/elaine-lessons.ts",
    ];
    if (missing.length > 0) {
      lines.push(
        `  Missing from mock: ${missing.map((d) => JSON.stringify(d)).join(", ")}`,
      );
    }
    if (extra.length > 0) {
      lines.push(
        `  Extra in mock:     ${extra.map((d) => JSON.stringify(d)).join(", ")}`,
      );
    }
    lines.push(
      "  FIX: Update the ELAINE_LESSON_DOMAINS array inside elaineLessonsMockFactory\n" +
        `       in ${LESSON_DOMAINS_MOCK_PATH}\n` +
        "       to exactly match the ELAINE_LESSON_DOMAINS constant in\n" +
        `       ${LESSON_DOMAINS_SOURCE_PATH}.\n` +
        "       The two lists must contain the same values (order is not checked).",
    );
    violations.push(lines.join("\n"));
  }
}

// ── Scan O runner: inline @sentry/node and rateLimit mock bodies ─────────────
//
// Iterates every Elaine test file, skips legacy-exempt paths, and pushes a
// violation for any file whose vi.mock("@sentry/node", …) or
// vi.mock("…/middleware/rateLimit", …) call does not delegate to the
// corresponding scaffold factory.

for (const file of elaineTestFiles) {
  if (INLINE_SENTRY_RATELIMIT_MOCK_LEGACY_EXEMPT.has(file)) continue;
  const contents = read(file);
  if (hasInlineSentryMock(contents)) {
    violations.push(
      `${file}: vi.mock("@sentry/node") has an inline factory body instead of delegating to the shared scaffold\n` +
        "  FIX: Import sentryMockFactory from the shared scaffold and delegate:\n" +
        '       import { sentryMockFactory } from "./test-helpers/standard-mock-scaffold";\n' +
        '       vi.mock("@sentry/node", () => sentryMockFactory());\n' +
        "       The canonical @sentry/node stub lives in standard-mock-scaffold.ts so that\n" +
        "       all Elaine test files stay in sync when the Sentry API changes.\n" +
        "       See artifacts/api-server/src/elaine/test-helpers/standard-mock-scaffold.ts.",
    );
  }
  if (hasInlineRateLimitMock(contents)) {
    violations.push(
      `${file}: vi.mock("../middleware/rateLimit") has an inline factory body instead of delegating to the shared scaffold\n` +
        "  FIX: Import rateLimitMockFactory from the shared scaffold and delegate:\n" +
        '       import { rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";\n' +
        '       vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());\n' +
        "       The canonical rateLimit stub lives in standard-mock-scaffold.ts so that\n" +
        "       all Elaine test files stay in sync when new limiters are added.\n" +
        "       See artifacts/api-server/src/elaine/test-helpers/standard-mock-scaffold.ts.",
    );
  }
}

// ── Scan P: gallery pages must use shared compare/multi-select primitives ──────
//
// CompareModal, CompareFloatingBar, and useMultiSelectMode were extracted from
// Pottery's gallery page into lib/collection-ui so that Quilting Fabrics,
// Patterns, Quilts, and Ornaments can reuse the same interaction model without
// copy-pasting.
//
// A new gallery page that hand-rolls its own compare mode (boolean toggle) AND
// selected-IDs array state is reimplementing what useMultiSelectMode already
// provides — the exact duplication this project's "always consolidate into shared
// libs" convention is meant to prevent.
//
// Scope: files under */pages/** within artifacts/modules/src/ and
// artifacts/web/src/ — gallery collection pages always live under a pages/
// subdirectory, so this avoids false-positives from component or utility files
// that might happen to share unrelated state shapes.
//
// The Set<number> variant used in maintenance/bulk-delete pages is NOT flagged:
// those use useState<Set<number>>(new Set()) which is a different pattern with a
// different purpose (checkbox bulk-delete, not compare side-by-side).
//
// Pottery's collection page is the gold-standard ORIGINAL and is explicitly
// exempt — the shared hook was extracted FROM it, so it deliberately keeps its
// own hand-written implementation by design (noted in compare-modal.tsx).
//

/**
 * Returns true when `pos` falls inside an open single-quoted or double-quoted
 * string literal in `source`, scanning from the start and tracking quote state.
 * Used by `hasNamedCollectionUIImport` to exclude import-shaped text that
 * appears inside a string value rather than as a real top-level import.
 *
 * Template literals (backtick strings) are not tracked because real import
 * declarations cannot appear inside them in valid TypeScript.
 */
function isInsideStringContext(source: string, pos: number): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < pos; i++) {
    const ch = source[i];
    // Skip the character after a backslash escape inside a string.
    if (ch === "\\" && (inSingle || inDouble)) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    }
  }
  return inSingle || inDouble;
}

/**
 * Returns true when `source` contains a real named import of `exportName` from
 * `@workspace/collection-ui` (not a raw substring — comments and string-
 * embedded pseudo-imports are both excluded).
 *
 * Two-phase strategy:
 *   1. Strip `//` and `/* * /` comments first so that a commented-out import
 *      declaration is not mistaken for a real one.
 *   2. Run the import regex against the comment-stripped source (preserving the
 *      module-specifier string so the `from "@workspace/collection-ui"` literal
 *      can still be matched by the regex).
 *   3. For each regex match, verify the match position is NOT inside a string
 *      literal (using `isInsideStringContext`), so a const whose value looks
 *      like an import statement does not satisfy the check.
 *
 * Why NOT stripAllStringLiteralContent: that utility erases the content of ALL
 * string literals, including the `"@workspace/collection-ui"` specifier in the
 * real import itself — making the regex unable to recognise any genuine import.
 */
function hasNamedCollectionUIImport(
  source: string,
  exportName: string,
): boolean {
  // Strip only comments so commented-out imports are ignored but the module
  // specifier in real imports remains intact for the regex.
  const noComments = stripSourceComments(source);

  // Matches: import { ..., exportName, ... } from "@workspace/collection-ui"
  // Skips:   import type { ... }  (type-only imports)
  const re =
    /import(?!\s+type)\s*\{([^}]*)\}\s*from\s*['"]@workspace\/collection-ui['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) {
    // Reject a match whose start position is inside a string literal —
    // this handles const values like `'import { X } from "..."'`.
    if (isInsideStringContext(noComments, m.index)) continue;

    for (const raw of m[1].split(",")) {
      const trimmed = raw.trim();
      // Skip per-specifier type-only specifiers: `type X` or `type X as Y`.
      // These carry no runtime value and must not satisfy the import check,
      // even though the whole import { } block is not type-only.
      if (/^type\s+/.test(trimmed)) continue;
      const name = trimmed
        .replace(/\s+as\s+\S+$/, "") // strip `as Alias` suffix
        .trim();
      if (name === exportName) return true;
    }
  }
  return false;
}

/**
 * Scan P detector — exported for unit tests.
 * Returns true if the source hand-rolls a compare/multi-select mode
 * (boolean mode toggle + number-array selected-IDs state) without a real
 * named import of useMultiSelectMode from @workspace/collection-ui.
 *
 * A comment or string containing "useMultiSelectMode" does NOT satisfy the
 * check — only an actual named import in an import { } block does.
 *
 * The Set<number> variant used in maintenance/bulk-delete pages is NOT flagged
 * (those use useState<Set<number>>(new Set()) — a different pattern).
 */
export function hasInlineMultiSelectMode(contents: string): boolean {
  if (hasNamedCollectionUIImport(contents, "useMultiSelectMode")) return false;
  // Note: returning false here does NOT mean the page is fully compliant —
  // hasMissingCompareUIImports is a separate check that runs in addition.

  // Strip comments before checking for state patterns so that commented-out
  // legacy code cannot cause a false violation (e.g. a file migrating to the
  // shared hook that leaves old state declarations in a comment block).
  const stripped = stripSourceComments(contents);

  // A boolean mode-active state whose name contains compare/select/bulk + Mode.
  // Matches: const [compareMode, setCompareMode] = useState(false)
  //          const [selectMode, setSelectMode] = useState<boolean>(false)
  //          const [bulkMode, setBulkMode] = useState(false)
  const hasModeBoolState =
    /const \[[a-zA-Z]*(?:compare|select|bulk)[a-zA-Z]*[Mm]ode[a-zA-Z]*,\s*set[A-Za-z]+\]\s*=\s*useState(?:<boolean>)?\(false\)/.test(
      stripped,
    );

  // A number-array (not Set<number>) selected-IDs state.
  // Matches: const [selectedIds, setSelectedIds] = useState<number[]>([])
  //          const [compareIds, setCompareIds] = useState<number[]>([])
  const hasSelectedIdsArrayState =
    /const \[[a-zA-Z]*[Ss]elected[A-Za-z]*[Ii]d[sa-zA-Z]*,\s*set[A-Za-z]+\]\s*=\s*useState<(?:number|string)\[\]>/.test(
      stripped,
    );

  return hasModeBoolState && hasSelectedIdsArrayState;
}

/**
 * Scan P partial-adoption detector — exported for unit tests.
 *
 * Returns true when the source *calls* useMultiSelectMode (an actual invocation
 * `useMultiSelectMode(`, not just an import) but does NOT import both
 * `CompareModal` AND `CompareFloatingBar` from \@workspace/collection-ui.
 *
 * This catches the "hook adopted but compare UI hand-rolled" drift pattern:
 * a developer copies a gallery page, keeps `useMultiSelectMode`, but
 * substitutes a local dialog for `CompareModal` or a local action bar for
 * `CompareFloatingBar`.  Because `hasInlineMultiSelectMode` returns early on
 * any real useMultiSelectMode import, this complementary check is required to
 * enforce full adoption of all three shared primitives.
 *
 * A page that does NOT call useMultiSelectMode at all is not flagged — it
 * either has no compare/select UI or is caught by hasInlineMultiSelectMode.
 */
export function hasMissingCompareUIImports(contents: string): boolean {
  const stripped = stripSourceComments(contents);

  // The hook must be *called* (not just imported) to trigger this check.
  // This also prevents a bare unused-import from counting as adoption.
  if (!/\buseMultiSelectMode\s*\(/.test(stripped)) return false;

  // The hook is in active use — both companion primitives are required.
  return (
    !hasNamedCollectionUIImport(contents, "CompareModal") ||
    !hasNamedCollectionUIImport(contents, "CompareFloatingBar")
  );
}

/**
 * Pottery's gallery page is the gold-standard original implementation that
 * predates the shared hook.  useMultiSelectMode was extracted FROM it, so
 * it is explicitly exempt from this scan by design.
 */
const MULTI_SELECT_MODE_LEGACY_EXEMPT = new Set([
  "artifacts/modules/src/pottery/pages/collection.tsx",
]);

// Scope: gallery collection pages live under */pages/ subdirectories.
// Narrowing to /pages/ prevents false-positives from component or utility files
// that share unrelated boolean + number-array state shapes.
const galleryPageSourceFiles = allSourceFiles.filter(
  (f) =>
    f.endsWith(".tsx") &&
    (f.startsWith("artifacts/modules/src/") ||
      f.startsWith("artifacts/web/src/")) &&
    f.includes("/pages/"),
);

for (const file of galleryPageSourceFiles) {
  if (MULTI_SELECT_MODE_LEGACY_EXEMPT.has(file)) continue;
  const contents = read(file);

  // Check 1: hand-rolled boolean mode + number-array state without the hook.
  if (hasInlineMultiSelectMode(contents)) {
    violations.push(
      `${file}: hand-rolls compare/multi-select state (boolean mode toggle +\n` +
        `  number-array selectedIds) instead of using the shared primitives\n` +
        "  FIX: Import useMultiSelectMode, CompareModal, and CompareFloatingBar from\n" +
        "       @workspace/collection-ui.  These were extracted from Pottery's gallery\n" +
        "       page so that every collection gallery reuses the same interaction model\n" +
        "       without copy-pasting the boolean-mode + array-state combination.\n" +
        "       See artifacts/modules/src/ornaments/pages/collection.tsx for a reference\n" +
        "       implementation that uses all three shared exports correctly.",
    );
  }

  // Check 2: hook is called but CompareModal/CompareFloatingBar are missing —
  // catches partial adoption where the hook was kept but the compare UI was
  // hand-rolled (or the developer copied a template and replaced the modal with
  // a local component).
  if (hasMissingCompareUIImports(contents)) {
    violations.push(
      `${file}: calls useMultiSelectMode but does not import both CompareModal\n` +
        "  and CompareFloatingBar from @workspace/collection-ui.\n" +
        "  FIX: Gallery pages must use all three shared compare/select primitives\n" +
        "       together — useMultiSelectMode, CompareModal, and CompareFloatingBar.\n" +
        "       A hand-rolled compare dialog or action bar is the exact drift this\n" +
        "       guard prevents.  See artifacts/modules/src/ornaments/pages/collection.tsx\n" +
        "       for a reference implementation that imports all three correctly.",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

// ── Scan M helper functions ───────────────────────────────────────────────────
// Exported at module scope so unit tests can import them without running the
// top-level scan code.  Function declarations are hoisted in ESM, so placing
// them after the scan blocks does not affect their availability above.

/**
 * Strip line comments (`// ...`) and block comments (`/* ... *\/`) from
 * source text, preserving newlines so that line count is not disturbed.
 *
 * Used to prevent pattern-matching from being tricked by commented-out code,
 * e.g. `// if (name === GET_NOTE_TOOL_NAME)` must NOT satisfy a dispatch check.
 *
 * Exported for unit tests.
 */
export function stripSourceComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Replace the character content of single-quoted and double-quoted string
 * literals with spaces so that unbalanced curly braces inside strings do not
 * corrupt brace counting, and patterns embedded in string values cannot satisfy
 * code-structure checks.
 *
 * Exported for unit tests.
 */
export function stripSimpleStringLiterals(source: string): string {
  return source
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => '"' + " ".repeat(m.length - 2) + '"')
    .replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");
}

/**
 * Replace the character content of template literals with spaces.
 *
 * The regex does not handle nested template expressions (`${`inner`}`)
 * but is sufficient to prevent patterns embedded in template strings from
 * satisfying the dispatch-gap check.
 *
 * Exported for unit tests.
 */
export function stripTemplateLiterals(source: string): string {
  return source.replace(
    /`(?:[^`\\]|\\.)*`/g,
    (m) => "`" + " ".repeat(m.length - 2) + "`",
  );
}

/**
 * Strip all string-literal content (single-quoted, double-quoted, and
 * template literals) from source text.
 *
 * Exported for unit tests.
 */
export function stripAllStringLiteralContent(source: string): string {
  return stripTemplateLiterals(stripSimpleStringLiterals(source));
}

/**
 * Extract the full body of `executeUniversalReadTool` from a source file using
 * brace-counting on a sanitized (comment-stripped, all-string-content-stripped)
 * copy of the source, so that braces inside comments or any string form do not
 * corrupt the function-body boundary.
 *
 * Returns null when the function declaration is not found or when its braces
 * are unbalanced (malformed source).
 *
 * Exported for unit tests.
 */
export function extractUniversalReadDispatchBody(
  source: string,
): string | null {
  // Match the exported async function declaration (export keyword is optional
  // — the function may be exported separately).
  const anchor = source.indexOf("function executeUniversalReadTool(");
  if (anchor === -1) return null;
  const braceStart = source.indexOf("{", anchor);
  if (braceStart === -1) return null;

  // Build a sanitized copy for brace counting: comments and all string-literal
  // content are blanked out so their curly braces don't shift depth.
  // The sanitized copy is the same length as the original — slicing the
  // original at the found index always returns the correct body.
  const sanitized = stripAllStringLiteralContent(stripSourceComments(source));

  let depth = 0;
  for (let i = braceStart; i < sanitized.length; i++) {
    if (sanitized[i] === "{") {
      depth++;
    } else if (sanitized[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null; // unmatched brace
}

/**
 * Given the full source of `universal-read-tools.ts`, returns a Map of
 * exported `*_TOOL_NAME` constants that do NOT have a matching dispatch branch
 * in `executeUniversalReadTool`.
 *
 * A dispatch branch is recognised ONLY in the constant-reference form:
 *   `name === CONST_NAME`  (with word boundaries on both identifiers)
 *
 * The string-literal form (`name === "value"`) is intentionally NOT supported:
 * it is unverifiable after necessary string stripping, and dispatch branches
 * in this codebase always reference the exported constant, not the raw string.
 *
 * Pattern matching is performed on a fully-sanitized copy of the body (comments
 * and ALL string-literal content stripped — single-quoted, double-quoted, and
 * template literals) so that patterns embedded in comments or string values
 * cannot masquerade as real dispatch branches.
 *
 * An empty Map means every constant is handled.
 * When `executeUniversalReadTool` cannot be found, every constant is reported
 * as a gap so the missing function itself is surfaced.
 *
 * Note: `extractToolNameConstants` targets `export const` declarations.
 * Constants re-exported via a separate `export { NAME }` statement are not
 * covered — in practice universal-read-tools.ts always uses inline `export const`.
 *
 * Exported for unit tests.
 */
export function findUniversalReadDispatchGaps(
  source: string,
): Map<string, string> {
  const constants = extractToolNameConstants(source);
  const rawBody = extractUniversalReadDispatchBody(source);
  const gaps = new Map<string, string>();

  // Sanitize fully: strip comments first, then all string-literal content.
  // This ensures that:
  //   • `// if (name === FOO_TOOL_NAME)` (line comment)           → not satisfied
  //   • `/* name === FOO_TOOL_NAME */`   (block comment)          → not satisfied
  //   • `throw new Error("name === FOO_TOOL_NAME")` (double-quot) → not satisfied
  //   • throw new Error(`name === FOO_TOOL_NAME`)  (template lit) → not satisfied
  const sanitizedBody =
    rawBody !== null
      ? stripAllStringLiteralContent(stripSourceComments(rawBody))
      : null;

  for (const [constName, value] of constants) {
    if (sanitizedBody === null) {
      // Function not found — every constant is a gap.
      gaps.set(constName, value);
      continue;
    }

    // Constant-reference form only: `\bname\s*===\s*CONST_NAME\b`
    // Word boundaries prevent `toolname === CONST` from matching.
    const byRefRE = new RegExp(`\\bname\\s*===\\s*${constName}\\b`);
    if (!byRefRE.test(sanitizedBody)) {
      gaps.set(constName, value);
    }
  }
  return gaps;
}

/**
 * Given a list of executor prefixes extracted from POLICY_ROWS and the canonical
 * set of known valid executor prefixes, returns the subset of policy prefixes
 * that have no corresponding dispatcher implementation.
 *
 * An empty array means all policy prefixes are known.
 * Exported for unit tests so a synthetic known set can be supplied without
 * reading real source files.
 */
export function findPhantomExecutorPrefixes(
  policyPrefixes: readonly string[],
  knownPrefixes: ReadonlySet<string>,
): string[] {
  return policyPrefixes.filter((p) => !knownPrefixes.has(p));
}

/**
 * Extract all distinct `executorPrefix` values from `policies([...], {...})`
 * calls in the given source text (typically capability-registry.ts).
 *
 * Handles both single-quoted and double-quoted prefix strings and ignores
 * whitespace variations.
 *
 * Returns a deduplicated array of the extracted prefix strings.
 * Exported for unit tests.
 */
export function extractPolicyRowExecutorPrefixes(source: string): string[] {
  // Match the key `executorPrefix` followed by a colon and a quoted camelCase value.
  // Prefix identifiers begin with a lowercase letter and contain only letters/digits.
  const PREFIX_RE = /\bexecutorPrefix\s*:\s*["']([a-zA-Z][a-zA-Z0-9]*)["']/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PREFIX_RE.exec(source)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}

/**
 * Core logic for Scan N: given the text of capability-registry.ts and the
 * canonical known-prefix set, return any violation strings that should be
 * pushed into the violations array.
 *
 * Extracted as a pure, testable helper so unit tests can verify the full
 * violation message without touching the filesystem or running the complete
 * script.  An empty array means no phantom prefixes were found.
 *
 * Exported for unit tests.
 */
export function scanNViolations(
  source: string,
  knownPrefixes: ReadonlySet<string>,
  filePath: string,
): string[] {
  const policyPrefixes = extractPolicyRowExecutorPrefixes(source);
  const phantoms = findPhantomExecutorPrefixes(policyPrefixes, knownPrefixes);
  if (phantoms.length === 0) return [];
  const listed = phantoms
    .sort()
    .map((p) => `    "${p}"`)
    .join("\n");
  return [
    `${filePath}: ${phantoms.length} executor prefix(es) in POLICY_ROWS have no ` +
      `corresponding dispatch group in the Elaine router (artifacts/api-server/src/elaine/index.ts):\n${listed}\n` +
      '  FIX: Each executorPrefix value in policies([...], { executorPrefix: "X" }) must\n' +
      "       appear in KNOWN_EXECUTOR_PREFIXES in scripts/src/check-domain-composition.ts.\n" +
      "       A phantom prefix means either:\n" +
      "         (a) the prefix was mistyped — fix it to match a real dispatcher group, OR\n" +
      "         (b) a new executor group was added in index.ts — also add its prefix to\n" +
      "             KNOWN_EXECUTOR_PREFIXES in the SAME change as the executor implementation.\n" +
      "       Without a matching dispatcher, every call to tools with this prefix is\n" +
      "       silently dropped at runtime with no error and no response.",
  ];
}

export function missingRuntimeMockHelperKeys(
  source: string,
): Set<string> | null {
  const block = extractRuntimeMockDefaultsBlock(source);
  if (block === null) return null;
  const missing = new Set<string>();
  for (const { key } of RUNTIME_REQUIRED_EXPORTS) {
    if (!block.includes(`${key}:`)) missing.add(key);
  }
  return missing;
}

/**
 * Extract the set of identifier names that are spread into the ACTION_EXECUTORS
 * object literal in index.ts.  Locates the `const ACTION_EXECUTORS` declaration,
 * extracts its initializer body with brace-counting (using a sanitized copy to
 * avoid being tricked by braces inside comments or string literals), then
 * collects every `...IDENTIFIER` spread element found in that body.
 *
 * Returns an empty Set when ACTION_EXECUTORS cannot be located or its brace
 * structure is malformed.
 *
 * Exported for unit tests.
 */
export function extractActionExecutorSpreads(source: string): Set<string> {
  const constIdx = source.indexOf("const ACTION_EXECUTORS");
  if (constIdx === -1) return new Set();
  const assignIdx = source.indexOf("=", constIdx);
  if (assignIdx === -1) return new Set();
  const braceStart = source.indexOf("{", assignIdx);
  if (braceStart === -1) return new Set();

  // Sanitize for reliable brace-counting: comments and string literals may
  // contain { } that would corrupt the depth counter.  These helpers preserve
  // string length so the source-slice indices remain valid.
  const sanitized = stripAllStringLiteralContent(stripSourceComments(source));

  let depth = 0;
  let bodyEnd = -1;
  for (let i = braceStart; i < sanitized.length; i++) {
    if (sanitized[i] === "{") {
      depth++;
    } else if (sanitized[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }

  const body =
    bodyEnd !== -1
      ? source.slice(braceStart, bodyEnd + 1)
      : source.slice(braceStart);

  // Sanitize the body before running the spread regex so that `...patterns`
  // inside comments or string literals are not mistakenly captured as real
  // spread elements.
  const sanitizedBody = stripAllStringLiteralContent(stripSourceComments(body));

  // Collect every ...IDENTIFIER spread element from the sanitized body.
  const SPREAD_RE = /\.\.\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SPREAD_RE.exec(sanitizedBody)) !== null) {
    names.add(m[1]);
  }
  return names;
}
/**
 * Extract a flat string-array literal from a source file by locating `anchor`
 * and then bracket-counting to find the matching `]`.
 *
 * Returns the ordered list of quoted string values found inside the array, or
 * null when the anchor is absent or the brackets are unmatched.
 *
 * Exported for unit tests.
 */
export function extractStringArrayLiteral(
  source: string,
  anchor: string,
): string[] | null {
  const anchorIdx = source.indexOf(anchor);
  if (anchorIdx === -1) return null;
  const bracketStart = source.indexOf("[", anchorIdx);
  if (bracketStart === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = bracketStart; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const body = source.slice(bracketStart + 1, end);
  const STRING_RE = /["']([^"'\\]+)["']/g;
  const values: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = STRING_RE.exec(body)) !== null) {
    values.push(m[1]);
  }
  return values;
}

/**
 * Compare the canonical ELAINE_LESSON_DOMAINS list from elaine-lessons.ts
 * against the hard-coded array inside elaineLessonsMockFactory in
 * standard-mock-scaffold.ts.
 *
 * Returns `{ missing, extra }` where:
 *   - `missing` — domains present in the canonical list but absent from the mock
 *   - `extra`   — domains present in the mock but absent from the canonical list
 *
 * Both arrays are empty when the two lists are perfectly in sync.
 *
 * Returns null when either array cannot be extracted from the supplied source
 * text (extraction failure is reported as a separate violation by the inline
 * Scan O block).
 *
 * Exported for unit tests.
 */
export function diffElaineLessonDomainsMock(
  lessonDomainsSource: string,
  mockScaffoldSource: string,
): { missing: string[]; extra: string[] } | null {
  const canonical = extractStringArrayLiteral(
    lessonDomainsSource,
    "ELAINE_LESSON_DOMAINS = [",
  );
  const mock = extractStringArrayLiteral(
    mockScaffoldSource,
    "ELAINE_LESSON_DOMAINS: [",
  );
  if (canonical === null || mock === null) return null;
  const canonicalSet = new Set(canonical);
  const mockSet = new Set(mock);
  return {
    missing: canonical.filter((d) => !mockSet.has(d)),
    extra: mock.filter((d) => !canonicalSet.has(d)),
  };
}

/**
 * Given the action-class prefix → executor-variable map and the set of
 * identifiers actually spread into ACTION_EXECUTORS, return the prefixes
 * whose executor variable is no longer present in the spread.
 *
 * An empty array means every action-class prefix is still backed by a real
 * spread in ACTION_EXECUTORS.
 *
 * Exported for unit tests.
 */
export function findStaleActionClassPrefixes(
  knownMap: ReadonlyMap<string, string>,
  spreads: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const [prefix, executorVar] of knownMap) {
    if (!spreads.has(executorVar)) {
      stale.push(prefix);
    }
  }
  return stale;
}
/**
 * Scan O detector — exported for unit tests.
 *
 * Returns true if the source contains a `vi.mock("@sentry/node", …)` call
 * whose factory body is defined inline — i.e. the mock call does NOT delegate
 * to `sentryMockFactory()` from the shared scaffold as its factory argument.
 *
 * Detection strategy:
 *   1. Check whether any `vi.mock("@sentry/node"` call exists at all (if not,
 *      return false immediately — the file is clean).
 *   2. Check whether the call uses the correct delegation form:
 *        vi.mock("@sentry/node", () => sentryMockFactory())
 *      `\s*` in the regex matches across newlines, so multi-line delegations
 *      are accepted.
 *   3. If (1) is true but (2) is false, the factory is inline → return true.
 *
 * This approach validates the factory of the specific `vi.mock` call rather
 * than searching file-wide text, so a file that contains `sentryMockFactory()`
 * somewhere else (e.g. an import statement or a comment) but still has an
 * inline mock body is correctly flagged.
 *
 * A file that does not mock "@sentry/node" at all returns false.
 */
export function hasInlineSentryMock(contents: string): boolean {
  // Count how many times @sentry/node is mocked.
  const MOCK_PRESENT_RE = /vi\.mock\s*\(\s*["']@sentry\/node["']/g;
  const allMocks = [...contents.matchAll(MOCK_PRESENT_RE)];
  if (allMocks.length === 0) return false;

  // Count how many of those calls delegate to sentryMockFactory() directly.
  // \s* matches whitespace including newlines so multi-line delegations are
  // accepted.  If fewer delegation calls exist than total mock calls, at least
  // one call has an inline body.
  const DELEGATE_RE =
    /vi\.mock\s*\(\s*["']@sentry\/node["']\s*,\s*\(\s*\)\s*=>\s*sentryMockFactory\s*\(\s*\)\s*\)/g;
  const delegateMocks = [...contents.matchAll(DELEGATE_RE)];
  return delegateMocks.length < allMocks.length;
}

/**
 * Scan O detector — exported for unit tests.
 *
 * Returns true if the source contains a `vi.mock(…/middleware/rateLimit, …)`
 * call whose factory body is defined inline — i.e. the mock call does NOT
 * delegate to `rateLimitMockFactory()` from the shared scaffold as its factory
 * argument.
 *
 * The path pattern `[^"']*middleware/rateLimit` handles any relative depth
 * (e.g. `"../middleware/rateLimit"` from a top-level Elaine test file or
 * `"../../middleware/rateLimit"` from a nested subdirectory).
 *
 * Detection strategy mirrors `hasInlineSentryMock`: find the specific
 * vi.mock call and validate its factory argument, not just search the file.
 *
 * A file that does not mock the rateLimit middleware at all returns false.
 */
export function hasInlineRateLimitMock(contents: string): boolean {
  // Count how many times the rateLimit middleware is mocked.
  // The path pattern [^"']* handles any relative depth (e.g. ../middleware or
  // ../../middleware from nested subdirectories).
  const MOCK_PRESENT_RE =
    /vi\.mock\s*\(\s*["'][^"']*middleware\/rateLimit["']/g;
  const allMocks = [...contents.matchAll(MOCK_PRESENT_RE)];
  if (allMocks.length === 0) return false;

  // Count how many of those calls delegate to rateLimitMockFactory() directly.
  // If fewer delegation calls exist than total mock calls, at least one has an
  // inline body.
  const DELEGATE_RE =
    /vi\.mock\s*\(\s*["'][^"']*middleware\/rateLimit["']\s*,\s*\(\s*\)\s*=>\s*rateLimitMockFactory\s*\(\s*\)\s*\)/g;
  const delegateMocks = [...contents.matchAll(DELEGATE_RE)];
  return delegateMocks.length < allMocks.length;
}

/**
 * Core logic for Scan O: given the source of index.ts and the canonical
 * action-class prefix → executor-variable map, return any violation strings
 * that should be pushed into the violations array.
 *
 * An empty array means all action-class prefixes in KNOWN_EXECUTOR_PREFIXES
 * are still backed by real executor spreads in ACTION_EXECUTORS.
 *
 * Exported for unit tests so the full violation message format can be asserted
 * without touching the filesystem or running the complete script.
 */
export function scanOViolations(
  source: string,
  knownMap: ReadonlyMap<string, string>,
  filePath: string,
): string[] {
  const spreads = extractActionExecutorSpreads(source);
  if (spreads.size === 0) {
    return [
      `${filePath}: could not locate ACTION_EXECUTORS or it contains no spread elements\n` +
        "  FIX: Scan O cannot verify KNOWN_EXECUTOR_PREFIXES action-class coverage\n" +
        "       without a parseable ACTION_EXECUTORS object literal in this file.\n" +
        "       Ensure ACTION_EXECUTORS is defined as a spread-object literal.",
    ];
  }
  const stale = findStaleActionClassPrefixes(knownMap, spreads);
  if (stale.length === 0) return [];
  const listed = stale
    .sort()
    .map((p) => `    "${p}" (was backed by: ...${knownMap.get(p)!})`)
    .join("\n");
  return [
    `${filePath}: ${stale.length} action-class executor prefix(es) in KNOWN_EXECUTOR_PREFIXES ` +
      `no longer have a matching spread in ACTION_EXECUTORS:\n${listed}\n` +
      "  FIX: Each entry in ACTION_CLASS_EXECUTOR_MAP must still correspond to an\n" +
      "       ...executorVar spread inside ACTION_EXECUTORS in index.ts.  A stale\n" +
      "       entry means the executor variable was renamed or removed without\n" +
      "       updating the guardrail.  Do ONE of the following:\n" +
      "         (a) The executor variable was renamed — update ACTION_CLASS_EXECUTOR_MAP\n" +
      "             in check-domain-composition.ts to use the new variable name, AND\n" +
      "             update the comment next to the prefix in KNOWN_EXECUTOR_PREFIXES.\n" +
      "         (b) The executor group was removed — delete the prefix from both\n" +
      "             KNOWN_EXECUTOR_PREFIXES and ACTION_CLASS_EXECUTOR_MAP.",
  ];
}
