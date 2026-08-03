/**
 * pull-from-github.ts — fetch files from GitHub main and write them locally.
 *
 * Purpose
 * -------
 * Dependabot auto-merges (via dependabot-auto-merge.yml) happen entirely on
 * GitHub without a Replit task/Apply-Merge step.  The next github-sync run
 * would treat the stale local copy as the source of truth and open a PR that
 * silently reverts the Dependabot bump.  This script is the antidote: run it
 * before github-sync to pull any GitHub-side-only changes back to local.
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run pull-from-github
 *       # pull ALL .github/ files that differ from GitHub main
 *
 *   pnpm --filter @workspace/scripts run pull-from-github -- .github/workflows/ci.yml
 *       # pull only the named file(s) (multiple paths supported)
 *
 *   pnpm --filter @workspace/scripts run pull-from-github -- --all
 *       # pull every non-excluded file that GitHub has at a different SHA than local
 *
 * When to run
 * -----------
 * Stage 3b of the pre-publish checklist, right before running github-sync.
 * Also run after merging or closing any Dependabot PR on GitHub.
 */

import fs from "fs";
import https from "https";
import path from "path";
import crypto from "crypto";

const TOKEN = process.env.GH_PAT;
const REPO = "malwaredevil/batchelorapp";
const BRANCH = "main";

if (!TOKEN) {
  console.error("GH_PAT env var not set.");
  process.exit(1);
}

// Paths to pull by default (when no explicit args given and --all is not set).
// These are the directories most likely to receive GitHub-only Dependabot bumps.
const DEFAULT_PULL_PREFIXES = [".github/"];

const args = process.argv.slice(2);
const pullAll = args.includes("--all");
const explicitPaths = args.filter((a) => !a.startsWith("--"));

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
          "User-Agent": "batchelor-pull-from-github",
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

/** Git blob SHA for a local file: sha1("blob <size>\0<content>") */
function localBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return crypto
    .createHash("sha1")
    .update(Buffer.concat([header, content]))
    .digest("hex");
}

type GHTreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
  size?: number;
};

type GHBlobResponse = {
  content: string;
  encoding: string;
};

async function main() {
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
  if (treeData.truncated) {
    console.warn(
      "⚠ GitHub tree is truncated — large repo, some files may be missed.",
    );
  }

  // Build path→sha map from GitHub
  const ghShaMap = new Map<string, string>();
  for (const entry of treeData.tree) {
    if (entry.type === "blob" && entry.sha != null) {
      ghShaMap.set(entry.path, entry.sha);
    }
  }

  // Determine which GitHub paths to examine
  let candidatePaths: string[];
  if (explicitPaths.length > 0) {
    // Explicit file or prefix args — match exact path or prefix
    candidatePaths = [...ghShaMap.keys()].filter((p) =>
      explicitPaths.some((arg) => p === arg || p.startsWith(arg)),
    );
  } else if (pullAll) {
    candidatePaths = [...ghShaMap.keys()];
  } else {
    // Default: .github/ only
    candidatePaths = [...ghShaMap.keys()].filter((p) =>
      DEFAULT_PULL_PREFIXES.some((prefix) => p.startsWith(prefix)),
    );
  }

  if (candidatePaths.length === 0) {
    console.log("No matching paths found on GitHub main.");
    process.exit(0);
  }

  // Find files where GitHub differs from local
  const driftedPaths: string[] = [];
  for (const ghPath of candidatePaths) {
    const localPath = path.join(root, ghPath);
    const ghSha = ghShaMap.get(ghPath)!;

    let localSha: string | null = null;
    if (fs.existsSync(localPath)) {
      const localContent = fs.readFileSync(localPath);
      localSha = localBlobSha(localContent);
    }

    if (localSha !== ghSha) {
      driftedPaths.push(ghPath);
    }
  }

  if (driftedPaths.length === 0) {
    const scope =
      explicitPaths.length > 0
        ? explicitPaths.join(", ")
        : pullAll
          ? "all files"
          : DEFAULT_PULL_PREFIXES.join(", ");
    console.log(
      `✓ No drift detected — local matches GitHub main for: ${scope}`,
    );
    process.exit(0);
  }

  console.log(`\nDrifted files (${driftedPaths.length}):`);
  driftedPaths.forEach((p) => console.log(`  ${p}`));
  console.log("\nPulling from GitHub main…\n");

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const written: string[] = [];
  const newFiles: string[] = [];

  for (const ghPath of driftedPaths) {
    const ghSha = ghShaMap.get(ghPath)!;
    await sleep(80); // rate-limit headroom
    const blob = await gh<GHBlobResponse>("GET", `/git/blobs/${ghSha}`);
    let content: Buffer;
    if (blob.encoding === "base64") {
      content = Buffer.from(blob.content.replace(/\n/g, ""), "base64");
    } else {
      content = Buffer.from(blob.content, "utf8");
    }

    const localPath = path.join(root, ghPath);
    const existed = fs.existsSync(localPath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content);

    if (existed) {
      written.push(ghPath);
      console.log(`  ✓ updated  ${ghPath}`);
    } else {
      newFiles.push(ghPath);
      console.log(`  ✓ created  ${ghPath}`);
    }
  }

  console.log(
    `\n✓ Pull complete — ${written.length} updated, ${newFiles.length} created.`,
  );
  if (written.length + newFiles.length > 0) {
    console.log(
      "\n  ⚠ Local files have been overwritten with GitHub main content.",
    );
    console.log(
      "  Review the changes, then include them in your next github-sync run.",
    );
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
