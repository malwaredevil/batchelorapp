import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const requirements: Array<{
  path: string;
  includes: string[];
  excludes?: string[];
}> = [
  {
    path: "artifacts/modules/src/features/registry.ts",
    includes: ["createFeatureRegistry"],
  },
  {
    path: "artifacts/elaine/src/features/registry.ts",
    includes: ["createFeatureRegistry"],
  },
  ...[
    "artifacts/modules/src/pottery/pages/detail.tsx",
    "artifacts/modules/src/quilting/pages/fabrics/detail.tsx",
    "artifacts/modules/src/quilting/pages/patterns/detail.tsx",
    "artifacts/modules/src/quilting/pages/quilts/detail.tsx",
  ].map((path) => ({
    path,
    includes: ["CollectionDetailHero", "CollectionDetailPanelStack"],
  })),
  ...[
    "artifacts/modules/src/pottery/components/quick-edit-sheet.tsx",
    "artifacts/modules/src/ornaments/components/quick-edit-ornament-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-fabric-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-pattern-sheet.tsx",
    "artifacts/modules/src/quilting/components/quick-edit-quilt-sheet.tsx",
  ].map((path) => ({
    path,
    includes: ["QuickEditSheetFrame", "CategoryChipPicker"],
  })),
  ...[
    "artifacts/modules/src/pottery/components/tag-selector.tsx",
    "artifacts/modules/src/quilting/components/tag-selector.tsx",
  ].map((path) => ({
    path,
    includes: ["CategoryTagSelector"],
  })),
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
  })),
  ...[
    "artifacts/api-server/src/routes/pottery/pottery.ts",
    "artifacts/api-server/src/routes/ornaments/ornaments.ts",
    "artifacts/api-server/src/routes/quilting/fabrics.ts",
  ].map((path) => ({
    path,
    includes: ["runAnalysisWithEvidence"],
  })),
  {
    path: "artifacts/modules/src/quilting/pages/layouts/composer.tsx",
    includes: [
      'aria-controls="layout-block-palette"',
      'aria-controls="layout-library-templates"',
      "lg:sticky",
    ],
  },
  {
    path: ".gitignore",
    includes: [".replit", "**/.replit-artifact/"],
  },
  {
    path: "AGENTS.md",
    includes: [
      "Composition and Configuration Is the Default Architecture",
      "docs/composition-and-configuration.md",
    ],
  },
  {
    path: "replit.md",
    includes: [
      "Composition and configuration is the highest-priority design rule",
      "check-domain-composition",
    ],
  },
  {
    path: "docs/composition-and-configuration.md",
    includes: ["Required decision order", "Review questions"],
  },
  {
    path: "scripts/src/pre-publish.sh",
    includes: ["run_bg composition", "check-domain-composition"],
  },
  {
    path: "lib/elaine-ui/src/page-context-formatters.ts",
    includes: ["formatElaineContextList", "formatElaineContextEntity"],
  },
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
  })),
  {
    path: "lib/web-core/src/sentry.ts",
    includes: ["initBrowserMonitoring", "Sentry.replayIntegration"],
  },
  ...[
    "artifacts/modules/src/sentry.ts",
    "artifacts/web/src/sentry.ts",
    "artifacts/elaine/src/sentry.ts",
  ].map((path) => ({
    path,
    includes: ["initBrowserMonitoring"],
    excludes: ["Sentry.init", "Sentry.replayIntegration"],
  })),
  {
    path: "artifacts/modules/src/App.tsx",
    includes: ["PublicRouteBoundary"],
  },
  {
    path: "artifacts/api-server/src/elaine/index.ts",
    includes: ["queryHouseholdData", "searchHouseholdData"],
    excludes: [
      "async function queryHouseholdData",
      "async function searchHouseholdData",
    ],
  },
  {
    path: "artifacts/api-server/src/elaine/household-counts.ts",
    includes: ["export async function queryHouseholdData", "isNull"],
  },
  {
    path: "artifacts/api-server/src/elaine/household-search.ts",
    includes: ["export async function searchHouseholdData", "isNull"],
  },
];

const violations: string[] = [];
for (const requirement of requirements) {
  const contents = read(requirement.path);
  for (const marker of requirement.includes) {
    if (!contents.includes(marker)) {
      violations.push(`${requirement.path}: missing ${JSON.stringify(marker)}`);
    }
  }
  for (const marker of requirement.excludes ?? []) {
    if (contents.includes(marker)) {
      violations.push(
        `${requirement.path}: superseded local implementation ${JSON.stringify(marker)}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Domain composition drift detected:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("✓ Domain composition boundaries are intact");
}
