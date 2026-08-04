#!/usr/bin/env tsx
/**
 * check-stale-overrides.ts — stale security-override detector
 *
 * Reads the security overrides in pnpm-workspace.yaml (identified by inline
 * # CVE or # GHSA comments) and cross-checks each one against the resolved
 * version in pnpm-lock.yaml.
 *
 * If a package's resolved version is strictly greater than the override's
 * minimum floor, the parent dependency has already bumped past the patched
 * version, so the override may now be redundant.  The check prints a warning
 * for each such entry so a maintainer can investigate and potentially clean it
 * up.
 *
 * The check is intentionally non-blocking (always exits 0).  It is purely
 * informational — a stale override is harmless, just noisy.
 *
 * No network calls.  Parses pnpm-lock.yaml directly.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-stale-overrides
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Semver helpers (no external dep)
// ---------------------------------------------------------------------------

/** Parse a "MAJOR.MINOR.PATCH" string into a numeric 3-tuple. */
function parseSemver(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Returns true when `candidate` is strictly greater than `floor`.
 * Both must be valid semver triples; if either can't be parsed the function
 * returns false (safe default: don't emit a spurious warning).
 */
function gtSemver(candidate: string, floor: string): boolean {
  const c = parseSemver(candidate);
  const f = parseSemver(floor);
  if (!c || !f) return false;
  if (c[0] !== f[0]) return c[0] > f[0];
  if (c[1] !== f[1]) return c[1] > f[1];
  return c[2] > f[2];
}

// ---------------------------------------------------------------------------
// Override parsing
// ---------------------------------------------------------------------------

interface SecurityOverride {
  /** Raw key from pnpm-workspace.yaml, e.g. "dompurify" or "brace-expansion@^1" */
  key: string;
  /** Package name without the version-scope suffix */
  packageName: string;
  /**
   * Major version scope if the key contains "@^N" or "@N", e.g. 1 for
   * "brace-expansion@^1".  Null for simple package names.
   */
  majorScope: number | null;
  /** Minimum patched version extracted from the specifier */
  floor: string;
  /** The full specifier string, e.g. ">=3.4.12 <4" */
  specifier: string;
  /** The inline comment text (after the #) */
  comment: string;
}

/** Extract the minimum version string from a pnpm override specifier. */
function extractFloor(specifier: string): string | null {
  // >=X.Y.Z variants — capture the first version number after >=
  const gte = />=\s*(\d+\.\d+(?:\.\d+)?)/.exec(specifier);
  if (gte) return gte[1].includes(".") && gte[1].split(".").length === 2
    ? `${gte[1]}.0`
    : gte[1];

  // ^X.Y.Z — the floor is X.Y.Z
  const caret = /^\^(\d+\.\d+(?:\.\d+)?)$/.exec(specifier.trim());
  if (caret) return caret[1].includes(".") && caret[1].split(".").length === 2
    ? `${caret[1]}.0`
    : caret[1];

  // Exact version like "4.3.0"
  const exact = /^(\d+\.\d+\.\d+)$/.exec(specifier.trim());
  if (exact) return exact[1];

  return null;
}

/**
 * Parse pnpm-workspace.yaml raw text and return every override entry that has
 * an inline # CVE or # GHSA comment.
 */
export function parseSecurityOverrides(workspaceYaml: string): SecurityOverride[] {
  const results: SecurityOverride[] = [];
  const lines = workspaceYaml.split("\n");
  let inOverrides = false;

  for (const line of lines) {
    // Detect entry into / exit from the overrides block
    if (/^overrides\s*:/.test(line)) {
      inOverrides = true;
      continue;
    }
    if (inOverrides && /^[a-zA-Z]/.test(line) && !/^\s/.test(line) && !line.startsWith("overrides")) {
      // A new top-level key — we've left the overrides block
      inOverrides = false;
    }
    if (!inOverrides) continue;

    // Match a line like:  pkgName: ">=1.2.3 <4" # CVE-...
    // The key may contain @, >, ^, quotes etc.
    const m = /^\s+"?([^:"]+)"?\s*:\s*["']?([^#"'\n]+?)["']?\s*#\s*(.+)$/.exec(line);
    if (!m) continue;

    const rawKey = m[1].trim();
    const rawSpecifier = m[2].trim();
    const comment = m[3].trim();

    // Only care about CVE / GHSA annotations
    if (!/\b(CVE|GHSA)\b/i.test(comment)) continue;

    const floor = extractFloor(rawSpecifier);
    if (!floor) continue;

    // Parse the key: "brace-expansion@^1" → pkg="brace-expansion", major=1
    const scopeMatch = /^(.+?)@\^?(\d+)$/.exec(rawKey);
    const packageName = scopeMatch ? scopeMatch[1] : rawKey;
    const majorScope = scopeMatch ? parseInt(scopeMatch[2], 10) : null;

    results.push({
      key: rawKey,
      packageName,
      majorScope,
      floor,
      specifier: rawSpecifier,
      comment,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lockfile parsing
// ---------------------------------------------------------------------------

interface ResolvedEntry {
  packageName: string;
  version: string;
}

/**
 * Scan pnpm-lock.yaml for all "packageName@version:" snapshot keys and return
 * the unique set of resolved {packageName, version} pairs.
 *
 * The lockfile v9 format has entries like:
 *   dompurify@3.4.12:
 *   'brace-expansion@1.1.18':
 *   'fast-uri@3.1.5(@ajv@8.17.1)':
 */
export function parseResolvedVersions(lockfileText: string): ResolvedEntry[] {
  const seen = new Set<string>();
  const results: ResolvedEntry[] = [];

  // Match lines that look like snapshot / package keys:
  //   ^  packageName@version:
  //   ^  'packageName@version':
  //   ^  'packageName@version(...)':   ← peer-dep suffix
  const RE = /^  '?(@?[^@'\s(]+)@(\d+\.\d+\.\d+)[^':\s]*'?\s*:/gm;
  let match: RegExpExecArray | null;

  while ((match = RE.exec(lockfileText)) !== null) {
    const packageName = match[1];
    const version = match[2];
    const key = `${packageName}@${version}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ packageName, version });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check logic
// ---------------------------------------------------------------------------

interface CheckResult {
  override: SecurityOverride;
  resolvedVersions: string[];
  /** True when every resolved version is at the exact floor (override is active) */
  allAtFloor: boolean;
  /** Versions strictly above the floor — override may be redundant for these */
  aboveFloor: string[];
  /** True when no version of this package is present in the lockfile at all */
  notInstalled: boolean;
}

export function checkOverrides(
  overrides: SecurityOverride[],
  resolved: ResolvedEntry[],
): CheckResult[] {
  return overrides.map((override) => {
    const candidates = resolved.filter((r) => {
      if (r.packageName !== override.packageName) return false;
      if (override.majorScope !== null) {
        const [major] = parseSemver(r.version) ?? [null];
        return major === override.majorScope;
      }
      return true;
    });

    const versions = [...new Set(candidates.map((c) => c.version))];
    const aboveFloor = versions.filter((v) => gtSemver(v, override.floor));

    return {
      override,
      resolvedVersions: versions,
      allAtFloor: versions.length > 0 && aboveFloor.length === 0,
      aboveFloor,
      notInstalled: versions.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const workspacePath = path.join(REPO_ROOT, "pnpm-workspace.yaml");
  const lockfilePath = path.join(REPO_ROOT, "pnpm-lock.yaml");

  if (!fs.existsSync(workspacePath)) {
    console.error(`check-stale-overrides: cannot find ${workspacePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(lockfilePath)) {
    console.error(`check-stale-overrides: cannot find ${lockfilePath}`);
    process.exit(1);
  }

  const workspaceYaml = fs.readFileSync(workspacePath, "utf8");
  const lockfileText = fs.readFileSync(lockfilePath, "utf8");

  const overrides = parseSecurityOverrides(workspaceYaml);
  const resolved = parseResolvedVersions(lockfileText);
  const results = checkOverrides(overrides, resolved);

  const warnings: CheckResult[] = [];
  const active: CheckResult[] = [];
  const absent: CheckResult[] = [];

  for (const r of results) {
    if (r.notInstalled) {
      absent.push(r);
    } else if (r.aboveFloor.length > 0) {
      warnings.push(r);
    } else {
      active.push(r);
    }
  }

  console.log(
    `check-stale-overrides: scanned ${overrides.length} security override(s) against pnpm-lock.yaml\n`,
  );

  if (active.length > 0) {
    console.log("✓ Active overrides (resolved version equals the patched floor):");
    for (const r of active) {
      const versions = r.resolvedVersions.join(", ");
      console.log(
        `    ${r.override.key.padEnd(30)} floor=${r.override.floor}  resolved=${versions}`,
      );
    }
    console.log();
  }

  if (absent.length > 0) {
    console.log(
      "⚠  Not installed (package not present in lockfile — override may be removable):",
    );
    for (const r of absent) {
      console.log(
        `    ${r.override.key.padEnd(30)} floor=${r.override.floor}  # ${r.override.comment}`,
      );
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(
      "⚠  Potentially redundant overrides (resolved version is strictly above the floor):",
    );
    console.log(
      "   The parent dependency may already pull in a patched version on its own.",
    );
    console.log(
      "   To verify: temporarily remove the override, run `pnpm install`, and check\n" +
      "   that `pnpm audit` still reports no high-severity advisories.\n",
    );
    for (const r of warnings) {
      const above = r.aboveFloor.join(", ");
      console.log(
        `    ${r.override.key.padEnd(30)} floor=${r.override.floor}  resolved=${above}  # ${r.override.comment}`,
      );
    }
    console.log();
  }

  const totalWarnings = warnings.length + absent.length;
  if (totalWarnings === 0) {
    console.log(
      "✓ All security overrides are actively needed — no stale entries detected.",
    );
  } else {
    console.log(
      `Suggestion: ${totalWarnings} override(s) above may be removable. ` +
      "Review each one before removing to confirm the parent now provides the patched version.",
    );
  }

  // Always exits 0 — this is an informational/advisory check only.
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
