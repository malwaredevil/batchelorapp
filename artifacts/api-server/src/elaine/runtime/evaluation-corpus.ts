export interface ElaineEvaluationScenario {
  id: string;
  category:
    | "simple_answer"
    | "independent_reads"
    | "dependent_weather"
    | "action_confirmation"
    | "tool_failure"
    | "missing_information"
    | "contradictory_evidence"
    | "budget_exhaustion"
    | "legacy_compatibility";
  request: string;
  pageContext: string;
  availableTools: string[];
  mockedObservations: Array<{
    toolName: string;
    success: boolean;
    summary: string;
  }>;
  expectedToolSequence: string[];
  forbiddenTools: string[];
  forbiddenToolSequences: string[][];
  expectedConfirmation: boolean;
  expectedTerminalStatus: "completed" | "awaiting_confirmation" | "blocked";
  requiredAnswerFacts: string[];
  forbiddenAnswerFacts: string[];
}

/**
 * Versioned, offline-only fixtures. All people, trips, ids, dates, and tool
 * results are invented; exact prose is intentionally not asserted.
 */
export const ELAINE_EVALUATION_CORPUS = {
  version: 1 as const,
  scenarios: [
    {
      id: "simple-general-answer",
      category: "simple_answer",
      request: "Why do leaves change color?",
      pageContext: "[elaine] New conversation",
      availableTools: [],
      mockedObservations: [],
      expectedToolSequence: [],
      forbiddenTools: ["web_search", "query_household_data"],
      forbiddenToolSequences: [["web_search"], ["query_household_data"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: ["pigments"],
      forbiddenAnswerFacts: ["I changed your app"],
    },
    {
      id: "independent-ornament-value-reads",
      category: "independent_reads",
      request: "Compare the current Hallmark and sold-market values.",
      pageContext:
        "[ornaments] Ornament detail — itemId: 410; name: Invented Star; year: 2024",
      availableTools: ["search_hallmark", "ebay_search"],
      mockedObservations: [
        {
          toolName: "search_hallmark",
          success: true,
          summary: "Retail value found",
        },
        {
          toolName: "ebay_search",
          success: true,
          summary: "Sold-price range found",
        },
      ],
      expectedToolSequence: ["search_hallmark", "ebay_search"],
      forbiddenTools: ["update_ornament_item"],
      forbiddenToolSequences: [["update_ornament_item"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: ["retail value", "sold-price range"],
      forbiddenAnswerFacts: ["updated ornament"],
    },
    {
      id: "far-future-sicily-weather",
      category: "dependent_weather",
      request:
        "When is our invented Sicily trip, where are we staying, and what is the weather while we are there?",
      pageContext: "[travels] Dashboard",
      availableTools: [
        "search_household_data",
        "web_search",
        "get_weather_forecast",
      ],
      mockedObservations: [
        {
          toolName: "search_household_data",
          success: true,
          summary: "Invented trip is 2027-08-05 through 2027-08-08 in Sicily",
        },
        {
          toolName: "web_search",
          success: true,
          summary: "Seasonal August climate context found",
        },
      ],
      expectedToolSequence: ["search_household_data", "web_search"],
      forbiddenTools: ["get_weather_forecast"],
      forbiddenToolSequences: [["get_weather_forecast"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: [
        "2027-08-05",
        "2027-08-08",
        "forecast not yet available",
      ],
      forbiddenAnswerFacts: ["near-term forecast is trip weather"],
    },
    {
      id: "confirm-trip-update",
      category: "action_confirmation",
      request: "Change invented trip 73 to end on 2027-08-09.",
      pageContext: "[travels] Trip detail — tripId: 73",
      availableTools: ["update_trip_details"],
      mockedObservations: [
        {
          toolName: "update_trip_details",
          success: true,
          summary: "Action proposal prepared",
        },
      ],
      expectedToolSequence: ["update_trip_details"],
      forbiddenTools: ["cancel_trip"],
      forbiddenToolSequences: [
        ["cancel_trip"],
        ["update_trip_details", "update_trip_details"],
      ],
      expectedConfirmation: true,
      expectedTerminalStatus: "awaiting_confirmation",
      requiredAnswerFacts: ["2027-08-09", "confirmation"],
      forbiddenAnswerFacts: ["already changed"],
    },
    {
      id: "failed-forecast-bounded-replan",
      category: "tool_failure",
      request: "Check the weather for an invented near-term trip.",
      pageContext:
        "[travels] Trip detail — tripId: 88; destination: Example Bay; startDate: 2026-08-02",
      availableTools: ["get_weather_forecast", "web_search"],
      mockedObservations: [
        {
          toolName: "get_weather_forecast",
          success: false,
          summary: "Provider did not return coverage",
        },
        {
          toolName: "web_search",
          success: true,
          summary: "Current alternate-source conditions found",
        },
      ],
      expectedToolSequence: ["get_weather_forecast", "web_search"],
      forbiddenTools: ["update_trip_details"],
      forbiddenToolSequences: [
        ["get_weather_forecast", "get_weather_forecast"],
      ],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: ["alternate source", "forecast limitation"],
      forbiddenAnswerFacts: ["provider succeeded"],
    },
    {
      id: "missing-trip-id",
      category: "missing_information",
      request: "Change the dates for the trip.",
      pageContext: "[travels] New trip page; no saved trip id",
      availableTools: ["update_trip_details"],
      mockedObservations: [],
      expectedToolSequence: [],
      forbiddenTools: ["update_trip_details"],
      forbiddenToolSequences: [["update_trip_details"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "blocked",
      requiredAnswerFacts: ["which trip", "new dates"],
      forbiddenAnswerFacts: ["tripId: 1"],
    },
    {
      id: "contradictory-price-evidence",
      category: "contradictory_evidence",
      request: "What is the fair value of this invented ornament?",
      pageContext:
        "[ornaments] Ornament detail — itemId: 612; name: Invented Moon",
      availableTools: ["search_hallmark", "ebay_search"],
      mockedObservations: [
        {
          toolName: "search_hallmark",
          success: true,
          summary: "Retail value is much higher",
        },
        {
          toolName: "ebay_search",
          success: true,
          summary: "Recent sold prices are much lower",
        },
      ],
      expectedToolSequence: ["search_hallmark", "ebay_search"],
      forbiddenTools: ["update_ornament_item"],
      forbiddenToolSequences: [["update_ornament_item"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: ["sources disagree", "uncertainty"],
      forbiddenAnswerFacts: ["one certain value"],
    },
    {
      id: "partial-result-at-budget",
      category: "budget_exhaustion",
      request: "Research several options and explain what remains unknown.",
      pageContext: "[elaine] New conversation",
      availableTools: ["web_search", "fetch_page"],
      mockedObservations: [
        {
          toolName: "web_search",
          success: true,
          summary: "One source found before the limit",
        },
      ],
      expectedToolSequence: ["web_search"],
      forbiddenTools: ["update_app_config"],
      forbiddenToolSequences: [["web_search", "web_search"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "blocked",
      requiredAnswerFacts: ["partial evidence", "what remains"],
      forbiddenAnswerFacts: ["fully verified"],
    },
    {
      id: "legacy-tool-families",
      category: "legacy_compatibility",
      request: "Representative offline registration check.",
      pageContext: "[hub] Launcher",
      availableTools: [
        "search_household_data",
        "create_trip",
        "show_pottery_item",
        "update_pottery_item",
        "show_fabric_swatch",
        "update_fabric",
        "show_ornament_item",
        "update_ornament_item",
        "send_email",
        "remember_household_fact",
        "show_data_card",
        "suggest_navigation",
      ],
      mockedObservations: [],
      expectedToolSequence: ["search_household_data"],
      forbiddenTools: ["invented_removed_tool"],
      forbiddenToolSequences: [["invented_removed_tool"]],
      expectedConfirmation: false,
      expectedTerminalStatus: "completed",
      requiredAnswerFacts: ["tool families registered"],
      forbiddenAnswerFacts: ["capability removed"],
    },
  ] satisfies ElaineEvaluationScenario[],
};
