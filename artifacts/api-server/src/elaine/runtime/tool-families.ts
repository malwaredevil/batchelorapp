export const ELAINE_TOOL_FAMILY_SENTINELS = {
  travels: ["search_household_data", "create_trip"],
  pottery: ["show_pottery_item", "update_pottery_item"],
  quilting: ["show_fabric_swatch", "update_fabric"],
  ornaments: ["show_ornament_item", "update_ornament_item"],
  office: [
    "send_email",
    "summarize_inbox",
    "list_notes",
    "create_note",
    "create_reminder",
    "list_reminders",
    "snooze_reminder",
  ],
  notifications: [
    "list_notifications",
    "get_notification_counts",
    "update_notification_state",
  ],
  memory: ["remember_household_fact"],
  widgets: ["show_data_card"],
  navigation: ["suggest_navigation"],
  admin: [
    "check_integrations_health",
    "list_sentry_issues",
    "get_owner_settings",
  ],
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
