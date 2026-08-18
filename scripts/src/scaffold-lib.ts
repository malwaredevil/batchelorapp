/**
 * scaffold-lib.ts — generate a correctly wired empty lib/<name> workspace package.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run scaffold-lib -- --name my-lib
 *   pnpm --filter @workspace/scripts run scaffold-lib -- --name my-ui --react
 *   pnpm --filter @workspace/scripts run scaffold-lib -- --name my-lib --with-tests \
 *       --consumers artifacts/modules,lib/collection-ui
 *
 * What it does:
 *   1. Creates lib/<name>/ with package.json, tsconfig.json (composite,
 *      declarationMap, emitDeclarationOnly) and a src/index.ts barrel.
 *   2. Registers the package in the root tsconfig.json `references` array.
 *   3. For each --consumers entry (workspace-relative dir like
 *      `artifacts/modules` or `lib/collection-ui`), idempotently adds a
 *      reference to the new lib in that consumer's tsconfig.json AND a
 *      `"@workspace/<name>": "workspace:*"` entry in the consumer's
 *      package.json (see --dep-type).
 *   4. Reminds you to run `pnpm install` (and runs it with --run-install).
 *
 * Flags:
 *   --name <name>        required; kebab-case package name (package will be @workspace/<name>)
 *   --react              React-component lib variant (jsx, dom lib, react peerDependencies)
 *   --with-tests         add vitest devDependency + `test` script + src/index.test.ts
 *   --consumers a,b,c    comma-separated workspace dirs to wire references + deps into
 *   --dep-type <type>    where consumers declare the dependency: "devDependencies"
 *                        (default; correct for static/client-only artifacts and libs)
 *                        or "dependencies" (server artifacts with runtime imports)
 *   --run-install        run `pnpm install` at the end to link the new package
 */

import { execSync } from "node:child_process";
import * as jsonc from "jsonc-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type DepType = "dependencies" | "devDependencies";

interface Options {
  name: string;
  react: boolean;
  withTests: boolean;
  consumers: string[];
  depType: DepType;
  runInstall: boolean;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let name = "";
  let react = false;
  let withTests = false;
  let runInstall = false;
  let depType: DepType = "devDependencies";
  const consumers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm run passes the separator through
    switch (arg) {
      case "--name":
        name = argv[++i] ?? "";
        break;
      case "--react":
        react = true;
        break;
      case "--with-tests":
        withTests = true;
        break;
      case "--run-install":
        runInstall = true;
        break;
      case "--dep-type": {
        const value = argv[++i] ?? "";
        if (value !== "dependencies" && value !== "devDependencies") {
          fail(
            `--dep-type must be "dependencies" or "devDependencies" (got "${value}")`,
          );
        }
        depType = value;
        break;
      }
      case "--consumers":
        for (const c of (argv[++i] ?? "").split(",")) {
          const trimmed = c.trim().replace(/\/+$/, "");
          if (trimmed) consumers.push(trimmed);
        }
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  if (!name) fail("--name is required");
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    fail(`--name must be kebab-case (got "${name}")`);
  }
  return { name, react, withTests, consumers, depType, runInstall };
}

function writeFileIfAbsent(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function packageJsonContent(opts: Options): string {
  const pkg: Record<string, unknown> = {
    name: `@workspace/${opts.name}`,
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts" },
    scripts: {
      ...(opts.withTests ? { test: "vitest run" } : {}),
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
  };
  if (opts.react) {
    pkg["peerDependencies"] = {
      react: ">=18",
      "react-dom": ">=18",
    };
    pkg["devDependencies"] = {
      "@types/react": "catalog:",
      "@types/react-dom": "catalog:",
      react: "catalog:",
      "react-dom": "catalog:",
      ...(opts.withTests ? { vitest: "^3.2.6" } : {}),
    };
  } else if (opts.withTests) {
    pkg["devDependencies"] = { vitest: "^3.2.6" };
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function tsconfigContent(opts: Options): string {
  const compilerOptions: Record<string, unknown> = {
    composite: true,
    declarationMap: true,
    emitDeclarationOnly: true,
    outDir: "dist",
    rootDir: "src",
    ...(opts.react
      ? { jsx: "react-jsx", lib: ["dom", "es2022"] }
      : { lib: ["es2022"] }),
  };
  const tsconfig = {
    extends: "../../tsconfig.base.json",
    compilerOptions,
    include: ["src"],
  };
  return `${JSON.stringify(tsconfig, null, 2)}\n`;
}

function indexContent(opts: Options): string {
  return [
    `// @workspace/${opts.name} — barrel export.`,
    `// Add \`export { ... } from "./<module>";\` lines here as you extract code.`,
    `export {};`,
    ``,
  ].join("\n");
}

function testContent(opts: Options): string {
  return [
    `import { describe, expect, it } from "vitest";`,
    ``,
    `describe("@workspace/${opts.name}", () => {`,
    `  it("has a working test setup", () => {`,
    `    expect(true).toBe(true);`,
    `  });`,
    `});`,
    ``,
  ].join("\n");
}

/**
 * Idempotently insert `{ "path": <refPath> }` into a tsconfig's `references`
 * array. Artifact tsconfigs may contain comments and trailing commas
 * (JSONC), so this delegates parsing and editing to `jsonc-parser` — the
 * same library VS Code uses to edit settings/tsconfig files — instead of
 * hand-rolled text manipulation. Comments and existing formatting are
 * preserved; the edit is a minimal, comma-correct insertion.
 */
export function addTsconfigReference(source: string, refPath: string): string {
  const errors: jsonc.ParseError[] = [];
  const config = jsonc.parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as { references?: Array<{ path?: string }> } | undefined;
  if (errors.length > 0 || typeof config !== "object" || config === null) {
    throw new Error(
      `malformed tsconfig: ${
        errors.length > 0
          ? errors
              .map(
                (e) =>
                  `${jsonc.printParseErrorCode(e.error)} at offset ${e.offset}`,
              )
              .join(", ")
          : "root value is not an object"
      }`,
    );
  }

  // Idempotency: already referenced? (Checked structurally, so a
  // commented-out `"path": ...` never counts as an existing reference.)
  const refs = Array.isArray(config.references) ? config.references : [];
  if (refs.some((r) => r && typeof r === "object" && r.path === refPath)) {
    return source;
  }

  // jsonc.modify preserves a pre-existing trailing comma inside the
  // references array (legal JSONC, invalid strict JSON). Strip it from the
  // array's own text range first so the output stays JSON.parse-able.
  const tree = jsonc.parseTree(source, undefined, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const refsNode = tree && jsonc.findNodeAtLocation(tree, ["references"]);
  if (refsNode && refsNode.type === "array") {
    const arrayText = source.slice(
      refsNode.offset,
      refsNode.offset + refsNode.length,
    );
    const fixedArrayText = arrayText.replace(/,(\s*)\]$/, "$1]");
    if (fixedArrayText !== arrayText) {
      source =
        source.slice(0, refsNode.offset) +
        fixedArrayText +
        source.slice(refsNode.offset + refsNode.length);
    }
  }

  const edits = jsonc.modify(
    source,
    ["references", refs.length],
    { path: refPath },
    {
      isArrayInsertion: true,
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    },
  );
  const result = jsonc.applyEdits(source, edits);
  // jsonc.modify preserves a pre-existing trailing comma from the source
  // (valid JSONC, invalid strict JSON). Detect it jsonc-aware — comments in
  // the source are fine and must not trip this — and strip only trailing
  // commas before closing brackets/braces.
  const strictErrors: jsonc.ParseError[] = [];
  jsonc.parse(result, strictErrors, {
    allowTrailingComma: false,
    disallowComments: false,
  });
  if (strictErrors.length === 0) return result;
  const cleaned = result.replace(/,(\s*(?:\/\/[^\n]*\n\s*)*[\]}])/g, "$1");
  const cleanedErrors: jsonc.ParseError[] = [];
  jsonc.parse(cleaned, cleanedErrors, {
    allowTrailingComma: false,
    disallowComments: false,
  });
  if (cleanedErrors.length > 0) {
    throw new Error(
      "addTsconfigReference produced invalid JSON after trailing-comma cleanup",
    );
  }
  return cleaned;
}

/**
 * Idempotently add `"@workspace/<name>": "workspace:*"` to a consumer
 * package.json's dependencies or devDependencies (keys kept sorted).
 * Returns the updated JSON text, or the input unchanged if the dependency
 * is already declared in either section.
 */
export function addWorkspaceDependency(
  source: string,
  pkgName: string,
  depType: DepType,
): string {
  const pkg = JSON.parse(source) as Record<string, unknown>;
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (deps && pkgName in deps) return source;
  }
  const deps = {
    ...((pkg[depType] as Record<string, string> | undefined) ?? {}),
  };
  deps[pkgName] = "workspace:*";
  pkg[depType] = Object.fromEntries(
    Object.keys(deps)
      .sort()
      .map((k) => [k, deps[k] as string]),
  );
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function relativeRef(fromDir: string, toDir: string): string {
  const rel = path.relative(path.join(ROOT, fromDir), path.join(ROOT, toDir));
  return rel.split(path.sep).join("/").startsWith(".")
    ? rel.split(path.sep).join("/")
    : `./${rel.split(path.sep).join("/")}`;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const libDir = path.join(ROOT, "lib", opts.name);
  if (fs.existsSync(libDir)) fail(`lib/${opts.name} already exists`);

  // Validate consumers up front, before writing anything.
  for (const consumer of opts.consumers) {
    const tsconfigPath = path.join(ROOT, consumer, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      fail(
        `consumer "${consumer}" has no tsconfig.json (expected ${consumer}/tsconfig.json)`,
      );
    }
    if (!fs.existsSync(path.join(ROOT, consumer, "package.json"))) {
      fail(
        `consumer "${consumer}" has no package.json (expected ${consumer}/package.json)`,
      );
    }
  }

  // 1. Package files.
  writeFileIfAbsent(
    path.join(libDir, "package.json"),
    packageJsonContent(opts),
  );
  writeFileIfAbsent(path.join(libDir, "tsconfig.json"), tsconfigContent(opts));
  writeFileIfAbsent(path.join(libDir, "src", "index.ts"), indexContent(opts));
  if (opts.withTests) {
    writeFileIfAbsent(
      path.join(libDir, "src", "index.test.ts"),
      testContent(opts),
    );
  }
  console.log(
    `created lib/${opts.name} (${opts.react ? "React-component" : "plain TS"} lib)`,
  );

  // 2. Root tsconfig.json references entry.
  const rootTsconfigPath = path.join(ROOT, "tsconfig.json");
  const rootBefore = fs.readFileSync(rootTsconfigPath, "utf8");
  const rootAfter = addTsconfigReference(rootBefore, `./lib/${opts.name}`);
  if (rootAfter !== rootBefore) {
    fs.writeFileSync(rootTsconfigPath, rootAfter);
    console.log(
      `registered ./lib/${opts.name} in root tsconfig.json references`,
    );
  } else {
    console.log(`root tsconfig.json already references ./lib/${opts.name}`);
  }

  // 3. Consumer references.
  for (const consumer of opts.consumers) {
    const tsconfigPath = path.join(ROOT, consumer, "tsconfig.json");
    const refPath = relativeRef(consumer, `lib/${opts.name}`);
    const before = fs.readFileSync(tsconfigPath, "utf8");
    const after = addTsconfigReference(before, refPath);
    if (after !== before) {
      fs.writeFileSync(tsconfigPath, after);
      console.log(`added ${refPath} to ${consumer}/tsconfig.json references`);
    } else {
      console.log(`${consumer}/tsconfig.json already references ${refPath}`);
    }

    const pkgJsonPath = path.join(ROOT, consumer, "package.json");
    const pkgBefore = fs.readFileSync(pkgJsonPath, "utf8");
    const pkgAfter = addWorkspaceDependency(
      pkgBefore,
      `@workspace/${opts.name}`,
      opts.depType,
    );
    if (pkgAfter !== pkgBefore) {
      fs.writeFileSync(pkgJsonPath, pkgAfter);
      console.log(
        `added "@workspace/${opts.name}": "workspace:*" to ${consumer}/package.json ${opts.depType}`,
      );
    } else {
      console.log(
        `${consumer}/package.json already declares @workspace/${opts.name}`,
      );
    }
  }

  // 4. Install / next steps.
  if (opts.runInstall) {
    console.log("running pnpm install...");
    execSync("pnpm install", { cwd: ROOT, stdio: "inherit" });
  } else {
    console.log(
      "next: run `pnpm install` to link the new package, then `pnpm run typecheck:libs`.",
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
