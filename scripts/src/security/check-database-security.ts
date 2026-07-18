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
const HARDENING_SQL = path.join(
  ROOT,
  "lib",
  "db",
  "migrations",
  "0002_security_hardening.sql",
);

const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")) as {
  directClientTables: string[];
  directClientFunctions: string[];
  sensitiveTablesNeverExposed: string[];
};
const hardeningSql = fs.readFileSync(HARDENING_SQL, "utf8");

const failures: string[] = [];
for (const table of allowlist.sensitiveTablesNeverExposed) {
  if (allowlist.directClientTables.includes(table)) {
    failures.push(`Sensitive table is direct-client allowlisted: ${table}`);
  }
}

for (const snippet of [
  "REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM PUBLIC",
  "REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM anon",
  "REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM authenticated",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
]) {
  if (!hardeningSql.includes(snippet)) {
    failures.push(`Missing hardening SQL: ${snippet}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  "Database security allowlist and hardening migration are consistent.",
);
