const fs = require("fs");
const path = require("path");

const indexPath = path.resolve(__dirname, "../api-zod/src/index.ts");
const content = fs.readFileSync(indexPath, "utf8");

// Remove the generated/types re-export entirely.
// All TypeScript types are inferred from the Zod schemas in generated/api.ts,
// so the types/ barrel is redundant and causes TS2308 name conflicts.
const patched = content
  .split("\n")
  .filter((line) => !line.includes("./generated/types"))
  .join("\n");

fs.writeFileSync(indexPath, patched);
console.log("Patched api-zod/src/index.ts: removed generated/types re-export");
