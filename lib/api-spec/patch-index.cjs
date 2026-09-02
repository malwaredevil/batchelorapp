const fs = require("fs");
const path = require("path");

const indexPath = path.resolve(__dirname, "../api-zod/src/index.ts");
const content = fs.readFileSync(indexPath, "utf8");

// Remove the generated/types re-export entirely.
// All TypeScript types are inferred from the Zod schemas in generated/api.ts,
// so the types/ barrel is redundant and causes TS2308 name conflicts.
// Orval can also append its generated/api re-export to the existing hand-written
// line, so normalize that export to one stable entry after every generation.
const withoutTypes = content
  .split("\n")
  .filter((line) => !line.includes("./generated/types"))
  .filter((line) => !line.includes("./generated/api"))
  .join("\n")
  .trim();
const patched = `export * from "./generated/api";\n${withoutTypes ? `${withoutTypes}\n` : ""}`;

fs.writeFileSync(indexPath, patched);
console.log(
  "Patched api-zod/src/index.ts: normalized generated/api export and removed generated/types re-export",
);
