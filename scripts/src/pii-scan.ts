#!/usr/bin/env tsx
/**
 * pii-scan.ts — CI guard against household PII entering the public GitHub repo.
 *
 * Scans every file that github-sync.ts would push (i.e. everything in the repo
 * EXCEPT the paths listed in EXCLUDED_PATHS below) for email address patterns.
 * Any email whose domain is not in SAFE_DOMAINS is reported as a potential PII
 * leak and causes a non-zero exit.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run pii-scan
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// scripts/src → scripts → workspace root (two levels up)
const REPO_ROOT = path.resolve(__dirname, "../..");

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/g;

// Domains that are safe to appear in committed code. Keep this list minimal —
// only add a domain when there is a legitimate structural reason for it (system
// addresses, package registries, doc domains, etc.), never just to suppress a
// real email from a household member.
const SAFE_DOMAINS = new Set([
  // Our own app system addresses (elaine@, noreply@, etc.)
  "app.batchelor.app",
  "batchelor.app",
  // Email infrastructure
  "resend.com",
  "sendgrid.com",
  "mailgun.com",
  // Standard placeholder / test domains (RFC 2606) and common test suffixes
  "example.com",
  "example.org",
  "example.net",
  "example.co.uk",
  "test.com",
  "test.org",
  "test.local",
  "localhost",
  // Package registries and tooling
  "npmjs.org",
  "npmjs.com",
  "github.com",
  "github.io",
  "githubusercontent.com",
  "actions.github.com",
  // Monitoring / observability
  "sentry.io",
  // Auth providers
  "googleapis.com",
  "google.com",
  "accounts.google.com",
  // Google Calendar IDs use @group.calendar.google.com — not real email addresses
  "group.calendar.google.com",
  // CI / workflow
  "noreply.github.com",
  // Prompt example strings (in Elaine tool descriptions, test fixtures etc.)
  "clinic.com",
  "domain.com",
  // RFC 6761 reserved TLDs used in tests
  "example.test",
]);

// Paths excluded from scanning — mirrors the exclusions in github-sync.ts.
// These directories may contain agent working files, private ops notes, or
// dev tooling that is intentionally NOT synced to the public repo.
const EXCLUDED_PATH_PREFIXES = [
  ".local/",
  ".agents/",
  ".git/",
  // pnpm local module store and metadata cache (Replit-specific, not in repo)
  "node_modules/",
  ".pnpm-store/",
  ".cache/",
  "dist/",
  "coverage/",
  ".tsbuildinfo",
  "playwright-report",
  ".replit",
  "replit.nix",
  ".replitignore",
  ".upm/",
  "threat_model.md",
  // Generated / build output directories in each artifact
  "artifacts/api-server/dist/",
  "artifacts/modules/dist/",
  "artifacts/web/dist/",
  "artifacts/elaine/dist/",
  // Apify actors have their own node_modules trees (not part of main workspace)
  "apify-actors/",
  // Uploaded workspace assets — excluded from GitHub sync, may contain secrets
  "attached_assets/",
  // pnpm lockfile — contains open-source contributor emails from package.json
  // metadata; these are public contributor info, not household PII
  "pnpm-lock.yaml",
  // Dev test fixtures — internal test helpers not shipped to production
  "scripts/test-fixtures/",
];

// Skip files larger than this (binary or generated files we can't usefully scan)
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB

// File extensions to scan (text-based source files).
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".sh",
  ".env.example",
  ".toml",
  ".sql",
]);

function isExcluded(relPath: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) =>
      relPath === prefix.replace(/\/$/, "") || relPath.startsWith(prefix),
  );
}

// Suffixes that identify test/spec files. These are excluded because they
// conventionally use synthetic mock data (fake addresses, fixture payloads)
// and are not production source files where real PII could accidentally land.
const TEST_SUFFIXES = [".test.ts", ".test.js", ".spec.ts", ".spec.js"];

function shouldScanFile(relPath: string): boolean {
  if (isExcluded(relPath)) return false;
  // Skip test/spec files — they use synthetic mock data by convention.
  if (TEST_SUFFIXES.some((s) => relPath.endsWith(s))) return false;
  const ext = path.extname(relPath).toLowerCase();
  return SCANNED_EXTENSIONS.has(ext);
}

interface Finding {
  file: string;
  line: number;
  email: string;
  domain: string;
}

function scanFile(absPath: string, relPath: string): Finding[] {
  let content: string;
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE_BYTES) return [];
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    EMAIL_RE.lastIndex = 0;
    while ((match = EMAIL_RE.exec(line)) !== null) {
      const email = match[0];
      const domain = match[1].toLowerCase();
      if (!SAFE_DOMAINS.has(domain)) {
        findings.push({ file: relPath, line: i + 1, email, domain });
      }
    }
  }
  return findings;
}

function walkDir(dir: string, relBase: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Never follow symlinks — pnpm virtual store creates deeply nested
    // symlink trees under node_modules/.pnpm that cause infinite traversal.
    if (entry.isSymbolicLink()) continue;
    // Skip node_modules at any depth (nested actors, sub-packages, etc.)
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

function main(): void {
  const files: string[] = [];
  walkDir(REPO_ROOT, "", files);

  const allFindings: Finding[] = [];
  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel);
    allFindings.push(...scanFile(abs, rel));
  }

  if (allFindings.length === 0) {
    console.log(`pii-scan: OK — scanned ${files.length} files, no findings.`);
    process.exit(0);
  }

  console.error(
    `\npii-scan: FAIL — found ${allFindings.length} potential PII email(s) in ${files.length} scanned files:\n`,
  );
  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line}  ${f.email}`);
  }
  console.error(
    "\nIf an email is a system address (e.g. elaine@app.batchelor.app), add its",
    "domain to SAFE_DOMAINS in scripts/src/pii-scan.ts.",
    "Otherwise, remove the email from the file before committing.",
  );
  process.exit(1);
}

main();
