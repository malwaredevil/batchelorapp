const fs = require("fs");
const path = require("path");

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
  "Patched generated index files: normalized API exports and removed obsolete Zod type exports",
);
