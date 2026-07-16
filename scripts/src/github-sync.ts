/**
 * github-sync.ts — batch-push all changed files to GitHub in a single commit.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run github-sync "commit message"
 *
 * Rules enforced here:
 * - Detects changed files by comparing local content to GitHub HEAD blobs
 *   (no git commands — the sandbox blocks git writes).
 * - ALL changed files go into ONE commit via the Git Data API (never per-file).
 * - Prettier --write is run on every changed file before the blobs are created.
 * - A single CI run is triggered. Never loop the Contents API per file.
 * - Files in .local/, .agents/, threat_model.md are excluded (never pushed).
 * - If nothing changed vs GitHub HEAD, exits 0 cleanly.
 */

import { execSync } from "child_process";
import fs from "fs";
import https from "https";
import path from "path";
import crypto from "crypto";

const TOKEN = process.env.GITHUB_PAT;
const REPO = "malwaredevil/batchelorapp";
const BRANCH = "main";

if (!TOKEN) {
  console.error("GITHUB_PAT env var not set.");
  process.exit(1);
}

const commitMessage = process.argv.slice(2).join(" ").trim();
if (!commitMessage) {
  console.error(
    'Usage: pnpm --filter @workspace/scripts run github-sync "commit message"',
  );
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gh<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath.startsWith("/repos/")
          ? apiPath
          : `/repos/${REPO}${apiPath}`,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          "User-Agent": "batchelor-sync",
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            res(JSON.parse(d) as T);
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
    if (data) req.write(data);
    req.end();
  });
}

const EXCLUDED_PREFIXES = [
  ".local/",
  ".agents/",
  ".git/",
  "node_modules/",
  "dist/",
  "attached_assets/",
];
const EXCLUDED_EXACT = ["threat_model.md"];
// Binary/media files — large and not meaningful to diff
const EXCLUDED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".pdf",
  ".xlsx",
  ".xls",
  ".docx",
  ".doc",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".tsbuildinfo",
]);

function isExcluded(filePath: string): boolean {
  if (EXCLUDED_EXACT.includes(filePath)) return true;
  if (EXCLUDED_PREFIXES.some((p) => filePath.startsWith(p))) return true;
  const ext = path.extname(filePath).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(ext);
}

/** Recursively collect all tracked files in the repo (excluding exclusions) */
function collectFiles(dir: string, root: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (isExcluded(rel) || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      results.push(...collectFiles(abs, root));
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
  return results;
}

/** Git blob SHA for a local file: sha1("blob <size>\0<content>") */
function localBlobSha(filePath: string): string {
  const content = fs.readFileSync(filePath);
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
  sha: string;
  size?: number;
};

async function main() {
  const root = path.resolve(import.meta.dirname, "../..");

  // Get current HEAD tree from GitHub
  const ref = await gh<{ object: { sha: string } }>(
    "GET",
    `/git/ref/heads/${BRANCH}`,
  );
  const headSha = ref.object.sha;
  const headCommit = await gh<{ tree: { sha: string } }>(
    "GET",
    `/git/commits/${headSha}`,
  );

  // Recursively fetch the full tree (truncated=false)
  const treeData = await gh<{ tree: GHTreeEntry[]; truncated: boolean }>(
    "GET",
    `/git/trees/${headCommit.tree.sha}?recursive=1`,
  );
  if (treeData.truncated) {
    console.warn(
      "⚠ GitHub tree is truncated — large repo, some files may be missed.",
    );
  }

  // Build a map of path → sha from GitHub
  const ghShaMap = new Map<string, string>();
  for (const entry of treeData.tree) {
    if (entry.type === "blob") ghShaMap.set(entry.path, entry.sha);
  }

  // Collect local files
  const localFiles = collectFiles(root, root);

  // Find files that differ (new or changed)
  const changedFiles: string[] = [];
  for (const rel of localFiles) {
    const ghSha = ghShaMap.get(rel);
    const localSha = localBlobSha(path.join(root, rel));
    if (ghSha !== localSha) {
      changedFiles.push(rel);
    }
  }

  if (changedFiles.length === 0) {
    console.log("✓ Nothing to sync — all local files match GitHub HEAD.");
    process.exit(0);
  }

  console.log(`\nChanged files (${changedFiles.length}):`);
  changedFiles.forEach((f) => console.log(`  ${f}`));

  // Run prettier --write on text files before creating blobs
  const prettierTargets = changedFiles
    .filter((f) => /\.(ts|tsx|js|jsx|json|yaml|yml|md|css)$/.test(f))
    .map((f) => `"${f}"`)
    .join(" ");
  if (prettierTargets) {
    console.log("\nRunning prettier --write on changed files...");
    execSync(`npx prettier --write ${prettierTargets} --log-level warn`, {
      cwd: root,
      stdio: "inherit",
    });
    console.log("Prettier done.");
  }

  console.log(
    `\nBase commit: ${headSha.slice(0, 8)}, tree: ${headCommit.tree.sha.slice(0, 8)}`,
  );

  // Create all blobs
  const treeEntries: {
    path: string;
    mode: string;
    type: string;
    sha: string;
  }[] = [];
  for (const filePath of changedFiles) {
    const content = fs
      .readFileSync(path.join(root, filePath))
      .toString("base64");
    const blob = await gh<{ sha: string }>("POST", "/git/blobs", {
      content,
      encoding: "base64",
    });
    console.log(`  blob ${path.basename(filePath)}: ${blob.sha.slice(0, 8)}`);
    treeEntries.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  // One tree, one commit, one ref update
  const newTree = await gh<{ sha: string }>("POST", "/git/trees", {
    base_tree: headCommit.tree.sha,
    tree: treeEntries,
  });
  console.log(`tree: ${newTree.sha.slice(0, 8)}`);

  const newCommit = await gh<{ sha: string }>("POST", "/git/commits", {
    message: commitMessage,
    tree: newTree.sha,
    parents: [headSha],
  });
  console.log(`commit: ${newCommit.sha.slice(0, 8)}`);

  await gh("PATCH", `/git/refs/heads/${BRANCH}`, { sha: newCommit.sha });
  console.log(
    `\n✓ Pushed to ${REPO}@${BRANCH} — single commit, single CI run triggered.`,
  );
  console.log(`  https://github.com/${REPO}/commit/${newCommit.sha}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
