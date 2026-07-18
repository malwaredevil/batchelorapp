/**
 * Deterministic build script that composes the unified OpenAPI contract for the
 * merged pottery + quilting + travels monorepo.
 *
 * Reads the three in-repo source specs (lib/api-spec/sources/{pottery,quilting,travels}.yaml)
 * and emits lib/api-spec/openapi.yaml applying the namespacing / collision rules.
 * The script self-validates before writing.
 */

import fs from "fs";
import path from "path";
import { parse, stringify } from "yaml";

const here = __dirname;
const sourcesDir = path.resolve(here, "sources");
const outPath = path.resolve(here, "openapi.yaml");

type Json = any;

// ---------------------------------------------------------------------------
// Shared definitions
// ---------------------------------------------------------------------------

const SHARED_PATHS = new Set<string>([
  "/healthz",
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/auth/providers",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/change-password",
  "/auth/phone/send-code",
  "/auth/phone/verify",
  "/auth/test-sms",
  "/auth/test-email",
]);

const HTTP_METHODS = new Set<string>([
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function seenOpsFromSets(sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => Array.from(set)));
}

/** Collect all schema names referenced (transitively) starting from a node. */
function collectSchemaRefs(
  node: Json,
  allSchemas: Record<string, Json>,
): Set<string> {
  const found = new Set<string>();

  const visitRefName = (name: string) => {
    if (found.has(name)) return;
    found.add(name);
    if (allSchemas[name] !== undefined) {
      walk(allSchemas[name]);
    }
  };

  const walk = (n: Json) => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "$ref" && typeof value === "string") {
        const m = value.match(/^#\/components\/schemas\/(.+)$/);
        if (m) visitRefName(m[1]);
      } else {
        walk(value);
      }
    }
  };

  walk(node);
  return found;
}

/** Rewrite schema $refs in-place using the provided rename map. */
function rewriteSchemaRefs(node: Json, renameMap: Map<string, string>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) rewriteSchemaRefs(item, renameMap);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      const m = value.match(/^#\/components\/schemas\/(.+)$/);
      if (m && renameMap.has(m[1])) {
        (node as Json)[key] = `#/components/schemas/${renameMap.get(m[1])}`;
      }
    } else {
      rewriteSchemaRefs(value, renameMap);
    }
  }
}

/** Rename an operationId by inserting the app word (e.g. "Pottery") after the
 *  leading camelCase verb, or prefixing single-word ids. */
function renameOpId(opId: string, appWord: string): string {
  const cap = appWord[0].toUpperCase() + appWord.slice(1);
  const m = opId.match(/^([a-z0-9]+)(.*)$/);
  if (!m) {
    return appWord + opId[0].toUpperCase() + opId.slice(1);
  }
  const first = m[1];
  const rest = m[2];
  if (rest === "") {
    return appWord + first[0].toUpperCase() + first.slice(1);
  }
  return first + cap + rest;
}

function collectFeatureOpIds(paths: Record<string, Json>): Set<string> {
  const ops = new Set<string>();
  for (const [p, item] of Object.entries(paths)) {
    if (SHARED_PATHS.has(p)) continue;
    for (const [method, op] of Object.entries(item as Json)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (op && typeof op === "object" && typeof op.operationId === "string") {
        ops.add(op.operationId);
      }
    }
  }
  return ops;
}

function collectSharedOpIds(paths: Record<string, Json>): Set<string> {
  const ops = new Set<string>();
  for (const [p, item] of Object.entries(paths)) {
    if (!SHARED_PATHS.has(p)) continue;
    for (const [method, op] of Object.entries(item as Json)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (op && typeof op === "object" && typeof op.operationId === "string") {
        ops.add(op.operationId);
      }
    }
  }
  return ops;
}

function applyOpIdRenames(pathItem: Json, renames: Map<string, string>): void {
  for (const [method, op] of Object.entries(pathItem)) {
    if (!HTTP_METHODS.has(method)) continue;
    if (
      op &&
      typeof op === "object" &&
      typeof (op as Json).operationId === "string"
    ) {
      const cur = (op as Json).operationId as string;
      if (renames.has(cur)) {
        (op as Json).operationId = renames.get(cur);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Path remapping
// ---------------------------------------------------------------------------

function remapPotteryPath(p: string): string {
  if (p === "/pottery") return "/pottery/items";
  if (p === "/pottery/stragglers") return "/pottery/items/stragglers";
  if (p.startsWith("/pottery/"))
    return "/pottery/items" + p.slice("/pottery".length);
  return "/pottery" + p;
}

function remapQuiltingPath(p: string): string {
  return "/quilting" + p;
}

function remapTravelsPath(p: string): string {
  return "/travels" + p;
}

function remapOrnamentsPath(p: string): string {
  return "/ornaments" + p;
}

function remapOfficePath(p: string): string {
  return "/office" + p;
}

function remapHubPath(p: string): string {
  return "/hub" + p;
}

function remapConfigPath(p: string): string {
  if (p === "/") return "/config";
  return "/config" + p;
}

function remapMessengerPath(p: string): string {
  return "/messenger" + p;
}

function remapJobsPath(p: string): string {
  if (p === "/") return "/jobs";
  return "/jobs" + p;
}

function remapOperationsPath(p: string): string {
  return "/operations" + p;
}

function remapNotificationsPath(p: string): string {
  if (p === "/") return "/notifications";
  return "/notifications" + p;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function loadSpec(file: string): Json {
  return parse(fs.readFileSync(path.resolve(sourcesDir, file), "utf8"));
}

function main(): void {
  const pottery = loadSpec("pottery.yaml");
  const quilting = loadSpec("quilting.yaml");
  const travels = loadSpec("travels.yaml");
  const ornaments = loadSpec("ornaments.yaml");
  const office = loadSpec("office.yaml");
  const hub = loadSpec("hub.yaml");
  const config = loadSpec("config.yaml");
  const messenger = loadSpec("messenger.yaml");
  const jobs = loadSpec("jobs.yaml");
  const operations = loadSpec("operations.yaml");
  const notifications = loadSpec("notifications.yaml");

  const potterySchemas: Record<string, Json> = (pottery.components?.schemas ??
    {}) as Json;
  const quiltingSchemas: Record<string, Json> = (quilting.components?.schemas ??
    {}) as Json;
  const travelsSchemas: Record<string, Json> = (travels.components?.schemas ??
    {}) as Json;
  const ornamentsSchemas: Record<string, Json> = (ornaments.components
    ?.schemas ?? {}) as Json;
  const officeSchemas: Record<string, Json> = (office.components?.schemas ??
    {}) as Json;
  const hubSchemas: Record<string, Json> = (hub.components?.schemas ??
    {}) as Json;
  const messengerSchemas: Record<string, Json> = (messenger.components
    ?.schemas ?? {}) as Json;
  const jobsSchemas: Record<string, Json> = (jobs.components?.schemas ??
    {}) as Json;
  const operationsSchemas: Record<string, Json> = (operations.components
    ?.schemas ?? {}) as Json;
  const notificationsSchemas: Record<string, Json> = (notifications.components
    ?.schemas ?? {}) as Json;

  // ----- Shared schema set: transitive closure of refs from quilting shared paths
  const sharedSchemaNames = new Set<string>();
  for (const [p, item] of Object.entries(
    quilting.paths as Record<string, Json>,
  )) {
    if (!SHARED_PATHS.has(p)) continue;
    for (const name of collectSchemaRefs(item, quiltingSchemas)) {
      sharedSchemaNames.add(name);
    }
  }

  // ----- Per-app schema rename maps (non-shared -> prefixed)
  const potterySchemaRename = new Map<string, string>();
  for (const name of Object.keys(potterySchemas)) {
    if (!sharedSchemaNames.has(name)) {
      potterySchemaRename.set(name, "Pottery" + name);
    }
  }

  const quiltingSchemaRename = new Map<string, string>();
  for (const name of Object.keys(quiltingSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      quiltingSchemaRename.set(name, "Quilting" + name);
    }
  }

  const travelsSchemaRename = new Map<string, string>();
  for (const name of Object.keys(travelsSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      travelsSchemaRename.set(name, "Travels" + name);
    }
  }

  const ornamentsSchemaRename = new Map<string, string>();
  for (const name of Object.keys(ornamentsSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      ornamentsSchemaRename.set(name, "Ornaments" + name);
    }
  }

  const officeSchemaRename = new Map<string, string>();
  for (const name of Object.keys(officeSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      officeSchemaRename.set(name, "Office" + name);
    }
  }

  const configSchemas: Record<string, Json> = (config.components?.schemas ??
    {}) as Json;

  const configSchemaRename = new Map<string, string>();
  for (const name of Object.keys(configSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      configSchemaRename.set(name, "Config" + name);
    }
  }

  const hubSchemaRename = new Map<string, string>();
  for (const name of Object.keys(hubSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      hubSchemaRename.set(name, "Hub" + name);
    }
  }

  const messengerSchemaRename = new Map<string, string>();
  for (const name of Object.keys(messengerSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      messengerSchemaRename.set(name, "Messenger" + name);
    }
  }

  const jobsSchemaRename = new Map<string, string>();
  for (const name of Object.keys(jobsSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      jobsSchemaRename.set(name, "Jobs" + name);
    }
  }

  const operationsSchemaRename = new Map<string, string>();
  for (const name of Object.keys(operationsSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      operationsSchemaRename.set(name, "Operations" + name);
    }
  }

  const notificationsSchemaRename = new Map<string, string>();
  for (const name of Object.keys(notificationsSchemas)) {
    if (!sharedSchemaNames.has(name)) {
      notificationsSchemaRename.set(name, "Notifications" + name);
    }
  }

  // ----- OperationId collision detection
  const sharedOpIds = collectSharedOpIds(quilting.paths as Json);
  const potteryFeatureOps = collectFeatureOpIds(pottery.paths as Json);
  const quiltingFeatureOps = collectFeatureOpIds(quilting.paths as Json);
  const travelsFeatureOps = collectFeatureOpIds(travels.paths as Json);
  const ornamentsFeatureOps = collectFeatureOpIds(ornaments.paths as Json);

  const allOtherOps = new Set([
    ...sharedOpIds,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
  ]);
  const potteryOpRename = new Map<string, string>();
  for (const op of potteryFeatureOps) {
    if (allOtherOps.has(op)) {
      potteryOpRename.set(op, renameOpId(op, "pottery"));
    }
  }

  const allOtherOpsForQuilting = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
  ]);
  const quiltingOpRename = new Map<string, string>();
  for (const op of quiltingFeatureOps) {
    if (allOtherOpsForQuilting.has(op)) {
      quiltingOpRename.set(op, renameOpId(op, "quilting"));
    }
  }

  const allOtherOpsForTravels = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...ornamentsFeatureOps,
  ]);
  const travelsOpRename = new Map<string, string>();
  for (const op of travelsFeatureOps) {
    if (allOtherOpsForTravels.has(op)) {
      travelsOpRename.set(op, renameOpId(op, "travels"));
    }
  }

  const allOtherOpsForOrnaments = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
  ]);
  const ornamentsOpRename = new Map<string, string>();
  for (const op of ornamentsFeatureOps) {
    if (allOtherOpsForOrnaments.has(op)) {
      ornamentsOpRename.set(op, renameOpId(op, "ornaments"));
    }
  }

  const officeFeatureOps = collectFeatureOpIds(office.paths as Json);
  const allOtherOpsForOffice = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
  ]);
  const officeOpRename = new Map<string, string>();
  for (const op of officeFeatureOps) {
    if (allOtherOpsForOffice.has(op)) {
      officeOpRename.set(op, renameOpId(op, "office"));
    }
  }

  const hubFeatureOps = collectFeatureOpIds(hub.paths as Json);
  const allOtherOpsForHub = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
    ...officeFeatureOps,
  ]);
  const hubOpRename = new Map<string, string>();
  for (const op of hubFeatureOps) {
    if (allOtherOpsForHub.has(op)) {
      hubOpRename.set(op, renameOpId(op, "hub"));
    }
  }

  const configFeatureOps = collectFeatureOpIds(config.paths as Json);
  const allOtherOpsForConfig = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
    ...officeFeatureOps,
    ...hubFeatureOps,
  ]);
  const configOpRename = new Map<string, string>();
  for (const op of configFeatureOps) {
    if (allOtherOpsForConfig.has(op)) {
      configOpRename.set(op, renameOpId(op, "config"));
    }
  }

  const messengerFeatureOps = collectFeatureOpIds(messenger.paths as Json);
  const allOtherOpsForMessenger = new Set([
    ...sharedOpIds,
    ...potteryFeatureOps,
    ...quiltingFeatureOps,
    ...travelsFeatureOps,
    ...ornamentsFeatureOps,
    ...officeFeatureOps,
    ...hubFeatureOps,
    ...configFeatureOps,
  ]);
  const messengerOpRename = new Map<string, string>();
  for (const op of messengerFeatureOps) {
    if (allOtherOpsForMessenger.has(op)) {
      messengerOpRename.set(op, renameOpId(op, "messenger"));
    }
  }

  const jobsFeatureOps = collectFeatureOpIds(jobs.paths as Json);
  const jobsOpRename = new Map<string, string>();
  for (const op of jobsFeatureOps) {
    if (
      seenOpsFromSets([
        sharedOpIds,
        potteryFeatureOps,
        quiltingFeatureOps,
        travelsFeatureOps,
        ornamentsFeatureOps,
        officeFeatureOps,
        hubFeatureOps,
        configFeatureOps,
        messengerFeatureOps,
      ]).has(op)
    ) {
      jobsOpRename.set(op, renameOpId(op, "jobs"));
    }
  }

  const operationsFeatureOps = collectFeatureOpIds(operations.paths as Json);
  const operationsOpRename = new Map<string, string>();
  for (const op of operationsFeatureOps) {
    if (
      seenOpsFromSets([
        sharedOpIds,
        potteryFeatureOps,
        quiltingFeatureOps,
        travelsFeatureOps,
        ornamentsFeatureOps,
        officeFeatureOps,
        hubFeatureOps,
        configFeatureOps,
        messengerFeatureOps,
        jobsFeatureOps,
      ]).has(op)
    ) {
      operationsOpRename.set(op, renameOpId(op, "operations"));
    }
  }

  const notificationsFeatureOps = collectFeatureOpIds(
    notifications.paths as Json,
  );
  const notificationsOpRename = new Map<string, string>();
  for (const op of notificationsFeatureOps) {
    if (
      seenOpsFromSets([
        sharedOpIds,
        potteryFeatureOps,
        quiltingFeatureOps,
        travelsFeatureOps,
        ornamentsFeatureOps,
        officeFeatureOps,
        hubFeatureOps,
        configFeatureOps,
        messengerFeatureOps,
        jobsFeatureOps,
        operationsFeatureOps,
      ]).has(op)
    ) {
      notificationsOpRename.set(op, renameOpId(op, "notifications"));
    }
  }

  // ----- Assemble output
  const out: Json = {
    openapi: "3.1.0",
    info: {
      title: "Api",
      version: "0.1.0",
      description:
        "Unified API specification (pottery + quilting + travels + ornaments + office + hub + messenger)",
    },
    servers: [{ url: "/api", description: "Base API path" }],
    paths: {},
    components: {},
  };

  const outPaths: Record<string, Json> = out.paths;

  // Shared paths (from quilting, unchanged)
  for (const [p, item] of Object.entries(
    quilting.paths as Record<string, Json>,
  )) {
    if (!SHARED_PATHS.has(p)) continue;
    if (outPaths[p] !== undefined) {
      throw new Error(`Duplicate shared path key: ${p}`);
    }
    outPaths[p] = deepClone(item);
  }

  // Pottery feature paths
  for (const [p, item] of Object.entries(
    pottery.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapPotteryPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, potterySchemaRename);
    applyOpIdRenames(cloned, potteryOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after pottery remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Quilting feature paths
  for (const [p, item] of Object.entries(
    quilting.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapQuiltingPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, quiltingSchemaRename);
    applyOpIdRenames(cloned, quiltingOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after quilting remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Travels feature paths
  for (const [p, item] of Object.entries(
    travels.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapTravelsPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, travelsSchemaRename);
    applyOpIdRenames(cloned, travelsOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after travels remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Ornaments feature paths
  for (const [p, item] of Object.entries(
    ornaments.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapOrnamentsPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, ornamentsSchemaRename);
    applyOpIdRenames(cloned, ornamentsOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after ornaments remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Office feature paths
  for (const [p, item] of Object.entries(
    office.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapOfficePath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, officeSchemaRename);
    applyOpIdRenames(cloned, officeOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after office remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Hub feature paths
  for (const [p, item] of Object.entries(hub.paths as Record<string, Json>)) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapHubPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, hubSchemaRename);
    applyOpIdRenames(cloned, hubOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after hub remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Config paths
  for (const [p, item] of Object.entries(
    config.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapConfigPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, configSchemaRename);
    applyOpIdRenames(cloned, configOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after config remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  // Messenger feature paths
  for (const [p, item] of Object.entries(
    messenger.paths as Record<string, Json>,
  )) {
    if (SHARED_PATHS.has(p)) continue;
    const newPath = remapMessengerPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, messengerSchemaRename);
    applyOpIdRenames(cloned, messengerOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after messenger remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  for (const [p, item] of Object.entries(jobs.paths as Record<string, Json>)) {
    const newPath = remapJobsPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, jobsSchemaRename);
    applyOpIdRenames(cloned, jobsOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after jobs remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  for (const [p, item] of Object.entries(
    operations.paths as Record<string, Json>,
  )) {
    const newPath = remapOperationsPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, operationsSchemaRename);
    applyOpIdRenames(cloned, operationsOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(`Duplicate path key after operations remap: ${newPath}`);
    }
    outPaths[newPath] = cloned;
  }

  for (const [p, item] of Object.entries(
    notifications.paths as Record<string, Json>,
  )) {
    const newPath = remapNotificationsPath(p);
    const cloned = deepClone(item);
    rewriteSchemaRefs(cloned, notificationsSchemaRename);
    applyOpIdRenames(cloned, notificationsOpRename);
    if (outPaths[newPath] !== undefined) {
      throw new Error(
        `Duplicate path key after notifications remap: ${newPath}`,
      );
    }
    outPaths[newPath] = cloned;
  }

  // ----- Components: schemas
  const outSchemas: Record<string, Json> = {};

  // Shared schemas taken once from quilting
  for (const name of sharedSchemaNames) {
    if (quiltingSchemas[name] === undefined) {
      throw new Error(`Shared schema "${name}" missing from quilting spec`);
    }
    outSchemas[name] = deepClone(quiltingSchemas[name]);
  }

  // Pottery non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(potterySchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = potterySchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, potterySchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Quilting non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(quiltingSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = quiltingSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, quiltingSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Travels non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(travelsSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = travelsSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, travelsSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Ornaments non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(ornamentsSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = ornamentsSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, ornamentsSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Office non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(officeSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = officeSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, officeSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Hub non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(hubSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = hubSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, hubSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Config non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(configSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = configSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, configSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  // Messenger non-shared schemas, prefixed + internal refs rewritten
  for (const [name, schema] of Object.entries(messengerSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = messengerSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, messengerSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  for (const [name, schema] of Object.entries(jobsSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = jobsSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, jobsSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  for (const [name, schema] of Object.entries(operationsSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = operationsSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, operationsSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  for (const [name, schema] of Object.entries(notificationsSchemas)) {
    if (sharedSchemaNames.has(name)) continue;
    const newName = notificationsSchemaRename.get(name)!;
    const cloned = deepClone(schema);
    rewriteSchemaRefs(cloned, notificationsSchemaRename);
    if (outSchemas[newName] !== undefined) {
      throw new Error(`Duplicate schema key: ${newName}`);
    }
    outSchemas[newName] = cloned;
  }

  out.components.schemas = outSchemas;

  // ----- Components: parameters
  const outParameters: Record<string, Json> = {};
  const quiltingParameters: Record<string, Json> = (quilting.components
    ?.parameters ?? {}) as Json;
  const potteryParameters: Record<string, Json> = (pottery.components
    ?.parameters ?? {}) as Json;
  const travelsParameters: Record<string, Json> = (travels.components
    ?.parameters ?? {}) as Json;
  const ornamentsParameters: Record<string, Json> = (ornaments.components
    ?.parameters ?? {}) as Json;

  for (const [name, param] of Object.entries(quiltingParameters)) {
    outParameters[name] = deepClone(param);
  }
  for (const [name, param] of Object.entries(potteryParameters)) {
    if (outParameters[name] !== undefined) {
      outParameters["Pottery" + name] = deepClone(param);
    } else {
      outParameters[name] = deepClone(param);
    }
  }
  for (const [name, param] of Object.entries(travelsParameters)) {
    if (outParameters[name] !== undefined) {
      outParameters["Travels" + name] = deepClone(param);
    } else {
      outParameters[name] = deepClone(param);
    }
  }
  for (const [name, param] of Object.entries(ornamentsParameters)) {
    if (outParameters[name] !== undefined) {
      outParameters["Ornaments" + name] = deepClone(param);
    } else {
      outParameters[name] = deepClone(param);
    }
  }
  if (Object.keys(outParameters).length > 0) {
    out.components.parameters = outParameters;
  }

  // ----- Validation
  validate(out);

  fs.writeFileSync(outPath, stringify(out, { lineWidth: 0 }));
  console.log(`Wrote ${outPath}`);
  console.log(`  paths: ${Object.keys(outPaths).length}`);
  console.log(`  schemas: ${Object.keys(outSchemas).length}`);
}

function validate(spec: Json): void {
  const pathKeys = Object.keys(spec.paths);

  const seenOps = new Set<string>();
  for (const item of Object.values(spec.paths) as Json[]) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const id = (op as Json)?.operationId;
      if (typeof id === "string") {
        if (seenOps.has(id)) {
          throw new Error(`Duplicate operationId: ${id}`);
        }
        seenOps.add(id);
      }
    }
  }

  const definedSchemas = new Set(Object.keys(spec.components?.schemas ?? {}));
  const definedParams = new Set(Object.keys(spec.components?.parameters ?? {}));

  const checkRefs = (node: Json) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) checkRefs(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        let m = value.match(/^#\/components\/schemas\/(.+)$/);
        if (m) {
          if (!definedSchemas.has(m[1])) {
            throw new Error(`Dangling schema $ref: ${value}`);
          }
          continue;
        }
        m = value.match(/^#\/components\/parameters\/(.+)$/);
        if (m) {
          if (!definedParams.has(m[1])) {
            throw new Error(`Dangling parameter $ref: ${value}`);
          }
          continue;
        }
        throw new Error(`Unrecognized $ref: ${value}`);
      } else {
        checkRefs(value);
      }
    }
  };
  checkRefs(spec.paths);
  checkRefs(spec.components);

  console.log(
    `Validation OK: ${pathKeys.length} paths, ${seenOps.size} operationIds, ${definedSchemas.size} schemas`,
  );
}

main();
