/**
 * cleanup-app-config-defaults
 * ────────────────────────────
 * Statically scans the API server source to find APP_CONFIG_DEFAULTS entries
 * that have no matching `getConfig()` call site.  These are stale defaults
 * that show up as noise in the admin Control Panel but serve no purpose.
 *
 * Usage (dry-run — report only):
 *   pnpm --filter @workspace/scripts run cleanup-app-config-defaults
 *
 * Usage (write — patch app-config.ts in place):
 *   pnpm --filter @workspace/scripts run cleanup-app-config-defaults -- --write
 *
 * The script exits non-zero when stale entries are found in dry-run mode, and
 * zero (after patching) in --write mode.  This makes it usable as a CI gate.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_SERVER_SRC = path.resolve(
  __dirname,
  "../../artifacts/api-server/src",
);
const APP_CONFIG_PATH = path.join(API_SERVER_SRC, "lib/app-config.ts");

// ── Marker comment / skip logic (mirrors app-config-drift.test.ts) ──────────

const SKIP_MARKER = "app-config-skip";

function commentOf(line: string): string {
  let inString: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.slice(i);
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      return end === -1 ? line.slice(i) : line.slice(i, end + 2);
    }
  }
  return "";
}

function extractCallText(
  lines: string[],
  start: number,
): { text: string; hasSkip: boolean } {
  const firstLine = lines[start];
  const callStart = firstLine.indexOf("getConfig(");
  if (callStart === -1) {
    const window = lines.slice(start, start + 5);
    return {
      text: window.join(" ").replace(/\s+/g, " "),
      hasSkip: window.some((l) => l.includes(SKIP_MARKER)),
    };
  }

  let depth = 0;
  let inString: string | null = null;
  const chunks: string[] = [];
  let hasSkip = false;

  for (let i = start; i < lines.length && i < start + 200; i++) {
    if (commentOf(lines[i]).includes(SKIP_MARKER)) hasSkip = true;
    const segment = i === start ? lines[i].slice(callStart) : lines[i];

    for (let j = 0; j < segment.length; j++) {
      const ch = segment[j];
      if (inString !== null) {
        if (ch === "\\") {
          j++;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          chunks.push(segment.slice(0, j + 1));
          return { text: chunks.join(" ").replace(/\s+/g, " "), hasSkip };
        }
      }
    }
    chunks.push(segment);
  }

  return { text: chunks.join(" ").replace(/\s+/g, " "), hasSkip };
}

const CALL_RE =
  /getConfig\(\s*(['"])(?<module>[^'"]+)\1\s*,\s*(['"])(?<key>[^'"]+)\3/g;
const ANY_CALL_RE = /getConfig\(/g;
const DECL_RE = /function\s+getConfig\s*\(/;

// ── Collect source files ─────────────────────────────────────────────────────

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

// ── Extract used keys ────────────────────────────────────────────────────────

function extractUsedKeys(srcDir: string): Set<string> {
  const used = new Set<string>();

  for (const file of collectSourceFiles(srcDir)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentOf(line).includes(SKIP_MARKER)) continue;
      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;

      const { text, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;

      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(text)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        used.add(`${module}::${key}`);
      }
    }
  }

  return used;
}

// ── Parse APP_CONFIG_DEFAULTS from source ────────────────────────────────────
//
// We don't import it at runtime (to avoid pulling in the full @workspace/db
// dependency graph), so we extract it with a simple scanner over the raw source.
//
// The array has the shape:  APP_CONFIG_DEFAULTS: AppConfigDefault[] = [ {...}, {...} ]
// Depth tracking (both [] and {}):
//   depth 0  → outside array literal
//   depth 1  → inside the outer array   [ ... ]   (opened by [)
//   depth 2  → inside an entry object   { ... }   (opened by {)

interface DefaultEntry {
  module: string;
  key: string;
  label: string;
}

function parseDefaults(source: string): DefaultEntry[] {
  const declStart = source.indexOf("export const APP_CONFIG_DEFAULTS");
  if (declStart === -1)
    throw new Error("Could not find APP_CONFIG_DEFAULTS in app-config.ts");

  // Skip past the type annotation to the actual `= [` assignment operator so
  // the `[]` in `AppConfigDefault[]` is not mistaken for the array literal.
  const assignIdx = source.indexOf("= [", declStart);
  if (assignIdx === -1)
    throw new Error("Could not find `= [` assignment for APP_CONFIG_DEFAULTS");
  const arrayStart = assignIdx + 2; // point at the opening `[`

  const entries: DefaultEntry[] = [];
  let depth = 0;
  let inString: string | null = null;
  let objStart = -1;

  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];

    if (inString !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "[" || ch === "{") {
      depth++;
      if (ch === "{" && depth === 2) objStart = i; // entry object begins
    } else if (ch === "]" || ch === "}") {
      if (ch === "}" && depth === 2 && objStart !== -1) {
        const obj = source.slice(objStart, i + 1);
        const mod = /module\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
        const key = /\bkey\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
        const label = /label\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
        if (mod && key && label) entries.push({ module: mod, key, label });
        objStart = -1;
      }
      depth--;
      if (depth === 0) break; // end of outermost bracket (array)
    }
  }

  return entries;
}

// ── Patch app-config.ts ──────────────────────────────────────────────────────
//
// Removes the object literal block for each stale entry from the
// APP_CONFIG_DEFAULTS array in-place.  Same depth tracking as parseDefaults.

function removeDefaultEntries(source: string, staleKeys: Set<string>): string {
  const declStart = source.indexOf("export const APP_CONFIG_DEFAULTS");
  const assignIdx = source.indexOf("= [", declStart);
  const arrayStart = assignIdx + 2; // point at the opening `[`

  let depth = 0;
  let inString: string | null = null;
  let objStart = -1;
  let objStartLine = -1;

  const removals: Array<{ start: number; end: number }> = [];

  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i];

    if (inString !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "[" || ch === "{") {
      depth++;
      if (ch === "{" && depth === 2) {
        objStart = i;
        // Walk back to start of the line to capture leading whitespace
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;
        objStartLine = lineStart;
      }
    } else if (ch === "]" || ch === "}") {
      if (ch === "}" && depth === 2 && objStart !== -1) {
        const obj = source.slice(objStart, i + 1);
        const mod = /module\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];
        const key = /\bkey\s*:\s*["']([^"']+)["']/.exec(obj)?.[1];

        if (mod && key && staleKeys.has(`${mod}::${key}`)) {
          // Include the trailing comma + optional newline after the closing brace
          let end = i + 1;
          while (end < source.length && source[end] === ",") end++;
          while (end < source.length && source[end] === "\n") end++;
          removals.push({ start: objStartLine, end });
        }

        objStart = -1;
        objStartLine = -1;
      }
      depth--;
      if (depth === 0) break;
    }
  }

  // Apply removals from last to first so character indices stay valid
  let result = source;
  for (const { start, end } of removals.reverse()) {
    result = result.slice(0, start) + result.slice(end);
  }

  // Remove orphaned module-section comments left behind after removals
  result = cleanOrphanedSectionComments(result);

  return result;
}

/**
 * After removing entry objects, a module-section comment like
 *   // ── ornaments ─────────────────────────────────────────────────────────
 * may be left dangling with no entries beneath it.  This pass removes those.
 */
function cleanOrphanedSectionComments(source: string): string {
  const SECTION_RE = /^\s*\/\/ ── [^\n]+/;
  const lines = source.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (SECTION_RE.test(lines[i])) {
      // Peek ahead past blank lines to find the next non-blank line
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const nextNonBlank = lines[j] ?? "";
      if (/^\s*\/\/ ── /.test(nextNonBlank) || /^\s*\];/.test(nextNonBlank)) {
        // Skip this orphaned comment and any blank lines that follow it
        while (i + 1 < lines.length && lines[i + 1].trim() === "") i++;
        continue;
      }
    }
    out.push(lines[i]);
  }

  return out.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

const writeMode = process.argv.includes("--write");

const sourceText = fs.readFileSync(APP_CONFIG_PATH, "utf8");
const defaults = parseDefaults(sourceText);
const usedKeys = extractUsedKeys(API_SERVER_SRC);

const stale = defaults.filter((d) => !usedKeys.has(`${d.module}::${d.key}`));

if (stale.length === 0) {
  console.log("✓ No stale APP_CONFIG_DEFAULTS entries found.");
  process.exit(0);
}

console.log(
  `${stale.length} stale APP_CONFIG_DEFAULTS entr${stale.length === 1 ? "y" : "ies"} found:\n`,
);
for (const d of stale) {
  console.log(`  module="${d.module}"  key="${d.key}"  (${d.label})`);
}

if (!writeMode) {
  console.log(
    "\nTo remove these automatically, re-run with --write:\n" +
      "  pnpm --filter @workspace/scripts run cleanup-app-config-defaults -- --write\n" +
      "\nOr remove them manually from:\n" +
      `  ${APP_CONFIG_PATH}`,
  );
  process.exit(1);
}

// --write mode: patch app-config.ts in place
const staleKeys = new Set(stale.map((d) => `${d.module}::${d.key}`));
const patched = removeDefaultEntries(sourceText, staleKeys);

fs.writeFileSync(APP_CONFIG_PATH, patched, "utf8");
console.log(
  `\n✓ Removed ${stale.length} stale entr${stale.length === 1 ? "y" : "ies"} from:\n  ${APP_CONFIG_PATH}`,
);
console.log(
  "\nRemember to re-run the drift guard to confirm the fix:\n" +
    "  pnpm --filter @workspace/api-server run lint:config",
);
process.exit(0);
