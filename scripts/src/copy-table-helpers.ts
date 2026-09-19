/**
 * Pure helpers shared by the backup and restore table copy implementations.
 *
 * Keep client creation and environment/database initialization in the
 * executable callers. Importing this module performs no database work.
 */

import type pg from "pg";

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
type QueryClient = Pick<pg.Client, "query">;

export type CopyTableOptions = {
  table: string;
  columns: string[];
  orderBy?: string;
  jsonbColumns?: string[];
  /** Trusted SQL expressions for columns absent from an older source DB. */
  missingColumnDefaults?: Record<string, string>;
};

/** Quote a single, deliberately limited PostgreSQL identifier. */
export function quoteIdentifier(identifier: string): string {
  if (
    identifier.length === 0 ||
    identifier.length > 63 ||
    !SIMPLE_IDENTIFIER.test(identifier)
  ) {
    throw new Error(
      `Invalid PostgreSQL identifier "${identifier}". Expected a simple identifier.`,
    );
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function buildSelectColumns(
  columns: string[],
  sourceColumns?: ReadonlySet<string>,
  missingColumnDefaults?: Readonly<Record<string, string>>,
  sourceTable?: string,
): string[] {
  return columns.map((column) => {
    const quotedColumn = quoteIdentifier(column);
    if (!sourceColumns || sourceColumns.has(column)) return quotedColumn;
    const fallback = missingColumnDefaults?.[column];
    if (!fallback) {
      const table = sourceTable ? ` "${sourceTable}"` : "";
      throw new Error(
        `Source table${table} is missing required column "${column}"`,
      );
    }
    return `${fallback} AS ${quotedColumn}`;
  });
}

export function normalizeCopyValue(value: unknown, isJsonb: boolean): unknown {
  if (value == null) return null;
  return isJsonb ? JSON.stringify(value) : value;
}

export function normalizeCopyRow(
  row: Record<string, unknown>,
  columns: string[],
  jsonbColumns: ReadonlySet<string>,
): unknown[] {
  return columns.map((column) =>
    normalizeCopyValue(row[column], jsonbColumns.has(column)),
  );
}

export async function copyTable(
  source: QueryClient,
  dest: QueryClient,
  opts: CopyTableOptions,
): Promise<number> {
  const table = quoteIdentifier(opts.table);
  const cols = opts.columns.map(quoteIdentifier);
  const orderBy = opts.orderBy ? quoteIdentifier(opts.orderBy) : undefined;
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
  if (rows.length === 0) return 0;

  await dest.query(`TRUNCATE ${table} CASCADE`);
  const jsonbCols = new Set(opts.jsonbColumns ?? []);
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const rowPlaceholders = batch.map((row, ri) => {
      const tuple = normalizeCopyRow(row, opts.columns, jsonbCols).map(
        (value, ci) => {
          values.push(value);
          return `$${ri * opts.columns.length + ci + 1}`;
        },
      );
      return `(${tuple.join(", ")})`;
    });
    try {
      await dest.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
        values,
      );
    } catch (err) {
      console.error(
        `[copyTable] batch failed on table="${opts.table}" rows ${i}–${i + batch.length - 1}`,
      );
      throw err;
    }
  }
  return rows.length;
}
