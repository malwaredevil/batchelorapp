import assert from "node:assert/strict";
import {
  checkDrizzleKitPushFromDiff,
  checkRestrictedFilesFromList,
  checkAdHocOpenAIFromFiles,
  checkPassOnStoreErrorFromFiles,
  checkDestructiveSqlFromDiff,
  checkExclusionSetShrink,
  countExclusionEntries,
} from "./check-guardrails.js";

// --- drizzle-kit push ---
assert.deepEqual(
  checkDrizzleKitPushFromDiff("+const cmd = 'drizzle-kit push';\n-old line\n"),
  ["+const cmd = 'drizzle-kit push';"],
);
assert.deepEqual(
  checkDrizzleKitPushFromDiff("+++ b/file.ts\n+harmless line\n"),
  [],
);

// --- restricted files ---
assert.deepEqual(
  checkRestrictedFilesFromList([
    "src/index.ts",
    ".agents/memory/foo.md",
    ".env",
    "artifacts/web/src/App.tsx",
  ]),
  [".agents/memory/foo.md", ".env"],
);
assert.deepEqual(checkRestrictedFilesFromList(["src/index.ts"]), []);

// --- ad-hoc OpenAI ---
const filesWithViolation = ["artifacts/api-server/src/lib/foo.ts"];
const contentWithViolation = "const x = 1;\nconst client = new OpenAI();\n";
assert.deepEqual(
  checkAdHocOpenAIFromFiles(filesWithViolation, () => contentWithViolation),
  ["artifacts/api-server/src/lib/foo.ts:2:const client = new OpenAI();"],
);
const contentExempt =
  "const x = 1;\n// openai-direct-ok\nconst client = new OpenAI();\n";
assert.deepEqual(
  checkAdHocOpenAIFromFiles(filesWithViolation, () => contentExempt),
  [],
);
// Outside artifacts/api-server/src is not scanned.
assert.deepEqual(
  checkAdHocOpenAIFromFiles(
    ["scripts/src/check-domain-composition.ts"],
    () => contentWithViolation,
  ),
  [],
);
// Deleted files (readFile returns null) are skipped.
assert.deepEqual(
  checkAdHocOpenAIFromFiles(filesWithViolation, () => null),
  [],
);

// --- passOnStoreError ---
assert.deepEqual(
  checkPassOnStoreErrorFromFiles(
    ["artifacts/api-server/src/lib/rate-limit.ts"],
    () => "export const limiter = { passOnStoreError: true };",
  ),
  [
    "artifacts/api-server/src/lib/rate-limit.ts:1:export const limiter = { passOnStoreError: true };",
  ],
);
assert.deepEqual(
  checkPassOnStoreErrorFromFiles(
    ["artifacts/api-server/src/lib/rate-limit.ts"],
    () => "export const limiter = { passOnStoreError: false };",
  ),
  [],
);

// --- destructive SQL ---
assert.deepEqual(
  checkDestructiveSqlFromDiff("+DROP TABLE foo;\n+CREATE TABLE IF NOT EXISTS bar (id int);\n"),
  ["+DROP TABLE foo;"],
);
assert.deepEqual(
  checkDestructiveSqlFromDiff("+-- DROP TABLE foo; (example in a comment)\n"),
  [],
);

// --- exclusion set shrink ---
const baseSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES = [
  "delete_pottery_item",
  "delete_trip",
  "delete_ornament",
];
`;
const shrunkSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES = [
  "delete_pottery_item",
];
`;
const grownSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES = [
  "delete_pottery_item",
  "delete_trip",
  "delete_ornament",
  "delete_fabric",
];
`;
assert.equal(countExclusionEntries(baseSource), 3);
assert.deepEqual(
  checkExclusionSetShrink(shrunkSource, baseSource).length > 0,
  true,
);
assert.deepEqual(checkExclusionSetShrink(grownSource, baseSource), []);
assert.deepEqual(checkExclusionSetShrink(baseSource, baseSource), []);
// Missing base (new file / new repo) never counts as a shrink.
assert.deepEqual(checkExclusionSetShrink(shrunkSource, null), []);

console.log("✓ check-guardrails tests passed");
