/**
 * Read/helper tools whose results must be returned to the model before it can
 * write a grounded answer. Keep this list aligned with the hard-tool executor
 * in Elaine's main streaming chat route.
 */
export const MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS: Readonly<
  Record<string, string>
> = {
  browse_pottery_collection: "reading a page of your pottery collection",
  browse_fabric_collection: "reading a page of your fabric collection",
  browse_ornament_collection: "reading a page of your ornament collection",
  search_household_data: "searching your collection",
  show_trip_card: "looking up that trip",
  show_pottery_item: "looking up that pottery piece",
  show_fabric_swatch: "looking up that fabric",
  show_ornament_item: "looking up that ornament",
  web_search: "searching the web",
  ebay_search: "checking eBay sold listings",
  search_hallmark: "searching Hallmark.com",
  search_flights: "checking flight prices",
  fetch_page: "reading that page",
  consult_experts: "checking in with a couple of experts",
  get_weather_forecast: "checking the forecast",
  find_nearby_places: "looking up places",
  get_route_info: "checking travel times",
  get_air_quality: "checking air quality",
  get_pollen_forecast: "checking pollen levels",
  calculate_yardage: "calculating yardage",
  query_household_data: "checking household data",
  lookup_product_barcode: "looking up that barcode",
  summarize_inbox: "reading your inbox",
  find_emails_about_topic: "searching your email",
  get_email_detail: "reading that email",
  list_notes: "reading household notes",
  get_note: "reading that note",
  list_notifications: "checking your notifications",
  get_notification_counts: "counting your notifications",
  get_notification_preferences: "checking notification preferences",
  list_memories: "checking Elaine's memory",
  list_elaine_tasks: "checking background tasks",
  get_elaine_task: "checking that background task",
  remember_household_fact: "saving that memory",
  remember_lesson: "noting that lesson",
  search_trip_documents: "searching trip documents",
  show_destination_card: "preparing that destination",
  get_exchange_rate: "checking exchange rates",
  suggest_clothing_layers: "preparing clothing recommendations",
  discover_app_operations: "checking available app capabilities",
  read_app_operation: "checking the Batchelor App",
  check_integrations_health: "checking connected services",
  get_owner_settings: "checking current settings",
  list_sentry_issues: "checking Sentry for errors",
  list_elaine_suggestions: "reviewing Elaine Suggestions",
  save_elaine_suggestion: "saving an Elaine Suggestion",
  get_recent_elaine_diagnostics:
    "checking which Elaine steps completed or failed",
  generate_document: "creating that document",
  list_reminders: "checking your reminders",
  list_scheduled_contacts: "checking your scheduled contacts",
  list_contact_channels: "checking the contact's available channels",
  analyze_pottery_photo: "analyzing that pottery photo",
  analyze_fabric_photo: "analyzing that fabric photo",
  analyze_ornament_photo: "analyzing that ornament photo",
  lookup_book_value: "looking up that book value",
  lookup_retail_value: "looking up that retail value",
  get_recent_communication_receipts: "checking recent communication receipts",
};

export const MODEL_VISIBLE_HARD_TOOL_NAMES = new Set<string>(
  Object.keys(MODEL_VISIBLE_HARD_TOOL_STATUS_LABELS),
);

export const SPECIALIZED_CURRENT_TOOL_NAMES = new Set<string>([
  "ebay_search",
  "get_air_quality",
  "get_exchange_rate",
  "get_pollen_forecast",
  "get_weather_forecast",
  "lookup_product_barcode",
  "search_flights",
  "search_hallmark",
]);
