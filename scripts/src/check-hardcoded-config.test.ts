import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isTunableCamelName,
  isTunableConstName,
  isScannableFile,
  findTunableClustersInFile,
  findTunableConstantsInFile,
  checkHardcodedConfigFromFiles,
  HARDCODED_CONFIG_ALLOWLIST,
  ANCHORED_CONFIG_ALLOWLIST,
} from "./check-hardcoded-config.js";
import { repoRoot } from "./lib/git-diff-utils.js";

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

// Policy accounting needs the entire suppressed cluster, not just its first
// allowlist line. Adding a third tunable field must change the suppressed
// finding identity instead of remaining invisible behind the existing entry.
const expandedBudgetFixture = budgetFixture.replace(
  "maxToolCalls: 16,",
  "maxToolCalls: 16,\n    maxQueuedJobs: 8,",
);
const expandedAllowlisted = checkHardcodedConfigFromFiles(
  ["artifacts/api-server/src/elaine/index.ts"],
  () => expandedBudgetFixture,
  new Set(["artifacts/api-server/src/elaine/index.ts:4"]),
  true,
);
assert.deepEqual(expandedAllowlisted[0]?.names, [
  "maxModelRounds",
  "maxToolCalls",
  "maxQueuedJobs",
  "maxReplans",
  "maxElapsedMs",
]);
assert.equal(expandedAllowlisted[0]?.allowlisted, true);

const sameNameClustersFixture = `
function first() {
  const firstBudget = {
    maxRetries: 3,
    maxTimeoutMs: 100,
  };
  return firstBudget;
}
function second() {
  const secondBudget = {
    maxRetries: 3,
    maxTimeoutMs: 100,
  };
  return secondBudget;
}
`;
const sameNameAllowlisted = checkHardcodedConfigFromFiles(
  ["artifacts/api-server/src/elaine/index.ts"],
  () => sameNameClustersFixture,
  new Set([
    "artifacts/api-server/src/elaine/index.ts:4",
    "artifacts/api-server/src/elaine/index.ts:11",
  ]),
  true,
);
assert.equal(sameNameAllowlisted.length, 2);
assert.notEqual(
  sameNameAllowlisted[0]?.context,
  sameNameAllowlisted[1]?.context,
  "same-named clusters are distinguished by their local declaration context",
);

// Reviewed semantic exceptions must survive imports/comments moving the source,
// but protect only the original expression in its original named scope.
const anchoredFixtures = [
  {
    file: "artifacts/api-server/src/elaine/index.ts",
    source: "const MAX_PHONE_CODE_ATTEMPTS = 5;",
    oldLine: 970,
    firstFindingLine: 1,
    from: "= 5",
    to: "= 6",
    kind: "constant",
    names: ["MAX_PHONE_CODE_ATTEMPTS"],
  },
  {
    file: "artifacts/api-server/src/elaine/runtime/trace-store.ts",
    source: `async function loadElaineTurnTracesForMessages() {
  const trace = {
    usage: {
      modelRounds: 0,
      toolCalls: 0,
      replans: 0,
      elapsedMs: row.completedAt
        ? Math.max(0, row.completedAt.getTime() - row.startedAt.getTime())
        : 0,
    },
  };
}`,
    oldLine: 115,
    firstFindingLine: 4,
    from: "replans: 0",
    to: "replans: 2",
    kind: "cluster",
    names: ["modelRounds", "replans"],
  },
  {
    file: "artifacts/api-server/src/elaine/runtime/turn-runtime.ts",
    source: `class ElaineTurnRuntime {
  constructor() {
    this.trace = {
      usage: {
        modelRounds: 0,
        toolCalls: 0,
        replans: 0,
        elapsedMs: 0,
      },
    };
  }
}`,
    oldLine: 143,
    firstFindingLine: 5,
    from: "elapsedMs: 0",
    to: "elapsedMs: 100",
    kind: "cluster",
    names: ["modelRounds", "replans", "elapsedMs"],
  },
] as const;

for (const fixture of anchoredFixtures) {
  const scan = (
    source: string,
    includeAllowlisted = false,
    file: string = fixture.file,
  ) =>
    checkHardcodedConfigFromFiles(
      [file],
      () => source,
      undefined,
      includeAllowlisted,
    );
  const atOldLine =
    "\n".repeat(fixture.oldLine - fixture.firstFindingLine) + fixture.source;
  for (const source of [
    fixture.source,
    atOldLine,
    `import type { Example } from "./example.js";\n// Harmless comment\n\n${atOldLine}`,
    fixture.kind === "constant"
      ? `${fixture.source} // Reviewed security bound`
      : fixture.source.replace("usage: {", "usage: { /* Usage counters */"),
  ]) {
    assert.deepEqual(
      scan(source),
      [],
      `${fixture.file}: source movement is safe`,
    );
    const suppressed = scan(source, true);
    assert.equal(suppressed.length, 1);
    assert.equal(suppressed[0]?.allowlisted, true);
    assert.equal(suppressed[0]?.kind, fixture.kind);
    assert.deepEqual(suppressed[0]?.names, fixture.names);

    const changed = scan(source.replace(fixture.from, fixture.to));
    assert.equal(changed.length, 1, "changed reviewed value must fail");
    assert.equal(changed[0]?.allowlisted, undefined);
    const newConstant = scan(`${source}\nconst NEW_REQUEST_LIMIT = 12;`);
    assert.equal(
      newConstant.length,
      1,
      "new tunable in reviewed file must fail",
    );
    assert.deepEqual(newConstant[0]?.names, ["NEW_REQUEST_LIMIT"]);
    assert.equal(
      scan(`${source}\n${budgetFixture}`).length,
      1,
      "a new budget cluster in a reviewed file must fail",
    );
  }

  assert.equal(
    scan(fixture.source, false, "artifacts/api-server/src/unreviewed.ts")
      .length,
    1,
    "the same expression in a different file is not exempt",
  );
  assert.equal(
    checkHardcodedConfigFromFiles(
      [fixture.file],
      () => fixture.source,
      new Set(),
    ).length,
    1,
    "custom allowlist replaces the default semantic exceptions too",
  );
  const actualSource = readFileSync(`${repoRoot()}/${fixture.file}`, "utf8");
  assert.ok(
    scan(actualSource, true).some(
      (finding) =>
        finding.allowlisted &&
        finding.names.join(",") === fixture.names.join(","),
    ),
    `${fixture.file}: exception must match the real reviewed declaration`,
  );

  if (fixture.kind === "cluster") {
    assert.equal(
      scan(fixture.source.replace("usage: {", "budget: {")).length,
      1,
      "zeroes on another symbol are not exempt",
    );
    assert.equal(
      scan(
        fixture.source.replace("replans: 0,", "replans: 0,\n maxRetries: 8,"),
      ).length,
      1,
      "adding a tunable inside the reviewed expression must fail",
    );
    assert.equal(
      scan(fixture.source.replace("usage: {", "maxRetries: 8,\n usage: {"))
        .length,
      1,
      "an adjacent new tunable cannot hide in a reviewed cluster",
    );
    const differentScope = fixture.source
      .replace("loadElaineTurnTracesForMessages", "otherFunction")
      .replace("ElaineTurnRuntime", "OtherRuntime");
    assert.equal(scan(differentScope).length, 1, "scope must match");
  } else {
    assert.equal(
      scan(`const NEW_REQUEST_LIMIT = 12; ${fixture.source}`).length,
      1,
      "an unrelated constant on the same line cannot inherit an exception",
    );
    assert.equal(
      scan(fixture.source.replace(fixture.names[0], "NEW_REQUEST_LIMIT"))
        .length,
      1,
      "a different tunable at the reviewed location is not exempt",
    );
    assert.equal(
      scan(`function otherFunction() {\n${fixture.source}\n}`).length,
      1,
      "the same constant in another scope is not exempt",
    );
  }
}

assert.equal(
  checkHardcodedConfigFromFiles([anchoredFixtures[1].file], () =>
    anchoredFixtures[1].source.replace(
      "row.completedAt.getTime() - row.startedAt.getTime()",
      "row.completedAt.getTime() + row.startedAt.getTime()",
    ),
  ).length,
  1,
  "changing even a non-literal part of the reviewed expression requires review",
);

// Cover every migrated declaration, including constructor/call arguments, named
// arrows, class fields, object initializers, and the generated YAML template.
// The real-source inventory below independently checks that none of these
// fixtures describe an exception that has drifted away from its source.
assert.equal(
  HARDCODED_CONFIG_ALLOWLIST.size,
  0,
  "the default must not retain line-number exceptions",
);

function reviewedFixture(
  entry: (typeof ANCHORED_CONFIG_ALLOWLIST)[number],
): string {
  const argument = /^(new )?(.+)\.arguments\.(\d+)$/.exec(entry.symbol);
  let declaration: string;
  if (entry.kind === "constant") {
    declaration = `const ${entry.symbol} = ${entry.expression};`;
  } else if (argument) {
    const args = [
      ...Array.from({ length: Number(argument[3]) }, () => "null"),
      entry.expression,
    ];
    declaration = `const reviewed = ${argument[1] ?? ""}${argument[2]}(${args.join(", ")});`;
  } else if (
    entry.symbol.startsWith("DIRECTION_A_") ||
    entry.symbol === "categorySchemas"
  ) {
    declaration = `const ${entry.symbol} = ${entry.expression};`;
  } else {
    declaration = `const reviewed = { ${entry.symbol}: ${entry.expression} };`;
  }

  switch (entry.scope) {
    case "file-scope":
      return declaration;
    case "reanalyze_magnet":
      return `const actions = { reanalyze_magnet: (async () => {\n${declaration}\n}) as ActionExecutor };`;
    case "ElaineTurnRuntime.constructor":
      return `class ElaineTurnRuntime { constructor() {\n${declaration}\n} }`;
    case "ElaineTurnRuntime.getBudgetStatus":
      return `const mocks = { ElaineTurnRuntime: class {
        getBudgetStatus = vi.fn().mockReturnValue({
          budget: ${entry.expression},
        });
      } };`;
    case "mockupPreviewPlugin.configureServer":
      return `function mockupPreviewPlugin() {
        return { async configureServer() {\n${declaration}\n} };
      }`;
    default:
      return `function ${entry.scope}() {\n${declaration}\n}`;
  }
}

const expectedByFile = new Map<string, string[]>();
const findingIdentity = (finding: { kind: string; names: string[] }) =>
  `${finding.kind}:${finding.names.join(",")}`;
const anchorIdentities = new Set<string>();
for (const entry of ANCHORED_CONFIG_ALLOWLIST) {
  const label = `${entry.file}:${entry.scope}:${entry.symbol}`;
  assert.ok(!anchorIdentities.has(label), `${label}: duplicate exception`);
  anchorIdentities.add(label);
  const fixture = reviewedFixture(entry);
  const scan = (source: string, includeAllowlisted = false) =>
    checkHardcodedConfigFromFiles(
      [entry.file],
      () => source,
      undefined,
      includeAllowlisted,
    );
  const raw = checkHardcodedConfigFromFiles(
    [entry.file],
    () => fixture,
    new Set(),
  );
  assert.equal(raw.length, 1, `${label}: fixture must exercise the detector`);
  const expected = expectedByFile.get(entry.file) ?? [];
  expected.push(findingIdentity(raw[0]!));
  expectedByFile.set(entry.file, expected);

  for (const source of [
    fixture,
    `import type { Example } from "./example";\n// Added import and comment\n\n${fixture}`,
    "\n".repeat(100) + fixture,
    fixture.replace("const ", "/* Harmless comment */\nconst "),
  ]) {
    assert.deepEqual(scan(source), [], `${label}: movement is harmless`);
    const unfiltered = checkHardcodedConfigFromFiles(
      [entry.file],
      () => source,
      new Set(),
    );
    assert.deepEqual(
      scan(source, true),
      unfiltered.map((finding) => ({ ...finding, allowlisted: true })),
      `${label}: policy accounting keeps the entire suppressed finding`,
    );
    const changedExpression = entry.expression.replace(
      /\b\d[\d_]*(?:\.\d+)?\b/,
      (number) => String(Number(number.replaceAll("_", "")) + 1),
    );
    assert.notEqual(changedExpression, entry.expression);
    const changed = scan(
      source.replace(entry.expression, changedExpression),
      true,
    );
    assert.equal(
      changed.length,
      1,
      `${label}: changed expression still detected`,
    );
    assert.equal(
      changed[0]?.allowlisted,
      undefined,
      `${label}: changes require review`,
    );

    for (const addition of ["const NEW_REQUEST_LIMIT = 12;", budgetFixture]) {
      const added = scan(`${source}\n\n\n\n\n${addition}`);
      assert.equal(added.length, 1, `${label}: new tunables are not exempt`);
      assert.equal(added[0]?.allowlisted, undefined);
      assert.equal(scan(`${source}\n\n\n\n\n${addition}`, true).length, 2);
    }
  }

  assert.equal(
    scan(`function unreviewedScope() {\n${fixture}\n}`).length,
    1,
    `${label}: a different enclosing scope is not exempt`,
  );
  const duplicated = scan(`${fixture}\n\n\n\n\n${fixture}`, true);
  assert.equal(
    duplicated.length,
    2,
    `${label}: duplicate targets are ambiguous`,
  );
  assert.ok(
    duplicated.every((finding) => !finding.allowlisted),
    `${label}: another identical target cannot inherit a review`,
  );
  assert.equal(
    checkHardcodedConfigFromFiles(
      ["artifacts/api-server/src/unreviewed.ts"],
      () => fixture,
    ).length,
    1,
    `${label}: no cross-file exemption`,
  );
  const argument = /^(new )?(.+)\.arguments\.(\d+)$/.exec(entry.symbol);
  const renamed = argument
    ? fixture.replace(argument[2]!, "unreviewedCall")
    : fixture.replace(entry.symbol, "UNREVIEWED_LIMIT");
  assert.equal(scan(renamed).length, 1, `${label}: symbol must match`);

  if (entry.kind === "cluster") {
    const expandedExpression = entry.expression.startsWith("{")
      ? `{\nmaxQueuedJobs: 8,${entry.expression.slice(1)}`
      : entry.expression.replace(
          "minLength: 1",
          "minLength: 1\n          maxQueuedJobs: 8",
        );
    assert.notEqual(expandedExpression, entry.expression);
    const expanded = scan(
      fixture.replace(entry.expression, expandedExpression),
      true,
    );
    assert.ok(
      expanded.length > 0,
      `${label}: expanded cluster must be detected`,
    );
    assert.ok(
      expanded.every((finding) => !finding.allowlisted),
      `${label}: adding a tunable inside the expression needs review`,
    );
  }
}

for (const [file, expected] of expectedByFile) {
  const actualSource = readFileSync(`${repoRoot()}/${file}`, "utf8");
  for (const source of [
    actualSource,
    `import type { Example } from "./example";\n// Harmless movement\n\n${actualSource}`,
  ]) {
    const accounted = checkHardcodedConfigFromFiles(
      [file],
      () => source,
      undefined,
      true,
    );
    assert.deepEqual(
      accounted
        .filter((finding) => finding.allowlisted)
        .map(findingIdentity)
        .sort(),
      [...expected].sort(),
      `${file}: every anchor matches its real reviewed expression and scope`,
    );
  }
}

console.log("✓ check-hardcoded-config.test.ts passed");
