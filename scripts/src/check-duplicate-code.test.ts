import assert from "node:assert/strict";
import {
  isScannableFile,
  tokenizeBody,
  buildShingles,
  extractBlocks,
  checkDuplicateCode,
  checkDuplicateCodeAudit,
} from "./check-duplicate-code.js";

// --- isScannableFile ---
assert.equal(
  isScannableFile("artifacts/api-server/src/routes/pottery.ts"),
  true,
);
assert.equal(isScannableFile("lib/db/src/schema/pottery.ts"), true);
assert.equal(isScannableFile("scripts/src/check-scheduler-names.ts"), false);
assert.equal(
  isScannableFile("artifacts/api-server/src/routes/pottery.test.ts"),
  false,
);
assert.equal(
  isScannableFile("lib/api-zod/src/generated/pottery.generated.ts"),
  false,
);
assert.equal(
  isScannableFile("lib/api-client-react/src/generated/api.ts"),
  false,
  "generated client source",
);
assert.equal(
  isScannableFile("scripts/src/check-duplicate-code.ts"),
  false,
  "self-exempt",
);
assert.equal(isScannableFile("artifacts/web/src/App.tsx"), true);

// --- tokenizeBody: identifiers/literals normalized, structure kept ---
const tokensA = tokenizeBody(
  "{ const total = amount + 5; return total; }",
  false,
);
const tokensB = tokenizeBody("{ const sum = value + 12; return sum; }", false);
assert.deepEqual(
  tokensA,
  tokensB,
  "renamed identifiers and different numeric literals normalize to the same token stream",
);
assert.ok(tokensA.includes("ID"), "identifiers become ID");
assert.ok(tokensA.includes("LIT"), "numeric literals become LIT");
assert.ok(tokensA.includes("const"), "keywords are preserved");
assert.ok(tokensA.includes("+"), "operators are preserved");

const tokensDifferentShape = tokenizeBody(
  "{ if (amount > 5) { return amount; } }",
  false,
);
assert.notDeepEqual(
  tokensA,
  tokensDifferentShape,
  "different control flow shapes do not normalize to the same stream",
);

// --- buildShingles ---
const shingles = buildShingles(["a", "b", "c", "d"]);
assert.equal(
  shingles.size,
  1,
  "shorter-than-window token list becomes one shingle",
);
const longShingles = buildShingles(
  Array.from({ length: 20 }, (_, i) => `t${i}`),
);
assert.equal(longShingles.size, 20 - 12 + 1);

// --- extractBlocks: shared fixture bodies (~130 tokens each, well above MIN_TOKENS) ---
function makeFunctionSource(fnName: string, varPrefix: string): string {
  return `
export function ${fnName}(items: { id: string; value: number }[], threshold: number) {
  let ${varPrefix}Total = 0;
  const ${varPrefix}Results: { id: string; value: number; flag: boolean }[] = [];
  for (const item of items) {
    if (item.value > threshold) {
      ${varPrefix}Total += item.value;
      ${varPrefix}Results.push({ id: item.id, value: item.value, flag: true });
    } else {
      ${varPrefix}Total -= item.value;
      ${varPrefix}Results.push({ id: item.id, value: item.value, flag: false });
    }
  }
  if (${varPrefix}Total > 100) {
    console.log("high total", ${varPrefix}Total);
  } else {
    console.log("low total", ${varPrefix}Total);
  }
  return { total: ${varPrefix}Total, results: ${varPrefix}Results };
}
`;
}

const potterySource = makeFunctionSource("summarizePotteryBatch", "pottery");
const quiltingSource = makeFunctionSource("summarizeQuiltingBatch", "quilting");
const unrelatedSource = `
export function formatDisplayName(user: { first: string; last: string }) {
  const parts = [user.first, user.last].filter(Boolean);
  return parts.join(" ").trim().toUpperCase();
}
`;

const potteryBlocks = extractBlocks(
  "artifacts/api-server/src/a.ts",
  potterySource,
);
assert.equal(potteryBlocks.length, 1);
assert.equal(potteryBlocks[0]?.name, "summarizePotteryBatch");
assert.ok(
  potteryBlocks[0]!.tokenCount >= 80,
  `expected fixture body to clear MIN_TOKENS, got ${potteryBlocks[0]?.tokenCount}`,
);

const tinyBlocks = extractBlocks(
  "artifacts/api-server/src/tiny.ts",
  "export function tiny(x: number) { return x + 1; }",
);
assert.equal(
  tinyBlocks.length,
  0,
  "bodies below MIN_TOKENS are not eligible blocks",
);

// --- checkDuplicateCode: renamed near-identical function flagged as the reported side's issue ---
const files: Record<string, string> = {
  "artifacts/api-server/src/pottery.ts": potterySource,
  "artifacts/api-server/src/quilting.ts": quiltingSource,
  "artifacts/api-server/src/formatting.ts": unrelatedSource,
};
const readFile = (f: string): string | null => files[f] ?? null;

const violations = checkDuplicateCode(
  ["artifacts/api-server/src/pottery.ts"],
  Object.keys(files),
  readFile,
);
assert.equal(
  violations.length,
  1,
  "the renamed structural duplicate is flagged",
);
assert.equal(violations[0]?.matchFile, "artifacts/api-server/src/quilting.ts");
assert.equal(violations[0]?.matchName, "summarizeQuiltingBatch");
assert.equal(violations[0]?.kind, "exact");

const importCleanupFiles = {
  ...files,
  "artifacts/api-server/src/pottery.ts": `import { used } from "./used";\n${potterySource}`,
};
assert.equal(
  checkDuplicateCode(
    ["artifacts/api-server/src/pottery.ts"],
    Object.keys(importCleanupFiles),
    (file) =>
      importCleanupFiles[file as keyof typeof importCleanupFiles] ?? null,
    (file) =>
      file === "artifacts/api-server/src/pottery.ts"
        ? `import { used, unused } from "./used";\n\n${potterySource}`
        : null,
  ).length,
  0,
  "import-only edits and line shifts must not flag unchanged legacy bodies",
);
for (const previousBody of [
  potterySource.replace("value > threshold", "value < threshold"),
  potterySource.replace("100", "99"),
  potterySource.replaceAll("potteryTotal", "previousTotal"),
]) {
  assert.equal(
    checkDuplicateCode(
      ["artifacts/api-server/src/pottery.ts"],
      Object.keys(files),
      readFile,
      (file) =>
        file === "artifacts/api-server/src/pottery.ts" ? previousBody : null,
    ).length,
    1,
    "changed operators, literals, and bindings must remain duplicate candidates",
  );
}
assert.equal(
  checkDuplicateCode(
    ["artifacts/api-server/src/pottery.ts"],
    Object.keys(files),
    readFile,
    (file) =>
      file === "artifacts/api-server/src/pottery.ts"
        ? potterySource.replaceAll("summarizePotteryBatch", "olderName")
        : null,
  ).length,
  1,
  "renaming a body without changing its contents must not bypass detection",
);
assert.equal(
  checkDuplicateCode(
    ["artifacts/api-server/src/pottery.ts"],
    Object.keys(files),
    readFile,
    () => null,
  ).length,
  1,
  "new files with no base snapshot remain fully checked",
);

const originalMethod = `class Original { ${potterySource.replace("export function ", "")} }`;
const addedMethod = `class Added { ${potterySource.replace("export function ", "")} }`;
assert.equal(
  checkDuplicateCode(
    ["artifacts/api-server/src/pottery.ts"],
    Object.keys(files),
    (file) =>
      file === "artifacts/api-server/src/pottery.ts"
        ? `${originalMethod}\n${addedMethod}`
        : readFile(file),
    (file) =>
      file === "artifacts/api-server/src/pottery.ts" ? originalMethod : null,
  ).length,
  1,
  "an additional body with the same name must not consume an existing body's exemption twice",
);

const noViolations = checkDuplicateCode(
  ["artifacts/api-server/src/formatting.ts"],
  Object.keys(files),
  readFile,
);
assert.equal(
  noViolations.length,
  0,
  "a structurally unrelated function is not flagged",
);

// The whole-repository audit must ignore a candidate's own corpus entry before
// choosing its best match. This pair is deliberately near (not exact): one
// comparison operator differs while a long repeated structure keeps the
// Jaccard similarity above the threshold.
const nearFiller = `for (const extra of items) {
  if (extra.value > threshold) {
    potteryTotal += extra.value;
    potteryResults.push({ id: extra.id, value: extra.value, flag: true });
  }
}
`.repeat(10);
const nearBaseSource = `
export function summarizeNearBatch(items: { id: string; value: number }[], threshold: number) {
  let potteryTotal = 0;
  const potteryResults: { id: string; value: number; flag: boolean }[] = [];
  ${nearFiller}
  return { total: potteryTotal, results: potteryResults };
}
`;
const nearSource = nearBaseSource.replace(
  "extra.value > threshold",
  "extra.value >= threshold",
);
const auditViolations = checkDuplicateCodeAudit(
  [
    "artifacts/api-server/src/pottery.ts",
    "artifacts/api-server/src/near.ts",
    "artifacts/api-server/src/near-copy.ts",
  ],
  (file) =>
    ({
      "artifacts/api-server/src/pottery.ts": potterySource,
      "artifacts/api-server/src/near.ts": nearBaseSource,
      "artifacts/api-server/src/near-copy.ts": nearSource,
    })[file] ?? null,
);
assert.ok(
  auditViolations.some(
    (violation) =>
      violation.file === "artifacts/api-server/src/near.ts" &&
      violation.kind === "near",
  ),
  "audit reports a real non-exact match instead of discarding a self match",
);

console.log("check-duplicate-code.test.ts passed");
