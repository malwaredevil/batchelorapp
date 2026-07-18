import type pg from "pg";
import { pool } from "../connection";
import { getMigrations, type Migration } from "./manifest";

const MIGRATION_LOCK_ID = 7_437_319_003;

type AppliedMigration = {
  version: number;
  checksum_sha256: string;
};

export type MigrationStatus = {
  expectedLatestVersion: number;
  appliedLatestVersion: number | null;
  pending: Migration[];
  checksumErrors: string[];
};

export async function ensureMigrationLedger(
  client: pg.PoolClient,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version bigint PRIMARY KEY,
      name text NOT NULL,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text,
      execution_ms integer,
      app_commit_sha text
    )
  `);
  await client.query(`ALTER TABLE app_schema_migrations ENABLE ROW LEVEL SECURITY`);
}

async function appliedMigrations(
  client: pg.PoolClient,
): Promise<Map<number, AppliedMigration>> {
  await ensureMigrationLedger(client);
  const result = await client.query<AppliedMigration>(
    `SELECT version::int AS version, checksum_sha256 FROM app_schema_migrations`,
  );
  return new Map(result.rows.map((row) => [row.version, row]));
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const migrations = getMigrations();
  const client = await pool.connect();
  try {
    const applied = await appliedMigrations(client);
    const checksumErrors: string[] = [];
    const pending: Migration[] = [];

    for (const migration of migrations) {
      const row = applied.get(migration.version);
      if (!row) {
        pending.push(migration);
        continue;
      }
      if (row.checksum_sha256 !== migration.checksumSha256) {
        checksumErrors.push(
          `Migration ${migration.version} checksum changed: ledger=${row.checksum_sha256} current=${migration.checksumSha256}`,
        );
      }
    }

    return {
      expectedLatestVersion: migrations.at(-1)?.version ?? 0,
      appliedLatestVersion:
        applied.size === 0 ? null : Math.max(...Array.from(applied.keys())),
      pending,
      checksumErrors,
    };
  } finally {
    client.release();
  }
}

export async function applyMigrations(): Promise<MigrationStatus> {
  const migrations = getMigrations();
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_ID]);
    const applied = await appliedMigrations(client);

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.checksum_sha256 !== migration.checksumSha256) {
          throw new Error(
            `Refusing to continue: migration ${migration.version} checksum changed after application.`,
          );
        }
        continue;
      }

      const started = Date.now();
      await client.query("BEGIN");
      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO app_schema_migrations
             (version, name, checksum_sha256, applied_by, execution_ms, app_commit_sha)
           VALUES ($1, $2, $3, current_user, $4, $5)`,
          [
            migration.version,
            migration.name,
            migration.checksumSha256,
            Date.now() - started,
            process.env.REPLIT_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
          ],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_ID]).catch(
      () => undefined,
    );
    client.release();
  }

  return getMigrationStatus();
}
