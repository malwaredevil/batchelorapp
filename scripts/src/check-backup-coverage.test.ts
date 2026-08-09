#!/usr/bin/env tsx
/**
 * check-backup-coverage.test.ts
 *
 * Unit tests for the backup-coverage guard logic.
 *
 * Exercises the exported helper functions with synthetic schema / script
 * content to verify that:
 *   - A table in schema + both scripts → passes
 *   - A table in schema but missing from backup → fails
 *   - A table in schema but missing from restore → fails
 *   - A table in INTENTIONAL_SKIPS (non-TODO) → passes even if absent
 *   - A TODO: entry in INTENTIONAL_SKIPS → fails (TODO entries are banned)
 *   - A table in backup but not restore, listed in RESTORE_SKIP_EXTRA → warned, not failed
 *
 * Also includes an integration smoke test that runs the actual script against
 * the real repo files to verify it exits 0.
 *
 * Run via: pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  extractSchemaTables,
  extractCopyTableNames,
  runCoverageCheck,
  INTENTIONAL_SKIPS,
  RESTORE_SKIP_EXTRA,
} from "./check-backup-coverage.js";

// ────────────────────────────────────────────────────────────────────────────
// Minimal test harness (mirrors the pattern used by check-domain-composition.test.ts)
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
// Helpers for synthetic fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeTables(names: string[]): Set<string> {
  return new Set(names);
}

// ────────────────────────────────────────────────────────────────────────────
// Unit tests — extractSchemaTables
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-backup-coverage.test: extractSchemaTables");

test("finds single-line pgTable call", () => {
  const dir = mkdtempSync(join(tmpdir(), "schema-test-"));
  writeFileSync(
    join(dir, "example.ts"),
    `export const foo = pgTable("my_table", { id: serial("id") });`,
  );
  const tables = extractSchemaTables(dir);
  assert.ok(tables.has("my_table"), "should find my_table");
  rmSync(dir, { recursive: true });
});

test("finds multi-line pgTable call", () => {
  const dir = mkdtempSync(join(tmpdir(), "schema-test-"));
  writeFileSync(
    join(dir, "example.ts"),
    `export const foo = pgTable(\n  "multi_line_table",\n  { id: serial("id") }\n);`,
  );
  const tables = extractSchemaTables(dir);
  assert.ok(tables.has("multi_line_table"), "should find multi_line_table");
  rmSync(dir, { recursive: true });
});

test("finds multiple tables across multiple files", () => {
  const dir = mkdtempSync(join(tmpdir(), "schema-test-"));
  writeFileSync(join(dir, "a.ts"), `export const a = pgTable("table_a", {});`);
  writeFileSync(join(dir, "b.ts"), `export const b = pgTable("table_b", {});`);
  // index.ts should be excluded
  writeFileSync(
    join(dir, "index.ts"),
    `export const c = pgTable("table_c", {});`,
  );
  const tables = extractSchemaTables(dir);
  assert.ok(tables.has("table_a"), "should find table_a");
  assert.ok(tables.has("table_b"), "should find table_b");
  assert.ok(!tables.has("table_c"), "should NOT find table_c (from index.ts)");
  rmSync(dir, { recursive: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests — extractCopyTableNames
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-backup-coverage.test: extractCopyTableNames");

test("finds table: 'name' pattern", () => {
  const dir = mkdtempSync(join(tmpdir(), "script-test-"));
  const f = join(dir, "backup.ts");
  writeFileSync(
    f,
    `await copyTable(source, dest, { table: "my_table", columns: ["id"] });`,
  );
  const tables = extractCopyTableNames(f);
  assert.ok(tables.has("my_table"), "should find my_table");
  rmSync(dir, { recursive: true });
});

test("finds multiple table entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "script-test-"));
  const f = join(dir, "backup.ts");
  writeFileSync(
    f,
    [
      `await copyTable(source, dest, { table: "table_a", columns: ["id"] });`,
      `await copyTable(source, dest, { table: "table_b", columns: ["id"] });`,
    ].join("\n"),
  );
  const tables = extractCopyTableNames(f);
  assert.ok(tables.has("table_a"));
  assert.ok(tables.has("table_b"));
  rmSync(dir, { recursive: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Unit tests — runCoverageCheck
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-backup-coverage.test: runCoverageCheck");

test("passes when table is in schema + both scripts", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["my_table"]),
    backupTables: makeTables(["my_table"]),
    restoreTables: makeTables(["my_table"]),
    intentionalSkips: {},
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, false, "should not fail");
  assert.equal(result.errors.length, 0);
});

test("fails when table is in schema but missing from backup", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["my_table"]),
    backupTables: makeTables([]),
    restoreTables: makeTables(["my_table"]),
    intentionalSkips: {},
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, true, "should fail");
  assert.ok(
    result.errors.some((e) => e.includes("backup-to-replit.ts")),
    "error should mention backup-to-replit.ts",
  );
});

test("fails when table is in schema but missing from restore", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["my_table"]),
    backupTables: makeTables(["my_table"]),
    restoreTables: makeTables([]),
    intentionalSkips: {},
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, true, "should fail");
  assert.ok(
    result.errors.some((e) => e.includes("restore-from-replit.ts")),
    "error should mention restore-from-replit.ts",
  );
});

test("fails when table is missing from both scripts", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["my_table"]),
    backupTables: makeTables([]),
    restoreTables: makeTables([]),
    intentionalSkips: {},
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, true, "should fail");
  assert.ok(result.errors.some((e) => e.includes("backup-to-replit.ts")));
  assert.ok(result.errors.some((e) => e.includes("restore-from-replit.ts")));
});

test("passes when table is in INTENTIONAL_SKIPS with a genuine reason", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["ephemeral_tokens"]),
    backupTables: makeTables([]),
    restoreTables: makeTables([]),
    intentionalSkips: {
      ephemeral_tokens: "ephemeral — regenerated on demand",
    },
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, false, "should pass — genuinely skipped");
  assert.equal(result.errors.length, 0);
});

test("fails when INTENTIONAL_SKIPS entry starts with TODO:", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["user_data_table"]),
    backupTables: makeTables([]),
    restoreTables: makeTables([]),
    intentionalSkips: {
      user_data_table: "TODO: should be backed up (add copyTable calls)",
    },
    restoreSkipExtra: {},
  });
  assert.equal(result.failed, true, "TODO entries must be rejected");
  assert.ok(result.errors.some((e) => e.includes('begins with "TODO:"')));
});

test("warns (but does not fail) when backup-only table is in RESTORE_SKIP_EXTRA", () => {
  const result = runCoverageCheck({
    schemaTables: makeTables(["monitoring_obs"]),
    backupTables: makeTables(["monitoring_obs"]),
    restoreTables: makeTables([]),
    intentionalSkips: {},
    restoreSkipExtra: {
      monitoring_obs: "auto-generated observations — rebuilt on next check",
    },
  });
  assert.equal(result.failed, false, "should not fail — known asymmetry");
  assert.ok(result.warnings.some((w) => w.includes("monitoring_obs")));
});

// ────────────────────────────────────────────────────────────────────────────
// Invariant tests on the real skip lists
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-backup-coverage.test: INTENTIONAL_SKIPS invariants");

test("no INTENTIONAL_SKIPS entry starts with TODO:", () => {
  const todos = Object.entries(INTENTIONAL_SKIPS).filter(([, reason]) =>
    reason.startsWith("TODO:"),
  );
  assert.deepEqual(
    todos,
    [],
    `Found TODO entries in INTENTIONAL_SKIPS: ${todos.map(([t]) => t).join(", ")}`,
  );
});

test("all INTENTIONAL_SKIPS entries have a non-empty reason", () => {
  const empty = Object.entries(INTENTIONAL_SKIPS).filter(
    ([, reason]) => !reason || reason.trim().length < 10,
  );
  assert.deepEqual(
    empty,
    [],
    `Entries with missing/short reasons: ${empty.map(([t]) => t).join(", ")}`,
  );
});

test("all RESTORE_SKIP_EXTRA entries have a non-empty reason", () => {
  const empty = Object.entries(RESTORE_SKIP_EXTRA).filter(
    ([, reason]) => !reason || reason.trim().length < 10,
  );
  assert.deepEqual(
    empty,
    [],
    `Entries with missing/short reasons: ${empty.map(([t]) => t).join(", ")}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Integration smoke test — run the real script against the actual repo
// ────────────────────────────────────────────────────────────────────────────

console.log("\ncheck-backup-coverage.test: integration smoke test");

// Resolve the tsx binary bundled with this package so spawnSync can find it
// regardless of the caller's PATH (e.g. when run via pnpm exec).
const TSX_BIN = join(import.meta.dirname, "..", "node_modules", ".bin", "tsx");
const REPO_ROOT = join(import.meta.dirname, "..", "..");

test("script exits 0 on the actual repo (all tables accounted for)", () => {
  const result = spawnSync(TSX_BIN, ["scripts/src/check-backup-coverage.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `Script exited ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
});

test("script exits non-zero when a new schema table is not in scripts", () => {
  // Write a temporary schema file with a new unregistered table
  const schemaDir = join(REPO_ROOT, "lib", "db", "src", "schema");
  const tempFile = join(schemaDir, "_test_sentinel_table_.ts");
  writeFileSync(
    tempFile,
    `import { pgTable, serial } from "drizzle-orm/pg-core";\nexport const testSentinel = pgTable("test_sentinel_table_xyz", { id: serial("id").primaryKey() });\n`,
  );
  try {
    const result = spawnSync(
      TSX_BIN,
      ["scripts/src/check-backup-coverage.ts"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.notEqual(
      result.status,
      0,
      "Script should exit non-zero when a schema table is missing from scripts",
    );
    assert.ok(
      (result.stderr + result.stdout).includes("test_sentinel_table_xyz"),
      "Output should name the missing table",
    );
  } finally {
    rmSync(tempFile);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(`\ncheck-backup-coverage.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
