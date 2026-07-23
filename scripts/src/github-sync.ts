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
 * - Excluded: .local/, .agents/, .upm/, .cache/, dist/, threat_model.md,
 *   Replit config files (.replit, replit.nix), and Playwright test artifacts
 *   (smoke-auth.json can contain live session cookies).
 * - Allowed dotfiles: .github/ (CI workflows), .gitignore, .husky/, .vscode/.
 *   All other dotfiles/dotdirs are blocked by default.
 * - Hard abort if any credential-bearing file pattern enters the upload list.
 * - If nothing changed vs GitHub HEAD, exits 0 cleanly.
 */

import { execSync, spawnSync } from "child_process";
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

const rawArgs = process.argv.slice(2);
const confirmDeletions = rawArgs.includes("--confirm-deletions");
const commitMessage = rawArgs
  .filter((a) => a !== "--confirm-deletions")
  .join(" ")
  .trim();
if (!commitMessage) {
  console.error(
    'Usage: pnpm --filter @workspace/scripts run github-sync "commit message" [--confirm-deletions]\n' +
      "  --confirm-deletions  Required to actually remove files from GitHub that are missing locally.",
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
    if (data) req.write(data);
    req.end();
  });
}

const EXCLUDED_PREFIXES = [
  // Replit-internal directories — never push to public repo
  ".local/",
  ".agents/",
  ".upm/",
  ".cache/",
  // Git internals and build outputs
  ".git/",
  "node_modules/",
  "dist/",
  "attached_assets/",
  // Playwright test artifacts — may contain live session cookies (smoke-auth.json)
  // and large HTML reports. None of this belongs in the public repo.
  "artifacts/e2e/playwright-report/",
  "artifacts/e2e/playwright-smoke-report/",
  "artifacts/e2e/test-results/",
  // Husky-generated wrapper scripts — auto-generated, not authored, gitignored locally.
  // The custom sync does not honour .gitignore, so exclude explicitly.
  ".husky/_/",
];
const EXCLUDED_EXACT = [
  // Security: threat model contains internal architecture details
  "threat_model.md",
  // Private operational runbook — contains Sentry workflow, screenshot-bypass
  // paths, backup commands, release checklists, and other internal procedures.
  // Normally lives in .local/ (already blocked by EXCLUDED_PREFIXES), but
  // also listed here to catch any copy accidentally placed at the repo root.
  "RUNBOOK.md",
  // Replit-specific config files — may contain plaintext env vars or
  // Replit-internal state that must never appear in the public repo.
  ".replit",
  ".replitignore",
  "replit.nix",
  // Playwright storageState — contains live authenticated browser session cookies.
  // Pushing this to a public repo would expose a valid session credential.
  "artifacts/e2e/smoke-auth.json",
];
// Dotfile/dotdir names that ARE allowed through to GitHub.
// Everything else starting with "." is skipped (replaces the old blanket
// entry.name.startsWith(".") guard that accidentally blocked .github/).
const ALLOWED_DOT_NAMES = new Set([
  ".github", // CI workflows, Dependabot, PR templates — must reach GitHub
  ".gitignore",
  ".husky", // git hook scripts
  ".vscode", // shared editor settings
  ".npmrc", // pnpm workspace config (catalog, strict-peer-deps)
  ".prettierrc", // prettier format config
  ".prettierignore", // prettier exclusions
  ".lintstagedrc.json", // lint-staged config (pre-commit hook)
  ".editorconfig", // editor indent/whitespace config
]);
// Dotfile directories that are Replit-internal and must never appear on GitHub.
// These are skipped by collectFiles (dotfile guard) so they never appear in
// localFiles, but they CAN appear in ghShaMap if previously pushed by another
// tool. Marking them here prevents the deletion logic from queuing them as
// "legitimate deletions" (they're not managed by this script at all).
const EXCLUDED_DOT_DIRS = new Set([
  ".replit-artifact", // Replit proxy routing config — Replit-internal
]);
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
  // Also exclude nested node_modules/ and dist/ directories (e.g. lib/ui/node_modules/, artifacts/api-server/dist/)
  if (filePath.includes("/node_modules/") || filePath.includes("/dist/"))
    return true;
  // Exclude paths containing Replit-internal dotdirs that are never collected
  // by collectFiles. This prevents the deletion logic from treating them as
  // "deleted locally" (they were never managed by this script to begin with).
  const segments = filePath.split("/");
  if (segments.some((seg) => EXCLUDED_DOT_DIRS.has(seg))) return true;
  // Exclude any file whose basename starts with "RUNBOOK" (case-sensitive).
  // The canonical location .local/RUNBOOK.md is already blocked by the
  // .local/ prefix, but this covers variants at any depth (RUNBOOK-v2.md,
  // RUNBOOK.secrets.md, nested/RUNBOOK.md, etc.) in case one is ever placed
  // outside .local/ by accident.
  const basename = path.basename(filePath);
  if (basename.startsWith("RUNBOOK")) return true;
  const ext = path.extname(filePath).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(ext);
}

/** Recursively collect all tracked files in the repo (excluding exclusions) */
function collectFiles(dir: string, root: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (isExcluded(rel)) continue;
    // Dotfile/dotdir guard: skip by default, only allow explicit allowlist.
    // This replaces the old blanket `entry.name.startsWith(".")` which
    // accidentally blocked .github/ (CI workflows never reached GitHub).
    if (entry.name.startsWith(".") && !ALLOWED_DOT_NAMES.has(entry.name)) {
      continue;
    }
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
  sha: string | null;
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
    if (entry.type === "blob" && entry.sha != null)
      ghShaMap.set(entry.path, entry.sha);
  }

  // Collect local files
  const localFiles = collectFiles(root, root);
  const localFileSet = new Set(localFiles);

  // Find files that differ (new or changed)
  const changedFiles: string[] = [];
  for (const rel of localFiles) {
    const ghSha = ghShaMap.get(rel);
    const localSha = localBlobSha(path.join(root, rel));
    if (ghSha !== localSha) {
      changedFiles.push(rel);
    }
  }

  // Find files that exist on GitHub but were deleted locally.
  // Only include paths that are not excluded — the same isExcluded guard
  // that prevents local files from being pushed also prevents GitHub-only
  // files outside the managed root from being deleted.
  const MAX_DELETIONS = 20;
  const deletedFiles: string[] = [];
  for (const ghPath of ghShaMap.keys()) {
    if (!localFileSet.has(ghPath) && !isExcluded(ghPath)) {
      deletedFiles.push(ghPath);
    }
  }
  if (deletedFiles.length > MAX_DELETIONS && !confirmDeletions) {
    console.error(
      `\n🚫 ABORTED: ${deletedFiles.length} files would be deleted from GitHub, which exceeds the ` +
        `safety cap of ${MAX_DELETIONS}. This usually means an exclusion list entry is wrong.\n` +
        `Files to delete:\n` +
        deletedFiles.map((f) => `  ${f}`).join("\n") +
        `\nReview EXCLUDED_PREFIXES/EXCLUDED_EXACT and re-run.` +
        `\nIf the deletions are intentional (e.g. a large-scale rename or generated-file cleanup),` +
        `\nre-run with --confirm-deletions to bypass this cap:\n` +
        `  pnpm --filter @workspace/scripts run github-sync "${commitMessage}" --confirm-deletions`,
    );
    process.exit(1);
  }

  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    console.log("✓ Nothing to sync — all local files match GitHub HEAD.");
    process.exit(0);
  }

  if (deletedFiles.length > 0) {
    console.log(`\nFiles to delete from GitHub (${deletedFiles.length}):`);
    deletedFiles.forEach((f) => console.log(`  - ${f}`));
  }

  // Require an explicit --confirm-deletions flag before writing any sha:null
  // entries into the Git tree (#310). Without it, perform a dry-run for
  // the deletion set and exit non-zero so the caller can review the list
  // before deliberately removing files from main. Additions and modifications
  // are also withheld in dry-run mode so the commit is not split across two runs.
  if (deletedFiles.length > 0 && !confirmDeletions) {
    console.log(
      `\n⚠️  DRY RUN — the deletions listed above were NOT pushed.` +
        `\nTo apply them, re-run with --confirm-deletions:` +
        `\n  pnpm --filter @workspace/scripts run github-sync "${commitMessage}" --confirm-deletions` +
        `\nAdditions/modifications (${changedFiles.length} file(s)) were also withheld to keep the commit atomic.`,
    );
    process.exit(1);
  }

  // Hard abort: refuse to push any file that could carry live session cookies,
  // credentials, household PII, or private operational runbooks. This is a
  // defence-in-depth check — these files should already be excluded by
  // EXCLUDED_EXACT, EXCLUDED_PREFIXES, and the RUNBOOK* basename guard in
  // isExcluded(), but an explicit abort here catches any future path that
  // accidentally bypasses those lists.
  const FORBIDDEN_PATTERNS = [
    // Playwright session state — may contain live browser session cookies
    /smoke-auth\.json$/i,
    /storageState\.json$/i,
    /playwright-auth/i,
    // One-off provisioning scripts — commonly contain hardcoded household
    // email addresses, passwords, or other PII. These scripts are fine to keep
    // locally for ops use but must never appear in the public repo.
    /(?:^|[/\\])add-users?\./i,
    /(?:^|[/\\])seed-users?\./i,
    /(?:^|[/\\])create-accounts?\./i,
    /(?:^|[/\\])provision-users?\./i,
    /(?:^|[/\\])bootstrap-users?\./i,
    // Private operational runbook — must live in .local/, never in the public repo.
    // Catches RUNBOOK.md, RUNBOOK-v2.md, RUNBOOK.secrets.md, etc. at any depth.
    /(?:^|\/)RUNBOOK/,
  ];
  const forbidden = changedFiles.filter((f) =>
    FORBIDDEN_PATTERNS.some((re) => re.test(f)),
  );
  if (forbidden.length > 0) {
    console.error(
      `\n🚫 ABORTED: refusing to push credential-bearing or PII-risk files:\n` +
        forbidden.map((f) => `  ${f}`).join("\n") +
        `\nFor session files: add to EXCLUDED_EXACT in github-sync.ts and re-run.` +
        `\nFor provisioning scripts (add-users, seed-users, etc.): delete or rename the file.`,
    );
    process.exit(1);
  }

  console.log(`\nChanged files (${changedFiles.length}):`);
  changedFiles.forEach((f) => console.log(`  ${f}`));

  // Run prettier --write on text files before creating blobs.
  // Use spawnSync with an argument array instead of execSync + string
  // interpolation so that file paths containing spaces or shell-special
  // characters cannot be interpreted as extra shell commands (#309).
  const prettierTargets = changedFiles.filter((f) =>
    /\.(ts|tsx|js|jsx|json|yaml|yml|md|css)$/.test(f),
  );
  if (prettierTargets.length > 0) {
    console.log("\nRunning prettier --write on changed files...");
    spawnSync(
      "npx",
      ["prettier", "--write", ...prettierTargets, "--log-level", "warn"],
      { cwd: root, stdio: "inherit" },
    );
    console.log("Prettier done.");
  }

  console.log(
    `\nBase commit: ${headSha.slice(0, 8)}, tree: ${headCommit.tree.sha.slice(0, 8)}`,
  );

  // Create all blobs, deduplicating by content SHA to avoid redundant API calls
  // (e.g. 3 artifacts with identical stub files only need 1 blob upload each)
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const uploadedByLocalSha = new Map<string, string>(); // localSha -> ghBlobSha
  const treeEntries: {
    path: string;
    mode: string;
    type: string;
    sha: string | null;
  }[] = [];
  for (const filePath of changedFiles) {
    const localSha = localBlobSha(path.join(root, filePath));
    let ghBlobSha: string;
    if (uploadedByLocalSha.has(localSha)) {
      ghBlobSha = uploadedByLocalSha.get(localSha)!;
      console.log(
        `  blob ${path.basename(filePath)}: ${ghBlobSha.slice(0, 8)} (deduped)`,
      );
    } else {
      await sleep(80); // stay under GitHub secondary rate limit
      const content = fs
        .readFileSync(path.join(root, filePath))
        .toString("base64");
      const blob = await gh<{ sha: string }>("POST", "/git/blobs", {
        content,
        encoding: "base64",
      });
      ghBlobSha = blob.sha;
      uploadedByLocalSha.set(localSha, ghBlobSha);
      console.log(
        `  blob ${path.basename(filePath)}: ${ghBlobSha.slice(0, 8)}`,
      );
    }
    treeEntries.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: ghBlobSha,
    });
  }

  // Add null-sha deletion entries for files removed locally.
  // sha: null tells the Git Data API to remove those paths from the new tree.
  for (const filePath of deletedFiles) {
    console.log(`  delete ${filePath}`);
    treeEntries.push({
      path: filePath,
      mode: "100644",
      type: "blob",
      sha: null,
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
