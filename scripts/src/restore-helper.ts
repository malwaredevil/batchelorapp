import type pg from "pg";
import { buildSelectColumns, normalizeCopyRow } from "./copy-table-helpers.js";

type RestoreClient = Pick<pg.Client, "query">;

export type CopyTableOptions = {
  table: string;
  columns: string[];
  orderBy?: string;
  jsonbColumns?: string[];
  /** Expressions used when a column is absent from an older backup table. */
  missingColumnDefaults?: Record<string, string>;
};

export async function copyTable(
  source: RestoreClient,
  dest: RestoreClient,
  opts: CopyTableOptions,
): Promise<number> {
  // Backups are durable snapshots and must never be migrated in place just to
  // restore them. Build the SELECT from the source's current shape instead.
  const { rows: columnRows } = await source.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [opts.table],
  );
  const sourceColumns = new Set(
    columnRows.map((row: { column_name: string }) => row.column_name),
  );
  const selectColumns = buildSelectColumns(
    opts.columns,
    sourceColumns,
    opts.missingColumnDefaults,
    opts.table,
  );
  const cols = opts.columns.join(", ");
  const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : "";
  const { rows } = await source.query(
    `SELECT ${selectColumns.join(", ")} FROM ${opts.table}${order}`,
  );
  const jsonbCols = new Set(opts.jsonbColumns ?? []);
  const placeholders = opts.columns
    .map((c, i) => (jsonbCols.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
    .join(", ");
  for (const row of rows) {
    const values = normalizeCopyRow(row, opts.columns, jsonbCols);
    await dest.query(
      `INSERT INTO ${opts.table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return rows.length;
}
