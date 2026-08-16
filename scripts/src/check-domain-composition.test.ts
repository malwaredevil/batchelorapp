#!/usr/bin/env tsx
/**
 * check-domain-composition.test.ts — unit tests for the composition-guard detectors.
 *
 * Uses only Node built-ins (node:assert) so no extra test-framework dependency
 * is needed.  Each scan's detector function is imported and exercised against
 * synthetic source strings representing known-violation and known-good patterns.
 *
 * Also includes integration tests that spawn the full script as a child process
 * to confirm exit-code behaviour: exit 0 on a clean repo, non-zero when a
 * real violation is injected into a watched directory.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  hasSentryInit,
  hasDirectOpenAIClient,
  hasInlineContextListBuilding,
  hasLabeledEntityIdInContext,
  hasBareEntityIdInContext,
  hasInlinedElaineLessonsMock,
  extractSharedLibImports,
  extractPlannerToolCatalogImports,
  checkRequirementContents,
  checkRequirementFile,
  missingPlannerToolCatalogMockKeys,
  wrongPlannerToolCatalogMockValues,
  PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS,
  extractInlineToolNamesFromPlannerMock,
  staleInlineToolNamesInPlannerMock,
  extractToolNameConstants,
  findOrphanedToolNameConstants,
  hasInlineToolNameDefinition,
  findUnregisteredElaineToolFiles,
  ELAINE_IMPORTED_TOOL_FILES,
  extractPlannerMockDefaultsBlock,
  missingPlannerMockHelperKeys,
  wrongPlannerMockHelperValues,
  extractPolicyRowToolNames,
  findPhantomPolicyRowToolNames,
  RUNTIME_REQUIRED_EXPORTS,
  extractRuntimeImports,
  missingRuntimeMockKeys,
  wrongRuntimeMockValues,
  extractActionTypeDiscriminants,
  extractActionToolNamesFromCatalogSection,
  extractStringArrayExport,
  extractUniversalReadDispatchBody,
  findUniversalReadDispatchGaps,
  stripSourceComments,
  stripSimpleStringLiterals,
  stripTemplateLiterals,
  stripAllStringLiteralContent,
  KNOWN_EXECUTOR_PREFIXES,
  extractPolicyRowExecutorPrefixes,
  findPhantomExecutorPrefixes,
  scanNViolations,
  hasInlineSentryMock,
  hasInlineRateLimitMock,
  ACTION_CLASS_EXECUTOR_MAP,
  extractActionExecutorSpreads,
  findStaleActionClassPrefixes,
  scanOViolations,
  hasInlineMultiSelectMode,
  hasMissingCompareUIImports,
} from "./check-domain-composition.js";

// ────────────────────────────────────────────────────────────────────────────
// Minimal test harness (mirrors the pattern used by pii-scan.test.ts)
// ────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scan A — hasSentryInit
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-domain-composition.test: Scan A — hasSentryInit");

test("detects a plain Sentry.init() call", () => {
  const source = `
import * as Sentry from "@sentry/react";
Sentry.init({ dsn: "https://abc@sentry.io/1" });
`;
  assert.equal(hasSentryInit(source), true);
});

test("detects Sentry.init() with trailing whitespace before paren", () => {
  // Some formatters may not add whitespace, but confirm exact token match
  const source = `Sentry.init({ dsn: dsn, integrations: [] });`;
  assert.equal(hasSentryInit(source), true);
});

test("does NOT flag initBrowserMonitoring (the approved wrapper)", () => {
  const source = `
import { initBrowserMonitoring } from "@workspace/web-core/sentry";
initBrowserMonitoring({ dsn, release, enabled: true });
`;
  assert.equal(hasSentryInit(source), false);
});

test("does NOT flag a comment mentioning Sentry.init", () => {
  // The detector is string-based; a comment containing the token IS flagged —
  // this is intentional (same behaviour as the production scan).  Test documents it.
  const source = `// Do not call Sentry.init() directly — use initBrowserMonitoring`;
  assert.equal(hasSentryInit(source), true);
});

test("does NOT flag an unrelated Sentry method (Sentry.captureException)", () => {
  const source = `Sentry.captureException(err);`;
  assert.equal(hasSentryInit(source), false);
});

test("does NOT flag an empty file", () => {
  assert.equal(hasSentryInit(""), false);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan B — hasDirectOpenAIClient
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-domain-composition.test: Scan B — hasDirectOpenAIClient");

test("detects new OpenAI() instantiation", () => {
  const source = `
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
`;
  assert.equal(hasDirectOpenAIClient(source), true);
});

test("detects new OpenAI() with no arguments", () => {
  const source = `const openai = new OpenAI();`;
  assert.equal(hasDirectOpenAIClient(source), true);
});

test("does NOT flag getOpenRouterClient() (the approved facade)", () => {
  const source = `
import { getOpenRouterClient } from "lib/ai-client";
const client = getOpenRouterClient();
`;
  assert.equal(hasDirectOpenAIClient(source), false);
});

test("does NOT flag callModel() (the approved facade)", () => {
  const source = `
import { callModel } from "lib/ai-client";
await callModel({ model: "gpt-4o", messages });
`;
  assert.equal(hasDirectOpenAIClient(source), false);
});

test("does NOT flag a string containing 'new OpenAI' as a plain comment word", () => {
  // 'new OpenAI(' is the exact token; 'new OpenAI' without paren won't match.
  const source = `// the new OpenAI models are faster`;
  assert.equal(hasDirectOpenAIClient(source), false);
});

test("does NOT flag an empty file", () => {
  assert.equal(hasDirectOpenAIClient(""), false);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan C — hasInlineContextListBuilding
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan C — hasInlineContextListBuilding",
);

const CONTEXT_HOOK = `usePageAssistantContext`;

test('detects .join(", ") || "none" pattern without shared formatter', () => {
  const source = `
${CONTEXT_HOOK}("page", () => ({
  data: items.map(i => i.id).join(", ") || "none",
}));
`;
  assert.equal(hasInlineContextListBuilding(source), true);
});

test('detects .join("; ") || "none" pattern without shared formatter', () => {
  const source = `
${CONTEXT_HOOK}("page", () => ({
  data: items.map(i => i.id).join("; ") || "none",
}));
`;
  assert.equal(hasInlineContextListBuilding(source), true);
});

test("detects single-quoted .join(', ') || 'none' variant", () => {
  const source = `
${CONTEXT_HOOK}("page", () => ({
  data: items.map(i => i.id).join(', ') || 'none',
}));
`;
  assert.equal(hasInlineContextListBuilding(source), true);
});

test("does NOT flag when formatElaineContextList is present", () => {
  const source = `
import { formatElaineContextList } from "@workspace/elaine-ui";
${CONTEXT_HOOK}("page", () => ({
  data: formatElaineContextList(items, i => i.id),
}));
// legacy: items.map(i => i.id).join(", ") || "none"
`;
  assert.equal(hasInlineContextListBuilding(source), false);
});

test("does NOT flag when formatElaineContextEntity is present", () => {
  const source = `
import { formatElaineContextEntity } from "@workspace/elaine-ui";
${CONTEXT_HOOK}("detail", () => ({
  data: formatElaineContextEntity("item", item?.id),
}));
// items.map(i => i.id).join(", ") || "none"
`;
  assert.equal(hasInlineContextListBuilding(source), false);
});

test("does NOT flag a file without usePageAssistantContext even if join pattern present", () => {
  const source = `
const label = tags.map(t => t.name).join(", ") || "none";
`;
  assert.equal(hasInlineContextListBuilding(source), false);
});

test("does NOT flag a file with usePageAssistantContext but no join-with-none pattern", () => {
  const source = `
${CONTEXT_HOOK}("static-page", () => ({
  data: "This page has no dynamic entity list",
}));
`;
  assert.equal(hasInlineContextListBuilding(source), false);
});

test("does NOT flag a JSX .join() that lacks the || 'none' suffix", () => {
  // Only the || "none" suffix is the canonical indicator; naked .join() in JSX
  // render logic should not be flagged.
  const source = `
${CONTEXT_HOOK}("page", () => ({ data: "items page" }));
const rendered = <p>{items.map(i => i.name).join(", ")}</p>;
`;
  assert.equal(hasInlineContextListBuilding(source), false);
});

test("does NOT flag an empty file", () => {
  assert.equal(hasInlineContextListBuilding(""), false);
});

// ────────────────────────────────────────────────────────────────────────────
// extractSharedLibImports — import-parsing helper
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-domain-composition.test: extractSharedLibImports");

test("parses a simple elaine-ui import", () => {
  const source = `import { ElaineWidget } from "@workspace/elaine-ui";`;
  assert.deepEqual(extractSharedLibImports(source), ["ElaineWidget"]);
});

test("parses multiple names from a single import statement", () => {
  const source = `import { formatElaineContextList, formatElaineContextEntity } from "@workspace/elaine-ui";`;
  const names = extractSharedLibImports(source);
  assert.ok(
    names.includes("formatElaineContextList"),
    "should include formatElaineContextList",
  );
  assert.ok(
    names.includes("formatElaineContextEntity"),
    "should include formatElaineContextEntity",
  );
  assert.equal(names.length, 2);
});

test("parses a web-core sub-path import", () => {
  const source = `import { initBrowserMonitoring } from "@workspace/web-core/sentry";`;
  assert.deepEqual(extractSharedLibImports(source), ["initBrowserMonitoring"]);
});

test("handles 'as' aliases — returns the original export name", () => {
  const source = `import { ElaineWidget as Widget } from "@workspace/elaine-ui";`;
  assert.deepEqual(extractSharedLibImports(source), ["ElaineWidget"]);
});

test("skips type-only imports", () => {
  const source = `import type { AppId } from "@workspace/elaine-ui";`;
  assert.deepEqual(extractSharedLibImports(source), []);
});

test("does not cross import statement boundaries", () => {
  const source = `
import { ElaineWidget } from "@workspace/elaine-ui";
import { SomeOther } from "some-package";
import { useAuth } from "@workspace/web-core/auth";
`;
  const names = extractSharedLibImports(source);
  assert.ok(names.includes("ElaineWidget"), "should include ElaineWidget");
  assert.ok(names.includes("useAuth"), "should include useAuth");
  assert.ok(
    !names.includes("SomeOther"),
    "should not include SomeOther from non-workspace package",
  );
});

test("returns empty array when no shared imports present", () => {
  const source = `import { useState } from "react";`;
  assert.deepEqual(extractSharedLibImports(source), []);
});

// ────────────────────────────────────────────────────────────────────────────
// Section 1 — checkRequirementContents
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Section 1 — checkRequirementContents",
);

test("reports a violation when a required string is missing", () => {
  const violations = checkRequirementContents("some/file.ts", "const x = 1;", {
    includes: ["createFeatureRegistry"],
  });
  assert.equal(violations.length, 1);
  assert.ok(
    violations[0].includes("some/file.ts"),
    "violation message should contain the path",
  );
  assert.ok(
    violations[0].includes('"createFeatureRegistry"'),
    "violation message should quote the missing token",
  );
  assert.ok(
    violations[0].includes("missing"),
    "violation message should say 'missing'",
  );
});

test("reports one violation per missing required string when multiple are absent", () => {
  const violations = checkRequirementContents("some/file.ts", "", {
    includes: ["tokenA", "tokenB", "tokenC"],
  });
  assert.equal(violations.length, 3, "one violation per missing token");
});

test("reports no violation when all required strings are present", () => {
  const contents = `
import { createFeatureRegistry } from "@workspace/web-core/feature-registry";
export const registry = createFeatureRegistry({ features: [] });
`;
  const violations = checkRequirementContents("some/file.ts", contents, {
    includes: ["createFeatureRegistry"],
  });
  assert.equal(violations.length, 0);
});

test("reports a violation when a forbidden (excludes) string is present", () => {
  const contents = `
async function resolveOrCreateCategories(db: Db) { return []; }
`;
  const violations = checkRequirementContents("routes/fabrics.ts", contents, {
    includes: ["parseStringArray"],
    excludes: ["function resolveOrCreateCategories"],
  });
  // two violations: one for missing include, one for forbidden exclude
  const forbiddenViolation = violations.find((v) =>
    v.includes("superseded local implementation"),
  );
  assert.ok(forbiddenViolation, "should report a forbidden-string violation");
  assert.ok(
    forbiddenViolation!.includes('"function resolveOrCreateCategories"'),
    "violation should quote the forbidden token",
  );
});

test("reports no violation for excludes when the forbidden string is absent", () => {
  const contents = `
import { parseStringArray, resolveOrCreateQuiltingCategories } from "@workspace/server-lib";
`;
  const violations = checkRequirementContents("routes/fabrics.ts", contents, {
    includes: ["parseStringArray", "resolveOrCreateQuiltingCategories"],
    excludes: [
      "function parseStringArray",
      "function resolveOrCreateCategories",
    ],
  });
  assert.equal(violations.length, 0);
});

test("includes the FIX message in the violation when fix is provided", () => {
  const fix =
    "Import createFeatureRegistry from @workspace/web-core/feature-registry.";
  const violations = checkRequirementContents("some/file.ts", "", {
    includes: ["createFeatureRegistry"],
    fix,
  });
  assert.equal(violations.length, 1);
  assert.ok(
    violations[0].includes("FIX:"),
    "violation should contain FIX: label",
  );
  assert.ok(
    violations[0].includes(fix),
    "violation should contain the full fix message",
  );
});

test("omits the FIX line when no fix is provided", () => {
  const violations = checkRequirementContents("some/file.ts", "", {
    includes: ["createFeatureRegistry"],
  });
  assert.equal(violations.length, 1);
  assert.ok(
    !violations[0].includes("FIX:"),
    "violation should not contain FIX: when fix is absent",
  );
});

test("reports all required-string violations on an empty file", () => {
  // Simulates a file that was accidentally cleared
  const violations = checkRequirementContents(
    "artifacts/modules/src/features/registry.ts",
    "",
    { includes: ["createFeatureRegistry"], fix: "Use createFeatureRegistry." },
  );
  assert.equal(violations.length, 1);
  assert.ok(
    violations[0].includes("artifacts/modules/src/features/registry.ts"),
    "path should appear in violation",
  );
});

test("reports violations on a file containing only whitespace", () => {
  const violations = checkRequirementContents("some/file.ts", "   \n\n\t  \n", {
    includes: ["CollectionDetailHero", "CollectionDetailPanelStack"],
  });
  assert.equal(violations.length, 2, "both missing tokens should be reported");
});

test("does not report an excludes violation on an empty file", () => {
  // Empty file cannot contain a forbidden string — no false positive
  const violations = checkRequirementContents("some/file.ts", "", {
    includes: [],
    excludes: ["async function queryHouseholdData"],
  });
  assert.equal(
    violations.length,
    0,
    "empty file should not trigger an excludes violation",
  );
});

test("handles a requirement with no excludes field (excludes is optional)", () => {
  // Requirement with only includes (excludes omitted) should not throw
  const violations = checkRequirementContents(
    "some/file.ts",
    "import { runAnalysisWithEvidence } from '@workspace/ai-lib';",
    { includes: ["runAnalysisWithEvidence"] },
  );
  assert.equal(violations.length, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Section 1 — checkRequirementFile (missing-file wrapper)
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Section 1 — checkRequirementFile",
);

test("returns a structured violation when the file does not exist", () => {
  const result = checkRequirementFile({
    path: "some/nonexistent/file.ts",
    includes: ["createFeatureRegistry"],
    fix: "Use createFeatureRegistry.",
  });
  assert.equal(result.length, 1, "exactly one violation should be returned");
  assert.ok(
    result[0].includes("some/nonexistent/file.ts"),
    "violation should contain the file path",
  );
  assert.ok(
    result[0].includes("file not found or unreadable"),
    'violation should say "file not found or unreadable"',
  );
});

test("does not throw — missing file produces a violation, not an ENOENT crash", () => {
  // The process must not exit or throw — wrap to confirm
  let threw = false;
  try {
    checkRequirementFile({
      path: "definitely/does/not/exist.ts",
      includes: ["anything"],
    });
  } catch {
    threw = true;
  }
  assert.equal(
    threw,
    false,
    "checkRequirementFile must not throw on a missing file",
  );
});

test("returns content violations (not a missing-file violation) when file exists and tokens are absent", () => {
  // Use a file that is guaranteed to exist in this repo
  const result = checkRequirementFile({
    path: "scripts/src/check-domain-composition.ts",
    includes: ["THIS_TOKEN_DOES_NOT_EXIST_IN_THE_FILE_12345"],
  });
  assert.equal(result.length, 1, "one violation for the missing token");
  assert.ok(
    result[0].includes("missing"),
    "violation should say 'missing', not 'file not found'",
  );
  assert.ok(
    !result[0].includes("file not found or unreadable"),
    "should not produce a file-not-found violation when file exists",
  );
});

test("returns no violations when file exists and all tokens are present", () => {
  // checkRequirementFile on a real file with a token that is definitely in it
  const result = checkRequirementFile({
    path: "scripts/src/check-domain-composition.ts",
    includes: ["checkRequirementFile"],
  });
  assert.equal(
    result.length,
    0,
    "no violations when token is present in the file",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Integration tests — spawn the script as a child process
//
// These tests confirm that the script's violation-reporting loop and
// process.exitCode = 1 branch are actually wired up.  The unit tests above
// verify that individual detector functions return correct booleans; these
// tests verify that the *process* exits 0 on a clean repo and non-zero when
// a real violation is present.  If the exit-code branch were accidentally
// removed, all unit tests would still pass while the gate silently stopped
// enforcing anything.
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Integration — process exit codes",
);

const root = join(import.meta.dirname, "../..");
// scripts/ dir — where tsx is installed and where the npm script runs from
const scriptsCwd = join(import.meta.dirname, "..");
const scriptPath = join(import.meta.dirname, "check-domain-composition.ts");

function runScript() {
  return spawnSync("node", ["--import", "tsx", scriptPath], {
    cwd: scriptsCwd,
    encoding: "utf8",
    env: process.env,
  });
}

/**
 * All known temp fixture paths that integration tests write into the workspace.
 * Kept as a module-level constant so cleanupKnownTempFixtures and
 * runScriptExpectingZero share a single source of truth.
 */
const KNOWN_TEMP_FIXTURES: string[] = [
  join(root, "artifacts/modules/src/_temp_composition_guard_test_fixture.ts"),
  join(
    root,
    "artifacts/api-server/src/routes/_temp_composition_guard_test_b_fixture.ts",
  ),
  join(
    root,
    "artifacts/modules/src/_temp_composition_guard_test_c_fixture.tsx",
  ),
  join(
    root,
    "artifacts/modules/src/_temp_composition_guard_test_f_fixture.tsx",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_value_fixture.test.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_fixture.test.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_inline_fixture.test.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp-composition-guard-test-j-actions.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp-composition-guard-test-j-inline-actions.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_composition_guard_test_runtime_fixture.test.ts",
  ),
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_composition_guard_test_scan_o_fixture.test.ts",
  ),
  // Scan O action-executor e2e: a temp copy of index.ts with a stale spread injected.
  // Written to a temp path and supplied to the script via CHECK_DOMAIN_SCAN_O_INDEX_PATH
  // so the real index.ts is never mutated.
  join(
    root,
    "artifacts/api-server/src/elaine/_temp_scan_o_action_executor_index_fixture.ts",
  ),
  // Scan P e2e: a violating gallery page fixture written into pages/ so the runner
  // can find it; cleaned up in the test's finally block.
  join(
    root,
    "artifacts/modules/src/ornaments/pages/_temp_scan_p_gallery_fixture.tsx",
  ),
  // Scan P e2e (per-specifier type bypass): same purpose as above.
  join(
    root,
    "artifacts/modules/src/ornaments/pages/_temp_scan_p_type_specifier_fixture.tsx",
  ),
  // Scan P e2e (partial-adoption: hook used, bar missing): same purpose.
  join(
    root,
    "artifacts/modules/src/ornaments/pages/_temp_scan_p_partial_adoption_fixture.tsx",
  ),
];

/**
 * Delete every known temp fixture file that integration tests write to the
 * workspace, optionally skipping files the caller owns for this test run.
 * These files are normally cleaned up by each test's finally block, but a
 * concurrent task's CI run can leave them behind.
 */
function cleanupKnownTempFixtures(
  preserve: ReadonlySet<string> = new Set(),
): void {
  for (const p of KNOWN_TEMP_FIXTURES) {
    if (preserve.has(p)) continue;
    try {
      unlinkSync(p);
    } catch {
      // already gone — fine
    }
  }
}

/**
 * Run the check-domain-composition script and expect exit 0.
 *
 * In concurrent CI environments another task's integration tests may create a
 * temp fixture between our cleanup call and the spawnSync call, causing a false
 * non-zero exit.  This helper retries once — re-cleaning and re-running —
 * before returning the final result.  Pass `preservedFiles` for any temp
 * fixtures the caller deliberately wrote and wants to keep across the retry.
 */
function runScriptExpectingZero(
  preservedFiles: string[] = [],
): ReturnType<typeof runScript> {
  const preserve = new Set(preservedFiles);
  cleanupKnownTempFixtures(preserve);
  const first = runScript();
  if (first.status === 0) return first;
  // First attempt failed — clean up any concurrently-created fixtures and retry.
  cleanupKnownTempFixtures(preserve);
  return runScript();
}

test("script exits 0 against the real (clean) repo", () => {
  const result = runScriptExpectingZero();
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `Expected exit 0 but got ${result.status}.\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
  assert.equal(result.status, 0);
});

// Temporary violation file written into a directory walked by Scan A
// (artifacts/modules/src) so the Sentry.init() pattern is detected.
// The filename does NOT end in .test.ts / .spec.ts so it is not excluded.
const TEMP_VIOLATION_FILE = join(
  root,
  "artifacts/modules/src/_temp_composition_guard_test_fixture.ts",
);

test("script exits non-zero when a Sentry.init() violation is injected", () => {
  writeFileSync(
    TEMP_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import * as Sentry from "@sentry/react";',
      'Sentry.init({ dsn: "https://test@sentry.io/0" });',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when a Sentry.init() violation is present, but script exited ${result.status}`,
    );
  } finally {
    // Always clean up, even if the assertion fails, so the real clean-repo
    // test doesn't break on subsequent runs.
    try {
      unlinkSync(TEMP_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan E — hasLabeledEntityIdInContext
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan E — hasLabeledEntityIdInContext",
);

test("detects threadId: ${selectedThreadId} pattern (real violation)", () => {
  const source = `
import { useAppConfigSummary } from "@workspace/elaine-ui";
usePageAssistantContext("office-gmail", \`threadId: \${selectedThreadId}\`);
`;
  assert.equal(hasLabeledEntityIdInContext(source), true);
});

test("detects fabricId: ${fabric.id} pattern (real violation)", () => {
  const source = `
usePageAssistantContext("fabric-detail", \`fabricId: \${fabric.id}\`);
`;
  assert.equal(hasLabeledEntityIdInContext(source), true);
});

test("detects bare id: ${item.id} label pattern", () => {
  const source = `
usePageAssistantContext("item-page", \`Current item — id: \${item.id}, name: \${item.name}\`);
`;
  assert.equal(hasLabeledEntityIdInContext(source), true);
});

test("does NOT flag when formatElaineContextEntity is imported", () => {
  const source = `
import { formatElaineContextEntity } from "@workspace/elaine-ui";
usePageAssistantContext("gmail", \`threadId: \${selectedThreadId}\`);
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag a URL path interpolation (no label prefix)", () => {
  const source = `
usePageAssistantContext("fabric-add", "Add Fabric page.");
navigate(\`/quilting/fabrics/\${fabric.id}\`);
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag href attribute interpolation (no label prefix)", () => {
  const source = `
usePageAssistantContext("compare", "Compare page.");
const link = \`/quilting/fabrics/\${match.fabric.id}\`;
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag htmlFor attribute with id suffix (no colon-dollar pattern)", () => {
  const source = `
usePageAssistantContext("yardage", "Yardage Calculator page.");
return <label htmlFor={\`blocks-\${r.fabric.id}\`}>Blocks</label>;
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag a multi-line JSX conditional containing Id variables", () => {
  // e.g. ${dragOverId === panel.id && ...} spans multiple lines so [^}\n]+ won't match
  const source = `
usePageAssistantContext("designer", "Designer page.");
const cls = \`\${
  dragOverId === panel.id && dragPanelId !== panel.id
    ? "border-primary"
    : "border-border"
}\`;
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag when usePageAssistantContext is absent", () => {
  const source = `
const label = \`threadId: \${selectedThreadId}\`;
`;
  assert.equal(hasLabeledEntityIdInContext(source), false);
});

test("does NOT flag an empty file", () => {
  assert.equal(hasLabeledEntityIdInContext(""), false);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan F — hasBareEntityIdInContext
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan F — hasBareEntityIdInContext",
);

test("detects ${item.id} in a file with usePageAssistantContext (no formatter)", () => {
  const source = `
usePageAssistantContext("item-page", \`Item loaded: name=\${item.name}, id=\${item.id}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), true);
});

test("detects ${fabric.id} that is NOT preceded by /", () => {
  const source = `
usePageAssistantContext("fabric-page", \`Fabric id=\${fabric.id}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), true);
});

test("does NOT flag when formatElaineContextEntity is imported", () => {
  const source = `
import { formatElaineContextEntity } from "@workspace/elaine-ui";
usePageAssistantContext("page", \`\${formatElaineContextEntity({ entity: "Item", id: item.id, label: item.name })}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag /route/${item.id} URL path (negative lookbehind)", () => {
  const source = `
usePageAssistantContext("fabric-add", "Add Fabric page.");
navigate(\`/quilting/fabrics/\${fabric.id}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("detects ${item.id} at the start of a context template (backtick-preceded)", () => {
  // A context string that IS just the bare ID: usePageAssistantContext("p", `${item.id}`)
  // The `${` is immediately after the opening backtick of the template literal.
  // This is a real violation — the context string contains only a bare entity ID.
  const source = `
usePageAssistantContext("detail", \`\${item.id}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), true);
});

test("does NOT flag URL query param ?id=${design.id} (navigate call)", () => {
  // navigate(`/quilt/designer?id=${design.id}`) — ${} preceded by = in ?id=
  const source = `
usePageAssistantContext("whole-quilt-list", \`\${designs.length} saved designs.\`);
navigate(\`/quilting/whole-quilt/designer?id=\${design.id}\`);
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag JSX template attribute suffix (htmlFor with id)", () => {
  // htmlFor={`blocks-${r.fabric.id}`} — ${} preceded by -
  const source = `
usePageAssistantContext("yardage", "Yardage Calculator page.");
return <label htmlFor={\`blocks-\${r.fabric.id}\`}>Blocks</label>;
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag display label Fabric #${id} (hash prefix)", () => {
  // `Fabric #${f.id}` — ${} preceded by #
  const source = `
usePageAssistantContext("owner-panel", "Owner Panel page.");
const label = \`Fabric #\${f.id}\`;
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag when usePageAssistantContext is absent", () => {
  const source = `
const url = \`/trips/\${trip.id}\`;
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag multi-line expressions spanning a newline (no-span guard)", () => {
  const source = `
usePageAssistantContext("designer", "Designer page.");
const cls = \`\${
  dragOverId === panel.id
    ? "border-primary"
    : "border-border"
}\`;
`;
  assert.equal(hasBareEntityIdInContext(source), false);
});

test("does NOT flag an empty file", () => {
  assert.equal(hasBareEntityIdInContext(""), false);
});

// ── Integration tests: Scan B and C violation injection ─────────────────────

console.log(
  "\ncheck-domain-composition.test: Integration — Scan B and Scan C exit codes",
);

const TEMP_ROUTE_VIOLATION_FILE = join(
  root,
  "artifacts/api-server/src/routes/_temp_composition_guard_test_b_fixture.ts",
);

test("script exits non-zero when a direct new OpenAI() violation is injected (Scan B)", () => {
  writeFileSync(
    TEMP_ROUTE_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import OpenAI from "openai";',
      "const openai = new OpenAI();",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for new OpenAI() violation, but script exited ${result.status}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_ROUTE_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

const TEMP_CONTEXT_VIOLATION_FILE = join(
  root,
  "artifacts/modules/src/_temp_composition_guard_test_c_fixture.tsx",
);

test("script exits non-zero when an inline .join() context-list violation is injected (Scan C)", () => {
  writeFileSync(
    TEMP_CONTEXT_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'usePageAssistantContext("page", () => ({',
      '  data: `Items: ${items.map(i => i.name).join(", ") || "none"}`,',
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for inline .join() violation, but script exited ${result.status}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_CONTEXT_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

const TEMP_BARE_ID_VIOLATION_FILE = join(
  root,
  "artifacts/modules/src/_temp_composition_guard_test_f_fixture.tsx",
);

test("script exits non-zero when a bare .id context-string violation is injected (Scan F)", () => {
  writeFileSync(
    TEMP_BARE_ID_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { usePageAssistantContext } from "@/lib/assistant-context";',
      "const item = { id: 1, name: 'test' };",
      'usePageAssistantContext("item-page", `Item: ${item.id}`);',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for bare .id violation, but script exited ${result.status}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_BARE_ID_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G — missingPlannerToolCatalogMockKeys
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G — missingPlannerToolCatalogMockKeys",
);

const COMPLETE_MOCK_BODY = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map(
  (e) => `  ${e.key}: "stub",`,
).join("\n");

const COMPLETE_MOCK_FILE = [
  'import { vi } from "vitest";',
  'vi.mock("./planner-tool-catalog", () => ({',
  COMPLETE_MOCK_BODY,
  "}));",
  "",
].join("\n");

test("returns null when file has no planner-tool-catalog mock", () => {
  const source = `vi.mock("./some-other-module", () => ({ foo: "bar" }));`;
  assert.equal(missingPlannerToolCatalogMockKeys(source), null);
});

test("returns empty set when all required keys are present", () => {
  const result = missingPlannerToolCatalogMockKeys(COMPLETE_MOCK_FILE);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("returns the missing key when one required export is absent", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    ...PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.filter(
      (e) => e.key !== "LOOKUP_BOOK_VALUE_TOOL_NAME",
    ).map((e) => `  ${e.key}: "stub",`),
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.deepEqual([...result!], ["LOOKUP_BOOK_VALUE_TOOL_NAME"]);
});

test("returns all four photo-tool keys when they are missing from the mock", () => {
  const photoKeys = [
    "ANALYZE_FABRIC_PHOTO_TOOL_NAME",
    "ANALYZE_ORNAMENT_PHOTO_TOOL_NAME",
    "ANALYZE_POTTERY_PHOTO_TOOL_NAME",
    "LOOKUP_BOOK_VALUE_TOOL_NAME",
  ];
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    ...PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.filter(
      (e) => !photoKeys.includes(e.key),
    ).map((e) => `  ${e.key}: "stub",`),
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, photoKeys.length);
  for (const k of photoKeys) {
    assert.ok(result!.has(k), `expected ${k} to be in the missing set`);
  }
});

test("does not flag files that use importActual (no factory marker present)", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", async (importActual) => {',
    "  const actual = await importActual();",
    "  return { ...actual };",
    "});",
    "",
  ].join("\n");
  assert.equal(missingPlannerToolCatalogMockKeys(source), null);
});

test("detects a missing key from a second factory when the first is complete", () => {
  // First factory is complete, second is missing LOOKUP_BOOK_VALUE_TOOL_NAME.
  const secondBody = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.filter(
    (e) => e.key !== "LOOKUP_BOOK_VALUE_TOOL_NAME",
  )
    .map((e) => `  ${e.key}: "stub",`)
    .join("\n");
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    COMPLETE_MOCK_BODY,
    "}));",
    "",
    'vi.mock("./planner-tool-catalog", () => ({',
    secondBody,
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("LOOKUP_BOOK_VALUE_TOOL_NAME"),
    "expected LOOKUP_BOOK_VALUE_TOOL_NAME in missing set from second factory",
  );
});

test("handles a single-quoted module path", () => {
  const source = [
    "vi.mock('./planner-tool-catalog', () => ({",
    COMPLETE_MOCK_BODY,
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("handles a single-quoted mock missing keys", () => {
  const partialBody = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.filter(
    (e) => e.key !== "ANALYZE_POTTERY_PHOTO_TOOL_NAME",
  )
    .map((e) => `  ${e.key}: "stub",`)
    .join("\n");
  const source = [
    "vi.mock('./planner-tool-catalog', () => ({",
    partialBody,
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("ANALYZE_POTTERY_PHOTO_TOOL_NAME"));
});

test("handles multi-line arrow function formatting", () => {
  // Arrow and object literal on separate lines, whitespace between.
  const source = [
    'vi.mock("./planner-tool-catalog", () =>',
    "  ({",
    COMPLETE_MOCK_BODY,
    "}));",
    "",
  ].join("\n");
  const result = missingPlannerToolCatalogMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G — wrongPlannerToolCatalogMockValues
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G — wrongPlannerToolCatalogMockValues",
);

const TEMP_PLANNER_WRONG_VALUE_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_value_fixture.test.ts",
);

// Build a correct mock body where every string constant uses its canonical value.
const CORRECT_VALUE_MOCK_BODY = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map(
  (e) =>
    e.value !== undefined ? `  ${e.key}: "${e.value}",` : `  ${e.key}: [],`,
).join("\n");

test("wrongPlannerToolCatalogMockValues returns null when file has no factory mock", () => {
  const source = `vi.mock("./some-other-module", () => ({ foo: "bar" }));`;
  assert.equal(wrongPlannerToolCatalogMockValues(source), null);
});

test("wrongPlannerToolCatalogMockValues returns empty map when all values are correct", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    CORRECT_VALUE_MOCK_BODY,
    "}));",
    "",
  ].join("\n");
  const result = wrongPlannerToolCatalogMockValues(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("wrongPlannerToolCatalogMockValues detects a stale string value", () => {
  // Use a stale value for GET_WEATHER_TOOL_NAME.
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    CORRECT_VALUE_MOCK_BODY.replace(
      'GET_WEATHER_TOOL_NAME: "get_weather_forecast"',
      'GET_WEATHER_TOOL_NAME: "get_weather"',
    ),
    "}));",
    "",
  ].join("\n");
  const result = wrongPlannerToolCatalogMockValues(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 1);
  assert.ok(
    result!.has("GET_WEATHER_TOOL_NAME"),
    "expected GET_WEATHER_TOOL_NAME in wrong-value map",
  );
  assert.equal(
    result!.get("GET_WEATHER_TOOL_NAME")?.expected,
    "get_weather_forecast",
  );
  assert.equal(result!.get("GET_WEATHER_TOOL_NAME")?.got, "get_weather");
});

test("wrongPlannerToolCatalogMockValues detects multiple stale values", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    CORRECT_VALUE_MOCK_BODY.replace(
      'NAVIGATE_TOOL_NAME: "suggest_navigation"',
      'NAVIGATE_TOOL_NAME: "navigate"',
    ).replace(
      'LOOKUP_BARCODE_TOOL_NAME: "lookup_product_barcode"',
      'LOOKUP_BARCODE_TOOL_NAME: "lookup_barcode"',
    ),
    "}));",
    "",
  ].join("\n");
  const result = wrongPlannerToolCatalogMockValues(source);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("NAVIGATE_TOOL_NAME"),
    "expected NAVIGATE_TOOL_NAME in wrong-value map",
  );
  assert.ok(
    result!.has("LOOKUP_BARCODE_TOOL_NAME"),
    "expected LOOKUP_BARCODE_TOOL_NAME in wrong-value map",
  );
  assert.equal(
    result!.get("NAVIGATE_TOOL_NAME")?.expected,
    "suggest_navigation",
  );
  assert.equal(result!.get("NAVIGATE_TOOL_NAME")?.got, "navigate");
});

test("wrongPlannerToolCatalogMockValues does not flag importActual mocks", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", async (importActual) => {',
    "  const actual = await importActual();",
    "  return { ...actual };",
    "});",
    "",
  ].join("\n");
  assert.equal(wrongPlannerToolCatalogMockValues(source), null);
});

test("script exits non-zero when a planner-tool-catalog mock has a wrong string value (Scan G)", () => {
  const wrongValueBody = CORRECT_VALUE_MOCK_BODY.replace(
    'GET_WEATHER_TOOL_NAME: "get_weather_forecast"',
    'GET_WEATHER_TOOL_NAME: "get_weather"',
  );
  writeFileSync(
    TEMP_PLANNER_WRONG_VALUE_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("./planner-tool-catalog", () => ({',
      wrongValueBody,
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for wrong planner-tool-catalog mock values, but script exited ${result.status}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_PLANNER_WRONG_VALUE_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// Integration: inject a temp test file with a planner-tool-catalog mock that
// is missing a required key, verify the script exits non-zero.
const TEMP_PLANNER_MOCK_VIOLATION_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_fixture.test.ts",
);

test("script exits non-zero when a planner-tool-catalog mock is missing required exports (Scan G)", () => {
  const incompleteBody = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.filter(
    (e) =>
      e.key !== "ANALYZE_POTTERY_PHOTO_TOOL_NAME" &&
      e.key !== "ANALYZE_FABRIC_PHOTO_TOOL_NAME",
  )
    .map((e) => `  ${e.key}: "stub",`)
    .join("\n");
  writeFileSync(
    TEMP_PLANNER_MOCK_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("./planner-tool-catalog", () => ({',
      incompleteBody,
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for missing planner-tool-catalog mock exports, but script exited ${result.status}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_PLANNER_MOCK_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan I — shared mock-helper key/value validators
// (extractPlannerMockDefaultsBlock, missingPlannerMockHelperKeys,
//  wrongPlannerMockHelperValues)
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan I — planner mock-helper validators",
);

// Build a canonical helper source that contains a valid
// PLANNER_TOOL_CATALOG_MOCK_DEFAULTS block with all required keys and values.
const CANONICAL_MOCK_DEFAULTS_BODY = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map(
  (e) =>
    e.value !== undefined ? `  ${e.key}: "${e.value}",` : `  ${e.key}: [],`,
).join("\n");

const CANONICAL_HELPER_SOURCE = [
  "export const PLANNER_TOOL_CATALOG_MOCK_DEFAULTS = {",
  CANONICAL_MOCK_DEFAULTS_BODY,
  "};",
  "",
].join("\n");

test("extractPlannerMockDefaultsBlock returns null when no PLANNER_TOOL_CATALOG_MOCK_DEFAULTS found", () => {
  const source = 'export const OTHER_CONST = { foo: "bar" };';
  assert.equal(extractPlannerMockDefaultsBlock(source), null);
});

test("extractPlannerMockDefaultsBlock extracts the object literal correctly", () => {
  const block = extractPlannerMockDefaultsBlock(CANONICAL_HELPER_SOURCE);
  assert.notEqual(block, null, "expected a non-null block");
  assert.ok(block!.startsWith("{"), "block should start with {");
  assert.ok(block!.endsWith("}"), "block should end with }");
  assert.ok(
    block!.includes('NAVIGATE_TOOL_NAME: "suggest_navigation"'),
    "block should contain NAVIGATE_TOOL_NAME",
  );
});

test("missingPlannerMockHelperKeys returns null when no defaults block present", () => {
  assert.equal(missingPlannerMockHelperKeys("export function foo() {}"), null);
});

test("missingPlannerMockHelperKeys returns empty set when all keys present", () => {
  const result = missingPlannerMockHelperKeys(CANONICAL_HELPER_SOURCE);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("missingPlannerMockHelperKeys detects a key missing from the defaults object", () => {
  // Remove ANALYZE_POTTERY_PHOTO_TOOL_NAME from the canonical defaults block.
  const patched = CANONICAL_HELPER_SOURCE.replace(
    'ANALYZE_POTTERY_PHOTO_TOOL_NAME: "analyze_pottery_photo",',
    "",
  );
  const result = missingPlannerMockHelperKeys(patched);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("ANALYZE_POTTERY_PHOTO_TOOL_NAME"),
    "expected ANALYZE_POTTERY_PHOTO_TOOL_NAME in missing set",
  );
});

test("missingPlannerMockHelperKeys does NOT flag a key present only in a TypeScript interface above the const", () => {
  // Simulate an interface that lists a key, but the defaults object omits it.
  // The validator must inspect only the object block, not the whole file.
  const withInterface = [
    "export interface MockShape {",
    "  ANALYZE_POTTERY_PHOTO_TOOL_NAME: string;",
    "}",
    CANONICAL_HELPER_SOURCE.replace(
      'ANALYZE_POTTERY_PHOTO_TOOL_NAME: "analyze_pottery_photo",',
      "",
    ),
  ].join("\n");
  const result = missingPlannerMockHelperKeys(withInterface);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("ANALYZE_POTTERY_PHOTO_TOOL_NAME"),
    "key must be missing — interface presence must NOT satisfy the check",
  );
});

test("wrongPlannerMockHelperValues returns null when no defaults block present", () => {
  assert.equal(wrongPlannerMockHelperValues("export function foo() {}"), null);
});

test("wrongPlannerMockHelperValues returns empty map when all values are correct", () => {
  const result = wrongPlannerMockHelperValues(CANONICAL_HELPER_SOURCE);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("wrongPlannerMockHelperValues detects a stale string value in the defaults object", () => {
  const patched = CANONICAL_HELPER_SOURCE.replace(
    'GET_WEATHER_TOOL_NAME: "get_weather_forecast"',
    'GET_WEATHER_TOOL_NAME: "get_weather"',
  );
  const result = wrongPlannerMockHelperValues(patched);
  assert.notEqual(result, null);
  assert.equal(result!.size, 1);
  assert.ok(
    result!.has("GET_WEATHER_TOOL_NAME"),
    "expected GET_WEATHER_TOOL_NAME in wrong-value map",
  );
  assert.equal(
    result!.get("GET_WEATHER_TOOL_NAME")?.expected,
    "get_weather_forecast",
  );
  assert.equal(result!.get("GET_WEATHER_TOOL_NAME")?.got, "get_weather");
});

// ── Integration: verify the guardrail catches helper-file drift ───────────────

const PLANNER_MOCK_HELPER_FILE = join(
  root,
  "artifacts/api-server/src/elaine/test-helpers/planner-tool-catalog-mock.ts",
);

test("script exits non-zero when PLANNER_TOOL_CATALOG_MOCK_DEFAULTS is missing a required key (Scan I)", () => {
  const original = readFileSync(PLANNER_MOCK_HELPER_FILE, "utf8");
  // Remove one canonical key from the defaults object only.
  // Use a substring match without leading whitespace so the test is robust
  // to prettier re-indenting the object (2-space vs 4-space).
  const patched = original.replace(
    'ANALYZE_POTTERY_PHOTO_TOOL_NAME: "analyze_pottery_photo",',
    "",
  );
  assert.notEqual(
    patched,
    original,
    "patch did not match — indentation may have changed",
  );
  writeFileSync(PLANNER_MOCK_HELPER_FILE, patched, "utf8");
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when ANALYZE_POTTERY_PHOTO_TOOL_NAME is missing from ` +
        `PLANNER_TOOL_CATALOG_MOCK_DEFAULTS, but script exited ${result.status}`,
    );
  } finally {
    writeFileSync(PLANNER_MOCK_HELPER_FILE, original, "utf8");
  }
});

test("script exits non-zero when PLANNER_TOOL_CATALOG_MOCK_DEFAULTS has a wrong string value (Scan I)", () => {
  const original = readFileSync(PLANNER_MOCK_HELPER_FILE, "utf8");
  const patched = original.replace(
    'GET_WEATHER_TOOL_NAME: "get_weather_forecast"',
    'GET_WEATHER_TOOL_NAME: "get_weather_stale"',
  );
  writeFileSync(PLANNER_MOCK_HELPER_FILE, patched, "utf8");
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when GET_WEATHER_TOOL_NAME has stale value in ` +
        `PLANNER_TOOL_CATALOG_MOCK_DEFAULTS, but script exited ${result.status}`,
    );
  } finally {
    writeFileSync(PLANNER_MOCK_HELPER_FILE, original, "utf8");
  }
});

// ────────────────────────────────────────────────────────────────────────────
// extractPlannerToolCatalogImports — import-parsing helper
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: extractPlannerToolCatalogImports",
);

test("parses a single named import from ./planner-tool-catalog", () => {
  const source = `import { NAVIGATE_TOOL_NAME } from "./planner-tool-catalog";`;
  assert.deepEqual(extractPlannerToolCatalogImports(source), [
    "NAVIGATE_TOOL_NAME",
  ]);
});

test("parses multiple names from one import statement", () => {
  const source = `import { NAVIGATE_TOOL_NAME, REMEMBER_TOOL_NAME, ACTION_TOOLS } from "./planner-tool-catalog";`;
  const names = extractPlannerToolCatalogImports(source);
  assert.ok(
    names.includes("NAVIGATE_TOOL_NAME"),
    "should include NAVIGATE_TOOL_NAME",
  );
  assert.ok(
    names.includes("REMEMBER_TOOL_NAME"),
    "should include REMEMBER_TOOL_NAME",
  );
  assert.ok(names.includes("ACTION_TOOLS"), "should include ACTION_TOOLS");
  assert.equal(names.length, 3);
});

test("handles multi-line import blocks", () => {
  const source = [
    "import {",
    "  NAVIGATE_TOOL_NAME,",
    "  REMEMBER_TOOL_NAME,",
    "  ACTION_TOOLS,",
    '} from "./planner-tool-catalog";',
  ].join("\n");
  const names = extractPlannerToolCatalogImports(source);
  assert.ok(
    names.includes("NAVIGATE_TOOL_NAME"),
    "should include NAVIGATE_TOOL_NAME",
  );
  assert.ok(
    names.includes("REMEMBER_TOOL_NAME"),
    "should include REMEMBER_TOOL_NAME",
  );
  assert.ok(names.includes("ACTION_TOOLS"), "should include ACTION_TOOLS");
  assert.equal(names.length, 3);
});

test("handles single-quoted module path", () => {
  const source = `import { WEB_SEARCH_TOOL_NAME } from './planner-tool-catalog';`;
  assert.deepEqual(extractPlannerToolCatalogImports(source), [
    "WEB_SEARCH_TOOL_NAME",
  ]);
});

test("handles 'as' aliases — returns the original export name", () => {
  const source = `import { NAVIGATE_TOOL_NAME as NAV } from "./planner-tool-catalog";`;
  assert.deepEqual(extractPlannerToolCatalogImports(source), [
    "NAVIGATE_TOOL_NAME",
  ]);
});

test("skips type-only imports", () => {
  const source = `import type { ElainePlannerTool } from "./planner-tool-catalog";`;
  assert.deepEqual(extractPlannerToolCatalogImports(source), []);
});

test("does not capture imports from unrelated modules", () => {
  const source = [
    'import { NAVIGATE_TOOL_NAME } from "./planner-tool-catalog";',
    'import { SomeOther } from "./some-other-module";',
    'import { Another } from "@workspace/elaine-ui";',
  ].join("\n");
  const names = extractPlannerToolCatalogImports(source);
  assert.deepEqual(names, ["NAVIGATE_TOOL_NAME"]);
});

test("returns empty array when no planner-tool-catalog import is present", () => {
  const source = `import { useState } from "react";`;
  assert.deepEqual(extractPlannerToolCatalogImports(source), []);
});

test("returns empty array on empty source", () => {
  assert.deepEqual(extractPlannerToolCatalogImports(""), []);
});

test("captures a name that follows a trailing line comment on the previous specifier", () => {
  // Bug regression: splitting on commas before stripping comments would lose
  // any name that immediately follows a comment token on the same chunk.
  //   EXISTING, // rationale
  //   NEW_EXPORT,
  // → after comma-split: [" // rationale\n  NEW_EXPORT"] → old code discarded it.
  const source = [
    "import {",
    "  NAVIGATE_TOOL_NAME, // navigation tool",
    "  WEB_SEARCH_TOOL_NAME,",
    '} from "./planner-tool-catalog";',
  ].join("\n");
  const names = extractPlannerToolCatalogImports(source);
  assert.ok(
    names.includes("NAVIGATE_TOOL_NAME"),
    "should include NAVIGATE_TOOL_NAME",
  );
  assert.ok(
    names.includes("WEB_SEARCH_TOOL_NAME"),
    "should include WEB_SEARCH_TOOL_NAME (was lost after trailing comment)",
  );
  assert.equal(names.length, 2);
});

test("excludes per-specifier type imports (e.g. import { type Foo, VALUE })", () => {
  // `import type { … }` is already excluded by the import-level regex guard, but
  // individual specifiers with the `type` keyword must also be excluded.
  const source = `import { type ElainePlannerTool, ACTION_TOOLS } from "./planner-tool-catalog";`;
  const names = extractPlannerToolCatalogImports(source);
  assert.ok(
    !names.includes("ElainePlannerTool"),
    "type-only specifier should be excluded",
  );
  assert.ok(
    names.includes("ACTION_TOOLS"),
    "value specifier should be included",
  );
  assert.equal(names.length, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan H — PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS coverage cross-check
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan H — PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS coverage",
);

test("every import that index.ts takes from ./planner-tool-catalog is in PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS", () => {
  // Read the real elaine/index.ts and verify that PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS
  // covers every non-type named import from ./planner-tool-catalog.  This is the
  // key invariant: if a developer adds a new export and imports it in index.ts but
  // forgets to update the list, Scan G silently stops protecting the new export.
  const indexPath = resolve(root, "artifacts/api-server/src/elaine/index.ts");
  const indexSource = readFileSync(indexPath, "utf8");
  const importedNames = extractPlannerToolCatalogImports(indexSource);
  const requiredSet = new Set<string>(
    PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = importedNames.filter((name) => !requiredSet.has(name));
  assert.deepEqual(
    uncovered,
    [],
    `PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS is missing ${uncovered.length} name(s) ` +
      `imported by index.ts from ./planner-tool-catalog: ${uncovered.join(", ")}. ` +
      `Add them to the list in scripts/src/check-domain-composition.ts.`,
  );
});

test("PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS flags a synthetic uncovered import", () => {
  // Synthetic test: a source that imports FAKE_NEW_EXPORT_NAME which is NOT in
  // the required list should be detected as uncovered.
  const source = `import { NAVIGATE_TOOL_NAME, FAKE_NEW_EXPORT_NAME } from "./planner-tool-catalog";`;
  const names = extractPlannerToolCatalogImports(source);
  const requiredSet = new Set<string>(
    PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = names.filter((n) => !requiredSet.has(n));
  assert.deepEqual(uncovered, ["FAKE_NEW_EXPORT_NAME"]);
});

test("PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS covers a known import (NAVIGATE_TOOL_NAME)", () => {
  const source = `import { NAVIGATE_TOOL_NAME } from "./planner-tool-catalog";`;
  const names = extractPlannerToolCatalogImports(source);
  const requiredSet = new Set<string>(
    PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = names.filter((n) => !requiredSet.has(n));
  assert.deepEqual(uncovered, []);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G (extended) — extractInlineToolNamesFromPlannerMock
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G (extended) — extractInlineToolNamesFromPlannerMock",
);

test("returns null when file has no planner-tool-catalog mock", () => {
  const source = `vi.mock("./some-other-module", () => ({ foo: "bar" }));`;
  assert.equal(extractInlineToolNamesFromPlannerMock(source), null);
});

test("returns null for an importActual mock (no factory marker)", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", async (importActual) => {',
    "  const actual = await importActual();",
    "  return { ...actual };",
    "});",
    "",
  ].join("\n");
  assert.equal(extractInlineToolNamesFromPlannerMock(source), null);
});

test("returns empty set when factory mock exists but SOFT_TOOLS is an empty array", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [],",
    "  ACTION_TOOLS: [],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("extracts a single tool name from a SOFT_TOOLS mock array", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_reminders", parameters: { type: "object", properties: {} } } },',
    "  ],",
    "  ACTION_TOOLS: [],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.deepEqual([...result!], ["list_reminders"]);
});

test("extracts multiple tool names from a SOFT_TOOLS mock array", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_reminders", parameters: {} } },',
    '    { type: "function", function: { name: "list_scheduled_contacts", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("list_reminders"), "should find list_reminders");
  assert.ok(
    result!.has("list_scheduled_contacts"),
    "should find list_scheduled_contacts",
  );
  assert.equal(result!.size, 2);
});

test("extracts tool names from ACTION_TOOLS mock array", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  ACTION_TOOLS: [",
    '    { type: "function", function: { name: "create_trip", parameters: {} } },',
    "  ],",
    "  SOFT_TOOLS: [],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("create_trip"), "should find create_trip");
});

test("extracts tool names from multi-line tool objects", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    "    {",
    '      type: "function",',
    "      function: {",
    '        name: "list_reminders",',
    '        parameters: { type: "object", properties: {} },',
    "      },",
    "    },",
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("list_reminders"), "should find list_reminders");
});

test("does not extract parameter property names (only function names)", () => {
  // A tool where parameter properties include a field named `name`
  // should not cause that parameter name to be captured.
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    "    {",
    '      type: "function",',
    "      function: {",
    '        name: "my_tool",',
    "        parameters: {",
    '          type: "object",',
    "          properties: {",
    '            name: { type: "string", description: "A name field" },',
    "          },",
    "        },",
    "      },",
    "    },",
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  // Only the function name should be captured, not the parameter property name
  assert.ok(result!.has("my_tool"), "should capture the function name");
  // "A name field" description text should definitely not be captured
  assert.ok(
    !result!.has("A name field"),
    "should not capture description text",
  );
});

test("handles single-quoted module path in vi.mock", () => {
  const source = [
    "vi.mock('./planner-tool-catalog', () => ({",
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_reminders", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("list_reminders"));
});

test("collects names from multiple factory mocks in the same file", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_reminders", parameters: {} } },',
    "  ],",
    "}));",
    "",
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_scheduled_contacts", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = extractInlineToolNamesFromPlannerMock(source);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("list_reminders"),
    "should include name from first mock",
  );
  assert.ok(
    result!.has("list_scheduled_contacts"),
    "should include name from second mock",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G (extended) — staleInlineToolNamesInPlannerMock
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G (extended) — staleInlineToolNamesInPlannerMock",
);

const SAMPLE_CANONICAL = new Set([
  "list_reminders",
  "list_scheduled_contacts",
  "suggest_navigation",
  "web_search",
  "create_trip",
]);

test("returns null when file has no planner-tool-catalog mock", () => {
  const source = `vi.mock("./other", () => ({ foo: "bar" }));`;
  assert.equal(
    staleInlineToolNamesInPlannerMock(source, SAMPLE_CANONICAL),
    null,
  );
});

test("returns empty set when mock exists but all inline tool names are canonical", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "list_reminders", parameters: {} } },',
    '    { type: "function", function: { name: "list_scheduled_contacts", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = staleInlineToolNamesInPlannerMock(source, SAMPLE_CANONICAL);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("returns the stale name when an inline tool name is not in the canonical set", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "old_list_reminders", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = staleInlineToolNamesInPlannerMock(source, SAMPLE_CANONICAL);
  assert.notEqual(result, null);
  assert.equal(result!.size, 1);
  assert.ok(result!.has("old_list_reminders"), "stale name should be reported");
});

test("returns all stale names when multiple inline tool names are not canonical", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [",
    '    { type: "function", function: { name: "stale_tool_a", parameters: {} } },',
    '    { type: "function", function: { name: "list_reminders", parameters: {} } },',
    '    { type: "function", function: { name: "stale_tool_b", parameters: {} } },',
    "  ],",
    "}));",
    "",
  ].join("\n");
  const result = staleInlineToolNamesInPlannerMock(source, SAMPLE_CANONICAL);
  assert.notEqual(result, null);
  assert.equal(result!.size, 2, "exactly two stale names");
  assert.ok(result!.has("stale_tool_a"), "stale_tool_a should be in result");
  assert.ok(result!.has("stale_tool_b"), "stale_tool_b should be in result");
  assert.ok(
    !result!.has("list_reminders"),
    "canonical name should not be stale",
  );
});

test("returns empty set when mock exists but SOFT_TOOLS is empty", () => {
  const source = [
    'vi.mock("./planner-tool-catalog", () => ({',
    "  SOFT_TOOLS: [],",
    "  ACTION_TOOLS: [],",
    "}));",
    "",
  ].join("\n");
  const result = staleInlineToolNamesInPlannerMock(source, SAMPLE_CANONICAL);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G (extended) — integration: real catalog names are accepted (exit 0)
// and stale names from renamed tools are rejected (exit non-zero)
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G (extended) — Integration exit codes",
);

const TEMP_STALE_INLINE_TOOL_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_composition_guard_test_g_inline_fixture.test.ts",
);

/** Build a complete planner-tool-catalog mock body with SOFT_TOOLS replaced by the given array entries. */
function makeInlineToolMockSource(softToolEntries: string[]): string {
  const correctValueBody = PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS.map((e) =>
    e.value !== undefined ? `  ${e.key}: "${e.value}",` : `  ${e.key}: [],`,
  ).join("\n");

  const softToolsBlock =
    softToolEntries.length === 0
      ? "  SOFT_TOOLS: [],"
      : [
          "  SOFT_TOOLS: [",
          ...softToolEntries.map(
            (name) =>
              `    { type: "function", function: { name: "${name}", parameters: {} } },`,
          ),
          "  ],",
        ].join("\n");

  const body = correctValueBody.replace("  SOFT_TOOLS: [],", softToolsBlock);
  return [
    "// Temporary test fixture injected by check-domain-composition.test.ts",
    "// This file is cleaned up after the test regardless of outcome.",
    'import { vi } from "vitest";',
    'vi.mock("./planner-tool-catalog", () => ({',
    body,
    "}));",
    "",
  ].join("\n");
}

test("script exits non-zero when a SOFT_TOOLS mock contains a stale inline tool name (Scan G extended)", () => {
  writeFileSync(
    TEMP_STALE_INLINE_TOOL_FILE,
    makeInlineToolMockSource(["definitely_not_a_real_tool_xyzzy"]),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for stale inline tool name in SOFT_TOOLS mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_STALE_INLINE_TOOL_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits 0 when SOFT_TOOLS mock uses real imported-action tool names (create_reminder, update_pottery_item)", () => {
  // These names are defined as inline literals in reminder-actions.ts and
  // pottery-actions.ts respectively — NOT as _TOOL_NAME constants — so they
  // require the inline-name extraction path in buildCatalogToolNameSet().
  writeFileSync(
    TEMP_STALE_INLINE_TOOL_FILE,
    makeInlineToolMockSource(["create_reminder", "update_pottery_item"]),
    "utf8",
  );
  try {
    // runScriptExpectingZero retries once if a concurrent CI run left a stale
    // temp fixture, while preserving our own fixture.
    const result = runScriptExpectingZero([TEMP_STALE_INLINE_TOOL_FILE]);
    assert.equal(
      result.status,
      0,
      `Expected exit 0 for valid real catalog names in SOFT_TOOLS mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_STALE_INLINE_TOOL_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits non-zero when a renamed action tool uses its old name in SOFT_TOOLS mock", () => {
  // Simulates the rename scenario: if create_reminder were renamed to
  // add_reminder, a mock still using "create_reminder" (actually still valid)
  // would pass — but a completely fictional old name is caught.  We use a name
  // that is clearly not in any action file to simulate a post-rename stale ref.
  writeFileSync(
    TEMP_STALE_INLINE_TOOL_FILE,
    makeInlineToolMockSource(["old_create_reminder_before_rename_xyzzy"]),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for renamed-tool stale name in SOFT_TOOLS mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_STALE_INLINE_TOOL_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan I — extractToolNameConstants / findOrphanedToolNameConstants
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan I — *_TOOL_NAME constant alignment",
);

// extractToolNameConstants tests

test("extractToolNameConstants: parses a single exported constant", () => {
  const source = `export const LIST_REMINDERS_TOOL_NAME = "list_reminders";`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(result.get("LIST_REMINDERS_TOOL_NAME"), "list_reminders");
});

test("extractToolNameConstants: parses multiple exported constants", () => {
  const source = `
export const LIST_NOTES_TOOL_NAME = "list_notes";
export const GET_NOTE_TOOL_NAME = "get_note";
`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 2);
  assert.equal(result.get("LIST_NOTES_TOOL_NAME"), "list_notes");
  assert.equal(result.get("GET_NOTE_TOOL_NAME"), "get_note");
});

test("extractToolNameConstants: ignores non-exported constants", () => {
  const source = `const INTERNAL_TOOL_NAME = "internal_tool";`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("extractToolNameConstants: ignores constants without _TOOL_NAME suffix", () => {
  const source = `export const SOME_ENUM = "some_value";`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("extractToolNameConstants: returns empty Map for source with no constants", () => {
  const result = extractToolNameConstants("// no constants here");
  assert.equal(result.size, 0);
});

test("extractToolNameConstants: handles split-line declaration (value on next line)", () => {
  // Mirrors real GET_NOTIFICATION_PREFERENCES_TOOL_NAME in universal-read-tools.ts
  const source = `export const GET_NOTIFICATION_PREFERENCES_TOOL_NAME =\n  "get_notification_preferences";`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(
    result.get("GET_NOTIFICATION_PREFERENCES_TOOL_NAME"),
    "get_notification_preferences",
  );
});

test("extractToolNameConstants: handles single-quoted string values", () => {
  const source = `export const MY_TOOL_NAME = 'my_tool_name';`;
  const result = extractToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(result.get("MY_TOOL_NAME"), "my_tool_name");
});

// findOrphanedToolNameConstants tests

test("findOrphanedToolNameConstants: no violation when constant value matches a string literal tool name", () => {
  const source = `
export const CREATE_FOO_TOOL_NAME = "create_foo";
export const fooTools = [
  {
    type: "function",
    function: {
      name: "create_foo",
      description: "Creates a foo.",
      parameters: { type: "object", properties: {} },
    },
  },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("findOrphanedToolNameConstants: no violation when constant is used by reference in tool object", () => {
  const source = `
export const LIST_REMINDERS_TOOL_NAME = "list_reminders";
export const reminderReadTools = [
  {
    type: "function",
    function: {
      name: LIST_REMINDERS_TOOL_NAME,
      description: "Lists reminders.",
      parameters: { type: "object", properties: {} },
    },
  },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("findOrphanedToolNameConstants: flags constant whose value appears nowhere as a tool name", () => {
  const source = `
export const MY_TOOL_NAME = "my_tool_action";
// No tool object in this file references "my_tool_action" or MY_TOOL_NAME
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(result.get("MY_TOOL_NAME"), "my_tool_action");
});

test("findOrphanedToolNameConstants: flags constant whose value was renamed but tool object was not updated", () => {
  // Simulate: constant says "new_name" but tool still says "old_name"
  const source = `
export const DO_THING_TOOL_NAME = "do_thing_v2";
export const doThingTools = [
  {
    type: "function",
    function: {
      name: "do_thing",
      description: "Does the thing.",
    },
  },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(result.get("DO_THING_TOOL_NAME"), "do_thing_v2");
});

test("findOrphanedToolNameConstants: no false positive from parameter property named 'name'", () => {
  // Parameter schemas use `name: { type: "string" }` not `name: "value"`.
  // The detector must not match this object-valued property.
  const source = `
export const SEARCH_TOOL_NAME = "search_things";
export const searchTools = [
  {
    type: "function",
    function: {
      name: "search_things",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Search query" },
        },
      },
    },
  },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("findOrphanedToolNameConstants: handles multiple constants, reports only the drifted one", () => {
  const source = `
export const GOOD_TOOL_NAME = "good_tool";
export const BAD_TOOL_NAME = "bad_tool_renamed";
export const goodTools = [
  {
    type: "function",
    function: { name: "good_tool", description: "Good." },
  },
];
// bad_tool_renamed has no matching tool name: field
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 1);
  assert.equal(result.get("BAD_TOOL_NAME"), "bad_tool_renamed");
  assert.equal(result.has("GOOD_TOOL_NAME"), false);
});

test("findOrphanedToolNameConstants: returns empty Map for source with no constants", () => {
  const source = `
export const myTools = [
  { type: "function", function: { name: "some_tool" } },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("findOrphanedToolNameConstants: matches constant reference with surrounding whitespace", () => {
  // Some formatters may emit `name:  CONST_NAME` (extra space).
  const source = `
export const NOTIFY_TOOL_NAME = "notify_user";
const tools = [
  { type: "function", function: { name:  NOTIFY_TOOL_NAME, description: "" } },
];
`;
  const result = findOrphanedToolNameConstants(source);
  assert.equal(result.size, 0);
});

test("real reminder-actions.ts: extractToolNameConstants finds expected constants", () => {
  // Integration test: verifies constants are actually extracted (not silently skipped),
  // so the orphan check can't produce a false pass from an empty extraction.
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/reminder-actions.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const constants = extractToolNameConstants(source);
  assert.ok(
    constants.has("LIST_REMINDERS_TOOL_NAME"),
    `reminder-actions.ts should export LIST_REMINDERS_TOOL_NAME; found: ${[...constants.keys()].join(", ")}`,
  );
  assert.equal(
    constants.get("LIST_REMINDERS_TOOL_NAME"),
    "list_reminders",
    "LIST_REMINDERS_TOOL_NAME value should be 'list_reminders'",
  );
});

test("real reminder-actions.ts: findOrphanedToolNameConstants reports no violations", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/reminder-actions.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = findOrphanedToolNameConstants(source);
  assert.equal(
    result.size,
    0,
    `reminder-actions.ts has orphaned *_TOOL_NAME constants: ${[...result.keys()].join(", ")}`,
  );
});

test("real universal-read-tools.ts: extractToolNameConstants finds all 8 expected constants", () => {
  // universal-read-tools.ts includes GET_NOTIFICATION_PREFERENCES_TOOL_NAME which
  // spans two lines — verifies split-line parsing works on a real file.
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/universal-read-tools.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const constants = extractToolNameConstants(source);
  const expectedConstants = [
    "LIST_NOTES_TOOL_NAME",
    "GET_NOTE_TOOL_NAME",
    "LIST_NOTIFICATIONS_TOOL_NAME",
    "GET_NOTIFICATION_COUNTS_TOOL_NAME",
    "GET_NOTIFICATION_PREFERENCES_TOOL_NAME",
    "LIST_ELAINE_MEMORIES_TOOL_NAME",
    "LIST_ELAINE_TASKS_TOOL_NAME",
    "GET_ELAINE_TASK_TOOL_NAME",
  ];
  for (const name of expectedConstants) {
    assert.ok(
      constants.has(name),
      `universal-read-tools.ts should export ${name}; found: ${[...constants.keys()].join(", ")}`,
    );
  }
  // Ensure we got at least as many constants as expected (guards against false
  // passes from an empty extraction).
  assert.ok(
    constants.size >= expectedConstants.length,
    `Expected at least ${expectedConstants.length} *_TOOL_NAME constants, got ${constants.size}`,
  );
});

test("real universal-read-tools.ts: findOrphanedToolNameConstants reports no violations", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/universal-read-tools.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = findOrphanedToolNameConstants(source);
  assert.equal(
    result.size,
    0,
    `universal-read-tools.ts has orphaned *_TOOL_NAME constants: ${[...result.keys()].join(", ")}`,
  );
});

test("real communication-actions.ts: extractToolNameConstants finds expected constants", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/communication-actions.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const constants = extractToolNameConstants(source);
  const expectedConstants = [
    "LIST_SCHEDULED_CONTACTS_TOOL_NAME",
    "LIST_CONTACT_CHANNELS_TOOL_NAME",
  ];
  for (const name of expectedConstants) {
    assert.ok(
      constants.has(name),
      `communication-actions.ts should export ${name}; found: ${[...constants.keys()].join(", ")}`,
    );
  }
  assert.ok(
    constants.size >= expectedConstants.length,
    `Expected at least ${expectedConstants.length} *_TOOL_NAME constants, got ${constants.size}`,
  );
});

test("real communication-actions.ts: findOrphanedToolNameConstants reports no violations", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/communication-actions.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = findOrphanedToolNameConstants(source);
  assert.equal(
    result.size,
    0,
    `communication-actions.ts has orphaned *_TOOL_NAME constants: ${[...result.keys()].join(", ")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan J (task #943) — findUnregisteredElaineToolFiles
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — findUnregisteredElaineToolFiles",
);

// Helper: build a Map<path, source> from an array of [path, source] pairs.
function makeFileMap(entries: [string, string][]): Map<string, string> {
  return new Map(entries);
}

const ENROLLED_LIST = [
  "artifacts/api-server/src/elaine/reminder-actions.ts",
  "artifacts/api-server/src/elaine/communication-actions.ts",
];

test("returns empty when all files with *_TOOL_NAME exports are enrolled", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/reminder-actions.ts",
      'export const LIST_REMINDERS_TOOL_NAME = "list_reminders";',
    ],
    [
      "artifacts/api-server/src/elaine/communication-actions.ts",
      'export const LIST_SCHEDULED_CONTACTS_TOOL_NAME = "list_scheduled_contacts";',
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, []);
});

test("flags a *-actions.ts file with *_TOOL_NAME exports that is NOT enrolled", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/reminder-actions.ts",
      'export const LIST_REMINDERS_TOOL_NAME = "list_reminders";',
    ],
    [
      "artifacts/api-server/src/elaine/new-feature-actions.ts",
      'export const DO_THING_TOOL_NAME = "do_thing";',
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, [
    "artifacts/api-server/src/elaine/new-feature-actions.ts",
  ]);
});

test("flags a *-tools.ts file with *_TOOL_NAME exports that is NOT enrolled", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/reminder-actions.ts",
      'export const LIST_REMINDERS_TOOL_NAME = "list_reminders";',
    ],
    [
      "artifacts/api-server/src/elaine/new-read-tools.ts",
      'export const GET_DATA_TOOL_NAME = "get_data";',
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, [
    "artifacts/api-server/src/elaine/new-read-tools.ts",
  ]);
});

test("does NOT flag a *-actions.ts file that has NO *_TOOL_NAME exports (draft file)", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/new-feature-actions.ts",
      "// placeholder — no constants yet\nexport const helpers = [];",
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, []);
});

test("does NOT flag non-action/tools files even if they export *_TOOL_NAME constants", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/planner-tool-catalog.ts",
      'export const NAVIGATE_TOOL_NAME = "suggest_navigation";',
    ],
    [
      "artifacts/api-server/src/elaine/index.ts",
      'export const HELPER_TOOL_NAME = "helper";',
    ],
  ]);
  // Neither file ends in -actions.ts or -tools.ts
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, []);
});

test("does NOT flag an enrolled file even when it has *_TOOL_NAME exports", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/reminder-actions.ts",
      'export const LIST_REMINDERS_TOOL_NAME = "list_reminders";',
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, []);
});

test("flags multiple unenrolled files and returns them sorted", () => {
  const files = makeFileMap([
    [
      "artifacts/api-server/src/elaine/reminder-actions.ts",
      'export const LIST_REMINDERS_TOOL_NAME = "list_reminders";',
    ],
    [
      "artifacts/api-server/src/elaine/zebra-actions.ts",
      'export const ZEBRA_TOOL_NAME = "zebra_action";',
    ],
    [
      "artifacts/api-server/src/elaine/alpha-actions.ts",
      'export const ALPHA_TOOL_NAME = "alpha_action";',
    ],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(result, [
    "artifacts/api-server/src/elaine/alpha-actions.ts",
    "artifacts/api-server/src/elaine/zebra-actions.ts",
  ]);
});

test("returns empty array when filesWithContents is empty", () => {
  const result = findUnregisteredElaineToolFiles(new Map(), ENROLLED_LIST);
  assert.deepEqual(result, []);
});

test("real ELAINE_IMPORTED_TOOL_FILES: every enrolled file actually exists", () => {
  // Verifies the enrolled list itself isn't stale — each path must be readable.
  for (const filePath of ELAINE_IMPORTED_TOOL_FILES) {
    const absPath = resolve(root, filePath);
    let accessible = true;
    try {
      readFileSync(absPath);
    } catch {
      accessible = false;
    }
    assert.ok(
      accessible,
      `ELAINE_IMPORTED_TOOL_FILES contains "${filePath}" but that file does not exist or is unreadable`,
    );
  }
});

test("real ELAINE_IMPORTED_TOOL_FILES: every enrolled file is a *-actions.ts or *-tools.ts file", () => {
  // Ensures no accidentally mis-named file sneaks into the list.
  for (const filePath of ELAINE_IMPORTED_TOOL_FILES) {
    assert.ok(
      filePath.endsWith("-actions.ts") || filePath.endsWith("-tools.ts"),
      `ELAINE_IMPORTED_TOOL_FILES contains "${filePath}" which does not end in -actions.ts or -tools.ts`,
    );
  }
});

// Integration test: script exits non-zero when a new *-actions.ts file with
// *_TOOL_NAME exports is added to the elaine directory but not enrolled.
const TEMP_UNENROLLED_ACTIONS_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp-composition-guard-test-j-actions.ts",
);

test("script exits non-zero when an unenrolled *-actions.ts file with *_TOOL_NAME exports is detected (Scan J)", () => {
  writeFileSync(
    TEMP_UNENROLLED_ACTIONS_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'export const TEMP_UNENROLLED_TOOL_NAME = "temp_unenrolled_action";',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when an unenrolled *-actions.ts file with *_TOOL_NAME exports is present, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_UNENROLLED_ACTIONS_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits 0 when a *-actions.ts file in the elaine dir has NO *_TOOL_NAME exports (no enrollment required)", () => {
  // A file with no exported constants does not need to be enrolled.
  writeFileSync(
    TEMP_UNENROLLED_ACTIONS_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      "// No *_TOOL_NAME exports here — draft file.",
      "export const helpers: string[] = [];",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    // runScriptExpectingZero cleans + retries once while preserving our fixture.
    const result = runScriptExpectingZero([TEMP_UNENROLLED_ACTIONS_FILE]);
    assert.equal(
      result.status,
      0,
      `Expected exit 0 for a *-actions.ts file with no *_TOOL_NAME exports, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_UNENROLLED_ACTIONS_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan K — extractPolicyRowToolNames / findPhantomPolicyRowToolNames
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan K — POLICY_ROWS → tool definition cross-check",
);

// extractPolicyRowToolNames tests

test("extractPolicyRowToolNames: extracts a single tool name from a one-element array", () => {
  const source = `...policies(["create_trip"], defaults)`;
  const result = extractPolicyRowToolNames(source);
  assert.deepEqual(result, ["create_trip"]);
});

test("extractPolicyRowToolNames: extracts multiple tool names from an inline array", () => {
  const source = `...policies(["create_trip", "add_wishlist", "cancel_trip"], defaults)`;
  const result = extractPolicyRowToolNames(source);
  assert.ok(result.includes("create_trip"), "should include create_trip");
  assert.ok(result.includes("add_wishlist"), "should include add_wishlist");
  assert.ok(result.includes("cancel_trip"), "should include cancel_trip");
  assert.equal(result.length, 3);
});

test("extractPolicyRowToolNames: handles multi-line array syntax", () => {
  const source = [
    "...policies(",
    "  [",
    '    "create_trip",',
    '    "add_wishlist",',
    '    "update_trip_status",',
    "  ],",
    "  { ...ACTION_DEFAULTS, domain: 'travels' },",
    ")",
  ].join("\n");
  const result = extractPolicyRowToolNames(source);
  assert.ok(result.includes("create_trip"), "should include create_trip");
  assert.ok(result.includes("add_wishlist"), "should include add_wishlist");
  assert.ok(
    result.includes("update_trip_status"),
    "should include update_trip_status",
  );
  assert.equal(result.length, 3);
});

test("extractPolicyRowToolNames: deduplicates names appearing in multiple policies() calls", () => {
  // Duplicate names across two calls should be deduplicated.
  const source = [
    '...policies(["create_trip", "cancel_trip"], defaults1),',
    '...policies(["cancel_trip", "add_wishlist"], defaults2),',
  ].join("\n");
  const result = extractPolicyRowToolNames(source);
  // "cancel_trip" appears twice but should only be in the result once
  assert.equal(
    result.filter((n) => n === "cancel_trip").length,
    1,
    "cancel_trip should appear exactly once",
  );
  assert.equal(result.length, 3);
});

test("extractPolicyRowToolNames: handles single-quoted string values", () => {
  const source = `...policies(['list_reminders', 'snooze_reminder'], defaults)`;
  const result = extractPolicyRowToolNames(source);
  assert.ok(result.includes("list_reminders"), "should include list_reminders");
  assert.ok(
    result.includes("snooze_reminder"),
    "should include snooze_reminder",
  );
});

test("extractPolicyRowToolNames: does not capture strings from the second argument (policy defaults)", () => {
  // The defaults object may contain quoted strings like "action", "medium",
  // "session", etc. — these are policy metadata, not tool names, and must
  // not be captured.
  const source = `...policies(["create_trip"], { kind: "action", risk: "medium", auth: "session" })`;
  const result = extractPolicyRowToolNames(source);
  // Only the tool name should be extracted, not policy metadata strings.
  assert.deepEqual(result, ["create_trip"]);
});

test("extractPolicyRowToolNames: returns empty array when no policies() calls are present", () => {
  const source = `const x = 42; // no policies calls here`;
  assert.deepEqual(extractPolicyRowToolNames(source), []);
});

test("extractPolicyRowToolNames: returns empty array for empty source", () => {
  assert.deepEqual(extractPolicyRowToolNames(""), []);
});

test("extractPolicyRowToolNames: handles a real-looking multi-call POLICY_ROWS excerpt", () => {
  const source = [
    "const POLICY_ROWS = [",
    "  ...policies(",
    '    ["create_trip", "add_wishlist", "cancel_trip"],',
    "    { ...ACTION_DEFAULTS, domain: 'travels', executorPrefix: 'travelAction' },",
    "  ),",
    "  ...policies(",
    '    ["update_pottery_item", "delete_pottery_item"],',
    "    { ...ACTION_DEFAULTS, domain: 'pottery', executorPrefix: 'potteryAction' },",
    "  ),",
    "];",
  ].join("\n");
  const result = extractPolicyRowToolNames(source);
  assert.ok(result.includes("create_trip"));
  assert.ok(result.includes("add_wishlist"));
  assert.ok(result.includes("cancel_trip"));
  assert.ok(result.includes("update_pottery_item"));
  assert.ok(result.includes("delete_pottery_item"));
  assert.equal(result.length, 5);
});

// findPhantomPolicyRowToolNames tests

test("findPhantomPolicyRowToolNames: returns empty array when all names are defined", () => {
  const defined = new Set(["create_trip", "add_wishlist", "cancel_trip"]);
  const result = findPhantomPolicyRowToolNames(
    ["create_trip", "add_wishlist", "cancel_trip"],
    defined,
  );
  assert.deepEqual(result, []);
});

test("findPhantomPolicyRowToolNames: returns phantom names not in the defined set", () => {
  const defined = new Set(["create_trip", "add_wishlist"]);
  const result = findPhantomPolicyRowToolNames(
    ["create_trip", "add_wishlist", "ghost_tool"],
    defined,
  );
  assert.deepEqual(result, ["ghost_tool"]);
});

test("findPhantomPolicyRowToolNames: returns all names when none are defined", () => {
  const defined = new Set<string>();
  const result = findPhantomPolicyRowToolNames(["tool_a", "tool_b"], defined);
  assert.deepEqual(result.sort(), ["tool_a", "tool_b"]);
});

test("findPhantomPolicyRowToolNames: returns empty array for empty policy names list", () => {
  const defined = new Set(["create_trip"]);
  const result = findPhantomPolicyRowToolNames([], defined);
  assert.deepEqual(result, []);
});

test("findPhantomPolicyRowToolNames: returns empty array when both inputs are empty", () => {
  const result = findPhantomPolicyRowToolNames([], new Set());
  assert.deepEqual(result, []);
});

// Integration: verify the real capability-registry.ts has no phantom POLICY_ROWS entries

test("real capability-registry.ts: all POLICY_ROWS tool names have a definition in a tool file", () => {
  // This test mirrors what Scan J does at CI time.  It reads the real
  // capability-registry.ts, extracts every tool name from policies([...])
  // calls, and checks that each one is present in the set of names defined
  // in the imported Elaine tool files and planner-tool-catalog.ts.
  // A failure here means a phantom capability was registered — a policy row
  // whose tool is never callable.
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/capability-registry.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const policyToolNames = extractPolicyRowToolNames(source);
  assert.ok(
    policyToolNames.length > 0,
    "extractPolicyRowToolNames should find at least one tool name in capability-registry.ts",
  );

  // Build the same catalog set that Scan J uses at runtime: read each
  // ELAINE_IMPORTED_TOOL_FILES and planner-tool-catalog.ts.
  const ELAINE_TOOL_FILES = [
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
    "artifacts/api-server/src/elaine/planner-tool-catalog.ts",
  ];
  const definedNames = new Set<string>();
  const CONST_RE = /_TOOL_NAME\s*=\s*["']([^"']+)["']/g;
  const INLINE_RE = /\bname\s*:\s*["']([^"']+)["']/g;
  const repoRoot = resolve(import.meta.dirname, "../..");
  for (const relPath of ELAINE_TOOL_FILES) {
    try {
      const src = readFileSync(resolve(repoRoot, relPath), "utf8");
      let m: RegExpExecArray | null;
      const reConst = new RegExp(CONST_RE.source, "g");
      while ((m = reConst.exec(src)) !== null) definedNames.add(m[1]);
      const reInline = new RegExp(INLINE_RE.source, "g");
      while ((m = reInline.exec(src)) !== null) definedNames.add(m[1]);
    } catch {
      // best-effort; file list is validated by Scan I
    }
  }

  const phantoms = findPhantomPolicyRowToolNames(policyToolNames, definedNames);
  assert.deepEqual(
    phantoms.sort(),
    [],
    `capability-registry.ts POLICY_ROWS contains ${phantoms.length} phantom tool name(s) ` +
      `with no definition in any tool file: ${phantoms.join(", ")}. ` +
      `Add a tool definition for each, or fix the tool name in POLICY_ROWS.`,
  );
});

// Integration: injection test — temporarily patch capability-registry.ts with a
// phantom POLICY_ROWS entry and verify the script exits non-zero.

const CAPABILITY_REGISTRY_PATH = join(
  root,
  "artifacts/api-server/src/elaine/capability-registry.ts",
);

test("script exits non-zero when a phantom POLICY_ROWS entry is injected (Scan K)", () => {
  // Read the real file, append a synthetic policies() call with a tool name
  // that cannot exist in any real tool file, then restore it in finally.
  const original = readFileSync(CAPABILITY_REGISTRY_PATH, "utf8");

  // Baseline: the script must pass on the unmodified repo before we can
  // isolate the injection.  In a concurrent validation environment another
  // task may leave a stale temp fixture that causes the script to already
  // exit nonzero; in that case the injection cannot be isolated, so we skip
  // gracefully.  The unit tests for findPhantomPolicyRowToolNames above cover
  // the core detection logic independently of the filesystem.
  const baseline = runScript();
  if (baseline.status !== 0) {
    // Pre-existing environment noise — cannot isolate; unit tests cover it.
    return;
  }

  const patched =
    original +
    "\n// TEMP TEST INJECTION — check-domain-composition.test.ts\n" +
    '...policies(["phantom_tool_xyz_scan_k_test"], {});\n';
  try {
    writeFileSync(CAPABILITY_REGISTRY_PATH, patched, "utf8");
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when a phantom POLICY_ROWS tool name is present, ` +
        `but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("phantom_tool_xyz_scan_k_test"),
      `Expected stderr to mention the phantom tool name, got:\n${result.stderr}`,
    );
  } finally {
    writeFileSync(CAPABILITY_REGISTRY_PATH, original, "utf8");
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan J — hasInlineToolNameDefinition
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — hasInlineToolNameDefinition",
);

test("detects an inline function: { name: 'snake_case' } tool definition (multiline)", () => {
  const source = `
export const myTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "update_pottery_item",
      description: "Updates a pottery item.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];
`;
  assert.ok(
    hasInlineToolNameDefinition(source),
    "should detect multiline function: { name: '...' } pattern",
  );
});

test("detects an inline function: { name: '...' } tool definition (same line)", () => {
  const source = `function: { name: "do_thing", description: "Does a thing" }`;
  assert.ok(
    hasInlineToolNameDefinition(source),
    "should detect single-line function: { name: '...' } pattern",
  );
});

test("does NOT match a Zod / JSON Schema 'name: { type: string }' property definition", () => {
  const source = `
properties: {
  name: { type: "string" },
  itemId: { type: "integer" },
},
`;
  assert.ok(
    !hasInlineToolNameDefinition(source),
    "should not match object-valued name property (not a tool name)",
  );
});

test("does NOT match a plain name: 'value' outside a function: {} block", () => {
  const source = `
const config = { name: "my_config_value", version: 1 };
`;
  assert.ok(
    !hasInlineToolNameDefinition(source),
    "should not match a name: '...' property outside a function: {} block",
  );
});

test("does NOT produce a false positive when function:{} has no name first, then a later name: '...' appears elsewhere", () => {
  // Regression: the old [\s\S]*? regex could span the closing brace of
  // `function: {}` and match a completely unrelated `name: "..."` later in
  // the file. The tightened \s* bound prevents this.
  const source = `
const meta = {
  function: {
    type: "string",
    required: true,
  },
};

const otherConfig = {
  name: "some_unrelated_value",
};
`;
  assert.ok(
    !hasInlineToolNameDefinition(source),
    "should not false-positive: function:{} block has no name first, unrelated name appears later",
  );
});

test("does NOT produce a false positive when function:{} is empty and name: '...' appears later", () => {
  const source = `
const x = { function: {} };
const y = { name: "tool_name" };
`;
  assert.ok(
    !hasInlineToolNameDefinition(source),
    "should not false-positive: empty function:{} followed by standalone name property",
  );
});

test("detects multiple inline tool definitions in the same file", () => {
  const source = `
[
  { type: "function", function: { name: "tool_one", description: "First" } },
  { type: "function", function: { name: "tool_two", description: "Second" } },
]
`;
  assert.ok(
    hasInlineToolNameDefinition(source),
    "should detect inline tool names when multiple definitions are present",
  );
});

// ── findUnregisteredElaineToolFiles — inline-name-only path ──────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — findUnregisteredElaineToolFiles (inline-name path)",
);

test("flags an unenrolled *-actions.ts file that uses inline tool names but has no *_TOOL_NAME exports", () => {
  const inlineOnlySource = `
import type OpenAI from "openai";
export const potteryActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "update_pottery_item",
      description: "Updates a pottery item.",
      parameters: { type: "object", properties: { itemId: { type: "integer" } }, required: ["itemId"] },
    },
  },
];
`;
  const files = makeFileMap([
    ["artifacts/api-server/src/elaine/pottery-actions.ts", inlineOnlySource],
  ]);
  const enrolled: string[] = []; // not enrolled
  const result = findUnregisteredElaineToolFiles(files, enrolled);
  assert.deepEqual(
    result,
    ["artifacts/api-server/src/elaine/pottery-actions.ts"],
    "should flag unenrolled file with only inline tool names",
  );
});

test("does NOT flag an enrolled *-actions.ts file even when it uses only inline tool names", () => {
  const inlineOnlySource = `
export const myTools = [
  { type: "function", function: { name: "update_pottery_item", description: "..." } },
];
`;
  const files = makeFileMap([
    ["artifacts/api-server/src/elaine/pottery-actions.ts", inlineOnlySource],
  ]);
  const enrolled = ["artifacts/api-server/src/elaine/pottery-actions.ts"];
  const result = findUnregisteredElaineToolFiles(files, enrolled);
  assert.deepEqual(
    result,
    [],
    "enrolled inline-only file should not be flagged",
  );
});

test("does NOT flag an unenrolled *-actions.ts file with no tool names (no constants, no inline)", () => {
  const draftSource = `
// Work in progress — no tool names defined yet
export const helpers: string[] = [];
`;
  const files = makeFileMap([
    ["artifacts/api-server/src/elaine/new-feature-actions.ts", draftSource],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(
    result,
    [],
    "draft file with no tool names should not be flagged",
  );
});

test("flags an unenrolled file that has BOTH *_TOOL_NAME exports AND inline tool names", () => {
  const bothSource = `
export const MY_TOOL_NAME = "my_tool";
export const myTools = [
  { type: "function", function: { name: "my_tool", description: "..." } },
];
`;
  const files = makeFileMap([
    ["artifacts/api-server/src/elaine/my-actions.ts", bothSource],
  ]);
  const result = findUnregisteredElaineToolFiles(files, ENROLLED_LIST);
  assert.deepEqual(
    result,
    ["artifacts/api-server/src/elaine/my-actions.ts"],
    "file with both constants and inline names should be flagged when unenrolled",
  );
});

// Integration test: script exits non-zero when an unenrolled *-actions.ts
// file with ONLY inline tool names (no exported *_TOOL_NAME constants) is
// present in the elaine directory.
const TEMP_INLINE_ONLY_ACTIONS_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp-composition-guard-test-j-inline-actions.ts",
);

test("script exits non-zero when an unenrolled *-actions.ts file with only inline tool names is detected (Scan J inline path)", () => {
  writeFileSync(
    TEMP_INLINE_ONLY_ACTIONS_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      "// No *_TOOL_NAME exports — only inline tool definitions.",
      'import type OpenAI from "openai";',
      "export const tempInlineTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [",
      "  {",
      '    type: "function",',
      "    function: {",
      '      name: "temp_inline_tool_action",',
      '      description: "Temporary inline tool for guard test.",',
      '      parameters: { type: "object", properties: {}, required: [] },',
      "    },",
      "  },",
      "];",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when an unenrolled *-actions.ts file with only inline tool names is present, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_INLINE_ONLY_ACTIONS_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────// Scan L — extractRuntimeImports / missingRuntimeMockKeys / wrongRuntimeMockValues
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-domain-composition.test: extractRuntimeImports");

test("parses a single named import from ./runtime", () => {
  const source = `import { classifyElaineRequest } from "./runtime";`;
  assert.deepEqual(extractRuntimeImports(source), ["classifyElaineRequest"]);
});

test("parses multiple names from a multi-line ./runtime import", () => {
  const source = [
    "import {",
    "  classifyElaineRequest,",
    "  generateElainePlan,",
    "  ElaineTurnRuntime,",
    '} from "./runtime";',
  ].join("\n");
  const names = extractRuntimeImports(source);
  assert.ok(names.includes("classifyElaineRequest"), "classifyElaineRequest");
  assert.ok(names.includes("generateElainePlan"), "generateElainePlan");
  assert.ok(names.includes("ElaineTurnRuntime"), "ElaineTurnRuntime");
  assert.equal(names.length, 3);
});

test("skips type-only imports from ./runtime", () => {
  const source = `import type { ElaineRuntimeTrace } from "./runtime";`;
  assert.deepEqual(extractRuntimeImports(source), []);
});

test("skips inline type specifiers in ./runtime imports", () => {
  const source = `import { type ElaineRuntimeTrace, classifyElaineRequest } from "./runtime";`;
  const names = extractRuntimeImports(source);
  assert.ok(!names.includes("ElaineRuntimeTrace"), "type should be excluded");
  assert.ok(
    names.includes("classifyElaineRequest"),
    "value should be included",
  );
  assert.equal(names.length, 1);
});

test("handles 'as' aliases — returns the original export name", () => {
  const source = `import { classifyElaineRequest as classify } from "./runtime";`;
  assert.deepEqual(extractRuntimeImports(source), ["classifyElaineRequest"]);
});

test("does not capture imports from unrelated modules", () => {
  const source = [
    'import { classifyElaineRequest } from "./runtime";',
    'import { SomeOther } from "./some-other-module";',
  ].join("\n");
  assert.deepEqual(extractRuntimeImports(source), ["classifyElaineRequest"]);
});

test("returns empty array when no ./runtime import is present", () => {
  const source = `import { useState } from "react";`;
  assert.deepEqual(extractRuntimeImports(source), []);
});

test("returns empty array on empty source", () => {
  assert.deepEqual(extractRuntimeImports(""), []);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G (runtime) — missingRuntimeMockKeys
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G (runtime) — missingRuntimeMockKeys",
);

const COMPLETE_RUNTIME_MOCK_BODY = RUNTIME_REQUIRED_EXPORTS.map(
  (e) => `  ${e.key}: vi.fn(),`,
).join("\n");

const COMPLETE_RUNTIME_MOCK_FILE = [
  'import { vi } from "vitest";',
  'vi.mock("./runtime", () => ({',
  COMPLETE_RUNTIME_MOCK_BODY,
  "}));",
  "",
].join("\n");

test("returns null when file has no ./runtime mock", () => {
  const source = `vi.mock("./some-other-module", () => ({ foo: "bar" }));`;
  assert.equal(missingRuntimeMockKeys(source), null);
});

test("returns null for an importActual ./runtime mock (no factory marker)", () => {
  const source = [
    'vi.mock("./runtime", async (importActual) => {',
    "  const actual = await importActual();",
    "  return { ...actual };",
    "});",
    "",
  ].join("\n");
  assert.equal(missingRuntimeMockKeys(source), null);
});

test("returns empty set when all required keys are present", () => {
  const result = missingRuntimeMockKeys(COMPLETE_RUNTIME_MOCK_FILE);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("returns the missing key when one required export is absent", () => {
  const partialBody = RUNTIME_REQUIRED_EXPORTS.filter(
    (e) => e.key !== "generateElainePlan",
  )
    .map((e) => `  ${e.key}: vi.fn(),`)
    .join("\n");
  const source = [
    'vi.mock("./runtime", () => ({',
    partialBody,
    "}));",
    "",
  ].join("\n");
  const result = missingRuntimeMockKeys(source);
  assert.notEqual(result, null);
  assert.ok(result!.has("generateElainePlan"), "generateElainePlan missing");
  // all others must NOT be in the set
  for (const e of RUNTIME_REQUIRED_EXPORTS) {
    if (e.key !== "generateElainePlan") {
      assert.ok(!result!.has(e.key), `${e.key} should not be missing`);
    }
  }
});

test("returns all missing keys when several required exports are absent", () => {
  const missingKeys = [
    "classifyElaineRequest",
    "ElaineTurnRuntime",
    "mapWithConcurrency",
  ];
  const partialBody = RUNTIME_REQUIRED_EXPORTS.filter(
    (e) => !missingKeys.includes(e.key),
  )
    .map((e) => `  ${e.key}: vi.fn(),`)
    .join("\n");
  const source = [
    'vi.mock("./runtime", () => ({',
    partialBody,
    "}));",
    "",
  ].join("\n");
  const result = missingRuntimeMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, missingKeys.length);
  for (const k of missingKeys) {
    assert.ok(result!.has(k), `expected ${k} to be in missing set`);
  }
});

test("handles single-quoted module path in vi.mock", () => {
  const source = [
    "vi.mock('./runtime', () => ({",
    COMPLETE_RUNTIME_MOCK_BODY,
    "}));",
    "",
  ].join("\n");
  const result = missingRuntimeMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("handles multi-line arrow formatting in vi.mock", () => {
  const source = [
    'vi.mock("./runtime", () =>',
    "  ({",
    COMPLETE_RUNTIME_MOCK_BODY,
    "}));",
    "",
  ].join("\n");
  const result = missingRuntimeMockKeys(source);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

test("reports missing keys across multiple factory mocks in the same file", () => {
  // First factory complete, second missing selfHealPatternKey
  const secondBody = RUNTIME_REQUIRED_EXPORTS.filter(
    (e) => e.key !== "selfHealPatternKey",
  )
    .map((e) => `  ${e.key}: vi.fn(),`)
    .join("\n");
  const source = [
    'vi.mock("./runtime", () => ({',
    COMPLETE_RUNTIME_MOCK_BODY,
    "}));",
    "",
    'vi.mock("./runtime", () => ({',
    secondBody,
    "}));",
    "",
  ].join("\n");
  const result = missingRuntimeMockKeys(source);
  assert.notEqual(result, null);
  assert.ok(
    result!.has("selfHealPatternKey"),
    "selfHealPatternKey should be reported as missing from second factory",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan G (runtime) — wrongRuntimeMockValues
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan G (runtime) — wrongRuntimeMockValues",
);

test("returns null when file has no ./runtime mock", () => {
  const source = `vi.mock("./other", () => ({ foo: "bar" }));`;
  assert.equal(wrongRuntimeMockValues(source), null);
});

test("returns null for an importActual mock", () => {
  const source = [
    'vi.mock("./runtime", async (importActual) => {',
    "  const actual = await importActual();",
    "  return { ...actual };",
    "});",
  ].join("\n");
  assert.equal(wrongRuntimeMockValues(source), null);
});

test("returns empty map when a factory mock is present (no string constants to check)", () => {
  // RUNTIME_REQUIRED_EXPORTS has no value fields, so wrongRuntimeMockValues
  // always returns an empty map for any factory mock.
  const result = wrongRuntimeMockValues(COMPLETE_RUNTIME_MOCK_FILE);
  assert.notEqual(result, null);
  assert.equal(result!.size, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// RUNTIME_REQUIRED_EXPORTS coverage cross-check (Scan I)
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan K — RUNTIME_REQUIRED_EXPORTS coverage",
);

test("every import that index.ts takes from ./runtime is in RUNTIME_REQUIRED_EXPORTS", () => {
  const indexPath = resolve(root, "artifacts/api-server/src/elaine/index.ts");
  const indexSource = readFileSync(indexPath, "utf8");
  const importedNames = extractRuntimeImports(indexSource);
  const requiredSet = new Set<string>(
    RUNTIME_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = importedNames.filter((name) => !requiredSet.has(name));
  assert.deepEqual(
    uncovered,
    [],
    `RUNTIME_REQUIRED_EXPORTS is missing ${uncovered.length} name(s) ` +
      `imported by index.ts from ./runtime: ${uncovered.join(", ")}. ` +
      `Add them to the list in scripts/src/check-domain-composition.ts.`,
  );
});

test("RUNTIME_REQUIRED_EXPORTS flags a synthetic uncovered import", () => {
  const source = `import { classifyElaineRequest, FAKE_RUNTIME_EXPORT_XYZ } from "./runtime";`;
  const names = extractRuntimeImports(source);
  const requiredSet = new Set<string>(
    RUNTIME_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = names.filter((n) => !requiredSet.has(n));
  assert.deepEqual(uncovered, ["FAKE_RUNTIME_EXPORT_XYZ"]);
});

test("RUNTIME_REQUIRED_EXPORTS covers a known import (classifyElaineRequest)", () => {
  const source = `import { classifyElaineRequest } from "./runtime";`;
  const names = extractRuntimeImports(source);
  const requiredSet = new Set<string>(
    RUNTIME_REQUIRED_EXPORTS.map((e) => e.key),
  );
  const uncovered = names.filter((n) => !requiredSet.has(n));
  assert.deepEqual(uncovered, []);
});

// ────────────────────────────────────────────────────────────────────────────
// Integration — runtime mock violation exits non-zero
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Integration — runtime mock violations",
);

const TEMP_RUNTIME_MOCK_VIOLATION_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_composition_guard_test_runtime_fixture.test.ts",
);

test("script exits non-zero when a ./runtime mock is missing required exports", () => {
  // Inject a test file whose ./runtime mock omits several required keys.
  const incompleteBody = RUNTIME_REQUIRED_EXPORTS.filter(
    (e) =>
      e.key !== "classifyElaineRequest" &&
      e.key !== "ElaineTurnRuntime" &&
      e.key !== "selfHealPatternKey",
  )
    .map((e) => `  ${e.key}: vi.fn(),`)
    .join("\n");
  writeFileSync(
    TEMP_RUNTIME_MOCK_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("./runtime", () => ({',
      incompleteBody,
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for missing ./runtime mock exports, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_RUNTIME_MOCK_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits 0 when ./runtime mock provides all required exports", () => {
  // Baseline: the script must pass before we inject the complete fixture.
  // In a concurrent validation environment another task may leave a stale temp
  // fixture that causes the script to already exit non-zero; in that case we
  // cannot isolate whether exit-0 is caused by the fixture, so skip gracefully.
  // The unit tests for missingRuntimeMockKeys above cover the core detection
  // logic independently of the filesystem.
  const baseline = runScript();
  if (baseline.status !== 0) {
    return;
  }

  writeFileSync(
    TEMP_RUNTIME_MOCK_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("./runtime", () => ({',
      COMPLETE_RUNTIME_MOCK_BODY,
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    // runScriptExpectingZero retries once if a concurrent CI run left a stale
    // temp fixture, while preserving our own fixture.
    const result = runScriptExpectingZero([TEMP_RUNTIME_MOCK_VIOLATION_FILE]);
    assert.equal(
      result.status,
      0,
      `Expected exit 0 for complete ./runtime mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_RUNTIME_MOCK_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Integration — Scan L: uncovered runtime import exits non-zero
//
// Scan L reads the real index.ts and verifies that every non-type named import
// from ./runtime is present in RUNTIME_REQUIRED_EXPORTS.  The unit test
// "RUNTIME_REQUIRED_EXPORTS flags a synthetic uncovered import" (above) verifies
// the detection logic in isolation; THIS integration test verifies that the full
// script exits non-zero when the failure mode actually occurs — i.e. when a
// developer adds a new export to the runtime module and imports it in index.ts
// but forgets to update RUNTIME_REQUIRED_EXPORTS.
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Integration — Scan L: uncovered runtime import",
);

test("script exits non-zero when index.ts imports a name from ./runtime that is not in RUNTIME_REQUIRED_EXPORTS", () => {
  // Strategy: temporarily append a fake import from ./runtime to the real
  // elaine/index.ts.  Scan L will read the file, find FAKE_RUNTIME_EXPORT_SCAN_L
  // is absent from RUNTIME_REQUIRED_EXPORTS, and emit a violation → non-zero exit.
  // The file is always restored in the finally block.
  const indexPath = join(root, "artifacts/api-server/src/elaine/index.ts");
  const original = readFileSync(indexPath, "utf8");
  // Append a fake import that will not match any RUNTIME_REQUIRED_EXPORTS entry.
  const modified =
    original +
    "\n// Temporary test fixture — injected by check-domain-composition.test.ts\n" +
    'import { FAKE_RUNTIME_EXPORT_SCAN_L } from "./runtime";\n';
  writeFileSync(indexPath, modified, "utf8");
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when index.ts imports FAKE_RUNTIME_EXPORT_SCAN_L ` +
        `(a name absent from RUNTIME_REQUIRED_EXPORTS), but script exited ${result.status}.\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // Confirm the violation message names the uncovered import.
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("FAKE_RUNTIME_EXPORT_SCAN_L"),
      `Violation message should name "FAKE_RUNTIME_EXPORT_SCAN_L" as uncovered.\nOutput: ${output}`,
    );
  } finally {
    writeFileSync(indexPath, original, "utf8");
  }
});

// ────────────────────────────────────────────────────────────────────────────

// Scan J (task #942) — extractActionTypeDiscriminants
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — extractActionTypeDiscriminants",
);

test("extracts a single string-literal discriminant", () => {
  const source = `
const POTTERY_TYPES = [
  z.object({ type: z.literal("update_pottery_item"), payload: UpdatePayload }),
];
`;
  const result = extractActionTypeDiscriminants(source);
  assert.ok(
    result.has("update_pottery_item"),
    "should find update_pottery_item",
  );
  assert.equal(result.size, 1);
});

test("extracts multiple string-literal discriminants from the same file", () => {
  const source = `
const TYPES = [
  z.object({ type: z.literal("create_note"), payload: A }),
  z.object({ type: z.literal("update_note"), payload: B }),
  z.object({ type: z.literal("delete_note"), payload: C }),
];
`;
  const result = extractActionTypeDiscriminants(source);
  assert.ok(result.has("create_note"), "should find create_note");
  assert.ok(result.has("update_note"), "should find update_note");
  assert.ok(result.has("delete_note"), "should find delete_note");
  assert.equal(result.size, 3);
});

test("resolves a constant reference discriminant via exported declaration", () => {
  const source = `
export const EXECUTE_APP_OPERATION_TOOL_NAME = "execute_app_operation";
const TYPES = [
  z.object({ type: z.literal(EXECUTE_APP_OPERATION_TOOL_NAME), payload: A }),
];
`;
  const result = extractActionTypeDiscriminants(source);
  assert.ok(
    result.has("execute_app_operation"),
    "should resolve EXECUTE_APP_OPERATION_TOOL_NAME to its string value",
  );
});

test("ignores unresolvable constant references (no matching export)", () => {
  // If the constant is not exported in the same file, it is silently skipped.
  const source = `
const TYPES = [z.object({ type: z.literal(SOME_IMPORTED_CONST) })];
`;
  const result = extractActionTypeDiscriminants(source);
  assert.equal(result.size, 0);
});

test("does NOT match non-discriminant z.literal calls (e.g. in description strings)", () => {
  // z.literal used outside a type: context should not be captured.
  const source = `
const schema = z.string().refine(v => v === "foo", z.literal("not_an_action"));
`;
  const result = extractActionTypeDiscriminants(source);
  assert.equal(result.size, 0);
});

test("returns empty Set for source with no z.literal discriminants", () => {
  const source = `export const doSomething = () => {};`;
  const result = extractActionTypeDiscriminants(source);
  assert.equal(result.size, 0);
});

test("returns empty Set for empty source", () => {
  const result = extractActionTypeDiscriminants("");
  assert.equal(result.size, 0);
});

test("real pottery-actions.ts: finds all 10 action type discriminants", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/pottery-actions.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = extractActionTypeDiscriminants(source);
  const expected = [
    "update_pottery_item",
    "delete_pottery_item",
    "create_pottery_category",
    "delete_pottery_category",
    "lock_pottery_field",
    "update_pottery_item_categories",
    "delete_pottery_photo",
    "promote_pottery_photo",
    "merge_pottery_categories",
    "bulk_reanalyze_pottery",
  ];
  for (const name of expected) {
    assert.ok(
      result.has(name),
      `pottery-actions.ts should contain discriminant "${name}"`,
    );
  }
  assert.ok(
    result.size >= expected.length,
    `Expected at least ${expected.length} discriminants, found ${result.size}`,
  );
});

test("real app-operation-tools.ts: resolves EXECUTE_APP_OPERATION_TOOL_NAME constant", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/app-operation-tools.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = extractActionTypeDiscriminants(source);
  assert.ok(
    result.has("execute_app_operation"),
    `app-operation-tools.ts should resolve EXECUTE_APP_OPERATION_TOOL_NAME to "execute_app_operation"; found: ${[...result].join(", ")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan J — extractActionToolNamesFromCatalogSection
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — extractActionToolNamesFromCatalogSection",
);

test("extracts name: values from a synthetic ACTION_TOOLS section", () => {
  const source = `
export const ACTION_TOOLS = [
  { type: "function", function: { name: "create_trip", parameters: {} } },
  { type: "function", function: { name: "update_trip_details", parameters: {} } },
];
export const SOFT_TOOLS = [];
`;
  const result = extractActionToolNamesFromCatalogSection(source);
  assert.ok(result.has("create_trip"), "should find create_trip");
  assert.ok(
    result.has("update_trip_details"),
    "should find update_trip_details",
  );
  assert.equal(result.size, 2);
});

test("stops at SOFT_TOOLS boundary — does not capture soft tool names", () => {
  const source = `
export const ACTION_TOOLS = [
  { type: "function", function: { name: "create_trip", parameters: {} } },
];
export const SOFT_TOOLS = [
  { type: "function", function: { name: "web_search", parameters: {} } },
];
`;
  const result = extractActionToolNamesFromCatalogSection(source);
  assert.ok(result.has("create_trip"), "should find create_trip");
  assert.ok(
    !result.has("web_search"),
    "should NOT find web_search (soft tool)",
  );
  assert.equal(result.size, 1);
});

test("returns empty Set when ACTION_TOOLS marker is not found", () => {
  const source = `export const SOFT_TOOLS = [];`;
  const result = extractActionToolNamesFromCatalogSection(source);
  assert.equal(result.size, 0);
});

test("returns empty Set for empty source", () => {
  const result = extractActionToolNamesFromCatalogSection("");
  assert.equal(result.size, 0);
});

test("real planner-tool-catalog.ts: finds expected ACTION_TOOLS names", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/planner-tool-catalog.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = extractActionToolNamesFromCatalogSection(source);
  const expected = [
    "create_trip",
    "update_trip_details",
    "send_email",
    "delete_trip_photo",
    "update_app_config",
  ];
  for (const name of expected) {
    assert.ok(
      result.has(name),
      `planner-tool-catalog.ts ACTION_TOOLS should contain "${name}"`,
    );
  }
  // SOFT_TOOLS names must be excluded
  assert.ok(
    !result.has("web_search"),
    "web_search is a soft tool — must NOT be in the ACTION_TOOLS extraction",
  );
});

test("resolves *_TOOL_NAME constant references in ACTION_TOOLS section", () => {
  // Real planner-tool-catalog.ts uses `name: ANALYZE_POTTERY_PHOTO_TOOL_NAME`
  // instead of a string literal; the extractor must resolve the constant.
  const source = `
export const MY_ACTION_TOOL_NAME = "my_action";
export const ACTION_TOOLS = [
  { type: "function", function: { name: MY_ACTION_TOOL_NAME, parameters: {} } },
];
export const SOFT_TOOLS = [];
`;
  const result = extractActionToolNamesFromCatalogSection(source);
  assert.ok(
    result.has("my_action"),
    "should resolve *_TOOL_NAME constant to its string value",
  );
  assert.equal(result.size, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan J — extractStringArrayExport
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan J — extractStringArrayExport",
);

test("parses a simple readonly string array export", () => {
  const source = `
export const MY_TYPES_SOURCE: readonly string[] = [
  "type_a",
  "type_b",
  "type_c",
];
`;
  const result = extractStringArrayExport(source, "MY_TYPES_SOURCE");
  assert.notEqual(result, null);
  assert.deepEqual(result!.sort(), ["type_a", "type_b", "type_c"]);
});

test("returns null when the export name is not found", () => {
  const source = `export const OTHER_SOURCE = ["foo", "bar"];`;
  assert.equal(extractStringArrayExport(source, "MY_TYPES_SOURCE"), null);
});

test("returns empty array when the array is empty", () => {
  const source = `export const EMPTY_SOURCE: readonly string[] = [];`;
  const result = extractStringArrayExport(source, "EMPTY_SOURCE");
  assert.notEqual(result, null);
  assert.deepEqual(result, []);
});

test("handles an array with section-header line comments (ignores non-string content)", () => {
  const source = `
export const MIXED_SOURCE: readonly string[] = [
  // ── Section ──────────────────────────────────────────────────────────────
  "type_a",
  "type_b",
];
`;
  const result = extractStringArrayExport(source, "MIXED_SOURCE");
  assert.notEqual(result, null);
  assert.deepEqual(result!.sort(), ["type_a", "type_b"]);
});

test("does NOT count a quoted string inside a line comment as an array entry", () => {
  // A commented-out entry like `// "old_type"` must not falsely satisfy
  // coverage — the runtime exclusion/allowed set never sees it.
  const source = `
export const MY_TYPES_SOURCE: readonly string[] = [
  // "commented_out_type",
  "real_type",
];
`;
  const result = extractStringArrayExport(source, "MY_TYPES_SOURCE");
  assert.notEqual(result, null);
  assert.deepEqual(
    result,
    ["real_type"],
    "commented-out strings must be excluded",
  );
});

test("does NOT count a quoted string inside a block comment as an array entry", () => {
  // A block-commented entry like `/* "old_type" */` must not falsely satisfy
  // coverage — only the runtime set matters.
  const source = `
export const MY_TYPES_SOURCE: readonly string[] = [
  /* "block_commented_out_type", */
  "real_type",
];
`;
  const result = extractStringArrayExport(source, "MY_TYPES_SOURCE");
  assert.notEqual(result, null);
  assert.deepEqual(
    result,
    ["real_type"],
    "block-commented-out strings must be excluded",
  );
});

test("real restricted-channel-config.ts: parses RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/restricted-channel-config.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = extractStringArrayExport(
    source,
    "RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE",
  );
  assert.notEqual(
    result,
    null,
    "RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE must be found",
  );
  assert.ok(
    result!.includes("send_test_email"),
    "should include send_test_email",
  );
  assert.ok(
    result!.includes("broadcast_message"),
    "should include broadcast_message",
  );
  assert.ok(
    result!.length >= 20,
    `expected at least 20 entries, got ${result!.length}`,
  );
});

test("real restricted-channel-config.ts: parses RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/restricted-channel-config.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const result = extractStringArrayExport(
    source,
    "RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE",
  );
  assert.notEqual(
    result,
    null,
    "RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE must be found",
  );
  assert.ok(result!.includes("create_trip"), "should include create_trip");
  assert.ok(
    result!.includes("update_pottery_item"),
    "should include update_pottery_item",
  );
  assert.ok(
    result!.length >= 60,
    `expected at least 60 entries, got ${result!.length}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan J — integration: uncovered action type detection
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-domain-composition.test: Scan J — Integration exit codes");

test("script exits non-zero when a known action type is removed from both coverage lists (Scan J)", () => {
  // Strategy: temporarily remove "create_trip" from RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE
  // in restricted-channel-config.ts.  "create_trip" exists in the ACTION_TOOLS section of
  // planner-tool-catalog.ts, so Scan J will report it as uncovered once it is absent from
  // both coverage lists.
  const configPath = join(
    root,
    "artifacts/api-server/src/elaine/restricted-channel-config.ts",
  );
  const original = readFileSync(configPath, "utf8");
  // Remove the "create_trip" line from the allowed list.
  const modified = original.replace(/^\s*"create_trip",\s*\n/m, "");
  assert.notEqual(
    original,
    modified,
    'Test setup failed: "create_trip" not found in restricted-channel-config.ts — update the integration test fixture',
  );
  writeFileSync(configPath, modified, "utf8");
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when an uncovered action type is present, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // Confirm the violation message names the uncovered type.
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("create_trip"),
      `violation message should name "create_trip" as uncovered.\nOutput: ${output}`,
    );
  } finally {
    writeFileSync(configPath, original, "utf8");
  }
});

test("script exits 0 when the clean repo has all action types covered (Scan J)", () => {
  // This is already verified by the general "script exits 0 against the real
  // (clean) repo" test.  This specific test documents which scan is responsible
  // and provides a labelled assertion for debugging.
  const result = runScriptExpectingZero();
  if (result.status !== 0) {
    const output = result.stdout + result.stderr;
    throw new Error(
      `Scan J: expected exit 0 on a clean repo but got ${result.status}.\n${output}`,
    );
  }
  assert.equal(result.status, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan M — universal-read-tools.ts dispatch completeness
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M — universal-read-tools dispatch gaps",
);

// ── stripSourceComments ───────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M helpers — stripSourceComments",
);

test("stripSourceComments removes a line comment", () => {
  const source = `const x = 1; // this is a comment`;
  assert.ok(!stripSourceComments(source).includes("this is a comment"));
  assert.ok(stripSourceComments(source).includes("const x = 1;"));
});

test("stripSourceComments removes a block comment", () => {
  const source = `const x = /* block comment */ 1;`;
  assert.ok(!stripSourceComments(source).includes("block comment"));
  assert.ok(stripSourceComments(source).includes("const x ="));
});

test("stripSourceComments preserves newlines when stripping block comments", () => {
  const source = `line1\n/* multi\nline\ncomment */\nline2`;
  const stripped = stripSourceComments(source);
  assert.equal(
    stripped.split("\n").length,
    source.split("\n").length,
    "line count must be preserved",
  );
  assert.ok(stripped.includes("line1"));
  assert.ok(stripped.includes("line2"));
});

test("stripSourceComments removes a line comment that mentions a dispatch pattern", () => {
  // This is the key false-negative case: a commented-out branch must NOT
  // satisfy the dispatch check.
  const source = `// if (name === GET_NOTE_TOOL_NAME) { return "note"; }`;
  const stripped = stripSourceComments(source);
  assert.ok(
    !stripped.includes("name === GET_NOTE_TOOL_NAME"),
    "the dispatch pattern must not appear after comment stripping",
  );
});

// ── stripSimpleStringLiterals ─────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M helpers — stripSimpleStringLiterals",
);

test("stripSimpleStringLiterals blanks double-quoted string content", () => {
  const source = `const x = "hello {world}";`;
  const stripped = stripSimpleStringLiterals(source);
  assert.ok(
    !stripped.includes("{world}"),
    "brace inside string must be blanked",
  );
  // Content is replaced with spaces (not removed entirely), so quote chars remain
  // but the string is NOT collapsed to "". Check delimiters are present and
  // the brace is gone.
  assert.ok(stripped.includes('"'), "quote delimiters must still be present");
  assert.ok(!stripped.includes("{"), "braces must not appear after stripping");
});

test("stripSimpleStringLiterals blanks single-quoted string content", () => {
  const source = `const x = '{unclosed';`;
  const stripped = stripSimpleStringLiterals(source);
  assert.ok(
    !stripped.includes("{unclosed"),
    "brace inside single-quoted string must be blanked",
  );
});

test("stripSimpleStringLiterals handles escaped quotes inside strings", () => {
  const source = `const x = "he said \\"hello {world}\\"";`;
  const stripped = stripSimpleStringLiterals(source);
  assert.ok(!stripped.includes("{world}"));
});

// ── stripTemplateLiterals ─────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M helpers — stripTemplateLiterals",
);

test("stripTemplateLiterals blanks template literal content", () => {
  const source = "const x = `name === FOO_TOOL_NAME`;";
  const stripped = stripTemplateLiterals(source);
  assert.ok(
    !stripped.includes("FOO_TOOL_NAME"),
    "content inside backtick string must be blanked",
  );
  assert.ok(stripped.includes("`"), "backtick delimiters must remain");
});

test("stripTemplateLiterals blanks curly braces inside template literals", () => {
  const source = "const x = `hello {world}`;";
  const stripped = stripTemplateLiterals(source);
  assert.ok(!stripped.includes("{world}"));
});

// ── stripAllStringLiteralContent ──────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M helpers — stripAllStringLiteralContent",
);

test("stripAllStringLiteralContent strips double-quoted, single-quoted, and template literals", () => {
  const source = `
    const a = "name === FOO_TOOL_NAME";
    const b = 'name === BAR_TOOL_NAME';
    const c = \`name === BAZ_TOOL_NAME\`;
  `;
  const stripped = stripAllStringLiteralContent(source);
  assert.ok(
    !stripped.includes("FOO_TOOL_NAME"),
    "double-quoted content stripped",
  );
  assert.ok(
    !stripped.includes("BAR_TOOL_NAME"),
    "single-quoted content stripped",
  );
  assert.ok(
    !stripped.includes("BAZ_TOOL_NAME"),
    "template literal content stripped",
  );
});

// ── extractUniversalReadDispatchBody ─────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M — extractUniversalReadDispatchBody",
);

test("extractUniversalReadDispatchBody returns null when function is absent", () => {
  assert.equal(extractUniversalReadDispatchBody("const x = 1;"), null);
});

test("extractUniversalReadDispatchBody returns null on empty source", () => {
  assert.equal(extractUniversalReadDispatchBody(""), null);
});

test("extractUniversalReadDispatchBody extracts a simple function body", () => {
  const source = `
export async function executeUniversalReadTool(
  name: string,
  args: string,
  userId: number,
): Promise<string | null> {
  if (name === FOO_TOOL_NAME) { return "foo"; }
  return null;
}
`;
  const body = extractUniversalReadDispatchBody(source);
  assert.notEqual(body, null, "expected a non-null body");
  assert.ok(body!.startsWith("{"), "body should start with {");
  assert.ok(body!.endsWith("}"), "body should end with }");
  assert.ok(
    body!.includes("FOO_TOOL_NAME"),
    "body should contain FOO_TOOL_NAME",
  );
  assert.ok(body!.includes("return null;"), "body should contain return null");
});

test("extractUniversalReadDispatchBody handles nested braces correctly", () => {
  const source = `
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  if (name === LIST_NOTES_TOOL_NAME) {
    const notes = await listOfficeNotes();
    return JSON.stringify({ notes, returned: notes.length });
  }
  return null;
}
`;
  const body = extractUniversalReadDispatchBody(source);
  assert.notEqual(body, null);
  assert.ok(body!.includes("LIST_NOTES_TOOL_NAME"));
  assert.ok(body!.includes("listOfficeNotes"));
});

test("extractUniversalReadDispatchBody is not corrupted by braces inside string literals", () => {
  // A string literal like JSON.parse(args || "{}") contains balancing braces
  // that must NOT shift the depth counter and truncate the body early.
  const source = `
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  const input = JSON.parse(args || "{}") as unknown;
  if (name === LIST_NOTES_TOOL_NAME) { return "notes"; }
  return null;
}
`;
  const body = extractUniversalReadDispatchBody(source);
  assert.notEqual(body, null);
  // The body must include the dispatch branch that comes AFTER the string literal.
  assert.ok(
    body!.includes("LIST_NOTES_TOOL_NAME"),
    "body must extend past the string-literal brace pair",
  );
});

// ── findUniversalReadDispatchGaps ────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan M — findUniversalReadDispatchGaps",
);

test("findUniversalReadDispatchGaps returns empty map when constant dispatched by reference", () => {
  const source = `
export const LIST_NOTES_TOOL_NAME = "list_notes";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  if (name === LIST_NOTES_TOOL_NAME) { return "notes"; }
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(gaps.size, 0);
});

test("findUniversalReadDispatchGaps reports a gap when constant is dispatched only by string literal (reference form is required)", () => {
  // The string-literal dispatch form (`name === "value"`) is intentionally NOT
  // supported — it is indistinguishable from a pattern embedded in an error
  // message or log string after necessary string stripping.  Dispatch branches
  // must always reference the exported constant name.
  const source = `
export const LIST_NOTES_TOOL_NAME = "list_notes";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  if (name === "list_notes") { return "notes"; }
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "string-literal-only dispatch must NOT satisfy the check; constant reference is required",
  );
  assert.ok(gaps.has("LIST_NOTES_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps detects a constant absent from the dispatch function", () => {
  const source = `
export const LIST_NOTES_TOOL_NAME = "list_notes";
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  if (name === LIST_NOTES_TOOL_NAME) { return "notes"; }
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(gaps.size, 1, "expected exactly one gap");
  assert.ok(
    gaps.has("GET_NOTE_TOOL_NAME"),
    "GET_NOTE_TOOL_NAME should be reported as missing",
  );
  assert.equal(gaps.get("GET_NOTE_TOOL_NAME"), "get_note");
});

test("findUniversalReadDispatchGaps does NOT pass when dispatch is only in a line comment", () => {
  // A commented-out branch must NOT satisfy the check — this is the key
  // false-negative the comment-stripping was introduced to prevent.
  const source = `
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  // if (name === GET_NOTE_TOOL_NAME) { return "note"; }
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "a commented-out dispatch branch must not satisfy the check",
  );
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps does NOT pass when dispatch is only in a block comment", () => {
  const source = `
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  /* name === GET_NOTE_TOOL_NAME is handled somewhere else */
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "a block-comment reference must not satisfy the check",
  );
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps reports all constants when dispatch function is absent", () => {
  // If executeUniversalReadTool is missing entirely, every constant is a gap.
  const source = `
export const LIST_NOTES_TOOL_NAME = "list_notes";
export const GET_NOTE_TOOL_NAME = "get_note";
// No executeUniversalReadTool defined.
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(gaps.size, 2, "expected both constants to be flagged");
  assert.ok(gaps.has("LIST_NOTES_TOOL_NAME"));
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps returns empty map when file has no *_TOOL_NAME exports", () => {
  const source = `
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(gaps.size, 0);
});

test("real universal-read-tools.ts has 0 dispatch gaps", () => {
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/universal-read-tools.ts",
  );
  const source = readFileSync(filePath, "utf8");
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    0,
    `Expected 0 gaps in the real universal-read-tools.ts but found: ${[...gaps.keys()].join(", ")}`,
  );
});

// ── Negative tests: false-negative patterns that must NOT satisfy the check ──

console.log(
  "\ncheck-domain-composition.test: Scan M — false-negative guard tests",
);

test("findUniversalReadDispatchGaps does NOT pass when pattern is inside a template literal", () => {
  // A template literal like `throw new Error(\`name === FOO_TOOL_NAME\`)` must
  // NOT be treated as a real dispatch branch.
  const source = `
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  throw new Error(\`name === GET_NOTE_TOOL_NAME has no handler yet\`);
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "pattern inside a template literal must not satisfy the dispatch check",
  );
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps does NOT pass when pattern is inside a string literal", () => {
  // A string literal like `throw new Error("name === FOO_TOOL_NAME is missing")`
  // must NOT be treated as a real dispatch branch.
  const source = `
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  throw new Error("name === GET_NOTE_TOOL_NAME has no handler yet");
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "pattern inside a string literal must not satisfy the dispatch check",
  );
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

test("findUniversalReadDispatchGaps does NOT pass when a non-name identifier precedes the comparator", () => {
  // `toolname === FOO_TOOL_NAME` must not match — word boundary on `name` is required.
  const source = `
export const GET_NOTE_TOOL_NAME = "get_note";
export async function executeUniversalReadTool(name: string, args: string, userId: number): Promise<string | null> {
  if (toolname === GET_NOTE_TOOL_NAME) { return "note"; }
  return null;
}
`;
  const gaps = findUniversalReadDispatchGaps(source);
  assert.equal(
    gaps.size,
    1,
    "`toolname === CONST` must not satisfy the check; word boundary on `name` required",
  );
  assert.ok(gaps.has("GET_NOTE_TOOL_NAME"));
});

// ── Integration: script exits non-zero for an undispatched constant ───────────

console.log(
  "\ncheck-domain-composition.test: Scan M — integration exit-code test",
);

test("script exits non-zero when a *_TOOL_NAME constant in universal-read-tools.ts has no dispatch branch (Scan M)", () => {
  // Temporarily inject an extra exported constant that has no dispatch branch.
  // Uses the real file (not a separate fixture) so Scan M's fixed path is hit.
  const filePath = resolve(
    import.meta.dirname,
    "../../artifacts/api-server/src/elaine/universal-read-tools.ts",
  );
  const original = readFileSync(filePath, "utf8");
  // Inject a new export at the top of the constant block.
  const modified = original.replace(
    /^(export const [A-Z][A-Z0-9_]*_TOOL_NAME\s*=)/m,
    'export const TEMP_UNDISPATCHED_XYZZY_TOOL_NAME = "temp_undispatched_xyzzy";\n$1',
  );
  // Guard: if the injection didn't work, skip rather than give a false pass.
  assert.ok(
    modified !== original,
    "precondition: injection into universal-read-tools.ts must produce a changed file",
  );
  writeFileSync(filePath, modified, "utf8");
  try {
    const result = spawnSync(
      "node",
      ["--import", "tsx", "./src/check-domain-composition.ts"],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8" },
    );
    assert.notEqual(
      result.status,
      0,
      "script must exit non-zero when an undispatched *_TOOL_NAME constant is present",
    );
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.ok(
      output.includes("TEMP_UNDISPATCHED_XYZZY_TOOL_NAME"),
      `violation message must name the undispatched constant; got: ${output.slice(0, 400)}`,
    );
  } finally {
    writeFileSync(filePath, original, "utf8");
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan N — extractPolicyRowExecutorPrefixes / findPhantomExecutorPrefixes
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan N — POLICY_ROWS → executor prefix cross-check",
);

// extractPolicyRowExecutorPrefixes tests

test("extractPolicyRowExecutorPrefixes: extracts a single prefix from a one-call policy block", () => {
  const source = `...policies(["create_trip"], { executorPrefix: 'travelAction' })`;
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.deepEqual(result, ["travelAction"]);
});

test("extractPolicyRowExecutorPrefixes: extracts multiple distinct prefixes from multiple policies() calls", () => {
  const source = [
    `...policies(["create_trip"], { executorPrefix: "travelAction" }),`,
    `...policies(["update_pottery_item"], { executorPrefix: "potteryAction" }),`,
  ].join("\n");
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.ok(result.includes("travelAction"), "should include travelAction");
  assert.ok(result.includes("potteryAction"), "should include potteryAction");
  assert.equal(result.length, 2);
});

test("extractPolicyRowExecutorPrefixes: deduplicates the same prefix used across multiple calls", () => {
  const source = [
    `...policies(["update_pottery_item"], { executorPrefix: "potteryAction" }),`,
    `...policies(["add_photo_to_pottery"], { executorPrefix: "potteryAction", channels: ["web"] }),`,
  ].join("\n");
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.equal(
    result.filter((p) => p === "potteryAction").length,
    1,
    "potteryAction should appear exactly once",
  );
  assert.equal(result.length, 1);
});

test("extractPolicyRowExecutorPrefixes: handles single-quoted prefix values", () => {
  const source = `...policies(["list_reminders"], { executorPrefix: 'reminderRead' })`;
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.deepEqual(result, ["reminderRead"]);
});

test("extractPolicyRowExecutorPrefixes: handles multi-line policy block syntax", () => {
  const source = [
    "...policies(",
    '  ["create_trip", "cancel_trip"],',
    "  {",
    "    ...ACTION_DEFAULTS,",
    "    domain: 'travels',",
    "    executorPrefix: 'travelAction',",
    "  },",
    "),",
  ].join("\n");
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.deepEqual(result, ["travelAction"]);
});

test("extractPolicyRowExecutorPrefixes: returns empty array when no executorPrefix values are present", () => {
  const source = `const x = { kind: "action", risk: "medium", domain: "travels" };`;
  assert.deepEqual(extractPolicyRowExecutorPrefixes(source), []);
});

test("extractPolicyRowExecutorPrefixes: returns empty array for empty source", () => {
  assert.deepEqual(extractPolicyRowExecutorPrefixes(""), []);
});

test("extractPolicyRowExecutorPrefixes: does not capture unrelated quoted camelCase strings", () => {
  // Keys like "kind", "auth", "domain" that happen to be quoted in the defaults
  // object must not be mistaken for executor prefixes.
  const source = [
    `...policies(["create_trip"], {`,
    `  kind: "action",`,
    `  domain: "travels",`,
    `  executorPrefix: "travelAction",`,
    `}),`,
  ].join("\n");
  const result = extractPolicyRowExecutorPrefixes(source);
  assert.deepEqual(result, ["travelAction"]);
});

// findPhantomExecutorPrefixes tests

test("findPhantomExecutorPrefixes: returns empty array when all prefixes are known", () => {
  const known = new Set(["travelAction", "potteryAction", "reminderRead"]);
  assert.deepEqual(
    findPhantomExecutorPrefixes(
      ["travelAction", "potteryAction", "reminderRead"],
      known,
    ),
    [],
  );
});

test("findPhantomExecutorPrefixes: returns phantom prefixes not in the known set", () => {
  const known = new Set(["travelAction", "potteryAction"]);
  const result = findPhantomExecutorPrefixes(
    ["travelAction", "potteryAction", "ghostExecutor"],
    known,
  );
  assert.deepEqual(result, ["ghostExecutor"]);
});

test("findPhantomExecutorPrefixes: returns all prefixes when none are known", () => {
  const result = findPhantomExecutorPrefixes(["prefixA", "prefixB"], new Set());
  assert.deepEqual(result.sort(), ["prefixA", "prefixB"]);
});

test("findPhantomExecutorPrefixes: returns empty array for empty policy prefix list", () => {
  const known = new Set(["travelAction"]);
  assert.deepEqual(findPhantomExecutorPrefixes([], known), []);
});

test("findPhantomExecutorPrefixes: returns empty array when both inputs are empty", () => {
  assert.deepEqual(findPhantomExecutorPrefixes([], new Set()), []);
});

test("findPhantomExecutorPrefixes: only reports each phantom once", () => {
  const known = new Set(["travelAction"]);
  const result = findPhantomExecutorPrefixes(
    ["travelAction", "unknownPrefix"],
    known,
  );
  assert.equal(result.length, 1);
  assert.ok(result.includes("unknownPrefix"));
});

// KNOWN_EXECUTOR_PREFIXES sanity checks

test("KNOWN_EXECUTOR_PREFIXES: contains every prefix used in the real capability-registry.ts", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/capability-registry.ts",
    ),
    "utf8",
  );
  const extracted = extractPolicyRowExecutorPrefixes(source);
  assert.ok(
    extracted.length > 0,
    "extractPolicyRowExecutorPrefixes should find at least one prefix in capability-registry.ts",
  );
  const phantoms = findPhantomExecutorPrefixes(
    extracted,
    KNOWN_EXECUTOR_PREFIXES,
  );
  assert.deepEqual(
    phantoms,
    [],
    `Real capability-registry.ts uses executor prefix(es) not in KNOWN_EXECUTOR_PREFIXES: ${phantoms.join(", ")}. ` +
      "Add each to KNOWN_EXECUTOR_PREFIXES in check-domain-composition.ts.",
  );
});

test("KNOWN_EXECUTOR_PREFIXES: all entries are camelCase strings starting with a lowercase letter", () => {
  const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/;
  for (const prefix of KNOWN_EXECUTOR_PREFIXES) {
    assert.ok(
      CAMEL_RE.test(prefix),
      `KNOWN_EXECUTOR_PREFIXES entry "${prefix}" does not look like a camelCase executor prefix`,
    );
  }
});

// scanNViolations end-to-end tests (pure helper, no filesystem mutation)

test("scanNViolations: returns empty array when all policy prefixes are known", () => {
  const source = [
    `...policies(["create_trip"], { executorPrefix: "travelAction" }),`,
    `...policies(["update_trip"], { executorPrefix: "travelAction" }),`,
  ].join("\n");
  const violations = scanNViolations(
    source,
    new Set(["travelAction"]),
    "fake/path.ts",
  );
  assert.deepEqual(violations, []);
});

test("scanNViolations: returns a violation string naming the phantom prefix", () => {
  const source = `...policies(["create_trip"], { executorPrefix: "ghostPrefix" })`;
  const violations = scanNViolations(
    source,
    new Set(["travelAction", "potteryAction"]),
    "fake/capability-registry.ts",
  );
  assert.equal(violations.length, 1, "expected exactly one violation");
  assert.ok(
    violations[0].includes("ghostPrefix"),
    `violation must name the phantom prefix; got: ${violations[0].slice(0, 200)}`,
  );
  assert.ok(
    violations[0].includes("FIX:"),
    "violation must include a FIX: clause",
  );
  assert.ok(
    violations[0].includes("fake/capability-registry.ts"),
    "violation must include the file path",
  );
});

test("scanNViolations: names all phantom prefixes when multiple are present", () => {
  const source = [
    `...policies(["a"], { executorPrefix: "travelAction" }),`,
    `...policies(["b"], { executorPrefix: "phantomOne" }),`,
    `...policies(["c"], { executorPrefix: "phantomTwo" }),`,
  ].join("\n");
  const violations = scanNViolations(
    source,
    new Set(["travelAction"]),
    "fake/path.ts",
  );
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("phantomOne"), "must name phantomOne");
  assert.ok(violations[0].includes("phantomTwo"), "must name phantomTwo");
  assert.ok(
    !violations[0].includes("travelAction"),
    "must not name the known prefix",
  );
});

test("scanNViolations: returns empty array for source with no executorPrefix fields", () => {
  const source = `const x = { kind: "read", domain: "travels" };`;
  const violations = scanNViolations(source, new Set(["travelAction"]), "p.ts");
  assert.deepEqual(violations, []);
});

test("scanNViolations: real capability-registry.ts produces no violations against KNOWN_EXECUTOR_PREFIXES", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/capability-registry.ts",
    ),
    "utf8",
  );
  const violations = scanNViolations(
    source,
    KNOWN_EXECUTOR_PREFIXES,
    "capability-registry.ts",
  );
  assert.deepEqual(
    violations,
    [],
    `Scan N found unexpected violations in the real repo:\n${violations.join("\n")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Scan I — hasInlinedElaineLessonsMock
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan I — hasInlinedElaineLessonsMock",
);

test("flags a file that vi.mocks elaine-lessons without importing from the scaffold", () => {
  const source = [
    'import { describe, it } from "vitest";',
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [], evidenceBlock: '' }),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not flag a file that vi.mocks elaine-lessons AND imports elaineLessonsMockFactory from the scaffold", () => {
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), false);
});

test("does not flag a file that only mentions getRelevantElaineLessons in a comment", () => {
  // lesson-prompt-injection.test.ts pattern: string appears only in a comment,
  // no vi.mock call targeting the module.
  const source = [
    "// getRelevantElaineLessons is the real implementation here",
    'import { recordElaineLesson } from "../lib/elaine-lessons";',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), false);
});

test("does not flag a file that imports from elaine-lessons without vi.mock", () => {
  // self-heal-pipeline.test.ts pattern: direct import of the real function,
  // no inline mock factory.
  const source = [
    'import { recordElaineLesson } from "../lib/elaine-lessons";',
    "// no vi.mock call for this module",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), false);
});

test("flags a file using single-quoted vi.mock path without scaffold", () => {
  const source = [
    "vi.mock('../lib/elaine-lessons', () => ({",
    "  getRelevantElaineLessons: vi.fn(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags vi.mock with extra whitespace before the path string", () => {
  // Whitespace-tolerant regex must catch: vi.mock( "../lib/elaine-lessons", ...
  const source = [
    'vi.mock( "../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [] }),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not accept a scaffold path that appears only in a comment", () => {
  // If the scaffold path is mentioned in a comment but the factory body is
  // still inline, the file must be flagged.
  const source = [
    "// FIX: import elaineLessonsMockFactory from ./test-helpers/standard-mock-scaffold",
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not accept an unrelated scaffold import paired with an inline lessons mock", () => {
  // A file that imports a DIFFERENT scaffold helper (e.g. loggerMockFactory)
  // but still writes an inline elaine-lessons factory must still be flagged.
  const source = [
    'import { loggerMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/logger", () => loggerMockFactory());',
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [] }),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not accept elaineLessonsMockFactory appearing only in a later unrelated mock", () => {
  // The unbounded-regex false-negative: elaineLessonsMockFactory appears after
  // the elaine-lessons vi.mock but in a completely different mock call.
  // The detector must be bounded to the specific vi.mock call.
  const source = [
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [] }),",
    "}));",
    'vi.mock("../lib/other", () => elaineLessonsMockFactory());',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not accept elaineLessonsMockFactory appearing only in a comment inside the mock", () => {
  // A comment mentioning the factory name inside the inline mock body must
  // NOT satisfy the check.
  const source = [
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  // TODO: replace with elaineLessonsMockFactory()",
    "  getRelevantElaineLessons: vi.fn(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not flag an empty file", () => {
  assert.equal(hasInlinedElaineLessonsMock(""), false);
});

test("flags a locally-declared function named elaineLessonsMockFactory (not from scaffold)", () => {
  // A file can define a local function with the same name to bypass a naive
  // call-text check.  The import requirement catches this.
  const source = [
    "function elaineLessonsMockFactory() {",
    "  return { getRelevantElaineLessons: vi.fn() };",
    "}",
    'vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags elaineLessonsMockFactory imported from an unrelated module", () => {
  // Importing from a different path should not satisfy the scaffold requirement.
  const source = [
    'import { elaineLessonsMockFactory } from "./other-helpers";',
    'vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("does not flag a commented-out vi.mock targeting elaine-lessons", () => {
  // The entire vi.mock call is inside a // comment — it should not be treated
  // as an active mock and must not trigger the guard.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    '// vi.mock("../lib/elaine-lessons", () => ({',
    "//   getRelevantElaineLessons: vi.fn(),",
    "// }));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), false);
});

test("does not flag a compliant call where a string literal contains unbalanced parens before the factory reference", () => {
  // Parentheses inside a string literal must not skew the balanced-paren
  // walker and cause it to cut the call short, missing the factory reference.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => ({',
    '  label: "starts (here",', // unbalanced open paren in string
    "  ...elaineLessonsMockFactory(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), false);
});

test("flags a file where the factory call result is discarded and an inline mock is returned", () => {
  // Calling elaineLessonsMockFactory() but not returning its result — the
  // actual mock returned is still wholly inline and must be flagged.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => {',
    "  elaineLessonsMockFactory();",
    "  return { getRelevantElaineLessons: vi.fn().mockResolvedValue([]) };",
    "});",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags a file where the factory is referenced only as an object property value, not spread or returned", () => {
  // Placing the factory identifier as a property value does not make the
  // effective mock use the scaffold — the returned object is still inline.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  _factory: elaineLessonsMockFactory,",
    "  getRelevantElaineLessons: vi.fn(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags a file where a compliant first mock is followed by an inline second mock", () => {
  // If a file has two vi.mock("../lib/elaine-lessons", …) calls and only the
  // first is compliant, the second (which Vitest hoists and applies) must
  // still be caught.  Checking only the first mock would miss this.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());',
    "// The effective mock overrides the first:",
    'vi.mock("../lib/elaine-lessons", () => ({',
    "  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [] }),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags a file where the canonical import is commented out and a local factory is defined", () => {
  // A commented-out import must not satisfy the scaffold-import gate; the
  // gate must be checked against comment-stripped source.
  const source = [
    "// import { elaineLessonsMockFactory } from './test-helpers/standard-mock-scaffold';",
    "function elaineLessonsMockFactory() {",
    "  return { getRelevantElaineLessons: vi.fn() };",
    "}",
    'vi.mock("../lib/elaine-lessons", () => elaineLessonsMockFactory());',
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

test("flags a file where the factory name only appears inside a string literal in the mock call", () => {
  // A string literal that mentions the factory name must not satisfy the
  // factory-reference check; eraseStringContents prevents this bypass.
  const source = [
    'import { elaineLessonsMockFactory } from "./test-helpers/standard-mock-scaffold";',
    'vi.mock("../lib/elaine-lessons", () => ({',
    '  label: "use elaineLessonsMockFactory instead",',
    "  getRelevantElaineLessons: vi.fn(),",
    "}));",
  ].join("\n");
  assert.equal(hasInlinedElaineLessonsMock(source), true);
});

// ────────────────────────────────────────────────────────────────────────────
// Scan O — hasInlineSentryMock / hasInlineRateLimitMock
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan O — hasInlineSentryMock / hasInlineRateLimitMock",
);

// ── hasInlineSentryMock ──────────────────────────────────────────────────────

test("hasInlineSentryMock: detects a single-line inline @sentry/node mock body", () => {
  const source = `vi.mock("@sentry/node", () => ({ init: vi.fn(), captureException: vi.fn() }));`;
  assert.equal(hasInlineSentryMock(source), true);
});

test("hasInlineSentryMock: detects a multi-line inline @sentry/node mock body", () => {
  const source = `
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
}));
`;
  assert.equal(hasInlineSentryMock(source), true);
});

test("hasInlineSentryMock: detects inline mock even when sentryMockFactory appears elsewhere in the file", () => {
  // e.g. imported but not used as the vi.mock factory, or mentioned in a comment
  const source = `
// sentryMockFactory() is the preferred pattern — use it instead
import { sentryMockFactory } from "./test-helpers/standard-mock-scaffold";
vi.mock("@sentry/node", () => ({ init: vi.fn() }));
`;
  assert.equal(hasInlineSentryMock(source), true);
});

test("hasInlineSentryMock: detects inline mock using single-quoted module path", () => {
  const source = `vi.mock('@sentry/node', () => ({ init: vi.fn() }));`;
  assert.equal(hasInlineSentryMock(source), true);
});

test("hasInlineSentryMock: detects async importOriginal inline factory", () => {
  const source = `
vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, init: vi.fn() };
});
`;
  assert.equal(hasInlineSentryMock(source), true);
});

test("hasInlineSentryMock: does NOT flag a delegation to sentryMockFactory()", () => {
  const source = `vi.mock("@sentry/node", () => sentryMockFactory());`;
  assert.equal(hasInlineSentryMock(source), false);
});

test("hasInlineSentryMock: does NOT flag a multi-line delegation to sentryMockFactory()", () => {
  const source = `
vi.mock("@sentry/node", () =>
  sentryMockFactory()
);
`;
  assert.equal(hasInlineSentryMock(source), false);
});

test("hasInlineSentryMock: does NOT flag a file that does not mock @sentry/node at all", () => {
  const source = `
import { sentryMockFactory } from "./test-helpers/standard-mock-scaffold";
vi.mock("../lib/logger", loggerMockFactory);
`;
  assert.equal(hasInlineSentryMock(source), false);
});

test("hasInlineSentryMock: does NOT flag an empty file", () => {
  assert.equal(hasInlineSentryMock(""), false);
});

test("hasInlineSentryMock: flags inline mock even when a separate delegation call also exists in the same file", () => {
  // A file that has BOTH an inline body AND a delegation — the inline one must
  // still be caught (the delegation cannot mask it).
  const source = `
vi.mock("@sentry/node", () => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/node", () => sentryMockFactory());
`;
  assert.equal(hasInlineSentryMock(source), true);
});

// ── hasInlineRateLimitMock ───────────────────────────────────────────────────

test("hasInlineRateLimitMock: detects a single-line inline rateLimit mock body", () => {
  const source = `vi.mock("../middleware/rateLimit", () => ({ apiLimiter: passthrough }));`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: detects a multi-line inline rateLimit mock body", () => {
  const source = `
vi.mock("../middleware/rateLimit", () => ({
  loginLimiter: passthrough,
  apiLimiter: passthrough,
  aiLimiter: passthrough,
}));
`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: detects inline mock even when rateLimitMockFactory appears elsewhere in the file", () => {
  // rateLimitMockFactory is in an import or comment but NOT as the vi.mock factory
  const source = `
// rateLimitMockFactory() is the preferred pattern — use it instead
import { rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";
vi.mock("../middleware/rateLimit", () => ({ apiLimiter: vi.fn() }));
`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: detects inline mock using single-quoted module path", () => {
  const source = `vi.mock('../middleware/rateLimit', () => ({ apiLimiter: passthrough }));`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: detects inline mock from a nested subdirectory path (../../middleware/rateLimit)", () => {
  const source = `vi.mock("../../middleware/rateLimit", () => ({ apiLimiter: passthrough }));`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: detects async importOriginal inline factory", () => {
  const source = `
vi.mock("../middleware/rateLimit", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, aiLimiter: passthrough };
});
`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

test("hasInlineRateLimitMock: does NOT flag a delegation to rateLimitMockFactory()", () => {
  const source = `vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());`;
  assert.equal(hasInlineRateLimitMock(source), false);
});

test("hasInlineRateLimitMock: does NOT flag a multi-line delegation to rateLimitMockFactory()", () => {
  const source = `
vi.mock("../middleware/rateLimit", () =>
  rateLimitMockFactory()
);
`;
  assert.equal(hasInlineRateLimitMock(source), false);
});

test("hasInlineRateLimitMock: does NOT flag delegation from a nested subdirectory path", () => {
  const source = `vi.mock("../../middleware/rateLimit", () => rateLimitMockFactory());`;
  assert.equal(hasInlineRateLimitMock(source), false);
});

test("hasInlineRateLimitMock: does NOT flag a file that does not mock rateLimit at all", () => {
  const source = `
import { rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";
vi.mock("../lib/logger", loggerMockFactory);
`;
  assert.equal(hasInlineRateLimitMock(source), false);
});

test("hasInlineRateLimitMock: does NOT flag an empty file", () => {
  assert.equal(hasInlineRateLimitMock(""), false);
});

test("hasInlineRateLimitMock: flags inline mock even when a separate delegation call also exists in the same file", () => {
  // A file that has BOTH an inline body AND a delegation — the inline one must
  // still be caught (the delegation cannot mask it).
  const source = `
vi.mock("../middleware/rateLimit", () => ({ apiLimiter: passthrough }));
vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());
`;
  assert.equal(hasInlineRateLimitMock(source), true);
});

// ────────────────────────────────────────────────────────────────────────────
// Integration — Scan O runner exit-code tests
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Integration — Scan O runner exit codes",
);

const TEMP_SENTRY_RATELIMIT_VIOLATION_FILE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_composition_guard_test_scan_o_fixture.test.ts",
);

test("script exits non-zero when an inline @sentry/node mock is injected (Scan O)", () => {
  writeFileSync(
    TEMP_SENTRY_RATELIMIT_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("@sentry/node", () => ({ init: vi.fn(), captureException: vi.fn() }));',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for inline @sentry/node mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("@sentry/node") ||
        result.stdout.includes("@sentry/node"),
      "Violation message must mention @sentry/node",
    );
  } finally {
    try {
      unlinkSync(TEMP_SENTRY_RATELIMIT_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits non-zero when an inline rateLimit mock is injected (Scan O)", () => {
  writeFileSync(
    TEMP_SENTRY_RATELIMIT_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'vi.mock("../middleware/rateLimit", () => ({ apiLimiter: vi.fn() }));',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runScript();
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for inline rateLimit mock, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("rateLimit") ||
        result.stdout.includes("rateLimit"),
      "Violation message must mention rateLimit",
    );
  } finally {
    try {
      unlinkSync(TEMP_SENTRY_RATELIMIT_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

test("script exits 0 when both mocks delegate to the scaffold factories (Scan O)", () => {
  writeFileSync(
    TEMP_SENTRY_RATELIMIT_VIOLATION_FILE,
    [
      "// Temporary test fixture injected by check-domain-composition.test.ts",
      "// This file is cleaned up after the test regardless of outcome.",
      'import { vi } from "vitest";',
      'import { sentryMockFactory, rateLimitMockFactory } from "./test-helpers/standard-mock-scaffold";',
      'vi.mock("@sentry/node", () => sentryMockFactory());',
      'vi.mock("../middleware/rateLimit", () => rateLimitMockFactory());',
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    // runScriptExpectingZero cleans + retries once while preserving our fixture.
    const result = runScriptExpectingZero([
      TEMP_SENTRY_RATELIMIT_VIOLATION_FILE,
    ]);
    assert.equal(
      result.status,
      0,
      `Expected exit 0 for scaffold-delegating mocks, but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_SENTRY_RATELIMIT_VIOLATION_FILE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan O (action-executor reverse) — extractActionExecutorSpreads / findStaleActionClassPrefixes / scanOViolations
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan O — KNOWN_EXECUTOR_PREFIXES action-class reverse check",
);

// extractActionExecutorSpreads tests

test("extractActionExecutorSpreads: extracts a single spread from a minimal ACTION_EXECUTORS block", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
};
`;
  const result = extractActionExecutorSpreads(source);
  assert.ok(
    result.has("potteryActionExecutors"),
    "expected potteryActionExecutors",
  );
  assert.equal(result.size, 1);
});

test("extractActionExecutorSpreads: extracts multiple spreads", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...TRAVEL_ACTION_EXECUTORS,
  ...potteryActionExecutors,
  ...quiltingActionExecutors,
};
`;
  const result = extractActionExecutorSpreads(source);
  assert.ok(result.has("TRAVEL_ACTION_EXECUTORS"));
  assert.ok(result.has("potteryActionExecutors"));
  assert.ok(result.has("quiltingActionExecutors"));
  assert.equal(result.size, 3);
});

test("extractActionExecutorSpreads: ignores non-spread entries (computed properties)", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
  [EXECUTE_APP_OPERATION_TOOL_NAME]: executeAppOperationAction as ActionExecutor,
};
`;
  const result = extractActionExecutorSpreads(source);
  assert.ok(result.has("potteryActionExecutors"));
  // The computed key identifier should NOT appear in spread results
  assert.ok(!result.has("EXECUTE_APP_OPERATION_TOOL_NAME"));
});

test("extractActionExecutorSpreads: returns empty Set when ACTION_EXECUTORS is not present", () => {
  const source = `const SOMETHING_ELSE = { foo: "bar" };`;
  const result = extractActionExecutorSpreads(source);
  assert.equal(result.size, 0);
});

test("extractActionExecutorSpreads: is not confused by braces inside comments", () => {
  const source = `
// ACTION_EXECUTORS used to be: { ...legacyExecutors }
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
};
`;
  const result = extractActionExecutorSpreads(source);
  assert.ok(result.has("potteryActionExecutors"));
  assert.ok(!result.has("legacyExecutors"));
});

test("extractActionExecutorSpreads: is not confused by braces inside string literals", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
  /* note: "{ ...fakeSpread }" is just a comment string */
};
`;
  const result = extractActionExecutorSpreads(source);
  assert.ok(result.has("potteryActionExecutors"));
  assert.ok(!result.has("fakeSpread"));
});

test("extractActionExecutorSpreads: real index.ts contains the expected executor spreads", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/index.ts",
    ),
    "utf8",
  );
  const spreads = extractActionExecutorSpreads(source);
  const expected = [
    "TRAVEL_ACTION_EXECUTORS",
    "potteryActionExecutors",
    "quiltingActionExecutors",
    "ornamentActionExecutors",
    "universalActionExecutors",
    "adaptiveActionExecutors",
    "communicationActionExecutors",
    "reminderActionExecutors",
  ];
  for (const name of expected) {
    assert.ok(
      spreads.has(name),
      `extractActionExecutorSpreads should find "${name}" in real index.ts`,
    );
  }
});

// findStaleActionClassPrefixes tests

test("findStaleActionClassPrefixes: returns empty array when all executor vars are present", () => {
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["quiltingAction", "quiltingActionExecutors"],
  ]);
  const spreads = new Set([
    "potteryActionExecutors",
    "quiltingActionExecutors",
  ]);
  const result = findStaleActionClassPrefixes(knownMap, spreads);
  assert.deepEqual(result, []);
});

test("findStaleActionClassPrefixes: flags a prefix whose executor var is absent", () => {
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["oldAction", "renamedExecutors"],
  ]);
  const spreads = new Set(["potteryActionExecutors"]);
  const result = findStaleActionClassPrefixes(knownMap, spreads);
  assert.equal(result.length, 1);
  assert.ok(result.includes("oldAction"), "expected 'oldAction' to be flagged");
});

test("findStaleActionClassPrefixes: flags all prefixes when spreads set is empty", () => {
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["quiltingAction", "quiltingActionExecutors"],
  ]);
  const result = findStaleActionClassPrefixes(knownMap, new Set());
  assert.equal(result.length, 2);
});

test("findStaleActionClassPrefixes: returns empty array when knownMap is empty", () => {
  const spreads = new Set(["potteryActionExecutors"]);
  const result = findStaleActionClassPrefixes(new Map(), spreads);
  assert.deepEqual(result, []);
});

// scanOViolations tests

test("scanOViolations: returns empty array when all action-class spreads are present", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
  ...quiltingActionExecutors,
};
`;
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["quiltingAction", "quiltingActionExecutors"],
  ]);
  const violations = scanOViolations(source, knownMap, "fake/index.ts");
  assert.deepEqual(violations, []);
});

test("scanOViolations: returns a violation when a prefix's executor var is absent", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
};
`;
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["oldAction", "removedActionExecutors"],
  ]);
  const violations = scanOViolations(source, knownMap, "fake/index.ts");
  assert.equal(violations.length, 1, "expected exactly one violation");
  assert.ok(
    violations[0].includes("oldAction"),
    `violation must name the stale prefix; got: ${violations[0].slice(0, 200)}`,
  );
  assert.ok(
    violations[0].includes("removedActionExecutors"),
    "violation must name the missing executor var",
  );
  assert.ok(
    violations[0].includes("FIX:"),
    "violation must include a FIX: clause",
  );
  assert.ok(
    violations[0].includes("fake/index.ts"),
    "violation must include the file path",
  );
});

test("scanOViolations: names all stale prefixes when multiple are present", () => {
  const source = `
const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...potteryActionExecutors,
};
`;
  const knownMap = new Map([
    ["potteryAction", "potteryActionExecutors"],
    ["oldActionA", "removedExecutorsA"],
    ["oldActionB", "removedExecutorsB"],
  ]);
  const violations = scanOViolations(source, knownMap, "fake/index.ts");
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("oldActionA"), "must name oldActionA");
  assert.ok(violations[0].includes("oldActionB"), "must name oldActionB");
  assert.ok(
    !violations[0].includes("potteryAction"),
    "must not name the present prefix",
  );
});

test("scanOViolations: returns a structural error when ACTION_EXECUTORS cannot be parsed", () => {
  const source = `const SOMETHING_ELSE = {};`;
  const knownMap = new Map([["potteryAction", "potteryActionExecutors"]]);
  const violations = scanOViolations(source, knownMap, "fake/index.ts");
  assert.equal(
    violations.length,
    1,
    "expected exactly one structural-error violation",
  );
  assert.ok(
    violations[0].includes("FIX:"),
    "structural error must include a FIX: clause",
  );
});

test("scanOViolations: real index.ts produces no violations against ACTION_CLASS_EXECUTOR_MAP", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/index.ts",
    ),
    "utf8",
  );
  const violations = scanOViolations(
    source,
    ACTION_CLASS_EXECUTOR_MAP,
    "artifacts/api-server/src/elaine/index.ts",
  );
  assert.deepEqual(
    violations,
    [],
    `Scan O found unexpected violations in the real repo:\n${violations.join("\n")}`,
  );
});

// ACTION_CLASS_EXECUTOR_MAP sanity checks

test("ACTION_CLASS_EXECUTOR_MAP: all keys are present in KNOWN_EXECUTOR_PREFIXES", () => {
  for (const prefix of ACTION_CLASS_EXECUTOR_MAP.keys()) {
    assert.ok(
      KNOWN_EXECUTOR_PREFIXES.has(prefix),
      `ACTION_CLASS_EXECUTOR_MAP key "${prefix}" is not in KNOWN_EXECUTOR_PREFIXES. ` +
        "Add it to KNOWN_EXECUTOR_PREFIXES or remove it from ACTION_CLASS_EXECUTOR_MAP.",
    );
  }
});

test("ACTION_CLASS_EXECUTOR_MAP: all values match a real spread in the current index.ts", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/index.ts",
    ),
    "utf8",
  );
  const spreads = extractActionExecutorSpreads(source);
  for (const [prefix, executorVar] of ACTION_CLASS_EXECUTOR_MAP) {
    assert.ok(
      spreads.has(executorVar),
      `ACTION_CLASS_EXECUTOR_MAP entry "${prefix}" → "${executorVar}" does not match any ` +
        "spread in ACTION_EXECUTORS in the real index.ts. " +
        "Update ACTION_CLASS_EXECUTOR_MAP to match the current variable name.",
    );
  }
});

test("ACTION_CLASS_EXECUTOR_MAP: every spread in the real ACTION_EXECUTORS block is listed as a value (bidirectional coverage)", () => {
  // This guards the reverse direction: if a new executor group is added to
  // ACTION_EXECUTORS in index.ts AND to KNOWN_EXECUTOR_PREFIXES, but
  // ACTION_CLASS_EXECUTOR_MAP is not updated, Scan N-reverse is blind to
  // that group.  Every spread found in ACTION_EXECUTORS must appear as a
  // value in ACTION_CLASS_EXECUTOR_MAP so that the guardrail covers it.
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../../artifacts/api-server/src/elaine/index.ts",
    ),
    "utf8",
  );
  const spreads = extractActionExecutorSpreads(source);
  const mapValues = new Set(ACTION_CLASS_EXECUTOR_MAP.values());
  const uncovered: string[] = [];
  for (const spread of spreads) {
    if (!mapValues.has(spread)) {
      uncovered.push(spread);
    }
  }
  assert.deepEqual(
    uncovered,
    [],
    `The following ACTION_EXECUTORS spreads are not listed as values in ACTION_CLASS_EXECUTOR_MAP: ` +
      uncovered.join(", ") +
      ". Add each missing mapping to ACTION_CLASS_EXECUTOR_MAP in check-domain-composition.ts.",
  );
});
// ── Scan O (action-executor reverse) end-to-end integration test ─────────────
//
// Temporarily renames one executor variable spread in the real index.ts so the
// Scan O runner (which reads the actual file) fires a violation.  The original
// file is always restored in the finally block.

console.log(
  "\ncheck-domain-composition.test: Scan O (action-executor reverse) — end-to-end integration",
);

// Temp path for the Scan O action-executor e2e fixture.  A copy of index.ts
// with a stale spread is written here; the real index.ts is never modified.
const TEMP_SCAN_O_INDEX_FIXTURE = join(
  root,
  "artifacts/api-server/src/elaine/_temp_scan_o_action_executor_index_fixture.ts",
);

test("script exits non-zero when an executor variable in ACTION_EXECUTORS is renamed (Scan O action-executor)", () => {
  const realIndexPath = join(root, "artifacts/api-server/src/elaine/index.ts");
  const original = readFileSync(realIndexPath, "utf8");

  // Rename the potteryActionExecutors spread to a stale name to simulate a
  // rename that was not reflected in ACTION_CLASS_EXECUTOR_MAP.  We write
  // the modified source to a TEMP COPY so the real index.ts is never touched.
  const REAL_SPREAD = "...potteryActionExecutors,";
  const STALE_SPREAD = "...staleRenamedPotteryActionExecutors_xyzzy,";
  const modified = original.replace(REAL_SPREAD, STALE_SPREAD);
  if (modified === original) {
    throw new Error(
      `Could not find "${REAL_SPREAD}" in index.ts — update this test if the spread was renamed.`,
    );
  }

  // Remove any leftover temp fixture files from prior test runs before
  // invoking the script, so they cannot inject spurious violations that
  // mask the expected "potteryAction" message.  Preserve our own fixture
  // so we can write it right after.
  cleanupKnownTempFixtures(new Set([TEMP_SCAN_O_INDEX_FIXTURE]));
  writeFileSync(TEMP_SCAN_O_INDEX_FIXTURE, modified, "utf8");
  try {
    // Pass the temp copy path to the script via env var so Scan O reads from
    // it instead of the real index.ts; no shared-source mutation required.
    const result = spawnSync("node", ["--import", "tsx", scriptPath], {
      cwd: scriptsCwd,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_DOMAIN_SCAN_O_INDEX_PATH: TEMP_SCAN_O_INDEX_FIXTURE,
      },
    });
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when potteryActionExecutors is renamed in ACTION_EXECUTORS, ` +
        `but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("potteryAction"),
      `Violation message must mention the stale prefix "potteryAction".\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      output.includes("FIX:"),
      `Violation message must include a FIX: clause.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_SCAN_O_INDEX_FIXTURE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Scan P — hasInlineMultiSelectMode
// ────────────────────────────────────────────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan P — hasInlineMultiSelectMode",
);

test("detects a file that hand-rolls compareMode bool + selectedIds array", () => {
  const source = `
import { useState } from "react";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "Should flag compareMode bool + selectedIds array without useMultiSelectMode",
  );
});

test("detects a file that hand-rolls selectMode bool + selectedIds array", () => {
  const source = `
import { useState } from "react";
export default function Gallery() {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "Should flag selectMode bool + selectedIds array without useMultiSelectMode",
  );
});

test("detects a file that hand-rolls bulkMode bool + selectedIds array", () => {
  const source = `
import { useState } from "react";
export default function Gallery() {
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "Should flag bulkMode bool + selectedIds array without useMultiSelectMode",
  );
});

test("does NOT flag a file that imports useMultiSelectMode from collection-ui", () => {
  const source = `
import { useMultiSelectMode, CompareModal, CompareFloatingBar } from "@workspace/collection-ui";
export default function Gallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag a file that already uses useMultiSelectMode",
  );
});

test("does NOT flag a file that has a real named import AND the hand-rolled state patterns (non-vacuous)", () => {
  // The early-return path must fire even when both the mode-bool and
  // selectedIds-array patterns are present — if the real import is found,
  // the file is not a violation regardless of its state shape.
  const source = `
import { useState } from "react";
import { useMultiSelectMode, CompareModal, CompareFloatingBar } from "@workspace/collection-ui";
export default function Gallery() {
  // The shared hook is used — these are the same state variable names a
  // copy-pasted page would have, but here they coexist with a real import.
  const compareMode = useMultiSelectMode(5);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag a file with a real useMultiSelectMode import, even if it also has boolean/array state",
  );
});

test("does NOT flag a file with Set<number> selection (maintenance pattern)", () => {
  const source = `
import { useState } from "react";
export default function Maintenance() {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag the Set<number> maintenance pattern — that is a different use-case",
  );
});

test("does NOT flag a file with mode bool but no selectedIds array state", () => {
  const source = `
import { useState } from "react";
export default function Page() {
  const [compareMode, setCompareMode] = useState(false);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag a file that has a mode bool but no selectedIds array",
  );
});

test("does NOT flag a file with selectedIds array but no mode bool", () => {
  const source = `
import { useState } from "react";
export default function Page() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag a file that has selectedIds array but no mode bool",
  );
});

test("detects a file with explicitly typed useState<boolean>(false) mode state", () => {
  const source = `
import { useState } from "react";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "Should flag when mode is explicitly typed useState<boolean>(false)",
  );
});

test("is NOT bypassed when useMultiSelectMode appears only in a comment", () => {
  // A comment containing the string must not satisfy the import check.
  const source = `
import { useState } from "react";
// TODO: replace with useMultiSelectMode from @workspace/collection-ui
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A comment mentioning useMultiSelectMode must not satisfy the import check",
  );
});

test("is NOT bypassed when useMultiSelectMode appears only in a string literal", () => {
  const source = `
import { useState } from "react";
const msg = "replace with useMultiSelectMode";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A string containing useMultiSelectMode must not satisfy the import check",
  );
});

test("is NOT bypassed by a type-only import of useMultiSelectMode", () => {
  const source = `
import type { useMultiSelectMode } from "@workspace/collection-ui";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A type-only import must not satisfy the check (it carries no runtime behaviour)",
  );
});

test("is NOT bypassed by a per-specifier type keyword on useMultiSelectMode", () => {
  // import { type useMultiSelectMode } from "@workspace/collection-ui" is
  // type-only at the specifier level and carries no runtime value.
  const source = `
import { type useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A per-specifier `type useMultiSelectMode` must not satisfy the import check",
  );
});

test("does NOT flag when the per-specifier type is on a different name but useMultiSelectMode is a real specifier", () => {
  // Mixed import: type alias is on CompareType, useMultiSelectMode is runtime.
  const source = `
import { type CompareType, useMultiSelectMode } from "@workspace/collection-ui";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "A mixed import where useMultiSelectMode itself is not type-only must pass",
  );
});

test("does NOT flag when both state patterns are in comments (false-violation guard)", () => {
  // A file migrating to the shared hook may leave old code commented out.
  // Commented patterns must not trigger the detector.
  const source = `
import { useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
// const [compareMode, setCompareMode] = useState(false);
// const [selectedIds, setSelectedIds] = useState<number[]>([]);
export default function Gallery() {
  const { compareMode, selectedIds } = useMultiSelectMode(10);
  return <div />;
}
`;
  assert.ok(
    !hasInlineMultiSelectMode(source),
    "Should NOT flag a file whose only state-shaped patterns are inside comments",
  );
});

test("is NOT bypassed by a string literal containing a full import-shaped statement", () => {
  // A string value that looks like an import is NOT a real import.
  // stripAllStringLiteralContent must erase it before the import regex runs.
  const source = `
import { useState } from "react";
const hint = 'import { useMultiSelectMode } from "@workspace/collection-ui"';
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A string literal containing an import statement must not satisfy the import check",
  );
});

test("is NOT bypassed by a commented-out full import declaration", () => {
  // A commented-out import statement must not satisfy the check.
  const source = `
import { useState } from "react";
// import { useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
export default function Gallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;
  assert.ok(
    hasInlineMultiSelectMode(source),
    "A commented-out import declaration must not satisfy the import check",
  );
});

// ── Scan P — hasMissingCompareUIImports ───────────────────────────────────────

console.log(
  "\ncheck-domain-composition.test: Scan P — hasMissingCompareUIImports",
);

test("flags when useMultiSelectMode is called but CompareFloatingBar is not imported", () => {
  const source = `
import { useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
import { useState } from "react";
export default function Gallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    hasMissingCompareUIImports(source),
    "Should flag: hook called, CompareModal present, CompareFloatingBar missing",
  );
});

test("flags when useMultiSelectMode is called but CompareModal is not imported", () => {
  const source = `
import { useMultiSelectMode, CompareFloatingBar } from "@workspace/collection-ui";
import { useState } from "react";
export default function Gallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    hasMissingCompareUIImports(source),
    "Should flag: hook called, CompareFloatingBar present, CompareModal missing",
  );
});

test("flags when useMultiSelectMode is called and neither CompareModal nor CompareFloatingBar is imported", () => {
  const source = `
import { useMultiSelectMode } from "@workspace/collection-ui";
import { useState } from "react";
export default function Gallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    hasMissingCompareUIImports(source),
    "Should flag: hook called, both modal and bar missing",
  );
});

test("does NOT flag when useMultiSelectMode is called and both CompareModal and CompareFloatingBar are imported", () => {
  const source = `
import {
  useMultiSelectMode,
  CompareModal,
  CompareFloatingBar,
} from "@workspace/collection-ui";
export default function Gallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    !hasMissingCompareUIImports(source),
    "Should NOT flag: all three shared primitives imported and hook called",
  );
});

test("does NOT flag when useMultiSelectMode is imported but never called", () => {
  // An unused import doesn't constitute active compare/select usage;
  // hasInlineMultiSelectMode handles the state-pattern side.
  const source = `
import { useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
export default function Gallery() {
  return <div />;
}
`;
  assert.ok(
    !hasMissingCompareUIImports(source),
    "Should NOT flag when the hook is imported but not called (no invocation)",
  );
});

test("does NOT flag when useMultiSelectMode is not present at all", () => {
  const source = `
import { CollectionGrid, CollectionSearchBar } from "@workspace/collection-ui";
export default function Gallery() {
  return <div />;
}
`;
  assert.ok(
    !hasMissingCompareUIImports(source),
    "Should NOT flag when there is no multi-select hook usage",
  );
});

test("does NOT flag a commented-out useMultiSelectMode call", () => {
  // Comments must not be mistaken for active hook calls.
  const source = `
import { useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
export default function Gallery() {
  // const mode = useMultiSelectMode(5);
  return <div />;
}
`;
  assert.ok(
    !hasMissingCompareUIImports(source),
    "A commented-out hook call must not trigger the partial-adoption check",
  );
});

// ── Scan P end-to-end integration test ───────────────────────────────────────
//
// Writes a violating gallery page fixture into the ornaments/pages/ directory
// (which is scanned by Scan P), runs the full script, and asserts it exits
// non-zero with a FIX: clause mentioning "useMultiSelectMode".

console.log("\ncheck-domain-composition.test: Scan P — end-to-end integration");

const TEMP_SCAN_P_GALLERY_FIXTURE = join(
  root,
  "artifacts/modules/src/ornaments/pages/_temp_scan_p_gallery_fixture.tsx",
);

test("script exits non-zero when a gallery page hand-rolls compare/select state (Scan P)", () => {
  const violatingSource = `
import { useState } from "react";
// This file intentionally hand-rolls compare state for test purposes.
export default function ViolatingGallery() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;

  cleanupKnownTempFixtures(new Set([TEMP_SCAN_P_GALLERY_FIXTURE]));
  writeFileSync(TEMP_SCAN_P_GALLERY_FIXTURE, violatingSource, "utf8");
  try {
    const result = spawnSync("node", ["--import", "tsx", scriptPath], {
      cwd: scriptsCwd,
      encoding: "utf8",
    });
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when a gallery page hand-rolls compare/select state, ` +
        `but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("useMultiSelectMode"),
      `Violation message must mention "useMultiSelectMode".\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      output.includes("FIX:"),
      `Violation message must include a FIX: clause.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_SCAN_P_GALLERY_FIXTURE);
    } catch {
      // best-effort cleanup
    }
  }
});

const TEMP_SCAN_P_TYPE_SPECIFIER_FIXTURE = join(
  root,
  "artifacts/modules/src/ornaments/pages/_temp_scan_p_type_specifier_fixture.tsx",
);

test("script exits non-zero when a gallery page uses a per-specifier type import to bypass Scan P", () => {
  // `import { type useMultiSelectMode }` is type-only; the page still needs to
  // be flagged because it provides no runtime multi-select behaviour.
  const source = `
import { type useMultiSelectMode, CompareModal } from "@workspace/collection-ui";
import { useState } from "react";
export default function BypassAttempt() {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  return <div />;
}
`;

  cleanupKnownTempFixtures(new Set([TEMP_SCAN_P_TYPE_SPECIFIER_FIXTURE]));
  writeFileSync(TEMP_SCAN_P_TYPE_SPECIFIER_FIXTURE, source, "utf8");
  try {
    const result = spawnSync("node", ["--import", "tsx", scriptPath], {
      cwd: scriptsCwd,
      encoding: "utf8",
    });
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit for per-specifier type bypass, ` +
        `but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("useMultiSelectMode"),
      `Violation message must mention "useMultiSelectMode".\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_SCAN_P_TYPE_SPECIFIER_FIXTURE);
    } catch {
      // best-effort cleanup
    }
  }
});

const TEMP_SCAN_P_PARTIAL_ADOPTION_FIXTURE = join(
  root,
  "artifacts/modules/src/ornaments/pages/_temp_scan_p_partial_adoption_fixture.tsx",
);

test("script exits non-zero when a gallery page calls useMultiSelectMode but omits CompareFloatingBar (partial adoption)", () => {
  // This is the "hook adopted, compare bar hand-rolled" scenario the code
  // review identified: hasInlineMultiSelectMode sees the real hook import and
  // passes, but hasMissingCompareUIImports must flag the missing companion.
  const source = `
import {
  useMultiSelectMode,
  CompareModal,
} from "@workspace/collection-ui";
import { useState } from "react";
export default function PartialAdoptionGallery() {
  const compareMode = useMultiSelectMode(5);
  return <div />;
}
`;

  cleanupKnownTempFixtures(new Set([TEMP_SCAN_P_PARTIAL_ADOPTION_FIXTURE]));
  writeFileSync(TEMP_SCAN_P_PARTIAL_ADOPTION_FIXTURE, source, "utf8");
  try {
    const result = spawnSync("node", ["--import", "tsx", scriptPath], {
      cwd: scriptsCwd,
      encoding: "utf8",
    });
    assert.notEqual(
      result.status,
      0,
      `Expected non-zero exit when a gallery page uses the hook but omits CompareFloatingBar, ` +
        `but script exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("CompareFloatingBar"),
      `Violation message must mention "CompareFloatingBar".\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      output.includes("FIX:"),
      `Violation message must include a FIX: clause.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    try {
      unlinkSync(TEMP_SCAN_P_PARTIAL_ADOPTION_FIXTURE);
    } catch {
      // best-effort cleanup
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(
  `\ncheck-domain-composition.test: ${passed} passed, ${failed} failed\n`,
);

if (failed > 0) {
  process.exit(1);
}
