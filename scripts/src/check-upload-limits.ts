#!/usr/bin/env tsx
/**
 * check-upload-limits.ts — guard against direct HIGH_MULTER_FILE_BYTES imports
 *
 * Route and elaine files must call multerLimitForPrefix("/api/their/prefix")
 * instead of importing HIGH_MULTER_FILE_BYTES directly from upload-limits.ts.
 * Importing the constant directly bypasses the HIGH_UPLOAD_PREFIXES registry
 * and silently breaks the single-source-of-truth invariant: the global
 * upload-size guard and the per-route multer cap would no longer be kept in
 * sync by the same list.
 *
 * This script fails if any .ts file under:
 *   artifacts/api-server/src/routes/
 *   artifacts/api-server/src/elaine/
 * contains a named import of HIGH_MULTER_FILE_BYTES (from any module).
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-upload-limits
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const SCANNED_DIRS = [
  path.join(REPO_ROOT, "artifacts/api-server/src/routes"),
  path.join(REPO_ROOT, "artifacts/api-server/src/elaine"),
];

/**
 * Regex that matches a named import containing HIGH_MULTER_FILE_BYTES.
 * Handles both single-name and multi-name import lists, e.g.:
 *   import { HIGH_MULTER_FILE_BYTES } from "..."
 *   import { multerLimitForPrefix, HIGH_MULTER_FILE_BYTES } from "..."
 */
const DIRECT_IMPORT_RE = /\bHIGH_MULTER_FILE_BYTES\b/;

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

const violations: Array<{ file: string; lines: number[] }> = [];

for (const dir of SCANNED_DIRS) {
  for (const file of collectTsFiles(dir)) {
    const content = fs.readFileSync(file, "utf8");
    const matchingLines: number[] = [];
    content.split("\n").forEach((line, idx) => {
      if (DIRECT_IMPORT_RE.test(line)) {
        matchingLines.push(idx + 1);
      }
    });
    if (matchingLines.length > 0) {
      violations.push({
        file: path.relative(REPO_ROOT, file),
        lines: matchingLines,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    "\n\x1b[31m🚫 FAIL: Direct HIGH_MULTER_FILE_BYTES import(s) detected.\x1b[0m",
  );
  console.error(
    '   Route and elaine files must use multerLimitForPrefix("/api/your/prefix")',
  );
  console.error("   instead of importing HIGH_MULTER_FILE_BYTES directly.");
  console.error(
    "   This keeps the global upload-size guard and per-route multer cap in sync.",
  );
  console.error("\n   Offending files:");
  for (const { file, lines } of violations) {
    console.error(
      `     ${file}  (line${lines.length > 1 ? "s" : ""} ${lines.join(", ")})`,
    );
  }
  console.error(
    "\n   Fix: replace the direct import with a call to multerLimitForPrefix(),",
  );
  console.error(
    "   and if the route needs the 20 MB cap, add its prefix to HIGH_UPLOAD_PREFIXES",
  );
  console.error("   in artifacts/api-server/src/lib/upload-limits.ts.");
  process.exit(1);
}

console.log(
  "\x1b[32m✓\x1b[0m Upload-limit check: no direct HIGH_MULTER_FILE_BYTES imports in route/elaine files",
);
