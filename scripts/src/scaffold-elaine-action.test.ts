/**
 * Unit tests for the pure helpers in scaffold-elaine-action.ts —
 * anchored-insertion behaviour (including idempotency-relevant properties),
 * field parsing, and codegen output. Run via `tsx ./src/scaffold-elaine-action.test.ts`
 * (part of the @workspace/scripts `test` chain).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_EXECUTOR_PREFIXES } from "./check-domain-composition";
import {
  DOMAINS,
  SCAFFOLD_ELAINE_ACTION_ANCHORS,
  buildCapabilityRegistryEdit,
  buildReadRegistryEdit,
  buildReadToolCatalogEdits,
  buildRestrictedClassificationEdit,
  insertAfterAnchor,
  parseFields,
  parseArgs,
  toPascal,
  toCamel,
  toKebab,
  zodFor,
  buildStubFile,
  buildTestFile,
  type ToolSpec,
} from "./scaffold-elaine-action";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failures++;
    console.error(
      `  ❌ ${name}\n     ${err instanceof Error ? err.message : err}`,
    );
  }
}

// ── casing ───────────────────────────────────────────────────────────────────
test("casing helpers", () => {
  assert.equal(toPascal("add_pottery_note"), "AddPotteryNote");
  assert.equal(toCamel("add_pottery_note"), "addPotteryNote");
  assert.equal(toKebab("add_pottery_note"), "add-pottery-note");
});

// ── field parsing ────────────────────────────────────────────────────────────
test("parseFields handles types and optionality", () => {
  const fields = parseFields("itemId:int,note:string?,tags:string[]?");
  assert.deepEqual(fields, [
    { name: "itemId", type: "int", optional: false },
    { name: "note", type: "string", optional: true },
    { name: "tags", type: "string[]", optional: true },
  ]);
  assert.equal(zodFor(fields[0]!), "z.number().int()");
  assert.equal(zodFor(fields[1]!), "z.string().max(2000).optional()");
});

test("parseFields rejects bad input", () => {
  assert.throws(() => parseFields("itemId"));
  assert.throws(() => parseFields("itemId:widget"));
  assert.throws(() => parseFields("item-id:string"));
});

// ── arg parsing ──────────────────────────────────────────────────────────────
test("parseArgs validates name/domain/kind/risk", () => {
  const spec = parseArgs([
    "--name",
    "add_pottery_note",
    "--domain",
    "pottery",
    "--kind",
    "action",
    "--fields",
    "itemId:int",
  ]);
  assert.equal(spec.name, "add_pottery_note");
  assert.equal(spec.risk, "medium");
  assert.throws(() => parseArgs(["--name", "BadName", "--domain", "pottery"]));
  // travels and universal are now valid domains
  assert.doesNotThrow(() =>
    parseArgs(["--name", "ok_name", "--domain", "travels"]),
  );
  assert.doesNotThrow(() =>
    parseArgs(["--name", "ok_name", "--domain", "universal"]),
  );
  assert.throws(() =>
    parseArgs(["--name", "ok_name", "--domain", "unknown_domain"]),
  );
  assert.throws(() =>
    parseArgs(["--name", "ok_name", "--domain", "pottery", "--kind", "banana"]),
  );
});

// ── anchored insertion ───────────────────────────────────────────────────────
const FIXTURE = `const POLICY_ROWS: Row[] = [
  existingA,
  existingB,
];
export const potteryActionExecutors: Record<T, E> = {
  existing: fn,
};`;

test("insertAfterAnchor inserts directly after a plain anchor", () => {
  const out = insertAfterAnchor(
    FIXTURE,
    "const POLICY_ROWS: Row[] = [",
    "\n  newEntry,",
  );
  assert.match(out, /\[\n {2}newEntry,\n {2}existingA,/);
});

test("insertAfterAnchor supports a regex opening token after the anchor", () => {
  const out = insertAfterAnchor(
    FIXTURE,
    "export const potteryActionExecutors",
    "\n  newTool: stub,",
    /=\s*\{/,
  );
  assert.match(out, /= \{\n {2}newTool: stub,\n {2}existing: fn,/);
});

test("insertAfterAnchor throws loudly when the anchor is missing", () => {
  assert.throws(() => insertAfterAnchor(FIXTURE, "NO_SUCH_ANCHOR", "x"));
  assert.throws(() =>
    insertAfterAnchor(FIXTURE, "const POLICY_ROWS", "x", /NEVER_MATCHES/),
  );
});

test("two sequential insertions for different tools do not corrupt each other", () => {
  const once = insertAfterAnchor(
    FIXTURE,
    "const POLICY_ROWS: Row[] = [",
    `\n  toolOne,`,
  );
  const twice = insertAfterAnchor(
    once,
    "const POLICY_ROWS: Row[] = [",
    `\n  toolTwo,`,
  );
  const idx1 = twice.indexOf("toolOne");
  const idx2 = twice.indexOf("toolTwo");
  assert.ok(
    idx1 > 0 && idx2 > 0 && idx2 < idx1,
    "later insert lands above, both present",
  );
  assert.match(twice, /existingA,\n {2}existingB,/);
});

// ── codegen output ───────────────────────────────────────────────────────────
const SPEC: ToolSpec = {
  name: "add_pottery_note",
  domain: "pottery",
  kind: "action",
  risk: "medium",
  fields: parseFields("itemId:int,note:string"),
  destructive: false,
  webOnly: false,
  restrictedAllowed: false,
  dryRun: true,
};

test("buildStubFile emits payload schema, 501 executor, and TODO markers", () => {
  const stub = buildStubFile(SPEC);
  assert.match(stub, /export const AddPotteryNoteActionPayload = z\.object\(/);
  assert.match(stub, /itemId: z\.number\(\)\.int\(\)/);
  assert.match(stub, /status: 501/);
  assert.match(stub, /TODO\(scaffold\)/);
  assert.match(stub, /required: \["itemId", "note"\]/);
});

test("buildStubFile adds destructive wording when flagged", () => {
  const stub = buildStubFile({ ...SPEC, destructive: true });
  assert.match(stub, /DELETE\/permanently change data/);
});

test("buildTestFile builds a sample payload from required fields only", () => {
  const t = buildTestFile({
    ...SPEC,
    fields: parseFields("itemId:int,note:string?"),
  });
  assert.match(t, /itemId: 1,/);
  assert.doesNotMatch(t, /note:/);
  assert.match(t, /toBe\(501\)/);
});

// ── executor-prefix validity (Scan N guardrail alignment) ───────────────────
test("every domain's action and read executor prefixes are in KNOWN_EXECUTOR_PREFIXES", () => {
  for (const [domain, cfg] of Object.entries(DOMAINS)) {
    assert.ok(
      KNOWN_EXECUTOR_PREFIXES.has(cfg.executorPrefix),
      `${domain}: action prefix "${cfg.executorPrefix}" not in KNOWN_EXECUTOR_PREFIXES`,
    );
    assert.ok(
      KNOWN_EXECUTOR_PREFIXES.has(cfg.readExecutorPrefix),
      `${domain}: read prefix "${cfg.readExecutorPrefix}" not in KNOWN_EXECUTOR_PREFIXES`,
    );
  }
});

const REGISTRY_FIXTURE = `const NARROW_READ_CHANNEL_JUSTIFICATIONS: Record<string, string> = {
  existing_tool: "reason",
};
const POLICY_ROWS: ElaineCapabilityPolicy[] = [
  existingRow,
];`;

test("generated read policy uses the domain's mapped read prefix, not <domain>Read", () => {
  const expected: Record<string, string> = {
    pottery: "collectionRead",
    quilting: "quiltingRead",
    ornaments: "ornamentRead",
    travels: "travelRead",
    universal: "officeRead",
  };
  for (const domain of Object.keys(DOMAINS)) {
    const edit = buildCapabilityRegistryEdit({
      ...SPEC,
      name: `probe_${domain}_read`,
      domain: domain as ToolSpec["domain"],
      kind: "read",
    });
    const out = edit.apply(REGISTRY_FIXTURE);
    assert.ok(out, `${domain}: edit unexpectedly skipped`);
    const m = /executorPrefix: "([^"]+)"/.exec(out);
    assert.equal(
      m?.[1],
      expected[domain],
      `${domain}: wrong read executor prefix`,
    );
    assert.ok(
      KNOWN_EXECUTOR_PREFIXES.has(m![1]!),
      `${domain}: generated prefix "${m![1]}" would fail the Scan N guardrail`,
    );
  }
});

test("generated action policy prefixes are guardrail-valid for every domain", () => {
  for (const domain of Object.keys(DOMAINS)) {
    const edit = buildCapabilityRegistryEdit({
      ...SPEC,
      name: `probe_${domain}_action`,
      domain: domain as ToolSpec["domain"],
      kind: "action",
    });
    const out = edit.apply(REGISTRY_FIXTURE);
    assert.ok(out, `${domain}: edit unexpectedly skipped`);
    const m = /executorPrefix: "([^"]+)"/.exec(out);
    assert.ok(
      m && KNOWN_EXECUTOR_PREFIXES.has(m[1]!),
      `${domain}: generated action prefix "${m?.[1]}" would fail the Scan N guardrail`,
    );
  }
});

// ── read-dispatch registry wiring ────────────────────────────────────────────
const READ_REGISTRY_FIXTURE = `type ScaffoldedReadExecutor = (
  args: string,
  userId: number,
) => Promise<string>;

export const SCAFFOLDED_READ_TOOL_EXECUTORS: Record<
  string,
  ScaffoldedReadExecutor
> = {
  // scaffold:elaine-action inserts entries here — do not remove this object.
};`;

test("buildReadRegistryEdit wires the read tool into the dispatch registry", () => {
  const edit = buildReadRegistryEdit({
    ...SPEC,
    name: "probe_read_tool",
    kind: "read",
  });
  const out = edit.apply(READ_REGISTRY_FIXTURE);
  assert.ok(out, "edit unexpectedly skipped");
  assert.match(
    out,
    /import \{\n {2}ProbeReadToolActionPayload,\n {2}executeProbeReadToolAction,\n\} from "\.\/scaffolded-tools\/probe-read-tool";/,
  );
  assert.match(out, /"probe_read_tool": async \(args, userId\) => \{/);
  assert.match(out, /executeProbeReadToolAction\(parsed\.data, userId\)/);
  // idempotent: a second application is a no-op skip
  assert.equal(edit.apply(out!), null);
  // a different tool still inserts cleanly alongside
  const out2 = buildReadRegistryEdit({
    ...SPEC,
    name: "other_read_tool",
    kind: "read",
  }).apply(out!);
  assert.ok(
    out2 &&
      out2.includes('"probe_read_tool"') &&
      out2.includes('"other_read_tool"'),
  );
});

// ── model-tool-policy hard-tool contract wiring for read tools ──────────────
const MODEL_TOOL_POLICY_FIXTURE = `export const MODEL_VISIBLE_HARD_TOOL_NAMES = new Set<string>([
  "existing_read_tool",
]);

export const MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: Readonly<
  Record<string, string>
> = {
  existing_read_tool: "checking something",
};`;

const MODEL_TOOL_POLICY_TEST_FIXTURE = `const IMPLEMENTED_MAIN_CHAT_HARD_TOOLS = [
  "existing_read_tool",
].sort();`;

test("read scaffold wires hard-tool name, status label, and contract-test expectation", () => {
  const spec = { ...SPEC, name: "probe_read_tool", kind: "read" as const };
  const edits = buildReadToolCatalogEdits(spec);
  const policyEdit = edits.find((e) =>
    e.description.includes("MODEL_VISIBLE_HARD_TOOL_NAMES"),
  );
  const testEdit = edits.find((e) =>
    e.description.includes("IMPLEMENTED_MAIN_CHAT_HARD_TOOLS"),
  );
  assert.ok(policyEdit, "missing model-tool-policy edit");
  assert.ok(testEdit, "missing model-tool-policy.test edit");

  const policyOut = policyEdit!.apply(MODEL_TOOL_POLICY_FIXTURE);
  assert.ok(policyOut, "policy edit unexpectedly skipped");
  assert.ok(policyOut!.includes('  "probe_read_tool",'), "name not inserted");
  assert.match(
    policyOut!,
    /probe_read_tool: "checking pottery data",/,
    "status label not inserted",
  );
  assert.match(policyOut!, /TODO\(scaffold\)[^\n]*status label/);
  // idempotent
  assert.equal(policyEdit!.apply(policyOut!), null);

  const testOut = testEdit!.apply(MODEL_TOOL_POLICY_TEST_FIXTURE);
  assert.ok(testOut, "test edit unexpectedly skipped");
  assert.ok(
    testOut!.includes('  "probe_read_tool",'),
    "expectation entry not inserted",
  );
  assert.equal(testEdit!.apply(testOut!), null);
});

// ── travels domain + kind=read coverage ──────────────────────────────────────
//
// Task 1141 extended the scaffold generator to cover travels *action* tools.
// These tests confirm that --domain travels --kind read produces the same
// complete wiring as collection read tools (same files touched, same registry
// dispatch, correct domain label) and does not accidentally receive any
// action-tool wiring.

test("travels read scaffold produces the same wiring-point count and target files as collection read tools", () => {
  const travelsEdits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_travels_read",
    domain: "travels",
    kind: "read",
  });
  const potteryEdits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_pottery_read",
    domain: "pottery",
    kind: "read",
  });
  assert.equal(
    travelsEdits.length,
    potteryEdits.length,
    "travels read must produce the same number of wiring edits as collection read",
  );
  // Both domains should touch exactly the same set of files — only the
  // generated content (tool name, domain label) differs, not which files.
  const sortedFiles = (edits: typeof travelsEdits) =>
    edits.map((e) => e.file).sort();
  assert.deepEqual(
    sortedFiles(travelsEdits),
    sortedFiles(potteryEdits),
    "travels read edits must touch the same files as collection read edits",
  );
});

test("travels read scaffold wires into SCAFFOLDED_READ_TOOL_EXECUTORS (same as collection read)", () => {
  const edits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_travels_read",
    domain: "travels",
    kind: "read",
  });
  const registryEdit = edits.find((e) =>
    e.description.includes("scaffolded-read-registry"),
  );
  assert.ok(
    registryEdit,
    "travels read must include a scaffolded-read-registry.ts dispatch edit",
  );
  const out = registryEdit!.apply(READ_REGISTRY_FIXTURE);
  assert.ok(out, "registry edit unexpectedly skipped");
  assert.match(
    out!,
    /"probe_travels_read": async \(args, userId\) => \{/,
    "dispatcher entry not inserted into SCAFFOLDED_READ_TOOL_EXECUTORS",
  );
  assert.match(
    out!,
    /executeProbeTravelsReadAction\(parsed\.data, userId\)/,
    "registry entry must call the stub executor",
  );
  // idempotent: a second application is a no-op skip
  assert.equal(
    registryEdit!.apply(out!),
    null,
    "registry edit must be idempotent",
  );
});

test("travels read scaffold status label references the travels domain", () => {
  const edits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_travels_read",
    domain: "travels",
    kind: "read",
  });
  const policyEdit = edits.find((e) =>
    e.description.includes("MODEL_VISIBLE_HARD_TOOL_NAMES"),
  );
  assert.ok(policyEdit, "travels read must include a model-tool-policy edit");
  const out = policyEdit!.apply(MODEL_TOOL_POLICY_FIXTURE);
  assert.ok(out, "policy edit unexpectedly skipped");
  assert.match(
    out!,
    /probe_travels_read: "checking travels data",/,
    "status label must reference the travels domain name, not pottery",
  );
  // idempotent
  assert.equal(policyEdit!.apply(out!), null, "policy edit must be idempotent");
});

// ── universal domain + kind=read coverage ────────────────────────────────────
//
// The universal domain uses buildUniversalFileEdits for *action* wiring but
// shares the same buildReadToolCatalogEdits path as all collection domains for
// *read* wiring.  These tests confirm that --domain universal --kind read
// produces the same complete wiring as collection read tools (same files
// touched, same registry dispatch, correct capability-domain label "office")
// and does not accidentally omit any wiring point.

test("universal read scaffold produces the same wiring-point count and target files as collection read tools", () => {
  const universalEdits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_universal_read",
    domain: "universal",
    kind: "read",
  });
  const potteryEdits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_pottery_read",
    domain: "pottery",
    kind: "read",
  });
  assert.equal(
    universalEdits.length,
    potteryEdits.length,
    "universal read must produce the same number of wiring edits as collection read",
  );
  // Both domains should touch exactly the same set of files — only the
  // generated content (tool name, domain label) differs, not which files.
  const sortedFiles = (edits: typeof universalEdits) =>
    edits.map((e) => e.file).sort();
  assert.deepEqual(
    sortedFiles(universalEdits),
    sortedFiles(potteryEdits),
    "universal read edits must touch the same files as collection read edits",
  );
});

test("universal read scaffold wires into SCAFFOLDED_READ_TOOL_EXECUTORS (same as collection read)", () => {
  const edits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_universal_read",
    domain: "universal",
    kind: "read",
  });
  const registryEdit = edits.find((e) =>
    e.description.includes("scaffolded-read-registry"),
  );
  assert.ok(
    registryEdit,
    "universal read must include a scaffolded-read-registry.ts dispatch edit",
  );
  const out = registryEdit!.apply(READ_REGISTRY_FIXTURE);
  assert.ok(out, "registry edit unexpectedly skipped");
  assert.match(
    out!,
    /"probe_universal_read": async \(args, userId\) => \{/,
    "dispatcher entry not inserted into SCAFFOLDED_READ_TOOL_EXECUTORS",
  );
  assert.match(
    out!,
    /executeProbeUniversalReadAction\(parsed\.data, userId\)/,
    "registry entry must call the stub executor",
  );
  // idempotent: a second application is a no-op skip
  assert.equal(
    registryEdit!.apply(out!),
    null,
    "registry edit must be idempotent",
  );
});

test("universal read scaffold status label references 'office' (capabilityDomain), not 'universal'", () => {
  const edits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_universal_read",
    domain: "universal",
    kind: "read",
  });
  const policyEdit = edits.find((e) =>
    e.description.includes("MODEL_VISIBLE_HARD_TOOL_NAMES"),
  );
  assert.ok(policyEdit, "universal read must include a model-tool-policy edit");
  const out = policyEdit!.apply(MODEL_TOOL_POLICY_FIXTURE);
  assert.ok(out, "policy edit unexpectedly skipped");
  assert.match(
    out!,
    /probe_universal_read: "checking office data",/,
    "status label must reference the capabilityDomain 'office', not the scaffold domain 'universal'",
  );
  assert.doesNotMatch(
    out!,
    /probe_universal_read: "checking universal data",/,
    "status label must not use the raw scaffold domain name 'universal'",
  );
  // idempotent
  assert.equal(policyEdit!.apply(out!), null, "policy edit must be idempotent");
});

// ── ornaments domain + kind=read status label ─────────────────────────────────

test("ornaments read scaffold status label references 'ornaments' (capabilityDomain)", () => {
  const edits = buildReadToolCatalogEdits({
    ...SPEC,
    name: "probe_ornaments_read",
    domain: "ornaments",
    kind: "read",
  });
  const policyEdit = edits.find((e) =>
    e.description.includes("MODEL_VISIBLE_HARD_TOOL_NAMES"),
  );
  assert.ok(policyEdit, "ornaments read must include a model-tool-policy edit");
  const out = policyEdit!.apply(MODEL_TOOL_POLICY_FIXTURE);
  assert.ok(out, "policy edit unexpectedly skipped");
  assert.match(
    out!,
    /probe_ornaments_read: "checking ornaments data",/,
    "status label must reference the capabilityDomain 'ornaments'",
  );
  // idempotent
  assert.equal(policyEdit!.apply(out!), null, "policy edit must be idempotent");
});

// ── restricted-channel classification (Scan J completeness) ─────────────────
const RESTRICTED_CONFIG_FIXTURE = `export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE: readonly string[] = [
  "existing_excluded_tool",
];

export const RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE: readonly string[] = [
  "existing_allowed_tool",
];`;

test("default action scaffold classifies the action type as restricted-excluded (web-only)", () => {
  const spec = parseArgs([
    "--name",
    "probe_default_action",
    "--domain",
    "pottery",
    "--kind",
    "action",
  ]);
  assert.equal(spec.webOnly, true);
  assert.equal(spec.restrictedAllowed, false);
  const out = buildRestrictedClassificationEdit(spec).apply(
    RESTRICTED_CONFIG_FIXTURE,
  );
  assert.ok(out, "edit unexpectedly skipped");
  const excludedBlock = out!.slice(
    out!.indexOf("RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE"),
    out!.indexOf("RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE"),
  );
  assert.ok(excludedBlock.includes('"probe_default_action"'));
  // idempotent
  assert.equal(buildRestrictedClassificationEdit(spec).apply(out!), null);
});

test("--restricted-allowed action classifies into the allowed array instead", () => {
  const spec = parseArgs([
    "--name",
    "probe_allowed_action",
    "--domain",
    "pottery",
    "--kind",
    "action",
    "--restricted-allowed",
  ]);
  assert.equal(spec.webOnly, false);
  const out = buildRestrictedClassificationEdit(spec).apply(
    RESTRICTED_CONFIG_FIXTURE,
  );
  assert.ok(out, "edit unexpectedly skipped");
  const allowedBlock = out!.slice(
    out!.indexOf("RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE"),
  );
  assert.ok(allowedBlock.includes('"probe_allowed_action"'));
  assert.ok(
    !out!
      .slice(0, out!.indexOf("RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE"))
      .includes('"probe_allowed_action"'),
    "must not also land in the excluded array",
  );
});

test("every action scaffold lands in exactly one restricted array — flag conflicts rejected", () => {
  assert.throws(
    () =>
      parseArgs([
        "--name",
        "x_tool",
        "--domain",
        "pottery",
        "--kind",
        "action",
        "--restricted-allowed",
        "--web-only",
      ]),
    /mutually exclusive/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--name",
        "x_tool",
        "--domain",
        "pottery",
        "--kind",
        "read",
        "--restricted-allowed",
      ]),
    /only applies to --kind action/,
  );
});

// ── anchor presence in real source files ────────────────────────────────────
// Guards against a refactor or concurrent merge accidentally deleting an anchor
// that insertAfterAnchor relies on, which would cause the next scaffold run to
// throw at runtime instead of failing visibly during CI.
test("every SCAFFOLD_ELAINE_ACTION_ANCHORS entry is present in its real source file", () => {
  const missing: string[] = [];
  for (const { file, anchor } of SCAFFOLD_ELAINE_ACTION_ANCHORS) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) {
      missing.push(`  FILE NOT FOUND: ${file}  (anchor: ${anchor})`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    if (!content.includes(anchor)) {
      missing.push(`  anchor not found in ${file}:\n    "${anchor}"`);
    }
  }
  assert.equal(
    missing.length,
    0,
    `Scaffold anchors missing from their source files:\n${missing.join("\n")}\n\n` +
      `Each anchor must be present for scaffold-elaine-action to work. ` +
      `If you renamed or refactored a target file, update SCAFFOLD_ELAINE_ACTION_ANCHORS in scaffold-elaine-action.ts too.`,
  );
});

if (failures > 0) {
  console.error(`\n${failures} scaffold-elaine-action test(s) failed`);
  process.exit(1);
}
console.log("\nAll scaffold-elaine-action tests passed");
