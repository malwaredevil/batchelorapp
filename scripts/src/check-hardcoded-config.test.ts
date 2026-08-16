import assert from "node:assert/strict";
import {
  isTunableCamelName,
  isTunableConstName,
  isScannableFile,
  findTunableClustersInFile,
  findTunableConstantsInFile,
  checkHardcodedConfigFromFiles,
} from "./check-hardcoded-config.js";

// --- isTunableCamelName ---
assert.equal(isTunableCamelName("maxModelRounds"), true);
assert.equal(isTunableCamelName("maxToolCalls"), true);
assert.equal(isTunableCamelName("maxReplans"), true);
assert.equal(isTunableCamelName("maxElapsedMs"), true);
assert.equal(isTunableCamelName("requestTimeoutMs"), true);
assert.equal(isTunableCamelName("idleCooldownMs"), true);
assert.equal(isTunableCamelName("pageSize"), true);
assert.equal(isTunableCamelName("retryBudget"), true);
assert.equal(isTunableCamelName("userId"), false);
assert.equal(isTunableCamelName("index"), false);
assert.equal(isTunableCamelName("name"), false);
assert.equal(
  isTunableCamelName("retries"),
  true,
  "bare keyword word on its own still counts",
);
assert.equal(
  isTunableCamelName("totalCount"),
  false,
  "Count is not a recognized keyword",
);

// --- isTunableConstName ---
assert.equal(isTunableConstName("MAX_UPLOAD_MB"), true);
assert.equal(isTunableConstName("DEFAULT_TIMEOUT_MS"), true);
assert.equal(isTunableConstName("REQUEST_BUDGET"), true);
assert.equal(isTunableConstName("IDLE_COOLDOWN_MS"), true);
assert.equal(
  isTunableConstName("RETRY_COUNT"),
  false,
  "not in the suffix allowlist",
);
assert.equal(
  isTunableConstName("colorName"),
  false,
  "not SCREAMING_SNAKE_CASE",
);

// --- isScannableFile ---
assert.equal(isScannableFile("artifacts/api-server/src/elaine/index.ts"), true);
assert.equal(
  isScannableFile("artifacts/api-server/src/elaine/admin-config.ts"),
  false,
);
assert.equal(
  isScannableFile("artifacts/api-server/src/lib/elaine-config.ts"),
  false,
);
assert.equal(isScannableFile("lib/db/src/schema/elaine.ts"), false);
assert.equal(isScannableFile("lib/db/src/schema-statements.ts"), false);
assert.equal(
  isScannableFile("artifacts/api-server/src/elaine/index.test.ts"),
  false,
);
assert.equal(
  isScannableFile("artifacts/api-server/src/elaine/foo.generated.ts"),
  false,
);
assert.equal(
  isScannableFile("scripts/src/check-hardcoded-config.ts"),
  false,
  "self-exempt",
);
assert.equal(isScannableFile("artifacts/web/src/App.tsx"), true);

// --- findTunableClustersInFile: the real runtime-budget shape ---
const budgetFixture = `
const runtime = new ElaineTurnRuntime({
  budget: {
    maxModelRounds: 4,
    maxToolCalls: 16,
    maxReplans: 2,
    maxElapsedMs: 120_000,
  },
});
`;
const clusters = findTunableClustersInFile(budgetFixture);
assert.equal(clusters.length, 1);
assert.deepEqual(clusters[0]?.names, [
  "maxModelRounds",
  "maxToolCalls",
  "maxReplans",
  "maxElapsedMs",
]);

// A single tunable-looking key with non-tunable siblings should NOT cluster.
const singleFixture = `
const options = {
  maxRetries: 3,
  name: "foo",
  enabled: true,
};
`;
assert.equal(findTunableClustersInFile(singleFixture).length, 0);

// Two tunable keys far apart (different objects) should not cluster together.
const farApartFixture = `
const a = {
  maxRetries: 3,
};

// ... 10 unrelated lines ...
// line
// line
// line
// line
// line
// line
// line
const b = {
  maxTimeoutMs: 500,
};
`;
assert.equal(
  findTunableClustersInFile(farApartFixture).length,
  0,
  "matches more than CLUSTER_WINDOW_LINES apart must not merge",
);

// --- findTunableConstantsInFile ---
const constFixture = `
export const MAX_UPLOAD_MB = 25;
const RETRY_COUNT = 3; // not in the allowlist, should be ignored
export const DEFAULT_TIMEOUT_MS = 5000;
`;
const constants = findTunableConstantsInFile(constFixture);
assert.deepEqual(
  constants.map((c) => c.name),
  ["MAX_UPLOAD_MB", "DEFAULT_TIMEOUT_MS"],
);

// --- checkHardcodedConfigFromFiles: end-to-end with allowlist ---
const files = {
  "artifacts/api-server/src/elaine/index.ts": budgetFixture,
  "artifacts/api-server/src/elaine/admin-config.ts": budgetFixture, // source-of-truth, must be skipped
};
const readFile = (f: string) => files[f as keyof typeof files] ?? null;

const violations = checkHardcodedConfigFromFiles(Object.keys(files), readFile);
assert.equal(violations.length, 1);
assert.equal(violations[0]?.file, "artifacts/api-server/src/elaine/index.ts");
assert.equal(violations[0]?.kind, "cluster");

const allowlisted = checkHardcodedConfigFromFiles(
  Object.keys(files),
  readFile,
  new Set(["artifacts/api-server/src/elaine/index.ts:4"]),
);
assert.equal(
  allowlisted.length,
  0,
  "allowlisted cluster start line must be skipped",
);

console.log("✓ check-hardcoded-config.test.ts passed");
