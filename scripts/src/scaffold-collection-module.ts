// ---------------------------------------------------------------------------
// scaffold-collection-module.ts
//
// Scaffolds a new "collection" sub-module (the pottery/quilting/ornaments
// shape) inside artifacts/modules from a small resource spec:
//
//   pnpm --filter @workspace/scripts run scaffold:collection -- --spec ./my-resource.json
//   pnpm --filter @workspace/scripts run scaffold:collection -- --undo <plural>
//
// Spec file shape (JSON):
//   {
//     "singular": "gadget",          // lowercase, url/identifier-safe
//     "plural": "gadgets",           // lowercase, url/identifier-safe
//     "title": "Gadgets",            // human-readable module title
//     "fields": [
//       { "name": "maker", "type": "string", "label": "Maker" },
//       { "name": "year", "type": "number", "label": "Year" }
//     ],
//     "categories": true,            // category CRUD via category-router-factory
//     "photos": true,                // images table + serializer wiring (upload endpoints are TODO)
//     "aiAnalysis": false,           // emits TODO markers only
//     "valueTracking": false         // adds estimatedValueUsd column/field
//   }
//
// Field types: string | number | decimal | boolean | date | string[]
//
// What it generates (all composed from shared libs, never copied inline):
//   - lib/api-spec/sources/<plural>.yaml + a COLLECTION_SOURCES entry in
//     build-spec.ts (generic path/schema prefixing), then runs codegen so
//     Zod schemas + React Query hooks come from the existing pipeline.
//   - lib/db/src/schema/<plural>.ts + schema index export + idempotent DDL
//     appended to schema-statements.ts (the single DDL source of truth).
//   - api-server routes/<plural>/ (items CRUD + categories via
//     buildCategoryRouter) and lib/<plural>/serialize.ts (via
//     createCollectionSerializer), mounted in routes/index.ts.
//   - artifacts/modules/src/<plural>/ features.ts (nav registry entry) +
//     gallery/detail pages built from @workspace/collection-ui primitives,
//     wired into App.tsx.
//   - Hub card stub (artifacts/web config/apps.tsx) and app-switcher stub
//     (lib/elaine-ui AppSwitcher.tsx).
//   - SCAFFOLD_TODO.md in the module dir listing every manual follow-up
//     (photo upload, AI analysis, Elaine parity, prod DDL, ...).
//
// Every insertion into a shared file is placed after a `scaffold:anchor:*`
// comment and wrapped in `scaffold:begin:<plural>` / `scaffold:end:<plural>`
// markers so `--undo <plural>` can reverse it exactly. If an anchor is
// missing the script fails loudly and prints the snippet to paste manually.
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Overridable for tests, which exercise scaffold/undo against a temp tree.
const ROOT =
  process.env.SCAFFOLD_COLLECTION_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Spec parsing + validation
// ---------------------------------------------------------------------------

type FieldType =
  | "string"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "string[]";

interface FieldSpec {
  name: string; // camelCase identifier
  type: FieldType;
  label: string;
}

interface ResourceSpec {
  singular: string;
  plural: string;
  title: string;
  fields: FieldSpec[];
  categories: boolean;
  photos: boolean;
  aiAnalysis: boolean;
  valueTracking: boolean;
}

const FIELD_TYPES: FieldType[] = [
  "string",
  "number",
  "decimal",
  "boolean",
  "date",
  "string[]",
];
const NAME_RE = /^[a-z][a-z0-9]*$/;
const FIELD_NAME_RE = /^[a-z][a-zA-Z0-9]*$/;
const RESERVED_FIELDS = new Set([
  "id",
  "userId",
  "name",
  "notes",
  "lockedFields",
  "imagePath",
  "imageUrl",
  "images",
  "categories",
  "categoryIds",
  "estimatedValueUsd",
  "deletedAt",
  "createdAt",
]);

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function loadSpec(specPath: string): ResourceSpec {
  const raw = JSON.parse(
    fs.readFileSync(specPath, "utf8"),
  ) as Partial<ResourceSpec>;
  if (!raw.singular || !NAME_RE.test(raw.singular))
    fail(`spec.singular must match ${NAME_RE}`);
  if (!raw.plural || !NAME_RE.test(raw.plural))
    fail(`spec.plural must match ${NAME_RE}`);
  if (raw.singular === raw.plural)
    fail("spec.singular and spec.plural must differ (e.g. gadget/gadgets)");
  if (!raw.title) fail("spec.title is required");
  if (!Array.isArray(raw.fields)) fail("spec.fields must be an array");
  for (const f of raw.fields) {
    if (!f.name || !FIELD_NAME_RE.test(f.name))
      fail(`field name "${f.name}" must be camelCase`);
    if (RESERVED_FIELDS.has(f.name))
      fail(`field name "${f.name}" is reserved (built in)`);
    if (!FIELD_TYPES.includes(f.type))
      fail(`field "${f.name}" has invalid type "${f.type}"`);
    if (!f.label) fail(`field "${f.name}" needs a label`);
  }
  return {
    singular: raw.singular,
    plural: raw.plural,
    title: raw.title,
    fields: raw.fields,
    categories: raw.categories ?? true,
    photos: raw.photos ?? true,
    aiAnalysis: raw.aiAnalysis ?? false,
    valueTracking: raw.valueTracking ?? false,
  };
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function pascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

interface Names {
  singular: string; // gadget
  plural: string; // gadgets
  PascalS: string; // Gadget
  PascalP: string; // Gadgets
  title: string;
}

function makeNames(spec: ResourceSpec): Names {
  return {
    singular: spec.singular,
    plural: spec.plural,
    PascalS: pascal(spec.singular),
    PascalP: pascal(spec.plural),
    title: spec.title,
  };
}

// ---------------------------------------------------------------------------
// File-editing helpers (anchor insertion + undo)
// ---------------------------------------------------------------------------

interface Insertion {
  file: string; // repo-relative
  anchor: string; // scaffold:anchor:<name>
  block: string; // content WITHOUT begin/end markers
  jsx?: boolean; // wrap markers as {/* */} instead of //
  indent?: string; // indentation applied to marker lines
}

function markerLines(pluralId: string, jsx: boolean, indent: string) {
  const begin = jsx
    ? `${indent}{/* scaffold:begin:${pluralId} */}`
    : `${indent}// scaffold:begin:${pluralId}`;
  const end = jsx
    ? `${indent}{/* scaffold:end:${pluralId} */}`
    : `${indent}// scaffold:end:${pluralId}`;
  return { begin, end };
}

function applyInsertion(ins: Insertion, pluralId: string): void {
  const abs = path.join(ROOT, ins.file);
  const content = fs.readFileSync(abs, "utf8");
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.includes(ins.anchor));
  if (idx === -1) {
    console.error(`\n✖ Anchor "${ins.anchor}" not found in ${ins.file}.`);
    console.error("  Paste this snippet manually at the appropriate spot:\n");
    console.error(ins.block);
    process.exit(1);
  }
  const { begin, end } = markerLines(
    pluralId,
    ins.jsx ?? false,
    ins.indent ?? "",
  );
  lines.splice(idx + 1, 0, begin, ...ins.block.split("\n"), end);
  fs.writeFileSync(abs, lines.join("\n"));
  console.log(`  ~ ${ins.file} (inserted after ${ins.anchor})`);
}

function removeMarkedBlock(file: string, pluralId: string): boolean {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return false;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const begin = lines.findIndex((l) =>
    l.includes(`scaffold:begin:${pluralId}`),
  );
  if (begin === -1) return false;
  const end = lines.findIndex((l) => l.includes(`scaffold:end:${pluralId}`));
  if (end === -1 || end < begin)
    fail(`${file}: found begin marker but no end marker for "${pluralId}"`);
  lines.splice(begin, end - begin + 1);
  fs.writeFileSync(abs, lines.join("\n"));
  console.log(`  ~ ${file} (removed scaffold block)`);
  return true;
}

// ---------------------------------------------------------------------------
// Shared files touched by insertions (single source of truth for undo)
// ---------------------------------------------------------------------------

const SHARED_FILES = [
  "lib/api-spec/build-spec.ts",
  "lib/db/src/schema/index.ts",
  "lib/db/src/schema-statements.ts",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/modules/src/App.tsx",
  "artifacts/web/src/config/apps.tsx",
  "lib/elaine-ui/src/AppSwitcher.tsx",
];

/**
 * Every `scaffold:anchor:*` comment the generator depends on, paired with
 * the repo-relative file it must appear in.  Exported so that tests can
 * assert all anchors are present in the live source tree without duplicating
 * this list.
 */
export const SCAFFOLD_ANCHORS: ReadonlyArray<{ file: string; anchor: string }> =
  [
    {
      file: "lib/api-spec/build-spec.ts",
      anchor: "scaffold:anchor:collection-sources",
    },
    {
      file: "lib/db/src/schema/index.ts",
      anchor: "scaffold:anchor:schema-exports",
    },
    {
      file: "lib/db/src/schema-statements.ts",
      anchor: "scaffold:anchor:collection-ddl",
    },
    {
      file: "artifacts/api-server/src/routes/index.ts",
      anchor: "scaffold:anchor:module-route-imports",
    },
    {
      file: "artifacts/api-server/src/routes/index.ts",
      anchor: "scaffold:anchor:module-route-mounts",
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:feature-imports",
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:lazy-pages",
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:module-routes",
    },
    {
      file: "artifacts/web/src/config/apps.tsx",
      anchor: "scaffold:anchor:hub-cards",
    },
    {
      file: "lib/elaine-ui/src/AppSwitcher.tsx",
      anchor: "scaffold:anchor:app-ids",
    },
    {
      file: "lib/elaine-ui/src/AppSwitcher.tsx",
      anchor: "scaffold:anchor:app-entries",
    },
  ];

function generatedPaths(plural: string): { files: string[]; dirs: string[] } {
  return {
    files: [
      `lib/api-spec/sources/${plural}.yaml`,
      `lib/db/src/schema/${plural}.ts`,
    ],
    dirs: [
      `artifacts/api-server/src/lib/${plural}`,
      `artifacts/api-server/src/routes/${plural}`,
      `artifacts/modules/src/${plural}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Type mapping tables
// ---------------------------------------------------------------------------

function openapiField(f: FieldSpec): string {
  switch (f.type) {
    case "string":
      return `        ${f.name}:\n          type:\n            - string\n            - "null"`;
    case "date":
      return `        ${f.name}:\n          type:\n            - string\n            - "null"\n          description: ISO date (YYYY-MM-DD)`;
    case "number":
      return `        ${f.name}:\n          type:\n            - integer\n            - "null"`;
    case "decimal":
      return `        ${f.name}:\n          type:\n            - number\n            - "null"`;
    case "boolean":
      return `        ${f.name}:\n          type: boolean`;
    case "string[]":
      return `        ${f.name}:\n          type: array\n          items:\n            type: string`;
  }
}

function drizzleColumn(f: FieldSpec): string {
  const col = camelToSnake(f.name);
  switch (f.type) {
    case "string":
      return `  ${f.name}: text("${col}"),`;
    case "date":
      return `  ${f.name}: date("${col}"),`;
    case "number":
      return `  ${f.name}: integer("${col}"),`;
    case "decimal":
      return `  ${f.name}: numeric("${col}", { precision: 10, scale: 2 }),`;
    case "boolean":
      return `  ${f.name}: boolean("${col}").notNull().default(false),`;
    case "string[]":
      return `  ${f.name}: text("${col}").array().notNull().default(sql\`'{}'::text[]\`),`;
  }
}

function ddlColumn(f: FieldSpec): string {
  const col = camelToSnake(f.name);
  switch (f.type) {
    case "string":
      return `${col} text`;
    case "date":
      return `${col} date`;
    case "number":
      return `${col} integer`;
    case "decimal":
      return `${col} numeric(10,2)`;
    case "boolean":
      return `${col} boolean NOT NULL DEFAULT false`;
    case "string[]":
      return `${col} text[] NOT NULL DEFAULT '{}'`;
  }
}

function tsFieldType(f: FieldSpec): string {
  switch (f.type) {
    case "string":
    case "date":
      return "string | null";
    case "number":
    case "decimal":
      return "number | null";
    case "boolean":
      return "boolean";
    case "string[]":
      return "string[]";
  }
}

/** Expression converting a drizzle row value to the serialized wire value. */
function serializeExpr(f: FieldSpec): string {
  switch (f.type) {
    case "decimal":
      return `row.${f.name} != null ? parseFloat(row.${f.name}) : null`;
    case "string[]":
      return `row.${f.name} ?? []`;
    case "boolean":
      return `row.${f.name} ?? false`;
    default:
      return `row.${f.name}`;
  }
}

/** Expression converting a parsed request-body value to a drizzle insert/update value. */
function bodyToDbExpr(f: FieldSpec, src: string): string {
  if (f.type === "decimal") return `${src} != null ? String(${src}) : null`;
  return src;
}

// ---------------------------------------------------------------------------
// Template: OpenAPI source yaml
// ---------------------------------------------------------------------------

function yamlTemplate(spec: ResourceSpec, n: Names): string {
  const fieldProps = spec.fields.map(openapiField).join("\n");
  const requiredExtras = spec.fields
    .filter((f) => f.type === "boolean" || f.type === "string[]")
    .map((f) => `        - ${f.name}`)
    .join("\n");
  const valueProp = spec.valueTracking
    ? `        estimatedValueUsd:\n          type:\n            - number\n            - "null"\n`
    : "";
  const photoItemProps = spec.photos
    ? `        images:
          type: array
          items:
            $ref: "#/components/schemas/${n.PascalS}Image"
        imageUrl:
          type:
            - string
            - "null"
`
    : "";
  const photoRequired = spec.photos
    ? `        - images\n        - imageUrl\n`
    : "";
  const catItemProps = spec.categories
    ? `        categories:
          type: array
          items:
            $ref: "#/components/schemas/Category"
`
    : "";
  const catRequired = spec.categories ? `        - categories\n` : "";
  const catIdsProp = spec.categories
    ? `        categoryIds:\n          type: array\n          items:\n            type: integer\n`
    : "";
  const listCategoryParam = spec.categories
    ? `        - name: categoryId
          in: query
          required: false
          schema:
            type: integer
`
    : "";

  const writableFieldProps = spec.fields.map(openapiField).join("\n");

  const photoPaths = spec.photos
    ? `  /items/{id}/images:
    post:
      operationId: add${n.PascalS}Image
      tags:
        - ${n.plural}
      summary: Upload a photo for a ${n.singular}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - image
              properties:
                image:
                  type: string
                  format: binary
                label:
                  type: string
      responses:
        "201":
          description: Uploaded
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${n.PascalS}Image"
        "400":
          description: Invalid or unsupported file
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "404":
          description: Item not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /items/{id}/images/{imageId}:
    delete:
      operationId: delete${n.PascalS}Image
      tags:
        - ${n.plural}
      summary: Delete a photo
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: imageId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /items/{id}/images/{imageId}/primary:
    post:
      operationId: set${n.PascalS}PrimaryImage
      tags:
        - ${n.plural}
      summary: Promote an image to primary (gallery cover)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: imageId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Primary image updated
          content:
            application/json:
              schema:
                type: object
                required:
                  - id
                  - imagePath
                properties:
                  id:
                    type: integer
                  imagePath:
                    type:
                      - string
                      - "null"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
`
    : "";

  const categoriesPaths = spec.categories
    ? `  /categories:
    get:
      operationId: list${n.PascalS}Categories
      tags:
        - ${n.plural}
      summary: List categories
      responses:
        "200":
          description: Category list
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Category"
    post:
      operationId: create${n.PascalS}Category
      tags:
        - ${n.plural}
      summary: Create a category
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CategoryInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Category"
        "409":
          description: Name already exists
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /categories/unused:
    delete:
      operationId: delete${n.PascalS}UnusedCategories
      tags:
        - ${n.plural}
      summary: Delete all categories with no items assigned
      responses:
        "200":
          description: Number of categories deleted
          content:
            application/json:
              schema:
                type: object
                required:
                  - deleted
                properties:
                  deleted:
                    type: integer
  /categories/{id}:
    patch:
      operationId: rename${n.PascalS}Category
      tags:
        - ${n.plural}
      summary: Rename a category
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CategoryInput"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Category"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "409":
          description: Name already exists
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
    delete:
      operationId: delete${n.PascalS}Category
      tags:
        - ${n.plural}
      summary: Delete a category
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /categories/{id}/colors:
    put:
      operationId: update${n.PascalS}CategoryColors
      tags:
        - ${n.plural}
      summary: Update a category's colours
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CategoryColorInput"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Category"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
  /categories/{id}/merge:
    post:
      operationId: merge${n.PascalS}Category
      tags:
        - ${n.plural}
      summary: Merge a category into another (reassigns items, deletes source)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/MergeCategoryInput"
      responses:
        "204":
          description: Merged and deleted
        "400":
          description: Cannot merge a category into itself
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "404":
          description: Source or target not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
`
    : "";

  const categorySchemas = spec.categories
    ? `    Category:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
        name:
          type: string
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
        count:
          type: integer
    CategoryInput:
      type: object
      required:
        - name
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 50
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
    CategoryColorInput:
      type: object
      properties:
        bgColor:
          type:
            - string
            - "null"
        textColor:
          type:
            - string
            - "null"
    MergeCategoryInput:
      type: object
      required:
        - intoId
      properties:
        intoId:
          type: integer
`
    : "";

  const imageSchema = spec.photos
    ? `    ${n.PascalS}Image:
      type: object
      required:
        - id
        - url
        - position
      properties:
        id:
          type: integer
        url:
          type: string
        label:
          type:
            - string
            - "null"
        position:
          type: integer
`
    : "";

  return `# Generated by scaffold-collection-module for the "${n.plural}" collection.
# Paths are remapped to /${n.plural}/* and non-shared schemas prefixed with
# "${n.PascalP}" by build-spec.ts (COLLECTION_SOURCES).
openapi: 3.1.0
info:
  title: ${n.title} API
  version: 1.0.0
paths:
  /items:
    get:
      operationId: list${n.PascalP}
      tags:
        - ${n.plural}
      summary: List ${n.plural} (paginated)
      parameters:
        - name: q
          in: query
          required: false
          schema:
            type: string
${listCategoryParam}        - name: page
          in: query
          required: false
          schema:
            type: integer
        - name: pageSize
          in: query
          required: false
          schema:
            type: integer
      responses:
        "200":
          description: Paginated list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${n.PascalS}ListResponse"
    post:
      operationId: create${n.PascalS}
      tags:
        - ${n.plural}
      summary: Create a ${n.singular}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/${n.PascalS}Create"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${n.PascalS}Item"
  /items/{id}:
    get:
      operationId: get${n.PascalS}
      tags:
        - ${n.plural}
      summary: Get a ${n.singular}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: The ${n.singular}
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${n.PascalS}Item"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
    patch:
      operationId: update${n.PascalS}
      tags:
        - ${n.plural}
      summary: Update a ${n.singular}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/${n.PascalS}Update"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${n.PascalS}Item"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
    delete:
      operationId: delete${n.PascalS}
      tags:
        - ${n.plural}
      summary: Soft-delete a ${n.singular}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
${photoPaths}${categoriesPaths}components:
  schemas:
    Error:
      type: object
      required:
        - error
      properties:
        error:
          type: string
    ${n.PascalS}Item:
      type: object
      required:
        - id
        - name
        - lockedFields
        - createdAt
${requiredExtras ? requiredExtras + "\n" : ""}${catRequired}${photoRequired}${spec.valueTracking ? "        - estimatedValueUsd\n" : ""}      properties:
        id:
          type: integer
        name:
          type: string
        notes:
          type:
            - string
            - "null"
${fieldProps}
${valueProp}        lockedFields:
          type: array
          items:
            type: string
${catItemProps}${photoItemProps}        createdAt:
          type: string
    ${n.PascalS}Create:
      type: object
      required:
        - name
      properties:
        name:
          type: string
          minLength: 1
        notes:
          type:
            - string
            - "null"
${writableFieldProps}
${valueProp}${catIdsProp}    ${n.PascalS}Update:
      type: object
      properties:
        name:
          type: string
          minLength: 1
        notes:
          type:
            - string
            - "null"
${writableFieldProps}
${valueProp}        lockedFields:
          type: array
          items:
            type: string
${catIdsProp}    ${n.PascalS}ListResponse:
      type: object
      required:
        - items
        - total
        - page
        - pageSize
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/${n.PascalS}Item"
        total:
          type: integer
        page:
          type: integer
        pageSize:
          type: integer
${imageSchema}${categorySchemas}`;
}

// ---------------------------------------------------------------------------
// Template: drizzle schema
// ---------------------------------------------------------------------------

function drizzleTemplate(spec: ResourceSpec, n: Names): string {
  const usedTypes = new Set<string>([
    "pgTable",
    "serial",
    "integer",
    "text",
    "timestamp",
    "index",
  ]);
  for (const f of spec.fields) {
    if (f.type === "number") usedTypes.add("integer");
    if (f.type === "decimal") usedTypes.add("numeric");
    if (f.type === "boolean") usedTypes.add("boolean");
    if (f.type === "date") usedTypes.add("date");
  }
  if (spec.valueTracking) usedTypes.add("numeric");
  if (spec.categories) {
    usedTypes.add("primaryKey");
    usedTypes.add("unique");
  }
  const imports = [...usedTypes].sort().join(",\n  ");

  const fieldCols = spec.fields.map(drizzleColumn).join("\n");
  const valueCol = spec.valueTracking
    ? `  estimatedValueUsd: numeric("estimated_value_usd", { precision: 10, scale: 2 }),\n`
    : "";
  const imageCol = spec.photos ? `  imagePath: text("image_path"),\n` : "";

  const categoriesTables = spec.categories
    ? `
export const ${n.plural}Categories = pgTable(
  "${n.plural}_categories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    bgColor: text("bg_color"),
    textColor: text("text_color"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("${n.plural}_categories_user_id_idx").on(table.userId),
    // Owner-scoped: names are unique per user, not globally.
    unique("${n.plural}_categories_user_id_name_key").on(
      table.userId,
      table.name,
    ),
  ],
).enableRLS();

export const ${n.plural}ItemCategories = pgTable(
  "${n.plural}_item_categories",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => ${n.plural}Items.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => ${n.plural}Categories.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.categoryId] })],
).enableRLS();
`
    : "";

  const imagesTable = spec.photos
    ? `
export const ${n.plural}Images = pgTable(
  "${n.plural}_images",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => ${n.plural}Items.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    label: text("label"),
    position: integer("position").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("${n.plural}_images_item_id_idx").on(table.itemId)],
).enableRLS();
`
    : "";

  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
// DDL lives in lib/db/src/schema-statements.ts — keep both in sync.
import { sql } from "drizzle-orm";
import {
  ${imports},
} from "drizzle-orm/pg-core";

export const ${n.plural}Items = pgTable(
  "${n.plural}_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
${fieldCols ? fieldCols.replace(/^ {2}/gm, "    ") + "\n" : ""}${valueCol.replace(/^ {2}/gm, "    ")}${imageCol.replace(/^ {2}/gm, "    ")}    lockedFields: text("locked_fields")
      .array()
      .notNull()
      .default(sql\`'{}'::text[]\`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("${n.plural}_items_user_id_idx").on(table.userId)],
).enableRLS();

export type ${n.PascalS}ItemRow = typeof ${n.plural}Items.$inferSelect;
export type Insert${n.PascalS}Item = typeof ${n.plural}Items.$inferInsert;
${categoriesTables}${imagesTable}`;
}

// ---------------------------------------------------------------------------
// Template: DDL statements (inserted into schema-statements.ts)
// ---------------------------------------------------------------------------

function ddlBlock(spec: ResourceSpec, n: Names): string {
  const cols = spec.fields.map((f) => `    ${ddlColumn(f)},`).join("\n");
  const valueCol = spec.valueTracking
    ? `    estimated_value_usd numeric(10,2),\n`
    : "";
  const imageCol = spec.photos ? `    image_path text,\n` : "";
  const stmts: string[] = [];
  stmts.push(`  \`CREATE TABLE IF NOT EXISTS ${n.plural}_items (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    name text NOT NULL,
    notes text,
${cols ? cols + "\n" : ""}${valueCol}${imageCol}    locked_fields text[] NOT NULL DEFAULT '{}',
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )\`,`);
  stmts.push(
    `  \`CREATE INDEX IF NOT EXISTS ${n.plural}_items_user_id_idx ON ${n.plural}_items (user_id)\`,`,
    `  \`ALTER TABLE ${n.plural}_items ENABLE ROW LEVEL SECURITY\`,`,
  );
  if (spec.categories) {
    stmts.push(`  \`CREATE TABLE IF NOT EXISTS ${n.plural}_categories (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    name text NOT NULL,
    bg_color text,
    text_color text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ${n.plural}_categories_user_id_name_key UNIQUE (user_id, name)
  )\`,`);
    stmts.push(
      `  \`CREATE INDEX IF NOT EXISTS ${n.plural}_categories_user_id_idx ON ${n.plural}_categories (user_id)\`,`,
      `  \`ALTER TABLE ${n.plural}_categories ENABLE ROW LEVEL SECURITY\`,`,
    );
    stmts.push(`  \`CREATE TABLE IF NOT EXISTS ${n.plural}_item_categories (
    item_id integer NOT NULL REFERENCES ${n.plural}_items(id) ON DELETE CASCADE,
    category_id integer NOT NULL REFERENCES ${n.plural}_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, category_id)
  )\`,`);
    stmts.push(
      `  \`ALTER TABLE ${n.plural}_item_categories ENABLE ROW LEVEL SECURITY\`,`,
    );
  }
  if (spec.photos) {
    stmts.push(`  \`CREATE TABLE IF NOT EXISTS ${n.plural}_images (
    id serial PRIMARY KEY,
    item_id integer NOT NULL REFERENCES ${n.plural}_items(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    label text,
    position integer NOT NULL DEFAULT 0,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )\`,`);
    stmts.push(
      `  \`CREATE INDEX IF NOT EXISTS ${n.plural}_images_item_id_idx ON ${n.plural}_images (item_id)\`,`,
      `  \`ALTER TABLE ${n.plural}_images ENABLE ROW LEVEL SECURITY\`,`,
    );
  }
  return stmts.join("\n");
}

// ---------------------------------------------------------------------------
// Template: api-server serialize.ts
// ---------------------------------------------------------------------------

function serializeTemplate(spec: ResourceSpec, n: Names): string {
  const fieldTypes = spec.fields
    .map((f) => `  ${f.name}: ${tsFieldType(f)};`)
    .join("\n");
  const fieldSer = spec.fields
    .map((f) => `      ${f.name}: ${serializeExpr(f)},`)
    .join("\n");

  // Compose the shared serializer factories — never re-emit their DB logic.
  const categoriesFetch = spec.categories
    ? `  fetchRawCategories: makeFetchRawCategories(itemCategories, categories),`
    : `  async fetchRawCategories() {
    return [];
  },`;

  const imagesFetch = spec.photos
    ? `  fetchRawImages: makeFetchRawImages(${n.plural}Images, "${n.plural}"),`
    : `  async fetchRawImages() {
    return [];
  },`;

  const importLines: string[] = [];
  if (spec.photos)
    importLines.push(`import { pathCacheBuster } from "../path-cache-buster";`);

  const dbImportNames = [
    ...(spec.categories
      ? [
          `${n.plural}ItemCategories as itemCategories`,
          `${n.plural}Categories as categories`,
        ]
      : []),
    ...(spec.photos ? [`${n.plural}Images`] : []),
  ];
  const dbValueImport =
    dbImportNames.length > 0
      ? `import {\n  ${dbImportNames.join(",\n  ")},\n} from "@workspace/db";\n`
      : "";

  const photoTypes = spec.photos
    ? `  images: ImageResult[];\n  imageUrl: string | null;\n`
    : "";
  const photoSer = spec.photos
    ? `      images: imgs,
      imageUrl:
        row.imagePath != null
          ? \`/api/${n.plural}/items/\${row.id}/image?v=\${pathCacheBuster(row.imagePath)}\`
          : null,
`
    : "";

  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
${importLines.join("\n")}${importLines.length > 0 ? "\n" : ""}import type { ${n.PascalS}ItemRow } from "@workspace/db";
${dbValueImport}import {
  createCollectionSerializer,${spec.categories ? "\n  makeFetchRawCategories," : ""}${spec.photos ? "\n  makeFetchRawImages," : ""}
  type CategoryResult,${spec.photos ? "\n  type ImageResult," : ""}
} from "../collection-item-serializer";

export type { CategoryResult };

export interface SerializedItem {
  id: number;
  name: string;
  notes: string | null;
${fieldTypes ? fieldTypes + "\n" : ""}${spec.valueTracking ? "  estimatedValueUsd: number | null;\n" : ""}  lockedFields: string[];
  categories: CategoryResult[];
${photoTypes}  createdAt: string;
}

const { serializeItem, serializeItems } = createCollectionSerializer<
  ${n.PascalS}ItemRow,
  SerializedItem
>({
${categoriesFetch}

${imagesFetch}

  toItem(row, cats${spec.photos ? ", imgs" : ""}) {
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
${fieldSer ? fieldSer + "\n" : ""}${spec.valueTracking ? "      estimatedValueUsd:\n        row.estimatedValueUsd != null\n          ? parseFloat(row.estimatedValueUsd)\n          : null,\n" : ""}      lockedFields: row.lockedFields ?? [],
      categories: cats,
${photoSer}      createdAt: row.createdAt.toISOString(),
    };
  },
});

export { serializeItem, serializeItems };
`;
}

// ---------------------------------------------------------------------------
// Template: api-server items route
// ---------------------------------------------------------------------------

function itemsRouteTemplate(spec: ResourceSpec, n: Names): string {
  const zodImports = [
    `List${n.PascalP}Response`,
    `Create${n.PascalS}Body`,
    `Get${n.PascalS}Response`,
    `Update${n.PascalS}Body`,
  ];
  const dbNames = [`db`, `${n.plural}Items as items`];
  if (spec.categories)
    dbNames.push(
      `${n.plural}ItemCategories as itemCategories`,
      `${n.plural}Categories as cats`,
    );

  const createFieldLines = spec.fields
    .map((f) => `        ${f.name}: ${bodyToDbExpr(f, `body.${f.name}`)},`)
    .join("\n");
  const valueCreate = spec.valueTracking
    ? `        estimatedValueUsd:\n          body.estimatedValueUsd != null\n            ? String(body.estimatedValueUsd)\n            : null,\n`
    : "";

  const updateFieldLines = [
    `  if (body.name !== undefined) set.name = body.name;`,
    `  if (body.notes !== undefined) set.notes = body.notes;`,
    ...spec.fields.map(
      (f) =>
        `  if (body.${f.name} !== undefined) set.${f.name} = ${bodyToDbExpr(f, `body.${f.name}`)};`,
    ),
    ...(spec.valueTracking
      ? [
          `  if (body.estimatedValueUsd !== undefined)`,
          `    set.estimatedValueUsd =`,
          `      body.estimatedValueUsd != null ? String(body.estimatedValueUsd) : null;`,
        ]
      : []),
    `  if (body.lockedFields !== undefined) set.lockedFields = body.lockedFields;`,
  ].join("\n");

  const categoryAssign = spec.categories
    ? `
/**
 * True when every requested category belongs to the caller. MUST be checked
 * BEFORE any item insert/update so a rejected request leaves no partial
 * write behind.
 */
async function categoriesOwned(
  userId: number,
  categoryIds: number[],
): Promise<boolean> {
  if (categoryIds.length === 0) return true;
  const owned = await db
    .select({ id: cats.id })
    .from(cats)
    .where(and(inArray(cats.id, categoryIds), eq(cats.userId, userId)));
  return owned.length === new Set(categoryIds).size;
}

/** Replace an item's category assignments (ownership already validated). */
async function replaceCategories(itemId: number, categoryIds: number[]) {
  await db.delete(itemCategories).where(eq(itemCategories.itemId, itemId));
  if (categoryIds.length > 0) {
    await db
      .insert(itemCategories)
      .values(categoryIds.map((categoryId) => ({ itemId, categoryId })))
      .onConflictDoNothing();
  }
}
`
    : "";

  const listCategoryFilter = spec.categories
    ? `  if (query.categoryId != null) {
    const assigned = await db
      .select({ itemId: itemCategories.itemId })
      .from(itemCategories)
      .where(eq(itemCategories.categoryId, query.categoryId));
    const ids = new Set(assigned.map((a) => a.itemId));
    filtered = filtered.filter((r) => ids.has(r.id));
  }
`
    : "";

  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq${spec.categories ? ", inArray" : ""}, isNull } from "drizzle-orm";
import {
  ${dbNames.join(",\n  ")},
} from "@workspace/db";
import {
  ${zodImports.join(",\n  ")},
} from "@workspace/api-zod";
import { requireAuth } from "../../middleware/auth";
import { serializeItem, serializeItems } from "../../lib/${n.plural}/serialize";

const router: IRouter = Router();
router.use(requireAuth);

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ListQuery = z.object({
  q: z.string().optional(),${spec.categories ? "\n  categoryId: z.coerce.number().int().positive().optional()," : ""}
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(60),
});
${categoryAssign}
// Every query/mutation below is scoped to the authenticated owner
// (items.userId = session user). Legacy modules (pottery/ornaments) are
// deliberately household-shared; relax these predicates ONLY if this module
// is meant to be shared by every user of the household.
router.get("/items", async (req, res) => {
  const query = ListQuery.parse(req.query);
  const userId = req.session.userId!;
  // TODO(scaffold): move search/filtering into SQL once the collection grows.
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt)))
    .orderBy(desc(items.createdAt));
  let filtered = rows;
  if (query.q) {
    const q = query.q.toLowerCase();
    filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
  }
${listCategoryFilter}  const total = filtered.length;
  const pageRows = filtered.slice(
    (query.page - 1) * query.pageSize,
    query.page * query.pageSize,
  );
  res.json(
    List${n.PascalP}Response.parse({
      items: await serializeItems(pageRows),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }),
  );
});

router.post("/items", async (req, res) => {
  const body = Create${n.PascalS}Body.parse(req.body);
  const userId = req.session.userId!;
${spec.categories ? `  // Validate BEFORE the insert so a rejected request writes nothing.\n  if (!(await categoriesOwned(userId, body.categoryIds ?? []))) {\n    res.status(400).json({ error: "Unknown category id" });\n    return;\n  }\n` : ""}  const [row] = await db
    .insert(items)
    .values({
      userId,
      name: body.name,
      notes: body.notes ?? null,
${createFieldLines ? createFieldLines + "\n" : ""}${valueCreate}    })
    .returning();
${spec.categories ? `  if (body.categoryIds && body.categoryIds.length > 0) {\n    await replaceCategories(row.id, body.categoryIds);\n  }\n` : ""}  res.status(201).json(Get${n.PascalS}Response.parse(await serializeItem(row)));
});

router.get("/items/:id", async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!row || row.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(Get${n.PascalS}Response.parse(await serializeItem(row)));
});

router.patch("/items/:id", async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const userId = req.session.userId!;
  const body = Update${n.PascalS}Body.parse(req.body);
  const set: Record<string, unknown> = {};
${updateFieldLines}
  const [existing] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
${spec.categories ? `  // Validate BEFORE any update so a rejected request changes nothing.\n  if (\n    body.categoryIds !== undefined &&\n    !(await categoriesOwned(userId, body.categoryIds ?? []))\n  ) {\n    res.status(400).json({ error: "Unknown category id" });\n    return;\n  }\n` : ""}  let row = existing;
  if (Object.keys(set).length > 0) {
    [row] = await db
      .update(items)
      .set(set)
      .where(and(eq(items.id, id), eq(items.userId, userId)))
      .returning();
  }
${spec.categories ? `  if (body.categoryIds !== undefined) {\n    await replaceCategories(id, body.categoryIds ?? []);\n  }\n` : ""}  res.json(Get${n.PascalS}Response.parse(await serializeItem(row)));
});

router.delete("/items/:id", async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const userId = req.session.userId!;
  const [row] = await db
    .update(items)
    .set({ deletedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.userId, userId)))
    .returning({ id: items.id });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

export default router;
`;
}

// ---------------------------------------------------------------------------
// Template: api-server categories route (via shared factory)
// ---------------------------------------------------------------------------

function categoriesRouteTemplate(n: Names): string {
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
// Composed from the shared category-router-factory — do not hand-roll CRUD.
import { and, eq } from "drizzle-orm";
import {
  db,
  ${n.plural}Categories as cats,
  ${n.plural}ItemCategories as joinTable,
} from "@workspace/db";
import {
  List${n.PascalS}CategoriesResponse,
  List${n.PascalS}CategoriesResponseItem,
  Create${n.PascalS}CategoryBody,
  Delete${n.PascalS}CategoryParams,
  Rename${n.PascalS}CategoryParams,
  Rename${n.PascalS}CategoryBody,
  Merge${n.PascalS}CategoryBody,
  Update${n.PascalS}CategoryColorsBody,
  Update${n.PascalS}CategoryColorsParams,
} from "@workspace/api-zod";
import {
  buildCategoryRouter,
  normalizeCategoryNameSimple,
  type CategoryOps,
} from "../../lib/category-router-factory";
import { createCategoryCountOps } from "../../lib/collection-category-ops";

/**
 * Owner-scoped: every op constrains rows to the authenticated user via the
 * factory's trailing userId argument. Legacy modules (pottery/ornaments)
 * are deliberately household-shared and ignore it.
 */
function ownedBy(id: number, userId?: number) {
  if (userId == null)
    throw new Error("${n.plural} category ops require a userId");
  return and(eq(cats.id, id), eq(cats.userId, userId));
}

const ops: CategoryOps = {
  ...createCategoryCountOps(cats, joinTable, joinTable.itemId, {
    userColumn: cats.userId,
  }),

  async create(userId, name, bgColor, textColor) {
    const [row] = await db
      .insert(cats)
      .values({ userId, name, bgColor, textColor })
      .returning({ id: cats.id });
    return row.id;
  },

  async rename(id, name, userId) {
    const [updated] = await db
      .update(cats)
      .set({ name })
      .where(ownedBy(id, userId))
      .returning({ id: cats.id });
    return !!updated;
  },

  async updateColors(id, bgColor, textColor, userId) {
    const [updated] = await db
      .update(cats)
      .set({ bgColor, textColor })
      .where(ownedBy(id, userId))
      .returning({ id: cats.id });
    return !!updated;
  },

  async deleteById(id, userId) {
    const [row] = await db
      .delete(cats)
      .where(ownedBy(id, userId))
      .returning({ id: cats.id });
    return !!row;
  },

  async categoryExists(id, userId) {
    const [row] = await db
      .select({ id: cats.id })
      .from(cats)
      .where(ownedBy(id, userId));
    return !!row;
  },

  async getAssignmentsForCategory(categoryId, userId) {
    // Ownership of categoryId is checked by categoryExists() before merge.
    void userId;
    return db
      .select({ itemId: joinTable.itemId })
      .from(joinTable)
      .where(eq(joinTable.categoryId, categoryId));
  },

  async reattachAssignments(assignments, targetId, userId) {
    // targetId ownership is checked by categoryExists() before merge.
    void userId;
    const rows = assignments as { itemId: number }[];
    if (rows.length === 0) return;
    await db
      .insert(joinTable)
      .values(rows.map((r) => ({ itemId: r.itemId, categoryId: targetId })))
      .onConflictDoNothing();
  },

  async deleteCategoryRow(id, userId) {
    await db.delete(cats).where(ownedBy(id, userId));
  },
};

const { router } = buildCategoryRouter({
  ops,
  normalize: normalizeCategoryNameSimple,
  schemas: {
    listResponse: List${n.PascalS}CategoriesResponse,
    listItem: List${n.PascalS}CategoriesResponseItem,
    createBody: Create${n.PascalS}CategoryBody,
    deleteParams: Delete${n.PascalS}CategoryParams,
    renameParams: Rename${n.PascalS}CategoryParams,
    renameBody: Rename${n.PascalS}CategoryBody,
    mergeBody: Merge${n.PascalS}CategoryBody,
    mergeSourceIdField: "intoId",
    updateColorsBody: Update${n.PascalS}CategoryColorsBody,
    updateColorsParams: Update${n.PascalS}CategoryColorsParams,
  },
  mergeResponse: "no-content",
});

export default router;
`;
}

function routeIndexTemplate(spec: ResourceSpec, n: Names): string {
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
import { Router, type IRouter } from "express";
import itemsRouter from "./${n.plural}";
${spec.categories ? `import categoriesRouter from "./categories";\n` : ""}
${spec.photos ? `import imagesRouter from "./images";\n` : ""}
const router: IRouter = Router();

router.use(itemsRouter);
${spec.categories ? "router.use(categoriesRouter);\n" : ""}
${spec.photos ? "router.use(imagesRouter);\n" : ""}
export default router;
`;
}

function storageTemplate(n: Names): string {
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
import { buildStorageAdapter, IMAGE_ONLY_POLICY } from "../storage-core";

const adapter = buildStorageAdapter("${n.plural}", IMAGE_ONLY_POLICY);

export const uploadImage = adapter.uploadImage;
export const downloadImageBuffer = adapter.downloadImageBuffer;
export const deleteImage = adapter.deleteImage;
export const invalidateImageCache = adapter.invalidateImageCache;
`;
}
function featuresTemplate(n: Names): string {
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
// Nav entries register into the shared registry — never hardcode nav arrays.
import { LayoutGrid } from "lucide-react";
import { registerFeature } from "@/features/registry";

registerFeature({
  id: "${n.plural}-collection",
  nav: {
    group: "collection",
    href: "/${n.plural}",
    label: "${n.title}",
    icon: LayoutGrid,
    order: 10,
  },
});
`;
}

function collectionPageTemplate(spec: ResourceSpec, n: Names): string {
  const itemType = `${n.PascalP}${n.PascalS}Item`;
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
// Built from @workspace/collection-ui primitives — do not hand-roll cards.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useList${n.PascalP},
  type ${itemType},
} from "@workspace/api-client-react";
import {
  CollectionCard,
  CollectionCardSkeleton,
  CollectionErrorState,
  CollectionGrid,
  CollectionSearchBar,
  CollectionStatBar,
} from "@workspace/collection-ui";

type SortKey = "newest" | "name";

export default function ${n.PascalP}CollectionPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const { data, isLoading, isError, refetch } = useList${n.PascalP}({
    q: search || undefined,
    page: 1,
    pageSize: 200,
  });

  const items = useMemo(() => {
    const list: ${itemType}[] = data?.items ?? [];
    if (sort === "name") {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [data, sort]);

  if (isError) {
    return (
      <div className="p-4">
        <CollectionErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <CollectionStatBar
          loading={isLoading}
          stats={[{ value: data?.total ?? 0, label: "${n.title}" }]}
        />
        <Link
          href="/${n.plural}/add"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Add
        </Link>
      </div>
      <CollectionSearchBar
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={(v) => setSort(v as SortKey)}
        sortOptions={[
          { key: "newest", label: "Newest" },
          { key: "name", label: "Name" },
        ]}
      />
      {isLoading ? (
        <CollectionGrid>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CollectionCardSkeleton key={i} />
          ))}
        </CollectionGrid>
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">No ${n.plural} yet.</p>
          <Link
            href="/${n.plural}/add"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add your first ${n.singular}
          </Link>
        </div>
      ) : (
        <CollectionGrid>
          {items.map((item) => (
            <CollectionCard
              key={item.id}
              id={item.id}
              name={item.name}
${spec.photos ? "              imageUrl={item.imageUrl ?? undefined}\n" : ""}              href={\`/${n.plural}/item/\${item.id}\`}
${spec.categories ? "              categories={item.categories}\n" : ""}              LinkComponent={Link}
            />
          ))}
        </CollectionGrid>
      )}
    </div>
  );
}
`;
}

function detailPageTemplate(spec: ResourceSpec, n: Names): string {
  const fieldRows = spec.fields
    .map((f) => {
      let expr: string;
      switch (f.type) {
        case "string[]":
          expr = `item.${f.name}.join(", ")`;
          break;
        case "boolean":
          expr = `item.${f.name} ? "Yes" : "No"`;
          break;
        default:
          expr = `item.${f.name} ?? "—"`;
      }
      return `          {
            label: "${f.label}",
            value: ${expr},
          },`;
    })
    .join("\n");

  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
// Built from @workspace/collection-ui detail primitives.
import { useLocation, useRoute } from "wouter";
import {
  useGet${n.PascalS},
  useDelete${n.PascalS},
  getGet${n.PascalS}QueryKey,
} from "@workspace/api-client-react";
import {
  CollectionDetailField,
  CollectionDetailLayout,
  CollectionDetailSkeleton,
  CollectionErrorState,
} from "@workspace/collection-ui";

export default function ${n.PascalS}DetailPage() {
  const [, params] = useRoute("/${n.plural}/item/:id");
  const id = Number(params?.id ?? 0);
  const [, navigate] = useLocation();

  const { data: item, isLoading, isError, refetch } = useGet${n.PascalS}(id, {
    query: { enabled: !!id, queryKey: getGet${n.PascalS}QueryKey(id) },
  });
  const deleteMutation = useDelete${n.PascalS}({
    mutation: { onSuccess: () => navigate("/${n.plural}") },
  });

  if (isLoading) return <CollectionDetailSkeleton />;
  if (isError || !item) {
    return (
      <div className="p-4">
        <CollectionErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <CollectionDetailLayout
      onBack={() => navigate("/${n.plural}")}
      gallery={
${
  spec.photos
    ? `        item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-full rounded-xl object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
            {/* TODO(scaffold): photo upload + gallery (see ornaments) */}
            No photo
          </div>
        )
`
    : `        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {item.name.charAt(0).toUpperCase()}
        </div>
`
}      }
      titleSlot={<h1 className="text-2xl font-bold">{item.name}</h1>}
      actions={
        <button
          type="button"
          className="text-sm text-destructive hover:underline"
          onClick={() => {
            if (window.confirm("Delete this ${n.singular}?")) {
              deleteMutation.mutate({ id });
            }
          }}
        >
          Delete
        </button>
      }
      fields={[
          {
            label: "Notes",
            value: item.notes ?? "—",
          },
${fieldRows ? fieldRows + "\n" : ""}${
    spec.valueTracking
      ? `          {
            label: "Estimated value",
            value:
              item.estimatedValueUsd != null
                ? \`$\${item.estimatedValueUsd.toFixed(2)}\`
                : "—",
          },
`
      : ""
  }        ].map((f) => (
          <CollectionDetailField
            key={f.label}
            label={f.label}
            value={f.value}
            empty={f.value === "—"}
          />
        ))}
    />
  );
}
`;
}

function todoTemplate(spec: ResourceSpec, n: Names): string {
  return `# ${n.title} — scaffold follow-ups

Generated by \`scaffold:collection\`. Everything below is intentionally NOT
auto-generated (domain logic) or needs a manual step:

- [ ] **Prod DDL**: the new tables are created in dev on API-server start
      (schema-statements.ts). Apply to production via the
      \`migrate-production\` flow before deploying.
${
  spec.aiAnalysis
    ? `- [ ] **AI photo analysis**: add the analysis prompt + endpoint (see
      \`lib/ornaments/openai.ts\`) — locked_fields support is already wired in
      the images route and the add form is already wired to upload on create.
`
    : ""
}- [ ] **Elaine parity**: every user-facing feature needs matching Elaine
      actions/tools/pageContext (see the elaine action-tool checklist) and an
      operation-catalog rebuild — CI's capability-parity job will flag gaps.
- [ ] **Inline editing**: the detail page is read-only; add a QuickEditSheetFrame
      for field editing as needed (see pottery/quilting for reference).
- [ ] **Hub widget**: apps.tsx hub card is stubbed; add a real image and a
      dashboard widget in WIDGETS if wanted.
- [ ] **Module chrome**: optional GROUP_ORDER / GROUP_META / MODULE_FAVICONS /
      MODULE_TITLES entries in \`components/module-shell.tsx\`, and a bespoke
      logo in \`lib/elaine-ui/src/AppSwitcher.tsx\` (currently the generic one).
- [ ] **SQL search**: list endpoint filters in JS; move to SQL as data grows.
`;
}

function addPageTemplate(spec: ResourceSpec, n: Names): string {
  const fieldInputs = spec.fields
    .map((f) => {
      switch (f.type) {
        case "boolean":
          return `        <div className="flex items-center gap-2">
          <input id="${f.name}" type="checkbox" className="h-4 w-4 rounded border" {...register("${f.name}")} />
          <label htmlFor="${f.name}" className="text-sm font-medium">${f.label}</label>
        </div>`;
        case "number":
          return `        <div>
          <label htmlFor="${f.name}" className="mb-1 block text-sm font-medium">${f.label}</label>
          <input id="${f.name}" type="number" className="w-full rounded-md border px-3 py-2 text-sm" {...register("${f.name}")} />
        </div>`;
        case "decimal":
          return `        <div>
          <label htmlFor="${f.name}" className="mb-1 block text-sm font-medium">${f.label}</label>
          <input id="${f.name}" type="number" step="0.01" className="w-full rounded-md border px-3 py-2 text-sm" {...register("${f.name}")} />
        </div>`;
        case "date":
          return `        <div>
          <label htmlFor="${f.name}" className="mb-1 block text-sm font-medium">${f.label}</label>
          <input id="${f.name}" type="date" className="w-full rounded-md border px-3 py-2 text-sm" {...register("${f.name}")} />
        </div>`;
        case "string[]":
          return `        <div>
          <label htmlFor="${f.name}" className="mb-1 block text-sm font-medium">${f.label}</label>
          <input id="${f.name}" type="text" placeholder="Comma-separated values" className="w-full rounded-md border px-3 py-2 text-sm" {...register("${f.name}")} />
        </div>`;
        default: // string
          return `        <div>
          <label htmlFor="${f.name}" className="mb-1 block text-sm font-medium">${f.label}</label>
          <input id="${f.name}" type="text" className="w-full rounded-md border px-3 py-2 text-sm" {...register("${f.name}")} />
        </div>`;
      }
    })
    .join("\n");

  const zodFields = spec.fields
    .map((f) => {
      switch (f.type) {
        case "boolean":
          return `  ${f.name}: z.boolean().optional().default(false),`;
        case "number":
          return `  ${f.name}: z.coerce.number().int().optional().nullable(),`;
        case "decimal":
          return `  ${f.name}: z.coerce.number().optional().nullable(),`;
        case "date":
          return `  ${f.name}: z.string().optional().nullable(),`;
        case "string[]":
          return `  ${f.name}: z.string().optional(), // comma-separated; split before submit`;
        default:
          return `  ${f.name}: z.string().optional().nullable(),`;
      }
    })
    .join("\n");

  const createBodyFields = spec.fields
    .map((f) => {
      if (f.type === "string[]") {
        return `      ${f.name}: data.${f.name}
        ? data.${f.name}.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [],`;
      }
      return `      ${f.name}: data.${f.name} ?? null,`;
    })
    .join("\n");

  const valueZod = spec.valueTracking
    ? `  estimatedValueUsd: z.coerce.number().optional().nullable(),\n`
    : "";
  const valueProp = spec.valueTracking
    ? `      estimatedValueUsd: data.estimatedValueUsd ?? null,\n`
    : "";
  const catImport = spec.categories ? `  useList${n.PascalS}Categories,\n` : "";
  const catProp = spec.categories
    ? `      categoryIds: selectedCategoryIds,\n`
    : "";

  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  useCreate${n.PascalS},
${catImport}} from "@workspace/api-client-react";

const AddSchema = z.object({
  name: z.string().min(1, "Name is required"),
  notes: z.string().optional().nullable(),
${zodFields ? zodFields + "\n" : ""}${valueZod}});
type AddFields = z.infer<typeof AddSchema>;

export default function Add${n.PascalS}Page() {
  const [, navigate] = useLocation();${
    spec.photos
      ? `
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);`
      : ""
  }${
    spec.categories
      ? `
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const { data: categories = [] } = useList${n.PascalS}Categories();`
      : ""
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddFields>({ resolver: zodResolver(AddSchema) });

  const createMutation = useCreate${n.PascalS}();

  async function onSubmit(data: AddFields) {
    try {
      const item = await createMutation.mutateAsync({
        data: {
          name: data.name,
          notes: data.notes ?? null,
${createBodyFields ? createBodyFields + "\n" : ""}${valueProp}${catProp}        },
      });
${
  spec.photos
    ? `
      // Upload photo after item is created (if one was selected).
      if (imageFile) {
        const fd = new FormData();
        fd.append("image", imageFile);
        const uploadRes = await fetch(
          \`/api/${n.plural}/items/\${item.id}/images\`,
          { method: "POST", body: fd, credentials: "include" },
        );
        if (!uploadRes.ok) {
          // Item was created but the photo didn't upload — tell the user so
          // they can retry from the detail page rather than silently losing it.
          toast.warning("Item saved, but the photo failed to upload. You can add it from the item page.");
          navigate(\`/${n.plural}/item/\${item.id}\`);
          return;
        }
      }
`
    : ""
}
      toast.success("${n.singular.charAt(0).toUpperCase() + n.singular.slice(1)} added.");
      navigate(\`/${n.plural}/item/\${item.id}\`);
    } catch {
      toast.error("Failed to save. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-6 text-2xl font-bold">
        Add ${n.singular}
      </h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
${
  spec.photos
    ? `        {/* Photo */}
        <div>
          <p className="mb-1 text-sm font-medium">Photo</p>
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm text-muted-foreground hover:border-primary"
            onClick={() => fileRef.current?.click()}
          >
            {imageFile ? (
              <img
                src={URL.createObjectURL(imageFile)}
                alt="Preview"
                className="max-h-48 rounded object-cover"
              />
            ) : (
              <span>Tap to select a photo</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
        </div>
`
    : ""
}
        {/* Name */}
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            type="text"
            className="w-full rounded-md border px-3 py-2 text-sm"
            {...register("name")}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm"
            {...register("notes")}
          />
        </div>

${fieldInputs ? fieldInputs + "\n" : ""}${
    spec.valueTracking
      ? `        <div>
          <label htmlFor="estimatedValueUsd" className="mb-1 block text-sm font-medium">
            Estimated value (USD)
          </label>
          <input
            id="estimatedValueUsd"
            type="number"
            step="0.01"
            className="w-full rounded-md border px-3 py-2 text-sm"
            {...register("estimatedValueUsd")}
          />
        </div>
`
      : ""
  }${
    spec.categories
      ? `        {/* Categories */}
        <div>
          <p className="mb-2 text-sm font-medium">Categories</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setSelectedCategoryIds((prev) =>
                    prev.includes(cat.id)
                      ? prev.filter((x) => x !== cat.id)
                      : [...prev, cat.id],
                  )
                }
                className={\`rounded-full px-3 py-1 text-sm transition-colors \${
                  selectedCategoryIds.includes(cat.id)
                    ? "bg-primary text-primary-foreground"
                    : "border bg-muted hover:bg-muted/80"
                }\`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
`
      : ""
  }
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? "Saving…" : "Add ${n.singular}"}
          </button>
          <Link
            href="/${n.plural}"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
`;
}
function buildInsertions(spec: ResourceSpec, n: Names): Insertion[] {
  const ins: Insertion[] = [
    {
      file: "lib/api-spec/build-spec.ts",
      anchor: "scaffold:anchor:collection-sources",
      block: `  { id: "${n.plural}", file: "${n.plural}.yaml", schemaPrefix: "${n.PascalP}" },`,
    },
    {
      file: "lib/db/src/schema/index.ts",
      anchor: "scaffold:anchor:schema-exports",
      block: `export * from "./${n.plural}";`,
    },
    {
      file: "lib/db/src/schema-statements.ts",
      anchor: "scaffold:anchor:collection-ddl",
      block: ddlBlock(spec, n),
      indent: "  ",
    },
    {
      file: "artifacts/api-server/src/routes/index.ts",
      anchor: "scaffold:anchor:module-route-imports",
      block: `import ${n.plural}Router from "./${n.plural}";`,
    },
    {
      file: "artifacts/api-server/src/routes/index.ts",
      anchor: "scaffold:anchor:module-route-mounts",
      block: `router.use("/${n.plural}", ${n.plural}Router);`,
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:feature-imports",
      block: `import "@/${n.plural}/features";`,
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:lazy-pages",
      block: `const ${n.PascalP}Collection = lazy(() => import("@/${n.plural}/pages/collection"));
const ${n.PascalP}Detail = lazy(() => import("@/${n.plural}/pages/detail"));
const ${n.PascalP}Add = lazy(() => import("@/${n.plural}/pages/add"));`,
    },
    {
      file: "artifacts/modules/src/App.tsx",
      anchor: "scaffold:anchor:module-routes",
      jsx: true,
      indent: "                ",
      block: `                <Route path="/${n.plural}" component={${n.PascalP}Collection} />
                <Route
                  path="/${n.plural}/item/:id"
                  component={${n.PascalP}Detail}
                />
                <Route path="/${n.plural}/add" component={${n.PascalP}Add} />`,
    },
    {
      file: "artifacts/web/src/config/apps.tsx",
      anchor: "scaffold:anchor:hub-cards",
      indent: "  ",
      block: `  {
    id: "${n.plural}",
    name: "${n.title}",
    href: \`\${base}modules/${n.plural}/\`,
    // TODO(scaffold): replace with a real collection image
    image: \`\${base}images/elaine-collection.png\`,
    updated: "New collection",
    stats: [{ value: "—", label: "Items" }],
    description: "${n.title} collection.",
  },`,
    },
    {
      file: "lib/elaine-ui/src/AppSwitcher.tsx",
      anchor: "scaffold:anchor:app-ids",
      block: `  | "${n.plural}"`,
    },
    {
      file: "lib/elaine-ui/src/AppSwitcher.tsx",
      anchor: "scaffold:anchor:app-entries",
      indent: "    ",
      block: `    {
      id: "${n.plural}",
      name: "${n.title}",
      subtitle: "${n.title} collection",
      href: "/modules/${n.plural}/",
      // TODO(scaffold): replace with a bespoke logo
      Logo: ({ className }) => (
        <GenericModuleLogo initial="${n.title.charAt(0).toUpperCase()}" className={className} />
      ),
    },`,
    },
  ];
  return ins;
}

// ---------------------------------------------------------------------------
// Scaffold + undo
// ---------------------------------------------------------------------------

function run(cmd: string): void {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

/**
 * Provenance header baked into every generated file. `--undo` refuses to
 * delete any file that lacks this exact marker, so it can never destroy a
 * hand-built module (e.g. `--undo pottery`) whose paths merely collide with
 * the scaffolder's naming scheme.
 */
export function provenanceMarker(plural: string): string {
  return `scaffold:generated:${plural}`;
}

function provenanceHeader(rel: string, plural: string): string {
  const marker = `${provenanceMarker(plural)} — created by scaffold-collection-module; --undo ${plural} deletes this file`;
  if (rel.endsWith(".md")) return `<!-- ${marker} -->\n\n`;
  if (rel.endsWith(".yaml") || rel.endsWith(".yml")) return `# ${marker}\n`;
  return `// ${marker}\n`;
}

function writeGenerated(rel: string, content: string, plural: string): void {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) fail(`${rel} already exists — run --undo first`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, provenanceHeader(rel, plural) + content);
  console.log(`  + ${rel}`);
}

function listFilesRecursive(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const p = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

function scaffold(
  specPath: string,
  runCodegen: boolean,
  runFormat: boolean,
): void {
  const spec = loadSpec(specPath);
  const n = makeNames(spec);
  console.log(`\nScaffolding collection module "${n.plural}"...\n`);

  // Preflight: refuse if any shared file already has a block for this module.
  for (const file of SHARED_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.readFileSync(abs, "utf8").includes(`scaffold:begin:${n.plural}`)) {
      fail(
        `${file} already contains a scaffold block for "${n.plural}" — run --undo ${n.plural} first`,
      );
    }
  }

  const created: string[] = [];
  const add = (rel: string, content: string) => {
    writeGenerated(rel, content, n.plural);
    created.push(rel);
  };

  add(`lib/api-spec/sources/${n.plural}.yaml`, yamlTemplate(spec, n));
  add(`lib/db/src/schema/${n.plural}.ts`, drizzleTemplate(spec, n));
  add(
    `artifacts/api-server/src/lib/${n.plural}/serialize.ts`,
    serializeTemplate(spec, n),
  );
  add(
    `artifacts/api-server/src/routes/${n.plural}/${n.plural}.ts`,
    itemsRouteTemplate(spec, n),
  );
  if (spec.categories) {
    add(
      `artifacts/api-server/src/routes/${n.plural}/categories.ts`,
      categoriesRouteTemplate(n),
    );
  }
  if (spec.photos) {
    add(
      `artifacts/api-server/src/lib/${n.plural}/storage.ts`,
      storageTemplate(n),
    );
    add(
      `artifacts/api-server/src/routes/${n.plural}/images.ts`,
      imagesRouteTemplate(n),
    );
  }
  add(
    `artifacts/api-server/src/routes/${n.plural}/index.ts`,
    routeIndexTemplate(spec, n),
  );
  add(`artifacts/modules/src/${n.plural}/features.ts`, featuresTemplate(n));
  add(
    `artifacts/modules/src/${n.plural}/pages/collection.tsx`,
    collectionPageTemplate(spec, n),
  );
  add(
    `artifacts/modules/src/${n.plural}/pages/detail.tsx`,
    detailPageTemplate(spec, n),
  );
  add(
    `artifacts/modules/src/${n.plural}/pages/add.tsx`,
    addPageTemplate(spec, n),
  );
  add(
    `artifacts/modules/src/${n.plural}/SCAFFOLD_TODO.md`,
    todoTemplate(spec, n),
  );

  for (const ins of buildInsertions(spec, n)) applyInsertion(ins, n.plural);

  const prettierTargets = [
    ...created.filter((f) => !f.endsWith(".md") && !f.endsWith(".yaml")),
    ...SHARED_FILES,
  ];
  if (runFormat) {
    run(`pnpm exec prettier --write ${prettierTargets.join(" ")}`);
  }

  if (runCodegen) {
    run("pnpm --filter @workspace/api-spec run codegen");
  } else {
    console.log(
      "\nSkipped codegen (--no-codegen). Run it before typechecking:",
    );
    console.log("  pnpm --filter @workspace/api-spec run codegen");
  }

  console.log(`\n✔ Scaffolded "${n.plural}". Next steps:
  1. Review artifacts/modules/src/${n.plural}/SCAFFOLD_TODO.md
  2. pnpm run typecheck
  3. Restart the "artifacts/api-server: API Server" workflow (no hot reload)
     — it creates the new tables in dev on startup.
  4. Open /modules/${n.plural}/ in the preview.
  To reverse everything: pnpm --filter @workspace/scripts run scaffold:collection -- --undo ${n.plural}
`);
}

function undo(plural: string, runCodegen: boolean): void {
  if (!NAME_RE.test(plural)) fail(`invalid plural "${plural}"`);
  console.log(`\nRemoving scaffolded collection module "${plural}"...\n`);
  const { files, dirs } = generatedPaths(plural);

  // ---- All-or-nothing provenance preflight: verify BEFORE deleting anything.
  // Every existing target file (including every file inside target dirs) must
  // carry the scaffold:generated:<plural> marker; a single unmarked file
  // aborts the whole undo with nothing removed. This makes `--undo pottery`
  // (or any hand-built module whose paths collide) a hard error, not a wipe.
  const marker = provenanceMarker(plural);
  const offenders: string[] = [];
  let anyTargetExists = false;
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    anyTargetExists = true;
    if (!fs.readFileSync(abs, "utf8").includes(marker)) offenders.push(rel);
  }
  for (const rel of dirs) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    anyTargetExists = true;
    for (const f of listFilesRecursive(abs)) {
      if (!fs.readFileSync(f, "utf8").includes(marker)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
  }
  // Shared-file blocks must be well-formed too: every scaffold:begin marker
  // needs a matching scaffold:end marker AFTER it (pairwise, in order). A
  // hand-edited/truncated block would otherwise pass preflight, let generated
  // files be deleted, and then blow up mid-removal — leaving a partial undo.
  let anySharedBlock = false;
  const malformed: string[] = [];
  for (const file of SHARED_FILES) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    let open = false;
    for (let i = 0; i < lines.length; i++) {
      const isBegin = lines[i]!.includes(`scaffold:begin:${plural}`);
      const isEnd = lines[i]!.includes(`scaffold:end:${plural}`);
      if (isBegin) {
        anySharedBlock = true;
        if (open) {
          malformed.push(
            `${file}:${i + 1}: nested/unclosed begin marker for "${plural}"`,
          );
        }
        open = true;
      } else if (isEnd) {
        if (!open) {
          malformed.push(
            `${file}:${i + 1}: end marker without a preceding begin for "${plural}"`,
          );
        }
        open = false;
      }
    }
    if (open) {
      malformed.push(`${file}: begin marker with no matching end marker`);
    }
  }
  if (malformed.length > 0) {
    fail(
      `refusing to undo "${plural}": malformed scaffold marker blocks in shared files:\n` +
        malformed.map((m) => `    ${m}`).join("\n") +
        `\n  Nothing was deleted. Repair the begin/end markers, then re-run --undo.`,
    );
  }
  if (offenders.length > 0) {
    fail(
      `refusing to undo "${plural}": these files exist but were NOT generated by this scaffolder (missing "${marker}" marker):\n` +
        offenders.map((f) => `    ${f}`).join("\n") +
        `\n  Nothing was deleted. If this module really was scaffolded, remove it manually.`,
    );
  }
  if (!anyTargetExists && !anySharedBlock) {
    fail(
      `nothing to undo for "${plural}": no generated files and no scaffold blocks in shared files.`,
    );
  }

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs);
      console.log(`  - ${rel}`);
    }
  }
  for (const rel of dirs) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true });
      console.log(`  - ${rel}/`);
    }
  }
  let removedAny = false;
  for (const file of SHARED_FILES) {
    // A file can contain multiple blocks (e.g. routes/index.ts) — loop.
    while (removeMarkedBlock(file, plural)) removedAny = true;
  }
  if (!removedAny) console.log("  (no scaffold blocks found in shared files)");
  if (runCodegen) run("pnpm --filter @workspace/api-spec run codegen");
  console.log(`\n✔ Removed "${plural}". Note: any DB tables already created in
dev/prod are left in place (DDL is additive) — drop them manually if needed.
`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const runCodegen = !args.includes("--no-codegen");
  const runFormat = !args.includes("--no-format");
  const undoIdx = args.indexOf("--undo");
  if (undoIdx !== -1) {
    const plural = args[undoIdx + 1];
    if (!plural) fail("--undo requires the module's plural name");
    undo(plural, runCodegen);
    return;
  }
  const specIdx = args.indexOf("--spec");
  if (specIdx === -1 || !args[specIdx + 1]) {
    fail(
      "Usage: scaffold:collection -- --spec <resource.json> [--no-codegen]\n" +
        "       scaffold:collection -- --undo <plural> [--no-codegen]",
    );
  }
  scaffold(
    path.resolve(process.cwd(), args[specIdx + 1]),
    runCodegen,
    runFormat,
  );
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

function imagesRouteTemplate(n: Names): string {
  return `// Generated by scaffold-collection-module for the "${n.plural}" collection.
import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  ${n.plural}Items as items,
  ${n.plural}Images as images,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { DEFAULT_MULTER_FILE_BYTES } from "../../middleware/uploadSizeGuard";
import {
  createImageFileFilter,
  sniffAndValidateMime,
  isImageMimeType,
  stripMetadata,
} from "@workspace/upload-validation";
import {
  uploadImage,
  downloadImageBuffer,
  deleteImage,
  invalidateImageCache,
} from "../../lib/${n.plural}/storage";
import { pathCacheBuster } from "../../lib/path-cache-buster";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DEFAULT_MULTER_FILE_BYTES,
    files: 1,
    fields: 4,
    fieldSize: 8192,
  },
  fileFilter: createImageFileFilter(ALLOWED_IMAGE_TYPES),
});

const router: IRouter = Router();
router.use(requireAuth);

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ImageParams = z.object({
  id: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// GET /items/:id/image — serve the primary image (imagePath on the item row)
// ---------------------------------------------------------------------------
router.get("/items/:id/image", async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const userId = req.session.userId!;
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!item || item.deletedAt || !item.imagePath) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(item.imagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.send(buffer);
});

// ---------------------------------------------------------------------------
// GET /items/:id/images/:imageId — serve a specific image by id
// ---------------------------------------------------------------------------
router.get("/items/:id/images/:imageId", async (req, res) => {
  const { id, imageId } = ImageParams.parse(req.params);
  const userId = req.session.userId!;
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [img] = await db
    .select()
    .from(images)
    .where(
      and(eq(images.id, imageId), eq(images.itemId, id), isNull(images.deletedAt)),
    );
  if (!img) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { buffer, contentType } = await downloadImageBuffer(img.storagePath);
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.send(buffer);
});

// ---------------------------------------------------------------------------
// POST /items/:id/images — upload a photo
// ---------------------------------------------------------------------------
router.post("/items/:id/images", upload.single("image"), async (req, res) => {
  const { id } = IdParams.parse(req.params);
  const userId = req.session.userId!;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  let sniffedType: ReturnType<typeof sniffAndValidateMime>;
  try {
    sniffedType = sniffAndValidateMime(file.buffer, file.mimetype);
  } catch {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  if (!isImageMimeType(sniffedType)) {
    res.status(400).json({
      error: "Unsupported image. Please upload a JPEG, PNG, or WEBP photo.",
    });
    return;
  }
  const contentType = sniffedType;
  const cleanBuffer = await stripMetadata(file.buffer, contentType);

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!item || item.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Determine position (append after existing non-deleted images).
  const existing = await db
    .select({ id: images.id })
    .from(images)
    .where(and(eq(images.itemId, id), isNull(images.deletedAt)));
  const position = existing.length;

  const storagePath = await uploadImage(cleanBuffer, contentType);
  const label =
    typeof req.body["label"] === "string" ? req.body["label"] : null;

  const [imgRow] = await db
    .insert(images)
    .values({ itemId: id, storagePath, label, position })
    .returning();

  // First image becomes the primary (gallery cover) automatically.
  if (position === 0) {
    await db
      .update(items)
      .set({ imagePath: storagePath })
      .where(eq(items.id, id));
    invalidateImageCache(storagePath);
  }

  res.status(201).json({
    id: imgRow.id,
    url: \`/api/${n.plural}/items/\${id}/images/\${imgRow.id}?v=\${pathCacheBuster(storagePath)}\`,
    label: imgRow.label,
    position: imgRow.position,
  });
});

// ---------------------------------------------------------------------------
// DELETE /items/:id/images/:imageId — remove a photo (soft-delete + cleanup)
// ---------------------------------------------------------------------------
router.delete("/items/:id/images/:imageId", async (req, res) => {
  const { id, imageId } = ImageParams.parse(req.params);
  const userId = req.session.userId!;
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!item || item.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [img] = await db
    .select()
    .from(images)
    .where(
      and(eq(images.id, imageId), eq(images.itemId, id), isNull(images.deletedAt)),
    );
  if (!img) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(images)
    .set({ deletedAt: new Date() })
    .where(eq(images.id, imageId));
  invalidateImageCache(img.storagePath);
  await deleteImage(img.storagePath).catch(() => void 0);

  // If this was the primary, promote the next image (by position).
  if (item.imagePath === img.storagePath) {
    const remaining = await db
      .select()
      .from(images)
      .where(and(eq(images.itemId, id), isNull(images.deletedAt)))
      .orderBy(asc(images.position));
    const next = remaining[0] ?? null;
    await db
      .update(items)
      .set({ imagePath: next?.storagePath ?? null })
      .where(eq(items.id, id));
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /items/:id/images/:imageId/primary — promote to gallery cover
// ---------------------------------------------------------------------------
router.post("/items/:id/images/:imageId/primary", async (req, res) => {
  const { id, imageId } = ImageParams.parse(req.params);
  const userId = req.session.userId!;
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  if (!item || item.deletedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [img] = await db
    .select()
    .from(images)
    .where(
      and(eq(images.id, imageId), eq(images.itemId, id), isNull(images.deletedAt)),
    );
  if (!img) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [updated] = await db
    .update(items)
    .set({ imagePath: img.storagePath })
    .where(eq(items.id, id))
    .returning();
  res.json({ id: updated.id, imagePath: updated.imagePath });
});

export default router;
`;
}
