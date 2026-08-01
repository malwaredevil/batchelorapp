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
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  hasSentryInit,
  hasDirectOpenAIClient,
  hasInlineContextListBuilding,
  hasLabeledEntityIdInContext,
  hasBareEntityIdInContext,
  extractSharedLibImports,
  checkRequirementContents,
  checkRequirementFile,
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

test("script exits 0 against the real (clean) repo", () => {
  const result = runScript();
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
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(
  `\ncheck-domain-composition.test: ${passed} passed, ${failed} failed\n`,
);

if (failed > 0) {
  process.exit(1);
}
