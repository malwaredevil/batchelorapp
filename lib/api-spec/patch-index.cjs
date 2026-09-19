const fs = require("fs");
const path = require("path");

function patchZodImport(generatedFilePath) {
  const content = fs.readFileSync(generatedFilePath, "utf8");
  const namespaceImportPattern = /import \* as zod from ["']zod["'];/;
  const apiObjectImport = "import { z as zod } from 'zod';";

  if (namespaceImportPattern.test(content)) {
    fs.writeFileSync(
      generatedFilePath,
      content.replace(namespaceImportPattern, apiObjectImport),
    );
    return;
  }

  if (!content.includes(apiObjectImport)) {
    throw new Error(
      `Could not find the expected Zod import in ${generatedFilePath}`,
    );
  }
}

function normalizeGeneratedExports(
  indexPath,
  generatedExports,
  excludedExports = [],
) {
  const content = fs.readFileSync(indexPath, "utf8");
  const filtered = content
    .split("\n")
    .filter(
      (line) =>
        ![...generatedExports, ...excludedExports].some((exportPath) =>
          line.includes(exportPath),
        ),
    )
    .join("\n")
    .trim();
  const normalized = generatedExports
    .map((exportPath) => `export * from "${exportPath}";`)
    .join("\n");

  fs.writeFileSync(
    indexPath,
    `${normalized}\n${filtered ? `${filtered}\n` : ""}`,
  );
}

patchZodImport(path.resolve(__dirname, "../api-zod/src/generated/api.ts"));
normalizeGeneratedExports(
  path.resolve(__dirname, "../api-zod/src/index.ts"),
  ["./generated/api"],
  ["./generated/types"],
);
normalizeGeneratedExports(
  path.resolve(__dirname, "../api-client-react/src/index.ts"),
  ["./generated/api", "./generated/api.schemas"],
);
console.log(
  "Patched generated files: normalized Zod import and API exports, removed obsolete Zod type exports",
);
