import {
  ORNAMENT_MAINTENANCE_REASONS,
  ornamentMaintenanceReasonLabels,
  type OrnamentMaintenanceReason,
} from "@workspace/ornaments-shared";

export {
  ORNAMENT_MAINTENANCE_REASONS,
  ornamentMaintenanceReasonLabels,
  type OrnamentMaintenanceReason,
};

export function getOrnamentMaintenanceRepairHref(
  id: number,
  reasons: readonly string[],
  reason: string,
): string {
  const missing = encodeURIComponent(reasons.join(","));
  if (reason === "embedding") {
    return `/ornaments/ornament/${id}?repair=photo&missing=${missing}`;
  }
  return `/ornaments/ornament/${id}?edit=1&focus=${encodeURIComponent(reason)}&missing=${missing}`;
}

export function parseOrnamentMaintenanceReasons(
  search: string,
): OrnamentMaintenanceReason[] {
  const requested =
    new URLSearchParams(search).get("missing")?.split(",") ?? [];
  return requested.filter((reason): reason is OrnamentMaintenanceReason =>
    ORNAMENT_MAINTENANCE_REASONS.includes(reason as OrnamentMaintenanceReason),
  );
}
