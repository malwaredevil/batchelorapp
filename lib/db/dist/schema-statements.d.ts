/**
 * SINGLE SOURCE OF DDL TRUTH for the merged Batchelor monorepo (pottery +
 * quilting). Consumed by BOTH `bootstrap.ts` (the CLI bootstrap, run via
 * `pnpm --filter @workspace/db run bootstrap` and in post-merge.sh) AND the
 * api-server startup self-healing migration. Keeping one list prevents a
 * split-brain where one entrypoint creates only a subset of tables.
 *
 * SAFE replacement for `drizzle-kit push --force`. The Supabase DB is SHARED by
 * both apps and `app_users` / `password_reset_tokens` are shared between them.
 * `drizzle-kit push --force` introspects EVERY table and auto-confirms
 * destructive DDL, so on this shared DB it tries to DROP the other app's tables
 * and wipes data on every publish. `tablesFilter` does not reliably stop this —
 * so force push is permanently banned. These statements are all additive and
 * idempotent: `CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN
 * IF NOT EXISTS`, and `ENABLE ROW LEVEL SECURITY`. They NEVER drop or alter
 * existing tables, columns, or data.
 *
 * Keep these statements in sync with the drizzle schema — ADDITIVE changes only.
 */
export declare const STATEMENTS: string[];
//# sourceMappingURL=schema-statements.d.ts.map