export const ELAINE_TOOL_FAMILY_SENTINELS = {
  travels: ["search_household_data", "create_trip"],
  pottery: ["show_pottery_item", "update_pottery_item"],
  quilting: ["show_fabric_swatch", "update_fabric"],
  ornaments: ["show_ornament_item", "update_ornament_item"],
  office: ["send_email"],
  memory: ["remember_household_fact"],
  widgets: ["show_data_card"],
  navigation: ["suggest_navigation"],
} as const;

export function assertElaineToolFamilyCoverage(toolNames: Iterable<string>) {
  const available = new Set(toolNames);
  const missing = Object.entries(ELAINE_TOOL_FAMILY_SENTINELS).flatMap(
    ([family, sentinels]) =>
      sentinels
        .filter((toolName) => !available.has(toolName))
        .map((toolName) => `${family}:${toolName}`),
  );
  if (missing.length > 0) {
    throw new Error(
      `Elaine planner catalog lost required tool-family coverage: ${missing.join(", ")}`,
    );
  }
}
