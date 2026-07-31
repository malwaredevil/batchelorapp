#!/usr/bin/env tsx
/**
 * check-public-file-secrets.ts — CI guard against credential-like content
 * entering the public GitHub repo.
 *
 * Complements pii-scan.ts (which covers email + phone PII). This scanner
 * covers API keys, tokens, project identifiers, and other secret patterns
 * that should never appear in committed source.
 *
 * File selection: reuses shouldScanFile / EXCLUDED_PATH_PREFIXES from
 * pii-scan.ts so the two scanners always cover the same file set.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-public-file-secrets
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldScanFile, EXCLUDED_PATH_PREFIXES } from "./pii-scan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/src → scripts → workspace root
const REPO_ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// File extension sets
// ---------------------------------------------------------------------------

/** Extensions considered "documentation/config" — patterns that appear
 *  legitimately in TypeScript source (e.g. query param names) are only
 *  checked in these files. */
const DOC_EXTENSIONS = new Set([
  ".md",
  ".sh",
  ".yml",
  ".yaml",
  ".txt",
  ".toml",
]);

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

export interface PatternRule {
  id: string;
  /** String or RegExp to search for. Strings are treated as substring matches. */
  pattern: RegExp | string;
  label: string;
  /**
   * If true, only flag this pattern when it appears in documentation/config
   * files (DOC_EXTENSIONS). Use for strings that appear legitimately in
   * TypeScript/JavaScript source code but should never appear in public docs.
   */
  docOnly?: boolean;
}

export const PATTERNS: PatternRule[] = [
  // ── Known specific project identifiers ──────────────────────────────────────
  {
    id: "supabase-ref",
    pattern: "gadhlfluflknlwgmlmos",
    label:
      "Supabase project reference ID — derive from DATABASE_URL, never hard-code in public files",
  },

  // ── Dev bypass mechanisms ────────────────────────────────────────────────────
  // "screenshotToken" is the query-param name in the dev auth-bypass route and
  // appears legitimately in TypeScript source. Flag it only in public docs where
  // it has no business being.
  {
    id: "screenshot-token",
    pattern: "screenshotToken",
    label:
      "Dev screenshot bypass query param — must not appear in public documentation",
    docOnly: true,
  },

  // ── Commands that embed live data ────────────────────────────────────────────
  {
    id: "sentry-write",
    pattern: /sentry-baseline write \d/,
    label:
      "Sentry baseline write command with live issue IDs — must not be committed",
  },

  // ── JWT tokens ───────────────────────────────────────────────────────────────
  // Supabase anon/service keys are long JWTs. Any JWT longer than ~100 base64url
  // chars is almost certainly a real credential, not a short example token.
  {
    id: "jwt-token",
    pattern: /eyJ[A-Za-z0-9_-]{100,}/,
    label: "JWT token (likely a Supabase anon/service key or OAuth token)",
  },

  // ── API key formats ──────────────────────────────────────────────────────────
  {
    id: "sk-key",
    pattern: /\bsk-(?:or-|proj-)?[A-Za-z0-9]{20,}\b/,
    label: "OpenAI / OpenRouter API key (sk-... prefix)",
  },
  {
    id: "gh-pat",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
    label: "GitHub Personal Access Token (ghp_/gho_/... prefix)",
  },
  {
    id: "gh-pat-fine",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/,
    label: "GitHub fine-grained PAT (github_pat_... prefix)",
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[A-Za-z0-9_-]{35,}\b/,
    label: "Google API key (AIza... prefix)",
  },
  {
    id: "slack-token",
    pattern: /\bxox[bpoa]-[0-9A-Za-z-]{10,}\b/,
    label: "Slack API token (xoxb-/xoxp-/xoxa-/xoxo- prefix)",
  },
  {
    id: "resend-key",
    pattern: /\bre_[A-Za-z0-9]{24,}\b/,
    label: "Resend API key (re_... prefix)",
  },
  {
    id: "google-oauth-client",
    pattern: /\d{10,}-[a-z0-9]{32}\.apps\.googleusercontent\.com/,
    label: "Google OAuth client ID",
  },
];

// ---------------------------------------------------------------------------
// Env-var literal check
// ---------------------------------------------------------------------------

/**
 * Env vars whose literal VALUES must never appear in public source files.
 * We read the values at scan time — they are never stored in this script.
 *
 * Only values longer than MIN_SECRET_LENGTH are checked (short or placeholder
 * values like "changeme" would produce too many false positives).
 */
export const SECRET_ENV_VARS = [
  "SESSION_SECRET",
  "VOYAGE_API_KEY",
  "JINA_API_KEY",
  "AGENTPHONE_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "VAPID_PRIVATE_KEY",
  "REPLICATE_WEBHOOK_SIGNING_SECRET",
  "APIFY_WEBHOOK_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GH_PAT",
];

const MIN_SECRET_LENGTH = 16;

function loadSecretValues(): Array<{ envVar: string; value: string }> {
  return SECRET_ENV_VARS.flatMap((envVar) => {
    const val = process.env[envVar];
    if (val && val.trim().length >= MIN_SECRET_LENGTH) {
      return [{ envVar, value: val.trim() }];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

export interface PatternFinding {
  kind: "pattern";
  file: string;
  line: number;
  patternId: string;
  label: string;
  matchedText: string;
}

export interface SecretValueFinding {
  kind: "secret-value";
  file: string;
  line: number;
  envVar: string;
  label: string;
}

export type SecretFinding = PatternFinding | SecretValueFinding;

// ---------------------------------------------------------------------------
// Self-exclusion: the scanner's own source files contain the pattern strings
// they are designed to detect. Scanning them would produce spurious findings.
// ---------------------------------------------------------------------------

const SCANNER_SELF_FILES = new Set([
  "scripts/src/check-public-file-secrets.ts",
  "scripts/src/check-public-file-secrets.test.ts",
]);

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

export function scanFile(
  absPath: string,
  relPath: string,
  secretValues: Array<{ envVar: string; value: string }>,
): SecretFinding[] {
  // Skip the scanner's own source files (they contain pattern strings by design)
  if (SCANNER_SELF_FILES.has(relPath)) return [];

  let content: string;
  try {
    const stat = fs.statSync(absPath);
    // Skip large files (binary/generated)
    if (stat.size > 512 * 1024) return [];
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const ext = path.extname(relPath).toLowerCase();
  const isDocFile = DOC_EXTENSIONS.has(ext);
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Pattern pass ────────────────────────────────────────────────────────
    for (const rule of PATTERNS) {
      // docOnly patterns are skipped for TypeScript/JavaScript source files
      if (rule.docOnly && !isDocFile) continue;

      let matched: string | null = null;
      if (typeof rule.pattern === "string") {
        if (line.includes(rule.pattern)) matched = rule.pattern;
      } else {
        rule.pattern.lastIndex = 0;
        const m = rule.pattern.exec(line);
        if (m) matched = m[0];
      }

      if (matched !== null) {
        findings.push({
          kind: "pattern",
          file: relPath,
          line: i + 1,
          patternId: rule.id,
          label: rule.label,
          matchedText: matched.slice(0, 60) + (matched.length > 60 ? "…" : ""),
        });
      }
    }

    // ── Env-var literal value pass ────────────────────────────────────────
    for (const { envVar, value } of secretValues) {
      // Enforce minimum length here too — defensive against callers that
      // skip the loadSecretValues filter (e.g. unit tests passing values directly).
      if (value.length < MIN_SECRET_LENGTH) continue;
      if (line.includes(value)) {
        // Avoid double-reporting if a pattern already caught it
        const alreadyFlagged = findings.some(
          (f) =>
            f.kind === "secret-value" &&
            f.file === relPath &&
            f.line === i + 1 &&
            f.envVar === envVar,
        );
        if (!alreadyFlagged) {
          findings.push({
            kind: "secret-value",
            file: relPath,
            line: i + 1,
            envVar,
            label: `Literal value of ${envVar} env var`,
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Directory walk — mirrors pii-scan.ts walkDir (not exported from there)
// ---------------------------------------------------------------------------

function isExcluded(relPath: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) =>
      relPath === prefix.replace(/\/$/, "") || relPath.startsWith(prefix),
  );
}

function walkDir(dir: string, relBase: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (isExcluded(rel) || isExcluded(`${rel}/`)) continue;
    if (entry.isDirectory()) {
      walkDir(path.join(dir, entry.name), rel, out);
    } else if (entry.isFile() && shouldScanFile(rel)) {
      out.push(rel);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const secretValues = loadSecretValues();

  const files: string[] = [];
  walkDir(REPO_ROOT, "", files);

  const allFindings: SecretFinding[] = [];
  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel);
    allFindings.push(...scanFile(abs, rel, secretValues));
  }

  if (allFindings.length === 0) {
    const envNote =
      secretValues.length > 0
        ? ` (including literal-value check for ${secretValues.length} env var(s))`
        : " (no SECRET_ENV_VARS set — only pattern pass ran)";
    console.log(
      `check-public-file-secrets: OK — scanned ${files.length} files, no findings${envNote}.`,
    );
    process.exit(0);
  }

  console.error(
    `\ncheck-public-file-secrets: FAIL — found ${allFindings.length} potential secret(s) in ${files.length} scanned files:\n`,
  );

  for (const f of allFindings) {
    if (f.kind === "pattern") {
      console.error(`  ${f.file}:${f.line}  [${f.patternId}] ${f.label}`);
      if (f.matchedText) {
        console.error(`    matched: ${f.matchedText}`);
      }
    } else {
      console.error(`  ${f.file}:${f.line}  ${f.label}`);
    }
  }

  console.error(`
How to fix:
  • For a false positive (e.g. a fictional example or test fixture reference):
      - If it's a known project identifier like a Supabase ref, move it to
        .local/ (excluded from GitHub) or derive it from env vars instead.
      - If the pattern should never match this context, add a targeted
        exclusion in check-public-file-secrets.ts (PATTERNS docOnly flag or
        a per-pattern allowlist).
  • For a real secret: remove it from the file immediately. If it was ever
    committed, rotate the credential — GitHub's secret scanning may have
    already flagged it.
`);

  process.exit(1);
}

// Export scanning primitives for use by check-public-file-secrets.test.ts
export { walkDir, isExcluded, DOC_EXTENSIONS };

// Only run as CLI when executed directly
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main();
}
