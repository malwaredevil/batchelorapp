import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".vite",
  "mockup-sandbox",
]);

// Raw fetch('/api/...') / fetch(`/api/...`) calls in frontend artifact source
// are drift: they bypass the generated api-client-react hooks and skip the
// shared base-path handling. This is a plain string/regex scan (no AST), so
// it is intentionally conservative: it only flags a `fetch(` call whose
// argument starts with a string/template literal containing `/api/`.
const RAW_FETCH_RE = /\bfetch\s*\(\s*[`'"][^`'"]*\/api\//;

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

function findArtifactSrcDirs(): string[] {
  const srcDirs: string[] = [];
  for (const entry of readdirSync(ARTIFACTS_DIR)) {
    // api-server is a backend artifact and legitimately has no /api/* frontend
    // fetch concerns; mockup-sandbox is dev-only tooling. Both are skipped.
    if (entry === "api-server" || entry === "mockup-sandbox") continue;
    const srcDir = join(ARTIFACTS_DIR, entry, "src");
    try {
      if (statSync(srcDir).isDirectory()) srcDirs.push(srcDir);
    } catch {
      // no src dir for this artifact, skip
    }
  }
  return srcDirs;
}

function main() {
  const violations: { file: string; line: number; text: string }[] = [];

  for (const srcDir of findArtifactSrcDirs()) {
    for (const file of walk(srcDir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (RAW_FETCH_RE.test(line)) {
          violations.push({
            file: relative(REPO_ROOT, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }
  }

  if (violations.length > 0) {
    console.error(
      "\n✖ Found raw fetch('/api/...') call(s) in frontend artifact source.\n" +
        "  These bypass the generated @workspace/api-client-react hooks (Orval codegen)\n" +
        "  and skip shared base-path handling. Use the generated hooks instead.\n",
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(
      `\n${violations.length} violation(s). See replit.md / lib/api-client-react for the generated-hooks convention.\n`,
    );
    process.exit(1);
  }

  console.log("✓ No raw fetch('/api/...') calls found in frontend artifacts.");
}

main();
