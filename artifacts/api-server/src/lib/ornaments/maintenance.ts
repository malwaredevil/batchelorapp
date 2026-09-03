export const ORNAMENT_MAINTENANCE_REASONS = [
  "embedding",
  "seriesOrCollection",
  "year",
] as const;

export type OrnamentMaintenanceReason =
  (typeof ORNAMENT_MAINTENANCE_REASONS)[number];

export interface OrnamentMaintenanceFields {
  embedding: unknown;
  seriesOrCollection: string | null;
  year: number | null;
}

export function getMissingOrnamentMaintenanceFields(
  item: OrnamentMaintenanceFields,
): OrnamentMaintenanceReason[] {
  const missingFields: OrnamentMaintenanceReason[] = [];
  if (item.embedding == null) missingFields.push("embedding");
  if (!item.seriesOrCollection?.trim()) {
    missingFields.push("seriesOrCollection");
  }
  if (item.year == null) missingFields.push("year");
  return missingFields;
}

export function getOrnamentMaintenanceRecommendation(
  reasons: OrnamentMaintenanceReason[],
): string {
  const needsIdentity =
    reasons.includes("seriesOrCollection") || reasons.includes("year");
  if (needsIdentity && reasons.includes("embedding")) {
    return "Add a clear photo of the box front or tag, including the series name and printed year, then refresh.";
  }
  if (needsIdentity) {
    return "Add a clear photo of the box front or tag showing the series name and printed year, then refresh.";
  }
  return "Refresh with a clear photo of the ornament or box so it can be indexed for search.";
}

export function hasCompleteOrnamentMaintenanceData(
  item: OrnamentMaintenanceFields,
): boolean {
  return getMissingOrnamentMaintenanceFields(item).length === 0;
}
