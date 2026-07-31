import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { parse } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SPEC_PATH = resolve(REPO_ROOT, "lib/api-spec/openapi.yaml");
const INVENTORY_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/elaine/website-operation-inventory.json",
);
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/elaine/app-operation-catalog.generated.ts",
);

type JsonObject = Record<string, unknown>;

type InventoryEntry = {
  operationId: string;
  disposition: string;
  mappedTools: string[];
  reason: string;
};

type CatalogEntry = {
  operationId: string;
  method: string;
  path: string;
  domain: string;
  summary: string;
  access: "read" | "action";
  parameters: unknown[];
  requestBody: unknown | null;
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const RETAINED_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "enum",
  "const",
  "nullable",
  "required",
  "properties",
  "items",
  "oneOf",
  "anyOf",
  "allOf",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "additionalProperties",
  "description",
  "default",
]);

function resolvePointer(root: JsonObject, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as JsonObject)[part]
          : undefined,
      root,
    );
}

function compactSchema(
  value: unknown,
  root: JsonObject,
  depth = 0,
  refs = new Set<string>(),
): unknown {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => compactSchema(item, root, depth + 1, refs));
  }
  const object = value as JsonObject;
  if (typeof object.$ref === "string") {
    if (refs.has(object.$ref)) {
      return { type: "object", description: `Recursive ${object.$ref}` };
    }
    const resolved = resolvePointer(root, object.$ref);
    if (!resolved) return { description: object.$ref };
    return compactSchema(
      resolved,
      root,
      depth + 1,
      new Set([...refs, object.$ref]),
    );
  }

  const compact: JsonObject = {};
  for (const [key, child] of Object.entries(object)) {
    if (!RETAINED_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && child && typeof child === "object") {
      compact[key] = Object.fromEntries(
        Object.entries(child as JsonObject)
          .slice(0, 100)
          .map(([propertyName, propertySchema]) => [
            propertyName,
            compactSchema(propertySchema, root, depth + 1, refs),
          ]),
      );
      continue;
    }
    if (key === "description" && typeof child === "string") {
      compact[key] = child.slice(0, 300);
      continue;
    }
    compact[key] = compactSchema(child, root, depth + 1, refs);
  }
  return compact;
}

function resolveParameter(value: unknown, root: JsonObject): JsonObject | null {
  const resolved =
    value &&
    typeof value === "object" &&
    typeof (value as JsonObject).$ref === "string"
      ? resolvePointer(root, (value as JsonObject).$ref as string)
      : value;
  if (!resolved || typeof resolved !== "object") return null;
  const parameter = resolved as JsonObject;
  if (
    typeof parameter.name !== "string" ||
    !["path", "query"].includes(String(parameter.in))
  ) {
    return null;
  }
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.in === "path" || parameter.required === true,
    ...(typeof parameter.description === "string"
      ? { description: parameter.description.slice(0, 300) }
      : {}),
    schema: compactSchema(parameter.schema, root),
  };
}

function buildCatalog(): CatalogEntry[] {
  const spec = parse(readFileSync(SPEC_PATH, "utf8")) as JsonObject;
  const inventory = JSON.parse(
    readFileSync(INVENTORY_PATH, "utf8"),
  ) as InventoryEntry[];
  const inventoryById = new Map(
    inventory.map((entry) => [entry.operationId, entry]),
  );
  const entries: CatalogEntry[] = [];
  const paths = (spec.paths ?? {}) as JsonObject;

  for (const [path, rawPathItem] of Object.entries(paths)) {
    if (!rawPathItem || typeof rawPathItem !== "object") continue;
    const pathItem = rawPathItem as JsonObject;
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (
        !HTTP_METHODS.has(method.toLowerCase()) ||
        !rawOperation ||
        typeof rawOperation !== "object"
      ) {
        continue;
      }
      const operation = rawOperation as JsonObject;
      if (typeof operation.operationId !== "string") continue;
      const policy = inventoryById.get(operation.operationId);
      if (policy?.disposition !== "universal_bridge") continue;

      const parameters = [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ]
        .map((parameter) => resolveParameter(parameter, spec))
        .filter((parameter): parameter is JsonObject => parameter !== null);

      const rawRequestBody =
        operation.requestBody &&
        typeof operation.requestBody === "object" &&
        typeof (operation.requestBody as JsonObject).$ref === "string"
          ? resolvePointer(
              spec,
              (operation.requestBody as JsonObject).$ref as string,
            )
          : operation.requestBody;
      const requestBody =
        rawRequestBody && typeof rawRequestBody === "object"
          ? (rawRequestBody as JsonObject)
          : null;
      const content =
        requestBody?.content && typeof requestBody.content === "object"
          ? (requestBody.content as JsonObject)
          : {};
      const jsonContent =
        content["application/json"] &&
        typeof content["application/json"] === "object"
          ? (content["application/json"] as JsonObject)
          : null;

      entries.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        domain:
          Array.isArray(operation.tags) && typeof operation.tags[0] === "string"
            ? operation.tags[0]
            : "untagged",
        summary:
          typeof operation.summary === "string"
            ? operation.summary
            : operation.operationId,
        access: method.toLowerCase() === "get" ? "read" : "action",
        parameters,
        requestBody: jsonContent
          ? {
              required: requestBody?.required === true,
              schema: compactSchema(jsonContent.schema, spec),
            }
          : null,
      });
    }
  }
  return entries.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

async function render(entries: CatalogEntry[]): Promise<string> {
  return format(
    `// Generated by scripts/src/elaine-app-operation-catalog.ts.
// Do not edit by hand. The checked-in OpenAPI specification and reviewed
// website operation inventory are authoritative.
export const ELAINE_APP_OPERATION_CATALOG = ${JSON.stringify(entries, null, 2)} as const;
`,
    { parser: "typescript" },
  );
}

const command = process.argv[2] ?? "--check";
const rendered = await render(buildCatalog());

if (command === "--write") {
  writeFileSync(OUTPUT_PATH, rendered);
  console.log("Updated Elaine app-operation catalog.");
  process.exit(0);
}

if (command !== "--check") {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const committed = readFileSync(OUTPUT_PATH, "utf8");
if (committed !== rendered) {
  console.error(
    "Elaine app-operation catalog is stale. Run: pnpm --filter @workspace/scripts run elaine:operation-catalog-write",
  );
  process.exit(1);
}

console.log("Elaine app-operation catalog is current.");
