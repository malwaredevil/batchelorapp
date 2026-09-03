import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const ALLOWLIST = path.join(
  ROOT,
  "docs",
  "security",
  "database-direct-access-allowlist.json",
);
const HARDENING_SOURCE = path.join(ROOT, "lib/db/src/schema-statements.ts");

const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")) as {
  directClientTables: string[];
  directClientFunctions: string[];
  sensitiveTablesNeverExposed: string[];
};
const hardeningSource = fs.readFileSync(HARDENING_SOURCE, "utf8");

const failures: string[] = [];
for (const table of allowlist.sensitiveTablesNeverExposed) {
  if (allowlist.directClientTables.includes(table)) {
    failures.push(`Sensitive table is direct-client allowlisted: ${table}`);
  }
}

for (const snippet of [
  "REVOKE EXECUTE ON FUNCTION public.auto_enable_rls() FROM anon, authenticated, PUBLIC;",
]) {
  if (!hardeningSource.includes(snippet)) {
    failures.push(`Missing database hardening statement: ${snippet}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  "Database security allowlist and hardening migration are consistent.",
);
