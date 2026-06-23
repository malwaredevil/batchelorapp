/**
 * Deterministic build script that composes the unified OpenAPI contract for the
 * merged pottery + quilting monorepo.
 *
 * Reads the two in-repo source specs (lib/api-spec/sources/{pottery,quilting}.yaml)
 * and emits lib/api-spec/openapi.yaml applying the namespacing / collision rules
 * documented in the merge task. The script self-validates before writing.
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

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function loadSpec(file: string): Json {
  return parse(fs.readFileSync(path.resolve(sourcesDir, file), "utf8"));
}

function main(): void {
  const pottery = loadSpec("pottery.yaml");
  const quilting = loadSpec("quilting.yaml");

  const potterySchemas: Record<string, Json> = (pottery.components?.schemas ??
    {}) as Json;
  const quiltingSchemas: Record<string, Json> = (quilting.components?.schemas ??
    {}) as Json;

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

  // ----- OperationId collision detection
  const sharedOpIds = collectSharedOpIds(quilting.paths as Json);
  const potteryFeatureOps = collectFeatureOpIds(pottery.paths as Json);
  const quiltingFeatureOps = collectFeatureOpIds(quilting.paths as Json);

  const potteryOpRename = new Map<string, string>();
  for (const op of potteryFeatureOps) {
    if (quiltingFeatureOps.has(op) || sharedOpIds.has(op)) {
      potteryOpRename.set(op, renameOpId(op, "pottery"));
    }
  }

  const quiltingOpRename = new Map<string, string>();
  for (const op of quiltingFeatureOps) {
    if (potteryFeatureOps.has(op) || sharedOpIds.has(op)) {
      quiltingOpRename.set(op, renameOpId(op, "quilting"));
    }
  }

  // ----- Assemble output
  const out: Json = {
    openapi: "3.1.0",
    info: {
      // orval forces the title to "Api" anyway; we set it explicitly so orval's
      // input validation (which requires info.title) passes.
      title: "Api",
      version: "0.1.0",
      description: "Unified API specification (pottery + quilting)",
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

  out.components.schemas = outSchemas;

  // ----- Components: parameters (shared once from quilting; pottery has none)
  const outParameters: Record<string, Json> = {};
  const quiltingParameters: Record<string, Json> = (quilting.components
    ?.parameters ?? {}) as Json;
  const potteryParameters: Record<string, Json> = (pottery.components
    ?.parameters ?? {}) as Json;
  for (const [name, param] of Object.entries(quiltingParameters)) {
    outParameters[name] = deepClone(param);
  }
  for (const [name, param] of Object.entries(potteryParameters)) {
    if (outParameters[name] !== undefined) {
      // collision -> prefix the pottery-specific one
      outParameters["Pottery" + name] = deepClone(param);
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
  // 1. No duplicate path keys (object keys are unique by construction; sanity log)
  const pathKeys = Object.keys(spec.paths);

  // 2. No operationId appears twice
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

  // 3. Every schema $ref target exists in components.schemas
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
