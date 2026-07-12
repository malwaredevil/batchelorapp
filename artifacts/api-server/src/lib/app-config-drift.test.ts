/**
 * Config-key drift guard
 * ──────────────────────
 * This test statically walks every TypeScript source file under `src/` and
 * checks that every `getConfig("module", "key", ...)` call site has a
 * matching entry in APP_CONFIG_DEFAULTS.
 *
 * WHY: APP_CONFIG_DEFAULTS seeds the admin Control Panel on first boot.  If a
 * developer adds a new `getConfig()` call without a matching default row, the
 * key silently falls back to the hardcoded fallback forever — the admin can
 * never override it, and it never appears in the UI.
 *
 * COVERAGE GAP — dynamically-keyed calls:
 *   The static regex can only match calls where BOTH the module name and the
 *   key are plain string literals, e.g.:
 *
 *     getConfig("elaine", "chatModel", fallback)          ← checked ✓
 *     getConfig(MODULE_VAR, "chatModel", fallback)        ← NOT checked ✗
 *     getConfig("elaine", computedKey, fallback)          ← NOT checked ✗
 *
 *   A separate test ("warn on dynamic-arg calls") detects these patterns and
 *   emits a console.warn so a reviewer knows to audit them manually.  It does
 *   NOT fail the suite, because dynamic keys may be intentional (e.g. a shared
 *   helper that wraps getConfig with a variable module name).  Add
 *   // app-config-skip on the call line to silence the warning for a specific
 *   site that has been deliberately reviewed.
 *
 * ESCAPE HATCH:
 *   If a call genuinely should NOT have an APP_CONFIG_DEFAULTS entry (e.g.
 *   a one-off test helper or a future dynamic-key pattern), add an inline
 *   marker comment on the same line:
 *
 *     await getConfig("module", "key", fallback); // app-config-skip
 *
 *   The test will skip that line without failing (and without warning).
 *
 * INTENTIONALLY-HARDCODED SECURITY LIMITS:
 *   Webhook body caps, rate-limit thresholds, and per-request batch-size
 *   safety caps must NOT use getConfig() at all — keep them as plain
 *   TypeScript constants.  They are not subject to this check because they
 *   never call getConfig().  See the comment in app-config.ts for details.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_CONFIG_DEFAULTS } from "./app-config";

// ── Collect source files ────────────────────────────────────────────────────

/** Recursively collect all .ts files under `dir`, excluding test files. */
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

// ── Extract getConfig call sites ────────────────────────────────────────────

interface CallSite {
  file: string;
  line: number;
  module: string;
  key: string;
}

/**
 * Regex matches: getConfig("module", "key"  — handles single or double quotes,
 * optional whitespace.  Dynamic arguments (variables, template literals) are
 * not matched and therefore not checked (by design — they can't be statically
 * inferred).
 */
const CALL_RE =
  /getConfig\(\s*(['"])(?<module>[^'"]+)\1\s*,\s*(['"])(?<key>[^'"]+)\3/g;

/**
 * Captures the first token of the fallback (3rd) argument from a collapsed
 * getConfig() call text.  Both string arg patterns handle backslash escapes.
 * The fallback group captures everything up to the next whitespace, comma, or
 * closing paren — enough to classify the JS type of the literal.
 */
const FALLBACK_EXTRACT_RE =
  /getConfig\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(?<fallback>[^\s,)]+)/;

/**
 * Returns the inferred JS type of a literal fallback token, or "unknown" when
 * the token is a named constant/variable that cannot be classified statically.
 *
 * Rules:
 *   boolean  — exactly `true` or `false`
 *   number   — digit-led literal (allows leading `-`, underscores, one `.`)
 *   string   — starts with `"`, `'`, or a backtick
 *   unknown  — anything else (named constant, variable, expression)
 *
 * Trailing punctuation (`,`, `)`) is stripped before classification, since
 * FALLBACK_EXTRACT_RE's non-greedy stop character may include them.
 */
function classifyFallback(
  rawToken: string,
): "number" | "boolean" | "string" | "unknown" {
  const t = rawToken.replace(/[,);]+$/, "").trim();
  if (t === "true" || t === "false") return "boolean";
  if (/^-?\d[\d_]*(\.\d[\d_]*)?$/.test(t)) return "number";
  if (t.startsWith('"') || t.startsWith("'") || t.startsWith("`"))
    return "string";
  return "unknown";
}

/**
 * Maps a declared APP_CONFIG_DEFAULTS `type` to the JS runtime type that
 * getConfig()'s overload signatures require for the fallback argument.
 */
function expectedFallbackKind(
  declaredType: "string" | "integer" | "float" | "boolean",
): "number" | "boolean" | "string" {
  if (declaredType === "integer" || declaredType === "float") return "number";
  return declaredType;
}

/**
 * Detects any getConfig( invocation on a line regardless of argument shape.
 * Used to find calls that CALL_RE didn't match (i.e. dynamic-arg calls).
 * Excludes function declarations (`function getConfig(` or `async function getConfig(`).
 */
const ANY_CALL_RE = /getConfig\(/g;

/** Matches a function declaration for getConfig itself — not a call site. */
const DECL_RE = /function\s+getConfig\s*\(/;

/** Marker comment that opts a specific call site out of the drift check. */
const SKIP_MARKER = "app-config-skip";

/**
 * Returns the first comment portion of a source line — either a `//` line
 * comment or a block comment (slash-star … star-slash) — correctly skipping
 * any comment-opener sequences that appear inside string literals.
 * Returns an empty string when the line has no comment.
 *
 * This ensures that SKIP_MARKER inside a string argument
 * (e.g. `getConfig("m", "app-config-skip", fb)`) is never mistaken for an
 * intentional skip comment, whether the caller uses line or block comment style.
 */
function commentOf(line: string): string {
  let inString: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString !== null) {
      if (ch === "\\") {
        i++; // skip escaped character
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") {
      return line.slice(i);
    }
    if (ch === "/" && line[i + 1] === "*") {
      // Block comment — return from /* to */ (or to end of line if unclosed)
      const end = line.indexOf("*/", i + 2);
      return end === -1 ? line.slice(i) : line.slice(i, end + 2);
    }
  }
  return "";
}

interface ExtractCallResult {
  /** The call text collapsed to a single space-separated string. */
  text: string;
  /**
   * True if any source line scanned while building `text` (from the opening
   * `getConfig(` line through the matching `)` line) contained the skip marker.
   * This lets a developer place `// app-config-skip` on a later argument line
   * of a multi-line call and still have it respected.
   */
  hasSkip: boolean;
}

/**
 * Extracts the full text of a getConfig( call starting at line `start` using a
 * brace-depth scanner.  It tracks parenthesis depth — correctly skipping parens
 * that appear inside string literals — and stops as soon as the opening `(` of
 * `getConfig(` is balanced by its matching `)`.  The result is collapsed to a
 * single space-separated string so CALL_RE can match across lines regardless of
 * how many source lines the call spans.
 *
 * Also reports whether any of the scanned lines contained the SKIP_MARKER so
 * callers can honour a skip comment placed on a later argument line of a
 * multi-line call (not just on the opening line).
 *
 * This replaces the old fixed-window approach (which only looked ahead 5 lines
 * and would miss calls whose arguments extended beyond that limit).
 */
function extractCallText(lines: string[], start: number): ExtractCallResult {
  const firstLine = lines[start];
  const callStart = firstLine.indexOf("getConfig(");
  if (callStart === -1) {
    // Should not happen (caller already confirmed the line has getConfig(),
    // but guard defensively with a small fallback window.
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

  // Cap at 200 lines to avoid pathological scan in malformed source.
  for (let i = start; i < lines.length && i < start + 200; i++) {
    // Check only the comment portion of each line for the skip marker so that
    // a string argument whose value happens to contain SKIP_MARKER (e.g.
    // getConfig("m", "app-config-skip", fb)) is never mistaken for an
    // intentional skip comment.  commentOf() strips string literals before
    // scanning for //, so only genuine trailing // comments are checked.
    if (commentOf(lines[i]).includes(SKIP_MARKER)) hasSkip = true;

    // On the opening line only include text from getConfig( onward.
    const segment = i === start ? lines[i].slice(callStart) : lines[i];

    for (let j = 0; j < segment.length; j++) {
      const ch = segment[j];

      if (inString !== null) {
        // Inside a string literal: only care about the closing delimiter
        // and backslash escapes.
        if (ch === "\\") {
          j++; // skip the escaped character
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }

      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          // Found the matching close-paren — include it and stop.
          chunks.push(segment.slice(0, j + 1));
          return { text: chunks.join(" ").replace(/\s+/g, " "), hasSkip };
        }
      }
    }

    chunks.push(segment);
  }

  // Fallback: return whatever we collected (handles runaway / unclosed call).
  return { text: chunks.join(" ").replace(/\s+/g, " "), hasSkip };
}

function extractCallSites(srcDir: string): CallSite[] {
  const sites: CallSite[] = [];

  for (const file of collectSourceFiles(srcDir)) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Only check the comment portion for the skip marker — not the full line —
      // so a string arg containing SKIP_MARKER can't trigger a false early-exit.
      if (commentOf(line).includes(SKIP_MARKER)) continue;

      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;

      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(callText)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        sites.push({ file, line: i + 1, module, key });
      }
    }
  }

  return sites;
}

interface DynamicCallSite {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Finds getConfig( call sites where the first or second argument is NOT a
 * plain string literal — i.e. lines that contain `getConfig(` but were NOT
 * matched by CALL_RE even when looking at a window of surrounding lines.
 * These cannot be statically verified against APP_CONFIG_DEFAULTS and must
 * be reviewed manually.
 *
 * Function declarations (`function getConfig(`) are excluded — they are the
 * definition of getConfig itself, not a call site.
 */
function extractDynamicCallSites(srcDir: string): DynamicCallSite[] {
  const sites: DynamicCallSite[] = [];

  for (const file of collectSourceFiles(srcDir)) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Only check the comment portion for the skip marker — not the full line —
      // so a string arg containing SKIP_MARKER can't trigger a false early-exit.
      if (commentOf(line).includes(SKIP_MARKER)) continue;

      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;

      if (DECL_RE.test(line)) continue;

      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;
      CALL_RE.lastIndex = 0;
      if (!CALL_RE.test(callText)) {
        sites.push({ file, line: i + 1, snippet: line.trim() });
      }
    }
  }

  return sites;
}

// ── Build lookup set ────────────────────────────────────────────────────────

const defaultKeys = new Set(
  APP_CONFIG_DEFAULTS.map((d) => `${d.module}::${d.key}`),
);

// ── Tests ───────────────────────────────────────────────────────────────────

const SRC_DIR = path.resolve(__dirname, "..");

describe("app-config drift guard", () => {
  it(
    "every getConfig() call site has a matching APP_CONFIG_DEFAULTS entry",
    { timeout: 30000 },
    () => {
      const sites = extractCallSites(SRC_DIR);

      expect(sites.length).toBeGreaterThan(0); // sanity: we found call sites

      const missing = sites.filter(
        (s) => !defaultKeys.has(`${s.module}::${s.key}`),
      );

      if (missing.length > 0) {
        const report = missing
          .map(
            (s) =>
              `  ${path.relative(SRC_DIR, s.file)}:${s.line}  getConfig("${s.module}", "${s.key}", ...)`,
          )
          .join("\n");

        expect.fail(
          `${missing.length} getConfig() call site(s) have no matching APP_CONFIG_DEFAULTS entry.\n` +
            `Add the missing row(s) to APP_CONFIG_DEFAULTS in src/lib/app-config.ts,\n` +
            `or add  // app-config-skip  on the call line to opt out of this check.\n\n` +
            report,
        );
      }
    },
  );

  it("every APP_CONFIG_DEFAULTS entry is actually used by at least one getConfig() call", () => {
    const sites = extractCallSites(SRC_DIR);
    const usedKeys = new Set(sites.map((s) => `${s.module}::${s.key}`));

    const unused = APP_CONFIG_DEFAULTS.filter(
      (d) => !usedKeys.has(`${d.module}::${d.key}`),
    );

    if (unused.length > 0) {
      const report = unused
        .map((d) => `  module="${d.module}" key="${d.key}"  (${d.label})`)
        .join("\n");

      expect.fail(
        `${unused.length} APP_CONFIG_DEFAULTS entry/entries have no matching getConfig() call.\n` +
          `Either add a call site or remove the stale default from APP_CONFIG_DEFAULTS.\n\n` +
          report,
      );
    }
  });

  it("detects multi-line getConfig() calls where module and key span separate lines", () => {
    // Regression guard for the ai-client.ts pattern:
    //
    //   const timeoutMs = await getConfig(
    //     "openrouter",
    //     "request_timeout_ms",
    //     REQUEST_TIMEOUT_MS_DEFAULT,
    //   );
    //
    // The old single-line regex approach would match nothing here because no
    // single line contains both the module AND the key arguments.
    // extractCallText() collapses the call to one space-separated string so
    // CALL_RE can match across lines regardless of whitespace layout.

    const lines = [
      // Exact same shape as the openrouter call in ai-client.ts:
      `  const timeoutMs = await getConfig(`,
      `    "openrouter",`,
      `    "request_timeout_ms",`,
      `    REQUEST_TIMEOUT_MS_DEFAULT,`,
      `  );`,
      // A second call on a single line (must also be detected):
      `  const v = getConfig("elaine", "chatModel", "default");`,
      // A call whose opening token is at the very start of the line:
      `getConfig(`,
      `  "openrouter",`,
      `  "model_fetch_timeout_ms",`,
      `  30_000`,
      `)`,
    ];

    // extractCallText should collect all lines until the matching close-paren
    // and return a collapsed string that CALL_RE can match.
    const r1 = extractCallText(lines, 0);
    expect(r1.hasSkip).toBe(false);
    CALL_RE.lastIndex = 0;
    const m1 = CALL_RE.exec(r1.text);
    expect(m1).not.toBeNull();
    expect(m1!.groups).toMatchObject({
      module: "openrouter",
      key: "request_timeout_ms",
    });

    const r2 = extractCallText(lines, 5);
    CALL_RE.lastIndex = 0;
    const m2 = CALL_RE.exec(r2.text);
    expect(m2).not.toBeNull();
    expect(m2!.groups).toMatchObject({ module: "elaine", key: "chatModel" });

    const r3 = extractCallText(lines, 6);
    CALL_RE.lastIndex = 0;
    const m3 = CALL_RE.exec(r3.text);
    expect(m3).not.toBeNull();
    expect(m3!.groups).toMatchObject({
      module: "openrouter",
      key: "model_fetch_timeout_ms",
    });

    // Run the full scanner logic inline over all lines and confirm all three
    // call sites are collected correctly (no false negatives, no duplicates).
    const collected: Array<{ module: string; key: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentOf(line).includes(SKIP_MARKER)) continue;
      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;
      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(callText)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        collected.push({ module, key });
      }
    }

    expect(collected).toHaveLength(3);
    expect(collected[0]).toMatchObject({
      module: "openrouter",
      key: "request_timeout_ms",
    });
    expect(collected[1]).toMatchObject({ module: "elaine", key: "chatModel" });
    expect(collected[2]).toMatchObject({
      module: "openrouter",
      key: "model_fetch_timeout_ms",
    });
  });

  it("skip marker on a later line of a multi-line call is respected", () => {
    // Simulate source lines where // app-config-skip appears on the closing )
    // line, not the opening getConfig( line.  extractCallText must detect it and
    // both extractCallSites / extractDynamicCallSites must skip the call.
    const lines = [
      `const v = getConfig(`,
      `  "ghost-module",`,
      `  "ghost-key",`,
      `  "fallback" // app-config-skip`,
      `);`,
      // A normal call without a skip that should still be detected:
      `const v2 = getConfig("ghost-module", "ghost-key2", "fb");`,
    ];

    // extractCallText must report hasSkip=true for the multi-line call.
    const result = extractCallText(lines, 0);
    expect(result.hasSkip).toBe(true);

    // extractCallText must report hasSkip=false for the single-line call.
    const result2 = extractCallText(lines, 5);
    expect(result2.hasSkip).toBe(false);

    // Synthesise a fake "file" by writing it to a temp path and re-running
    // extractCallSites-equivalent logic inline to avoid touching real disk.
    // Instead we exercise the scanner directly on the lines array.
    const skippedSites: Array<{ line: number; module: string; key: string }> =
      [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentOf(line).includes(SKIP_MARKER)) continue; // early-exit (opening line)
      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;
      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue; // skip via later-line marker
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(callText)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        skippedSites.push({ line: i + 1, module, key });
      }
    }

    // Only the second call (ghost-key2) should be collected; ghost-key was skipped.
    expect(skippedSites).toHaveLength(1);
    expect(skippedSites[0]).toMatchObject({
      module: "ghost-module",
      key: "ghost-key2",
    });
  });

  it("SKIP_MARKER inside a string argument does NOT suppress the call", () => {
    // A getConfig() whose key argument literally contains the skip-marker string
    // must still be detected as a call site — the marker inside a string is NOT
    // an intentional skip comment.
    const lines = [
      // key arg value happens to contain the marker — no real skip comment
      `const v = getConfig("real-module", "app-config-skip", fallback);`,
      // Same but in a multi-line form — marker is still only in a string, not a comment
      `const v2 = getConfig(`,
      `  "real-module",`,
      `  "app-config-skip",`,
      `  fallback`,
      `);`,
      // A genuinely skipped call for contrast
      `const v3 = getConfig("real-module", "real-key", fb); // app-config-skip`,
    ];

    // commentOf must return empty for lines whose only occurrence of the
    // marker is inside a string literal.
    expect(commentOf(lines[0])).toBe("");
    expect(commentOf(lines[2])).toBe(""); // `"app-config-skip",` — in string
    // And non-empty for the genuine skip comment line.
    expect(commentOf(lines[6])).toContain(SKIP_MARKER);

    // extractCallText must NOT set hasSkip for the two string-arg calls.
    const r1 = extractCallText(lines, 0);
    expect(r1.hasSkip).toBe(false);

    const r2 = extractCallText(lines, 1);
    expect(r2.hasSkip).toBe(false);

    // extractCallText MUST set hasSkip for the genuine skip comment call.
    const r3 = extractCallText(lines, 6);
    expect(r3.hasSkip).toBe(true);

    // Run the full scanner logic inline and confirm both string-arg calls are
    // collected (not silently dropped), while the genuine skip is omitted.
    const collected: Array<{ module: string; key: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentOf(line).includes(SKIP_MARKER)) continue;
      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;
      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(callText)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        collected.push({ module, key });
      }
    }

    // Both string-arg calls should be collected; the genuine skip should not.
    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({
      module: "real-module",
      key: "app-config-skip",
    });
    expect(collected[1]).toMatchObject({
      module: "real-module",
      key: "app-config-skip",
    });
  });

  it("SKIP_MARKER in a /* */ block comment suppresses the call", () => {
    // A getConfig() whose line carries a block-comment skip marker must be
    // treated identically to one with a // line-comment marker.
    const lines = [
      // Block-comment skip on a single-line call
      `const v = getConfig("bm", "bk", fallback); /* app-config-skip */`,
      // Block-comment skip on the opening line of a multi-line call
      `const v2 = getConfig( /* app-config-skip */`,
      `  "bm",`,
      `  "bk2",`,
      `  fallback`,
      `);`,
      // A normal call without any skip — must still be detected
      `const v3 = getConfig("bm", "bk3", fallback);`,
    ];

    // commentOf() must return the block comment text for marked lines.
    expect(commentOf(lines[0])).toContain(SKIP_MARKER);
    expect(commentOf(lines[1])).toContain(SKIP_MARKER);
    // The plain call line has no comment at all.
    expect(commentOf(lines[6])).toBe("");

    // extractCallText must set hasSkip=true for the single-line block-comment call.
    const r1 = extractCallText(lines, 0);
    expect(r1.hasSkip).toBe(true);

    // extractCallText must set hasSkip=true for the multi-line call whose
    // opening line carries the block-comment marker.
    const r2 = extractCallText(lines, 1);
    expect(r2.hasSkip).toBe(true);

    // The plain call must not be skipped.
    const r3 = extractCallText(lines, 6);
    expect(r3.hasSkip).toBe(false);

    // Run the full inline scanner logic and confirm only the plain call is collected.
    const collected: Array<{ module: string; key: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentOf(line).includes(SKIP_MARKER)) continue; // early-exit on block-comment skip
      ANY_CALL_RE.lastIndex = 0;
      if (!ANY_CALL_RE.test(line)) continue;
      if (DECL_RE.test(line)) continue;
      const { text: callText, hasSkip } = extractCallText(lines, i);
      if (hasSkip) continue;
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(callText)) !== null) {
        const { module, key } = m.groups as { module: string; key: string };
        collected.push({ module, key });
      }
    }

    // Only the plain call (bk3) must survive; the two block-comment-skipped calls must not.
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ module: "bm", key: "bk3" });
  });

  // ── Type-mismatch guard ────────────────────────────────────────────────────

  it("classifyFallback correctly identifies the JS type of literal tokens", () => {
    // number literals
    expect(classifyFallback("1000")).toBe("number");
    expect(classifyFallback("30_000")).toBe("number");
    expect(classifyFallback("3600000")).toBe("number");
    expect(classifyFallback("3.14")).toBe("number");
    expect(classifyFallback("-1")).toBe("number");
    // boolean literals
    expect(classifyFallback("true")).toBe("boolean");
    expect(classifyFallback("false")).toBe("boolean");
    // string literals (with trailing punctuation the regex may capture)
    expect(classifyFallback('"hello"')).toBe("string");
    expect(classifyFallback("'world'")).toBe("string");
    expect(classifyFallback('"hello",')).toBe("string");
    // named constants → unknown
    expect(classifyFallback("REQUEST_TIMEOUT_MS_DEFAULT")).toBe("unknown");
    expect(classifyFallback("DEFAULT_FETCH_TIMEOUT_MS")).toBe("unknown");
    expect(classifyFallback("someVar")).toBe("unknown");
  });

  it("declared type in APP_CONFIG_DEFAULTS matches the JS type of the fallback at every call site", () => {
    /**
     * For every getConfig("module", "key", fallback) call where:
     *  - both module and key are string literals (statically detectable), AND
     *  - the fallback is a literal value (not a named constant / variable)
     *
     * …the JS type of the literal must match what the corresponding
     * APP_CONFIG_DEFAULTS entry declares:
     *
     *   integer / float  →  number  fallback
     *   boolean          →  true or false
     *   string           →  string literal
     *
     * Named-constant fallbacks (REQUEST_TIMEOUT_MS_DEFAULT, etc.) cannot be
     * classified statically; they emit a console.warn so a reviewer can audit
     * them manually.  They do NOT fail this test.
     */

    const defaultsByKey = new Map(
      APP_CONFIG_DEFAULTS.map((d) => [`${d.module}::${d.key}`, d]),
    );

    const mismatches: string[] = [];
    const skippedConstants: string[] = [];

    for (const file of collectSourceFiles(SRC_DIR)) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (commentOf(line).includes(SKIP_MARKER)) continue;
        ANY_CALL_RE.lastIndex = 0;
        if (!ANY_CALL_RE.test(line)) continue;
        if (DECL_RE.test(line)) continue;

        const { text: callText, hasSkip } = extractCallText(lines, i);
        if (hasSkip) continue;

        CALL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CALL_RE.exec(callText)) !== null) {
          const { module, key } = m.groups as { module: string; key: string };
          const def = defaultsByKey.get(`${module}::${key}`);
          if (!def) continue; // missing-default is already caught by the drift check

          // Extract the fallback token from the call text
          const fm = FALLBACK_EXTRACT_RE.exec(callText);
          if (!fm?.groups?.fallback) continue; // can't extract — skip silently

          const fallbackToken = fm.groups.fallback;
          const actualKind = classifyFallback(fallbackToken);
          const rel = path.relative(SRC_DIR, file);

          if (actualKind === "unknown") {
            skippedConstants.push(
              `  ${rel}:${i + 1}  getConfig("${module}", "${key}", ${fallbackToken})  [named constant — cannot classify statically]`,
            );
            continue;
          }

          const expected = expectedFallbackKind(def.type);
          if (actualKind !== expected) {
            mismatches.push(
              `  ${rel}:${i + 1}  getConfig("${module}", "${key}", ${fallbackToken})\n` +
                `    APP_CONFIG_DEFAULTS declares type="${def.type}" → expects a ${expected} fallback, ` +
                `but the literal "${fallbackToken}" is a ${actualKind}`,
            );
          }
        }
      }
    }

    if (skippedConstants.length > 0) {
      expect.fail(
        `${skippedConstants.length} getConfig() call site(s) pass a named constant as the fallback ` +
          `and cannot be automatically type-checked.\n\n` +
          skippedConstants.join("\n") +
          `\n\nFix one of two ways:\n` +
          `  1. Inline the literal value directly in the getConfig() call (preferred).\n` +
          `  2. Add  // app-config-skip  on the call line after manual review to confirm the\n` +
          `     constant's JS type matches the declared APP_CONFIG_DEFAULTS type.\n`,
      );
    }

    if (mismatches.length > 0) {
      expect.fail(
        `${mismatches.length} getConfig() call site(s) have a fallback literal whose JS type ` +
          `does not match the declared APP_CONFIG_DEFAULTS type.\n\n` +
          `Fix the mismatch: either correct the fallback literal type, or update the APP_CONFIG_DEFAULTS entry:\n` +
          `  integer / float  →  numeric fallback  (e.g. 1000, 30_000)\n` +
          `  boolean          →  true or false\n` +
          `  string           →  string literal     (e.g. "default")\n\n` +
          mismatches.join("\n\n"),
      );
    }
  });

  it("warn on dynamic-arg getConfig() calls that cannot be statically verified", () => {
    const dynamic = extractDynamicCallSites(SRC_DIR);

    if (dynamic.length > 0) {
      const report = dynamic
        .map(
          (s) => `  ${path.relative(SRC_DIR, s.file)}:${s.line}  ${s.snippet}`,
        )
        .join("\n");

      expect.fail(
        `${dynamic.length} getConfig() call(s) use non-literal arguments and cannot be automatically ` +
          `checked against APP_CONFIG_DEFAULTS.\n\n` +
          `Fix each site with one of:\n` +
          `  1. Inline the literal module and key strings so the drift guard can verify them.\n` +
          `  2. Add  // app-config-skip  on that line if it has been manually reviewed.\n\n` +
          report,
      );
    }
  });

  // ── Admin Control Panel module registry guard ──────────────────────────────
  //
  // The admin Control Panel (artifacts/web/src/pages/control-panel.tsx) has a
  // MODULE_LABELS map that registers a human-readable display name for each
  // config module.  A developer can add a brand-new module to APP_CONFIG_DEFAULTS
  // without adding a corresponding entry in MODULE_LABELS — the rows appear in
  // the DB, the API serves them, but admins see a silently auto-generated label
  // instead of the intended one (e.g. "web_search" → "Web Search").
  //
  // This test statically reads the MODULE_LABELS declaration and cross-checks it
  // against the distinct module names in APP_CONFIG_DEFAULTS so the mismatch is
  // caught before shipping.

  /**
   * Parse the MODULE_LABELS object from the control-panel source file and return
   * the set of module-name keys it declares.
   *
   * Approach: find the `const MODULE_LABELS … = {` block, then extract every
   * property key name from the lines inside the braces.  This is intentionally
   * simple — it handles the plain `identifier: "string"` shape that the file
   * actually uses and will need updating only if that shape changes drastically.
   */
  function parseModuleLabelsKeys(controlPanelSource: string): Set<string> {
    // Match from the opening `{` of the object literal to its closing `}`.
    // The object contains only simple identifier: "string" entries so a single
    // `[^}]+` capture is sufficient and avoids nested-brace complexity.
    const blockRe = /const\s+MODULE_LABELS[^=]*=\s*\{([^}]+)\}/;
    const blockMatch = blockRe.exec(controlPanelSource);
    if (!blockMatch) {
      throw new Error(
        "Could not locate the MODULE_LABELS object in control-panel.tsx. " +
          "The test parser may need updating if the declaration style changed.",
      );
    }

    const keys = new Set<string>();
    // Each entry looks like:  web_search: "Web Search",
    const keyRe = /^\s+([\w]+)\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(blockMatch[1])) !== null) {
      keys.add(m[1]);
    }
    return keys;
  }

  it("every APP_CONFIG_DEFAULTS module has an entry in the admin Control Panel MODULE_LABELS registry", () => {
    const CONTROL_PANEL_PATH = path.resolve(
      __dirname,
      "../../../../artifacts/web/src/pages/control-panel.tsx",
    );

    let controlPanelSource: string;
    try {
      controlPanelSource = fs.readFileSync(CONTROL_PANEL_PATH, "utf8");
    } catch {
      expect.fail(
        `Could not read the admin Control Panel source file.\n` +
          `Expected path: ${CONTROL_PANEL_PATH}\n` +
          `If the file has moved, update CONTROL_PANEL_PATH in this test.`,
      );
    }

    const registeredModules = parseModuleLabelsKeys(controlPanelSource);

    const defaultModules = new Set(APP_CONFIG_DEFAULTS.map((d) => d.module));

    const unregistered = [...defaultModules].filter(
      (mod) => !registeredModules.has(mod),
    );

    if (unregistered.length > 0) {
      expect.fail(
        `${unregistered.length} APP_CONFIG_DEFAULTS module(s) have no entry in the ` +
          `MODULE_LABELS registry in artifacts/web/src/pages/control-panel.tsx.\n\n` +
          `Admins will see a silently auto-generated label for these modules instead ` +
          `of the intended human-readable name.\n\n` +
          `Missing module(s):\n` +
          unregistered.map((m) => `  "${m}"`).join("\n") +
          `\n\nFix: add each missing module to the MODULE_LABELS object, e.g.:\n` +
          unregistered
            .map((m) => {
              const label = m
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              return `  ${m}: "${label}",`;
            })
            .join("\n"),
      );
    }
  });

  it("MODULE_LABELS registry has no orphan entries for modules absent from APP_CONFIG_DEFAULTS", () => {
    const CONTROL_PANEL_PATH = path.resolve(
      __dirname,
      "../../../../artifacts/web/src/pages/control-panel.tsx",
    );

    let controlPanelSource: string;
    try {
      controlPanelSource = fs.readFileSync(CONTROL_PANEL_PATH, "utf8");
    } catch {
      expect.fail(
        `Could not read the admin Control Panel source file.\n` +
          `Expected path: ${CONTROL_PANEL_PATH}\n` +
          `If the file has moved, update CONTROL_PANEL_PATH in this test.`,
      );
    }

    const registeredModules = parseModuleLabelsKeys(controlPanelSource);
    const defaultModules = new Set(APP_CONFIG_DEFAULTS.map((d) => d.module));

    const orphans = [...registeredModules].filter(
      (mod) => !defaultModules.has(mod),
    );

    if (orphans.length > 0) {
      expect.fail(
        `${orphans.length} MODULE_LABELS entry/entries reference module(s) that have no ` +
          `corresponding rows in APP_CONFIG_DEFAULTS.\n\n` +
          `These are stale labels — the module was removed from APP_CONFIG_DEFAULTS ` +
          `but its label was never cleaned up.\n\n` +
          `Orphan module(s):\n` +
          orphans.map((m) => `  "${m}"`).join("\n") +
          `\n\nFix: remove each orphan entry from MODULE_LABELS in ` +
          `artifacts/web/src/pages/control-panel.tsx.`,
      );
    }
  });

  // ── Label / description completeness guard ─────────────────────────────────

  it("every APP_CONFIG_DEFAULTS entry has a non-empty label", () => {
    // Catches regressions where a developer adds a new default without setting
    // a human-readable label — the Control Panel would then show an empty string
    // next to the config key instead of a meaningful name.
    const missing = APP_CONFIG_DEFAULTS.filter(
      (d) => typeof d.label !== "string" || d.label.trim() === "",
    );

    if (missing.length > 0) {
      const report = missing
        .map((d) => `  module="${d.module}" key="${d.key}"`)
        .join("\n");

      expect.fail(
        `${missing.length} APP_CONFIG_DEFAULTS entry/entries have an empty or missing \`label\`.\n` +
          `Every entry must have a non-empty human-readable label so the admin Control Panel\n` +
          `can display it correctly.\n\n` +
          `Fix: add a descriptive \`label\` to each entry in APP_CONFIG_DEFAULTS in\n` +
          `artifacts/api-server/src/lib/app-config.ts:\n\n` +
          report,
      );
    }
  });

  it("every APP_CONFIG_DEFAULTS entry has a non-empty description", () => {
    // Catches regressions where a developer adds a new default without a
    // description — the Control Panel renders descriptions as contextual help
    // text so admins understand what each setting does before changing it.
    const missing = APP_CONFIG_DEFAULTS.filter(
      (d) =>
        d.description === undefined ||
        d.description === null ||
        d.description.trim() === "",
    );

    if (missing.length > 0) {
      const report = missing
        .map(
          (d) =>
            `  module="${d.module}" key="${d.key}" (${d.label || "<no label>"})`,
        )
        .join("\n");

      expect.fail(
        `${missing.length} APP_CONFIG_DEFAULTS entry/entries have an empty or missing \`description\`.\n` +
          `Every entry must have a non-empty description so the admin Control Panel\n` +
          `can show contextual help text next to each setting.\n\n` +
          `Fix: add a descriptive \`description\` to each entry in APP_CONFIG_DEFAULTS in\n` +
          `artifacts/api-server/src/lib/app-config.ts:\n\n` +
          report,
      );
    }
  });
});
