/**
 * Tests for the check-scheduler-names CI guardrail.
 *
 * Exercises classifyArgument() — the core classification function — using
 * in-memory fixtures so no filesystem access is needed. Resolution uses the
 * TypeScript compiler API so block comments, string bodies, and template
 * literals are handled correctly.
 *
 * Also includes integration tests that run the actual script end-to-end
 * against the real repo (smoke) and against synthetic fixture files that
 * contain each violation kind, asserting exit-code non-zero and appropriate
 * stderr output.
 */
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  classifyArgument,
  resolveConstant,
  isImportedVariable,
  collectCallSiteNamesAST,
} from "./check-scheduler-names.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KNOWN = new Set(["gmail-scan", "birthday-emails", "reminders-scheduler"]);

function classify(
  rest: string,
  fileContent = "",
): ReturnType<typeof classifyArgument> {
  return classifyArgument(rest, fileContent, KNOWN);
}

// ---------------------------------------------------------------------------
// resolveConstant — accepts module-level standalone string-literal consts only
// ---------------------------------------------------------------------------

assert.equal(
  resolveConstant("TASK_NAME", 'const TASK_NAME = "gmail-scan";'),
  "gmail-scan",
  "resolveConstant: basic double-quoted module-level const",
);
assert.equal(
  resolveConstant("TASK_NAME", "const TASK_NAME = 'birthday-emails';"),
  "birthday-emails",
  "resolveConstant: single-quoted module-level const",
);
assert.equal(
  resolveConstant("MISSING", 'const TASK_NAME = "gmail-scan";'),
  null,
  "resolveConstant: unknown variable → null",
);

// Compound initializers must not resolve
assert.equal(
  resolveConstant("TASK_NAME", 'const TASK_NAME = "gmail-scan" + suffix;'),
  null,
  'resolveConstant: "value" + suffix → null (compound initializer)',
);
assert.equal(
  resolveConstant("TASK_NAME", 'const TASK_NAME = "gmail-scan"\n  + suffix;'),
  null,
  "resolveConstant: multiline concatenation → null",
);
assert.equal(
  resolveConstant("TASK_NAME", "const TASK_NAME = `gmail-scan`;"),
  null,
  "resolveConstant: template literal → null",
);
assert.equal(
  resolveConstant("TASK_NAME", 'const TASK_NAME = "gmail-scan" as const;'),
  null,
  "resolveConstant: `as const` suffix → null",
);

// `let` and `var` are not accepted
assert.equal(
  resolveConstant("TASK_NAME", 'let TASK_NAME = "gmail-scan";'),
  null,
  "resolveConstant: let declaration → null",
);
assert.equal(
  resolveConstant("TASK_NAME", 'var TASK_NAME = "gmail-scan";'),
  null,
  "resolveConstant: var declaration → null",
);

// Shadowing: inner-scope variable declaration → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\nfunction run() { const TASK_NAME = "new-task"; }',
  ),
  null,
  "resolveConstant: inner const shadows module-level → null",
);

// Shadowing: function PARAMETER with the same name → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\nfunction run(TASK_NAME: string) { }',
  ),
  null,
  "resolveConstant: function parameter shadows module-level const → null",
);

// Shadowing: arrow-function parameter → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\nconst fn = (TASK_NAME: string) => {};',
  ),
  null,
  "resolveConstant: arrow-function parameter shadows module-level const → null",
);

// Shadowing: catch-clause variable → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\ntry {} catch (TASK_NAME) {}',
  ),
  null,
  "resolveConstant: catch variable shadows module-level const → null",
);

// Shadowing: for-of loop variable → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\nfor (const TASK_NAME of []) {}',
  ),
  null,
  "resolveConstant: for-of loop variable shadows module-level const → null",
);

// Shadowing: destructuring binding inside a function → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const TASK_NAME = "gmail-scan";\nfunction run({ TASK_NAME }: any) {}',
  ),
  null,
  "resolveConstant: destructured parameter shadows module-level const → null",
);

// Local-only declaration inside a function → not module-level → null
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'function run() { const TASK_NAME = "gmail-scan"; }',
  ),
  null,
  "resolveConstant: local-only declaration → null (not module-level)",
);

// Block-commented const must NOT resolve
assert.equal(
  resolveConstant(
    "TASK_NAME",
    '/* const TASK_NAME = "gmail-scan"; */\nconst x = 1;',
  ),
  null,
  "resolveConstant: block-commented const → null",
);

// Line-commented const must NOT resolve
assert.equal(
  resolveConstant(
    "TASK_NAME",
    '// const TASK_NAME = "gmail-scan";\nconst x = 1;',
  ),
  null,
  "resolveConstant: line-commented const → null",
);

// Text inside another string literal must NOT resolve
assert.equal(
  resolveConstant(
    "TASK_NAME",
    'const OTHER = "const TASK_NAME = \\"gmail-scan\\";";',
  ),
  null,
  "resolveConstant: value embedded inside another string literal → null",
);

// ---------------------------------------------------------------------------
// isImportedVariable
// ---------------------------------------------------------------------------

assert.equal(
  isImportedVariable("TASK_NAME", 'import { TASK_NAME } from "./constants";'),
  true,
  "isImportedVariable: named import",
);
assert.equal(
  isImportedVariable(
    "TASK_NAME",
    'import { OTHER, TASK_NAME, MORE } from "./constants";',
  ),
  true,
  "isImportedVariable: named import among others",
);
assert.equal(
  isImportedVariable(
    "TASK_NAME",
    'import { FOO as TASK_NAME } from "./constants";',
  ),
  true,
  "isImportedVariable: aliased named import",
);
assert.equal(
  isImportedVariable("TASK_NAME", 'import TASK_NAME from "./constants";'),
  true,
  "isImportedVariable: default import",
);
assert.equal(
  isImportedVariable("TASK_NAME", 'import * as TASK_NAME from "./constants";'),
  true,
  "isImportedVariable: namespace import",
);
assert.equal(
  isImportedVariable("TASK_NAME", 'const TASK_NAME = "gmail-scan";'),
  false,
  "isImportedVariable: local const is NOT an import",
);

// Block-commented import must NOT be detected
assert.equal(
  isImportedVariable(
    "TASK_NAME",
    '/* import { TASK_NAME } from "./c"; */\nconst TASK_NAME = "gmail-scan";',
  ),
  false,
  "isImportedVariable: block-commented import → false",
);

// ---------------------------------------------------------------------------
// classifyArgument — Pattern A: inline string literals
// ---------------------------------------------------------------------------

assert.deepEqual(
  classify('"gmail-scan", interval)'),
  { outcome: "registered" },
  "Pattern A double-quote: registered name",
);
assert.deepEqual(
  classify("'birthday-emails', interval)"),
  { outcome: "registered" },
  "Pattern A single-quote: registered name",
);
assert.deepEqual(
  classify('"unknown-task", interval)'),
  { outcome: "unregistered", name: "unknown-task" },
  "Pattern A: unregistered name",
);

// Compound expression after string literal — must be unsupported
assert.equal(
  classify('"gmail-scan" + suffix, interval)').outcome,
  "unsupported",
  "Pattern A: string + suffix is compound → unsupported",
);

// ---------------------------------------------------------------------------
// classifyArgument — Pattern B: module-level const identifier
// ---------------------------------------------------------------------------

const fileWithModuleLevelConst =
  'const TASK_NAME = "gmail-scan";\nconst x = 1;';

assert.deepEqual(
  classify("TASK_NAME, interval)", fileWithModuleLevelConst),
  { outcome: "registered" },
  "Pattern B: module-level const resolves to registered name",
);

const fileWithUnregisteredConst = 'const TASK_NAME = "new-unregistered-task";';
assert.deepEqual(
  classify("TASK_NAME, interval)", fileWithUnregisteredConst),
  { outcome: "unregistered", name: "new-unregistered-task" },
  "Pattern B: module-level const resolves to unregistered name",
);

// Local-only const (inside a function) → not module-level → unresolvable
// Also verifies that the reason hint mentions the inline-string-literal remedy.
{
  const localOnlyResult = classify(
    "TASK_NAME, interval)",
    'function run() { const TASK_NAME = "gmail-scan"; }',
  );
  assert.equal(
    localOnlyResult.outcome,
    "unresolvable",
    "Pattern B: local-only const → unresolvable (not module-level)",
  );
  assert.ok(
    localOnlyResult.outcome === "unresolvable" &&
      localOnlyResult.reason.includes("inline string literal"),
    "Pattern B: local-only const unresolvable reason hints at inline string literal remedy",
  );
}

// Shadowed name → unresolvable; reason must also hint at the remedy.
{
  const shadowedResult = classify(
    "TASK_NAME, interval)",
    'const TASK_NAME = "gmail-scan";\nfunction run() { const TASK_NAME = "other"; }',
  );
  assert.equal(
    shadowedResult.outcome,
    "unresolvable",
    "Pattern B: shadowed name → unresolvable",
  );
  assert.ok(
    shadowedResult.outcome === "unresolvable" &&
      shadowedResult.reason.includes("module-level"),
    "Pattern B: shadowed name unresolvable reason mentions module-level constraint",
  );
}

// Imported variable → unresolvable
const fileWithImport = 'import { TASK_NAME } from "./constants";\nconst x = 1;';
assert.equal(
  classify("TASK_NAME, interval)", fileWithImport).outcome,
  "unresolvable",
  "Pattern B: imported variable → unresolvable",
);
const importedViolation = classify("TASK_NAME, interval)", fileWithImport);
assert.ok(
  importedViolation.outcome === "unresolvable" &&
    importedViolation.reason.includes("imported from another file"),
  "Pattern B: imported variable reason mentions cross-file import",
);

// Compound expression after identifier → unsupported
assert.equal(
  classify("TASK_NAME + suffix, interval)", fileWithModuleLevelConst).outcome,
  "unsupported",
  "Pattern B: identifier + suffix → unsupported",
);

// Block-commented module-level const → unresolvable (comment not parsed as code)
assert.equal(
  classify(
    "TASK_NAME, interval)",
    '/* const TASK_NAME = "gmail-scan"; */\nconst x = 1;',
  ).outcome,
  "unresolvable",
  "Pattern B: block-commented const → unresolvable",
);

// ---------------------------------------------------------------------------
// OBJ.PROP — always unsupported (properties of const objects are mutable)
// ---------------------------------------------------------------------------

const fileWithObj = `const NAMES = { GMAIL: "gmail-scan", BIRTHDAY: "birthday-emails" };`;

assert.equal(
  classify("NAMES.GMAIL, interval)", fileWithObj).outcome,
  "unsupported",
  "OBJ.PROP: always unsupported (const object properties are mutable)",
);
assert.equal(
  classify("NAMES.BIRTHDAY, interval)", fileWithObj).outcome,
  "unsupported",
  "OBJ.PROP: always unsupported (even when property value is registered)",
);

// Mutation bypass must be caught (the key soundness test):
// `const NAMES = { GMAIL: "gmail-scan" }; NAMES.GMAIL = "unregistered";`
// The property-mutation bypass is caught because OBJ.PROP is always unsupported.
const fileWithMutatedObj = `const NAMES = { GMAIL: "gmail-scan" };\nNAMES.GMAIL = "unregistered-task";\n`;
assert.equal(
  classify("NAMES.GMAIL, interval)", fileWithMutatedObj).outcome,
  "unsupported",
  "OBJ.PROP mutation bypass: NAMES.GMAIL after reassignment → unsupported (not registered)",
);

// Chained property access → unsupported
assert.equal(
  classify("NAMES.GMAIL.EXTRA, interval)", fileWithObj).outcome,
  "unsupported",
  "Chained property access → unsupported",
);

// ---------------------------------------------------------------------------
// Unsupported forms — also verify the token hint text
// ---------------------------------------------------------------------------

{
  const templateResult = classify("`template-${suffix}`, interval)");
  assert.equal(
    templateResult.outcome,
    "unsupported",
    "template literal → unsupported",
  );
  assert.ok(
    templateResult.outcome === "unsupported" &&
      templateResult.token.startsWith("`"),
    "template literal: token hint starts with backtick",
  );
}

{
  const parenResult = classify("(getTaskName()), interval)");
  assert.equal(
    parenResult.outcome,
    "unsupported",
    "expression in parens → unsupported",
  );
  assert.ok(
    parenResult.outcome === "unsupported" && parenResult.token.startsWith("("),
    "expression in parens: token hint starts with '('",
  );
}

{
  const objPropResult = classify("NAMES.GMAIL, interval)", fileWithObj);
  assert.equal(
    objPropResult.outcome,
    "unsupported",
    "OBJ.PROP: always unsupported — outcome check",
  );
  assert.ok(
    objPropResult.outcome === "unsupported" &&
      objPropResult.token.includes("NAMES"),
    "OBJ.PROP: token hint includes the object name",
  );
}

// ---------------------------------------------------------------------------
// collectCallSiteNamesAST — reverse check (AST-based, immune to comments/strings)
// ---------------------------------------------------------------------------

const KNOWN_REVERSE = new Set([
  "gmail-scan",
  "birthday-emails",
  "reminders-scheduler",
]);

// Real call expression with string literal → name added.
assert.deepEqual(
  collectCallSiteNamesAST(
    'shouldRunScheduledTask("gmail-scan", INTERVAL_MS);',
    KNOWN_REVERSE,
  ),
  new Set(["gmail-scan"]),
  "collectCallSiteNamesAST: real call with string literal → name added",
);

// recordScheduledTaskSuccess variant → name added.
assert.deepEqual(
  collectCallSiteNamesAST(
    'recordScheduledTaskSuccess("birthday-emails");',
    KNOWN_REVERSE,
  ),
  new Set(["birthday-emails"]),
  "collectCallSiteNamesAST: recordScheduledTaskSuccess call → name added",
);

// Multiple calls in one file → all names added.
assert.deepEqual(
  collectCallSiteNamesAST(
    'shouldRunScheduledTask("gmail-scan", A);\nrecordScheduledTaskSuccess("birthday-emails");',
    KNOWN_REVERSE,
  ),
  new Set(["gmail-scan", "birthday-emails"]),
  "collectCallSiteNamesAST: multiple calls → all names added",
);

// Pattern B: module-level const identifier → name added.
assert.deepEqual(
  collectCallSiteNamesAST(
    'const TASK = "gmail-scan";\nshouldRunScheduledTask(TASK, INTERVAL_MS);',
    KNOWN_REVERSE,
  ),
  new Set(["gmail-scan"]),
  "collectCallSiteNamesAST: module-level const identifier → name added",
);

// Line comment containing a call-shaped string must NOT satisfy the reverse check.
assert.deepEqual(
  collectCallSiteNamesAST(
    '// shouldRunScheduledTask("gmail-scan", INTERVAL_MS);\nconst x = 1;',
    KNOWN_REVERSE,
  ),
  new Set(),
  "collectCallSiteNamesAST: call in line comment → NOT added (comment is not executable)",
);

// Block comment containing a call-shaped string must NOT satisfy the reverse check.
assert.deepEqual(
  collectCallSiteNamesAST(
    '/* shouldRunScheduledTask("gmail-scan", INTERVAL_MS); */\nconst x = 1;',
    KNOWN_REVERSE,
  ),
  new Set(),
  "collectCallSiteNamesAST: call in block comment → NOT added",
);

// Call-shaped text inside a string literal must NOT satisfy the reverse check.
assert.deepEqual(
  collectCallSiteNamesAST(
    "const msg = 'shouldRunScheduledTask(\"gmail-scan\", INTERVAL_MS)';",
    KNOWN_REVERSE,
  ),
  new Set(),
  "collectCallSiteNamesAST: call-shaped string literal → NOT added",
);

// A name that is NOT in knownNames must NOT be added (only known entries are tracked).
assert.deepEqual(
  collectCallSiteNamesAST(
    'shouldRunScheduledTask("retired-task", INTERVAL_MS);',
    KNOWN_REVERSE,
  ),
  new Set(),
  "collectCallSiteNamesAST: unregistered name → NOT added to found set",
);

// Empty file → empty set (no crash).
assert.deepEqual(
  collectCallSiteNamesAST("", KNOWN_REVERSE),
  new Set(),
  "collectCallSiteNamesAST: empty file → empty set",
);

// Stale-name detection: a name in knownNames with no call sites is not in foundNames.
// This simulates the exact scenario that trips the shared heartbeat:
// "retired-scheduler" remains in KNOWN_SCHEDULER_NAMES but has zero call sites.
{
  const staleKnown = new Set(["gmail-scan", "retired-scheduler"]);
  const foundInFile = collectCallSiteNamesAST(
    'shouldRunScheduledTask("gmail-scan", INTERVAL_MS);',
    staleKnown,
  );
  assert.ok(
    foundInFile.has("gmail-scan"),
    "stale-name scenario: active name is present in found set",
  );
  assert.ok(
    !foundInFile.has("retired-scheduler"),
    "stale-name scenario: retired name with no call site is absent from found set",
  );
  const staleNames = [...staleKnown].filter((n) => !foundInFile.has(n));
  assert.deepEqual(
    staleNames,
    ["retired-scheduler"],
    "stale-name scenario: diff of knownNames minus foundNames yields the retired name",
  );
}

// ---------------------------------------------------------------------------
// Done (unit tests)
// ---------------------------------------------------------------------------

console.log("✓ check-scheduler-names: all unit tests passed");

// ---------------------------------------------------------------------------
// Integration tests — run the real script end-to-end via spawnSync
// ---------------------------------------------------------------------------

console.log("\ncheck-scheduler-names.test: integration tests");

// Minimal test harness (same pattern as check-backup-coverage.test.ts).
let _passed = 0;
let _failed = 0;

function itest(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    _passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    _failed++;
  }
}

// Resolve the tsx binary bundled with this package so spawnSync can find it
// regardless of the caller's PATH.
const TSX_BIN = join(import.meta.dirname, "..", "node_modules", ".bin", "tsx");
const REPO_ROOT = join(import.meta.dirname, "..", "..");

// Sentinel file written into the real API_SRC so the script's walk() picks it
// up. It must NOT match /\.test\.[^/]+$/ (test-file exclusion) and must NOT
// be the GUARD_FILE. We use a name unlikely to conflict with real source.
const API_SRC = join(REPO_ROOT, "artifacts", "api-server", "src");
const SENTINEL = join(API_SRC, "_ci_sentinel_scheduler_names_.ts");

// Guard: if a previous test run crashed before its finally block could clean up
// the sentinel file it leaves _ci_sentinel_scheduler_names_.ts on disk.  That
// leftover makes the "exits 0 on the actual repo" smoke test fail with a
// spurious forward violation.  Remove it before running the smoke test.
rmSync(SENTINEL, { force: true });

itest(
  "script exits 0 on the actual repo (all scheduler names accounted for)",
  () => {
    const result = spawnSync(
      TSX_BIN,
      ["scripts/src/check-scheduler-names.ts"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) {
      throw new Error(
        `Script exited ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  },
);

itest(
  "script exits non-zero for an unregistered task name and reports it",
  () => {
    writeFileSync(
      SENTINEL,
      `import { shouldRunScheduledTask } from "./lib/scheduler-guard.js";
async function run() {
  if (await shouldRunScheduledTask("totally-unknown-sentinel-xyz-99999", 60_000)) {
    console.log("running");
  }
}
`,
    );
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when a task name is not in KNOWN_SCHEDULER_NAMES",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes("totally-unknown-sentinel-xyz-99999"),
        `Output should name the unregistered task; got:\n${output}`,
      );
    } finally {
      rmSync(SENTINEL, { force: true });
    }
  },
);

itest(
  "script exits non-zero for an unresolvable (imported) variable and reports it",
  () => {
    writeFileSync(
      SENTINEL,
      `import { SENTINEL_TASK_NAME } from "./lib/scheduler-guard.js";
import { shouldRunScheduledTask } from "./lib/scheduler-guard.js";
async function run() {
  if (await shouldRunScheduledTask(SENTINEL_TASK_NAME, 60_000)) {
    console.log("running");
  }
}
`,
    );
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when the task-name variable is imported from another file",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes("SENTINEL_TASK_NAME"),
        `Output should name the unresolvable reference; got:\n${output}`,
      );
      assert.ok(
        output.toLowerCase().includes("unresolvable") ||
          output.includes("imported from another file"),
        `Output should explain the unresolvable/import issue; got:\n${output}`,
      );
    } finally {
      rmSync(SENTINEL, { force: true });
    }
  },
);

itest(
  "script exits non-zero for an unsupported template-literal argument and reports it",
  () => {
    writeFileSync(
      SENTINEL,
      `import { shouldRunScheduledTask } from "./lib/scheduler-guard.js";
const suffix = "x";
async function run() {
  if (await shouldRunScheduledTask(\`sentinel-task-\${suffix}\`, 60_000)) {
    console.log("running");
  }
}
`,
    );
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when the task-name argument is a template literal",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes("unsupported") || output.includes("violation"),
        `Output should flag the unsupported template literal; got:\n${output}`,
      );
    } finally {
      rmSync(SENTINEL, { force: true });
    }
  },
);

itest(
  "script exits non-zero when a registered name is silently renamed (suffix added) and reports it",
  () => {
    // Simulates a developer renaming "gmail-scan" → "gmail-scan-v2" at the
    // call site without updating KNOWN_SCHEDULER_NAMES.  The suffix makes the
    // name look plausible but it is not in the known set, so the guardrail
    // must catch it.
    writeFileSync(
      SENTINEL,
      `import { shouldRunScheduledTask } from "./lib/scheduler-guard.js";
async function run() {
  if (await shouldRunScheduledTask("gmail-scan-v2", 60_000)) {
    console.log("running");
  }
}
`,
    );
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when a task name is a renamed variant not in KNOWN_SCHEDULER_NAMES",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes("gmail-scan-v2"),
        `Output should name the renamed (unregistered) task; got:\n${output}`,
      );
    } finally {
      rmSync(SENTINEL, { force: true });
    }
  },
);

itest(
  "script exits non-zero when a name removed from KNOWN_SCHEDULER_NAMES still appears at a call site",
  () => {
    // Simulates a developer removing "hallmark-events-scan" from
    // KNOWN_SCHEDULER_NAMES during a cleanup pass but forgetting to remove
    // (or rename) the corresponding shouldRunScheduledTask call site.  The
    // name looks plausible — it could have been a real scheduler once — so
    // the guardrail must still catch it as unregistered.
    writeFileSync(
      SENTINEL,
      `import { shouldRunScheduledTask } from "./lib/scheduler-guard.js";
async function run() {
  if (await shouldRunScheduledTask("hallmark-events-scan", 60 * 60_000)) {
    console.log("running");
  }
}
`,
    );
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when a previously-registered name has been removed from KNOWN_SCHEDULER_NAMES",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes("hallmark-events-scan"),
        `Output should name the removed (now-unregistered) task; got:\n${output}`,
      );
    } finally {
      rmSync(SENTINEL, { force: true });
    }
  },
);

// ── Reverse check: retired name in KNOWN_SCHEDULER_NAMES with no call sites ─

const GUARD_FILE = join(
  REPO_ROOT,
  "artifacts",
  "api-server",
  "src",
  "lib",
  "scheduler-guard.ts",
);

import { readFileSync as _readFileSync } from "node:fs";

itest(
  "script exits non-zero when KNOWN_SCHEDULER_NAMES contains a name with no call sites (retired scheduler)",
  () => {
    // Inject a sentinel name into KNOWN_SCHEDULER_NAMES that has no call
    // sites anywhere in api-server/src.  The reverse check must detect this
    // and exit 1 with a clear "retire this name" message naming the sentinel.
    const original = _readFileSync(GUARD_FILE, "utf8");
    const RETIRED_SENTINEL = "retired-sentinel-ci-check-xyz-99999";
    // Insert the sentinel as the first entry so the regex that parses the Set
    // contents picks it up reliably.
    const patched = original.replace(
      /KNOWN_SCHEDULER_NAMES\s*=\s*new\s+Set\s*\(\s*\[/,
      `KNOWN_SCHEDULER_NAMES = new Set([\n  "${RETIRED_SENTINEL}",`,
    );
    assert.notEqual(
      patched,
      original,
      "Patch must modify the guard file (regex must match)",
    );
    writeFileSync(GUARD_FILE, patched, "utf8");
    try {
      const result = spawnSync(
        TSX_BIN,
        ["scripts/src/check-scheduler-names.ts"],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
      );
      assert.notEqual(
        result.status,
        0,
        "Script should exit non-zero when a name in KNOWN_SCHEDULER_NAMES has no call sites",
      );
      const output = result.stderr + result.stdout;
      assert.ok(
        output.includes(RETIRED_SENTINEL),
        `Output should name the retired sentinel; got:\n${output}`,
      );
      assert.ok(
        output.toLowerCase().includes("retire") ||
          output.toLowerCase().includes("stale") ||
          output.toLowerCase().includes("no call"),
        `Output should explain the retire-this-name action; got:\n${output}`,
      );
    } finally {
      writeFileSync(GUARD_FILE, original, "utf8");
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────

console.log(
  `\ncheck-scheduler-names.test: ${_passed} integration tests passed, ${_failed} failed`,
);
if (_failed > 0) process.exit(1);
