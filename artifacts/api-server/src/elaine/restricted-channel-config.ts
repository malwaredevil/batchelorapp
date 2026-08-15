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
    // list_reminders: dispatched via executeListRemindersTool in
    // runRestrictedElaineTurn before the fallthrough to executeRestrictedSoftTool.
    LIST_REMINDERS_TOOL_NAME,
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
  // add_photo_to_pottery / add_photo_to_quilting / add_photo_to_ornaments:
  // require an image attachment from the current message; restricted channels
  // (SMS, voice, email, Slack) do not carry image attachments into Elaine's
  // context so these actions are meaningless outside the web UI.
  "add_photo_to_pottery",
  "add_photo_to_quilting",
  "add_photo_to_ornaments",
];

/** Runtime Set derived from the source array — use for O(1) membership tests. */
export const RESTRICTED_EXCLUDED_ACTION_TYPES = new Set<string>(
  RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE,
);

/**
 * Source array for action types that ARE allowed in restricted channels
 * (SMS/voice/email/Slack).  Together with RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE
 * these two lists form a complete bipartite coverage of every known action type:
 * each type must appear in EXACTLY ONE of the two arrays.
 *
 * Exported as a readonly array for the same duplicate-detection reason as the
 * excluded list above.  The CI guard in check-domain-composition.ts (Scan J)
 * reads both lists from this file's source text and verifies:
 *   1. Every action type found in any action schema file or planner-tool-catalog.ts
 *      ACTION_TOOLS section appears in exactly one list.
 *   2. No type appears in both lists.
 *   3. No list contains duplicates.
 *
 * When you add a new action type to ANY action schema file or to the
 * ACTION_TOOLS array in planner-tool-catalog.ts:
 *   - Add it here if it is safe to expose over SMS/voice/email/Slack.
 *   - Add it to RESTRICTED_EXCLUDED_ACTION_TYPES_SOURCE if it is NOT safe
 *     (requires a live browser UI, exact on-screen IDs, or could create a
 *     delivery loop over the inbound channel).
 *   - If you leave it in neither list, Scan J fails CI with an "uncovered"
 *     violation naming the new type.
 */
export const RESTRICTED_ALLOWED_ACTION_TYPES_SOURCE: readonly string[] = [
  // ── Travels: trip lifecycle ──────────────────────────────────────────────
  "create_trip",
  "update_trip_status",
  "update_trip_details",
  "cancel_trip",
  // ── Travels: packing & wishlist ──────────────────────────────────────────
  "add_packing_item",
  "remove_packing_item",
  "add_wishlist",
  "mark_wishlist_done",
  "remove_wishlist_item",
  "update_wishlist_item",
  // ── Travels: diary ───────────────────────────────────────────────────────
  "add_diary_entry",
  "delete_diary_entry",
  "edit_diary_entry",
  // ── Travels: reminders (trip-scoped) ────────────────────────────────────
  // These are trip reminder CRUD actions defined in planner-tool-catalog.ts,
  // distinct from create_reminder / snooze_reminder (reminder-actions.ts)
  // which are excluded from email due to the spoofable-From-header risk.
  "add_reminder",
  "edit_reminder",
  "delete_reminder",
  // ── Travels: itinerary ───────────────────────────────────────────────────
  "add_itinerary_day",
  "regenerate_itinerary_day",
  "generate_itinerary",
  "confirm_itinerary_activity",
  "remove_itinerary_activity",
  // ── Travels: calendar & documents ────────────────────────────────────────
  // add_connected_calendar is excluded (requires browser OAuth redirect).
  "disconnect_calendar",
  "rescan_document",
  // ── Travels: sharing & media ─────────────────────────────────────────────
  "generate_trip_share_link",
  "revoke_trip_share_link",
  "delete_trip_photo",
  // ── Travels: email (outbound only — not the inbound webhook channel) ─────
  "send_email",
  // ── Communication: restricted-channel-safe actions ───────────────────────
  // call_contact / message_contact are excluded from email (spoofable From).
  // broadcast_message is excluded (would loop back to the originating channel).
  // create_reminder / snooze_reminder are excluded from email (same spoofing risk).
  // cancel_scheduled_contact and continue_in_channel are safe on all channels.
  // call_me dials back the requesting user — safe because the channel already
  // verified their phone number (E.164 HMAC / Slack OAuth).
  "cancel_scheduled_contact",
  "continue_in_channel",
  "call_me",
  // ── Pottery ──────────────────────────────────────────────────────────────
  "update_pottery_item",
  "delete_pottery_item",
  "create_pottery_category",
  "delete_pottery_category",
  "lock_pottery_field",
  "update_pottery_item_categories",
  "delete_pottery_photo",
  "promote_pottery_photo",
  "merge_pottery_categories",
  "bulk_reanalyze_pottery",
  // ── Quilting ─────────────────────────────────────────────────────────────
  "create_block",
  "delete_block",
  "create_layout",
  "delete_layout",
  "delete_fabric",
  "update_fabric",
  "remove_fabric_creases",
  "create_pattern",
  "update_pattern",
  "delete_pattern",
  "delete_quilt",
  "create_quilting_category",
  "delete_quilting_category",
  "rename_quilting_category",
  "merge_quilting_categories",
  "bulk_reanalyze_quilting",
  "create_shopping_item",
  "update_shopping_item",
  "delete_shopping_item",
  // ── Ornaments ────────────────────────────────────────────────────────────
  "update_ornament_item",
  "delete_ornament_item",
  "lock_ornament_field",
  "update_ornament_item_categories",
  "create_ornament_category",
  "delete_ornament_category",
  "merge_ornament_categories",
  "delete_ornament_photo",
  "promote_ornament_photo",
  "bulk_reanalyze_ornaments",
  // ── Universal ────────────────────────────────────────────────────────────
  // update_notification_state / bulk_update_notifications /
  // update_notification_preferences are excluded (in-app settings UI required).
  "create_note",
  "update_note",
  "delete_note",
];
