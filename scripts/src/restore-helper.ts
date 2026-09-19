import type pg from "pg";
import {
  buildSelectColumns,
  normalizeCopyRow,
  quoteIdentifier,
} from "./copy-table-helpers.js";

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
  // These values are SQL identifiers, not query parameters. Validate and quote
  // them before doing any database work; defaults remain trusted static SQL
  // expressions, while their aliases are still quoted by buildSelectColumns.
  const table = quoteIdentifier(opts.table);
  const orderBy = opts.orderBy ? quoteIdentifier(opts.orderBy) : undefined;
  const cols = opts.columns.map(quoteIdentifier);
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
  const order = orderBy ? ` ORDER BY ${orderBy}` : "";
  const { rows } = await source.query(
    `SELECT ${selectColumns.join(", ")} FROM ${table}${order}`,
  );
  const jsonbCols = new Set(opts.jsonbColumns ?? []);
  const placeholders = opts.columns
    .map((c, i) => (jsonbCols.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
    .join(", ");
  for (const row of rows) {
    const values = normalizeCopyRow(row, opts.columns, jsonbCols);
    await dest.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return rows.length;
}
