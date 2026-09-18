/**
 * Pure helpers shared by the backup and restore table copy implementations.
 *
 * Keep database I/O (and the direction-specific truncate/batching policy) in
 * the callers.  These functions only describe a source SELECT and normalize
 * values for pg query parameters.
 */

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
