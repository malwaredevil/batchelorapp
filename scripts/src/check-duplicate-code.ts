/**
 * check-duplicate-code.ts
 *
 * Heuristic, diff-scoped guardrail that flags a new or changed function whose
 * *structure* (control flow + punctuation, with identifiers/literals/comments
 * stripped) is a near-exact match for a function that already exists
 * elsewhere in the repo. This is the automated backstop for the
 * composition-and-configuration rule in AGENTS.md §4.10: a function copied
 * and renamed (`getPotteryFoo` → `getQuiltingFoo`, same body) is exactly the
 * shape check-domain-composition.ts's fixed named-file list cannot catch,
 * because it has no way to know about a duplication pattern that didn't
 * exist when the check was written.
 *
 * Same diff-scoping convention as check-hardcoded-config.ts: only files
 * present in `git diff --name-only <base>...HEAD` are treated as candidates.
 * Unlike that check, the "reference" side of the comparison is the rest of
 * the repository (artifacts/** /src, lib/** /src), read fresh from the
 * working tree — so a duplicate is caught even if the original predates any
 * guardrail.
 *
 * Detection strategy
 * ───────────────────
 *   1. Parse each file with the TypeScript compiler API and collect every
 *      function-like body (function declarations, class methods, and
 *      variable/property-initializer arrow/function expressions with a
 *      block body) whose body is at least MIN_TOKENS tokens long.
 *   2. Normalize each body's token stream: identifiers → "ID", literals →
 *      "LIT", everything else (keywords, punctuation, operators) kept as-is.
 *      This is what lets a renamed copy still match structurally.
 *   3. Compare each candidate block (from a diff-changed file) against a
 *      corpus of blocks from every OTHER file in artifacts/lib:
 *        - identical normalized token stream → "exact" match.
 *        - otherwise, k-token shingle sets compared via Jaccard similarity;
 *          score ≥ SIMILARITY_THRESHOLD → "near" match.
 *      An inverted shingle index keeps this from being an O(n²) full scan.
 *
 * This is intentionally imprecise — see AGENTS.md §4.10 "Duplicate-code
 * detection" and docs/composition-and-configuration.md Section 3. It will
 * occasionally flag independently-evolving code that just happens to share a
 * shape; allowlist those in DUPLICATE_CODE_ALLOWLIST with a comment, do not
 * work around the check by reformatting.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check-duplicate-code -- --base origin/main
 *   pnpm --filter @workspace/scripts run check-duplicate-code-audit   (whole-repo, report-only)
 */
import fs from "node:fs";
import ts from "typescript";
import {
  getChangedFiles,
  readFileOrNull,
  repoRoot,
  resolveBase,
  walkFiles,
} from "./lib/git-diff-utils.js";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Below this many normalized tokens a body is too small/generic to be a meaningful match. */
const MIN_TOKENS = 80;
/** Sliding-window size (in normalized tokens) used to build comparison shingles. */
const SHINGLE_SIZE = 12;
/** Jaccard similarity (0-1) required to report a "near" (non-exact) match. */
const SIMILARITY_THRESHOLD = 0.85;
/** Body length ratio (shorter/longer) below which two blocks are not compared. */
const MIN_LENGTH_RATIO = 0.6;
/** Only fully score corpus blocks sharing at least this fraction of the candidate's shingles. */
const SHINGLE_OVERLAP_PREFILTER = 0.4;

export interface CodeBlock {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  normalizedText: string;
  shingles: Set<string>;
}

export interface DuplicateViolation {
  file: string;
  line: number;
  name: string;
  matchFile: string;
  matchLine: number;
  matchName: string;
  similarity: number;
  kind: "exact" | "near";
}

// ---------------------------------------------------------------------------
// File scoping
// ---------------------------------------------------------------------------

const SELF_EXEMPT = new Set([
  "scripts/src/check-duplicate-code.ts",
  "scripts/src/check-duplicate-code.test.ts",
]);

export function isScannableFile(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  if (!/^(artifacts|lib)\//.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.endsWith(".generated.ts")) return false;
  if (file.includes("/generated/")) return false;
  if (file.includes("/dist/")) return false;
  if (SELF_EXEMPT.has(file)) return false;
  return true;
}

/**
 * Pre-reviewed matches that are NOT duplication worth extracting (e.g.
 * independently-evolving adapters that are only superficially similar
 * today). Each entry is a stable candidate/match identity, not a line number.
 * Add new entries only with a specific rationale — do not use this to silence
 * a genuine miss.
 */
export const DUPLICATE_CODE_ALLOWLIST: ReadonlySet<string> = new Set([
  // Magnet vision uses a collection-specific structured output contract; a
  // generic ornament/magnet helper would blur the distinct schema and prompt.
  "artifacts/api-server/src/lib/magnets/openai.ts:analyzeMagnetImage:artifacts/api-server/src/lib/ornaments/openai.ts:analyzeOrnamentImage",
  "artifacts/api-server/src/lib/ornaments/openai.ts:analyzeOrnamentImage:artifacts/api-server/src/lib/magnets/openai.ts:analyzeMagnetImage",
  // Generated API hooks and query keys make this otherwise-shared UI adapter
  // domain-specific; a generic menu would expose a much wider hook contract.
  "artifacts/modules/src/magnets/pages/categories.tsx:CategoryActionMenu:artifacts/modules/src/ornaments/pages/categories.tsx:CategoryActionMenu",
  // All pre-existing duplication grandfathered when this guardrail was
  // introduced (2026-08-18) has since been paid down. Add new entries only
  // with a `//` comment explaining why — do not use this to silence a
  // genuine miss.
  //
  // Fabric AI Lab and the Crease Remover modal have distinct result, save, and
  // reset lifecycles, but still share these legacy canvas-editing primitives.
  // The current viewer-only change only removes their duplicate result
  // lightbox; extracting the canvas editor is tracked separately to avoid
  // changing image-editing behavior as part of a viewer-layout task.
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:syncCanvasSize:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:syncCanvasSize",
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:canvasCoord:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:canvasCoord",
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:handleOuterWheel:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:handleOuterWheel",
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:paint:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:paint",
  "artifacts/modules/src/quilting/components/FabricAiLab.tsx:loadMaskFromDataUrl:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:loadMaskFromDataUrl",
]);

export function duplicateAllowlistKey(
  violation: Pick<
    DuplicateViolation,
    "file" | "name" | "matchFile" | "matchName"
  >,
): string {
  return `${violation.file}:${violation.name}:${violation.matchFile}:${violation.matchName}`;
}

/**
 * Machine-readable, finding-specific reasons for the source allowlist. The
 * policy guard converts a detector match into a stable function/evidence
 * identity, so this line-keyed map is only used to find its explanation.
 */
export const DUPLICATE_CODE_EXCEPTION_REASONS: ReadonlyMap<string, string> =
  new Map([
    [
      "artifacts/api-server/src/lib/magnets/openai.ts:analyzeMagnetImage:artifacts/api-server/src/lib/ornaments/openai.ts:analyzeOrnamentImage",
      "Magnet vision has a collection-specific structured output contract; a generic ornament/magnet helper would blur distinct schema and prompt requirements.",
    ],
    [
      "artifacts/api-server/src/lib/ornaments/openai.ts:analyzeOrnamentImage:artifacts/api-server/src/lib/magnets/openai.ts:analyzeMagnetImage",
      "Ornament vision has a collection-specific structured output contract; a generic ornament/magnet helper would blur distinct schema and prompt requirements.",
    ],
    [
      "artifacts/modules/src/magnets/pages/categories.tsx:CategoryActionMenu:artifacts/modules/src/ornaments/pages/categories.tsx:CategoryActionMenu",
      "Generated API hooks and query keys make this menu adapter domain-specific; a generic menu would expose an unnecessarily wide hook contract.",
    ],
    [
      "artifacts/modules/src/quilting/components/FabricAiLab.tsx:syncCanvasSize:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:syncCanvasSize",
      "The AI Lab canvas has a distinct result and save lifecycle from the crease-removal editor.",
    ],
    [
      "artifacts/modules/src/quilting/components/FabricAiLab.tsx:canvasCoord:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:canvasCoord",
      "The AI Lab canvas reset lifecycle differs from the crease-removal editor.",
    ],
    [
      "artifacts/modules/src/quilting/components/FabricAiLab.tsx:handleOuterWheel:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:handleOuterWheel",
      "The AI Lab canvas editing setup is coupled to its AI-result lifecycle.",
    ],
    [
      "artifacts/modules/src/quilting/components/FabricAiLab.tsx:paint:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:paint",
      "The AI Lab canvas editing action is coupled to its AI-result lifecycle.",
    ],
    [
      "artifacts/modules/src/quilting/components/FabricAiLab.tsx:loadMaskFromDataUrl:artifacts/modules/src/quilting/components/FabricCreaseRemoverModal.tsx:loadMaskFromDataUrl",
      "The AI Lab canvas sizing behavior is coupled to its result/save lifecycle.",
    ],
  ]);

if (DUPLICATE_CODE_EXCEPTION_REASONS.size !== DUPLICATE_CODE_ALLOWLIST.size) {
  throw new Error(
    "Every DUPLICATE_CODE_ALLOWLIST entry needs a finding-specific reason in DUPLICATE_CODE_EXCEPTION_REASONS.",
  );
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

const IDENTIFIER_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
]);

/**
 * Re-scans a standalone body substring (not the full file) so identifiers and
 * literals can be normalized away. A plain (non-parser-driven) scanner cannot
 * perfectly disambiguate JSX `<` from a less-than operator, but that
 * imprecision is consistent between two similar blocks being compared, which
 * is all structural-similarity scoring needs.
 */
export function tokenizeBody(text: string, jsx: boolean): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  const tokens: string[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (IDENTIFIER_KINDS.has(kind)) {
      tokens.push("ID");
    } else if (LITERAL_KINDS.has(kind)) {
      tokens.push("LIT");
    } else {
      tokens.push(scanner.getTokenText() || String(kind));
    }
    kind = scanner.scan();
  }
  return tokens;
}

export function buildShingles(tokens: string[]): Set<string> {
  const shingles = new Set<string>();
  if (tokens.length < SHINGLE_SIZE) {
    shingles.add(tokens.join(" "));
    return shingles;
  }
  for (let i = 0; i <= tokens.length - SHINGLE_SIZE; i++) {
    shingles.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

function functionName(
  node:
    | ts.FunctionDeclaration
    | ts.MethodDeclaration
    | ts.VariableDeclaration
    | ts.PropertyAssignment,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) {
    return node.name.getText(sourceFile);
  }
  return node.name?.getText(sourceFile) ?? "<anonymous>";
}

export function extractBlocks(file: string, content: string): CodeBlock[] {
  const isJsx = file.endsWith(".tsx");
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const blocks: CodeBlock[] = [];

  function addBlock(body: ts.Node, name: string) {
    const bodyText = content.slice(body.getStart(sourceFile), body.getEnd());
    const tokens = tokenizeBody(bodyText, isJsx);
    if (tokens.length < MIN_TOKENS) return;
    const start = sourceFile.getLineAndCharacterOfPosition(
      body.getStart(sourceFile),
    );
    const end = sourceFile.getLineAndCharacterOfPosition(body.getEnd());
    blocks.push({
      file,
      name,
      startLine: start.line + 1,
      endLine: end.line + 1,
      tokenCount: tokens.length,
      normalizedText: tokens.join(" "),
      shingles: buildShingles(tokens),
    });
  }

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      addBlock(node.body, functionName(node, sourceFile));
    } else if (ts.isMethodDeclaration(node) && node.body) {
      addBlock(node.body, functionName(node, sourceFile));
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      node.initializer.body &&
      ts.isBlock(node.initializer.body)
    ) {
      addBlock(node.initializer.body, functionName(node, sourceFile));
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      node.initializer.body &&
      ts.isBlock(node.initializer.body)
    ) {
      addBlock(node.initializer.body, functionName(node, sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return blocks;
}

// ---------------------------------------------------------------------------
// Corpus indexing + matching
// ---------------------------------------------------------------------------

interface Corpus {
  exactIndex: Map<string, CodeBlock[]>;
  shingleIndex: Map<string, CodeBlock[]>;
}

function buildCorpus(blocks: CodeBlock[]): Corpus {
  const exactIndex = new Map<string, CodeBlock[]>();
  const shingleIndex = new Map<string, CodeBlock[]>();
  for (const block of blocks) {
    const exactBucket = exactIndex.get(block.normalizedText);
    if (exactBucket) exactBucket.push(block);
    else exactIndex.set(block.normalizedText, [block]);

    for (const shingle of block.shingles) {
      const bucket = shingleIndex.get(shingle);
      if (bucket) bucket.push(block);
      else shingleIndex.set(shingle, [block]);
    }
  }
  return { exactIndex, shingleIndex };
}

function findBestMatch(
  candidate: CodeBlock,
  corpus: Corpus,
): { block: CodeBlock; similarity: number; kind: "exact" | "near" } | null {
  const exactBucket = corpus.exactIndex.get(candidate.normalizedText);
  const exactMatch = exactBucket?.find((block) => block !== candidate);
  if (exactMatch) {
    return { block: exactMatch, similarity: 1, kind: "exact" };
  }

  const shared = new Map<CodeBlock, number>();
  for (const shingle of candidate.shingles) {
    const bucket = corpus.shingleIndex.get(shingle);
    if (!bucket) continue;
    for (const block of bucket) {
      if (block === candidate) continue;
      shared.set(block, (shared.get(block) ?? 0) + 1);
    }
  }

  let best: { block: CodeBlock; similarity: number } | null = null;
  const minShared = candidate.shingles.size * SHINGLE_OVERLAP_PREFILTER;
  for (const [block, count] of shared) {
    if (count < minShared) continue;
    const shorter = Math.min(candidate.tokenCount, block.tokenCount);
    const longer = Math.max(candidate.tokenCount, block.tokenCount);
    if (shorter / longer < MIN_LENGTH_RATIO) continue;
    const similarity = jaccard(candidate.shingles, block.shingles);
    if (similarity >= SIMILARITY_THRESHOLD) {
      if (!best || similarity > best.similarity) best = { block, similarity };
    }
  }
  return best ? { ...best, kind: "near" } : null;
}

// ---------------------------------------------------------------------------
// Diff-scoped entry point
// ---------------------------------------------------------------------------

export function checkDuplicateCode(
  changedFiles: string[],
  allRepoFiles: string[],
  readFile: (file: string) => string | null,
): DuplicateViolation[] {
  const changedSet = new Set(changedFiles.filter(isScannableFile));
  const corpusFiles = allRepoFiles.filter(
    (f) => isScannableFile(f) && !changedSet.has(f),
  );

  const corpusBlocks: CodeBlock[] = [];
  for (const file of corpusFiles) {
    const content = readFile(file);
    if (content === null) continue;
    try {
      corpusBlocks.push(...extractBlocks(file, content));
    } catch {
      // Unparseable file — skip rather than crash the whole check.
    }
  }
  const corpus = buildCorpus(corpusBlocks);

  const violations: DuplicateViolation[] = [];
  for (const file of changedSet) {
    const content = readFile(file);
    if (content === null) continue;
    let blocks: CodeBlock[];
    try {
      blocks = extractBlocks(file, content);
    } catch {
      continue;
    }
    for (const block of blocks) {
      const match = findBestMatch(block, corpus);
      if (!match) continue;
      const violation: DuplicateViolation = {
        file: block.file,
        line: block.startLine,
        name: block.name,
        matchFile: match.block.file,
        matchLine: match.block.startLine,
        matchName: match.block.name,
        similarity: match.similarity,
        kind: match.kind,
      };
      if (DUPLICATE_CODE_ALLOWLIST.has(duplicateAllowlistKey(violation))) {
        continue;
      }
      violations.push(violation);
    }
  }
  return violations;
}

export const DUPLICATE_CODE_HELP = [
  "Likely duplicate code detected — a function/component in this diff has a",
  "near-identical structure (control flow + punctuation, with names and",
  "literals ignored) to one that already exists elsewhere in the repo.",
  "",
  "This is the generic-programming half of the composition-and-configuration",
  "rule: a function copied and renamed per domain (getPotteryFoo/",
  "getQuiltingFoo/getOrnamentsFoo with the same body) should be one function",
  "parameterized by the difference, not three near-identical copies.",
  "",
  "Fix: extract the shared logic to the narrowest appropriate lib/* package",
  "(or a focused server lib) and parameterize the difference via generics,",
  "configuration, or an adapter — then have both call sites import it.",
  "",
  "If the two blocks are genuinely independent and only superficially",
  "similar today, add 'path/to/file.ts:lineNumber' (the flagged side) to",
  "DUPLICATE_CODE_ALLOWLIST in scripts/src/check-duplicate-code.ts with a",
  "comment explaining why extraction would make the contract less coherent.",
  "Do not rename or reformat around the check to dodge it.",
].join("\n");

// ---------------------------------------------------------------------------
// Git-backed wiring (diff mode) + whole-repo audit mode
// ---------------------------------------------------------------------------

function listRepoFiles(root: string): string[] {
  const files = [
    ...walkFiles(`${root}/artifacts`, [".ts", ".tsx"]),
    ...walkFiles(`${root}/lib`, [".ts", ".tsx"]),
  ];
  return files.map((f) => f.slice(root.length + 1));
}

export function runDuplicateCodeCheck(base: string): DuplicateViolation[] {
  const root = repoRoot();
  const resolvedBase = resolveBase(root, base);
  const changedFiles = getChangedFiles(root, resolvedBase);
  const allRepoFiles = listRepoFiles(root);
  return checkDuplicateCode(changedFiles, allRepoFiles, (f) =>
    readFileOrNull(root, f),
  );
}

/**
 * Whole-repo report-only pass: for every eligible block, find its best match
 * among all OTHER blocks in the repo and report each pair once. Sizes the
 * existing backlog; does not fail the build.
 */
export function runDuplicateCodeAudit(): DuplicateViolation[] {
  const root = repoRoot();
  const allRepoFiles = listRepoFiles(root).filter(isScannableFile);
  return checkDuplicateCodeAudit(allRepoFiles, (file) =>
    readFileOrNull(root, file),
  );
}

/**
 * Whole-repository report-only pass against an arbitrary file snapshot.
 *
 * The architecture-policy check uses this overload for both the merge-base
 * snapshot and the working tree. Keeping the detector's pure inputs explicit
 * prevents the policy from copying a second duplicate-code implementation.
 */
export function checkDuplicateCodeAudit(
  allRepoFiles: string[],
  readFile: (file: string) => string | null,
): DuplicateViolation[] {
  const scannableFiles = allRepoFiles.filter(isScannableFile);

  const allBlocks: CodeBlock[] = [];
  for (const file of scannableFiles) {
    const content = readFile(file);
    if (content === null) continue;
    try {
      allBlocks.push(...extractBlocks(file, content));
    } catch {
      // skip unparseable file
    }
  }
  const corpus = buildCorpus(allBlocks);
  const reportedPairs = new Set<string>();
  const violations: DuplicateViolation[] = [];

  for (const block of allBlocks) {
    // Exclude the block's own bucket entry from matching itself.
    const withoutSelf: Corpus = {
      exactIndex: corpus.exactIndex,
      shingleIndex: corpus.shingleIndex,
    };
    const match = findBestMatch(block, withoutSelf);
    if (!match || match.block === block) continue;
    const key = [
      `${block.file}:${block.startLine}`,
      `${match.block.file}:${match.block.startLine}`,
    ]
      .sort()
      .join("|");
    if (reportedPairs.has(key)) continue;
    reportedPairs.add(key);
    violations.push({
      file: block.file,
      line: block.startLine,
      name: block.name,
      matchFile: match.block.file,
      matchLine: match.block.startLine,
      matchName: match.block.name,
      similarity: match.similarity,
      kind: match.kind,
    });
  }
  return violations;
}

function getArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1] as string;
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function reportViolation(v: DuplicateViolation): void {
  const pct = Math.round(v.similarity * 100);
  console.error(
    `${v.file}:${v.line} (${v.name}) — ${v.kind} match (${pct}%) of ` +
      `${v.matchFile}:${v.matchLine} (${v.matchName})`,
  );
}

function main(): void {
  if (hasFlag("audit")) {
    const violations = runDuplicateCodeAudit();
    console.log(
      "Duplicate-code audit (whole repo, report-only — does not fail the build)\n",
    );
    for (const v of violations) reportViolation(v);
    console.log(
      `\n${violations.length} likely duplicate pair(s) found across artifacts/ and lib/.`,
    );
    return;
  }

  const base = getArg("base", "origin/main");
  let violations: DuplicateViolation[];
  try {
    violations = runDuplicateCodeCheck(base);
  } catch (error) {
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("ERROR: Ban: likely duplicate code");
    console.error("");
    console.error((error as Error).message);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exitCode = 1;
    return;
  }

  if (violations.length === 0) {
    console.log("✓ Ban: likely duplicate code — none found in this diff");
    return;
  }

  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("ERROR: Ban: likely duplicate code");
  console.error("");
  for (const v of violations) reportViolation(v);
  console.error("");
  console.error(DUPLICATE_CODE_HELP);
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exitCode = 1;
}

if (
  fs.realpathSync(process.argv[1] ?? "") ===
  fs.realpathSync(new URL(import.meta.url).pathname)
) {
  main();
}
