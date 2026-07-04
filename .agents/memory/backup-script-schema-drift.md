---
name: Backup/restore scripts must be manually kept in sync with schema
description: The Supabase<->Replit backup and restore scripts hardcode table/column lists and silently exclude tables added after the script was last written — check them whenever a new app or table set is added.
---

The Supabase-to-Replit backup (`scripts/src/backup-to-replit.ts`) and restore
(`scripts/src/restore-from-replit.ts`) scripts explicitly list every table and
column they copy. They do **not** introspect the schema, so a table added
after the script was last touched is silently skipped — the backup succeeds
(exit 0) and reports row counts, but the new table never appears in the
summary, giving false confidence that disaster recovery is covered.

**Why:** these scripts predated the Travels app. When Travels shipped
(6 tables: trips, trip_documents, trip_photos, wishlist, reminders,
reminder_alert_log) plus 3 new `app_users` columns
(`hub_widget_ids`, `hub_weather_config`, `travels_reminder_email`), nobody
updated the backup/restore scripts. Real production data (17 trips, 27
wishlist items, reminders) had zero disaster-recovery coverage for an unknown
period, and the restore script's `app_users` column list was also stale/
incomplete.

**How to apply — three things to update for every new table/column:**

1. **DEST_SCHEMA** (`backup-to-replit.ts` const at the top): add `CREATE TABLE IF NOT EXISTS`
   for new tables. For **new columns on existing tables**, add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   statements AFTER the CREATE TABLE block — the Replit DB already has the table so `CREATE TABLE IF NOT EXISTS`
   won't add new columns; only `ALTER TABLE` will. Forgetting this causes a `42703` (column not found)
   error on the `INSERT INTO` inside `copyTable()`.

2. **`copyTable()` calls**: add new column names to the `columns` array for the
   relevant table in both `backup-to-replit.ts` and `restore-from-replit.ts`.

3. **TRUNCATE list** (restore script only): add new tables to the TRUNCATE
   statement before the `travels_trips` cascade so FK constraints don't block.

Don't trust a green backup run alone; confirm the new table's name actually
appears in the printed row-count summary. If the source table has data and the
DEST_SCHEMA is missing, the TRUNCATE inside `copyTable()` will throw `42P01`
(relation not found) — that is the specific failure mode.
