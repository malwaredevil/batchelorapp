#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Safe, idempotent schema bootstrap — CREATE TABLE IF NOT EXISTS only.
# Never run drizzle-kit push --force: the Supabase database is shared by
# both pottery and quilting apps, and a force push would silently drop
# tables belonging to the other app.
pnpm --filter @workspace/db run bootstrap

# Snapshot Supabase (all pottery + quilting tables) → Replit built-in PostgreSQL.
# Non-fatal: a backup failure does not block the merge, but the warning is
# visible in the post-merge log so it can be investigated and run manually.
echo "Running Supabase → Replit DB snapshot backup..."
pnpm --filter @workspace/scripts run backup-to-replit \
  && echo "✓ Backup complete" \
  || echo "⚠️  Backup skipped or failed — check PG* secrets and run manually if needed"
