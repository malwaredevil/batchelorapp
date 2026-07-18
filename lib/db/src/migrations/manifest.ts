import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATEMENTS } from "../schema-statements";
import { checksumStatements } from "./checksum";

export type Migration = {
  version: number;
  name: string;
  statements: string[];
  checksumSha256: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, "..", "..", "migrations");

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));
}

function loadSqlMigration(fileName: string): Migration {
  const match = fileName.match(/^(\d+)_(.+)\.sql$/);
  if (!match) {
    throw new Error(`Invalid migration file name: ${fileName}`);
  }
  const statements = splitSql(
    fs.readFileSync(path.join(sqlDir, fileName), "utf8"),
  );
  return {
    version: Number(match[1]),
    name: match[2].replace(/_/g, " "),
    statements,
    checksumSha256: checksumStatements(statements),
  };
}

export function getMigrations(): Migration[] {
  const baseline: Migration = {
    version: 1,
    name: "baseline from additive schema statements",
    statements: [...STATEMENTS],
    checksumSha256: checksumStatements(STATEMENTS),
  };

  const sqlMigrations = fs.existsSync(sqlDir)
    ? fs
        .readdirSync(sqlDir)
        .filter((file) => /^\d+_.+\.sql$/.test(file))
        .sort()
        .map(loadSqlMigration)
    : [];

  const migrations = [baseline, ...sqlMigrations];
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);
  }
  return migrations;
}

export const latestMigrationVersion = Math.max(
  ...getMigrations().map((migration) => migration.version),
);
