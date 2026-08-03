/**
 * check-github-drift.ts — detect files that GitHub main has at a different
 * SHA than the local workspace copy.
 *
 * Purpose
 * -------
 * Dependabot auto-merges (via dependabot-auto-merge.yml) land directly on
 * GitHub main without a Replit task/Apply-Merge step.  If this drift is not
 * caught before github-sync, the stale local copy is pushed as a sync PR and
 * silently reverts the Dependabot bump.
 *
 * This script is wired into the pre-publish parallel guard block.  It exits 1
 * and prints actionable instructions when drift is detected.
 *
 * Default scope: .github/ (workflow files — the most common Dependabot target).
 * Run with --all to check every non-excluded file.
 *
 * Fail-closed behaviour
 * ---------------------
 * - Missing GH_PAT         → exit 1  (same policy as github-sync and check-ci-status)
 * - GitHub API error        → exit 1
 * - Drift detected          → exit 1
 * - No drift / clean check  → exit 0
 */

import fs from "fs";
import https from "https";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Pure, testable helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Git blob SHA for local file content: sha1("blob <size>\0<content>") */
export function localBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return crypto
    .createHash("sha1")
    .update(Buffer.concat([header, content]))
    .digest("hex");
}

/**
 * Given the GitHub HEAD sha map and a provider that returns the local file
 * content (or null if the file is absent locally), return the list of paths
 * that are drifted (GitHub has a different SHA than local, or the file is
 * missing locally).
 *
 * @param ghShaMap      path → git-blob-sha from GitHub HEAD tree
 * @param readLocal     (path) → Buffer if file exists locally, null if absent
 * @param candidatePaths  subset of ghShaMap keys to check
 */
export function findDriftedPaths(
  ghShaMap: Map<string, string>,
  readLocal: (p: string) => Buffer | null,
  candidatePaths: string[],
): string[] {
  const drifted: string[] = [];
  for (const ghPath of candidatePaths) {
    const ghSha = ghShaMap.get(ghPath)!;
    const localContent = readLocal(ghPath);

    if (localContent === null) {
      // File exists on GitHub but is missing locally → drift
      drifted.push(ghPath);
      continue;
    }

    const lSha = localBlobSha(localContent);
    if (lSha !== ghSha) {
      drifted.push(ghPath);
    }
  }
  return drifted;
}

// ---------------------------------------------------------------------------
// Network helpers (not exported — not unit-testable without mocking network)
// ---------------------------------------------------------------------------

const TOKEN = process.env.GH_PAT;
const REPO = "malwaredevil/batchelorapp";
const BRANCH = "main";

// Paths that are examined by default (no --all flag).
const DEFAULT_CHECK_PREFIXES = [".github/"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gh<T>(method: string, apiPath: string): Promise<T> {
  return new Promise((res, rej) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath.startsWith("/repos/")
          ? apiPath
          : `/repos/${REPO}${apiPath}`,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          "User-Agent": "batchelor-check-github-drift",
          "Content-Type": "application/json",
        },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            const parsed = JSON.parse(d) as T;
            if (
              r.statusCode !== undefined &&
              (r.statusCode < 200 || r.statusCode >= 300)
            ) {
              rej(
                new Error(
                  `GitHub API ${r.statusCode} for ${method} ${apiPath}: ${d.slice(0, 300)}`,
                ),
              );
            } else {
              res(parsed);
            }
          } catch {
            rej(
              new Error(
                `JSON parse error (${r.statusCode}): ${d.slice(0, 300)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", rej);
    req.end();
  });
}

type GHTreeEntry = {
  path: string;
  type: string;
  sha: string | null;
};

async function main() {
  // Fail closed on missing token — consistent with github-sync and check-ci-status.
  // A pre-publish environment without GH_PAT must not silently report this guard
  // as passing; missing credentials are an error, not an acceptable skip.
  if (!TOKEN) {
    console.error(
      "🚫 check-github-drift: GH_PAT env var not set.\n" +
        "   Cannot verify .github/workflows/ files match GitHub main.\n" +
        "   Set GH_PAT and re-run, or confirm no Dependabot PRs were auto-merged\n" +
        "   on GitHub since your last pull-from-github run.",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const checkAll = args.includes("--all");
  const root = path.resolve(import.meta.dirname, "../..");

  // Fetch GitHub HEAD tree
  const ref = await gh<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${BRANCH}`,
  );
  const headSha = ref.object.sha;
  const headCommit = await gh<{ tree: { sha: string } }>(
    "GET",
    `/git/commits/${headSha}`,
  );
  const treeData = await gh<{ tree: GHTreeEntry[]; truncated: boolean }>(
    "GET",
    `/git/trees/${headCommit.tree.sha}?recursive=1`,
  );

  // Build path→sha map from GitHub
  const ghShaMap = new Map<string, string>();
  for (const entry of treeData.tree) {
    if (entry.type === "blob" && entry.sha != null) {
      ghShaMap.set(entry.path, entry.sha);
    }
  }

  // Determine which paths to check
  const candidatePaths = checkAll
    ? [...ghShaMap.keys()]
    : [...ghShaMap.keys()].filter((p) =>
        DEFAULT_CHECK_PREFIXES.some((prefix) => p.startsWith(prefix)),
      );

  // Use the pure helper with the real filesystem
  const drifted = findDriftedPaths(
    ghShaMap,
    (ghPath) => {
      const localPath = path.join(root, ghPath);
      return fs.existsSync(localPath) ? fs.readFileSync(localPath) : null;
    },
    candidatePaths,
  );

  if (drifted.length === 0) {
    const scope = checkAll
      ? "all files"
      : DEFAULT_CHECK_PREFIXES.join(", ") + " files";
    console.log(`✓ No GitHub drift — local matches GitHub main for ${scope}`);
    process.exit(0);
  }

  // Drift found — print a clear, actionable error.
  console.error(
    `\n🚫 GitHub drift detected: ${drifted.length} file(s) on GitHub main differ from local.\n` +
      `\n   This usually means Dependabot auto-merged a PR on GitHub (e.g. a GitHub Actions bump)\n` +
      `   without a corresponding Replit task merge.  Running github-sync now would silently\n` +
      `   revert those changes.\n` +
      `\n   Drifted file(s):\n` +
      drifted.map((f) => `     ${f}`).join("\n") +
      `\n\n   Fix: pull the GitHub-main version of these files into the local workspace:\n` +
      `\n     pnpm --filter @workspace/scripts run pull-from-github\n` +
      `\n   Then review the local changes and include them in your next github-sync run.\n` +
      `   If you intentionally want to overwrite GitHub's version with the local copy,\n` +
      `   pass --skip-drift-check to github-sync (use with care).`,
  );
  process.exit(1);
}

// Only invoke main() when this file is run directly (not imported by tests).
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}
