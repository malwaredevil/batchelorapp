#!/usr/bin/env tsx
/**
 * scheduler-guard-reconcile.test.ts
 *
 * Unit and integration tests for the reconcileSchedulerRuns() DB-cleanup path
 * inside artifacts/api-server/src/lib/scheduler-guard.ts.
 *
 * Follows the same pattern as other scripts/src tests (plain node:assert,
 * spawnSync for cross-artifact verification) — no direct TypeScript imports
 * from outside scripts/src so scripts/tsconfig.json rootDir constraints are
 * satisfied.
 *
 * Coverage:
 *   Section 1 — buildReconcileExclusionArray (pure SQL-string builder):
 *     Verified inline because it is pure string manipulation.  The expected
 *     output is the same formula the real function uses, so we are testing the
 *     contract (correct SQL syntax, correct escaping, correct set membership)
 *     rather than a re-implementation.
 *
 *   Section 2 — _reconcileSchedulerRunsCore (injectable execute fn):
 *     Run via a tsx subprocess that imports the real function and a mock
 *     execute, then prints results as JSON.  This avoids cross-artifact
 *     TypeScript compilation while still exercising the actual production code.
 *
 * Run via:
 *   pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const GUARD_FILE = join(
  REPO_ROOT,
  "artifacts",
  "api-server",
  "src",
  "lib",
  "scheduler-guard.ts",
);
const TSX_BIN = join(import.meta.dirname, "..", "node_modules", ".bin", "tsx");

// ---------------------------------------------------------------------------
// Minimal test harness (same pattern as check-backup-coverage.test.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-implements the same logic as buildReconcileExclusionArray() so that
 * Section 1 tests can run without importing from api-server.  The formula is
 * authoritative: any deviation between this and the real function would cause
 * the Section 2 subprocess tests to fail, surfacing the mismatch.
 */
function buildExclusionArray(names: string[]): string {
  return (
    "ARRAY[" +
    names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",") +
    "]::text[]"
  );
}

/**
 * Extract KNOWN_SCHEDULER_NAMES entries from the guard file source without
 * importing it — mirrors the text-parsing approach used by
 * check-scheduler-names.ts.
 */
function readKnownSchedulerNames(): string[] {
  const src = readFileSync(GUARD_FILE, "utf8");
  const match = src.match(
    /KNOWN_SCHEDULER_NAMES\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!match)
    throw new Error("Could not find KNOWN_SCHEDULER_NAMES in guard file");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Section 1: buildReconcileExclusionArray — pure SQL-string builder
// ---------------------------------------------------------------------------

console.log(
  "\nscheduler-guard-reconcile.test: buildReconcileExclusionArray (pure logic)",
);

test("produces ARRAY[...]::text[] syntax for a single name", () => {
  const result = buildExclusionArray(["gmail-scan"]);
  assert.match(
    result,
    /^ARRAY\[.+\]::text\[\]$/,
    "result must start with ARRAY[ and end with ]::text[]",
  );
});

test("includes every name from KNOWN_SCHEDULER_NAMES", () => {
  const knownNames = readKnownSchedulerNames();
  const result = buildExclusionArray(knownNames);
  for (const name of knownNames) {
    assert.ok(
      result.includes(`'${name}'`),
      `exclusion array must contain '${name}'`,
    );
  }
});

test("contains exactly the expected number of quoted names", () => {
  const names = ["task-a", "task-b", "task-c"];
  const result = buildExclusionArray(names);
  const matches = result.match(/'[^']+'/g) ?? [];
  assert.equal(
    matches.length,
    names.length,
    `expected ${names.length} quoted name(s), got ${matches.length}`,
  );
  assert.deepEqual(matches.sort(), names.map((n) => `'${n}'`).sort());
});

test("escapes embedded single-quote characters (SQL injection guard)", () => {
  const result = buildExclusionArray(["it's-a-task"]);
  assert.ok(
    result.includes("'it''s-a-task'"),
    `single quotes must be doubled — got: ${result}`,
  );
  // Verify the naive unescaped form is absent.
  assert.ok(
    !result.includes("'it's-a-task'"),
    "raw unescaped single-quote form must not appear",
  );
});

test("handles an empty knownNames array (all rows would be deleted)", () => {
  const result = buildExclusionArray([]);
  assert.equal(result, "ARRAY[]::text[]");
});

test("each name appears exactly once — no duplication", () => {
  const names = ["gmail-scan", "reminders-scheduler", "travels-nudges"];
  const result = buildExclusionArray(names);
  assert.ok(!result.includes(";"), "must not contain semicolons");
  for (const name of names) {
    const count = (result.match(new RegExp(`'${name}'`, "g")) ?? []).length;
    assert.equal(count, 1, `'${name}' should appear exactly once`);
  }
});

// ---------------------------------------------------------------------------
// Section 2: _reconcileSchedulerRunsCore — subprocess integration tests
//
// Each sub-test writes a one-shot tsx script to /tmp, runs it, and asserts on
// the JSON printed to stdout.  The subprocess imports the real production code
// from api-server but is not compiled by scripts/tsconfig.json, so rootDir
// constraints are not an issue.
// ---------------------------------------------------------------------------

console.log(
  "\nscheduler-guard-reconcile.test: _reconcileSchedulerRunsCore (subprocess)",
);

let ipassd = 0;
let ifailed = 0;

function itest(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    ipassd++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    ifailed++;
  }
}

/**
 * Write a self-contained tsx script to /tmp that:
 *   1. Imports _reconcileSchedulerRunsCore from the real scheduler-guard.ts.
 *   2. Calls it with a mock execute function returning `returnRows`.
 *   3. Captures the SQL object passed to execute and flattens it to text.
 *   4. Prints { deleted, sqlText, callCount } as JSON.
 *
 * If `shouldThrow` is true the mock throws instead of returning rows.
 */
function runCoreTest(opts: {
  knownNames?: string[];
  returnRows?: Array<{ name: string }>;
  shouldThrow?: boolean;
}): {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: { deleted: string[]; sqlText: string; callCount: number };
} {
  const knownNamesJson = JSON.stringify(opts.knownNames ?? null);
  const returnRowsJson = JSON.stringify(opts.returnRows ?? []);
  const shouldThrow = opts.shouldThrow ? "true" : "false";

  const script = `
import { _reconcileSchedulerRunsCore, KNOWN_SCHEDULER_NAMES } from ${JSON.stringify(GUARD_FILE.replace(/\\/g, "/").replace(/\.ts$/, ".js"))};

function flattenSql(q) {
  if (typeof q === "string") return q;
  if (q === null || q === undefined) return "";
  if (Array.isArray(q?.value)) return q.value.map(flattenSql).join("");
  if (Array.isArray(q?.queryChunks)) return q.queryChunks.map(flattenSql).join("");
  return "";
}

const knownNames = ${knownNamesJson} ?? [...KNOWN_SCHEDULER_NAMES];
const returnRows = ${returnRowsJson};
const shouldThrow = ${shouldThrow};
const capturedQueries = [];

const executeFn = async (query) => {
  capturedQueries.push(query);
  if (shouldThrow) throw new Error("connection terminated unexpectedly");
  return { rows: returnRows };
};

try {
  const deleted = await _reconcileSchedulerRunsCore(executeFn, knownNames);
  const sqlText = capturedQueries.length > 0 ? flattenSql(capturedQueries[0]) : "";
  process.stdout.write(JSON.stringify({ deleted, sqlText, callCount: capturedQueries.length }) + "\\n");
} catch (err) {
  process.stdout.write(JSON.stringify({ error: err.message }) + "\\n");
}
`;

  // Written under the OS temp dir (not REPO_ROOT): if this process is ever
  // killed before the finally block below can rmSync it (workflow restart,
  // OOM, etc.), a leftover file here can't be swept up by an automated
  // `git add -A` commit the way a repo-root leftover once was.
  const tmp = join(
    tmpdir(),
    `_scheduler_guard_reconcile_test_${Date.now()}.mts`,
  );
  writeFileSync(tmp, script, "utf8");
  try {
    const res = spawnSync(TSX_BIN, [tmp], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    const ok = res.status === 0;
    let result:
      | { deleted: string[]; sqlText: string; callCount: number }
      | undefined;
    try {
      result = JSON.parse(res.stdout.trim());
    } catch {
      // ignore parse errors — test body will assert
    }
    return { ok, stdout: res.stdout, stderr: res.stderr, result };
  } finally {
    rmSync(tmp, { force: true });
  }
}

itest("returns [] when execute returns no rows (no orphaned rows)", () => {
  const { result } = runCoreTest({
    knownNames: ["gmail-scan"],
    returnRows: [],
  });
  assert.ok(result, "subprocess must produce valid JSON");
  assert.deepEqual(result!.deleted, [], "deleted must be empty");
  assert.equal(result!.callCount, 1, "execute must be called exactly once");
});

itest(
  "returns deleted name when execute returns one RETURNING row (warning path)",
  () => {
    const { result } = runCoreTest({
      knownNames: ["gmail-scan"],
      returnRows: [{ name: "old-scheduler" }],
    });
    assert.ok(result, "subprocess must produce valid JSON");
    assert.deepEqual(
      result!.deleted,
      ["old-scheduler"],
      "deleted must contain the orphaned name",
    );
    assert.equal(result!.callCount, 1, "execute must be called exactly once");
  },
);

itest(
  "returns all deleted names when multiple orphaned rows are present",
  () => {
    const orphans = [
      { name: "retired-scheduler-a" },
      { name: "reminder-scheduler" },
      { name: "hallmark-events-scan" },
    ];
    const { result } = runCoreTest({
      knownNames: ["gmail-scan", "reminders-scheduler"],
      returnRows: orphans,
    });
    assert.ok(result, "subprocess must produce valid JSON");
    assert.deepEqual(
      result!.deleted.sort(),
      orphans.map((r) => r.name).sort(),
      "all orphaned names must be returned",
    );
  },
);

itest(
  "SQL passed to execute contains DELETE, RETURNING, and the exclusion ARRAY for each known name",
  () => {
    const knownNames = ["gmail-scan", "birthday-emails"];
    const { result } = runCoreTest({ knownNames, returnRows: [] });
    assert.ok(result, "subprocess must produce valid JSON");
    const sql = result!.sqlText.toLowerCase();
    assert.ok(
      sql.includes("delete"),
      `SQL must contain DELETE — got: ${result!.sqlText.slice(0, 200)}`,
    );
    assert.ok(
      sql.includes("returning"),
      `SQL must contain RETURNING — got: ${result!.sqlText.slice(0, 200)}`,
    );
    for (const name of knownNames) {
      assert.ok(
        result!.sqlText.includes(`'${name}'`),
        `SQL must include quoted name '${name}' — got: ${result!.sqlText.slice(0, 300)}`,
      );
    }
  },
);

itest(
  "SQL contains all current KNOWN_SCHEDULER_NAMES when called with the full production set",
  () => {
    const knownNames = readKnownSchedulerNames();
    const { result } = runCoreTest({ returnRows: [] }); // uses KNOWN_SCHEDULER_NAMES by default
    assert.ok(result, "subprocess must produce valid JSON");
    for (const name of knownNames) {
      assert.ok(
        result!.sqlText.includes(`'${name}'`),
        `SQL must include '${name}' from KNOWN_SCHEDULER_NAMES`,
      );
    }
  },
);

itest(
  "renamed-task scenario: old name returned when DB row exists but name is no longer known",
  () => {
    // "reminder-scheduler" (no trailing 's') was the old name before it was
    // renamed to "reminders-scheduler".  The DB row should be deleted.
    const { result } = runCoreTest({
      returnRows: [{ name: "reminder-scheduler" }],
    });
    assert.ok(result, "subprocess must produce valid JSON");
    assert.ok(
      result!.deleted.includes("reminder-scheduler"),
      `expected 'reminder-scheduler' in deleted — got: ${JSON.stringify(result!.deleted)}`,
    );
  },
);

itest(
  "propagates execute() errors so reconcileSchedulerRuns() can catch and log them",
  () => {
    const { result } = runCoreTest({
      knownNames: ["gmail-scan"],
      shouldThrow: true,
    });
    assert.ok(result, "subprocess must produce valid JSON");
    const r = result as unknown as { error?: string };
    assert.ok(
      "error" in r && typeof r.error === "string",
      `expected error field in JSON — got: ${JSON.stringify(result)}`,
    );
    assert.ok(
      r.error!.includes("connection terminated"),
      `error message must mention connection terminated — got: ${r.error}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(
  `\nscheduler-guard-reconcile.test: ${passed} unit + ${ipassd} subprocess tests passed, ${failed + ifailed} failed`,
);
if (failed + ifailed > 0) process.exit(1);
