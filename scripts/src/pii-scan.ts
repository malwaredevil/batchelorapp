#!/usr/bin/env tsx
/**
 * pii-scan.ts — CI guard against household PII entering the public GitHub repo.
 *
 * Scans every file that github-sync.ts would push (i.e. everything in the repo
 * EXCEPT the paths listed in EXCLUDED_PATHS below) for:
 *   1. Email address patterns — any email whose domain is not in SAFE_DOMAINS.
 *   2. Phone number patterns — any E.164 number not in SAFE_PHONE_NUMBERS, PLUS
 *      a literal-string check for any phone numbers stored in known env vars
 *      (AGENTPHONE_PHONE_NUMBER, etc.) so a provisioned household number that
 *      accidentally lands in source code is caught before reaching GitHub.
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

// E.164 phone number pattern: + followed by 1–3 digit country code and up to 12
// more digits (total 7–15 digits after the +).  We require at least 7 significant
// digits so single-digit test values like "+1" are not flagged.
const PHONE_E164_RE = /\+[1-9]\d{6,14}/g;

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

// Phone numbers that are safe to appear in committed code.
// Only add numbers here when there is a clear structural reason:
//   - North-American 555 numbers are fictional placeholders reserved by NANP
//     and safe to use in docs, prompts, and UI placeholder text.
//   - Genuine household numbers must NEVER appear here — the env-var literal
//     check below catches those before they can even reach this safe-list.
const SAFE_PHONE_NUMBERS = new Set([
  // 555 placeholder numbers used in Elaine prompts, UI placeholders, etc.
  "+12105551234",
  "+12025551234",
  "+12125551234",
  "+14155551234",
  "+13105551234",
  // Generic all-zeros / all-ones fixture numbers used in unit tests
  "+10000000000",
  "+11111111111",
  // UK test numbers (Ofcom reserved range 07700 900NNN — safe fictional numbers)
  "+447700900000",
  "+447911123456",
]);

// Env vars whose values represent real household phone numbers. If the env var
// is set at scan time its literal value is checked against every scanned file.
// We never store the number in this script — we only read it at runtime.
const PHONE_NUMBER_ENV_VARS = [
  "AGENTPHONE_PHONE_NUMBER",
  "HOUSEHOLD_PHONE_NUMBER",
  "MY_PHONE_NUMBER",
];

// Env vars whose values represent real household email addresses. If the env var
// is set at scan time its literal value is checked against every scanned file,
// even if the email's domain would otherwise be in SAFE_DOMAINS (e.g. a dev
// login account on a corporate or personal domain that happens to share a safe
// TLD).  We never store the address here — we only read it at runtime.
const EMAIL_ENV_VARS = [
  // Dev/test login credentials — real household member's address
  "AGENT_LOGIN_EMAIL",
];

// Paths excluded from scanning — mirrors the exclusions in github-sync.ts.
// These directories may contain agent working files, private ops notes, or
// dev tooling that is intentionally NOT synced to the public repo.
export const EXCLUDED_PATH_PREFIXES = [
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
export const SCANNED_EXTENSIONS = new Set([
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
  // Check compound extensions first (e.g. ".env.example") before falling back
  // to path.extname, which only returns the last segment and would miss them.
  const basename = path.basename(relPath).toLowerCase();
  const firstDot = basename.indexOf(".");
  if (firstDot !== -1) {
    const compound = basename.slice(firstDot);
    if (SCANNED_EXTENSIONS.has(compound)) return true;
  }
  const ext = path.extname(relPath).toLowerCase();
  return SCANNED_EXTENSIONS.has(ext);
}

interface EmailFinding {
  kind: "email";
  file: string;
  line: number;
  value: string;
  detail: string;
}

interface PhoneFinding {
  kind: "phone";
  file: string;
  line: number;
  value: string;
  detail: string;
}

type Finding = EmailFinding | PhoneFinding;

// Literal household phone numbers read from env at scan time (values never
// hard-coded here — that would defeat the purpose of the check).
function loadHouseholdPhoneNumbers(): string[] {
  const numbers: string[] = [];
  for (const envVar of PHONE_NUMBER_ENV_VARS) {
    const val = process.env[envVar];
    if (val && val.trim()) {
      numbers.push(val.trim());
    }
  }
  return numbers;
}

// Literal household email addresses read from env at scan time (values never
// hard-coded here — that would defeat the purpose of the check).
function loadHouseholdEmails(): string[] {
  const emails: string[] = [];
  for (const envVar of EMAIL_ENV_VARS) {
    const val = process.env[envVar];
    if (val && val.trim()) {
      emails.push(val.trim().toLowerCase());
    }
  }
  return emails;
}

function scanFile(
  absPath: string,
  relPath: string,
  householdPhones: string[],
  householdEmails: string[] = [],
): Finding[] {
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

    // ── Email pass ──────────────────────────────────────────────────────────
    EMAIL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EMAIL_RE.exec(line)) !== null) {
      const email = match[0];
      const domain = match[1].toLowerCase();
      if (!SAFE_DOMAINS.has(domain)) {
        findings.push({
          kind: "email",
          file: relPath,
          line: i + 1,
          value: email,
          detail: `email domain not in SAFE_DOMAINS: ${domain}`,
        });
      }
    }

    // ── Phone pass — E.164 regex ─────────────────────────────────────────────
    PHONE_E164_RE.lastIndex = 0;
    while ((match = PHONE_E164_RE.exec(line)) !== null) {
      const phone = match[0];
      if (!SAFE_PHONE_NUMBERS.has(phone)) {
        findings.push({
          kind: "phone",
          file: relPath,
          line: i + 1,
          value: phone,
          detail: "E.164 phone number not in SAFE_PHONE_NUMBERS",
        });
      }
    }

    // ── Phone pass — env-var literal check ───────────────────────────────────
    for (const knownNumber of householdPhones) {
      if (line.includes(knownNumber)) {
        // Only flag if this wasn't already caught by the regex pass above
        // (avoid duplicate findings on the same number on the same line).
        const alreadyFlagged = findings.some(
          (f) =>
            f.kind === "phone" &&
            f.file === relPath &&
            f.line === i + 1 &&
            f.value === knownNumber,
        );
        if (!alreadyFlagged) {
          findings.push({
            kind: "phone",
            file: relPath,
            line: i + 1,
            value: knownNumber,
            detail: "matches a household phone number from env vars",
          });
        }
      }
    }

    // ── Email pass — env-var literal check ───────────────────────────────────
    // Catches household emails even when their domain is in SAFE_DOMAINS.
    // (e.g. a dev login on a corporate domain that happens to share a safe TLD)
    for (const knownEmail of householdEmails) {
      if (line.toLowerCase().includes(knownEmail)) {
        // Only flag if this wasn't already caught by the domain-based pass above
        // (avoid duplicate findings on the same address on the same line).
        const alreadyFlagged = findings.some(
          (f) =>
            f.kind === "email" &&
            f.file === relPath &&
            f.line === i + 1 &&
            f.value.toLowerCase() === knownEmail,
        );
        if (!alreadyFlagged) {
          findings.push({
            kind: "email",
            file: relPath,
            line: i + 1,
            value: knownEmail,
            detail: "matches a household email address from env vars",
          });
        }
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
  const householdPhones = loadHouseholdPhoneNumbers();
  const householdEmails = loadHouseholdEmails();

  const files: string[] = [];
  walkDir(REPO_ROOT, "", files);

  const allFindings: Finding[] = [];
  for (const rel of files) {
    const abs = path.join(REPO_ROOT, rel);
    allFindings.push(...scanFile(abs, rel, householdPhones, householdEmails));
  }

  const emailFindings = allFindings.filter((f) => f.kind === "email");
  const phoneFindings = allFindings.filter((f) => f.kind === "phone");

  if (allFindings.length === 0) {
    const notes: string[] = [];
    if (householdPhones.length > 0)
      notes.push(
        `${householdPhones.length} household phone literal(s) from env`,
      );
    if (householdEmails.length > 0)
      notes.push(
        `${householdEmails.length} household email literal(s) from env`,
      );
    const phoneNote =
      notes.length > 0
        ? ` (including ${notes.join(", ")})`
        : " (no PHONE_NUMBER/EMAIL env vars set — only regex pass ran)";
    console.log(
      `pii-scan: OK — scanned ${files.length} files, no findings${phoneNote}.`,
    );
    process.exit(0);
  }

  console.error(
    `\npii-scan: FAIL — found ${allFindings.length} potential PII item(s) in ${files.length} scanned files:\n`,
  );

  if (emailFindings.length > 0) {
    console.error(`  EMAIL findings (${emailFindings.length}):`);
    for (const f of emailFindings) {
      console.error(`    ${f.file}:${f.line}  ${f.value}`);
    }
    console.error(
      "\n  If an email is a system address (e.g. elaine@app.batchelor.app), add its",
      "domain to SAFE_DOMAINS in scripts/src/pii-scan.ts.",
      "Otherwise, remove the email from the file before committing.\n",
    );
  }

  if (phoneFindings.length > 0) {
    console.error(`  PHONE findings (${phoneFindings.length}):`);
    for (const f of phoneFindings) {
      console.error(`    ${f.file}:${f.line}  ${f.value}  [${f.detail}]`);
    }
    console.error(
      "\n  If a phone number is a fictional placeholder (e.g. a 555 number), add it",
      "to SAFE_PHONE_NUMBERS in scripts/src/pii-scan.ts.",
      "If it is a real household number, remove it from the file before committing.\n",
    );
  }

  process.exit(1);
}

// Export core scanning primitives so pii-scan.test.ts can exercise them
// directly without spawning a subprocess or touching the real repo tree.
export {
  scanFile,
  shouldScanFile,
  SAFE_DOMAINS,
  SAFE_PHONE_NUMBERS,
  EMAIL_ENV_VARS,
  PHONE_NUMBER_ENV_VARS,
  EMAIL_RE,
  PHONE_E164_RE,
};
export type { Finding, EmailFinding, PhoneFinding };

// Only run as a CLI when executed directly (not when imported by tests).
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main();
}
