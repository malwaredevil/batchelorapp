/**
 * Unit tests for check-ci-status.ts – evaluateCheckRuns()
 *
 * Tests the four scenarios described in the task:
 *   1. All runs skipped  → verdict: all-skipped (fail)
 *   2. All runs neutral  → verdict: all-skipped (fail)
 *   3. Mixed (one success + some skipped) → ok
 *   4. All runs genuinely succeeded → ok
 *
 * Also covers the incomplete and failed-conclusion branches so the full
 * evaluation surface is locked in.
 */

import assert from "node:assert/strict";
import { dedupeCheckRunsByName, evaluateCheckRuns } from "./check-ci-status.js";
import type { CheckRunVerdict } from "./check-ci-status.js";

function makeRun(
  name: string,
  status: "completed" | "in_progress" | "queued",
  conclusion: string | null,
  startedAt?: string,
) {
  return {
    name,
    status,
    conclusion,
    html_url: `https://github.com/checks/${name}`,
    started_at: startedAt,
  };
}

// ── Scenario 1: All runs skipped ─────────────────────────────────────────────

const allSkipped = [
  makeRun("build", "completed", "skipped"),
  makeRun("lint", "completed", "skipped"),
  makeRun("typecheck", "completed", "skipped"),
];

{
  const verdict = evaluateCheckRuns(allSkipped);
  assert.equal(verdict.ok, false, "all-skipped: should not be ok");
  assert.ok(
    !verdict.ok && verdict.reason === "all-skipped",
    `all-skipped: expected reason 'all-skipped', got '${(verdict as CheckRunVerdict & { ok: false }).reason}'`,
  );
  assert.ok(
    !verdict.ok && verdict.names.length === 3,
    "all-skipped: should report all three run names",
  );
  assert.ok(
    !verdict.ok && verdict.names.some((n) => n.includes("build")),
    "all-skipped: names should include 'build'",
  );
  console.log("✓ All runs skipped → fails with reason all-skipped");
}

// ── Scenario 2: All runs neutral ──────────────────────────────────────────────

const allNeutral = [
  makeRun("build", "completed", "neutral"),
  makeRun("lint", "completed", "neutral"),
];

{
  const verdict = evaluateCheckRuns(allNeutral);
  assert.equal(verdict.ok, false, "all-neutral: should not be ok");
  assert.ok(
    !verdict.ok && verdict.reason === "all-skipped",
    `all-neutral: expected reason 'all-skipped', got '${(verdict as CheckRunVerdict & { ok: false }).reason}'`,
  );
  assert.ok(
    !verdict.ok && verdict.names.length === 2,
    "all-neutral: should report both run names",
  );
  console.log("✓ All runs neutral → fails with reason all-skipped");
}

// ── Scenario 3: Mixed – one success + some skipped ───────────────────────────

const mixedSuccessAndSkipped = [
  makeRun("build", "completed", "success"),
  makeRun("optional-lint", "completed", "skipped"),
  makeRun("optional-check", "completed", "neutral"),
];

{
  const verdict = evaluateCheckRuns(mixedSuccessAndSkipped);
  assert.equal(
    verdict.ok,
    true,
    "mixed-success+skipped: should be ok when at least one success exists",
  );
  console.log("✓ Mixed (one success + skipped/neutral) → passes");
}

// ── Scenario 4: All runs succeeded ───────────────────────────────────────────

const allSuccess = [
  makeRun("build", "completed", "success"),
  makeRun("lint", "completed", "success"),
  makeRun("typecheck", "completed", "success"),
];

{
  const verdict = evaluateCheckRuns(allSuccess);
  assert.equal(verdict.ok, true, "all-success: should be ok");
  console.log("✓ All runs succeeded → passes");
}

// ── Extra: incomplete runs ────────────────────────────────────────────────────

const withIncomplete = [
  makeRun("build", "completed", "success"),
  makeRun("lint", "in_progress", null),
];

{
  const verdict = evaluateCheckRuns(withIncomplete);
  assert.equal(verdict.ok, false, "incomplete: should not be ok");
  assert.ok(
    !verdict.ok && verdict.reason === "incomplete",
    `incomplete: expected reason 'incomplete', got '${(verdict as CheckRunVerdict & { ok: false }).reason}'`,
  );
  assert.ok(
    !verdict.ok && verdict.names.includes("lint"),
    "incomplete: should name the pending run",
  );
  console.log("✓ Incomplete runs → fails with reason incomplete");
}

// ── Extra: failed conclusion ──────────────────────────────────────────────────

const withFailed = [
  makeRun("build", "completed", "success"),
  makeRun("lint", "completed", "failure"),
];

{
  const verdict = evaluateCheckRuns(withFailed);
  assert.equal(verdict.ok, false, "failed: should not be ok");
  assert.ok(
    !verdict.ok && verdict.reason === "failed",
    `failed: expected reason 'failed', got '${(verdict as CheckRunVerdict & { ok: false }).reason}'`,
  );
  assert.ok(
    !verdict.ok && verdict.names.some((n) => n.includes("lint")),
    "failed: should name the failed run",
  );
  console.log("✓ Failed conclusion → fails with reason failed");
}

// ── Extra: empty run list (no check-runs at all) ──────────────────────────────
// Empty list should be ok (the zero-runs guard is separate, in main()).

{
  const verdict = evaluateCheckRuns([]);
  assert.equal(
    verdict.ok,
    true,
    "empty: zero runs should be ok from evaluateCheckRuns perspective",
  );
  console.log("✓ Empty run list → ok (zero-runs guard handled by caller)");
}

// ── Extra: mixed skipped + neutral (no success) ───────────────────────────────

const skippedAndNeutral = [
  makeRun("build", "completed", "skipped"),
  makeRun("lint", "completed", "neutral"),
  makeRun("typecheck", "completed", "skipped"),
];

{
  const verdict = evaluateCheckRuns(skippedAndNeutral);
  assert.equal(verdict.ok, false, "skipped+neutral: should not be ok");
  assert.ok(
    !verdict.ok && verdict.reason === "all-skipped",
    `skipped+neutral: expected reason 'all-skipped', got '${(verdict as CheckRunVerdict & { ok: false }).reason}'`,
  );
  console.log(
    "✓ Mix of skipped and neutral (no success) → fails with reason all-skipped",
  );
}

// ── Extra: re-run supersedes its own earlier failed attempt ──────────────────
// GitHub's check-runs API returns every attempt for a given name. A required
// check that failed once and was then manually re-run to success must not be
// reported as "failed" just because the stale failed attempt is still in the
// list — this is exactly what happened on PR #465 (task #658's merge).

const rerunSupersedesFailure = [
  makeRun("build", "completed", "success", "2026-08-04T11:00:00Z"),
  makeRun("PR Validation", "completed", "failure", "2026-08-04T11:12:24Z"),
  makeRun("PR Validation", "completed", "success", "2026-08-04T11:17:00Z"),
];

{
  const deduped = dedupeCheckRunsByName(rerunSupersedesFailure);
  assert.equal(
    deduped.length,
    2,
    "dedupe: should collapse to one run per name",
  );
  const prValidation = deduped.find((r) => r.name === "PR Validation");
  assert.equal(
    prValidation?.conclusion,
    "success",
    "dedupe: should keep the later (successful) re-run, not the earlier failure",
  );

  const verdict = evaluateCheckRuns(rerunSupersedesFailure);
  assert.equal(
    verdict.ok,
    true,
    "rerun: a later successful re-run should make the overall verdict ok",
  );
  console.log(
    "✓ Re-run superseding an earlier failed attempt → passes (uses latest run per name)",
  );
}

// ── Extra: dedupe keeps a still-failing check even with an older success ─────
// (e.g. a flaky pass followed by a genuine later failure must still fail.)

const laterFailureStillFails = [
  makeRun("build", "completed", "success", "2026-08-04T11:00:00Z"),
  makeRun("lint", "completed", "success", "2026-08-04T11:00:00Z"),
  makeRun("lint", "completed", "failure", "2026-08-04T11:05:00Z"),
];

{
  const verdict = evaluateCheckRuns(laterFailureStillFails);
  assert.equal(
    verdict.ok,
    false,
    "later-failure: a later failing re-run must still fail overall",
  );
  console.log(
    "✓ Later failing re-run overriding an earlier success → still fails",
  );
}

console.log("\n✅ All check-ci-status tests passed.\n");
