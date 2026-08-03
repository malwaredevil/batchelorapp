/**
 * check-ci-status.ts
 *
 * Pre-publish safety check: confirms GitHub Actions CI has actually run (and
 * passed) for the latest commit pushed to `main` on the associated GitHub
 * repository, before the app is published.
 *
 * Why this exists: the pre-publish checklist runs the codegen-drift check
 * locally, and CI re-runs the same checks on GitHub. But nothing previously
 * cross-checked that GitHub's CI actually confirmed the pushed commit is
 * clean. If GitHub sync lagged behind Replit, or a push silently failed, a
 * publish could go out for a commit CI never validated.
 *
 * This script:
 *   1. Fetches the latest commit on `main` from the GitHub REST API.
 *   2. Fetches the combined status + check-runs for that commit's SHA.
 *   3. If the tip commit has no check-runs (squash-merge scenario — GitHub
 *      attaches check-runs to the PR's head SHA, not the merge commit), looks
 *      up the PR that produced the tip commit and checks its head SHA instead.
 *   4. Prints a clear PASS / WARN / FAIL verdict.
 *
 * Exit codes:
 *   0 — CI is green (all check runs / statuses succeeded) for the latest
 *       commit on main (or the PR that produced it, in the squash-merge case).
 *   1 — CI is missing, pending, or failing for the latest commit on main, or
 *       the check could not be completed (network/auth error, no PAT, etc).
 *       This is a WARNING signal for the human/agent driving publish — it
 *       does not block anything by itself, it just must not be ignored.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run check-ci-status
 *
 * Requires:
 *   GH_PAT       — a GitHub personal access token with `repo` read access.
 *                  This is a dev-only secret used for repo automation; it is
 *                  never exposed to the deployed application.
 *   GITHUB_REPO  — optional, defaults to "malwaredevil/batchelorapp".
 */

export {};

const REPO = process.env["GITHUB_REPO"] || "malwaredevil/batchelorapp";
const BRANCH = process.env["GITHUB_BRANCH"] || "main";
const PAT = process.env["GH_PAT"];

interface GitHubCommit {
  sha: string;
  commit: { message: string; author: { date: string } | null };
  html_url: string;
}

interface CombinedStatus {
  state: "success" | "failure" | "pending" | "error";
  total_count: number;
  statuses: Array<{
    context: string;
    state: string;
    description: string | null;
  }>;
}

interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  html_url: string;
}

interface CheckRunsResponse {
  total_count: number;
  check_runs: CheckRun[];
}

interface PullRequest {
  number: number;
  state: "open" | "closed";
  merged_at: string | null;
  head: { sha: string };
  html_url: string;
  title: string;
}

async function githubGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${path} -> ${res.status} ${res.statusText}: ${body}`,
    );
  }
  return (await res.json()) as T;
}

function warn(message: string): void {
  console.log(`\n⚠️  WARNING: ${message}\n`);
}

function fail(message: string): never {
  warn(message);
  process.exitCode = 1;
  throw new Error(message);
}

/**
 * Fetches the check-runs and combined status for a given SHA.
 */
async function fetchCiForSha(sha: string): Promise<{
  combined: CombinedStatus;
  checkRuns: CheckRunsResponse;
}> {
  const [combined, checkRuns] = await Promise.all([
    githubGet<CombinedStatus>(`/repos/${REPO}/commits/${sha}/status`),
    githubGet<CheckRunsResponse>(`/repos/${REPO}/commits/${sha}/check-runs`),
  ]);
  return { combined, checkRuns };
}

/**
 * For squash-merges, GitHub attaches check-runs to the PR's head SHA rather
 * than to the resulting merge commit on main. This function looks up the most
 * recently merged PR associated with the given merge-commit SHA using the
 * "list pull requests associated with a commit" endpoint.
 *
 * Returns the PR if found, or null if none is associated.
 */
async function findMergedPrForCommit(
  sha: string,
): Promise<PullRequest | null> {
  let prs: PullRequest[];
  try {
    prs = await githubGet<PullRequest[]>(
      `/repos/${REPO}/commits/${sha}/pulls`,
    );
  } catch {
    // Non-fatal — if the endpoint fails we just can't fall back.
    return null;
  }

  // Filter to PRs that were actually merged (closed + merged_at set).
  const merged = prs.filter((pr) => pr.state === "closed" && pr.merged_at);
  if (!merged.length) return null;

  // Most recently merged first.
  merged.sort(
    (a, b) =>
      new Date(b.merged_at!).getTime() - new Date(a.merged_at!).getTime(),
  );
  return merged[0]!;
}

async function main(): Promise<void> {
  console.log(`Checking GitHub Actions CI status for ${REPO}@${BRANCH}...\n`);

  if (!PAT) {
    warn(
      "GH_PAT is not set — cannot verify GitHub CI status for the latest " +
        "commit on main. Publishing now means CI has NOT been confirmed clean " +
        "for this commit. Set GH_PAT or verify CI manually on GitHub before publishing.",
    );
    process.exitCode = 1;
    return;
  }

  let latestCommit: GitHubCommit;
  try {
    const commits = await githubGet<GitHubCommit[]>(
      `/repos/${REPO}/commits?sha=${BRANCH}&per_page=1`,
    );
    if (!commits.length) {
      fail(`No commits found on ${REPO}@${BRANCH}.`);
    }
    latestCommit = commits[0]!;
  } catch (err) {
    warn(
      `Could not fetch the latest commit on ${REPO}@${BRANCH}: ${
        err instanceof Error ? err.message : String(err)
      }. Publishing now means GitHub CI status is UNKNOWN for this commit.`,
    );
    process.exitCode = 1;
    return;
  }

  const tipSha = latestCommit.sha;
  console.log(
    `Latest commit on ${BRANCH}: ${tipSha.slice(0, 10)} — ${latestCommit.commit.message.split("\n")[0]}`,
  );
  console.log(latestCommit.html_url);

  let combined: CombinedStatus;
  let checkRuns: CheckRunsResponse;
  let ciSha = tipSha; // the SHA we ultimately report CI results for
  let ciUrl = latestCommit.html_url;

  try {
    ({ combined, checkRuns } = await fetchCiForSha(tipSha));
  } catch (err) {
    warn(
      `Could not fetch CI status for commit ${tipSha.slice(0, 10)}: ${
        err instanceof Error ? err.message : String(err)
      }. Publishing now means GitHub CI status is UNKNOWN for this commit.`,
    );
    process.exitCode = 1;
    return;
  }

  const tipRuns = checkRuns.check_runs ?? [];

  // ── Squash-merge fallback ────────────────────────────────────────────────
  // When a PR is squash-merged, GitHub attaches all check-runs to the PR's
  // head SHA, not to the resulting squash commit on main. If the tip commit
  // has no check-runs, look up the associated PR and check its head SHA
  // instead.
  if (tipRuns.length === 0 && combined.total_count === 0) {
    console.log(
      `\nℹ️  No check-runs found on tip commit ${tipSha.slice(0, 10)}. ` +
        `This is expected for squash-merged PRs — looking up the associated PR…`,
    );

    const pr = await findMergedPrForCommit(tipSha);

    if (pr) {
      console.log(
        `   Found PR #${pr.number}: "${pr.title}" (head SHA ${pr.head.sha.slice(0, 10)})`,
      );
      console.log(`   ${pr.html_url}\n`);

      try {
        ({ combined, checkRuns } = await fetchCiForSha(pr.head.sha));
        ciSha = pr.head.sha;
        ciUrl = pr.html_url;
      } catch (err) {
        warn(
          `Could not fetch CI status for PR #${pr.number} head SHA ${pr.head.sha.slice(0, 10)}: ${
            err instanceof Error ? err.message : String(err)
          }. Verify CI manually at ${pr.html_url}/checks before publishing.`,
        );
        process.exitCode = 1;
        return;
      }
    } else {
      // No associated PR found — fall through to the "no check-runs" warning.
      console.log(
        `   No merged PR found for commit ${tipSha.slice(0, 10)} — ` +
          `cannot fall back to PR head SHA.\n`,
      );
    }
  }

  const runs = checkRuns.check_runs ?? [];

  if (runs.length === 0 && combined.total_count === 0) {
    warn(
      `GitHub Actions has not reported any check runs or statuses for commit ` +
        `${ciSha.slice(0, 10)}${ciSha !== tipSha ? ` (PR head, tip is ${tipSha.slice(0, 10)})` : ` on ${BRANCH}`}. ` +
        `This usually means the commit hasn't been pushed to GitHub yet, or CI hasn't started. ` +
        `Do NOT treat this commit as CI-clean — verify manually at ${ciUrl}/checks before publishing.`,
    );
    process.exitCode = 1;
    return;
  }

  const incomplete = runs.filter((r) => r.status !== "completed");
  const failed = runs.filter(
    (r) =>
      r.status === "completed" &&
      r.conclusion !== "success" &&
      r.conclusion !== "neutral" &&
      r.conclusion !== "skipped",
  );

  if (incomplete.length > 0) {
    warn(
      `GitHub Actions CI is still PENDING for ${ciSha !== tipSha ? `PR head ${ciSha.slice(0, 10)}` : `commit ${ciSha.slice(0, 10)} on ${BRANCH}`}: ` +
        `${incomplete.map((r) => r.name).join(", ")}. Wait for CI to finish before publishing, ` +
        `or verify manually at ${ciUrl}/checks.`,
    );
    process.exitCode = 1;
    return;
  }

  if (failed.length > 0) {
    warn(
      `GitHub Actions CI is FAILING for ${ciSha !== tipSha ? `PR head ${ciSha.slice(0, 10)}` : `commit ${ciSha.slice(0, 10)} on ${BRANCH}`}: ` +
        `${failed.map((r) => `${r.name} (${r.conclusion})`).join(", ")}. ` +
        `Do not publish until this is fixed — see ${ciUrl}/checks.`,
    );
    process.exitCode = 1;
    return;
  }

  const shaLabel =
    ciSha !== tipSha
      ? `PR head SHA ${ciSha.slice(0, 10)} (tip commit ${tipSha.slice(0, 10)} on ${BRANCH})`
      : `commit ${ciSha.slice(0, 10)} on ${BRANCH}`;

  console.log(
    `\n✅ GitHub Actions CI is green for ${shaLabel} ` +
      `(${runs.map((r) => r.name).join(", ") || "no named check runs, but combined status is success"}).\n`,
  );
}

main().catch((err) => {
  if (!process.exitCode) {
    process.exitCode = 1;
  }
  console.error(err instanceof Error ? err.message : err);
});
