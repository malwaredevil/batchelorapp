import { describe, expect, it } from "vitest";
import {
  MODEL_VISIBLE_HARD_TOOL_NAMES,
  MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS,
} from "./model-tool-policy";
import { ELAINE_TOOL_POLICIES } from "../capability-registry";

const IMPLEMENTED_MAIN_CHAT_HARD_TOOLS = [
  "discover_app_operations",
  "read_app_operation",
  "search_household_data",
  "show_trip_card",
  "show_pottery_item",
  "show_fabric_swatch",
  "show_ornament_item",
  "web_search",
  "ebay_search",
  "search_hallmark",
  "search_flights",
  "fetch_page",
  "consult_experts",
  "get_weather_forecast",
  "find_nearby_places",
  "get_route_info",
  "get_air_quality",
  "get_pollen_forecast",
  "calculate_yardage",
  "query_household_data",
  "lookup_product_barcode",
  "summarize_inbox",
  "find_emails_about_topic",
  "get_email_detail",
  "list_notes",
  "get_note",
  "list_reminders",
  "list_notifications",
  "get_notification_counts",
  "get_notification_preferences",
  "list_memories",
  "list_elaine_tasks",
  "get_elaine_task",
  "remember_household_fact",
  "search_trip_documents",
  "show_destination_card",
  "get_exchange_rate",
  "suggest_clothing_layers",
  "check_integrations_health",
  "generate_document",
].sort();

describe("model-visible hard-tool policy", () => {
  it("keeps every implemented main-chat hard tool in the dispatch set", () => {
    expect([...MODEL_VISIBLE_HARD_TOOL_NAMES].sort()).toEqual(
      IMPLEMENTED_MAIN_CHAT_HARD_TOOLS,
    );
    expect(
      [...MODEL_VISIBLE_HARD_TOOL_NAMES].every(
        (name) => MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS[name],
      ),
    ).toBe(true);
    const registeredToolNames = new Set(
      Object.values(ELAINE_TOOL_POLICIES).map((policy) => policy.toolName),
    );
    expect(
      [...MODEL_VISIBLE_HARD_TOOL_NAMES].filter(
        (name) => !registeredToolNames.has(name),
      ),
    ).toEqual([]);
  });

  it("does not treat actions, navigation, or mode changes as hard reads", () => {
    expect(MODEL_VISIBLE_HARD_TOOL_NAMES.has("update_trip")).toBe(false);
    expect(MODEL_VISIBLE_HARD_TOOL_NAMES.has("suggest_navigation")).toBe(false);
    expect(
      MODEL_VISIBLE_HARD_TOOL_NAMES.has("set_action_confirmation_mode"),
    ).toBe(false);
  });
});
