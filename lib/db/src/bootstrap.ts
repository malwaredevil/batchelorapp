/**
 * Idempotent schema bootstrap CLI for the merged Batchelor monorepo (pottery +
 * quilting). SAFE replacement for `drizzle-kit push --force`.
 *
 * The actual DDL now runs through the ordered migration ledger. The first
 * migration applies the historical additive `schema-statements` baseline; later
 * numbered migrations layer reviewed grants, jobs, and observability schema.
 *
 * Run via `pnpm --filter @workspace/db run bootstrap` and from post-merge.sh.
 */
import { applyMigrations } from "./migrations";

async function main(): Promise<void> {
  const status = await applyMigrations();
  console.log(
    `[bootstrap] done — latest=${status.appliedLatestVersion ?? "none"} pending=${status.pending.length}`,
  );
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
