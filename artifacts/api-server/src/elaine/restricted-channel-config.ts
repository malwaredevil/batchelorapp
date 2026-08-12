/**
 * Restricted-channel tool configuration for Elaine.
 *
 * "Restricted channels" are SMS/voice (AgentPhone), inbound email (Resend),
 * and Slack — contexts where there is no live browser UI and identity is
 * verified by the channel itself rather than a session cookie.
 *
 * Kept in its own module so the coverage test can import these constants
 * independently of the full index.ts route tree (which pulls in Express,
 * Drizzle, and every service client at import time).
 *
 * Each list is exported as a readonly array (the source of truth for
 * duplicate detection) and then derived into a Set for O(1) lookups at
 * runtime.  The coverage test asserts `array.length === new Set(array).size`
 * against the arrays, which a Set constructor would silently swallow.
 */

import {
  CALCULATE_YARDAGE_TOOL_NAME,
  CONSULT_EXPERTS_TOOL_NAME,
  EBAY_SEARCH_TOOL_NAME,
  FETCH_PAGE_TOOL_NAME,
  FIND_NEARBY_PLACES_TOOL_NAME,
  GENERATE_DOCUMENT_TOOL_NAME,
  GET_AIR_QUALITY_TOOL_NAME,
  GET_EXCHANGE_RATE_TOOL_NAME,
  GET_POLLEN_FORECAST_TOOL_NAME,
  GET_ROUTE_INFO_TOOL_NAME,
  GET_WEATHER_TOOL_NAME,
  LOOKUP_BARCODE_TOOL_NAME,
  QUERY_HOUSEHOLD_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  SEARCH_FLIGHTS_TOOL_NAME,
  SEARCH_HALLMARK_TOOL_NAME,
  SEARCH_HOUSEHOLD_TOOL_NAME,
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME,
  SHOW_DATA_CARD_TOOL_NAME,
  SHOW_FABRIC_SWATCH_TOOL_NAME,
  SHOW_ORNAMENT_ITEM_TOOL_NAME,
  SHOW_POTTERY_ITEM_TOOL_NAME,
  SHOW_TRIP_CARD_TOOL_NAME,
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} from "./planner-tool-catalog";
import {
  LIST_CONTACT_CHANNELS_TOOL_NAME,
  LIST_SCHEDULED_CONTACTS_TOOL_NAME,
} from "./communication-actions";
import { LIST_ELAINE_MEMORIES_TOOL_NAME } from "./universal-read-tools";
import { LIST_REMINDERS_TOOL_NAME } from "./reminder-actions";

/**
 * Source array for the read/utility "soft" tools offered to the restricted
 * channels.  Exported as a readonly array so the coverage test can detect
 * source-level duplicates (a Set constructor silently deduplicates them).
 *
 * Every name here must also appear in SOFT_TOOLS or SOFT_TOOLS_EXTRA from
 * planner-tool-catalog.ts, and the name's capability policy must include at
 * least one restricted channel — the restricted-channel-coverage.test.ts file
 * enforces both constraints in CI.
 *
 * Deliberately excludes:
 * - SET_MODE_TOOL_NAME (restricted channels are always auto-run, no
 *   confirmation modes to switch)
 * - SHOW_DESTINATION_CARD (visual widget, no-op without a screen)
 * - NAVIGATE_TOOL_NAME (replaced by RESTRICTED_NAVIGATE_TOOL / share_app_link)
 */
export const RESTRICTED_SOFT_TOOL_NAMES_SOURCE: readonly string[] = [
  SEARCH_HOUSEHOLD_TOOL_NAME,
  SHOW_TRIP_CARD_TOOL_NAME,
  SHOW_POTTERY_ITEM_TOOL_NAME,
  SHOW_FABRIC_SWATCH_TOOL_NAME,
  SHOW_ORNAMENT_ITEM_TOOL_NAME,
  QUERY_HOUSEHOLD_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  EBAY_SEARCH_TOOL_NAME,
  SEARCH_HALLMARK_TOOL_NAME,
  SEARCH_FLIGHTS_TOOL_NAME,
  FETCH_PAGE_TOOL_NAME,
  GET_EXCHANGE_RATE_TOOL_NAME,
  SEARCH_TRIP_DOCUMENTS_TOOL_NAME,
  GET_WEATHER_TOOL_NAME,
  FIND_NEARBY_PLACES_TOOL_NAME,
  GET_ROUTE_INFO_TOOL_NAME,
  GET_AIR_QUALITY_TOOL_NAME,
  GET_POLLEN_FORECAST_TOOL_NAME,
  CONSULT_EXPERTS_TOOL_NAME,
  CALCULATE_YARDAGE_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  LIST_ELAINE_MEMORIES_TOOL_NAME,
  SHOW_DATA_CARD_TOOL_NAME,
  LOOKUP_BARCODE_TOOL_NAME,
  LIST_SCHEDULED_CONTACTS_TOOL_NAME,
  LIST_CONTACT_CHANNELS_TOOL_NAME,
  GENERATE_DOCUMENT_TOOL_NAME,
  SUGGEST_CLOTHING_LAYERS_TOOL_NAME,
  LIST_REMINDERS_TOOL_NAME,
];

/** Runtime Set derived from the source array — use for O(1) membership tests. */
export const RESTRICTED_SOFT_TOOL_NAMES = new Set<string>(
  RESTRICTED_SOFT_TOOL_NAMES_SOURCE,
);

/**
 * Soft tools in RESTRICTED_SOFT_TOOL_NAMES that are handled by the caller
 * (runRestrictedElaineTurn in index.ts) with an explicit `else if` branch
 * BEFORE the fallthrough `else if (RESTRICTED_SOFT_TOOL_NAMES.has(name))`
 * block that dispatches to executeRestrictedSoftTool.
 *
 * These names are excluded from the "handler branch coverage" test because
 * they never actually reach executeRestrictedSoftTool at runtime.  When a new
 * name is added to this set, it must have a matching `else if (name === …)`
 * branch inside the runRestrictedElaineTurn tool-dispatch loop — the test in
 * restricted-channel-coverage.test.ts enforces this.
 */
export const RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE: readonly string[] =
  [
    SHOW_TRIP_CARD_TOOL_NAME,
    SHOW_POTTERY_ITEM_TOOL_NAME,
    SHOW_FABRIC_SWATCH_TOOL_NAME,
    SHOW_ORNAMENT_ITEM_TOOL_NAME,
    SHOW_DATA_CARD_TOOL_NAME,
    GENERATE_DOCUMENT_TOOL_NAME,
    // list_memories: dispatched via executeUniversalReadTool in
    // runRestrictedElaineTurn before the fallthrough to executeRestrictedSoftTool.
    LIST_ELAINE_MEMORIES_TOOL_NAME,
  ];

/** Runtime Set derived from the source array — use for O(1) membership tests. */
export const RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED = new Set<string>(
  RESTRICTED_SOFT_TOOL_NAMES_CALLER_HANDLED_SOURCE,
);

/**
 * Source array for action tools excluded from the restricted-channel allowlist
 * (AGENTPHONE_ACTION_TOOLS).  These are web-only because they require either
 * the in-app confirmation UI, exact IDs visible on screen, or the delivery
 * channel would create a loop/ambiguity.
 *
 * Exported as a readonly array for the same duplicate-detection reason as
 * RESTRICTED_SOFT_TOOL_NAMES_SOURCE above.
 *
 * Tools with channels: ALL_READ_CHANNELS in ELAINE_TOOL_POLICIES that are
 * NOT in this list are automatically included in the AgentPhone action list.
 * See index.ts for the full reasoning per entry.
 */
export const RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE: readonly string[] = [
  "send_test_email",
  "send_test_sms",
  "send_phone_verification_code",
  "verify_phone_code",
  "update_card_layout",
  "update_trip_card_collapse",
  "add_connected_calendar",
  // Adaptive memory and durable-task actions require the in-app confirmation
  // UI and exact IDs returned only by their web-only read tools.
  "correct_memory",
  "forget_memory",
  "queue_research_task",
  "cancel_elaine_task",
  // Admin-only action — requires the owner to be looking at the Control Panel
  // with config keys visible on screen; not meaningful over SMS/voice/email.
  "update_app_config",
  // broadcast_message: fans out to ALL the user's channels simultaneously.
  // Excluded from inbound restricted channels to prevent delivery loops
  // (an SMS-triggered broadcast would echo back to the SMS channel it came
  // from) and to ensure the user consciously triggers it from the web UI.
  "broadcast_message",
  // call_contact / message_contact: excluded from the base allowlist so
  // the email channel — where inbound From headers are spoofable — cannot
  // trigger outbound calls or messages to household members. SMS/voice and
  // Slack re-allow them via channelAllowedExtras because sender identity is
  // strongly verified on those channels (E.164 phone HMAC / Slack OAuth)
  // before the turn runs. See capability-registry.ts for the full reasoning.
  "call_contact",
  "message_contact",
  // create_reminder: same spoofable-From-header reasoning as call_contact /
  // message_contact above. Although the reminder always targets the
  // requesting user's own account (never a third party), a spoofed email
  // sender matched to a real household member's app_users.email could still
  // plant unwanted reminders on that member's account. SMS/voice and Slack
  // re-allow it via channelAllowedExtras because sender identity is strongly
  // verified there before the turn runs.
  "create_reminder",
  // snooze_reminder: same reasoning as create_reminder above — it can
  // reschedule/skip a reminder belonging to whichever household member the
  // (spoofable) email From address is matched to. SMS/voice and Slack
  // re-allow it via channelAllowedExtras for the same strong-identity reason.
  "snooze_reminder",
  // Notification management actions: these are web-only because managing
  // notification preferences is an in-app settings action that is not
  // meaningful or safe to trigger from an async channel without the settings
  // UI confirming the change visually.
  "update_notification_state",
  "bulk_update_notifications",
  "update_notification_preferences",
  // update_elaine_settings: in-app settings UI required (chat window size,
  // action confirmation mode, etc.) — changes are only meaningful from the
  // web UI where the user can see and verify the effect immediately.
  "update_elaine_settings",
  // execute_app_operation: high-risk automation; requires the owner to be
  // looking at the Control Panel and explicitly choosing the operation.
  "execute_app_operation",
];

/** Runtime Set derived from the source array — use for O(1) membership tests. */
export const RESTRICTED_EXCLUDED_ACTION_TYPES = new Set<string>(
  RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE,
);
