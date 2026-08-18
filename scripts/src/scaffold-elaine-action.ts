/**
 * scaffold-elaine-action.ts
 *
 * Code generator for new Elaine chat-widget tools. Adding one tool by hand
 * means touching ~14 mechanical wiring points (see
 * .agents/memory/elaine-action-tool-checklist.md). This script scaffolds all
 * of the mechanical ones from a single spec so the remaining human work is
 * only the business logic + judgment-call prose (left as TODO(scaffold)
 * markers).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run scaffold:elaine-action -- \
 *     --name add_pottery_note --domain pottery --kind action \
 *     --fields "itemId:int,note:string" [--risk high] [--destructive] \
 *     [--web-only] [--operation-id addPotteryNote]
 *
 * Flags:
 *   --name          snake_case tool name (required)
 *   --domain        pottery | quilting | ornaments (required)
 *   --kind          action (confirmable write) | read (soft/read tool)
 *   --fields        comma list of payloadField:type entries; type one of
 *                   string,int,number,boolean,string[]; trailing ? = optional
 *   --risk          action risk tier override (medium default; delete_/remove_
 *                   etc. names are auto-promoted to high by the registry)
 *   --destructive   marks the tool description as destructive (DELETE wording
 *                   reminder is included in the TODO description)
 *   --web-only      action available on the web channel only (adds the
 *                   restricted-channel exclusion entry too)
 *   --operation-id  OpenAPI operationId when the tool maps 1:1 to a REST
 *                   route (updates website-operation-inventory.json +
 *                   DIRECT_TOOL_MAP in elaine-capability-parity.ts)
 *   --dry-run       print planned edits without writing anything
 *
 * Insertion strategy: every edit is anchored on a stable, existing syntactic
 * anchor (a const declaration + its opening bracket) and guarded by an
 * idempotency check, so re-running for the same or a different tool never
 * duplicates or corrupts existing entries.
 */

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Repo layout ─────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const ELAINE_DIR = path.join(REPO_ROOT, "artifacts/api-server/src/elaine");
const STUB_DIR = path.join(ELAINE_DIR, "scaffolded-tools");

const FILES = {
  capabilityRegistry: path.join(ELAINE_DIR, "capability-registry.ts"),
  toolFamilies: path.join(ELAINE_DIR, "runtime/tool-families.ts"),
  evaluationCorpus: path.join(ELAINE_DIR, "runtime/evaluation-corpus.ts"),
  modelToolPolicy: path.join(ELAINE_DIR, "runtime/model-tool-policy.ts"),
  modelToolPolicyTest: path.join(
    ELAINE_DIR,
    "runtime/model-tool-policy.test.ts",
  ),
  restrictedConfig: path.join(ELAINE_DIR, "restricted-channel-config.ts"),
  plannerCatalog: path.join(ELAINE_DIR, "planner-tool-catalog.ts"),
  inventory: path.join(ELAINE_DIR, "website-operation-inventory.json"),
  readRegistry: path.join(ELAINE_DIR, "scaffolded-read-registry.ts"),
  parityScript: path.join(REPO_ROOT, "scripts/src/elaine-capability-parity.ts"),
  elaineIndex: path.join(ELAINE_DIR, "index.ts"),
  universalActions: path.join(ELAINE_DIR, "universal-actions.ts"),
};

export type Domain =
  | "pottery"
  | "quilting"
  | "ornaments"
  | "travels"
  | "universal";

export interface DomainConfig {
  /**
   * Per-domain actions file (relative to ELAINE_DIR), or null for domains
   * whose wiring lives in index.ts rather than a dedicated file (travels).
   */
  file: string | null;
  schemasConst: string;
  typeName: string;
  executorsConst: string;
  labelFn: string;
  toolsConst: string;
  executorPrefix: string;
  /**
   * Executor prefix for read/hard tools. Must be a member of
   * KNOWN_EXECUTOR_PREFIXES in check-domain-composition.ts — the
   * historical names are irregular (pottery read tools live under
   * "collectionRead", ornaments under singular "ornamentRead").
   */
  readExecutorPrefix: string;
  /**
   * Domain string written into capability-registry.ts policy rows. May differ
   * from the scaffold domain name (e.g. "universal" scaffold → "office" domain).
   */
  capabilityDomain: string;
  /**
   * Key in ELAINE_TOOL_FAMILY_SENTINELS to insert new tool sentinels into.
   * Defaults to `capabilityDomain` when not set; set explicitly when the
   * scaffold domain name differs from the sentinel family key.
   */
  sentinelFamily: string;
  /**
   * How action-tool wiring is inserted:
   *   "collection" — one self-contained per-domain file (pottery/quilting/ornaments)
   *   "travels"    — wired inline in index.ts (ActionBody + TRAVEL_ACTION_EXECUTORS +
   *                  buildActionLabel) and ACTION_TOOLS in planner-tool-catalog.ts
   *   "universal"  — per-domain file with an extra TYPES array (universal-actions.ts)
   */
  wiringStrategy: "collection" | "travels" | "universal";
  /**
   * For "universal" wiring: name of the string-literal TYPES array const from
   * which the TypeScript union type is derived (e.g. UNIVERSAL_ACTION_TYPES).
   */
  typesConst?: string;
}

export const DOMAINS: Record<Domain, DomainConfig> = {
  pottery: {
    file: "pottery-actions.ts",
    schemasConst: "potteryActionSchemas",
    typeName: "PotteryActionType",
    executorsConst: "potteryActionExecutors",
    labelFn: "buildPotteryActionLabel",
    toolsConst: "potteryActionTools",
    executorPrefix: "potteryAction",
    readExecutorPrefix: "collectionRead",
    capabilityDomain: "pottery",
    sentinelFamily: "pottery",
    wiringStrategy: "collection",
  },
  quilting: {
    file: "quilting-actions.ts",
    schemasConst: "quiltingActionSchemas",
    typeName: "QuiltingActionType",
    executorsConst: "quiltingActionExecutors",
    labelFn: "buildQuiltingActionLabel",
    toolsConst: "quiltingActionTools",
    executorPrefix: "quiltingAction",
    readExecutorPrefix: "quiltingRead",
    capabilityDomain: "quilting",
    sentinelFamily: "quilting",
    wiringStrategy: "collection",
  },
  ornaments: {
    file: "ornaments-actions.ts",
    schemasConst: "ornamentActionSchemas",
    typeName: "OrnamentActionType",
    executorsConst: "ornamentActionExecutors",
    labelFn: "buildOrnamentActionLabel",
    toolsConst: "ornamentActionTools",
    executorPrefix: "ornamentAction",
    readExecutorPrefix: "ornamentRead",
    capabilityDomain: "ornaments",
    sentinelFamily: "ornaments",
    wiringStrategy: "collection",
  },
  /**
   * travels — new actions wired inline into index.ts:
   *   ActionBody union, TRAVEL_ACTION_EXECUTORS, buildActionLabel switch,
   *   and ACTION_TOOLS in planner-tool-catalog.ts.
   *
   * The per-action payload schema and executor are imported from the
   * scaffolded-tools/ stub directly into both files.
   */
  travels: {
    file: null,
    schemasConst: "ActionBody",
    typeName: "TravelActionType",
    executorsConst: "TRAVEL_ACTION_EXECUTORS",
    labelFn: "buildActionLabel",
    toolsConst: "ACTION_TOOLS",
    executorPrefix: "travelAction",
    readExecutorPrefix: "travelRead",
    capabilityDomain: "travels",
    sentinelFamily: "travels",
    wiringStrategy: "travels",
  },
  /**
   * universal — new actions wired into universal-actions.ts, which follows a
   * slightly different pattern from collection domains: the TypeScript union
   * type is derived from a UNIVERSAL_ACTION_TYPES string-literal array rather
   * than declared as an explicit union.
   *
   * Maps to the "office" capability domain; review after scaffolding if the
   * new tool belongs to the "notifications" domain instead.
   */
  universal: {
    file: "universal-actions.ts",
    schemasConst: "universalActionSchemas",
    typeName: "UniversalActionType",
    executorsConst: "universalActionExecutors",
    labelFn: "buildUniversalActionLabel",
    toolsConst: "universalActionTools",
    executorPrefix: "officeAction",
    readExecutorPrefix: "officeRead",
    capabilityDomain: "office",
    sentinelFamily: "office",
    wiringStrategy: "universal",
    typesConst: "UNIVERSAL_ACTION_TYPES",
  },
};

// ─── Anchor registry ────────────────────────────────────────────────────────
//
// Every string that `insertAfterAnchor` (or a raw indexOf) relies on to locate
// its insertion point in a shared file. The scaffold-elaine-action.test.ts
// anchor-presence block reads each file and asserts the anchor is still there,
// so a rename/refactor that deletes one fails loudly instead of silently
// producing a no-op scaffold run.

const ELAINE_RELDIR = "artifacts/api-server/src/elaine";

export const SCAFFOLD_ELAINE_ACTION_ANCHORS: ReadonlyArray<{
  file: string;
  anchor: string;
}> = [
  // capability-registry.ts
  {
    file: `${ELAINE_RELDIR}/capability-registry.ts`,
    anchor: "const POLICY_ROWS: ElaineCapabilityPolicy[] = [",
  },
  {
    file: `${ELAINE_RELDIR}/capability-registry.ts`,
    anchor: "NARROW_READ_CHANNEL_JUSTIFICATIONS",
  },
  // restricted-channel-config.ts
  {
    file: `${ELAINE_RELDIR}/restricted-channel-config.ts`,
    anchor:
      "export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE: readonly string[] = [",
  },
  {
    file: `${ELAINE_RELDIR}/restricted-channel-config.ts`,
    anchor:
      "export const RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE: readonly string[] = [",
  },
  // planner-tool-catalog.ts
  {
    file: `${ELAINE_RELDIR}/planner-tool-catalog.ts`,
    anchor: `import type OpenAI from "openai";`,
  },
  {
    file: `${ELAINE_RELDIR}/planner-tool-catalog.ts`,
    anchor: "export const SOFT_TOOLS_EXTRA",
  },
  // runtime/model-tool-policy.ts
  {
    file: `${ELAINE_RELDIR}/runtime/model-tool-policy.ts`,
    anchor: "export const MODEL_VISIBLE_HARD_TOOL_NAMES = new Set<string>([",
  },
  {
    file: `${ELAINE_RELDIR}/runtime/model-tool-policy.ts`,
    anchor: "export const MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS",
  },
  // runtime/model-tool-policy.test.ts
  {
    file: `${ELAINE_RELDIR}/runtime/model-tool-policy.test.ts`,
    anchor: "const IMPLEMENTED_MAIN_CHAT_HARD_TOOLS = [",
  },
  // scaffolded-read-registry.ts
  {
    file: `${ELAINE_RELDIR}/scaffolded-read-registry.ts`,
    anchor: "type ScaffoldedReadExecutor",
  },
  {
    file: `${ELAINE_RELDIR}/scaffolded-read-registry.ts`,
    anchor: "export const SCAFFOLDED_READ_TOOL_EXECUTORS",
  },
  // runtime/tool-families.ts
  {
    file: `${ELAINE_RELDIR}/runtime/tool-families.ts`,
    anchor: "export const ELAINE_TOOL_FAMILY_SENTINELS = {",
  },
  // runtime/evaluation-corpus.ts
  {
    file: `${ELAINE_RELDIR}/runtime/evaluation-corpus.ts`,
    anchor: `id: "legacy-tool-families"`,
  },
  {
    file: `${ELAINE_RELDIR}/runtime/evaluation-corpus.ts`,
    anchor: "availableTools: [",
  },
  // elaine-capability-parity.ts (scripts package)
  {
    file: "scripts/src/elaine-capability-parity.ts",
    anchor: "const DIRECT_TOOL_MAP: Record<string, string[]> = {",
  },
  // per-domain action files (collection strategy only — pottery/quilting/ornaments)
  // Travels uses inline index.ts wiring (registered below); universal has its own block.
  ...Object.values(DOMAINS)
    .filter((cfg) => cfg.wiringStrategy === "collection" && cfg.file !== null)
    .flatMap((cfg) => [
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `import { z } from "zod/v4";`,
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `export const ${cfg.schemasConst}`,
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `export type ${cfg.typeName} =`,
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `export const ${cfg.executorsConst}`,
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `function ${cfg.labelFn}`,
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: "switch (action.type) {",
      },
      {
        file: `${ELAINE_RELDIR}/${cfg.file}`,
        anchor: `export const ${cfg.toolsConst}`,
      },
    ]),

  // travels strategy — anchors used by buildTravelsFileEdits in index.ts
  // and planner-tool-catalog.ts.
  {
    file: `${ELAINE_RELDIR}/index.ts`,
    anchor: `import { parseToolCallArgs } from "./tool-call-args";`,
  },
  {
    file: `${ELAINE_RELDIR}/index.ts`,
    anchor: "  ...potteryActionSchemas,",
  },
  {
    file: `${ELAINE_RELDIR}/index.ts`,
    anchor:
      "const TRAVEL_ACTION_EXECUTORS: Record<TravelActionType, ActionExecutor> = {",
  },
  {
    file: `${ELAINE_RELDIR}/index.ts`,
    anchor: "async function buildActionLabel(",
  },
  {
    file: `${ELAINE_RELDIR}/index.ts`,
    anchor: "\n    default:",
  },
  {
    file: `${ELAINE_RELDIR}/planner-tool-catalog.ts`,
    anchor: "  ...potteryActionTools,",
  },

  // universal strategy — anchors used by buildUniversalFileEdits in universal-actions.ts.
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: `import { z } from "zod/v4";`,
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "export const universalActionSchemas",
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "export const UNIVERSAL_ACTION_TYPES",
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "export const universalActionExecutors",
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "function buildUniversalActionLabel",
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "switch (action.type) {",
  },
  {
    file: `${ELAINE_RELDIR}/universal-actions.ts`,
    anchor: "export const universalActionTools",
  },
];

// ─── Spec parsing ────────────────────────────────────────────────────────────

export interface FieldSpec {
  name: string;
  type: "string" | "int" | "number" | "boolean" | "string[]";
  optional: boolean;
}

export interface ToolSpec {
  name: string;
  domain: Domain;
  kind: "action" | "read";
  risk: "medium" | "high";
  fields: FieldSpec[];
  destructive: boolean;
  webOnly: boolean;
  /** Action tools: insert into RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE instead of the excluded array. */
  restrictedAllowed: boolean;
  operationId?: string;
  dryRun: boolean;
}

export function parseFields(raw: string): FieldSpec[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((entry) => {
    const [name, typeRaw] = entry.trim().split(":");
    if (!name || !typeRaw) {
      throw new Error(`Bad field entry "${entry}" — expected name:type`);
    }
    const optional = typeRaw.endsWith("?");
    const type = (
      optional ? typeRaw.slice(0, -1) : typeRaw
    ) as FieldSpec["type"];
    if (!["string", "int", "number", "boolean", "string[]"].includes(type)) {
      throw new Error(
        `Bad field type "${type}" for "${name}" — use string,int,number,boolean,string[]`,
      );
    }
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
      throw new Error(
        `Bad field name "${name}" — must be camelCase identifier`,
      );
    }
    return { name, type, optional };
  });
}

export function parseArgs(argv: string[]): ToolSpec {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  const name = get("--name") ?? "";
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`--name must be snake_case, got "${name}"`);
  }
  const domain = get("--domain") as Domain;
  if (!domain || !(domain in DOMAINS)) {
    throw new Error(
      `--domain must be one of ${Object.keys(DOMAINS).join("|")}`,
    );
  }
  const kind = (get("--kind") ?? "action") as ToolSpec["kind"];
  if (kind !== "action" && kind !== "read") {
    throw new Error(`--kind must be action|read`);
  }
  const risk = (get("--risk") ?? "medium") as ToolSpec["risk"];
  if (risk !== "medium" && risk !== "high") {
    throw new Error(`--risk must be medium|high`);
  }
  const restrictedAllowed = has("--restricted-allowed");
  if (restrictedAllowed && has("--web-only")) {
    throw new Error(
      "--restricted-allowed and --web-only are mutually exclusive: an action type must appear in exactly one of the restricted-channel allowed/excluded arrays.",
    );
  }
  if (restrictedAllowed && kind === "read") {
    throw new Error(
      "--restricted-allowed only applies to --kind action; read tools scaffold web-only and widening them needs a hand-written restricted-channel handler.",
    );
  }
  return {
    name,
    domain,
    kind,
    risk,
    fields: parseFields(get("--fields") ?? ""),
    destructive: has("--destructive"),
    // Actions default to web-only (restricted-excluded) unless explicitly
    // allowed on restricted channels; every action type must land in exactly
    // one of the two restricted-channel source arrays (Scan J).
    webOnly: kind === "action" ? !restrictedAllowed : has("--web-only"),
    restrictedAllowed,
    operationId: get("--operation-id"),
    dryRun: has("--dry-run"),
  };
}

// ─── Casing helpers ──────────────────────────────────────────────────────────

export const toPascal = (s: string) =>
  s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
export const toCamel = (s: string) => {
  const p = toPascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};
export const toKebab = (s: string) => s.replace(/_/g, "-");
// Escapes regex metacharacters so a CLI-arg-derived string can be embedded
// in a `new RegExp(...)` and matched literally instead of as a pattern.
export const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─── Zod / JSON-schema codegen ───────────────────────────────────────────────

export function zodFor(f: FieldSpec): string {
  const base = {
    string: "z.string().max(2000)",
    int: "z.number().int()",
    number: "z.number()",
    boolean: "z.boolean()",
    "string[]": "z.array(z.string().max(2000)).max(100)",
  }[f.type];
  return f.optional ? `${base}.optional()` : base;
}

export function jsonSchemaFor(f: FieldSpec): string {
  const base = {
    string: `{ type: "string" }`,
    int: `{ type: "integer" }`,
    number: `{ type: "number" }`,
    boolean: `{ type: "boolean" }`,
    "string[]": `{ type: "array", items: { type: "string" } }`,
  }[f.type];
  return base;
}

export function sampleValueFor(f: FieldSpec): string {
  return {
    string: `"example"`,
    int: "1",
    number: "1",
    boolean: "true",
    "string[]": `["example"]`,
  }[f.type];
}

// ─── Anchored insertion helpers ──────────────────────────────────────────────

/**
 * Insert `insertion` immediately after the first occurrence of `open` that
 * appears at-or-after the index of `anchor`. Throws when either is missing so
 * a refactor that moves an anchor fails loudly instead of silently skipping.
 */
export function insertAfterAnchor(
  content: string,
  anchor: string | RegExp,
  insertion: string,
  open?: string | RegExp,
  placement: "after" | "before" = "after",
): string {
  const anchorIdx =
    typeof anchor === "string"
      ? content.indexOf(anchor)
      : (content.match(anchor)?.index ?? -1);
  if (anchorIdx < 0) throw new Error(`Anchor not found: ${anchor}`);
  let insertAt: number;
  if (open === undefined) {
    if (placement === "before") {
      insertAt = anchorIdx;
    } else {
      const anchorLen =
        typeof anchor === "string"
          ? anchor.length
          : content.match(anchor)![0].length;
      insertAt = anchorIdx + anchorLen;
    }
  } else if (typeof open === "string") {
    const openIdx = content.indexOf(open, anchorIdx);
    if (openIdx < 0)
      throw new Error(`Opening token not found after anchor: ${open}`);
    insertAt = openIdx + open.length;
  } else {
    const rest = content.slice(anchorIdx);
    const m = rest.match(open);
    if (!m || m.index === undefined)
      throw new Error(`Opening token not found after anchor: ${open}`);
    insertAt = anchorIdx + m.index + m[0].length;
  }
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

interface Edit {
  file: string;
  description: string;
  /** Returns null when the edit is already present (idempotent skip). */
  apply: (content: string) => string | null;
}

function runEdits(edits: Edit[], dryRun: boolean): string[] {
  const touched: string[] = [];
  for (const edit of edits) {
    const content = fs.readFileSync(edit.file, "utf8");
    const next = edit.apply(content);
    if (next === null) {
      console.log(`  ⏭  skip (already present): ${edit.description}`);
      continue;
    }
    if (dryRun) {
      console.log(`  📝 would apply: ${edit.description}`);
    } else {
      fs.writeFileSync(edit.file, next);
      console.log(`  ✅ ${edit.description}`);
    }
    touched.push(edit.file);
  }
  return touched;
}

// ─── Stub-file generation ────────────────────────────────────────────────────

export function buildStubFile(spec: ToolSpec): string {
  const pascal = toPascal(spec.name);
  const camel = toCamel(spec.name);
  const zodFields = spec.fields
    .map((f) => `  ${f.name}: ${zodFor(f)},`)
    .join("\n");
  const jsonProps = spec.fields
    .map((f) => `        ${f.name}: ${jsonSchemaFor(f)},`)
    .join("\n");
  const required = spec.fields
    .filter((f) => !f.optional)
    .map((f) => `"${f.name}"`)
    .join(", ");
  const destructiveNote = spec.destructive
    ? " Since this is destructive, say clearly in your visible reply that this will DELETE/permanently change data."
    : "";
  return `/**
 * ${toKebab(spec.name)}.ts — scaffolded by \`pnpm --filter @workspace/scripts run scaffold:elaine-action\`.
 *
 * TODO(scaffold): implement the executor's real business logic below, then
 * replace the TODO description text with a human-authored one and delete
 * this banner. See .agents/memory/elaine-action-tool-checklist.md.
 */
import { z } from "zod/v4";
import type OpenAI from "openai";

export const ${pascal}ActionPayload = z.object({
${zodFields}
});

export async function execute${pascal}Action(
  payload: z.infer<typeof ${pascal}ActionPayload>,
  userId: number,
): Promise<{ status: number; body: unknown }> {
  // TODO(scaffold): implement the real business logic for ${spec.name}.
  void payload;
  void userId;
  return {
    status: 501,
    body: { error: "${spec.name} is not implemented yet (scaffold stub)" },
  };
}

export const ${camel}Tool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "${spec.name}",
    description:
      "TODO(scaffold): describe when the model should call ${spec.name} (human judgment — include example user phrasings and any id-visibility requirements).${destructiveNote}",
    parameters: {
      type: "object",
      properties: {
${jsonProps}
      },
      required: [${required}],
    },
  },
};
`;
}

export function buildTestFile(spec: ToolSpec): string {
  const pascal = toPascal(spec.name);
  const kebab = toKebab(spec.name);
  const sample = spec.fields
    .filter((f) => !f.optional)
    .map((f) => `  ${f.name}: ${sampleValueFor(f)},`)
    .join("\n");
  return `/**
 * Placeholder test for the scaffolded ${spec.name} ${spec.kind} tool.
 * TODO(scaffold): replace the 501 assertion with real behavioural tests once
 * the executor's business logic is implemented.
 */
import { describe, expect, it } from "vitest";
import {
  ${pascal}ActionPayload,
  execute${pascal}Action,
} from "./${kebab}";

describe("${spec.name} (scaffolded placeholder)", () => {
  const samplePayload = {
${sample}
  };

  it("payload schema accepts a representative payload", () => {
    expect(() => ${pascal}ActionPayload.parse(samplePayload)).not.toThrow();
  });

  it("executor stub returns 501 until the business logic is implemented", async () => {
    const result = await execute${pascal}Action(
      ${pascal}ActionPayload.parse(samplePayload),
      1,
    );
    expect(result.status).toBe(501);
  });
});
`;
}

// ─── Edit builders ───────────────────────────────────────────────────────────

export function buildCapabilityRegistryEdit(spec: ToolSpec): Edit {
  return {
    file: FILES.capabilityRegistry,
    description: `capability-registry.ts: policy row for ${spec.name}`,
    apply: (content) => {
      if (content.includes(`"${spec.name}"`)) return null;
      let block: string;
      const cfg = DOMAINS[spec.domain];
      if (spec.kind === "action") {
        const channelsLine = spec.webOnly ? `\n    channels: ["web"],` : "";
        const riskSuffix =
          spec.risk === "high"
            ? `.map((p) => ({ ...p, risk: "high" as const }))`
            : "";
        block = `
  // TODO(scaffold): review channels/risk for ${spec.name} before shipping.
  ...policies(["${spec.name}"], {
    ...ACTION_DEFAULTS,
    domain: "${cfg.capabilityDomain}",
    executorPrefix: "${cfg.executorPrefix}",${channelsLine}
  })${riskSuffix},`;
      } else {
        block = `
  // TODO(scaffold): web-only for now — widening to ALL_READ_CHANNELS requires
  // a restricted-channel handler branch (see restricted-channel-config.ts).
  ...policies(["${spec.name}"], {
    domain: "${cfg.capabilityDomain}",
    kind: "read",
    risk: "none",
    auth: "session",
    confirmation: "never",
    executorPrefix: "${cfg.readExecutorPrefix}",
    audit: "runtime_observation",
    retry: "read_only",
    channels: ["web"],
  }),`;
      }
      let next = insertAfterAnchor(
        content,
        "const POLICY_ROWS: ElaineCapabilityPolicy[] = [",
        block,
      );
      if (spec.kind === "read") {
        next = insertAfterAnchor(
          next,
          "NARROW_READ_CHANNEL_JUSTIFICATIONS",
          `\n  ${spec.name}:\n    "TODO(scaffold): justify why ${spec.name} is web-only, or widen its " +\n    "channels to ALL_READ_CHANNELS and add a restricted-channel handler.",`,
          /=\s*\{/,
        );
      }
      return next;
    },
  };
}

function buildPerAppFileEdits(spec: ToolSpec): Edit[] {
  const cfg = DOMAINS[spec.domain];
  if (!cfg.file) {
    throw new Error(
      `buildPerAppFileEdits called for domain "${spec.domain}" which has no per-domain file (file: null). Use the appropriate builder for this wiring strategy.`,
    );
  }
  const file = path.join(ELAINE_DIR, cfg.file);
  const pascal = toPascal(spec.name);
  const camel = toCamel(spec.name);
  const kebab = toKebab(spec.name);
  return [
    {
      file,
      description: `${cfg.file}: import + schema + union + executor + label + tool entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`"${spec.name}"`)) return null;
        let next = content;
        // 1. import of the scaffolded stub module (top of file, after zod import)
        next = insertAfterAnchor(
          next,
          `import { z } from "zod/v4";`,
          `\nimport {\n  ${pascal}ActionPayload,\n  execute${pascal}Action,\n  ${camel}Tool,\n} from "./scaffolded-tools/${kebab}";`,
        );
        // 2. discriminated-union schema entry
        next = insertAfterAnchor(
          next,
          `export const ${cfg.schemasConst}`,
          `\n  z.object({ type: z.literal("${spec.name}"), payload: ${pascal}ActionPayload }),`,
          /=\s*\[/,
        );
        // 3. type-union member
        next = insertAfterAnchor(
          next,
          `export type ${cfg.typeName} =`,
          `\n  | "${spec.name}"`,
        );
        // 4. executor map entry
        next = insertAfterAnchor(
          next,
          `export const ${cfg.executorsConst}`,
          `\n  ${spec.name}: execute${pascal}Action as ActionExecutor,`,
          /=\s*\{|>\s*=\s*\{|\{/,
        );
        // 5. label switch case
        next = insertAfterAnchor(
          next,
          `function ${cfg.labelFn}`,
          `\n    case "${spec.name}":\n      // TODO(scaffold): human-authored confirmation label for ${spec.name}.\n      return "TODO: confirm ${spec.name}";`,
          "switch (action.type) {",
        );
        // 6. model tool definition entry
        next = insertAfterAnchor(
          next,
          `export const ${cfg.toolsConst}`,
          `\n    ${camel}Tool,`,
          /=\s*\[/,
        );
        return next;
      },
    },
  ];
}

/**
 * Edit builders for the "travels" wiring strategy.
 *
 * Travels action tools are wired inline into index.ts (ActionBody union,
 * TRAVEL_ACTION_EXECUTORS map, buildActionLabel switch) rather than a
 * self-contained per-domain file. The model-facing tool definition is
 * imported from the stub and added to ACTION_TOOLS in planner-tool-catalog.ts.
 *
 * Stable anchors used:
 *   ActionBody union   — insert before `  ...potteryActionSchemas,` (first spread)
 *   TRAVEL_EXECUTORS   — insert at the top of the Record literal
 *   buildActionLabel   — insert before `default:` inside `buildActionLabel`
 *   ACTION_TOOLS       — insert before `  ...potteryActionTools,` (first spread)
 */
export function buildTravelsFileEdits(spec: ToolSpec): Edit[] {
  const pascal = toPascal(spec.name);
  const camel = toCamel(spec.name);
  const kebab = toKebab(spec.name);

  return [
    // ── index.ts: import payload + executor from stub ──────────────────────
    {
      file: FILES.elaineIndex,
      description: `index.ts: import payload+executor for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`./scaffolded-tools/${kebab}`)) return null;
        return insertAfterAnchor(
          content,
          `import { parseToolCallArgs } from "./tool-call-args";`,
          `\nimport {\n  ${pascal}ActionPayload,\n  execute${pascal}Action,\n} from "./scaffolded-tools/${kebab}";`,
        );
      },
    },
    // ── index.ts: ActionBody discriminated-union entry ─────────────────────
    {
      file: FILES.elaineIndex,
      description: `index.ts: ActionBody union entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`z.literal("${spec.name}")`)) return null;
        // Insert before the first spread entry so new tools stay grouped with
        // other inline travels entries and above the collection-domain spreads.
        return insertAfterAnchor(
          content,
          "  ...potteryActionSchemas,",
          `  z.object({ type: z.literal("${spec.name}"), payload: ${pascal}ActionPayload }),\n`,
          undefined,
          "before",
        );
      },
    },
    // ── index.ts: TRAVEL_ACTION_EXECUTORS entry ────────────────────────────
    {
      file: FILES.elaineIndex,
      description: `index.ts: TRAVEL_ACTION_EXECUTORS entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`${spec.name}: execute${pascal}Action`))
          return null;
        return insertAfterAnchor(
          content,
          "const TRAVEL_ACTION_EXECUTORS: Record<TravelActionType, ActionExecutor> = {",
          `\n  ${spec.name}: execute${pascal}Action as ActionExecutor,`,
        );
      },
    },
    // ── index.ts: buildActionLabel switch case ─────────────────────────────
    {
      file: FILES.elaineIndex,
      description: `index.ts: buildActionLabel switch case for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`case "${spec.name}":`)) return null;
        // Two-step: anchor on the function declaration, then find the
        // `default:` fall-through block within it and insert BEFORE it so
        // new travel cases land above the collection-domain delegation checks.
        //
        // NOTE: insertAfterAnchor's `placement:"before"` is only honoured when
        // `open` is undefined; when `open` is a string it always inserts AFTER
        // the opening token.  We therefore do the two-step manually here.
        const FN_ANCHOR = "async function buildActionLabel(";
        const fnIdx = content.indexOf(FN_ANCHOR);
        if (fnIdx < 0) throw new Error(`Anchor not found: ${FN_ANCHOR}`);
        const DEFAULT_MARKER = "\n    default:";
        const defaultIdx = content.indexOf(DEFAULT_MARKER, fnIdx);
        if (defaultIdx < 0)
          throw new Error(`"default:" not found after ${FN_ANCHOR}`);
        const insertion =
          `\n    case "${spec.name}":\n` +
          `      // TODO(scaffold): human-authored confirmation label for ${spec.name}.\n` +
          `      return "TODO: confirm ${spec.name}";`;
        return (
          content.slice(0, defaultIdx) + insertion + content.slice(defaultIdx)
        );
      },
    },
    // ── planner-tool-catalog.ts: import + ACTION_TOOLS entry ──────────────
    {
      file: FILES.plannerCatalog,
      description: `planner-tool-catalog.ts: import + ACTION_TOOLS entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`./scaffolded-tools/${kebab}`)) return null;
        // 1. import the tool definition from the stub
        let next = insertAfterAnchor(
          content,
          `import type OpenAI from "openai";`,
          `\nimport { ${camel}Tool } from "./scaffolded-tools/${kebab}";`,
        );
        // 2. add to ACTION_TOOLS before the collection-domain spreads
        next = insertAfterAnchor(
          next,
          "  ...potteryActionTools,",
          `  ${camel}Tool,\n`,
          undefined,
          "before",
        );
        return next;
      },
    },
  ];
}
export function buildReadToolCatalogEdits(spec: ToolSpec): Edit[] {
  const camel = toCamel(spec.name);
  const kebab = toKebab(spec.name);
  return [
    {
      file: FILES.plannerCatalog,
      description: `planner-tool-catalog.ts: SOFT_TOOLS_EXTRA entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`scaffolded-tools/${kebab}`)) return null;
        let next = insertAfterAnchor(
          content,
          `import type OpenAI from "openai";`,
          `\nimport { ${camel}Tool } from "./scaffolded-tools/${kebab}";`,
        );
        next = insertAfterAnchor(
          next,
          "export const SOFT_TOOLS_EXTRA",
          `\n  ${camel}Tool,`,
          /=\s*\[/,
        );
        return next;
      },
    },
    {
      file: FILES.modelToolPolicy,
      description: `model-tool-policy.ts: MODEL_VISIBLE_HARD_TOOL_NAMES + status label for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`"${spec.name}"`)) return null;
        let next = insertAfterAnchor(
          content,
          "export const MODEL_VISIBLE_HARD_TOOL_NAMES = new Set<string>([",
          `\n  "${spec.name}",`,
        );
        // Every model-visible hard tool must have a truthy status label
        // (enforced by runtime/model-tool-policy.test.ts).
        next = insertAfterAnchor(
          next,
          "export const MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS",
          `\n  // TODO(scaffold): replace with a human-written status label for ${spec.name}.\n  ${spec.name}: "checking ${spec.domain} data",`,
          /=\s*\{/,
        );
        return next;
      },
    },
    {
      file: FILES.modelToolPolicyTest,
      description: `model-tool-policy.test.ts: IMPLEMENTED_MAIN_CHAT_HARD_TOOLS entry for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`"${spec.name}"`)) return null;
        return insertAfterAnchor(
          content,
          "const IMPLEMENTED_MAIN_CHAT_HARD_TOOLS = [",
          `\n  "${spec.name}",`,
        );
      },
    },
    buildReadRegistryEdit(spec),
  ];
}

/**
 * Wires the read tool into index.ts's hard-tool dispatcher via the permanent
 * SCAFFOLDED_READ_TOOL_EXECUTORS registry (scaffolded-read-registry.ts), so a
 * freshly scaffolded read tool resolves end-to-end (returning its 501 stub
 * message) instead of "Unsupported tool.".
 */
export function buildReadRegistryEdit(spec: ToolSpec): Edit {
  const pascal = toPascal(spec.name);
  const kebab = toKebab(spec.name);
  return {
    file: FILES.readRegistry,
    description: `scaffolded-read-registry.ts: dispatch entry for ${spec.name}`,
    apply: (content) => {
      if (content.includes(`"${spec.name}"`)) return null;
      let next = insertAfterAnchor(
        content,
        "type ScaffoldedReadExecutor",
        `import {\n  ${pascal}ActionPayload,\n  execute${pascal}Action,\n} from "./scaffolded-tools/${kebab}";\n\n`,
        undefined,
        "before",
      );
      next = insertAfterAnchor(
        next,
        "export const SCAFFOLDED_READ_TOOL_EXECUTORS",
        `\n  "${spec.name}": async (args, userId) => {
    const parsed = ${pascal}ActionPayload.safeParse(JSON.parse(args || "{}"));
    if (!parsed.success) return "Invalid parameters for ${spec.name}.";
    const result = await execute${pascal}Action(parsed.data, userId);
    return JSON.stringify(result.body);
  },`,
        /=\s*\{/,
      );
      return next;
    },
  };
}

function buildSentinelEdits(spec: ToolSpec): Edit[] {
  const cfg = DOMAINS[spec.domain];
  const family = cfg.sentinelFamily;
  return [
    {
      file: FILES.toolFamilies,
      description: `tool-families.ts: ${family} sentinel for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`"${spec.name}"`)) return null;
        return insertAfterAnchor(
          content,
          "export const ELAINE_TOOL_FAMILY_SENTINELS = {",
          `"${spec.name}", `,
          new RegExp(`${family}:\\s*\\[`),
        );
      },
    },
    {
      file: FILES.evaluationCorpus,
      description: `evaluation-corpus.ts: legacy-tool-families fixture entry for ${spec.name}`,
      apply: (content) => {
        const fixtureIdx = content.indexOf(`id: "legacy-tool-families"`);
        if (fixtureIdx < 0)
          throw new Error("legacy-tool-families fixture not found");
        const region = content.slice(fixtureIdx, fixtureIdx + 3000);
        if (region.includes(`"${spec.name}"`)) return null;
        return insertAfterAnchor(
          content,
          `id: "legacy-tool-families"`,
          `\n        "${spec.name}",`,
          "availableTools: [",
        );
      },
    },
  ];
}

/**
 * Every action type must appear in exactly one of the restricted-channel
 * allowed/excluded source arrays (Scan J). Default is excluded (web-only);
 * --restricted-allowed opts into the allowed array instead.
 */
export function buildRestrictedClassificationEdit(spec: ToolSpec): Edit {
  const allowed = spec.restrictedAllowed;
  const anchor = allowed
    ? "export const RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE: readonly string[] = ["
    : "export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE: readonly string[] = [";
  const comment = allowed
    ? `// TODO(scaffold): human-authored reason why ${spec.name} is safe on restricted channels (SMS/voice/email/Slack).`
    : `// TODO(scaffold): human-authored reason why ${spec.name} is web-only.`;
  return {
    file: FILES.restrictedConfig,
    description: `restricted-channel-config.ts: ${allowed ? "restricted-allowed" : "web-only exclusion"} entry for ${spec.name}`,
    apply: (content) => {
      if (content.includes(`"${spec.name}"`)) return null;
      return insertAfterAnchor(
        content,
        anchor,
        `\n  ${comment}\n  "${spec.name}",`,
      );
    },
  };
}

function buildDirectMappingEdits(spec: ToolSpec): Edit[] {
  const opId = spec.operationId!;
  return [
    {
      file: FILES.parityScript,
      description: `elaine-capability-parity.ts: DIRECT_TOOL_MAP entry ${opId} → ${spec.name}`,
      apply: (content) => {
        const anchor = "const DIRECT_TOOL_MAP: Record<string, string[]> = {";
        const idx = content.indexOf(anchor);
        if (idx < 0) throw new Error("DIRECT_TOOL_MAP anchor not found");
        // opId comes from a CLI flag; escape it before building a RegExp so
        // it's matched as a literal operationId, not interpreted as a
        // regex pattern.
        if (
          new RegExp(`\\b${escapeRegExp(opId)}:`).test(
            content.slice(idx, idx + 8000),
          )
        )
          return null;
        return insertAfterAnchor(
          content,
          anchor,
          `\n  ${opId}: ["${spec.name}"],`,
        );
      },
    },
    {
      file: FILES.inventory,
      description: `website-operation-inventory.json: ${opId} → direct/${spec.name}`,
      apply: (content) => {
        const inventory = JSON.parse(content) as Array<{
          operationId: string;
          disposition: string;
          mappedTools: string[];
          reason: string;
        }>;
        const entry = inventory.find((op) => op.operationId === opId);
        if (!entry) {
          console.warn(
            `  ⚠️  operationId "${opId}" not found in website-operation-inventory.json — if the route is new, regenerate the inventory first, then re-run this scaffold.`,
          );
          return null;
        }
        if (
          entry.disposition === "direct" &&
          entry.mappedTools.includes(spec.name)
        )
          return null;
        entry.disposition = "direct";
        entry.mappedTools = [spec.name];
        entry.reason = `Dedicated Elaine tool ${spec.name} covers this operation directly.`;
        return JSON.stringify(inventory, null, 2) + "\n";
      },
    },
  ];
}

// ─── Main ────────────────────────────────────────────────────────────────────

function run(cmd: string, opts: { allowFail?: boolean } = {}): boolean {
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit" });
    return true;
  } catch {
    if (!opts.allowFail) throw new Error(`Command failed: ${cmd}`);
    return false;
  }
}

export function main(argv: string[]): void {
  const spec = parseArgs(argv);
  const kebab = toKebab(spec.name);
  console.log(
    `Scaffolding Elaine ${spec.kind} tool "${spec.name}" (domain=${spec.domain}, risk=${spec.risk}${spec.webOnly ? ", web-only" : ""}${spec.destructive ? ", destructive" : ""})`,
  );

  // 1. Stub module + placeholder test (whole-file writes, idempotent by
  //    existence check — never overwrite a stub someone already filled in).
  const stubPath = path.join(STUB_DIR, `${kebab}.ts`);
  const testPath = path.join(STUB_DIR, `${kebab}.test.ts`);
  if (!spec.dryRun) fs.mkdirSync(STUB_DIR, { recursive: true });
  for (const [p, builder] of [
    [stubPath, () => buildStubFile(spec)],
    [testPath, () => buildTestFile(spec)],
  ] as const) {
    if (spec.dryRun) {
      if (fs.existsSync(p)) {
        console.log(`  ⏭  skip (exists): ${path.relative(REPO_ROOT, p)}`);
      } else {
        console.log(`  📝 would create: ${path.relative(REPO_ROOT, p)}`);
      }
      continue;
    }
    // Exclusive create ("wx") folds the existence check and the write into
    // one atomic operation instead of a separate existsSync-then-write.
    try {
      fs.writeFileSync(p, builder(), { flag: "wx" });
      console.log(`  ✅ created ${path.relative(REPO_ROOT, p)}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        console.log(`  ⏭  skip (exists): ${path.relative(REPO_ROOT, p)}`);
      } else {
        throw err;
      }
    }
  }

  // 2. Anchored insertions.
  const cfg = DOMAINS[spec.domain];
  const edits: Edit[] = [buildCapabilityRegistryEdit(spec)];
  if (spec.kind === "action") {
    switch (cfg.wiringStrategy) {
      case "collection":
        edits.push(...buildPerAppFileEdits(spec));
        break;
      case "travels":
        edits.push(...buildTravelsFileEdits(spec));
        break;
      case "universal":
        edits.push(...buildUniversalFileEdits(spec));
        break;
    }
    edits.push(buildRestrictedClassificationEdit(spec));
  } else {
    edits.push(...buildReadToolCatalogEdits(spec));
  }
  edits.push(...buildSentinelEdits(spec));
  if (spec.operationId) edits.push(...buildDirectMappingEdits(spec));

  const touched = runEdits(edits, spec.dryRun);

  if (spec.dryRun) {
    console.log("\nDry run — nothing written.");
    return;
  }

  // 3. Format touched files so anchored insertions match repo style. Passed
  // as an argv array via execFileSync (not interpolated into a shell
  // string) so a touched path can never be reinterpreted by the shell.
  const formatTargets = [...new Set([...touched, stubPath, testPath])]
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.relative(REPO_ROOT, f));
  if (formatTargets.length > 0) {
    console.log(`\n$ pnpm exec prettier --write ${formatTargets.join(" ")}`);
    execFileSync("pnpm", ["exec", "prettier", "--write", ...formatTargets], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }

  // 4. Regenerate the operation catalog and check capability parity.
  run("pnpm --filter @workspace/scripts run elaine:operation-catalog-write", {
    allowFail: true,
  });
  const parityOk = run(
    "pnpm --filter @workspace/scripts run elaine:capability-parity",
    { allowFail: true },
  );

  const labelFile =
    spec.kind === "read"
      ? "(n/a for read tools)"
      : cfg.wiringStrategy === "travels"
        ? "index.ts (buildActionLabel switch)"
        : cfg.file
          ? cfg.file
          : "index.ts";

  console.log(`
──────────────────────────────────────────────────────────────────────────────
Scaffold complete for "${spec.name}". Remaining HUMAN work (search TODO(scaffold)):
  1. Implement the executor body in artifacts/api-server/src/elaine/scaffolded-tools/${kebab}.ts
  2. Write the model-facing tool description (when to call it) in the same file
  3. Write the confirmation label in ${labelFile}
  4. Add a system-prompt paragraph in index.ts if the tool needs behavioural guidance
${spec.kind === "read" ? "  5. Read dispatch is wired via scaffolded-read-registry.ts — the tool\n     resolves end-to-end and returns its 501 stub message until step 1 is done.\n" : ""}${parityOk ? "" : "  ⚠️  capability-parity check FAILED — inspect output above.\n"}Then run: pnpm run typecheck && vitest (api-server) to verify.
──────────────────────────────────────────────────────────────────────────────`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/**
 * Edit builders for the "universal" wiring strategy.
 *
 * Universal action tools wire into universal-actions.ts, which is like a
 * collection-domain file but derives its TypeScript union type from a
 * string-literal TYPES array (UNIVERSAL_ACTION_TYPES) rather than declaring
 * an explicit union. Insertions therefore touch six points in that file:
 *   1. import from stub
 *   2. schema array (universalActionSchemas)
 *   3. types array (UNIVERSAL_ACTION_TYPES) — the extra step vs. collection
 *   4. executor map (universalActionExecutors)
 *   5. label switch (buildUniversalActionLabel)
 *   6. tools array (universalActionTools)
 *
 * Because universalActionTools is already spread into ACTION_TOOLS in
 * planner-tool-catalog.ts, no changes to that file are needed.
 */
export function buildUniversalFileEdits(spec: ToolSpec): Edit[] {
  const cfg = DOMAINS[spec.domain];
  if (!cfg.file) {
    throw new Error(
      `buildUniversalFileEdits: domain "${spec.domain}" has no file`,
    );
  }
  const file = path.join(ELAINE_DIR, cfg.file);
  const pascal = toPascal(spec.name);
  const camel = toCamel(spec.name);
  const kebab = toKebab(spec.name);

  return [
    {
      file,
      description: `${cfg.file}: import+schema+type+executor+label+tool for ${spec.name}`,
      apply: (content) => {
        if (content.includes(`"${spec.name}"`)) return null;
        let next = content;

        // 1. import from stub (after the zod import at the top of the file)
        next = insertAfterAnchor(
          next,
          `import { z } from "zod/v4";`,
          `\nimport {\n  ${pascal}ActionPayload,\n  execute${pascal}Action,\n  ${camel}Tool,\n} from "./scaffolded-tools/${kebab}";`,
        );

        // 2. discriminated-union schema entry
        next = insertAfterAnchor(
          next,
          `export const ${cfg.schemasConst}`,
          `\n  z.object({ type: z.literal("${spec.name}"), payload: ${pascal}ActionPayload }),`,
          /=\s*\[/,
        );

        // 3. TYPES array — unique to universal-style wiring; the TypeScript
        //    union type is derived from this array, so we must insert here
        //    (rather than editing a hand-written union like collection domains).
        if (cfg.typesConst) {
          next = insertAfterAnchor(
            next,
            `export const ${cfg.typesConst}`,
            `\n  "${spec.name}",`,
            /=\s*\[/,
          );
        }

        // 4. executor map entry
        next = insertAfterAnchor(
          next,
          `export const ${cfg.executorsConst}`,
          `\n  ${spec.name}: execute${pascal}Action as ActionExecutor,`,
          /=\s*\{|>\s*=\s*\{|\{/,
        );

        // 5. label switch case
        next = insertAfterAnchor(
          next,
          `function ${cfg.labelFn}`,
          `\n    case "${spec.name}":\n      // TODO(scaffold): human-authored confirmation label for ${spec.name}.\n      return "TODO: confirm ${spec.name}";`,
          "switch (action.type) {",
        );

        // 6. tools array — universalActionTools is already spread into
        //    ACTION_TOOLS in planner-tool-catalog.ts, so no catalog edit needed.
        next = insertAfterAnchor(
          next,
          `export const ${cfg.toolsConst}`,
          `\n    ${camel}Tool,`,
          /=\s*\[/,
        );

        return next;
      },
    },
  ];
}
