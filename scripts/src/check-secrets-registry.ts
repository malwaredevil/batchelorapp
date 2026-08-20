#!/usr/bin/env tsx
/**
 * check-secrets-registry.ts — secrets-registry drift guard
 *
 * Compares the env vars referenced in `artifacts/api-server/src/lib/env.ts`
 * against the SECRETS registry in `scripts/src/sync-github-secrets.ts`.
 *
 * Any key that env.ts reads from process.env but that is absent from the
 * SECRETS registry (and not in the intentional exclusion set) is flagged:
 *
 *   - Required keys (required() / devOrRequired() prod name) → ERROR (exit 1)
 *   - Optional keys (optional()) → WARNING (exit 0, but printed so it's visible)
 *
 * WHY: The sync script is the source-of-truth for which secrets get backed up
 * to GitHub Actions.  If a new secret is added to env.ts without a matching
 * SECRETS entry, GitHub CI will silently run without it — the app may deploy
 * fine locally but break in CI or in a fresh clone.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-secrets-registry
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/src → scripts → workspace root
const REPO_ROOT = path.resolve(__dirname, "../..");

export const ENV_TS_PATH = path.join(
  REPO_ROOT,
  "artifacts/api-server/src/lib/env.ts",
);
export const SYNC_TS_PATH = path.join(
  REPO_ROOT,
  "scripts/src/sync-github-secrets.ts",
);

// ---------------------------------------------------------------------------
// Keys intentionally excluded from the SECRETS registry
//
// This list mirrors the "Excluded" comment block at the top of
// sync-github-secrets.ts.  Keeping it in one place here means the lint check
// won't flag them as missing.
// ---------------------------------------------------------------------------
export const INTENTIONALLY_EXCLUDED = new Set<string>([
  // Plain env vars (not Replit secrets) used for dev automation only
  // (DEV_SCREENSHOT_TOKEN migrated to a real Replit Secret 2026-08-03 — it's
  // now tracked in the SECRETS registry below, not excluded here.)
  "AGENT_LOGIN_EMAIL",
  "AGENT_LOGIN_PASSWORD",
  // Replit built-in / platform-injected — not Replit Secrets
  "REPLIT_DEPLOYMENT",
  "REPLIT_DOMAINS",
  "NODE_ENV",
  // Per-environment variants of secrets: only the prod variant is backed up
  // to GitHub.  The dev variant is intentionally not synced because it only
  // needs to be set in the Replit workspace; GitHub CI uses prod secrets.
  "RESEND_WEBHOOK_SECRET_DEV",
  // Dev-only Supabase overrides (workspace-local; not pushed to GitHub CI)
  "DEV_SUPABASE_URL",
  "DEV_SUPABASE_SERVICE_ROLE_KEY",
  // Non-secret public config values (not credentials)
  "PUBLIC_APP_URL",
  // Optional runtime-only integrations. GitHub Actions does not call the
  // Sentry server API or GIPHY, while production reads these from Replit
  // Secrets when the corresponding feature is enabled.
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG_SLUG",
  "SENTRY_PROJECT_SLUG",
  "GIPHY_API_KEY",
  // Replit built-in pooler env vars (auto-provisioned per workspace)
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
]);

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Given `src` and a position `openPos` pointing at a `(`, returns the index
 * of the matching `)`, correctly skipping string literals and nested parens.
 * Returns -1 if no matching paren is found.
 */
export function findMatchingParen(src: string, openPos: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openPos; i < src.length; i++) {
    const ch = src[i];
    if (inStr !== null) {
      if (ch === "\\") {
        i++;
        continue;
      } // skip escaped char
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extracts all UPPER_SNAKE_CASE string literals (both `"` and `'` quoted)
 * from an arbitrary substring of source.  Used to find env var names inside
 * the body of a function call's argument list regardless of how complex the
 * expression is (ternaries, logical OR chains, etc.).
 *
 * Only matches names that look like env var names: start with a capital letter
 * followed by at least two more uppercase-letter/digit/underscore characters.
 */
export function extractEnvLiterals(callBody: string): string[] {
  const names: string[] = [];
  const STR_RE = /["']([A-Z][A-Z0-9_]{2,})["']/g;
  let m: RegExpExecArray | null;
  while ((m = STR_RE.exec(callBody)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Parse env.ts — extract every env var name referenced via the helper fns
// ---------------------------------------------------------------------------

export interface EnvKey {
  name: string;
  /** True when the key appears as an argument to required() or as the prod
   *  name in devOrRequired().  False for optional() arguments. */
  required: boolean;
}

/**
 * Parses `src` (the contents of env.ts) and returns every env var key it
 * references, along with whether each key is required or optional.
 *
 * Handles:
 *   required("KEY")
 *   optional("KEY")
 *   devOrRequired("DEV_KEY", "PROD_KEY")
 *   optional(expr ? "KEY_A" : "KEY_B")   ← ternary inside optional()
 *   process.env["KEY"] / process.env.KEY  ← direct access
 *
 * For `devOrRequired`, the prod name (second arg) is required; the dev name
 * (first arg) is optional.  For `optional(ternary)`, ALL string literals
 * found in the arg body are extracted as optional keys.
 */
export function parseEnvTs(src: string): EnvKey[] {
  const keys: EnvKey[] = [];
  const seen = new Set<string>();

  function add(name: string, req: boolean) {
    if (!seen.has(name)) {
      seen.add(name);
      keys.push({ name, required: req });
    }
  }

  /** Finds all `funcName(...)` calls in src and returns the inner body of each. */
  function extractCallBodies(funcName: string): string[] {
    const bodies: string[] = [];
    const FUNC_RE = new RegExp(`\\b${funcName}\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = FUNC_RE.exec(src)) !== null) {
      const openPos = m.index + m[0].length - 1; // index of `(`
      const closePos = findMatchingParen(src, openPos);
      if (closePos === -1) continue;
      bodies.push(src.slice(openPos + 1, closePos));
    }
    return bodies;
  }

  // ── required("KEY") ───────────────────────────────────────────────────────
  for (const body of extractCallBodies("required")) {
    for (const name of extractEnvLiterals(body)) {
      add(name, true);
    }
  }

  // ── devOrRequired("DEV_KEY", "PROD_KEY") ──────────────────────────────────
  // Re-extract these call bodies to classify dev vs prod correctly.
  // The first literal in the body is the dev key (optional); the second is the
  // prod key (required).  We override the required() results already recorded
  // above for the dev key, but since `seen` is keyed by name-only we just
  // let the first-seen classification win — and we call add() only when a key
  // hasn't been seen yet.  devOrRequired() is always a simple two-literal
  // call so the order is reliable.
  for (const body of extractCallBodies("devOrRequired")) {
    const literals = extractEnvLiterals(body);
    if (literals.length >= 1) add(literals[0]!, false); // dev name — optional
    if (literals.length >= 2) add(literals[1]!, true); // prod name — required
  }

  // ── optional("KEY") or optional(ternary ? "KEY_A" : "KEY_B") ─────────────
  for (const body of extractCallBodies("optional")) {
    for (const name of extractEnvLiterals(body)) {
      add(name, false);
    }
  }

  // ── process.env["KEY"] or process.env.KEY (direct access) ─────────────────
  const DIRECT_RE =
    /process\.env(?:\[(?:'([^']+)'|"([^"]+)")\]|\.([A-Z_][A-Z0-9_]*))/g;
  let dm: RegExpExecArray | null;
  while ((dm = DIRECT_RE.exec(src)) !== null) {
    const name = dm[1] ?? dm[2] ?? dm[3]!;
    if (/^[A-Z][A-Z0-9_]+$/.test(name)) {
      add(name, false); // direct access — treat as optional unless already seen
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Parse sync-github-secrets.ts — extract names scoped to the SECRETS array
// ---------------------------------------------------------------------------

/**
 * Parses `src` (the contents of sync-github-secrets.ts) and returns the set
 * of secret names declared in the `const SECRETS` array.
 *
 * Extraction is intentionally scoped to the SECRETS array declaration so that
 * `name:` properties in unrelated objects (e.g. a hypothetical helper) cannot
 * falsely satisfy the guard.
 */
export function parseSyncTs(src: string): Set<string> {
  const names = new Set<string>();

  // Find the start of `const SECRETS` declaration
  const SECRETS_DECL_RE = /\bconst\s+SECRETS\b[^=]*=/;
  const declMatch = SECRETS_DECL_RE.exec(src);
  if (!declMatch) return names; // no SECRETS array found

  // The declaration is followed by whitespace + `[` — find the opening bracket
  const afterDecl = src.slice(declMatch.index + declMatch[0].length);
  const bracketOffset = afterDecl.indexOf("[");
  if (bracketOffset === -1) return names;

  const openBracketAbsPos =
    declMatch.index + declMatch[0].length + bracketOffset;

  // Find the matching `]` using depth tracking (handles nested objects/arrays)
  let depth = 0;
  let inStr: string | null = null;
  let closeBracketPos = -1;
  for (let i = openBracketAbsPos; i < src.length; i++) {
    const ch = src[i];
    if (inStr !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        closeBracketPos = i;
        break;
      }
    }
  }

  const secretsBlock =
    closeBracketPos !== -1
      ? src.slice(openBracketAbsPos, closeBracketPos + 1)
      : src.slice(openBracketAbsPos);

  // Extract `name: "KEY"` or `name: 'KEY'` within the block
  const NAME_RE = /\bname:\s*(?:'([^']+)'|"([^"]+)")/g;
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(secretsBlock)) !== null) {
    names.add(m[1] ?? m[2]!);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Drift check — callable by both the CLI and the test suite
// ---------------------------------------------------------------------------

export interface DriftResult {
  missingRequired: string[];
  missingOptional: string[];
}

export function checkDrift(envSrc: string, syncSrc: string): DriftResult {
  const envKeys = parseEnvTs(envSrc);
  const registryNames = parseSyncTs(syncSrc);

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const { name, required } of envKeys) {
    if (registryNames.has(name)) continue;
    if (INTENTIONALLY_EXCLUDED.has(name)) continue;
    if (required) {
      missingRequired.push(name);
    } else {
      missingOptional.push(name);
    }
  }

  return { missingRequired, missingOptional };
}

// ---------------------------------------------------------------------------
// CLI entrypoint (only runs when executed directly, not when imported)
// ---------------------------------------------------------------------------

// Detect whether this module is being run directly (not imported by tests)
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1] === __filename ||
    process.argv[1].endsWith("/check-secrets-registry.ts") ||
    process.argv[1].endsWith("/check-secrets-registry.js"));

if (isMain) {
  const envSrc = fs.readFileSync(ENV_TS_PATH, "utf8");
  const syncSrc = fs.readFileSync(SYNC_TS_PATH, "utf8");
  const { missingRequired, missingOptional } = checkDrift(envSrc, syncSrc);

  const relEnv = path.relative(REPO_ROOT, ENV_TS_PATH);
  const relSync = path.relative(REPO_ROOT, SYNC_TS_PATH);

  if (missingOptional.length > 0) {
    console.warn(
      `\n⚠  ${missingOptional.length} optional env var(s) in ${relEnv} are absent from the SECRETS registry (${relSync}):\n`,
    );
    for (const name of missingOptional) {
      console.warn(
        `   ⊘  ${name}  [optional — add to SECRETS to back it up to GitHub CI]`,
      );
    }
    console.warn(
      `\n   Add each missing key to the SECRETS array in ${relSync},`,
    );
    console.warn(
      `   or add it to INTENTIONALLY_EXCLUDED in check-secrets-registry.ts if it should never be synced.\n`,
    );
  }

  if (missingRequired.length > 0) {
    console.error(
      `\n✗  ${missingRequired.length} REQUIRED env var(s) in ${relEnv} are absent from the SECRETS registry (${relSync}):\n`,
    );
    for (const name of missingRequired) {
      console.error(
        `   ✗  ${name}  [REQUIRED — must be in SECRETS or GitHub CI will break]`,
      );
    }
    console.error(
      `\n   Add each missing key to the SECRETS array in ${relSync},`,
    );
    console.error(
      `   or add it to INTENTIONALLY_EXCLUDED in check-secrets-registry.ts if it is not a real secret.\n`,
    );
    process.exit(1);
  }

  if (missingRequired.length === 0 && missingOptional.length === 0) {
    const total = parseEnvTs(envSrc).filter(
      (k) => !INTENTIONALLY_EXCLUDED.has(k.name),
    ).length;
    console.log(
      `✓ Secrets registry is in sync with env.ts (${total} key(s) verified, ${INTENTIONALLY_EXCLUDED.size} intentionally excluded).`,
    );
  }
}
