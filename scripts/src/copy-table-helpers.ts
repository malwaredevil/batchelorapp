/**
 * Pure helpers shared by the backup and restore table copy implementations.
 *
 * Keep database I/O (and the direction-specific truncate/batching policy) in
 * the callers.  These functions only describe a source SELECT and normalize
 * values for pg query parameters.
 */

export function buildSelectColumns(
  columns: string[],
  sourceColumns?: ReadonlySet<string>,
  missingColumnDefaults?: Readonly<Record<string, string>>,
  sourceTable?: string,
): string[] {
  return columns.map((column) => {
    if (!sourceColumns || sourceColumns.has(column)) return column;
    const fallback = missingColumnDefaults?.[column];
    if (!fallback) {
      const table = sourceTable ? ` "${sourceTable}"` : "";
      throw new Error(
        `Source table${table} is missing required column "${column}"`,
      );
    }
    return `${fallback} AS ${column}`;
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
