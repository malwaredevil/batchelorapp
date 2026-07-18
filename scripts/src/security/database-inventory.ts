import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveDatabaseUrl, sslConfig } from "@workspace/db";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(
  ROOT,
  "docs",
  "generated",
  "database-security-inventory.json",
);
const ALLOWLIST = path.join(
  ROOT,
  "docs",
  "security",
  "database-direct-access-allowlist.json",
);

type Inventory = {
  generatedBy: string;
  mode: "live" | "offline";
  exposedSchemas: string[];
  directClientAllowlist: { tables: string[]; functions: string[] };
  tables?: unknown[];
  functions?: unknown[];
  rls?: unknown[];
  securityDefinerFunctions: unknown[];
  sensitiveTablesNeverExposed: string[];
};

function readAllowlist(): {
  directClientTables: string[];
  directClientFunctions: string[];
  sensitiveTablesNeverExposed: string[];
} {
  return JSON.parse(fs.readFileSync(ALLOWLIST, "utf8"));
}

async function liveInventory(): Promise<Partial<Inventory>> {
  const pool = new pg.Pool({
    connectionString: resolveDatabaseUrl(),
    ssl: sslConfig,
    max: 1,
  });
  try {
    const [tables, functions, rls] = await Promise.all([
      pool.query(
        `
        SELECT table_schema, table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = ANY($1)
        ORDER BY table_schema, table_name
      `,
        [["public"]],
      ),
      pool.query(
        `
        SELECT n.nspname AS schema, p.proname AS name, p.prosecdef AS security_definer,
               pg_get_function_arguments(p.oid) AS arguments,
               pg_get_userbyid(p.proowner) AS owner
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1)
        ORDER BY n.nspname, p.proname
      `,
        [["public"]],
      ),
      pool.query(
        `
        SELECT schemaname, tablename, rowsecurity, forcerowsecurity
        FROM pg_tables
        WHERE schemaname = ANY($1)
        ORDER BY schemaname, tablename
      `,
        [["public"]],
      ),
    ]);
    return {
      mode: "live",
      tables: tables.rows,
      functions: functions.rows,
      rls: rls.rows,
      securityDefinerFunctions: functions.rows.filter(
        (row) => row.security_definer,
      ),
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const allowlist = readAllowlist();
  let live: Partial<Inventory>;
  try {
    live = await liveInventory();
  } catch {
    live = {
      mode: "offline",
      securityDefinerFunctions: [
        {
          schema: "public",
          name: "auto_enable_rls",
          requiredPosture: "not executable by PUBLIC, anon, or authenticated",
          migration: "lib/db/migrations/0002_security_hardening.sql",
        },
      ],
    };
  }

  const inventory: Inventory = {
    generatedBy: "scripts/src/security/database-inventory.ts",
    mode: live.mode ?? "offline",
    exposedSchemas: ["public"],
    directClientAllowlist: {
      tables: allowlist.directClientTables,
      functions: allowlist.directClientFunctions,
    },
    tables: live.tables,
    functions: live.functions,
    rls: live.rls,
    securityDefinerFunctions: live.securityDefinerFunctions ?? [],
    sensitiveTablesNeverExposed: allowlist.sensitiveTablesNeverExposed,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
