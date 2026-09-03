import assert from "node:assert/strict";
import {
  classifyArchitectureFindings,
  snapshotFromViolations,
  type ArchitectureBaseline,
  type ArchitectureFinding,
  type ArchitectureSnapshot,
} from "./check-architecture-policy.js";

function finding(
  id: string,
  metric = 1,
  file = "artifacts/modules/src/example.ts",
): ArchitectureFinding {
  return {
    id,
    category: "duplicate-code",
    file,
    symbol: "example",
    evidence: "artifacts/modules/src/reference.ts:reference",
    metric,
  };
}

function snapshot(
  findings: ArchitectureFinding[] = [],
  exceptions: ArchitectureSnapshot["exceptions"] = [],
): ArchitectureSnapshot {
  return { findings, exceptions };
}

function baseline(
  findings: ArchitectureFinding[] = [],
  exceptions: ArchitectureBaseline["exceptions"] = [],
): ArchitectureBaseline {
  return { version: 1, findings, exceptions };
}

function report(
  base: ArchitectureFinding[],
  current: ArchitectureFinding[],
  reviewed: ArchitectureFinding[],
  changedFiles: string[] = [],
  baseReviewed: ArchitectureFinding[] = reviewed,
) {
  return classifyArchitectureFindings(
    snapshot(base),
    snapshot(current),
    baseline(reviewed),
    changedFiles,
    {
      baselineExistsAtBase: true,
      baselineAtBase: baseline(baseReviewed),
    },
  );
}

// Clean code: there is no debt and the validation command has no reason to
// exit non-zero.
{
  const result = report([], [], []);
  assert.deepEqual(result.blockingReasons, []);
  assert.equal(result.unchangedLegacyFindings.length, 0);
}

// A new violation is a hard failure, even without a baseline entry.
{
  const newFinding = finding("duplicate-code:new");
  const result = report([], [newFinding], []);
  assert.equal(result.newFindings.length, 1);
  assert.match(result.blockingReasons.join("\n"), /new architectural/);
}

// Existing debt may not become more severe.
{
  const oldFinding = finding("duplicate-code:worse", 0.85);
  const worsened = finding("duplicate-code:worse", 1);
  const result = report([oldFinding], [worsened], [oldFinding]);
  assert.equal(result.worsenedFindings.length, 1);
  assert.match(result.blockingReasons.join("\n"), /worsened/);
}

// Unchanged reviewed debt remains visible but does not block unrelated work.
{
  const legacy = finding("duplicate-code:legacy");
  const result = report([legacy], [legacy], [legacy]);
  assert.equal(result.unchangedLegacyFindings.length, 1);
  assert.deepEqual(result.blockingReasons, []);
}

// A cleanup removes debt from the current snapshot and reports that progress.
{
  const legacy = finding("duplicate-code:cleanup");
  const result = report([legacy], [], [legacy]);
  assert.deepEqual(result.removedFindings, [legacy]);
}

// When a changed file still contains a reviewed finding, the report calls it
// out as related debt for the task-completion explanation.
{
  const legacy = finding("duplicate-code:touched");
  const result = report([legacy], [legacy], [legacy], [legacy.file]);
  assert.deepEqual(result.relatedLegacyFindings, [legacy]);
}

// A current historical finding without a reviewed baseline cannot silently
// become accepted debt.
{
  const historical = finding("duplicate-code:historical");
  const result = report([historical], [historical], []);
  assert.equal(result.undocumentedHistoricalFindings.length, 1);
  assert.match(
    result.blockingReasons.join("\n"),
    /missing from the reviewed baseline/,
  );
}

// Regression command behavior: adding a baseline entry in the same source
// change does not hide a new violation. main() turns blockingReasons into a
// non-zero exit code.
{
  const introduced = finding("duplicate-code:introduced");
  const result = report([], [introduced], [introduced], [introduced.file], []);
  assert.ok(result.baselineAdded.includes(introduced.id));
  assert.match(result.blockingReasons.join("\n"), /hide a finding/);
}

// An existing hardcoded-config allowlist cannot hide a new member of its
// clustered finding: the full names list changes the stable exception identity
// and fails until separately reviewed.
{
  const base = snapshotFromViolations(
    [],
    [
      {
        file: "artifacts/api-server/src/example.ts",
        lines: [10, 11],
        names: ["maxRetries", "maxTimeoutMs"],
        kind: "cluster",
        context: "const firstBudget = {",
        allowlisted: true,
      },
    ],
  );
  const current = snapshotFromViolations(
    [],
    [
      {
        file: "artifacts/api-server/src/example.ts",
        lines: [10, 11, 12],
        names: ["maxRetries", "maxTimeoutMs", "maxQueuedJobs"],
        kind: "cluster",
        context: "const firstBudget = {",
        allowlisted: true,
      },
    ],
  );
  const result = classifyArchitectureFindings(
    base,
    current,
    { version: 1, findings: [], exceptions: base.exceptions },
    ["artifacts/api-server/src/example.ts"],
    {
      baselineExistsAtBase: true,
      baselineAtBase: { version: 1, findings: [], exceptions: base.exceptions },
    },
  );
  assert.equal(result.undocumentedExceptions.length, 1);
  assert.match(result.blockingReasons.join("\n"), /exception.*missing/);
}

// A second identical same-named cluster is a worsened exception even when it
// shares every stable signature field with the first.
{
  const first = snapshotFromViolations(
    [],
    [
      {
        file: "artifacts/api-server/src/example.ts",
        lines: [10, 11],
        names: ["maxRetries", "maxTimeoutMs"],
        kind: "cluster",
        context: "const budget = {",
        allowlisted: true,
      },
    ],
  );
  const second = snapshotFromViolations(
    [],
    [
      {
        file: "artifacts/api-server/src/example.ts",
        lines: [10, 11],
        names: ["maxRetries", "maxTimeoutMs"],
        kind: "cluster",
        context: "const budget = {",
        allowlisted: true,
      },
      {
        file: "artifacts/api-server/src/example.ts",
        lines: [30, 31],
        names: ["maxRetries", "maxTimeoutMs"],
        kind: "cluster",
        context: "const budget = {",
        allowlisted: true,
      },
    ],
  );
  const result = classifyArchitectureFindings(
    first,
    second,
    { version: 1, findings: [], exceptions: first.exceptions },
    ["artifacts/api-server/src/example.ts"],
    {
      baselineExistsAtBase: true,
      baselineAtBase: {
        version: 1,
        findings: [],
        exceptions: first.exceptions,
      },
    },
  );
  assert.equal(result.worsenedExceptions.length, 1);
  assert.match(result.blockingReasons.join("\n"), /became more numerous/);
}

// A reviewed exception for genuinely new implementation can be recorded in
// the same change because there is no base finding that could be hidden.
{
  const exception = {
    id: "exception:duplicate-code:new",
    category: "duplicate-code" as const,
    file: "artifacts/modules/src/example.ts",
    evidence: "artifacts/modules/src/reference.ts:reference",
    reason: "The implementations have deliberately different public contracts.",
    metric: 1,
  };
  const result = classifyArchitectureFindings(
    snapshot([], []),
    snapshot([], [exception]),
    baseline([], [exception]),
    [exception.file],
    {
      baselineExistsAtBase: true,
      baselineAtBase: baseline([], []),
    },
  );
  assert.ok(result.exceptionAdded.includes(exception.id));
  assert.doesNotMatch(
    result.blockingReasons.join("\n"),
    /exception list expanded/,
  );
}

// A finding already observable at the base cannot be converted into an
// exception alongside implementation code.
{
  const finding = {
    id: "duplicate-code:artifacts/modules/src/example.ts:example:artifacts/modules/src/reference.ts:reference",
    category: "duplicate-code" as const,
    file: "artifacts/modules/src/example.ts",
    symbol: "example",
    evidence: "artifacts/modules/src/reference.ts:reference",
    metric: 1,
  };
  const exception = {
    id: `exception:${finding.id}`,
    category: finding.category,
    file: finding.file,
    evidence: finding.evidence,
    reason: "The implementations have deliberately different public contracts.",
    metric: finding.metric,
  };
  const result = classifyArchitectureFindings(
    snapshot([finding], []),
    snapshot([], [exception]),
    baseline([], [exception]),
    [exception.file],
    {
      baselineExistsAtBase: true,
      baselineAtBase: baseline([], []),
    },
  );
  assert.ok(result.exceptionAdded.includes(exception.id));
  assert.match(result.blockingReasons.join("\n"), /exception list expanded/);
}

console.log("check-architecture-policy.test: all assertions passed");
