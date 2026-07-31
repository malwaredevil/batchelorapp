export interface ElaineContextListOptions<T> {
  label: string;
  formatItem: (item: T) => string;
  limit?: number;
  emptyLabel?: string;
}

export interface ElaineContextEntityOptions {
  entity: string;
  id: string | number;
  label: string;
  details?: Array<string | null | undefined | false>;
}

/**
 * Formats a bounded list for Elaine's page context. Domain pages provide only
 * the labels and field-specific details; truncation, empty-state handling, and
 * separators stay consistent across the app.
 */
export function formatElaineContextList<T>(
  items: readonly T[],
  {
    label,
    formatItem,
    limit = 50,
    emptyLabel = "none",
  }: ElaineContextListOptions<T>,
): string {
  const visible = items.slice(0, limit);
  const rendered = visible.map(formatItem).join("; ") || emptyLabel;
  const omitted = items.length - visible.length;
  return `${label}: ${rendered}${omitted > 0 ? `; ${omitted} more not shown` : ""}`;
}

/**
 * Makes entity identifiers unambiguous so Elaine can invoke the matching app
 * operation without guessing an ID.
 */
export function formatElaineContextEntity({
  entity,
  id,
  label,
  details = [],
}: ElaineContextEntityOptions): string {
  const suffix = details.filter(Boolean).join(", ");
  return `${entity}Id: ${id} — ${JSON.stringify(label)}${suffix ? `, ${suffix}` : ""}`;
}
