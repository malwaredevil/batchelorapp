/**
 * Guard script: lib/api-client-react/src/travels.ts is a hand-maintained
 * parallel implementation of some travels endpoints that are ALSO generated
 * by orval from the OpenAPI spec (lib/api-client-react/src/generated/api.ts
 * + api.schemas.ts). Where a name exists in both, index.ts must explicitly
 * re-export the travels.ts version (see the comment there) so the build
 * doesn't fail with an ambiguous-export error, and so it's obvious which
 * implementation actually wins.
 *
 * This script fails if:
 *   - a name is exported by both travels.ts and the generated files, but is
 *     missing from the disambiguation re-export list in index.ts (a future
 *     spec change silently added a new collision), or
 *   - a name is listed in the disambiguation block but no longer collides
 *     (stale entry that should be removed).
 *
 * Run via `pnpm --filter @workspace/scripts run check-travels-overlap`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiClientReactSrc = path.resolve(
  here,
  "../../lib/api-client-react/src",
);

const TRAVELS_FILE = path.join(apiClientReactSrc, "travels.ts");
const GENERATED_API_FILE = path.join(apiClientReactSrc, "generated/api.ts");
const GENERATED_SCHEMAS_FILE = path.join(
  apiClientReactSrc,
  "generated/api.schemas.ts",
);
const INDEX_FILE = path.join(apiClientReactSrc, "index.ts");

function getTopLevelExportNames(filePath: string): Set<string> {
  const content = readFileSync(filePath, "utf8");
  const names = new Set<string>();
  const patterns = [
    /^export (?:const|function|class) ([A-Za-z0-9_]+)/gm,
    /^export (?:type|interface) ([A-Za-z0-9_]+)/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      names.add(match[1]);
    }
  }
  return names;
}

function getDisambiguatedNames(indexContent: string): Set<string> {
  const match = indexContent.match(
    /export \{\n([\s\S]*?)\} from ["']\.\/travels["'];/,
  );
  if (!match) {
    return new Set();
  }
  const names = new Set<string>();
  for (const raw of match[1].split(",")) {
    const name = raw.trim();
    if (name) {
      names.add(name);
    }
  }
  return names;
}

const travelsExports = getTopLevelExportNames(TRAVELS_FILE);
const generatedExports = new Set([
  ...getTopLevelExportNames(GENERATED_API_FILE),
  ...getTopLevelExportNames(GENERATED_SCHEMAS_FILE),
]);

const actualOverlap = new Set(
  [...travelsExports].filter((name) => generatedExports.has(name)),
);

const indexContent = readFileSync(INDEX_FILE, "utf8");
const disambiguated = getDisambiguatedNames(indexContent);

const missing = [...actualOverlap].filter((name) => !disambiguated.has(name));
const stale = [...disambiguated].filter((name) => !actualOverlap.has(name));

if (missing.length > 0 || stale.length > 0) {
  console.error(
    "check-travels-export-overlap: lib/api-client-react/src/index.ts's " +
      "travels.ts disambiguation re-export list is out of sync with the " +
      "actual overlap between travels.ts and the orval-generated files.\n",
  );
  if (missing.length > 0) {
    console.error(
      "These names now collide but are NOT re-exported from index.ts " +
        "(a future OpenAPI spec change may be silently ignored by the app " +
        "since the ambiguous `export *` will pick a resolver-defined winner):",
    );
    console.error(missing.sort().map((n) => `  - ${n}`).join("\n"));
    console.error("");
  }
  if (stale.length > 0) {
    console.error(
      "These names are listed in index.ts's disambiguation block but no " +
        "longer collide (stale entries — remove them):",
    );
    console.error(stale.sort().map((n) => `  - ${n}`).join("\n"));
    console.error("");
  }
  console.error(
    "Fix: update the `export { ... } from \"./travels\";` block in " +
      "lib/api-client-react/src/index.ts to match the current overlap " +
      "exactly (see replit.md's 'travels.ts vs generated travels API' " +
      "architecture decision for context).",
  );
  process.exit(1);
}

console.log(
  `check-travels-export-overlap: OK (${actualOverlap.size} disambiguated names, all in sync).`,
);
