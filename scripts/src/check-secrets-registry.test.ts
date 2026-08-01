#!/usr/bin/env tsx
/**
 * check-secrets-registry.test.ts — unit tests for the secrets-registry drift guard.
 *
 * Uses only Node built-ins (node:assert) so no extra test-framework dependency
 * is needed.  Each exported function is exercised against synthetic source strings
 * covering plain literal calls, ternary expressions, and missing/present registry
 * entries.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import {
  findMatchingParen,
  extractEnvLiterals,
  parseEnvTs,
  parseSyncTs,
  checkDrift,
  INTENTIONALLY_EXCLUDED,
} from "./check-secrets-registry.js";

// ────────────────────────────────────────────────────────────────────────────
// Minimal test harness
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
// findMatchingParen
// ────────────────────────────────────────────────────────────────────────────

console.log("\nfindMatchingParen");

test("finds simple paren", () => {
  assert.equal(findMatchingParen("(abc)", 0), 4);
});

test("handles nested parens", () => {
  assert.equal(findMatchingParen("(a(b)c)", 0), 6);
});

test("skips string literals containing parens", () => {
  assert.equal(findMatchingParen('("a(b)")', 0), 7);
});

test("returns -1 when no matching paren", () => {
  assert.equal(findMatchingParen("(abc", 0), -1);
});

// ────────────────────────────────────────────────────────────────────────────
// extractEnvLiterals
// ────────────────────────────────────────────────────────────────────────────

console.log("\nextractEnvLiterals");

test("extracts simple literal", () => {
  assert.deepEqual(extractEnvLiterals('"SESSION_SECRET"'), ["SESSION_SECRET"]);
});

test("extracts both sides of a ternary", () => {
  const body = `process.env.NODE_ENV === "production"
    ? "RESEND_WEBHOOK_SECRET_PROD"
    : "RESEND_WEBHOOK_SECRET_DEV"`;
  const result = extractEnvLiterals(body);
  assert.ok(result.includes("RESEND_WEBHOOK_SECRET_PROD"), "missing PROD key");
  assert.ok(result.includes("RESEND_WEBHOOK_SECRET_DEV"), "missing DEV key");
});

test("ignores lowercase string like 'production'", () => {
  const result = extractEnvLiterals('"production"');
  assert.deepEqual(result, []);
});

test("ignores short UPPERCASE strings (less than 3 chars total)", () => {
  const result = extractEnvLiterals('"AB"');
  assert.deepEqual(result, []);
});

// ────────────────────────────────────────────────────────────────────────────
// parseEnvTs
// ────────────────────────────────────────────────────────────────────────────

console.log("\nparseEnvTs");

test("extracts required() key as required=true", () => {
  const src = `export const env = { foo: required("SESSION_SECRET") };`;
  const keys = parseEnvTs(src);
  const k = keys.find((k) => k.name === "SESSION_SECRET");
  assert.ok(k, "key not found");
  assert.equal(k!.required, true);
});

test("extracts optional() key as required=false", () => {
  const src = `export const env = { foo: optional("JINA_API_KEY") };`;
  const keys = parseEnvTs(src);
  const k = keys.find((k) => k.name === "JINA_API_KEY");
  assert.ok(k, "key not found");
  assert.equal(k!.required, false);
});

test("extracts devOrRequired() prod key as required=true", () => {
  const src = `export const env = { foo: devOrRequired("DEV_SUPABASE_URL", "SUPABASE_URL") };`;
  const keys = parseEnvTs(src);
  const prod = keys.find((k) => k.name === "SUPABASE_URL");
  assert.ok(prod, "prod key not found");
  assert.equal(prod!.required, true);
  const dev = keys.find((k) => k.name === "DEV_SUPABASE_URL");
  assert.ok(dev, "dev key not found");
  assert.equal(dev!.required, false);
});

test("extracts both branches of a ternary inside optional()", () => {
  const src = `
    resendWebhookSecret: optional(
      process.env.NODE_ENV === "production"
        ? "RESEND_WEBHOOK_SECRET_PROD"
        : "RESEND_WEBHOOK_SECRET_DEV",
    ),
  `;
  const keys = parseEnvTs(src);
  assert.ok(
    keys.some((k) => k.name === "RESEND_WEBHOOK_SECRET_PROD"),
    "missing PROD key",
  );
  assert.ok(
    keys.some((k) => k.name === "RESEND_WEBHOOK_SECRET_DEV"),
    "missing DEV key",
  );
  // Both are inside optional() so both should be required=false
  const prod = keys.find((k) => k.name === "RESEND_WEBHOOK_SECRET_PROD");
  assert.equal(prod!.required, false);
});

test("extracts direct process.env['KEY'] access", () => {
  const src = `const x = process.env["REPLIT_DEPLOYMENT"] === "1";`;
  const keys = parseEnvTs(src);
  assert.ok(
    keys.some((k) => k.name === "REPLIT_DEPLOYMENT"),
    "key not found",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// parseSyncTs — scoped to SECRETS array
// ────────────────────────────────────────────────────────────────────────────

console.log("\nparseSyncTs");

const SYNTHETIC_SYNC = `
const HELPER = { name: "SHOULD_NOT_APPEAR" };

const SECRETS: Array<{ name: string; required: boolean }> = [
  { name: "SESSION_SECRET", purpose: "...", required: true },
  { name: "OPENROUTER_API_KEY", purpose: "...", required: true },
  { name: "JINA_API_KEY", purpose: "...", required: false },
];
`;

test("extracts names from the SECRETS array", () => {
  const names = parseSyncTs(SYNTHETIC_SYNC);
  assert.ok(names.has("SESSION_SECRET"), "missing SESSION_SECRET");
  assert.ok(names.has("OPENROUTER_API_KEY"), "missing OPENROUTER_API_KEY");
  assert.ok(names.has("JINA_API_KEY"), "missing JINA_API_KEY");
});

test("does NOT include names from objects outside the SECRETS array", () => {
  const names = parseSyncTs(SYNTHETIC_SYNC);
  assert.equal(
    names.has("SHOULD_NOT_APPEAR"),
    false,
    "should not include HELPER.name",
  );
});

test("returns empty set when SECRETS array is absent", () => {
  const names = parseSyncTs("const foo = 42;");
  assert.equal(names.size, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// checkDrift — integration
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheckDrift");

const SYNC_WITH_BOTH = `
const SECRETS = [
  { name: "SESSION_SECRET", required: true },
  { name: "RESEND_WEBHOOK_SECRET_PROD", required: true },
];
`;

test("no drift when all required keys are in SECRETS", () => {
  const envSrc = `export const env = { s: required("SESSION_SECRET") };`;
  const { missingRequired, missingOptional } = checkDrift(
    envSrc,
    SYNC_WITH_BOTH,
  );
  assert.deepEqual(missingRequired, []);
  assert.deepEqual(missingOptional, []);
});

test("flags required key absent from SECRETS", () => {
  const envSrc = `export const env = { s: required("MISSING_REQUIRED_KEY") };`;
  const { missingRequired } = checkDrift(envSrc, SYNC_WITH_BOTH);
  assert.ok(missingRequired.includes("MISSING_REQUIRED_KEY"));
});

test("flags optional key absent from SECRETS", () => {
  const envSrc = `export const env = { s: optional("MISSING_OPTIONAL_KEY") };`;
  const { missingOptional } = checkDrift(envSrc, SYNC_WITH_BOTH);
  assert.ok(missingOptional.includes("MISSING_OPTIONAL_KEY"));
});

test("does NOT flag keys in INTENTIONALLY_EXCLUDED", () => {
  // Pick a key we know is excluded
  assert.ok(
    INTENTIONALLY_EXCLUDED.has("DEV_SCREENSHOT_TOKEN"),
    "test precondition: DEV_SCREENSHOT_TOKEN must be excluded",
  );
  const envSrc = `export const env = { s: optional("DEV_SCREENSHOT_TOKEN") };`;
  const { missingRequired, missingOptional } = checkDrift(
    envSrc,
    SYNC_WITH_BOTH,
  );
  assert.deepEqual(missingRequired, []);
  assert.deepEqual(missingOptional, []);
});

// ── Regression: RESEND_WEBHOOK_SECRET_PROD inside a ternary ─────────────────

test("regression: RESEND_WEBHOOK_SECRET_PROD detected even when inside a ternary", () => {
  const envSrc = `
    export const env = {
      resendWebhookSecret: optional(
        process.env.NODE_ENV === "production"
          ? "RESEND_WEBHOOK_SECRET_PROD"
          : "RESEND_WEBHOOK_SECRET_DEV",
      ),
    };
  `;
  // Sync WITHOUT the prod key — should be flagged as missing
  const syncWithoutProd = `const SECRETS = [{ name: "SESSION_SECRET", required: true }];`;
  const { missingOptional } = checkDrift(envSrc, syncWithoutProd);
  assert.ok(
    missingOptional.includes("RESEND_WEBHOOK_SECRET_PROD"),
    "RESEND_WEBHOOK_SECRET_PROD should be flagged when absent from SECRETS",
  );
});

test("regression: RESEND_WEBHOOK_SECRET_PROD NOT flagged when present in SECRETS", () => {
  const envSrc = `
    export const env = {
      resendWebhookSecret: optional(
        process.env.NODE_ENV === "production"
          ? "RESEND_WEBHOOK_SECRET_PROD"
          : "RESEND_WEBHOOK_SECRET_DEV",
      ),
    };
  `;
  const syncWithProd = `const SECRETS = [
    { name: "SESSION_SECRET", required: true },
    { name: "RESEND_WEBHOOK_SECRET_PROD", required: true },
  ];`;
  const { missingRequired, missingOptional } = checkDrift(envSrc, syncWithProd);
  assert.equal(
    missingOptional.includes("RESEND_WEBHOOK_SECRET_PROD"),
    false,
    "RESEND_WEBHOOK_SECRET_PROD must not be flagged when it IS in SECRETS",
  );
  assert.deepEqual(missingRequired, []);
});

test("regression: SLACK_SIGNING_SECRET flagged when absent from SECRETS", () => {
  const envSrc = `export const env = { s: optional("SLACK_SIGNING_SECRET") };`;
  const syncWithout = `const SECRETS = [{ name: "SESSION_SECRET", required: true }];`;
  const { missingOptional } = checkDrift(envSrc, syncWithout);
  assert.ok(
    missingOptional.includes("SLACK_SIGNING_SECRET"),
    "SLACK_SIGNING_SECRET should be flagged when absent",
  );
});

test("regression: SLACK_BOT_TOKEN flagged when absent from SECRETS", () => {
  const envSrc = `export const env = { s: optional("SLACK_BOT_TOKEN") };`;
  const syncWithout = `const SECRETS = [{ name: "SESSION_SECRET", required: true }];`;
  const { missingOptional } = checkDrift(envSrc, syncWithout);
  assert.ok(
    missingOptional.includes("SLACK_BOT_TOKEN"),
    "SLACK_BOT_TOKEN should be flagged when absent",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
