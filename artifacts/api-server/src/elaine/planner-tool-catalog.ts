/**
 * Elaine planner tool catalog.
 *
 * This file is the single source of truth for the full set of
 * ChatCompletionTool definitions exposed to the planner model.
 * Keeping them here (rather than inline inside the router module)
 * makes the catalog importable in unit tests so that a missing
 * capability-policy entry is caught in CI instead of in production.
 */
import type OpenAI from "openai";
import { APP_CONFIG_DEFAULTS } from "../lib/app-config";
import {
  buildElaineCapabilityRegistry,
  buildPlannerCatalogFromCapabilities,
} from "./capability-registry";
import { assertElaineToolFamilyCoverage } from "./runtime/tool-families";
import type { ElainePlannerTool } from "./runtime/planner";
import { potteryActionTools } from "./pottery-actions";
import { quiltingActionTools } from "./quilting-actions";
import { ornamentActionTools } from "./ornaments-actions";
import { universalActionTools } from "./universal-actions";
import { adaptiveActionTools } from "./adaptive-actions";
import {
  appOperationActionTools,
  appOperationReadTools,
} from "./app-operation-tools";
import { officeActionTools } from "./office-actions";
import { universalReadTools } from "./universal-read-tools";
import {
  listScheduledContactsTool,
  listContactChannelsTool,
  communicationActionTools,
} from "./communication-actions";
import { reminderActionTools, reminderReadTools } from "./reminder-actions";
import { ELAINE_LESSON_DOMAINS } from "../lib/elaine-lessons";

// ---------------------------------------------------------------------------
// Shared enums used by tool JSON schemas and route-handler Zod schemas alike.
// Exported so index.ts (and tests) can import them without re-declaring.
// ---------------------------------------------------------------------------

export const TRIP_STATUS_ENUM = [
  "wishlist",
  "planning",
  "booked",
  "active",
  "completed",
] as const;

export const ACTION_CONFIRMATION_MODES = [
  "one_by_one",
  "all_at_once",
  "auto_run",
] as const;

// ---------------------------------------------------------------------------
// Tool-name constants shared between the tool JSON schemas below and the
// route-handler dispatch logic in index.ts.
// ---------------------------------------------------------------------------

export const NAVIGATE_TOOL_NAME = "suggest_navigation";
export const REMEMBER_TOOL_NAME = "remember_household_fact";
export const RECORD_LESSON_TOOL_NAME = "remember_lesson";
export const SET_MODE_TOOL_NAME = "set_action_confirmation_mode";
export const WEB_SEARCH_TOOL_NAME = "web_search";
export const EBAY_SEARCH_TOOL_NAME = "ebay_search";
export const SEARCH_HALLMARK_TOOL_NAME = "search_hallmark";
export const LOOKUP_BARCODE_TOOL_NAME = "lookup_product_barcode";
export const ANALYZE_POTTERY_PHOTO_TOOL_NAME = "analyze_pottery_photo";
export const ANALYZE_FABRIC_PHOTO_TOOL_NAME = "analyze_fabric_photo";
export const ANALYZE_ORNAMENT_PHOTO_TOOL_NAME = "analyze_ornament_photo";
export const LOOKUP_BOOK_VALUE_TOOL_NAME = "lookup_book_value";
export const LOOKUP_RETAIL_VALUE_TOOL_NAME = "lookup_retail_value";
export const SEARCH_FLIGHTS_TOOL_NAME = "search_flights";
export const FETCH_PAGE_TOOL_NAME = "fetch_page";
export const CONSULT_EXPERTS_TOOL_NAME = "consult_experts";
export const GET_WEATHER_TOOL_NAME = "get_weather_forecast";
export const FIND_NEARBY_PLACES_TOOL_NAME = "find_nearby_places";
export const GET_ROUTE_INFO_TOOL_NAME = "get_route_info";
export const GET_AIR_QUALITY_TOOL_NAME = "get_air_quality";
export const GET_POLLEN_FORECAST_TOOL_NAME = "get_pollen_forecast";
export const SHOW_DATA_CARD_TOOL_NAME = "show_data_card";
export const SEARCH_HOUSEHOLD_TOOL_NAME = "search_household_data";
export const SEARCH_TRIP_DOCUMENTS_TOOL_NAME = "search_trip_documents";
export const SHOW_POTTERY_ITEM_TOOL_NAME = "show_pottery_item";
export const SHOW_FABRIC_SWATCH_TOOL_NAME = "show_fabric_swatch";
export const SHOW_ORNAMENT_ITEM_TOOL_NAME = "show_ornament_item";
export const SHOW_DESTINATION_CARD_TOOL_NAME = "show_destination_card";
export const GET_EXCHANGE_RATE_TOOL_NAME = "get_exchange_rate";
export const SHOW_TRIP_CARD_TOOL_NAME = "show_trip_card";
export const SUGGEST_CLOTHING_LAYERS_TOOL_NAME = "suggest_clothing_layers";
export const CALCULATE_YARDAGE_TOOL_NAME = "calculate_yardage";
export const QUERY_HOUSEHOLD_TOOL_NAME = "query_household_data";
export const CHECK_INTEGRATIONS_HEALTH_TOOL_NAME = "check_integrations_health";
export const GET_OWNER_SETTINGS_TOOL_NAME = "get_owner_settings";
export const UPDATE_OWNER_SETTING_TOOL_NAME = "update_owner_setting";
export const LIST_SENTRY_ISSUES_TOOL_NAME = "list_sentry_issues";
export const GENERATE_DOCUMENT_TOOL_NAME = "generate_document";

// ---------------------------------------------------------------------------
// Tool arrays
// ---------------------------------------------------------------------------

export const ACTION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_trip",
      description:
        'Propose creating a new trip. Ask permission in your reply\'s visible text first (e.g. "Want me to create a trip to Rome for August?"), then call this.',
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short trip title" },
          destination: { type: "string" },
          status: { type: "string", enum: [...TRIP_STATUS_ENUM] },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["title", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_wishlist",
      description: "Propose adding a destination to the household wishlist.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          targetDate: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_packing_item",
      description:
        "Propose adding an item to a specific trip's packing list. Only call this if you can see a specific trip's numeric id in the on-screen state you were given (look for \"tripId: <number>\"); never guess an id — offer to open the trip instead if you don't have one.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          item: { type: "string" },
        },
        required: ["tripId", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trip_status",
      description:
        'Propose moving a trip to a different stage, e.g. "mark my Tokyo trip as booked". Only call this if the trip\'s numeric id is visible in the on-screen state you were given; never guess an id.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          status: { type: "string", enum: [...TRIP_STATUS_ENUM] },
        },
        required: ["tripId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trip_details",
      description:
        "Propose editing a trip's destination, dates, and/or notes, e.g. \"push my Rome trip back a week\" or \"add a note that we're flying instead of driving\". Not for status changes (use update_trip_status). Include only the field(s) that actually change; you must include at least one. Only call this if the trip's numeric id is visible on screen; never guess an id, and never guess new dates the user didn't specify — compute exact dates from what you can see on screen, or ask instead of guessing.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          destination: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["tripId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_trip",
      description:
        'Propose permanently deleting a trip and everything attached to it (photos, documents, reminders). Only call this if the trip\'s numeric id is visible on screen; never guess an id. Since this is destructive, your visible reply text must clearly say it will DELETE the trip, not just "cancel" it ambiguously.',
      parameters: {
        type: "object",
        properties: { tripId: { type: "integer" } },
        required: ["tripId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_wishlist_done",
      description:
        "Propose marking a wishlist item done (or not done, if done is explicitly false). Only call this if the wishlist item's numeric id is visible on screen; never guess an id.",
      parameters: {
        type: "object",
        properties: {
          wishlistId: { type: "integer" },
          done: { type: "boolean" },
        },
        required: ["wishlistId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_wishlist_item",
      description:
        "Propose permanently deleting a wishlist item. Only call this if the wishlist item's numeric id is visible on screen; never guess an id.",
      parameters: {
        type: "object",
        properties: { wishlistId: { type: "integer" } },
        required: ["wishlistId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_wishlist_item",
      description:
        "Propose editing an existing wishlist destination — rename it, change its target date, or update its notes. Only call this if the wishlist item's numeric id is visible on screen; never guess an id. Include only the field(s) that actually change; you must include at least one.",
      parameters: {
        type: "object",
        properties: {
          wishlistId: { type: "integer" },
          destination: { type: "string" },
          targetDate: { type: "string", description: "YYYY-MM-DD" },
          notes: { type: "string" },
        },
        required: ["wishlistId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_packing_item",
      description:
        "Propose removing an existing item from a trip's packing list, matched by name. Only call this if the trip's numeric id is visible on screen; never guess an id, and use the exact item text as it appears on screen.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          item: { type: "string" },
        },
        required: ["tripId", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_diary_entry",
      description:
        'Propose adding a diary entry to a specific trip. Only call this if you can see a specific trip\'s numeric id in the on-screen state you were given (look for "tripId: <number>"); never guess an id. entryDate must be a YYYY-MM-DD date the user specified or that is visible on screen — never invent one. body is the main text of the entry; title is an optional short headline.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          entryDate: { type: "string", description: "YYYY-MM-DD" },
          title: { type: "string", description: "Optional short headline" },
          body: { type: "string", description: "Main text of the diary entry" },
        },
        required: ["tripId", "entryDate", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_diary_entry",
      description:
        "Propose deleting an existing diary entry. Only call this if the entry's numeric entryId is visible on screen or in the on-screen state you were given; never guess an id.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          entryId: { type: "integer" },
        },
        required: ["tripId", "entryId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_diary_entry",
      description:
        'Propose editing an existing diary entry — fix a typo, change the date, update the title, or rewrite the body. Only call this if the entry\'s numeric entryId is visible on screen or in the on-screen state you were given (look for "entryId: <number>" next to the entry); never guess an id. Only include the fields the user actually asked to change; include at least one of entryDate, title, or body.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          entryId: { type: "integer" },
          entryDate: { type: "string", description: "YYYY-MM-DD" },
          title: {
            type: "string",
            description:
              "Updated headline, or null to clear the title entirely",
          },
          body: { type: "string", description: "Updated main text" },
        },
        required: ["tripId", "entryId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_reminder",
      description:
        "Propose creating a new reminder for a trip, e.g. \"remind me to check in for our flight\" or \"remind me to book the hotel by Friday\". Only call this if the trip's numeric id is visible on screen; never guess an id — offer to open the trip instead if you don't have one. If the user gives (or you can see on screen) a specific date the reminder is about, set dueDate to that exact date; never invent a date. If the user asks to also notify/email someone (a connected household member), include their email(s) in recipientEmails; never invent an email address you can't see on screen or that the user didn't give you.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          title: { type: "string", description: "Short reminder title" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          recipientEmails: {
            type: "array",
            items: { type: "string" },
            description:
              "Email addresses to also notify, if the user asked for that",
          },
        },
        required: ["tripId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_reminder",
      description:
        'Propose editing an EXISTING reminder, e.g. "change that reminder\'s due date to next Friday", "rename it to...", "mark it as done", or "also email that reminder to mom". Only call this if the reminder\'s numeric id is visible on screen (look for "reminderId: <number>" in the reminders listed for this trip); never guess an id — if you can\'t see it, ask which reminder they mean. Only include the fields the user actually asked to change; leave everything else out. Never invent a due date or email address you can\'t see on screen or that the user didn\'t give you. Setting recipientEmails replaces the full list of recipients, so if the user asks to add one person, include the existing recipients too if you can see them on screen.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          reminderId: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          done: { type: "boolean" },
          recipientEmails: {
            type: "array",
            items: { type: "string" },
            description: "Full replacement list of emails to notify",
          },
        },
        required: ["tripId", "reminderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_reminder",
      description:
        'Propose permanently deleting an EXISTING reminder, e.g. "delete that reminder" or "remove the flight check-in reminder". This also removes it from the calendar if it was synced. Only call this if the reminder\'s numeric id is visible on screen (look for "reminderId: <number>" in the reminders listed for this trip); never guess an id — if you can\'t see it, ask which reminder they mean.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          reminderId: { type: "integer" },
        },
        required: ["tripId", "reminderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_itinerary_day",
      description:
        "Propose adding a new day to a trip's itinerary, e.g. \"add a day trip to Kyoto on the 14th\". Only call this if the trip's numeric id is visible on screen; never guess an id — offer to open the trip instead if you don't have one. Use the exact date the user gave (YYYY-MM-DD) if known; never invent a date. Optionally include a single starting activity if the user described one.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD, if known" },
          title: {
            type: "string",
            description: "Short theme/title for the day",
          },
          activityName: { type: "string" },
          activityTime: { type: "string", description: "HH:MM, e.g. 09:00" },
          activityDescription: { type: "string" },
        },
        required: ["tripId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regenerate_itinerary_day",
      description:
        'Propose regenerating (re-running AI planning for) ONE existing day of a trip\'s itinerary, e.g. "regenerate day 3" or "come up with a new plan for day 2". This replaces that day\'s activities with a freshly AI-generated plan using balanced-pace, general-interest defaults. Only call this if the trip\'s numeric id AND the day\'s number (1-based, as shown on screen, e.g. "Day 3") are visible on screen; never guess either.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          dayNumber: {
            type: "integer",
            description: "1-based day number as shown on screen",
          },
        },
        required: ["tripId", "dayNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_connected_calendar",
      description:
        'Propose connecting one of the user\'s own Google calendars to the Travel Calendar overlay, e.g. "add my Work calendar" or "show my Personal calendar too". Only call this if the user is on the Settings page and Google Calendar is already connected, and only pick a googleCalendarId that is actually listed in the on-screen calendar list — never guess or invent one. If the calendar isn\'t connected yet, do NOT call this; instead tell the user to click Connect (suggest navigating to Settings if needed).',
      parameters: {
        type: "object",
        properties: {
          googleCalendarId: {
            type: "string",
            description: "Exact calendarId as shown on screen",
          },
          calendarSummary: {
            type: "string",
            description: "The calendar's display name, as shown on screen",
          },
          primaryColor: {
            type: "string",
            description:
              "Optional hex color for the overlay, if the user specified one",
          },
        },
        required: ["googleCalendarId", "calendarSummary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disconnect_calendar",
      description:
        'Propose disconnecting the user\'s own Google Calendar connection, e.g. "disconnect my calendar" or "stop syncing to Google Calendar". Only call this if Google Calendar is currently shown as connected on screen. This does not affect any other family member\'s connection.',
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rescan_document",
      description:
        'Propose re-scanning (re-running AI extraction on) an already-uploaded travel document, e.g. "re-scan my flight ticket" or "the hotel confirmation looks wrong, can you read it again?". This re-reads the original uploaded file and refreshes its extracted fields (dates, confirmation numbers, etc.), skipping any field the user has locked. It does not require a new upload. Only call this if the trip\'s numeric id AND the document\'s numeric id are visible on screen (look for "docId: <number>" next to the document you were given); never guess an id — if you can\'t see it, ask which document they mean or offer to open the trip.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          documentId: { type: "integer" },
        },
        required: ["tripId", "documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_itinerary",
      description:
        'Propose generating a brand-new, full day-by-day AI itinerary for a trip, e.g. "plan my whole trip" or "generate an itinerary for this trip". This replaces ALL existing days with a freshly AI-generated plan (using balanced-pace, general-interest defaults, since it can\'t see any per-session style/interest picks made in the UI) — if the trip already has an itinerary, warn the user in your visible reply that this overwrites it before calling this tool. Only call this if the trip\'s numeric id is visible on screen; never guess an id. Use regenerate_itinerary_day instead if the user only wants to redo one existing day.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
        },
        required: ["tripId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_itinerary_activity",
      description:
        'Propose marking one itinerary activity as firm/confirmed (or back to tentative), e.g. "mark the hotel check-in as firm" or "that flight time is right, confirm it". This is mainly used to accept a tentative, document-derived activity (flagged "tentative, from document" on screen) once the user has verified it\'s correct. Only call this if the trip\'s numeric id, the day\'s number, and the activity\'s number (both 1-based, as shown on screen) are visible on screen; never guess any of them.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          dayNumber: {
            type: "integer",
            description: "1-based day number as shown on screen",
          },
          activityNumber: {
            type: "integer",
            description:
              "1-based activity number within that day, as shown on screen",
          },
          confirmed: {
            type: "boolean",
            description:
              "true (default) to mark firm/confirmed, false to revert to tentative",
          },
        },
        required: ["tripId", "dayNumber", "activityNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_itinerary_activity",
      description:
        'Propose removing one activity from a trip\'s itinerary, e.g. "delete that duplicate hotel check-in" or "remove the wrong flight entry from day 2". Especially useful for cleaning up an incorrect activity that document auto-sync added (flagged "tentative, from document" on screen) — e.g. after a document was mis-read. Only call this if the trip\'s numeric id, the day\'s number, and the activity\'s number (both 1-based, as shown on screen) are visible on screen; never guess any of them. If the underlying document itself is wrong, prefer rescan_document to fix the source instead of just deleting the symptom, unless the user specifically asks to remove the entry.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          dayNumber: {
            type: "integer",
            description: "1-based day number as shown on screen",
          },
          activityNumber: {
            type: "integer",
            description:
              "1-based activity number within that day, as shown on screen",
          },
        },
        required: ["tripId", "dayNumber", "activityNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Propose emailing the user a copy of something you just told them, e.g. after listing recommendations, an itinerary summary, or packing tips: \"want me to email you that list?\" This always sends to the user's own registered account email — never ask for or accept a different address, and never use this to email anyone else. Write `subject` as a short descriptive title and `body` as plain text (no markdown/HTML) using blank lines between paragraphs; it will be nicely formatted automatically. Offer this proactively when you've just produced a substantial list or summary the user might want to keep, but don't call it until the user agrees.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Short email subject line" },
          body: {
            type: "string",
            description: "Plain text email body, blank line between paragraphs",
          },
        },
        required: ["subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_test_email",
      description:
        'Propose sending a one-off test email to the user\'s own registered account address, e.g. "send me a test email" or "check that email is working". Takes no parameters — always goes to their own account address, never a different one.',
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_test_sms",
      description:
        'Propose sending a one-off test text message to the user\'s own verified phone number, e.g. "text me a test message" or "check that SMS is working". Only works if the user already has a verified phone number on their account (see the Account settings page context) — if not, tell them to verify a phone number first instead of calling this. Takes no parameters.',
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_phone_verification_code",
      description:
        'Propose sending a 6-digit SMS verification code to a phone number the user wants to add/change on their account, e.g. "verify my number +12105551234". Only call this once the user has explicitly said they agree to receive SMS text messages (their reply must clearly indicate consent) — `consent` must be `true`, reflecting that agreement, never assume or default it. `phoneNumber` must be in E.164 format (e.g. "+12105551234"); ask the user for it in that format if they gave a local number without a country code.',
      parameters: {
        type: "object",
        properties: {
          phoneNumber: {
            type: "string",
            description: "Phone number in E.164 format, e.g. +12105551234",
          },
          consent: {
            type: "boolean",
            description:
              "Must be true, and only true after the user has explicitly agreed to receive SMS messages",
          },
        },
        required: ["phoneNumber", "consent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_phone_code",
      description:
        "Propose submitting the 6-digit verification code the user received by text to finish verifying their phone number, e.g. the user replies with a code after send_phone_verification_code was used. Only call this with a code the user actually typed/told you in this conversation — never guess or reuse an old code.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The 6-digit code, digits only",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_trip_share_link",
      description:
        'Propose generating a public, read-only share link for a trip (or returning the existing one if already generated), e.g. "make a link I can send to my parents" or "share this trip". The link exposes only basic itinerary info (title, destination, dates, status, notes, itinerary) to anyone who has it — no photos, documents, or private data. Only call this if the trip\'s numeric id is visible on screen; never guess an id. Mention in your visible reply that anyone with the link can view it.',
      parameters: {
        type: "object",
        properties: { tripId: { type: "integer" } },
        required: ["tripId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revoke_trip_share_link",
      description:
        'Propose revoking (deleting) a trip\'s existing public share link, e.g. "revoke that share link" or "stop sharing this trip". This immediately breaks any copy of the link already sent out — anyone who has it loses access. Only call this if the trip\'s numeric id is visible on screen; never guess an id. Since this is destructive to the existing link, your visible reply must clearly say the old link will stop working.',
      parameters: {
        type: "object",
        properties: { tripId: { type: "integer" } },
        required: ["tripId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_trip_photo",
      description:
        'Propose permanently deleting one photo (memory photo or souvenir magnet photo) from a trip, e.g. "delete that photo" or "remove the second magnet photo". This also clears it as the trip\'s cover photo if it was set as one. Only call this if both the trip\'s numeric id AND the photo\'s numeric id are visible on screen (look for "photoId: <number>" next to the photo); never guess either id. Since this is destructive, your visible reply must clearly say the photo will be permanently deleted.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          photoId: { type: "integer" },
        },
        required: ["tripId", "photoId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_card_layout",
      description:
        "Propose reordering the Trip Detail page's cards (Reminders, Itinerary, Documents, Packing/To-do, Photos, Magnets, Weather & Nearby) for the CURRENT user only — this is a personal display preference, never shared with the rest of the household, and it applies across every trip they view. Only call this if the user explicitly describes a new order and you can see the current/available card ids on screen; never invent a card id. Provide the FULL new order (every card id, not just the ones that moved).",
      parameters: {
        type: "object",
        properties: {
          cardOrder: {
            type: "array",
            items: { type: "string" },
            description:
              'Full ordered list of card ids, e.g. ["itinerary", "reminders", "documents", "packing-todo", "photos", "magnets", "weather-nearby"]',
          },
        },
        required: ["cardOrder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trip_card_collapse",
      description:
        "Propose collapsing or expanding specific cards on ONE trip's Trip Detail page for the CURRENT user only — this is a personal display preference, never shared with the rest of the household. Only call this if the trip's numeric id is visible on screen and the user named specific cards to collapse/expand; never guess. Provide the FULL set of card ids that should end up collapsed (not just the ones changing) — an empty array expands everything.",
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          collapsedCards: {
            type: "array",
            items: { type: "string" },
            description:
              'Full list of card ids that should be collapsed, e.g. ["documents", "weather-nearby"]',
          },
        },
        required: ["tripId", "collapsedCards"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_elaine_settings",
      description:
        "Propose updating Elaine's own per-user settings — whether she is enabled (on/off) and/or the chat widget's desktop window size (compact / comfortable / large). These are personal to the requesting user only, never shared with the household. Only call this from the Account settings page when the user explicitly asks to change one of these specific settings. For confirmation-mode changes (one-by-one / all-at-once / auto-run), use set_action_confirmation_mode instead — do not use this tool for that. This tool never touches password, display name, phone, or theme.",
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description:
              "Set to false to disable Elaine entirely for this user, or true to re-enable. Only set this if the user explicitly asked to turn Elaine on or off.",
          },
          chatWindowSize: {
            type: "string",
            enum: ["compact", "comfortable", "large"],
            description:
              "Desktop popup size for the chat widget (compact is the default). Only set this if the user explicitly asked to change the window size.",
          },
        },
      },
    },
  },
  ...potteryActionTools,
  ...quiltingActionTools,
  ...ornamentActionTools,
  ...universalActionTools,
  ...adaptiveActionTools,
  ...appOperationActionTools,
  {
    type: "function",
    function: {
      name: "update_app_config",
      description:
        "Propose updating a single Control Panel setting — an app-wide tuning constant like an AI token limit or a request timeout. Only available to the app owner (isOwner). Only call this if the specific config key is visible in the on-screen Control Panel state (look for the module and key names listed there); never guess a module or key — the server will reject any module+key not in the schema. This changes AI behaviour app-wide, so always describe what will change in your visible reply before calling it.",
      parameters: {
        type: "object",
        properties: {
          module: {
            type: "string",
            enum: [...new Set(APP_CONFIG_DEFAULTS.map((d) => d.module))],
            description:
              "Config module name. Must exactly match one of the allowed values.",
          },
          key: {
            type: "string",
            description:
              "Config key within the module. Valid module.key pairs: " +
              APP_CONFIG_DEFAULTS.map((d) => `${d.module}.${d.key}`).join(", "),
          },
          value: {
            type: "string",
            description: "New value as a string, e.g. '5000'",
          },
        },
        required: ["module", "key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: UPDATE_OWNER_SETTING_TOOL_NAME,
      description:
        "Propose changing a single Elaine global AI setting — chat/subagent model, request timeout, response token budget, a model role, feature toggle, timeout, or threshold. Only available to the app owner (isOwner). This is exclusively for the Elaine Global Configuration (Owner Panel → Global Configuration page), not for Control Panel app-config values (use update_app_config for those). Before calling this, always call get_owner_settings to confirm the current value and describe the exact change in your visible reply. This action is owner-only and excluded from SMS/voice/email channels.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            description:
              "Dot-notation path to the setting to change. Top-level fields: chatModel, subagentModel, requestTimeoutMs, maxResponseTokens. Nested fields use dot notation: models.fastVision, models.smartVision, models.advisor, models.research, models.expertPanelAlt, models.embedding, models.openAIReasoning, models.openAIBalanced, models.openAIFast, models.restrictedTextModel, models.rerank, models.visualEmbed, models.fusionJudge. timeouts.expertConsultMs, timeouts.rerankerMs, timeouts.geocodingMs, timeouts.fusionMs, timeouts.openAIResponsesMs. features.enableAdvisor, features.enableSubagent, features.enableFusionPotteryExpert, features.enableFusionTravelDocFallback, features.enableOpenAIResponses, features.enableOpenAIAppWorkflows, features.enableOpenAIResponsesFallback, features.enableBuiltinWebSearch, features.showReasoningSummary, features.openAIStoreEnabledDefault. thresholds.potterySimilarityYes, thresholds.potterySimilarityMaybe, thresholds.potterySimilarityNo, thresholds.visualEmbedCropTop, thresholds.visualEmbedCropHeight, thresholds.aiJpegQuality, thresholds.potteryZoneAnalysisMaxTokens, thresholds.potteryBackstampMaxTokens, thresholds.travelDocExtractionMaxTokens, thresholds.openAIResponsesMaxOutputTokens, thresholds.openAICompactionThresholdTokens, thresholds.openAIStateMaxAgeDays, thresholds.codeDiagnosisRecurrenceThreshold.",
          },
          value: {
            type: "string",
            description:
              "New value as a string. Numbers are coerced automatically (e.g. '1000'). Booleans must be 'true' or 'false'. Model names are strings (e.g. 'openai/gpt-4o').",
          },
          currentValue: {
            type: "string",
            description:
              "The current value of the setting, as returned by get_owner_settings. Include this so the confirmation card can show 'changing X from Y to Z'.",
          },
        },
        required: ["field", "value"],
      },
    },
  },
  ...communicationActionTools,
  ...reminderActionTools,
];

export const SOFT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: NAVIGATE_TOOL_NAME,
      description:
        'Suggest navigating the user to a screen — either in the CURRENT app or in a DIFFERENT app. You are never allowed to navigate them yourself — the UI only offers a button the user must click. First ASK in plain language in your visible reply (e.g. "Want me to open your pottery collection?"). Only call this after asking permission in your visible text.\n\nFor the current app, use relative paths: e.g. "/trips/42", "/piece/7", "/fabrics".\nFor cross-app navigation use the app\'s base path prefix:\n  • Pottery collection → "/pottery/" (add ?search=term to pre-filter, e.g. "/pottery/?search=polish")\n  • Pottery piece detail → "/pottery/piece/42"\n  • Quilting fabrics → "/quilting/fabrics"\n  • Quilting root → "/quilting/"\n  • Travels → "/travels/"\n  • Elaine chat → "/elaine/"\nNever use paths from another app without the prefix.',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'The destination path. Use relative paths for the current app (e.g. "/trips/42"). Use prefixed paths for other apps (e.g. "/pottery/?search=polish", "/quilting/fabrics").',
          },
          reason: {
            type: "string",
            description:
              "Short user-friendly description of where they will be taken, e.g. 'your pottery collection filtered for polish pottery'",
          },
        },
        required: ["path", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: REMEMBER_TOOL_NAME,
      description:
        "Save a durable fact for later — a preference, a recurring detail, or something a family member would want to know. Use scope='personal' for things that only apply to the current user (e.g. personal preferences they asked to keep private), scope='temporary' for context that should expire (e.g. travel-week reminders), and scope='household' (default) for shared family knowledge. Applied immediately, without a user confirmation step — only use this for genuinely durable facts, never small talk or one-off questions.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact, written plainly" },
          scope: {
            type: "string",
            enum: ["household", "personal", "temporary"],
            description:
              "household (default) = visible to whole family; personal = only for this user; temporary = expires after expires_in_days (default 30)",
          },
          category: {
            type: "string",
            enum: [
              "fact",
              "preference",
              "instruction",
              "person",
              "place",
              "collection",
            ],
            description: "Category of the memory",
          },
          sensitivity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "low (default) = general household fact; high = only surface when directly relevant",
          },
          expires_in_days: {
            type: "number",
            description: "For temporary scope only — days until auto-expiry",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: RECORD_LESSON_TOOL_NAME,
      description:
        "Record a lesson about YOUR OWN past performance — never a household fact (use remember_household_fact for those). Use outcome='mistake' when the user explicitly corrects something you got wrong, so you avoid repeating it; use outcome='success' when an approach clearly worked well and is worth repeating. Applied immediately, without a confirmation step. Web chat only.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["mistake", "success"],
            description:
              "mistake = something you got wrong that was corrected; success = an approach that worked well and is worth repeating",
          },
          situation: {
            type: "string",
            description:
              "What was attempted / the situation, written plainly enough to recognize a similar future request (e.g. \"user asked to reschedule a reminder by saying 'push it back an hour'\")",
          },
          takeaway: {
            type: "string",
            description:
              "The short, reusable lesson to apply next time a similar situation comes up (e.g. \"'push it back an hour' means add 1 hour to the existing time, not reset it to 1 hour from now\")",
          },
          domain: {
            type: "string",
            enum: [...ELAINE_LESSON_DOMAINS],
            description:
              "Bucket for retrieval — pick the closest app/topic area, or 'general' if none fit",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional extra keywords to help future retrieval",
          },
        },
        required: ["outcome", "situation", "takeaway"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SET_MODE_TOOL_NAME,
      description:
        'Change how this user wants you to confirm multi-action turns going forward. Applied immediately, without a separate confirmation card — only call this when the user explicitly asks you to change it (e.g. "just do things automatically from now on", "ask me one at a time", "show me everything together before you do it"). Never call this to explain the modes — just tell them in your visible reply and only call the tool once they\'ve actually decided.',
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: [...ACTION_CONFIRMATION_MODES],
            description:
              "one_by_one = confirm each proposed action individually before the next is shown (default, safest). all_at_once = show every proposed action together with one Confirm all / Cancel all. auto_run = execute proposed actions immediately with no confirmation and report back afterward.",
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: EBAY_SEARCH_TOOL_NAME,
      description:
        "Search eBay sold listings to get real market prices for any item. Use when the user asks what something is worth, what it sold for, or what eBay prices look like. Returns sold prices (min/median/max) and recent sold listings. IMPORTANT: eBay accepts any of these as a query — item name ('Hallmark Frosty Friends 2003'), a UPC barcode number ('661127022308'), a Hallmark item/SKU number ('QXI7404'), or a mix. Always prefer this tool over web_search for price/value questions. Set category='ornaments' for Hallmark/Christmas ornament searches or category='pottery' for collectible pottery.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query — can be an item name ('Hallmark Keepsake Frosty Friends 2003'), a UPC barcode ('661127022308'), a Hallmark SKU/item number ('QXI7404'), or any combination. eBay handles all of these as keyword searches.",
          },
          category: {
            type: "string",
            enum: ["ornaments", "pottery", "general"],
            description:
              "Optional category hint to focus the search. 'ornaments' adds Christmas/Hallmark context, 'pottery' adds collectible pottery context.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SEARCH_HALLMARK_TOOL_NAME,
      description:
        "Search Hallmark.com for official product details about a Hallmark Keepsake ornament — name, series, year, artist, original retail price, and product URL. Use when the user asks about a specific Hallmark ornament by name or item/SKU number (e.g. 'QXI7404', 'QHX7404'). Results come directly from Hallmark.com so they are authoritative. Provide at least one of: name or hallmarkSku.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Ornament name (e.g. 'Wielding The Darksaber')",
          },
          hallmarkSku: {
            type: "string",
            description:
              "Hallmark SKU / item number (e.g. 'QXI7404', 'QHX7404'). Takes precedence over name when provided.",
          },
          year: {
            type: "number",
            description:
              "Release year — optional, helps narrow results when searching by name.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: SEARCH_FLIGHTS_TOOL_NAME,
      description:
        "Search for round-trip flight prices between two cities via Skyscanner. Use when the user asks about flight costs or how much it costs to fly somewhere. If you are on a trip detail page, extract the destination and trip start/end dates from the page context and pass them as departDate/returnDate — do not ask the user to repeat them. Omit dates to default to ~30 days from now with a 7-night stay. Origin must be an IATA airport code (e.g. 'JFK', 'ORD', 'LHR'). Destination can be a city name, country, or IATA code.",
      parameters: {
        type: "object",
        properties: {
          originIata: {
            type: "string",
            description:
              "IATA airport code for departure city (e.g. 'JFK', 'LAX', 'ORD', 'LHR')",
          },
          destination: {
            type: "string",
            description:
              "Destination city, country, or IATA code (e.g. 'Dublin', 'Ireland', 'DUB'). If on a trip detail page, extract from the trip's destination field.",
          },
          departDate: {
            type: "string",
            description:
              "Optional departure date in YYYY-MM-DD format. If on a trip detail page, extract from the trip's start date. Omit to default to ~30 days from now.",
          },
          returnDate: {
            type: "string",
            description:
              "Optional return date in YYYY-MM-DD format. If on a trip detail page, extract from the trip's end date. Omit to default to 7 nights after departDate.",
          },
        },
        required: ["originIata", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: WEB_SEARCH_TOOL_NAME,
      description:
        'Search the live web for current, up-to-date information you would not reliably know otherwise — opening hours, current prices, weather forecasts, visa/entry requirements, local events, news, "is X open right now", or anything time-sensitive. Call this BEFORE answering whenever the question needs current/real-world facts rather than general travel knowledge; don\'t guess or rely on stale training knowledge for anything that changes over time. You can call it more than once in the same turn for different sub-questions. After you get results back, answer normally in your visible reply (mention where the info came from if relevant) — do not paste raw search output verbatim.',
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A focused, specific search query",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: CONSULT_EXPERTS_TOOL_NAME,
      description:
        'Get a cross-checked panel opinion instead of answering purely from your own single perspective. Use this when the user is asking for expertise, advice, a recommendation, or a judgment call where being wrong or one-sided actually matters — e.g. "which of these two flights should I book", "is this itinerary too packed", "what should I pack for hiking with a bad knee", "how should I negotiate this hotel rate", "is it worth paying for travel insurance here". Do NOT use it for simple facts (answer directly), anything needing current/live data (use web_search instead), or casual chit-chat. Pass a standalone `question` (it won\'t see this conversation) plus optional `context` with only the specific relevant details (e.g. dates, constraints, preferences) — not the whole conversation. Takes a bit longer than a normal reply since it consults more than one source; that\'s expected.',
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "A standalone, specific question to get advice on",
          },
          context: {
            type: "string",
            description:
              "Optional short background details relevant to the question",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_WEATHER_TOOL_NAME,
      description:
        "Get a live near-term weather forecast for a specific place using Google's Weather API. For a date-specific or trip question you MUST provide requestedStartDate/requestedEndDate from grounded trip/context data; the server rejects mismatched forecast coverage. Use web_search for seasonal context when the trip is outside the near-term horizon. lat/lng are optional: provide real coordinates when available, otherwise the server geocodes locationName. Never invent dates or coordinates.",
      parameters: {
        type: "object",
        properties: {
          lat: {
            type: "number",
            description:
              "Latitude (optional — omit if unknown, server will geocode from locationName)",
          },
          lng: {
            type: "number",
            description:
              "Longitude (optional — omit if unknown, server will geocode from locationName)",
          },
          locationName: {
            type: "string",
            description:
              "Human-readable place name (required). Used to geocode when lat/lng not provided, and shown in the widget.",
          },
          requestedStartDate: {
            type: "string",
            format: "date",
            description:
              "Requested/trip start date in YYYY-MM-DD. Include for every date-specific weather question.",
          },
          requestedEndDate: {
            type: "string",
            format: "date",
            description:
              "Requested/trip end date in YYYY-MM-DD. Include when the request covers a range.",
          },
        },
        required: ["locationName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FIND_NEARBY_PLACES_TOOL_NAME,
      description:
        'Search for real places (restaurants, museums, attractions, hotels, etc.) using Google Places — call this whenever the user asks for recommendations or "what\'s near X" instead of relying on general knowledge, since this returns real, current places with ratings. Provide lat/lng (from on-screen trip/destination context) to bias results near a specific place when relevant.',
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'What to search for, e.g. "sushi restaurants" or "museums in Kyoto"',
          },
          lat: {
            type: "number",
            description: "Optional latitude to bias results near a location",
          },
          lng: {
            type: "number",
            description: "Optional longitude to bias results near a location",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_ROUTE_INFO_TOOL_NAME,
      description:
        "Get real driving/walking/biking/transit distance and time between two real places using Google Routes — call this whenever the user asks how far something is or how long it'll take to get somewhere, instead of guessing. Requires real lat/lng for both ends (from on-screen context or a prior find_nearby_places result); never invent coordinates.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
              label: {
                type: "string",
                description: "Human-readable name, for your own reply",
              },
            },
            required: ["lat", "lng", "label"],
          },
          destination: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
              label: {
                type: "string",
                description: "Human-readable name, for your own reply",
              },
            },
            required: ["lat", "lng", "label"],
          },
          mode: {
            type: "string",
            enum: ["DRIVE", "WALK", "BICYCLE", "TRANSIT"],
            description: "Travel mode, defaults to WALK if unspecified",
          },
        },
        required: ["origin", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: CALCULATE_YARDAGE_TOOL_NAME,
      description:
        'Compute estimated fabric yardage for a finished quilt size — backing yardage (including piecing panels if the quilt is wider than the fabric bolt) and binding yardage. This is a read-only calculation, not a saved record; use it for questions like "how much backing fabric do I need for a 60x80 quilt?" or "how much binding for this?". Never estimate this arithmetic yourself — always call this tool so the numbers are accurate.',
      parameters: {
        type: "object",
        properties: {
          quiltWidthInches: {
            type: "number",
            description: "Finished quilt width in inches",
          },
          quiltHeightInches: {
            type: "number",
            description: "Finished quilt height in inches",
          },
          fabricWidthInches: {
            type: "number",
            description:
              "Usable fabric bolt width in inches, defaults to 40 (standard quilting cotton WOF minus selvedge)",
          },
          bindingStripWidthInches: {
            type: "number",
            description: "Binding strip width in inches, defaults to 2.5",
          },
        },
        required: ["quiltWidthInches", "quiltHeightInches"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_AIR_QUALITY_TOOL_NAME,
      description:
        "Get real current air quality (Universal AQI 0-100+, category, dominant pollutant) for a place using Google's Air Quality API — call this whenever the user asks about air quality, pollution, smog, or whether it's a good idea to pack a mask, or when giving packing/health advice for a destination with known air quality concerns. Requires real lat/lng from on-screen context; never invent coordinates.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude" },
          lng: { type: "number", description: "Longitude" },
          locationName: {
            type: "string",
            description: "Human-readable place name, for your own reply",
          },
        },
        required: ["lat", "lng", "locationName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_POLLEN_FORECAST_TOOL_NAME,
      description:
        "Get a real pollen forecast (grass/tree/weed pollen categories) for a place using Google's Pollen API — call this whenever the user asks about pollen, allergies, or hay fever risk for a trip, or when giving packing advice and someone in the household has allergies. Requires real lat/lng from on-screen context; never invent coordinates.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude" },
          lng: { type: "number", description: "Longitude" },
          locationName: {
            type: "string",
            description: "Human-readable place name, for your own reply",
          },
        },
        required: ["lat", "lng", "locationName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_DATA_CARD_TOOL_NAME,
      description:
        "Render a compact visual card of labeled facts/figures alongside your reply — e.g. a side-by-side comparison, a set of specs, a cost breakdown, or any other structured facts that are clearer as a small card than as prose. Applied immediately, no confirmation needed. Prefer a Markdown table in your reply text for anything with more than one comparable column of data (e.g. comparing 2+ options); use this only for a single flat list of label/value facts. Don't use it for plain narrative answers.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional short title for the card",
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
              },
              required: ["label", "value"],
            },
            description: "1-20 label/value fact rows",
          },
        },
        required: ["rows"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GENERATE_DOCUMENT_TOOL_NAME,
      description:
        "Generate a real, downloadable file — PDF, Word (docx), Excel (xlsx), or CSV — and attach it to your reply as a download chip. Applied immediately, no confirmation needed. Use this whenever the user asks you to create, export, write, or make a document, list, report, itinerary, spreadsheet, or table they can download or share — e.g. 'make me a packing list PDF', 'export this as a spreadsheet', 'write this up as a Word doc'. For 'pdf' or 'docx' provide `sections` (headings/paragraphs/bullets/an optional table per section). For 'csv' or 'xlsx' provide `table` (headers + rows) instead — tabular data only, no prose. After calling this, do NOT paste the full document content again in your reply text; just briefly describe what you made (e.g. 'Here's your packing list!') — the file itself is shown as an attachment. If the user didn't specify a format, pick the one that best fits the content (structured/narrative → pdf or docx; tabular/data → csv or xlsx) and mention you can redo it in another format if they'd prefer.",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["pdf", "docx", "xlsx", "csv"],
            description: "Which file format to generate",
          },
          filename: {
            type: "string",
            description:
              "Short descriptive filename without an extension, e.g. 'Packing List' or 'Trip Budget'",
          },
          title: {
            type: "string",
            description: "Document title/heading (pdf/docx only, optional)",
          },
          sections: {
            type: "array",
            description:
              "Required for pdf/docx. Ordered content blocks that make up the document.",
            items: {
              type: "object",
              properties: {
                heading: {
                  type: "string",
                  description: "Section heading (optional)",
                },
                paragraphs: {
                  type: "array",
                  items: { type: "string" },
                  description: "Plain-text paragraphs (optional)",
                },
                bullets: {
                  type: "array",
                  items: { type: "string" },
                  description: "Bullet-list items (optional)",
                },
                table: {
                  type: "object",
                  description: "An optional table within this section",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: {
                      type: "array",
                      items: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          table: {
            type: "object",
            description:
              "Required for csv/xlsx. Tabular data — column headers plus rows of matching length.",
            properties: {
              headers: { type: "array", items: { type: "string" } },
              rows: {
                type: "array",
                items: { type: "array", items: { type: "string" } },
              },
            },
          },
          sheetName: {
            type: "string",
            description:
              "Worksheet name for xlsx only (optional, max 31 chars)",
          },
        },
        required: ["format", "filename"],
      },
    },
  },
];

export const SOFT_TOOLS_EXTRA: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ...officeActionTools,
  ...universalReadTools,
  ...reminderReadTools,
  ...appOperationReadTools,
  listScheduledContactsTool,
  listContactChannelsTool,
  {
    type: "function",
    function: {
      name: SEARCH_TRIP_DOCUMENTS_TOOL_NAME,
      description:
        "Search across all uploaded travel documents (flight tickets, hotel confirmations, visas, itineraries, etc.) for information that matches a query — use this when the user asks 'what does my hotel confirmation say', 'when is my flight', 'what's my booking reference', 'do I have a document for X', etc. Optionally restrict to a specific tripId when you know which trip is being discussed. Returns matching document titles, types, and their key extracted fields.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to search for, e.g. 'check-in time', 'confirmation number', 'hotel name'",
          },
          tripId: {
            type: "number",
            description: "Optional trip ID to restrict search to a single trip",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_EXCHANGE_RATE_TOOL_NAME,
      description:
        "Get live currency exchange rates — use this whenever the user asks about converting money, exchange rates, or 'how much is X in Y currency'. Never guess exchange rates; always call this tool for accurate, up-to-date rates. Provide 1–6 target currency codes.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Base currency code (e.g. 'USD', 'GBP', 'EUR')",
          },
          to: {
            type: "array",
            items: { type: "string" },
            description:
              "Target currency codes (e.g. ['EUR', 'JPY', 'AUD']). Max 6.",
          },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_TRIP_CARD_TOOL_NAME,
      description:
        "Render a compact visual trip card alongside your reply — showing the trip name, destination, dates, status, and a countdown. Use whenever discussing a specific trip so the user can see a summary at a glance. If you have the tripId from search_household_data or context, always pass it so the card links to the trip detail page. Calculate countdownDays from today to the start date (negative = past, 0 = today, positive = future).",
      parameters: {
        type: "object",
        properties: {
          tripId: {
            type: "number",
            description:
              "Numeric trip ID from search_household_data or context — pass whenever you have it so the card is linkable",
          },
          name: { type: "string", description: "Trip name" },
          destination: {
            type: "string",
            description: "Destination (optional)",
          },
          startDate: {
            type: "string",
            description: "Start date, e.g. 'Jan 15, 2026' (optional)",
          },
          endDate: { type: "string", description: "End date (optional)" },
          status: {
            type: "string",
            description:
              "One of: planning, confirmed, ongoing, completed, cancelled (optional)",
          },
          countdownDays: {
            type: "number",
            description:
              "Days until trip start from today (negative if past, optional)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: FETCH_PAGE_TOOL_NAME,
      description:
        "Read the full text content of a specific web page — use this after web_search returns a promising source URL and you want more detail from it, or when the user pastes a URL and asks you to summarise or answer questions about what's on it. Returns the page content as clean markdown text, trimmed at 6 000 characters for long pages. Only call this with real URLs from search results or the user's own message — never invent a URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The full URL of the page to read, including https:// (e.g. https://example.com/article)",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_BARCODE_TOOL_NAME,
      description:
        "Look up any product by its barcode or UPC number. Returns the product name, brand, year, series/collection, description, and for Hallmark ornaments: SKU, artist, series, retail price, and collector value. Call this immediately whenever the user shares a barcode or UPC number — do not navigate anywhere, report the results in chat. Also use when the user asks what a scanned barcode is, or asks you to look up a product by code.",
      parameters: {
        type: "object",
        properties: {
          barcode: {
            type: "string",
            description:
              "The UPC, EAN-13, EAN-8, or other barcode number to look up",
          },
        },
        required: ["barcode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: ANALYZE_POTTERY_PHOTO_TOOL_NAME,
      description:
        "Run the app's real pottery vision analysis on the photo(s) the user just attached to THIS message — the exact same AI cataloguing pipeline used when uploading a piece (style, shape, maker/backstamp, glaze/decoration type, dimensions from a cutting mat if visible, decorative pattern, dominant colours, motifs, and a catalogue-style description). Use this whenever the user attaches a pottery/ceramic photo and asks what it is, its style, maker, glaze, or for any identification — do NOT answer from general knowledge instead, always run the real analysis. This is a one-off, non-destructive lookup: it never creates or edits anything in the pottery collection, even if the piece is never saved. Only works on photo(s) attached in the CURRENT message — if the user hasn't attached a photo this turn, tell them to attach one rather than calling this or guessing.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: ANALYZE_FABRIC_PHOTO_TOOL_NAME,
      description:
        "Run the app's real quilting-fabric vision analysis on the photo(s) the user just attached to THIS message — the exact same AI cataloguing pipeline used when uploading a fabric to the stash (print type, fabric line, designer, manufacturer, colorway, fiber content, dominant colours, motifs, style descriptors, and a catalogue-style description). Use this whenever the user attaches a fabric photo and asks to identify its print/designer/line or describe it — do NOT answer from general knowledge instead, always run the real analysis. This is a one-off, non-destructive lookup: it never creates or edits anything in the quilting stash, even if the fabric is never saved. Only works on photo(s) attached in the CURRENT message — if the user hasn't attached a photo this turn, tell them to attach one rather than calling this or guessing.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: ANALYZE_ORNAMENT_PHOTO_TOOL_NAME,
      description:
        "Run the app's real ornament vision analysis on the photo(s) the user just attached to THIS message — the exact same AI cataloguing pipeline used when uploading an ornament (name, series/collection, release year, dimensions, dominant colours, motifs, a catalogue-style description, and any UPC/barcode digits visible on the box or tag). Use this whenever the user attaches a Hallmark/Christmas ornament photo and asks to identify it — do NOT answer from general knowledge instead, always run the real analysis. This is a one-off, non-destructive lookup: it never creates or edits anything in the ornaments collection, even if the ornament is never saved. If a UPC is found in the result, you can follow up with lookup_product_barcode for Hallmark catalog details, or lookup_book_value for its collector value. Only works on photo(s) attached in the CURRENT message — if the user hasn't attached a photo this turn, tell them to attach one rather than calling this or guessing.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_BOOK_VALUE_TOOL_NAME,
      description:
        "Look up a Hallmark ornament's real secondary-market 'book value' by checking hallmarkornaments.com and hookedonhallmark.com and taking the higher of the two — the exact same two-source lookup the app itself runs when a user checks a saved item's book value. ALWAYS use this tool (never search_hallmark or general knowledge) when the user asks 'what's the book value', 'what's this worth for insurance/appraisal', or similar book-value questions about an ornament — search_hallmark only returns Hallmark's own catalog/retail listing info, which is a different number and will not match. Use ebay_search separately for current resale/market asking prices, which is a different question from book value.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The ornament's name (required)",
          },
          seriesOrCollection: {
            type: "string",
            description:
              "The Hallmark series/collection name, if known — improves match accuracy (optional)",
          },
          year: {
            type: "number",
            description: "The ornament's release year, if known (optional)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_RETAIL_VALUE_TOOL_NAME,
      description:
        "Look up a Hallmark ornament's original retail value (what it sold for new, e.g. MSRP) and a link to its official product page, via a grounded web search — the exact same lookup the app itself runs when a user checks a saved item's retail value. This is a DIFFERENT number from lookup_book_value (secondary-market/collector value) and from ebay_search (current resale/asking prices) — use this specifically when the user asks what the ornament originally sold for, its retail price, MSRP, or wants a link to buy/see it on the official product page.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The ornament's name (required)",
          },
          seriesOrCollection: {
            type: "string",
            description:
              "The Hallmark series/collection name, if known — improves match accuracy (optional)",
          },
          year: {
            type: "number",
            description: "The ornament's release year, if known (optional)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: QUERY_HOUSEHOLD_TOOL_NAME,
      description:
        "Look up live counts and recent items from the household's pottery collection, quilting stash, ornaments collection, and travel plans — use this when the user asks summary questions like 'how many pieces do I have', 'what's in my quilting stash', 'how many ornaments do I have', 'how many trips am I planning', etc. Returns real numbers and recent record names directly from the database. Do not estimate or guess counts — always call this instead. For questions about a SPECIFIC named item, use search_household_data first. Also supports 'app_config' to fetch current Control Panel settings (AI token limits, timeouts) — use this when the user asks about or describes a performance/quality problem that a tuning constant might fix.",
      parameters: {
        type: "object",
        properties: {
          include: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "pottery",
                "quilting",
                "ornaments",
                "travels",
                "app_config",
              ],
            },
            description:
              "Which data to include. Omit to include pottery, quilting, ornaments, and travels. Pass 'app_config' to also fetch the current Control Panel tuning settings.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SEARCH_HOUSEHOLD_TOOL_NAME,
      description:
        "Search the household database by keyword — trips (ALL statuses, not just active), pottery pieces, ornaments, fabrics, quilt patterns, and finished quilts. Call this as your FIRST step whenever the user mentions a specific item by name (e.g. 'my Croatia trip', 'the blue bowl', 'that star fabric', 'the snowman ornament') and you don't already have its ID in the current context. Returns matching items with their IDs so you can immediately follow up with show_trip_card (passing tripId), show_pottery_item, or show_fabric_swatch to display a rich visual card. NEVER ask clarifying questions about which item the user means before calling this — search first, then ask only if results are empty or multiple matches are ambiguous.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The distinctive name or identifier the user mentioned — extract ONLY the meaningful part, strip generic category words. Examples: user says 'the Catania trip' → query: 'Catania'; 'my Croatia trip' → query: 'Croatia'; 'the blue bowl' → query: 'blue bowl'; 'the snowman ornament' → query: 'snowman'; 'that star fabric' → query: 'star'. Never include words like trip, piece, ornament, fabric, quilt, pattern, item, my, the, a.",
          },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "trips",
                "pottery",
                "ornaments",
                "fabrics",
                "patterns",
                "quilts",
              ],
            },
            description:
              "Collections to search. Omit to search all (trips + pottery + ornaments + fabrics + patterns + quilts).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_POTTERY_ITEM_TOOL_NAME,
      description:
        "Render a rich visual pottery-item card for a specific piece from the collection — showing its photo, maker, style, AI description, and dominant colours. Use whenever the user asks about a specific pottery piece by name or ID, or when discussing a particular item. Fetch the itemId from search_household_data or from context in the conversation.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "number",
            description: "ID of the pottery item to display",
          },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_FABRIC_SWATCH_TOOL_NAME,
      description:
        "Render a fabric swatch card for a specific fabric from the quilting stash — showing its photo, designer, manufacturer, dominant colours, and AI description. Use when the user asks about a specific fabric by name or ID.",
      parameters: {
        type: "object",
        properties: {
          fabricId: {
            type: "number",
            description: "ID of the fabric to display",
          },
        },
        required: ["fabricId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_ORNAMENT_ITEM_TOOL_NAME,
      description:
        "Render a rich visual ornament card for a specific item from the Hallmark/ornament collection — showing its photo, series/collection, year, brand, and AI description. Use when the user asks about a specific ornament by name or ID. Fetch the itemId from search_household_data or from context.",
      parameters: {
        type: "object",
        properties: {
          itemId: {
            type: "number",
            description: "ID of the ornament item to display",
          },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SUGGEST_CLOTHING_LAYERS_TOOL_NAME,
      description:
        "Generate a practical layered clothing recommendation for a trip — base layers, mid layers, outer layers, activity-specific gear, and accessories. Call this when the user asks what to pack (clothing-wise), how to dress for a destination, or what to wear on a trip. Always call this instead of guessing clothing advice.",
      parameters: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description: "Trip destination (city, country, or region)",
          },
          startDate: {
            type: "string",
            description: "Trip start date (YYYY-MM-DD)",
          },
          endDate: {
            type: "string",
            description: "Trip end date (YYYY-MM-DD)",
          },
          activities: {
            type: "array",
            items: { type: "string" },
            description:
              "Planned activities, e.g. ['hiking', 'beach', 'formal dinner', 'city walking']",
          },
          climate: {
            type: "string",
            enum: [
              "hot",
              "cold",
              "tropical",
              "temperate",
              "desert",
              "variable",
            ],
            description:
              "Expected climate (optional; inferred from destination if omitted)",
          },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SHOW_DESTINATION_CARD_TOOL_NAME,
      description:
        "Render a destination card — showing the place name, country, bullet-point highlights, and a Google Maps link. Use whenever the user asks about a travel destination, wishlist entry, or trip location so they can get a quick visual summary with a one-click map link. Populate highlights with the 3–5 most useful or interesting facts you know about the destination.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Destination name (city, region, or landmark)",
          },
          country: {
            type: "string",
            description: "Country name (optional)",
          },
          highlights: {
            type: "array",
            items: { type: "string" },
            description: "3–5 short highlight sentences about the destination",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: CHECK_INTEGRATIONS_HEALTH_TOOL_NAME,
      description:
        "Check the health of every connected external service (Supabase, OpenRouter, Resend, Slack, AgentPhone, Google Maps, eBay, Sentry, etc.) and return their current status. Only available to the app owner (isOwner). Use this when the owner asks 'is Slack connected?', 'which services are broken?', 'is everything working?', 'what's the status of our integrations?', or any similar question about whether external APIs are reachable. Results are cached up to 5 minutes — tell the owner the cachedAt timestamp if they ask when it was last checked. Do not call this unless the user is the app owner.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: GET_OWNER_SETTINGS_TOOL_NAME,
      description:
        "Read-only report of every owner-configurable setting and its CURRENT value: Elaine's global AI configuration (chat/subagent models, per-request timeout, response token budget, model roles, feature toggles, timeouts, thresholds) plus every Control Panel app-config entry (module, key, label, current value, description). Only available to the app owner (isOwner). Use this when the owner asks things like 'what's my current tool-call budget?', 'which model are you using?', 'how often do you check Gmail?', 'what settings can I change?', or 'what is X currently set to?'. Never guess a current value from memory — always call this first. This tool never changes anything; to change a Control Panel value use update_app_config, and point the owner to the Owner Panel / Control Panel for the rest.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["all", "elaine", "app_config"],
            description:
              "Which settings to return: 'elaine' for the global AI config, 'app_config' for Control Panel entries, or 'all' (default) for both.",
          },
          module: {
            type: "string",
            description:
              "Optional Control Panel module name to filter app_config entries (e.g. 'openrouter', 'web_search'). Ignored for the elaine section.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: LIST_SENTRY_ISSUES_TOOL_NAME,
      description:
        "List current unresolved (or resolved) Sentry issues for the app, filtered by environment. Only available to the app owner (isOwner). Use this when the owner asks 'are there any production errors?', 'what errors are happening right now?', 'show me the Sentry issues', 'any crashes in production?', or similar questions about live application errors. Returns up to 50 issues sorted by most-recent. Gracefully returns 'not configured' if Sentry credentials are missing. Do not call this unless the user is the app owner.",
      parameters: {
        type: "object",
        properties: {
          environment: {
            type: "string",
            enum: ["production", "development"],
            description:
              "Which environment to query. Default to 'production' unless the owner specifically asks about development.",
          },
          query: {
            type: "string",
            enum: ["is:unresolved", "is:resolved"],
            description:
              "Whether to fetch unresolved (default) or resolved issues.",
          },
        },
        required: [],
      },
    },
  },
];

export const ACTION_TOOL_NAMES = new Set<string>(
  ACTION_TOOLS.map(
    (t) =>
      (t as OpenAI.Chat.Completions.ChatCompletionFunctionTool).function.name,
  ),
);

export function buildElainePlannerToolCatalog(): ElainePlannerTool[] {
  const registry = buildElaineCapabilityRegistry([
    ...ACTION_TOOLS,
    ...SOFT_TOOLS,
    ...SOFT_TOOLS_EXTRA,
  ]);
  const catalog = buildPlannerCatalogFromCapabilities(registry);
  assertElaineToolFamilyCoverage(catalog.map((tool) => tool.name));
  return catalog;
}

export const ELAINE_PLANNER_TOOL_CATALOG = buildElainePlannerToolCatalog();
