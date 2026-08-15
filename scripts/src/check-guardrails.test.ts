import assert from "node:assert/strict";
import {
  checkDrizzleKitPushFromDiff,
  checkRestrictedFilesFromList,
  checkAdHocOpenAIFromFiles,
  checkPassOnStoreErrorFromFiles,
  checkDestructiveSqlFromDiff,
  checkExclusionSetShrink,
  countExclusionEntries,
  checkElaineChatTestMissingLessonsMock,
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

// .replit-artifact/ carve-out: artifact.toml is allowed through, everything else is restricted.
assert.deepEqual(
  checkRestrictedFilesFromList([".replit-artifact/artifact.toml"]),
  [],
  ".replit-artifact/artifact.toml must be allowed (no secrets, needed for registry)",
);
assert.deepEqual(
  checkRestrictedFilesFromList([".replit-artifact/other-file.txt"]),
  [".replit-artifact/other-file.txt"],
  "other files under .replit-artifact/ must still be flagged",
);
assert.deepEqual(
  checkRestrictedFilesFromList([".replit-artifact/secrets.env"]),
  [".replit-artifact/secrets.env"],
  "secret-like files under .replit-artifact/ must be flagged",
);
// Nested paths (artifact inside a subdir) follow the same rule.
assert.deepEqual(
  checkRestrictedFilesFromList([
    "artifacts/web/.replit-artifact/artifact.toml",
  ]),
  [],
  "nested .replit-artifact/artifact.toml must be allowed",
);
assert.deepEqual(
  checkRestrictedFilesFromList(["artifacts/web/.replit-artifact/other.json"]),
  ["artifacts/web/.replit-artifact/other.json"],
  "nested .replit-artifact/ non-toml files must be flagged",
);
// .replit itself stays fully restricted.
assert.deepEqual(
  checkRestrictedFilesFromList([".replit"]),
  [".replit"],
  ".replit must always be flagged",
);

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
  checkDestructiveSqlFromDiff(
    "+DROP TABLE foo;\n+CREATE TABLE IF NOT EXISTS bar (id int);\n",
  ),
  ["+DROP TABLE foo;"],
);
assert.deepEqual(
  checkDestructiveSqlFromDiff("+-- DROP TABLE foo; (example in a comment)\n"),
  [],
);

// --- exclusion set shrink ---
const baseSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE = [
  "delete_pottery_item",
  // A per-entry explanatory comment, like the real file has for several
  // entries — must not push later entries out of the counted window.
  "delete_trip",
  "delete_ornament",
];
`;
const shrunkSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE = [
  "delete_pottery_item",
];
`;
const grownSource = `
export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE = [
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

// --- Elaine chat integration tests must mock elaine-lessons ---
const ELAINE_TEST_PATH = "artifacts/api-server/src/elaine/my-feature.test.ts";

// Content that hits the chat route AND has the lessons mock → no violation.
const withMockAndRoute = `
vi.mock("../lib/elaine-lessons", () => ({
  ELAINE_LESSON_DOMAINS: ["general"],
  getRelevantElaineLessons: vi.fn().mockResolvedValue({ lessons: [], evidenceBlock: "" }),
  recordElaineLesson: vi.fn().mockResolvedValue(undefined),
}));
// later...
await request(app).post("/elaine/chat").send({ message: "hi" });
`;
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock(
    [ELAINE_TEST_PATH],
    () => withMockAndRoute,
  ),
  [],
  "chat route + lessons mock → no violation",
);

// Content that hits the chat route but OMITS the lessons mock → violation.
const missingMock = `
// elaine-lessons mock deliberately absent from this fixture
await request(app).post("/elaine/chat").send({ message: "hi" });
`;
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock([ELAINE_TEST_PATH], () => missingMock),
  [ELAINE_TEST_PATH],
  "chat route without lessons mock → violation",
);

// File that does NOT hit the chat route → no violation even without the mock.
const noRoute = `
vi.fn(); // no chat route reference
await request(app).post("/elaine/action").send({});
`;
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock([ELAINE_TEST_PATH], () => noRoute),
  [],
  "non-chat route file → no violation regardless of mock",
);

// Full-path variant: "/api/elaine/chat" also counts as the chat route.
const fullPathRoute = `
await request(app).post("/api/elaine/chat").send({ message: "hi" });
`;
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock(
    [ELAINE_TEST_PATH],
    () => fullPathRoute,
  ),
  [ELAINE_TEST_PATH],
  "/api/elaine/chat (full-path) without mock → violation",
);

// Files outside the elaine directory are not scanned.
const outsideElaine = "artifacts/api-server/src/routes/travels/my.test.ts";
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock([outsideElaine], () => missingMock),
  [],
  "file outside elaine/ → not scanned",
);

// Deleted files (readFile returns null) are skipped.
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock([ELAINE_TEST_PATH], () => null),
  [],
  "deleted file → skipped",
);

// Non-.test.ts files are not scanned.
const nonTestPath = "artifacts/api-server/src/elaine/index.ts";
assert.deepEqual(
  checkElaineChatTestMissingLessonsMock([nonTestPath], () => missingMock),
  [],
  "non-test file → not scanned",
);

console.log("✓ check-guardrails tests passed");
