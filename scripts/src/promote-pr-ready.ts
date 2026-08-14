/**
 * promote-pr-ready.ts
 *
 * Promotes a Draft sync PR to "Ready for review" once its fast/cheap CI
 * checks are green, so the heavy suite (E2E, codegen-drift,
 * elaine-capability-parity — all gated behind
 * `if: github.event.pull_request.draft == false` in ci.yml/guardrails.yml)
 * only runs against code already known to pass the cheap checks.
 *
 * Why this exists: github-sync.ts now opens every sync PR as a Draft (see
 * .agents/memory/ci-pr-only-validation.md). GitHub's REST API has no
 * writable `draft` field on `PATCH /pulls/{number}` — the only way to take a
 * PR out of Draft is the GraphQL `markPullRequestReadyForReview` mutation.
 * This script wraps that mutation with the same "verify CI is actually
 * green first" logic check-ci-status.ts already implements, so promotion
 * itself can't be used to skip verification.
 *
 * Flow:
 *   1. Locate the PR (--pr <n> / --branch <name> / default: most recent
 *      open sync/… PR — same resolution order as apply-pr-suggestions.ts).
 *   2. If it's already Ready for review, no-op.
 *   3. Fetch check-runs for the PR's head SHA and evaluate them with the
 *      same pure verdict function check-ci-status.ts uses. A Draft PR's
 *      heavy jobs report as "skipped", which evaluateCheckRuns already
 *      treats as passing — so a green verdict here means every check that
 *      actually ran at Draft stage succeeded.
 *   4. If green, call markPullRequestReadyForReview. If not, print why and
 *      exit 1 without touching the PR.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run promote-pr-ready [--branch <sync/…>] [--pr <n>] [--dry-run]
 *
 * Requires:
 *   GH_PAT — GitHub personal access token with repo read/write access.
 */

import {
  ghGraphql,
  findOpenSyncPr,
  findPrByBranch,
  findPrByNumber,
  type PrRef,
} from "./gh-pr-lookup.js";
import { evaluateCheckRuns, fetchCiForSha } from "./check-ci-status.js";

const TOKEN = process.env["GH_PAT"];

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error("GH_PAT env var not set.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const branchIdx = args.indexOf("--branch");
  const prIdx = args.indexOf("--pr");
  const explicitBranch = branchIdx !== -1 ? args[branchIdx + 1] : undefined;
  const explicitPr = prIdx !== -1 ? Number(args[prIdx + 1]) : undefined;

  const pr: PrRef = explicitPr
    ? await findPrByNumber(explicitPr)
    : explicitBranch
      ? await findPrByBranch(explicitBranch)
      : await findOpenSyncPr();

  console.log(
    `PR #${pr.number} (${pr.head.ref}) — currently ${pr.draft ? "Draft" : "Ready for review"}.`,
  );

  if (!pr.draft) {
    console.log("Already Ready for review. Nothing to do.");
    return;
  }

  console.log(
    `Checking CI for head SHA ${pr.head.sha.slice(0, 10)} before promoting...`,
  );

  const { checkRuns } = await fetchCiForSha(pr.head.sha);
  const runs = checkRuns.check_runs ?? [];

  if (runs.length === 0) {
    console.log(
      "\n⚠️  No check-runs reported yet for this commit. CI may not have " +
        "started — wait and re-run rather than promoting blind.",
    );
    process.exitCode = 1;
    return;
  }

  const verdict = evaluateCheckRuns(runs);
  if (!verdict.ok) {
    if (verdict.reason === "incomplete") {
      console.log(
        `\n⚠️  Draft-stage checks are still PENDING: ${verdict.names.join(", ")}. ` +
          `Wait for them to finish before promoting.`,
      );
    } else if (verdict.reason === "failed") {
      console.log(
        `\n⚠️  Draft-stage checks are FAILING: ${verdict.names.join(", ")}. ` +
          `Fix these first — promoting now would run the expensive suite ` +
          `against code already known to be broken.`,
      );
    } else {
      console.log(
        `\n⚠️  No Draft-stage check genuinely passed (all skipped/neutral): ` +
          `${verdict.names.join(", ")}. Verify manually before promoting.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n✅ Draft-stage checks are green (${runs.map((r) => r.name).join(", ")}).`,
  );

  if (dryRun) {
    console.log(
      "[dry-run] Would promote to Ready for review — re-run without --dry-run to do it.",
    );
    return;
  }

  await ghGraphql(
    `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }`,
    { id: pr.node_id },
  );

  console.log(
    `\n✓ PR #${pr.number} promoted to Ready for review — ${pr.html_url}`,
  );
  console.log(
    `  The full CI suite (E2E, codegen-drift, elaine-capability-parity, etc.) ` +
      `will now run. Wait for it to go green (check-ci-status) before merging.`,
  );
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("promote-pr-ready.ts") ||
    process.argv[1].endsWith("promote-pr-ready.js"))
) {
  main().catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
