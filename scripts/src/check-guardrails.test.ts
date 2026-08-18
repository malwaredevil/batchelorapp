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
  checkScaffoldedTodosFromFiles,
  SCAFFOLDED_TOOLS_DIR,
  checkDomainActionConfirmLabels,
  DOMAIN_ACTION_FILES,
  checkCapabilityConfigTodos,
  CAPABILITY_CONFIG_FILES,
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

// A removed entry whose action type was deleted everywhere else in the same
// change (isActionStillLive returns false) is dead weight, not a loosening.
assert.deepEqual(
  checkExclusionSetShrink(shrunkSource, baseSource, () => false),
  [],
);
// But if even one removed entry's action type is still callable elsewhere,
// it's a real loosening and must still fail.
assert.equal(
  checkExclusionSetShrink(
    shrunkSource,
    baseSource,
    (actionType) => actionType === "delete_trip",
  ).length > 0,
  true,
);

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

// --- scaffolded Elaine tool TODO(scaffold) stubs ---
const STUB_PATH = `${SCAFFOLDED_TOOLS_DIR}/add-pottery-note.ts`;
const STUB_TEST_PATH = `${SCAFFOLDED_TOOLS_DIR}/add-pottery-note.test.ts`;

// A freshly-scaffolded stub file with TODO(scaffold) markers → violations.
const stubWithTodos = `
export async function executeAddPotteryNoteAction(payload, userId) {
  // TODO(scaffold): implement the real business logic for add_pottery_note.
  return { status: 501, body: { error: "not implemented" } };
}
export const addPotteryNoteTool = {
  type: "function",
  function: {
    name: "add_pottery_note",
    description: "TODO(scaffold): describe when the model should call add_pottery_note.",
  },
};
`;
assert.deepEqual(
  checkScaffoldedTodosFromFiles([STUB_PATH], () => stubWithTodos),
  [
    `${STUB_PATH}:3:// TODO(scaffold): implement the real business logic for add_pottery_note.`,
    `${STUB_PATH}:10:description: "TODO(scaffold): describe when the model should call add_pottery_note.",`,
  ],
  "stub file with TODO(scaffold) markers → violations",
);

// A fully-implemented stub with no TODO markers → no violations.
const stubImplemented = `
export async function executeAddPotteryNoteAction(payload, userId) {
  // real implementation here
  return { status: 200, body: { ok: true } };
}
export const addPotteryNoteTool = {
  type: "function",
  function: {
    name: "add_pottery_note",
    description: "Adds a note to a pottery item. Call when the user says they want to note something about a piece.",
  },
};
`;
assert.deepEqual(
  checkScaffoldedTodosFromFiles([STUB_PATH], () => stubImplemented),
  [],
  "fully-implemented stub → no violations",
);

// Placeholder test files (*.test.ts) are exempt even if they contain TODO(scaffold).
const testFileWithTodo = `
// TODO(scaffold): replace the 501 assertion with real behavioural tests.
it("returns 501 until implemented", async () => {
  expect(result.status).toBe(501);
});
`;
assert.deepEqual(
  checkScaffoldedTodosFromFiles([STUB_TEST_PATH], () => testFileWithTodo),
  [],
  "placeholder *.test.ts files are exempt from the TODO(scaffold) check",
);

// Files outside the scaffolded-tools directory are not scanned.
const outsideStub = "artifacts/api-server/src/elaine/pottery-actions.ts";
assert.deepEqual(
  checkScaffoldedTodosFromFiles([outsideStub], () => stubWithTodos),
  [],
  "files outside scaffolded-tools/ are not scanned",
);

// Non-.ts files inside the directory are also ignored.
const nonTsFile = `${SCAFFOLDED_TOOLS_DIR}/README.md`;
assert.deepEqual(
  checkScaffoldedTodosFromFiles([nonTsFile], () => stubWithTodos),
  [],
  "non-.ts files inside scaffolded-tools/ are not scanned",
);

// Deleted files (readFile returns null) are skipped.
assert.deepEqual(
  checkScaffoldedTodosFromFiles([STUB_PATH], () => null),
  [],
  "deleted files are skipped",
);

// Multiple stubs: only the unfinished one is flagged.
const STUB_PATH_2 = `${SCAFFOLDED_TOOLS_DIR}/delete-pottery-item.ts`;
assert.deepEqual(
  checkScaffoldedTodosFromFiles(
    [STUB_PATH, STUB_PATH_2],
    (file) => (file === STUB_PATH ? stubWithTodos : stubImplemented), // second stub is finished
  ).every((v) => v.startsWith(STUB_PATH + ":")),
  true,
  "only the unfinished stub produces violations when mixed with a finished one",
);

// --- domain action TODO confirm labels ---
const POTTERY_ACTIONS_PATH = DOMAIN_ACTION_FILES[0]!; // pottery-actions.ts
const QUILTING_ACTIONS_PATH = DOMAIN_ACTION_FILES[1]!; // quilting-actions.ts
const ORNAMENTS_ACTIONS_PATH = DOMAIN_ACTION_FILES[2]!; // ornaments-actions.ts

// A domain action file with a scaffolded TODO confirm label → violation.
const actionFileWithTodoLabel = `
export function getConfirmLabel(type: string): string {
  switch (type) {
    case "add_pottery_note":
      return "TODO: confirm add_pottery_note";
    default:
      return "Confirm action";
  }
}
`;
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [POTTERY_ACTIONS_PATH],
    () => actionFileWithTodoLabel,
  ),
  [`${POTTERY_ACTIONS_PATH}:5:return "TODO: confirm add_pottery_note";`],
  "domain action file with TODO confirm label → violation",
);

// A domain action file with the label replaced → no violation.
const actionFileWithRealLabel = `
export function getConfirmLabel(type: string, name: string): string {
  switch (type) {
    case "add_pottery_note":
      return \`Add note to "\${name}"\`;
    default:
      return "Confirm action";
  }
}
`;
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [POTTERY_ACTIONS_PATH],
    () => actionFileWithRealLabel,
  ),
  [],
  "domain action file with real label → no violation",
);

// Unrelated TODO strings in those files are not flagged.
const actionFileWithUnrelatedTodo = `
// TODO: improve error handling here
// TODO(scaffold): covered by the scaffolded-tools check, not this one
export function doSomething(): void {}
`;
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [POTTERY_ACTIONS_PATH],
    () => actionFileWithUnrelatedTodo,
  ),
  [],
  "unrelated TODO strings in domain action files → not flagged",
);

// Multiple domain action files: only the one with a violation is flagged.
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [POTTERY_ACTIONS_PATH, QUILTING_ACTIONS_PATH],
    (file) =>
      file === POTTERY_ACTIONS_PATH
        ? actionFileWithTodoLabel
        : actionFileWithRealLabel,
  ).every((v) => v.startsWith(POTTERY_ACTIONS_PATH + ":")),
  true,
  "only the file with a TODO confirm label is flagged when multiple are checked",
);

// Files outside DOMAIN_ACTION_FILES are not scanned.
const outsideDomainFile =
  "artifacts/api-server/src/elaine/capability-registry.ts";
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [outsideDomainFile],
    () => actionFileWithTodoLabel,
  ),
  [],
  "files outside DOMAIN_ACTION_FILES are not scanned",
);

// Deleted files (readFile returns null) are skipped.
assert.deepEqual(
  checkDomainActionConfirmLabels([POTTERY_ACTIONS_PATH], () => null),
  [],
  "deleted domain action files are skipped",
);

// Quilting and ornaments paths are also covered.
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [QUILTING_ACTIONS_PATH],
    () => actionFileWithTodoLabel,
  ).length > 0,
  true,
  "quilting-actions.ts is scanned",
);
assert.deepEqual(
  checkDomainActionConfirmLabels(
    [ORNAMENTS_ACTIONS_PATH],
    () => actionFileWithTodoLabel,
  ).length > 0,
  true,
  "ornaments-actions.ts is scanned",
);

// --- capability/channel config TODO(scaffold) markers ---
const CAPABILITY_REGISTRY_PATH = CAPABILITY_CONFIG_FILES[0]!;
const RESTRICTED_CONFIG_PATH = CAPABILITY_CONFIG_FILES[1]!;

// capability-registry.ts with a TODO(scaffold) marker → violation.
const capabilityFileWithTodo = `
// TODO(scaffold): add the new tool to the appropriate policy row below.
...policies(["add_pottery_note"], { ...ACTION_DEFAULTS, domain: "pottery", executorPrefix: "potteryAction" }),
`;
assert.deepEqual(
  checkCapabilityConfigTodos(
    [CAPABILITY_REGISTRY_PATH],
    () => capabilityFileWithTodo,
  ),
  [
    `${CAPABILITY_REGISTRY_PATH}:2:// TODO(scaffold): add the new tool to the appropriate policy row below.`,
  ],
  "capability-registry.ts with TODO(scaffold) → violation",
);

// restricted-channel-config.ts with a TODO(scaffold) marker → violation.
const restrictedConfigWithTodo = `
// TODO(scaffold): decide if add_pottery_note goes in allowed or excluded list.
"add_pottery_note",
`;
assert.deepEqual(
  checkCapabilityConfigTodos(
    [RESTRICTED_CONFIG_PATH],
    () => restrictedConfigWithTodo,
  ),
  [
    `${RESTRICTED_CONFIG_PATH}:2:// TODO(scaffold): decide if add_pottery_note goes in allowed or excluded list.`,
  ],
  "restricted-channel-config.ts with TODO(scaffold) → violation",
);

// capability-registry.ts with no TODO(scaffold) markers → no violation.
const capabilityFileClean = `
...policies(["add_pottery_note"], { ...ACTION_DEFAULTS, domain: "pottery", executorPrefix: "potteryAction" }),
`;
assert.deepEqual(
  checkCapabilityConfigTodos(
    [CAPABILITY_REGISTRY_PATH],
    () => capabilityFileClean,
  ),
  [],
  "capability-registry.ts with no TODO(scaffold) → no violation",
);

// Unrelated TODO strings (not TODO(scaffold)) are not flagged.
const capabilityFileWithUnrelatedTodo = `
// TODO: consider widening to ALL_READ_CHANNELS later
// TODO: confirm this is correct
...policies(["some_tool"], { ...ACTION_DEFAULTS }),
`;
assert.deepEqual(
  checkCapabilityConfigTodos(
    [CAPABILITY_REGISTRY_PATH],
    () => capabilityFileWithUnrelatedTodo,
  ),
  [],
  "unrelated TODO strings in capability config files are not flagged",
);

// Files outside CAPABILITY_CONFIG_FILES are not scanned.
const outsideCapabilityFile =
  "artifacts/api-server/src/elaine/pottery-actions.ts";
assert.deepEqual(
  checkCapabilityConfigTodos(
    [outsideCapabilityFile],
    () => capabilityFileWithTodo,
  ),
  [],
  "files outside CAPABILITY_CONFIG_FILES are not scanned",
);

// Deleted files (readFile returns null) are skipped.
assert.deepEqual(
  checkCapabilityConfigTodos([CAPABILITY_REGISTRY_PATH], () => null),
  [],
  "deleted capability config files are skipped",
);

console.log("✓ check-guardrails tests passed");
