/**
 * CI guardrail: every task name passed to shouldRunScheduledTask() or
 * recordScheduledTaskSuccess() must be registered in KNOWN_SCHEDULER_NAMES.
 *
 * Without this check, a developer can add a new scheduler, pick a task name
 * via shouldRunScheduledTask("new-name", …), and ship it without registering
 * the name. On the next server restart, reconcileSchedulerRuns() treats the
 * new row as an orphan and deletes it — silently breaking the scheduler's
 * claim-guard tracking.
 *
 * Detection strategy
 * ──────────────────
 * The script uses a two-step approach so no call site is silently skipped:
 *
 *   Step 1 — Find every call to shouldRunScheduledTask() / recordScheduledTask-
 *             Success() in the file content. \s* after the opening paren already
 *             crosses newlines, so both single-line and multiline calls are found:
 *
 *               shouldRunScheduledTask("gmail-scan", INTERVAL_MS)
 *               shouldRunScheduledTask(
 *                 "reminders-scheduler",
 *                 INTERVAL_MS,
 *               )
 *
 *   Step 2 — Classify the first argument token at each call site:
 *
 *               "some-name" / 'some-name'  →  inline string literal (Pattern A)
 *               IDENTIFIER                 →  resolve via same-file module-level const (Pattern B)
 *               `template` / OBJ.PROP / anything else →  unsupported — FAIL CI
 *
 *             After each pattern match the script checks that the immediately
 *             following token is a valid argument terminator (whitespace then
 *             `,` or `)`). If anything else follows — e.g. `+ suffix` — the
 *             call site is classified as unsupported.
 *
 *             Pattern B requires the identifier to resolve to a MODULE-LEVEL
 *             `const` declaration in the same file, with a standalone string-
 *             literal initializer, and no other declaration of the same name
 *             anywhere in the file (which would make the binding ambiguous).
 *             Imports from other files, `let`/`var`, and object-property
 *             references are all unsupported — use an inline string literal
 *             instead. The convention is codified in AGENTS.md §2.10.
 *
 *             Unsupported argument forms are always a violation: they can't be
 *             statically verified and must not silently pass.
 *
 * Resolution uses the TypeScript compiler's AST so that block comments,
 * string-literal bodies, and template literals are correctly skipped — no
 * regex-based text search can offer the same guarantee.
 *
 * The scheduler-guard source file (KNOWN_SCHEDULER_NAMES definition,
 * shouldRunScheduledTask implementation) and *.test.* files are excluded.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const API_SRC = join(REPO_ROOT, "artifacts", "api-server", "src");
const GUARD_FILE = join(API_SRC, "lib", "scheduler-guard.ts");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", "build", ".vite"]);

// Step 1: locate every call site (opening paren position).
// \s* after \( crosses newlines so multiline calls are found.
const CALL_START_RE =
  /\b(?:shouldRunScheduledTask|recordScheduledTaskSuccess)\s*\(\s*/g;

// Step 2: classify the first token after the opening paren + whitespace.
const SINGLE_QUOTED_RE = /^'([^']+)'/;
const DOUBLE_QUOTED_RE = /^"([^"]+)"/;
// Pattern B: plain identifier
const IDENTIFIER_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)/;
// Anything that starts with a backtick, opening paren, or identifier followed
// by `.` (an object-property access) is unsupported — const object properties
// can be mutated at runtime so OBJ.PROP cannot be statically verified.
const UNSUPPORTED_RE = /^[`(]/;
// A matched pattern must be immediately followed only by whitespace then `,`
// or `)`. Anything else (e.g. `+ suffix`, `.PROP`) means the argument is a
// compound expression whose runtime value is unknowable.
const ARG_TERMINATOR_RE = /^\s*[,)]/;

// ---------------------------------------------------------------------------
// AST-based resolver helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse a TypeScript source file into an AST, caching by content so the same
 * file is only parsed once per script invocation.
 */
const _sourceFileCache = new Map<string, ts.SourceFile>();
function parseSourceFile(fileContent: string): ts.SourceFile {
  let sf = _sourceFileCache.get(fileContent);
  if (!sf) {
    sf = ts.createSourceFile(
      "tmp.ts",
      fileContent,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );
    _sourceFileCache.set(fileContent, sf);
  }
  return sf;
}

/**
 * Collect every module-level `const NAME = "string"` declaration for
 * `varName` (direct children of SourceFile only).
 */
function collectModuleLevelConstDecls(
  varName: string,
  sf: ts.SourceFile,
): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === varName) {
        found.push(decl);
      }
    }
  }
  return found;
}

/**
 * Return true if `varName` appears as ANY binding in the AST that is NOT
 * a module-level variable declaration.
 *
 * Covers all forms that can shadow a module-level const at a call site:
 *   • Non-module-level variable declarations (inner const/let/var)
 *   • Function / arrow / method / constructor parameters
 *   • Catch-clause variable bindings
 *   • For-in / for-of loop initializer variable bindings
 *
 * Binding names in destructuring patterns (array/object) are also checked
 * so that `const { TASK_NAME } = obj` inside a function is correctly
 * detected as a shadow.
 */
function hasShadowingBinding(varName: string, sf: ts.SourceFile): boolean {
  let found = false;

  /** Recursively check a BindingName (Identifier, ObjectBindingPattern,
   *  ArrayBindingPattern) for the target name. */
  function checkBinding(name: ts.BindingName): void {
    if (found) return;
    if (ts.isIdentifier(name) && name.text === varName) {
      found = true;
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) checkBinding(el.name);
    } else if (ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (!ts.isOmittedExpression(el)) checkBinding(el.name);
      }
    }
  }

  function visit(node: ts.Node, isModuleLevel: boolean): void {
    if (found) return;

    if (ts.isVariableStatement(node)) {
      if (isModuleLevel) {
        // Module-level statements are checked separately; skip here.
        ts.forEachChild(node, (child) => visit(child, false));
        return;
      }
      // Inner-scope variable declaration — any kind shadows.
      for (const decl of node.declarationList.declarations) {
        checkBinding(decl.name);
      }
      ts.forEachChild(node, (child) => visit(child, false));
      return;
    }

    // Function / arrow / method / constructor parameters.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      for (const param of node.parameters) {
        checkBinding(param.name);
      }
    }

    // Catch clause binding: `catch (TASK_NAME)`.
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      checkBinding(node.variableDeclaration.name);
    }

    // For-in / for-of loop initializer variable declarations.
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const decl of node.initializer.declarations) {
        checkBinding(decl.name);
      }
    }

    ts.forEachChild(node, (child) =>
      visit(child, isModuleLevel && child === node),
    );
  }

  // Visit top-level children; pass isModuleLevel=true for SourceFile children.
  for (const statement of sf.statements) {
    visit(statement, true);
    if (found) break;
  }
  return found;
}

/**
 * Resolve `const VARNAME = "some-string"` in the file.
 *
 * Uses the TypeScript AST so that text inside block comments, string
 * literals, and template literals is never mistaken for a const declaration.
 *
 * Soundness constraints — all must hold or the function returns null:
 *   1. Exactly one module-level `const NAME = "string"` declaration.
 *   2. No other binding of the same name anywhere in the file: no inner-scope
 *      variable declarations, no function/arrow/method parameters, no catch
 *      variables, no for-in/for-of loop variables, no destructuring bindings.
 *      Any such binding can shadow the module-level const at a call site inside
 *      its scope, making static verification unsound.
 *   3. The initializer must be a standalone `StringLiteral` node (not a
 *      compound expression, template literal, or `as const` suffix).
 */
export function resolveConstant(
  varName: string,
  fileContent: string,
): string | null {
  const sf = parseSourceFile(fileContent);

  // Constraint 1: exactly one module-level const string declaration.
  const moduleLevelDecls = collectModuleLevelConstDecls(varName, sf);
  if (moduleLevelDecls.length !== 1) return null;

  const decl = moduleLevelDecls[0];
  if (!decl.initializer || !ts.isStringLiteral(decl.initializer)) return null;

  // Constraint 2: no other binding of this name anywhere in the file
  // (parameters, inner-scope variables, catch variables, loop variables, …).
  if (hasShadowingBinding(varName, sf)) return null;

  return decl.initializer.text;
}

/**
 * Return true if `varName` is brought in via an import declaration rather
 * than declared locally. Uses the TypeScript AST to avoid matching import-
 * like text inside comments or strings.
 *
 * Recognises:
 *   import { varName } from "..."
 *   import { foo as varName } from "..."
 *   import varName from "..."
 *   import * as varName from "..."
 */
export function isImportedVariable(
  varName: string,
  fileContent: string,
): boolean {
  const sf = parseSourceFile(fileContent);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }
    const clause = statement.importClause;
    // Default import: import varName from "..."
    if (clause.name?.text === varName) return true;
    if (!clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      // import * as varName from "..."
      if (clause.namedBindings.name.text === varName) return true;
    } else if (ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        // Local binding name (after `as`, or same as imported name).
        if (el.name.text === varName) return true;
      }
    }
  }
  return false;
}

/** Given a file content string and a match offset, return the 1-based line number. */
function lineNumberAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Classification (exported for tests)
// ---------------------------------------------------------------------------

export type ClassifyResult =
  | { outcome: "registered" }
  | { outcome: "unregistered"; name: string }
  | { outcome: "unresolvable"; ref: string; reason: string }
  | { outcome: "unsupported"; token: string };

/**
 * Classify a single call-site argument.
 *
 * @param rest        The file content starting at the first argument position
 *                    (after the opening paren and any leading whitespace).
 * @param fileContent The full file content (used for same-file const lookup).
 * @param knownNames  The registered scheduler names.
 */
export function classifyArgument(
  rest: string,
  fileContent: string,
  knownNames: Set<string>,
): ClassifyResult {
  // ---- Pattern A: string literals ----
  const sq = SINGLE_QUOTED_RE.exec(rest);
  if (sq) {
    const after = rest.slice(sq[0].length);
    if (!ARG_TERMINATOR_RE.test(after)) {
      return {
        outcome: "unsupported",
        token: rest.slice(0, 30).replace(/\n/g, "\\n"),
      };
    }
    return knownNames.has(sq[1])
      ? { outcome: "registered" }
      : { outcome: "unregistered", name: sq[1] };
  }

  const dq = DOUBLE_QUOTED_RE.exec(rest);
  if (dq) {
    const after = rest.slice(dq[0].length);
    if (!ARG_TERMINATOR_RE.test(after)) {
      return {
        outcome: "unsupported",
        token: rest.slice(0, 30).replace(/\n/g, "\\n"),
      };
    }
    return knownNames.has(dq[1])
      ? { outcome: "registered" }
      : { outcome: "unregistered", name: dq[1] };
  }

  // ---- Pattern B: plain identifier ----
  // Object-property access (IDENTIFIER.IDENTIFIER) must be caught BEFORE
  // matching the bare identifier, otherwise only the left-hand `IDENTIFIER`
  // is consumed and the `.PROP` suffix passes the terminator check, allowing
  // OBJ.PROP references through. Since OBJ.PROP cannot be statically verified
  // (const objects are mutable), it is always unsupported.
  const memberMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)\./.exec(rest);
  if (memberMatch) {
    return {
      outcome: "unsupported",
      token: rest.slice(0, 30).replace(/\n/g, "\\n"),
    };
  }

  const im = IDENTIFIER_RE.exec(rest);
  if (im) {
    const varName = im[1];
    const after = rest.slice(im[0].length);
    if (!ARG_TERMINATOR_RE.test(after)) {
      // `IDENTIFIER + suffix`, `IDENTIFIER()`, etc.
      return {
        outcome: "unsupported",
        token: rest.slice(0, 30).replace(/\n/g, "\\n"),
      };
    }

    // Detect import-from-another-file before attempting same-file resolution.
    if (isImportedVariable(varName, fileContent)) {
      return {
        outcome: "unresolvable",
        ref: varName,
        reason:
          `"${varName}" is imported from another file — cross-file resolution is not ` +
          `supported; move the task name to this file as an inline string or ` +
          `a module-level \`const ${varName} = "..."\``,
      };
    }

    const resolved = resolveConstant(varName, fileContent);
    if (resolved === null) {
      return {
        outcome: "unresolvable",
        ref: varName,
        reason:
          `could not find a unique module-level \`const ${varName} = "..."\` in this file — ` +
          `use an inline string literal or a module-level \`const NAME = "..."\`; ` +
          `\`let\`/\`var\`, local declarations inside functions, shadowed names, ` +
          `imports, and object-property references (\`OBJ.PROP\`) are not supported`,
      };
    }
    return knownNames.has(resolved)
      ? { outcome: "registered" }
      : { outcome: "unregistered", name: resolved };
  }

  // ---- Unsupported: template literal, expression, etc. ----
  const preview = rest.slice(0, 30).replace(/\n/g, "\\n");
  if (UNSUPPORTED_RE.test(rest) || rest.trim().length > 0) {
    return { outcome: "unsupported", token: preview };
  }

  // Empty argument list — shouldn't happen in practice.
  return { outcome: "unsupported", token: "(empty)" };
}

// ---------------------------------------------------------------------------
// File-level scanner
// ---------------------------------------------------------------------------

type Violation =
  | { kind: "unregistered"; file: string; line: number; name: string }
  | {
      kind: "unresolvable";
      file: string;
      line: number;
      ref: string;
      reason: string;
    }
  | { kind: "unsupported"; file: string; line: number; token: string };

function checkFile(
  file: string,
  knownNames: Set<string>,
  violations: Violation[],
): void {
  const content = readFileSync(file, "utf8");
  const relFile = relative(REPO_ROOT, file);

  CALL_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_START_RE.exec(content)) !== null) {
    const argStart = m.index + m[0].length;
    const rest = content.slice(argStart);
    const lineNum = lineNumberAtOffset(content, m.index);

    const result = classifyArgument(rest, content, knownNames);

    if (result.outcome === "registered") continue;

    if (result.outcome === "unregistered") {
      violations.push({
        kind: "unregistered",
        file: relFile,
        line: lineNum,
        name: result.name,
      });
    } else if (result.outcome === "unresolvable") {
      violations.push({
        kind: "unresolvable",
        file: relFile,
        line: lineNum,
        ref: result.ref,
        reason: result.reason,
      });
    } else {
      violations.push({
        kind: "unsupported",
        file: relFile,
        line: lineNum,
        token: result.token,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// AST-based call-site name collector (reverse check)
// ---------------------------------------------------------------------------

const TARGET_CALLEE_NAMES = new Set([
  "shouldRunScheduledTask",
  "recordScheduledTaskSuccess",
]);

/**
 * Use the TypeScript AST to enumerate every real CallExpression for
 * shouldRunScheduledTask / recordScheduledTaskSuccess and collect the
 * resolved first-argument string values that are in knownNames.
 *
 * Unlike the regex-based forward scan, AST traversal is immune to
 * call-shaped text inside block/line comments, string literals, and
 * template literals — only executable call nodes contribute to the result.
 * This is what makes the reverse check (every registered name has at least
 * one real call site) sound: a retired name mentioned only in a doc comment
 * or a log message will NOT appear in the returned set and will be correctly
 * flagged as stale.
 *
 * First-argument forms supported:
 *   • String literal: `"gmail-scan"` / `'gmail-scan'`
 *   • Module-level const identifier, resolved via resolveConstant()
 * Any other form is ignored for reverse-check purposes (the forward check
 * already enforces that every call site uses a supported form).
 */
export function collectCallSiteNamesAST(
  fileContent: string,
  knownNames: Set<string>,
): Set<string> {
  const sf = parseSourceFile(fileContent);
  const names = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isIdentifier(callee) &&
        TARGET_CALLEE_NAMES.has(callee.text) &&
        node.arguments.length > 0
      ) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          if (knownNames.has(firstArg.text)) names.add(firstArg.text);
        } else if (ts.isIdentifier(firstArg)) {
          const resolved = resolveConstant(firstArg.text, fileContent);
          if (resolved !== null && knownNames.has(resolved))
            names.add(resolved);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);
  return names;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      walk(fullPath, files);
    } else if (SCAN_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Extract KNOWN_SCHEDULER_NAMES from the guard source file. */
function loadKnownNames(): Set<string> {
  const src = readFileSync(GUARD_FILE, "utf8");
  const blockMatch =
    /KNOWN_SCHEDULER_NAMES\s*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]/s.exec(src);
  if (!blockMatch) {
    console.error(
      "✖ Could not parse KNOWN_SCHEDULER_NAMES from scheduler-guard.ts",
    );
    process.exit(1);
  }
  const names = new Set<string>();
  const itemRe = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(blockMatch[1])) !== null) {
    names.add(m[1]);
  }
  return names;
}

function main(): void {
  const knownNames = loadKnownNames();
  const violations: Violation[] = [];
  // Collects every registered name that has at least one real AST call site.
  // Populated separately from the forward check using collectCallSiteNamesAST
  // so that call-shaped text in comments and string literals cannot fake a hit.
  const foundNames = new Set<string>();

  const allFiles = walk(API_SRC).filter((f) => {
    if (f === GUARD_FILE) return false;
    if (/\.test\.[^/]+$/.test(f)) return false;
    return true;
  });

  for (const file of allFiles) {
    checkFile(file, knownNames, violations);
    // Reverse check: use AST traversal (not regex) so only executable
    // CallExpression nodes contribute — comments and string bodies are skipped.
    const content = readFileSync(file, "utf8");
    for (const name of collectCallSiteNamesAST(content, knownNames)) {
      foundNames.add(name);
    }
  }

  // ---- Reverse check: every name in KNOWN_SCHEDULER_NAMES must have at
  // least one call site. A name with zero matches is a retired scheduler
  // that was never removed from the set — its stale row will permanently
  // trip the shared heartbeat's "gone silent" alert.
  const staleNames: string[] = [];
  for (const name of knownNames) {
    if (!foundNames.has(name)) {
      staleNames.push(name);
    }
  }

  const hasForwardViolations = violations.length > 0;
  const hasStaleNames = staleNames.length > 0;

  if (!hasForwardViolations && !hasStaleNames) {
    console.log(
      `✓ All scheduler task names are registered in KNOWN_SCHEDULER_NAMES (${knownNames.size} known names, all have active call sites).`,
    );
    return;
  }

  if (hasForwardViolations) {
    console.error(
      "\n✖ Scheduler task name(s) not registered in KNOWN_SCHEDULER_NAMES.\n" +
        "  Add the missing name(s) to KNOWN_SCHEDULER_NAMES in\n" +
        "  artifacts/api-server/src/lib/scheduler-guard.ts, or\n" +
        "  reconcileSchedulerRuns() will delete the scheduler's DB row on the\n" +
        "  next server restart, silently breaking its claim-guard tracking.\n",
    );

    for (const v of violations) {
      if (v.kind === "unregistered") {
        console.error(
          `  ${v.file}:${v.line}  task name "${v.name}" not in KNOWN_SCHEDULER_NAMES`,
        );
      } else if (v.kind === "unresolvable") {
        console.error(
          `  ${v.file}:${v.line}  unresolvable reference "${v.ref}" — ${v.reason}`,
        );
      } else {
        console.error(
          `  ${v.file}:${v.line}  unsupported first argument "${v.token}" — ` +
            `use a plain string literal or a module-level \`const NAME = "..."\` ` +
            `in the same file so the name can be statically verified`,
        );
      }
    }

    console.error(`\n${violations.length} forward violation(s).\n`);
  }

  if (hasStaleNames) {
    console.error(
      "\n✖ KNOWN_SCHEDULER_NAMES contains name(s) with no call sites in api-server/src.\n" +
        "  These are retired schedulers whose names were never removed from the set.\n" +
        "  A stale entry leaves a permanently-stale scheduler_runs row that will trip\n" +
        '  the shared heartbeat\'s "gone silent" alert even though the task no longer runs.\n' +
        "  Remove each name listed below from KNOWN_SCHEDULER_NAMES in\n" +
        "  artifacts/api-server/src/lib/scheduler-guard.ts:\n",
    );
    for (const name of staleNames) {
      console.error(
        `  "${name}"  — no call to shouldRunScheduledTask/recordScheduledTaskSuccess found`,
      );
    }
    console.error(`\n${staleNames.length} stale name(s) to retire.\n`);
  }

  process.exit(1);
}

main();
