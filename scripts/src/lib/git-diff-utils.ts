/**
 * git-diff-utils.ts
 *
 * Shared git-diff plumbing for diff-scoped guardrail checks (the
 * `--base origin/main` pattern used by check-guardrails.ts,
 * check-hardcoded-config.ts, and check-duplicate-code.ts).
 *
 * This module exists because three checks independently carried byte-for-byte
 * identical copies of `repoRoot`/`git`/`refResolves`/`resolveBase`/
 * `readFileOrNull`/`getChangedFiles` — the exact "copy a helper and rename
 * nothing" pattern the composition-and-configuration rule in AGENTS.md bans.
 * Any new diff-scoped check should import from here instead of re-copying
 * this block.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

export function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 128,
    });
  } catch (error) {
    const err = error as { stdout?: string };
    if (typeof err.stdout === "string") return err.stdout;
    throw error;
  }
}

export function refResolves(root: string, ref: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

// This repo's CI checkout (actions/checkout) always creates a remote named
// "origin", but the live Replit workspace's git-to-GitHub connection is a
// remote named "github" instead — "origin" does not exist there. Without
// this fallback, every local run would silently diff against nothing (see
// below) even though a real, resolvable upstream ref is available.
//
// Fallbacks are tried in order. In a Replit task-agent workspace the actual
// merge target is the parent repl's main (`main-repl/main`), which can be
// content-AHEAD-of or BEHIND `github/main` (GitHub-side-only merges never
// sync back automatically — see .agents/memory/github-dependabot-sync-back-gap.md).
// Diffing against `github/main` in that situation makes content guards (e.g.
// the restricted-exclusion shrink check) report phantom regressions that no
// local commit introduced, so the true merge target must win when present.
const LOCAL_BASE_FALLBACK: Record<string, readonly string[]> = {
  "origin/main": ["main-repl/main", "github/main"],
};

/**
 * `git diff base...HEAD` silently succeeds with empty output if `base` can't
 * be resolved at all (unknown ref) — which would make a diff-scoped check
 * falsely report "no violations" instead of failing loudly. Resolve to a
 * real ref (falling back to this environment's actual upstream remote when
 * the CI-only default isn't present), or fail loudly if nothing resolves.
 */
export function resolveBase(root: string, base: string): string {
  if (refResolves(root, base)) return base;
  const fallbacks = LOCAL_BASE_FALLBACK[base] ?? [];
  for (const fallback of fallbacks) {
    if (refResolves(root, fallback)) {
      console.error(
        `(note: "${base}" not found in this checkout — diffing against "${fallback}" instead)`,
      );
      return fallback;
    }
  }
  throw new Error(
    `Cannot resolve base ref "${base}"${fallbacks.length > 0 ? ` (or fallback(s) ${fallbacks.map((f) => `"${f}"`).join(", ")})` : ""} — ` +
      `no such branch/remote in this checkout, so the diff would silently be empty and ` +
      `this check would falsely report "no violations" instead of actually checking ` +
      `anything. In CI this ref is "origin/main" (created by actions/checkout). Locally, ` +
      `pass a --base that actually exists in this checkout, or fetch the missing ref.`,
  );
}

export function readFileOrNull(root: string, file: string): string | null {
  try {
    return fs.readFileSync(`${root}/${file}`, "utf8");
  } catch {
    return null;
  }
}

/** Files changed between `resolveBase(root, base)` and HEAD, repo-relative paths. */
export function getChangedFiles(root: string, resolvedBase: string): string[] {
  return git(root, ["diff", "--name-only", `${resolvedBase}...HEAD`])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const AUDIT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".cache",
]);

/** Recursively list files under `dir` with one of `extensions` (e.g. [".ts", ".tsx"]). */
export function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  function walk(current: string) {
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (AUDIT_SKIP_DIRS.has(entry)) continue;
      const full = `${current}/${entry}`;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.endsWith(ext)))
        results.push(full);
    }
  }
  walk(dir);
  return results;
}
