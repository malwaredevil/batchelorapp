import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".vite",
  "mockup-sandbox",
  "apify-actors",
  ".cache",
  "migrations",
]);

// Matches `new Pool(` or `new Client(` from the "pg" package.
// These are only allowed in the canonical singleton (lib/db/src/index.ts),
// the one-shot CLI bootstrap (lib/db/src/bootstrap.ts), and the scripts
// package (scripts/src/), which are all short-lived one-off tools that never
// run inside the API server. Any other file creating a Pool or Client bypasses
// the shared singleton and risks exhausting Supabase connection slots.
const PG_CTOR_RE = /\bnew\s+(?:Pool|Client)\s*\(/;

// Paths (relative to REPO_ROOT) that are explicitly allowed to create a Pool
// or Client directly. Use forward slashes; matching is done on the relative
// path string after normalising to forward slashes.
const ALLOWED_RELATIVE_PATHS = new Set([
  "lib/db/src/index.ts", // canonical singleton — the only runtime pool
  "lib/db/src/bootstrap.ts", // one-shot CLI entrypoint, never imported by server
]);

// Directory prefixes (relative to REPO_ROOT) where every file is allowed.
// These are utility scripts that connect directly for one-off operations.
const ALLOWED_DIR_PREFIXES = ["scripts/src/"];

function isAllowed(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (ALLOWED_RELATIVE_PATHS.has(normalized)) return true;
  return ALLOWED_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (SCAN_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(fullPath);
    }
  }
  return files;
}

function dirsToScan(): string[] {
  // Scan all first-party source — lib/ and artifacts/. Scripts are allowed by
  // the prefix allowlist above so they can be scanned without false positives.
  return [join(REPO_ROOT, "lib"), join(REPO_ROOT, "artifacts")];
}

function main() {
  const violations: { file: string; line: number; text: string }[] = [];

  for (const scanDir of dirsToScan()) {
    let files: string[];
    try {
      files = walk(scanDir);
    } catch {
      continue;
    }

    for (const file of files) {
      const relPath = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (isAllowed(relPath)) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (!PG_CTOR_RE.test(line)) return;
        // Allow an explicit override comment on the same line or the adjacent
        // lines (Prettier may reflow a constructor call across lines).
        const window = [lines[idx - 1] ?? "", line, lines[idx + 1] ?? ""];
        if (window.some((l) => l.includes("// pg-singleton-ok"))) return;
        violations.push({ file: relPath, line: idx + 1, text: line.trim() });
      });
    }
  }

  if (violations.length > 0) {
    console.error(
      "\n✖ Found new pg.Pool() / new pg.Client() outside the allowed singleton files.\n" +
        "  The app must use a single shared Pool from lib/db/src/index.ts to avoid\n" +
        "  exhausting Supabase connection slots. Route handlers and middleware must\n" +
        "  import { pool, db } from '@workspace/db'.\n" +
        "\n" +
        "  Allowed files:\n" +
        "    lib/db/src/index.ts  (canonical singleton)\n" +
        "    lib/db/src/bootstrap.ts  (one-shot CLI bootstrap)\n" +
        "    scripts/src/*  (one-off utility scripts, never imported by server)\n" +
        "\n" +
        "  If this is a legitimate exception, add a '// pg-singleton-ok' comment\n" +
        "  on the same or adjacent line and document why a separate pool is needed.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(`\n${violations.length} violation(s) found.\n`);
    process.exit(1);
  }

  console.log(
    "✓ pg Pool/Client singleton check passed — no rogue pool constructors found.",
  );
}

main();
