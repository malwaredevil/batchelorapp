/**
 * gh-pr-lookup.ts
 *
 * Shared GitHub REST helpers for the sync-PR tooling: a thin authenticated
 * `fetch` wrapper plus the three ways scripts locate a sync PR (explicit
 * number, explicit branch, or "the most recently opened sync/… PR").
 *
 * Extracted so `apply-pr-suggestions.ts` and `promote-pr-ready.ts` don't
 * carry two copies of the same lookup logic (see
 * .agents/memory/always-consolidate-shared-libs.md).
 *
 * Requires:
 *   GH_PAT — GitHub personal access token with repo read/write access.
 */

export const REPO = process.env["GITHUB_REPO"] || "malwaredevil/batchelorapp";
const TOKEN = process.env["GH_PAT"];

export interface PrRef {
  number: number;
  node_id: string;
  draft: boolean;
  state: "open" | "closed";
  head: { ref: string; sha: string };
  html_url: string;
}

export async function gh<T>(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${res.status} for ${method} ${apiPath}: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * GitHub's GraphQL API — needed only for `markPullRequestReadyForReview`,
 * which has no REST equivalent (the `draft` field on `PATCH /pulls/{n}` is
 * read-only).
 */
export async function ghGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

export async function findOpenSyncPr(): Promise<PrRef> {
  const prs = await gh<PrRef[]>(
    "GET",
    `/repos/${REPO}/pulls?state=open&sort=created&direction=desc&per_page=20`,
  );
  const syncPr = prs.find((pr) => pr.head.ref.startsWith("sync/"));
  if (!syncPr) {
    throw new Error(
      "No open sync/… PR found. Pass --pr <n> or --branch <name> explicitly.",
    );
  }
  return syncPr;
}

export async function findPrByBranch(branch: string): Promise<PrRef> {
  const owner = REPO.split("/")[0];
  const prs = await gh<PrRef[]>(
    "GET",
    `/repos/${REPO}/pulls?state=open&head=${owner}:${branch}`,
  );
  const pr = prs[0];
  if (!pr) throw new Error(`No open PR found for branch ${branch}.`);
  return pr;
}

export async function findPrByNumber(n: number): Promise<PrRef> {
  return gh("GET", `/repos/${REPO}/pulls/${n}`);
}

/**
 * Best-effort lookup: like findPrByBranch, but returns null instead of
 * throwing when no open PR is associated with the branch. Used by
 * check-ci-status.ts, where "this branch has no open PR" is a normal,
 * non-fatal case (e.g. checking main itself).
 */
export async function findOpenPrForBranchOrNull(
  branch: string,
): Promise<PrRef | null> {
  try {
    return await findPrByBranch(branch);
  } catch {
    return null;
  }
}
