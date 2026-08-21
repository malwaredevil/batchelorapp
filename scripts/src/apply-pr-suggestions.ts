/**
 * apply-pr-suggestions.ts
 *
 * Finds bot-authored PR review comments that carry a ```suggestion fenced
 * block (Copilot code review, Copilot Autofix for CodeQL, etc.), applies any
 * that can be safely resolved automatically, and pushes them as a follow-up
 * commit onto the SAME open sync/… PR branch (never a new branch/PR).
 *
 * Why this exists: GitHub's "Commit suggestion" button in the PR UI just
 * creates a commit that swaps in the suggested text at a known line range —
 * there is nothing UI-only about the underlying operation. We can read the
 * same information from the "list review comments" API and apply it via the
 * Git Data API, the same mechanism github-sync.ts already uses.
 *
 * Safety rules:
 * - Only comments from a GitHub App bot account (user.type === "Bot") are
 *   considered. Human-authored suggestions are always left for manual review.
 * - Only comments with a resolvable position (line/start_line not null, side
 *   "RIGHT" or absent) are considered. An "outdated" comment (position
 *   fields null because later commits touched those lines) is left for
 *   manual review rather than guessed at.
 * - Overlapping suggestion ranges within the same file are never applied —
 *   both are surfaced as manual-review items instead of risking a corrupted
 *   merge of two edits.
 * - A suggestion whose target lines already match its replacement text is
 *   treated as already-applied and silently skipped (makes repeated polling
 *   during a CI wait idempotent — no-op re-runs never create empty commits).
 * - This script always narrates: every commit it makes and every suggestion
 *   it could not safely apply is printed for the caller to relay to the user.
 *   It never merges the PR itself — that stays a separate, explicit step
 *   after CI re-confirms green on the new commit.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run apply-pr-suggestions [--branch <sync/…>] [--pr <n>] [--dry-run]
 *
 *   With no --branch/--pr, the most recently opened `sync/…` PR is used.
 *
 * Requires:
 *   GH_PAT — GitHub personal access token with repo read/write access.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  REPO,
  gh,
  findOpenSyncPr,
  findPrByBranch,
  findPrByNumber,
} from "./gh-pr-lookup.js";

const TOKEN = process.env["GH_PAT"];

// ── Types ────────────────────────────────────────────────────────────────

export interface ReviewComment {
  id: number;
  commit_id: string;
  path: string;
  body: string;
  line: number | null;
  start_line: number | null;
  side: "LEFT" | "RIGHT" | null;
  user: { login: string; type: string };
  html_url: string;
}

export interface SuggestionEdit {
  path: string;
  startLine: number; // 1-indexed, inclusive
  endLine: number; // 1-indexed, inclusive
  replacementLines: string[];
  commentUrl: string;
  commentId: number;
  author: string;
}

// ── Pure logic (unit-testable) ──────────────────────────────────────────

/**
 * Extracts the replacement lines from a ```suggestion fenced block in a
 * review comment body. Returns null if no suggestion block is present.
 * Only the first suggestion block in a comment is honoured — GitHub itself
 * only ever renders one "Commit suggestion" affordance per comment.
 */
export function extractSuggestionLines(body: string): string[] | null {
  const match = /```suggestion\r?\n([\s\S]*?)```/.exec(body);
  if (!match) return null;
  const raw = match[1] ?? "";
  // Split on newlines; drop a single trailing empty line produced by the
  // fence's own newline before the closing ```` ``` ````. An intentionally
  // blank final line in the suggestion (rare) would need two trailing
  // newlines, which this preserves.
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** True only for GitHub App bot accounts — never a human reviewer. */
export function isBotComment(comment: ReviewComment): boolean {
  return comment.user?.type === "Bot";
}

/**
 * True when the comment's diff position is still resolvable: not outdated
 * (line/start_line null happens when later commits changed those lines
 * beyond recognition) and anchored to the new/current side of the diff.
 */
export function hasResolvablePosition(comment: ReviewComment): boolean {
  if (comment.line == null) return false;
  if (comment.side != null && comment.side !== "RIGHT") return false;
  return true;
}

/**
 * Combines the eligibility checks and suggestion extraction into a single
 * SuggestionEdit, or null if the comment is not a safely-applicable bot
 * suggestion.
 */
export function commentToEdit(comment: ReviewComment): SuggestionEdit | null {
  if (!isBotComment(comment)) return null;
  if (!hasResolvablePosition(comment)) return null;
  const replacementLines = extractSuggestionLines(comment.body);
  if (replacementLines == null) return null;
  const endLine = comment.line as number;
  const startLine = comment.start_line ?? endLine;
  if (startLine > endLine) return null; // malformed, refuse to guess
  return {
    path: comment.path,
    startLine,
    endLine,
    replacementLines,
    commentUrl: comment.html_url,
    commentId: comment.id,
    author: comment.user.login,
  };
}

export interface PlanResult {
  /** Edits safe to apply, per file, sorted descending by startLine. */
  applicable: Map<string, SuggestionEdit[]>;
  /** Edits whose range overlaps a sibling edit in the same file. */
  conflicts: SuggestionEdit[];
}

/**
 * Groups edits by file and drops any pair whose [startLine, endLine] ranges
 * overlap — applying both could corrupt one or both fixes, so overlapping
 * edits are always surfaced for manual review instead of guessed at.
 */
export function planEdits(edits: SuggestionEdit[]): PlanResult {
  const byFile = new Map<string, SuggestionEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.path) ?? [];
    list.push(edit);
    byFile.set(edit.path, list);
  }

  const applicable = new Map<string, SuggestionEdit[]>();
  const conflicts: SuggestionEdit[] = [];

  for (const [file, fileEdits] of byFile) {
    const sorted = [...fileEdits].sort((a, b) => a.startLine - b.startLine);
    const clean: SuggestionEdit[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!;
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const overlapsPrev = prev != null && current.startLine <= prev.endLine;
      const overlapsNext = next != null && next.startLine <= current.endLine;
      if (overlapsPrev || overlapsNext) {
        conflicts.push(current);
      } else {
        clean.push(current);
      }
    }
    if (clean.length > 0) {
      // Apply from the bottom of the file up so earlier (lower-numbered)
      // edits keep valid line numbers even if a later edit changes the
      // file's total line count.
      applicable.set(
        file,
        clean.sort((a, b) => b.startLine - a.startLine),
      );
    }
  }

  return { applicable, conflicts };
}

/** True when the target range already reads exactly as the suggestion. */
export function isAlreadyApplied(
  lines: string[],
  edit: SuggestionEdit,
): boolean {
  const current = lines.slice(edit.startLine - 1, edit.endLine);
  if (current.length !== edit.replacementLines.length) return false;
  return current.every((line, i) => line === edit.replacementLines[i]);
}

/**
 * Applies a descending-sorted, non-overlapping list of edits to a file's
 * lines. Returns the new lines and the subset of edits that were actually
 * no-ops (target already matched the suggestion) so the caller can report
 * accurately without creating an empty commit.
 */
export function applyEdits(
  lines: string[],
  editsDescending: SuggestionEdit[],
): { newLines: string[]; applied: SuggestionEdit[]; noop: SuggestionEdit[] } {
  let result = [...lines];
  const applied: SuggestionEdit[] = [];
  const noop: SuggestionEdit[] = [];
  for (const edit of editsDescending) {
    if (isAlreadyApplied(result, edit)) {
      noop.push(edit);
      continue;
    }
    result = [
      ...result.slice(0, edit.startLine - 1),
      ...edit.replacementLines,
      ...result.slice(edit.endLine),
    ];
    applied.push(edit);
  }
  return { newLines: result, applied, noop };
}

// ── IO (network + filesystem) ───────────────────────────────────────────
// gh() and the PR-lookup helpers (findOpenSyncPr/findPrByBranch/
// findPrByNumber) live in ./gh-pr-lookup.ts, shared with promote-pr-ready.ts.

async function fetchAllReviewComments(
  prNumber: number,
): Promise<ReviewComment[]> {
  const all: ReviewComment[] = [];
  let page = 1;
  for (;;) {
    const batch = await gh<ReviewComment[]>(
      "GET",
      `/repos/${REPO}/pulls/${prNumber}/comments?per_page=100&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

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

  const pr = explicitPr
    ? await findPrByNumber(explicitPr)
    : explicitBranch
      ? await findPrByBranch(explicitBranch)
      : await findOpenSyncPr();

  console.log(
    `Checking PR #${pr.number} (${pr.head.ref}) for bot suggestions...`,
  );

  const currentHeadSha = pr.head.sha;
  const comments = await fetchAllReviewComments(pr.number);
  // Only consider comments anchored to the current PR head commit — stale
  // suggestion blocks from earlier commits can still have resolvable positions
  // if nothing later touched those lines, but applying them risks reintroducing
  // a superseded suggestion that a subsequent push was meant to replace.
  const headComments = comments.filter((c) => c.commit_id === currentHeadSha);
  const botSuggestionComments = headComments.filter(isBotComment);
  console.log(
    `${comments.length} review comment(s) total, ${headComments.length} on current head (${currentHeadSha.slice(0, 8)}), ${botSuggestionComments.length} from bot accounts.`,
  );

  const edits: SuggestionEdit[] = [];
  const unresolvable: ReviewComment[] = [];
  for (const c of botSuggestionComments) {
    const edit = commentToEdit(c);
    if (edit) edits.push(edit);
    else if (extractSuggestionLines(c.body) != null) unresolvable.push(c);
    // Bot comments with no suggestion block at all (e.g. a plain code-review
    // remark) are silently ignored — nothing to apply, nothing to flag.
  }

  if (edits.length === 0 && unresolvable.length === 0) {
    console.log("No bot suggestions found. Nothing to do.");
    return;
  }

  const { applicable, conflicts } = planEdits(edits);
  const root = path.resolve(import.meta.dirname, "../..");

  const touchedFiles: string[] = [];
  const appliedReport: SuggestionEdit[] = [];
  const noopReport: SuggestionEdit[] = [];

  for (const [file, fileEdits] of applicable) {
    const abs = path.resolve(root, file);
    // Path-containment check: refuse to touch anything outside the repo
    // root, since `file` originates from a (bot-authored, but still
    // externally-supplied) PR review comment's `path` field.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      conflicts.push(...fileEdits);
      continue;
    }
    // No existsSync pre-check: read the file and treat a missing/unreadable
    // file as "gone locally" via the catch, so there is no separate
    // check-then-act step on the same path before the later write below
    // (avoids a TOCTOU race between checking and writing the same file).
    let original: string[];
    try {
      original = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    } catch {
      conflicts.push(...fileEdits); // file gone locally — can't be applied
      continue;
    }
    const { newLines, applied, noop } = applyEdits(original, fileEdits);
    noopReport.push(...noop);
    if (applied.length === 0) continue; // everything was already applied
    appliedReport.push(...applied);
    if (!dryRun) {
      fs.writeFileSync(abs, newLines.join("\n"));
      touchedFiles.push(file);
    }
  }

  // ── Narration ────────────────────────────────────────────────────────
  if (noopReport.length > 0) {
    console.log(
      `\n${noopReport.length} suggestion(s) already match the current code (no-op, likely already committed):`,
    );
    noopReport.forEach((e) =>
      console.log(`  ${e.path}:${e.startLine} — ${e.commentUrl}`),
    );
  }

  if (appliedReport.length > 0) {
    console.log(
      `\n${dryRun ? "[dry-run] Would apply" : "Applying"} ${appliedReport.length} suggestion(s):`,
    );
    appliedReport.forEach((e) =>
      console.log(
        `  ${e.path}:${e.startLine}-${e.endLine} (from @${e.author}) — ${e.commentUrl}`,
      ),
    );
  }

  if (conflicts.length > 0 || unresolvable.length > 0) {
    console.log(
      `\n⚠️  ${conflicts.length + unresolvable.length} suggestion(s) need MANUAL review ` +
        `(overlapping ranges or outdated position) — click "Commit suggestion" on these yourself:`,
    );
    conflicts.forEach((e) =>
      console.log(
        `  [overlap] ${e.path}:${e.startLine}-${e.endLine} — ${e.commentUrl}`,
      ),
    );
    unresolvable.forEach((c) =>
      console.log(`  [outdated/unresolvable] ${c.path} — ${c.html_url}`),
    );
  }

  if (appliedReport.length === 0) {
    console.log("\nNothing new to push.");
    return;
  }

  if (dryRun) {
    console.log(
      "\n[dry-run] Not pushing — re-run without --dry-run to commit.",
    );
    return;
  }

  // Format touched files the same way github-sync.ts does before committing.
  const prettierTargets = touchedFiles.filter((f) =>
    /\.(ts|tsx|js|jsx|json|yaml|yml|md|css)$/.test(f),
  );
  if (prettierTargets.length > 0) {
    spawnSync(
      "npx",
      ["prettier", "--write", ...prettierTargets, "--log-level", "warn"],
      { cwd: root, stdio: "inherit" },
    );
  }

  // ── Push a follow-up commit onto the SAME PR branch ─────────────────
  const ref = await gh<{ object: { sha: string } }>(
    "GET",
    `/repos/${REPO}/git/ref/heads/${pr.head.ref}`,
  );
  const headSha = ref.object.sha;
  const headCommit = await gh<{ tree: { sha: string } }>(
    "GET",
    `/repos/${REPO}/git/commits/${headSha}`,
  );

  const treeEntries = touchedFiles.map((file) => ({
    path: file,
    mode: "100644",
    type: "blob",
    content: fs.readFileSync(path.join(root, file), "utf8"),
  }));

  const tree = await gh<{ sha: string }>("POST", `/repos/${REPO}/git/trees`, {
    base_tree: headCommit.tree.sha,
    tree: treeEntries,
  });

  const commitMessage =
    `chore: apply ${appliedReport.length} bot suggestion(s) from PR review comments\n\n` +
    appliedReport
      .map((e) => `- ${e.path}:${e.startLine}-${e.endLine} (@${e.author})`)
      .join("\n");

  const commit = await gh<{ sha: string }>(
    "POST",
    `/repos/${REPO}/git/commits`,
    { message: commitMessage, tree: tree.sha, parents: [headSha] },
  );

  await gh("PATCH", `/repos/${REPO}/git/refs/heads/${pr.head.ref}`, {
    sha: commit.sha,
    force: false,
  });

  console.log(
    `\n✓ Pushed follow-up commit ${commit.sha.slice(0, 8)} to ${pr.head.ref}.`,
  );
  console.log(
    `  CI has reset for the new commit — re-run check-ci-status before merging.`,
  );
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith("apply-pr-suggestions.ts") ||
    process.argv[1].endsWith("apply-pr-suggestions.js"))
) {
  main().catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
