/**
 * Explicit, reviewed destructive database migrations.
 *
 * `schema-statements.ts` remains additive-only because it runs on every boot.
 * Entries here are applied through the startup migration ledger, so each
 * destructive change runs once against an existing database.
 */
const REMOVE_ORNAMENT_CONDITION = {
  name: "remove-ornament-condition",
  sql: `ALTER TABLE ornaments_items DROP COLUMN IF EXISTS condition`,
} as const;

export const DESTRUCTIVE_MIGRATIONS = [REMOVE_ORNAMENT_CONDITION] as const;
