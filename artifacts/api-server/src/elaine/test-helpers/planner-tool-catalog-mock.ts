/**
 * Shared factory for `vi.mock("./planner-tool-catalog", ...)` in Elaine test
 * files.
 *
 * Usage (no overrides — most tests):
 *
 *   import { buildPlannerToolCatalogMock } from "./test-helpers/planner-tool-catalog-mock";
 *   vi.mock("./planner-tool-catalog", () => buildPlannerToolCatalogMock());
 *
 * Usage (with test-specific overrides):
 *
 *   vi.mock("./planner-tool-catalog", () =>
 *     buildPlannerToolCatalogMock({
 *       ACTION_TOOL_NAMES: new Set(["create_trip"]),
 *       SOFT_TOOLS: [{ type: "function", function: { name: "list_reminders", parameters: {} } }],
 *     }),
 *   );
 *
 * When a new export is added to planner-tool-catalog.ts:
 *   1. Add the export to PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in
 *      scripts/src/check-domain-composition.ts.
 *   2. Add the matching key+default-value to PLANNER_TOOL_CATALOG_MOCK_DEFAULTS
 *      below.
 *   That's the only two-file edit required — no per-test-file changes needed.
 */

/** Minimal shape for a tool entry in SOFT_TOOLS / ACTION_TOOLS arrays. */
export interface MockToolEntry {
  type: string;
  function: {
    name: string;
    parameters: Record<string, unknown>;
  };
}

/** All properties the factory can produce (and that callers can override). */
export interface PlannerToolCatalogMockShape {
  ACTION_CONFIRMATION_MODES: readonly string[];
  ACTION_TOOL_NAMES: Set<string>;
  ACTION_TOOLS: MockToolEntry[];
  ANALYZE_FABRIC_PHOTO_TOOL_NAME: string;
  ANALYZE_ORNAMENT_PHOTO_TOOL_NAME: string;
  ANALYZE_POTTERY_PHOTO_TOOL_NAME: string;
  CALCULATE_YARDAGE_TOOL_NAME: string;
  CHECK_INTEGRATIONS_HEALTH_TOOL_NAME: string;
  CONSULT_EXPERTS_TOOL_NAME: string;
  EBAY_SEARCH_TOOL_NAME: string;
  ELAINE_PLANNER_TOOL_CATALOG: unknown[];
  FETCH_PAGE_TOOL_NAME: string;
  FIND_NEARBY_PLACES_TOOL_NAME: string;
  GENERATE_DOCUMENT_TOOL_NAME: string;
  GET_AIR_QUALITY_TOOL_NAME: string;
  GET_EXCHANGE_RATE_TOOL_NAME: string;
  GET_POLLEN_FORECAST_TOOL_NAME: string;
  GET_ROUTE_INFO_TOOL_NAME: string;
  GET_WEATHER_TOOL_NAME: string;
  LOOKUP_BARCODE_TOOL_NAME: string;
  LOOKUP_BOOK_VALUE_TOOL_NAME: string;
  NAVIGATE_TOOL_NAME: string;
  QUERY_HOUSEHOLD_TOOL_NAME: string;
  RECORD_LESSON_TOOL_NAME: string;
  REMEMBER_TOOL_NAME: string;
  SEARCH_FLIGHTS_TOOL_NAME: string;
  SEARCH_HALLMARK_TOOL_NAME: string;
  SEARCH_HOUSEHOLD_TOOL_NAME: string;
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME: string;
  SET_MODE_TOOL_NAME: string;
  SHOW_DATA_CARD_TOOL_NAME: string;
  SHOW_DESTINATION_CARD_TOOL_NAME: string;
  SHOW_FABRIC_SWATCH_TOOL_NAME: string;
  SHOW_ORNAMENT_ITEM_TOOL_NAME: string;
  SHOW_POTTERY_ITEM_TOOL_NAME: string;
  SHOW_TRIP_CARD_TOOL_NAME: string;
  SOFT_TOOLS: MockToolEntry[];
  SOFT_TOOLS_EXTRA: MockToolEntry[];
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME: string;
  TRIP_STATUS_ENUM: readonly string[];
  WEB_SEARCH_TOOL_NAME: string;
}

/**
 * Canonical default values for every required planner-tool-catalog export.
 *
 * Exported as a plain named const so the check-domain-composition guardrail
 * can validate both key presence and string values against THIS object
 * specifically, rather than the full file source (which also includes the
 * TypeScript interface above and would produce false-positive matches).
 *
 * String values must stay in sync with PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS
 * in scripts/src/check-domain-composition.ts — the guardrail catches drift.
 */
export const PLANNER_TOOL_CATALOG_MOCK_DEFAULTS: PlannerToolCatalogMockShape = {
  ACTION_CONFIRMATION_MODES: ["one_by_one", "all_at_once", "auto_run"],
  ACTION_TOOL_NAMES: new Set<string>(),
  ACTION_TOOLS: [],
  ANALYZE_FABRIC_PHOTO_TOOL_NAME: "analyze_fabric_photo",
  ANALYZE_ORNAMENT_PHOTO_TOOL_NAME: "analyze_ornament_photo",
  ANALYZE_POTTERY_PHOTO_TOOL_NAME: "analyze_pottery_photo",
  CALCULATE_YARDAGE_TOOL_NAME: "calculate_yardage",
  CHECK_INTEGRATIONS_HEALTH_TOOL_NAME: "check_integrations_health",
  CONSULT_EXPERTS_TOOL_NAME: "consult_experts",
  EBAY_SEARCH_TOOL_NAME: "ebay_search",
  ELAINE_PLANNER_TOOL_CATALOG: [],
  FETCH_PAGE_TOOL_NAME: "fetch_page",
  FIND_NEARBY_PLACES_TOOL_NAME: "find_nearby_places",
  GENERATE_DOCUMENT_TOOL_NAME: "generate_document",
  GET_AIR_QUALITY_TOOL_NAME: "get_air_quality",
  GET_EXCHANGE_RATE_TOOL_NAME: "get_exchange_rate",
  GET_POLLEN_FORECAST_TOOL_NAME: "get_pollen_forecast",
  GET_ROUTE_INFO_TOOL_NAME: "get_route_info",
  GET_WEATHER_TOOL_NAME: "get_weather_forecast",
  LOOKUP_BARCODE_TOOL_NAME: "lookup_product_barcode",
  LOOKUP_BOOK_VALUE_TOOL_NAME: "lookup_book_value",
  NAVIGATE_TOOL_NAME: "suggest_navigation",
  QUERY_HOUSEHOLD_TOOL_NAME: "query_household_data",
  RECORD_LESSON_TOOL_NAME: "remember_lesson",
  REMEMBER_TOOL_NAME: "remember_household_fact",
  SEARCH_FLIGHTS_TOOL_NAME: "search_flights",
  SEARCH_HALLMARK_TOOL_NAME: "search_hallmark",
  SEARCH_HOUSEHOLD_TOOL_NAME: "search_household_data",
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME: "search_trip_documents",
  SET_MODE_TOOL_NAME: "set_action_confirmation_mode",
  SHOW_DATA_CARD_TOOL_NAME: "show_data_card",
  SHOW_DESTINATION_CARD_TOOL_NAME: "show_destination_card",
  SHOW_FABRIC_SWATCH_TOOL_NAME: "show_fabric_swatch",
  SHOW_ORNAMENT_ITEM_TOOL_NAME: "show_ornament_item",
  SHOW_POTTERY_ITEM_TOOL_NAME: "show_pottery_item",
  SHOW_TRIP_CARD_TOOL_NAME: "show_trip_card",
  SOFT_TOOLS: [],
  SOFT_TOOLS_EXTRA: [],
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME: "suggest_clothing_layers",
  TRIP_STATUS_ENUM: ["planning", "active", "completed", "cancelled"],
  WEB_SEARCH_TOOL_NAME: "web_search",
};

/**
 * Returns the canonical planner-tool-catalog mock object, with optional
 * per-test overrides spread on top.
 *
 * String values match PLANNER_TOOL_CATALOG_REQUIRED_EXPORTS in
 * scripts/src/check-domain-composition.ts, which is the guardrail that keeps
 * them in sync with planner-tool-catalog.ts.
 */
export function buildPlannerToolCatalogMock(
  overrides?: Partial<PlannerToolCatalogMockShape> & Record<string, unknown>,
): PlannerToolCatalogMockShape & Record<string, unknown> {
  return { ...PLANNER_TOOL_CATALOG_MOCK_DEFAULTS, ...overrides };
}
