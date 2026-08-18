import assert from "node:assert/strict";
import ts from "typescript";
import {
  addTsconfigReference,
  addWorkspaceDependency,
} from "./scaffold-lib.js";

// --- addTsconfigReference: insert into existing non-empty references ---
{
  const src = `{
  "extends": "./tsconfig.base.json",
  "references": [
    {
      "path": "./lib/db"
    }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/new-lib");
  assert.ok(out.includes(`"path": "./lib/new-lib"`), "new reference inserted");
  assert.ok(out.includes(`"path": "./lib/db"`), "existing reference preserved");
  assert.ok(
    out.indexOf("./lib/db") < out.indexOf("./lib/new-lib"),
    "appended after existing",
  );
  assert.doesNotThrow(() => JSON.parse(out), "result stays valid JSON");
  assert.equal(JSON.parse(out).references.length, 2);
}

// --- addTsconfigReference: idempotent ---
{
  const src = `{ "references": [{ "path": "./lib/new-lib" }] }`;
  assert.equal(
    addTsconfigReference(src, "./lib/new-lib"),
    src,
    "no duplicate insertion",
  );
}

// --- addTsconfigReference: idempotent with different whitespace formatting ---
{
  const src = `{ "references": [{ "path"  :  "./lib/new-lib" }] }`;
  assert.equal(addTsconfigReference(src, "./lib/new-lib"), src);
}

// --- addTsconfigReference: empty references array ---
{
  const out = addTsconfigReference(
    `{\n  "references": []\n}\n`,
    "../../lib/foo",
  );
  assert.ok(out.includes(`"path": "../../lib/foo"`));
  assert.equal(JSON.parse(out).references.length, 1);
}

// --- addTsconfigReference: no references key at all ---
{
  const out = addTsconfigReference(
    `{\n  "extends": "../../tsconfig.base.json"\n}\n`,
    "../../lib/foo",
  );
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
  assert.equal(parsed.extends, "../../tsconfig.base.json");
}

// --- addTsconfigReference: brackets inside comments/strings are not structure ---
{
  const src = `{
  "references": [
    // pending removal ]
    /* also here: ] [ */
    {
      "path": "./lib/db" // note: "]" in trailing comment
    }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/new-lib");
  assert.ok(
    out.includes(`"path": "./lib/new-lib"`),
    "inserted despite comments",
  );
  assert.ok(
    out.indexOf("./lib/db") < out.indexOf("./lib/new-lib"),
    "appended after existing entry, inside the real array",
  );
  assert.ok(
    out.indexOf("./lib/new-lib") < out.lastIndexOf("]"),
    "insertion happens before the real closing bracket",
  );
}

// --- addTsconfigReference: bracket-like content in a string value ---
{
  const src = `{
  "references": [
    {
      "path": "./lib/weird]name"
    }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/new-lib");
  assert.doesNotThrow(() => JSON.parse(out), "result stays valid JSON");
  assert.equal(JSON.parse(out).references.length, 2);
}

// --- addTsconfigReference: existing trailing comma in references (JSONC) ---
{
  const src = `{
  "references": [
    {
      "path": "./lib/db"
    },
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/new-lib");
  assert.ok(!/,\s*,/.test(out), "no double comma emitted");
  assert.ok(out.includes(`"path": "./lib/new-lib"`), "new reference inserted");
  assert.doesNotThrow(() => JSON.parse(out), "result stays valid JSON");
}

// --- addTsconfigReference: comments-only references array ---
{
  const src = `{
  "references": [
    // none yet
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/new-lib");
  assert.ok(out.includes("// none yet"), "comment preserved");
  assert.ok(out.includes(`"path": "./lib/new-lib"`), "entry inserted");
  assert.ok(
    !/\]\s*,/.test(out.slice(0, out.indexOf("new-lib"))),
    "sane structure",
  );
}

// --- addTsconfigReference: tolerates JSONC comments outside the array ---
{
  const src = `{
  // artifact tsconfig with comments
  "compilerOptions": {
    "noEmit": true
  },
  "references": [
    {
      "path": "../../lib/web-core"
    }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  assert.ok(out.includes(`"path": "../../lib/foo"`));
  assert.ok(
    out.includes("// artifact tsconfig with comments"),
    "comments preserved",
  );
}

/** Parse JSONC with the TypeScript config parser; assert it is valid. */
function parseJsonc(text: string): Record<string, unknown> {
  const result = ts.parseConfigFileTextToJson("tsconfig.json", text);
  assert.equal(
    result.error,
    undefined,
    `result must be valid JSONC:\n${text}\n${result.error ? ts.flattenDiagnosticMessageText(result.error.messageText, "\n") : ""}`,
  );
  return result.config as Record<string, unknown>;
}

// --- addTsconfigReference: trailing // comment on the last reference entry ---
{
  const src = `{
  "references": [
    {
      "path": "../../lib/db"
    } // keep db first
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [
    { path: "../../lib/db" },
    { path: "../../lib/foo" },
  ]);
  assert.ok(out.includes("// keep db first"), "comment preserved");
}

// --- addTsconfigReference: block comment inside the references array ---
{
  const src = `{
  "references": [
    { "path": "../../lib/db" } /* pinned */
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.equal((parsed.references as unknown[]).length, 2);
  assert.ok(out.includes("/* pinned */"), "block comment preserved");
}

// --- addTsconfigReference: references array containing only a comment ---
{
  const src = `{
  "references": [
    // none yet
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
  assert.ok(out.includes("// none yet"), "comment preserved");
}

// --- addTsconfigReference: no references key, trailing comment after last property ---
{
  const src = `{
  "extends": "../../tsconfig.base.json" // base config
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
  assert.equal(parsed.extends, "../../tsconfig.base.json");
  assert.ok(out.includes("// base config"), "comment preserved");
}

// --- addTsconfigReference: no references key, comment on its own line before } ---
{
  const src = `{
  "extends": "../../tsconfig.base.json"
  // add references below
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
}

// --- addTsconfigReference: brackets inside strings/comments don't confuse matching ---
{
  const src = `{
  "compilerOptions": { "paths": { "x": ["./src/[weird]"] } },
  // fake close: ]
  "references": [
    { "path": "../../lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.equal((parsed.references as unknown[]).length, 2);
}

// --- addTsconfigReference: comment lookalike of '"references": [' ---
{
  const src = `{
  // historical "references": [
  "references": [
    { "path": "./lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/foo");
  const stripped = out.replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual(
    JSON.parse(stripped).references.map((r: { path: string }) => r.path),
    ["./lib/db", "./lib/foo"],
    "comment lookalike of the references key is ignored",
  );
}

// --- addTsconfigReference: '"path"' lookalike inside a comment is not a match ---
{
  const src = `{
  // removed: "path": "./lib/foo"
  "references": [
    { "path": "./lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/foo");
  const stripped = out.replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual(
    JSON.parse(stripped).references.map((r: { path: string }) => r.path),
    ["./lib/db", "./lib/foo"],
    "commented-out path does not defeat insertion",
  );
}

// --- addTsconfigReference: '"path": ...' lookalike inside a string value ---
{
  const src = `{
  "compilerOptions": { "outFile": "note \\"path\\": \\"./lib/foo\\" here" },
  "references": [
    { "path": "./lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "./lib/foo");
  assert.deepEqual(
    JSON.parse(out).references.map((r: { path: string }) => r.path),
    ["./lib/db", "./lib/foo"],
    "string-literal lookalike does not defeat insertion",
  );
}

// --- addTsconfigReference: '"references": [' lookalike inside a string value ---
{
  const src = `{
  "compilerOptions": { "outFile": "see \\"references\\": [ docs" },
  "extends": "../../tsconfig.base.json"
}
`;
  const out = addTsconfigReference(src, "./lib/foo");
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.references, [{ path: "./lib/foo" }]);
  assert.equal(parsed.extends, "../../tsconfig.base.json");
}

// --- addTsconfigReference: commented-out references line is NOT a real property ---
{
  const src = `{
  // Historic: "references": []
  "extends": "../../tsconfig.base.json"
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
  assert.equal(parsed.extends, "../../tsconfig.base.json");
  assert.ok(out.includes(`// Historic: "references": []`), "comment preserved");
}

// --- addTsconfigReference: "references" text inside a string value is ignored ---
{
  const src = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist/references-todo" }
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [{ path: "../../lib/foo" }]);
}

// --- addTsconfigReference: commented-out references AND a real one later ---
{
  const src = `{
  /* "references": [ { "path": "./old" } ] */
  "references": [
    { "path": "../../lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [
    { path: "../../lib/db" },
    { path: "../../lib/foo" },
  ]);
}

// --- addTsconfigReference: trailing comma after the last reference entry ---
{
  const src = `{
  "references": [
    { "path": "../../lib/db" },
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [
    { path: "../../lib/db" },
    { path: "../../lib/foo" },
  ]);
  assert.ok(!out.includes(",,"), "no doubled comma");
}

// --- addTsconfigReference: commented-out matching path is NOT an existing ref ---
{
  const src = `{
  "references": [
    { "path": "../../lib/db" }
    // { "path": "../../lib/foo" }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [
    { path: "../../lib/db" },
    { path: "../../lib/foo" },
  ]);
}

// --- addTsconfigReference: comment between "references" and the colon/bracket ---
{
  const src = `{
  "references" /* project refs */: [
    { "path": "../../lib/db" }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  const parsed = parseJsonc(out);
  assert.deepEqual(parsed.references, [
    { path: "../../lib/db" },
    { path: "../../lib/foo" },
  ]);
}

// --- addTsconfigReference: no references key + trailing block comment ---
{
  const src = `{
  "extends": "../../tsconfig.base.json" /* keep me */
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  assert.ok(out.includes("/* keep me */"), "block comment preserved");
  assert.deepEqual(parseJsonc(out).references, [{ path: "../../lib/foo" }]);
}

// --- addTsconfigReference: brackets inside comments/strings within the array ---
{
  const src = `{
  "references": [
    // fake bracket ] in a comment
    {
      "path": "../../lib/we]ird" /* also ] here */
    }
  ]
}
`;
  const out = addTsconfigReference(src, "../../lib/foo");
  assert.deepEqual(parseJsonc(out).references, [
    { path: "../../lib/we]ird" },
    { path: "../../lib/foo" },
  ]);
}

// --- addTsconfigReference: unbalanced brackets throw ---
assert.throws(() =>
  addTsconfigReference(`{ "references": [ { "path": "./x" }`, "./lib/foo"),
);

// --- addWorkspaceDependency: adds to devDependencies, sorted ---
{
  const src = `{
  "name": "@workspace/modules",
  "devDependencies": {
    "zod": "catalog:",
    "@workspace/app-shell": "workspace:*"
  }
}
`;
  const out = addWorkspaceDependency(
    src,
    "@workspace/new-lib",
    "devDependencies",
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.devDependencies["@workspace/new-lib"], "workspace:*");
  assert.deepEqual(Object.keys(parsed.devDependencies), [
    "@workspace/app-shell",
    "@workspace/new-lib",
    "zod",
  ]);
}

// --- addWorkspaceDependency: adds to dependencies when asked ---
{
  const out = addWorkspaceDependency(
    `{ "name": "@workspace/api-server" }`,
    "@workspace/new-lib",
    "dependencies",
  );
  assert.equal(
    JSON.parse(out).dependencies["@workspace/new-lib"],
    "workspace:*",
  );
}

// --- addWorkspaceDependency: idempotent across any section ---
{
  const src = `{ "dependencies": { "@workspace/new-lib": "workspace:*" } }`;
  assert.equal(
    addWorkspaceDependency(src, "@workspace/new-lib", "devDependencies"),
    src,
  );
}

console.log("scaffold-lib tests passed");
