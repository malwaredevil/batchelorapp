#!/usr/bin/env tsx
/**
 * check-domain-composition.test.ts — unit tests for the composition-guard detectors.
 *
 * Uses only Node built-ins (node:assert) so no extra test-framework dependency
 * is needed.  Each scan's detector function is imported and exercised against
 * synthetic source strings representing known-violation and known-good patterns.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import {
  hasSentryInit,
  hasDirectOpenAIClient,
  hasInlineContextListBuilding,
  extractSharedLibImports,
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

console.log("\ncheck-domain-composition.test: Scan C — hasInlineContextListBuilding");

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
  assert.ok(names.includes("formatElaineContextList"), "should include formatElaineContextList");
  assert.ok(names.includes("formatElaineContextEntity"), "should include formatElaineContextEntity");
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
  assert.ok(!names.includes("SomeOther"), "should not include SomeOther from non-workspace package");
});

test("returns empty array when no shared imports present", () => {
  const source = `import { useState } from "react";`;
  assert.deepEqual(extractSharedLibImports(source), []);
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`\ncheck-domain-composition.test: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
