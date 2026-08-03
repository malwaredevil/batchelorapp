#!/usr/bin/env tsx
/**
 * check-github-drift.test.ts — unit tests for the GitHub drift detector.
 *
 * Tests the pure exported helpers; no network calls are made.
 * Run via: pnpm --filter @workspace/scripts run test
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { localBlobSha, findDriftedPaths } from "./check-github-drift.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the Git blob SHA the same way Git does, for test assertions. */
function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return crypto
    .createHash("sha1")
    .update(Buffer.concat([header, content]))
    .digest("hex");
}

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
// localBlobSha
// ---------------------------------------------------------------------------

console.log("\ncheck-github-drift.test: localBlobSha");

test("matches reference git blob sha for non-empty content", () => {
  const content = Buffer.from("name: Dependabot auto-merge\n");
  assert.equal(localBlobSha(content), gitBlobSha(content));
});

test("matches reference git blob sha for empty file", () => {
  const content = Buffer.from("");
  assert.equal(localBlobSha(content), gitBlobSha(content));
});

test("different content produces different sha", () => {
  const a = Buffer.from("version: v4\n");
  const b = Buffer.from("version: v7\n");
  assert.notEqual(localBlobSha(a), localBlobSha(b));
});

// ---------------------------------------------------------------------------
// findDriftedPaths
// ---------------------------------------------------------------------------

console.log("\ncheck-github-drift.test: findDriftedPaths");

const workflowContent = Buffer.from(
  "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
);
const workflowSha = gitBlobSha(workflowContent);

const bumpedContent = Buffer.from(
  "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-22.04\n",
);
const bumpedSha = gitBlobSha(bumpedContent);

test("no drift when local matches GitHub SHA", () => {
  const ghShaMap = new Map([
    [".github/workflows/ci.yml", workflowSha],
  ]);
  // readLocal returns the same content → same SHA
  const drifted = findDriftedPaths(
    ghShaMap,
    () => workflowContent,
    [".github/workflows/ci.yml"],
  );
  assert.deepEqual(drifted, []);
});

test("detects GitHub-ahead change (Dependabot bumped the file on GitHub)", () => {
  // GitHub has bumpedContent; local still has workflowContent (stale)
  const ghShaMap = new Map([
    [".github/workflows/ci.yml", bumpedSha],
  ]);
  const drifted = findDriftedPaths(
    ghShaMap,
    () => workflowContent, // local is stale
    [".github/workflows/ci.yml"],
  );
  assert.deepEqual(drifted, [".github/workflows/ci.yml"]);
});

test("detects intentional local edit that diverges from GitHub (local is ahead)", () => {
  // Local has bumpedContent; GitHub still has workflowContent.
  // The guard flags any divergence regardless of direction — the caller
  // decides whether to push (--skip-drift-check) or pull.
  const ghShaMap = new Map([
    [".github/workflows/ci.yml", workflowSha],
  ]);
  const drifted = findDriftedPaths(
    ghShaMap,
    () => bumpedContent, // local is ahead
    [".github/workflows/ci.yml"],
  );
  assert.deepEqual(drifted, [".github/workflows/ci.yml"]);
});

test("detects file missing locally but present on GitHub", () => {
  const ghShaMap = new Map([
    [".github/workflows/new-action.yml", workflowSha],
  ]);
  // readLocal returns null → file absent locally
  const drifted = findDriftedPaths(
    ghShaMap,
    () => null,
    [".github/workflows/new-action.yml"],
  );
  assert.deepEqual(drifted, [".github/workflows/new-action.yml"]);
});

test("reports multiple drifted files", () => {
  const ciSha = gitBlobSha(Buffer.from("ci-v1"));
  const staleSha = gitBlobSha(Buffer.from("stale-v10"));
  const ghShaMap = new Map([
    [".github/workflows/ci.yml", gitBlobSha(Buffer.from("ci-v2"))],
    [".github/workflows/stale.yml", gitBlobSha(Buffer.from("stale-v11"))],
    [".github/workflows/deploy.yml", gitBlobSha(Buffer.from("deploy-v1"))],
  ]);
  const localContents = new Map([
    [".github/workflows/ci.yml", Buffer.from("ci-v1")],       // stale
    [".github/workflows/stale.yml", Buffer.from("stale-v10")], // stale
    [".github/workflows/deploy.yml", Buffer.from("deploy-v1")], // matches
  ]);
  void ciSha; void staleSha; // referenced above for clarity
  const drifted = findDriftedPaths(
    ghShaMap,
    (p) => localContents.get(p) ?? null,
    [...ghShaMap.keys()],
  );
  assert.deepEqual(drifted.sort(), [
    ".github/workflows/ci.yml",
    ".github/workflows/stale.yml",
  ]);
});

test("only checks candidatePaths — ignores other entries in ghShaMap", () => {
  const ghShaMap = new Map([
    [".github/workflows/ci.yml", bumpedSha],   // drifted
    [".github/workflows/stale.yml", workflowSha], // would be clean
  ]);
  // Only pass one path as candidate
  const drifted = findDriftedPaths(
    ghShaMap,
    () => workflowContent,
    [".github/workflows/stale.yml"],
  );
  // ci.yml was not in candidatePaths so it must not appear
  assert.deepEqual(drifted, []);
});

test("returns empty array when candidatePaths is empty", () => {
  const ghShaMap = new Map([[".github/workflows/ci.yml", workflowSha]]);
  const drifted = findDriftedPaths(ghShaMap, () => workflowContent, []);
  assert.deepEqual(drifted, []);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
