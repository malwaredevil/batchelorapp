import * as Sentry from "@sentry/node";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  and,
  eq,
  desc,
  isNull,
  count,
  inArray,
  sql,
  ilike,
  or,
} from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  appUsers,
  elaineConversations,
  elaineNudges,
  elaineSettings,
  elaineMemory,
  messengerMessages,
  elaineGlobalConfig,
  elaineHistoryConversations,
  elaineHistoryMessages,
  elaineDailyBriefs,
  travelsTrips,
  travelsTripDocuments,
  travelsDocChunks,
  travelsTripPhotos,
  travelsReminders,
  travelsWishlist,
  travelsPackingLists,
  travelsPackingItems,
  travelsGoogleCalendarConnections,
  travelsConnectedCalendars,
  travelsCardLayoutPreferences,
  travelsTripCardCollapseState,
  potteryItems,
  fabrics,
  quiltPatterns,
  finishedQuilts,
  ornamentsItems,
  phoneVerificationCodes,
} from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { phoneVerifyLimiter, aiLimiter } from "../middleware/rateLimit";
import { logger } from "../lib/logger";
import { callModel, callModelWithSubagent } from "../lib/ai-client";
import { embedText } from "../lib/openai";
import {
  getElaineGlobalConfig,
  invalidateElaineGlobalConfigCache,
} from "../lib/elaine-config";
import {
  APP_CONFIG_DEFAULTS,
  getAllConfig,
  updateConfigValue,
} from "../lib/app-config";
import { listOpenRouterModels } from "../lib/openrouter-models";
import { deleteTripPhoto } from "../lib/travels/storage";
import { deleteDocument } from "../lib/travels-storage";
import { getValidAccessToken } from "../lib/google-calendar-tokens";
import { rescanTripDocument } from "../routes/travels/documents";
import {
  getReminderSyncTarget,
  syncReminderCalendarEvents,
  deleteAllReminderCalendarEvents,
} from "../routes/travels/reminders";
import {
  generateItineraryForTrip,
  ItineraryActionError,
} from "../routes/travels/ai";
import {
  sendAssistantEmail,
  sendTestEmail,
  resendConfigured,
} from "../lib/email";
import {
  sendSms,
  SmsRegistrationPendingError,
  SmsOptedOutError,
} from "../lib/sms";
import { webSearch, fetchPage } from "../lib/web-search";
import {
  lookupEbayMarketValue,
  buildEbayQuery,
} from "../lib/pottery/ebay-market-value";
import {
  searchHallmark,
  lookupHallmarkFromDb,
} from "../lib/ornaments/hallmark-search";
import { lookupBarcode } from "../lib/ornaments/barcode";
import { lookupFlightPrices } from "../lib/travels/flights";
import { fetchJsonSafe } from "../lib/ssrf-safe-fetch";
import { consultExperts } from "../lib/expert-consult";
import {
  getWeatherForecast,
  getAirQuality,
  getPollenForecast,
  searchPlaces,
  computeRoute,
  type TravelMode,
} from "../lib/travels/google-maps";
import {
  potteryActionSchemas,
  potteryActionExecutors,
  buildPotteryActionLabel,
  potteryActionTools,
  type PotteryActionType,
} from "./pottery-actions";
import {
  quiltingActionSchemas,
  quiltingActionExecutors,
  buildQuiltingActionLabel,
  quiltingActionTools,
  type QuiltingActionType,
} from "./quilting-actions";
import {
  ornamentActionSchemas,
  ornamentActionExecutors,
  buildOrnamentActionLabel,
  ornamentActionTools,
  type OrnamentActionType,
} from "./ornaments-actions";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { multerLimitForPrefix } from "../lib/upload-limits";
import {
  randomUUID,
  randomBytes,
  randomInt,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../lib/env";
import { withRetry } from "../lib/retry";
import {
  ensureBucketWithPolicy,
  ELAINE_ATTACHMENTS_BUCKET_POLICY,
} from "../lib/storage-core";
import pdfParse from "pdf-parse";

const router: IRouter = Router();
router.use(requireAuth);

// elAIne is a single persistent, personable assistant that follows the user
// across every page of the Travels app (replaces the old per-trip chat).
// She is given: (1) whatever is live on the user's current screen, including
// unsaved input, (2) shared household memory from every family member, and
// (3) real OpenAI-style function/tool calling for everything she can do:
// proposing a write-action (confirmed by the user before it executes),
// suggesting navigation (never auto-followed), and remembering a new
// household fact (applied immediately, like today's chat text). Tool defs
// live in one registry below (ACTION_DEFS) so adding a new confirmable
// action later is a single addition, not edits scattered across a prompt,
// a regex, and a switch statement.

const ASSISTANT_SUBAGENT_INSTRUCTIONS =
  "You are a fast research helper for a friendly travel assistant named Elaine. You will be given a small, self-contained sub-task (e.g. list facts, summarize options, draft a short list). Answer concisely and factually in plain text so Elaine can incorporate your answer into her reply.";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachmentUrls?: AttachmentRef[];
};

// A single image/PDF attachment stored alongside a user message. `name` is
// only meaningful for PDFs (the original upload filename — the storage path
// itself is a random UUID and must never be shown to the user).
type AttachmentRef = { url: string; type: "image" | "pdf"; name?: string };

// Rows stored before this field existed as objects were plain URL strings.
// Normalize on read so older conversations still render sensibly (falling
// back to "document.pdf" instead of the ugly storage-path UUID filename).
function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): AttachmentRef => {
    if (typeof item === "string") {
      return { url: item, type: /\.pdf(\?|$)/i.test(item) ? "pdf" : "image" };
    }
    return item as AttachmentRef;
  });
}

const APP_IDS = [
  "travels",
  "pottery",
  "quilting",
  "ornaments",
  "hub",
  "elaine",
] as const;
type AppId = (typeof APP_IDS)[number];

const ChatBody = z.object({
  // Empty string is allowed when the user sends attachments only (no text).
  message: z.string().max(4000),
  // Freeform description of what's currently on the user's screen — page
  // name plus any live/unsaved field values a page has chosen to publish via
  // usePageAssistantContext(). Never persisted; only used for this one call.
  pageContext: z.string().max(6000).nullish(),
  // Which app surface the user is currently chatting from, so navigation
  // suggestions stay scoped to real paths in that app. Defaults to "hub"
  // since Elaine is one continuous conversation shown everywhere.
  appId: z.enum(APP_IDS).default("hub"),
  // Named conversation to continue. Omit or send null to auto-create a new one.
  conversationId: z.number().int().positive().nullable().optional(),
  // Signed Supabase Storage URLs for images the user attached (max 5, 5 MB each).
  attachmentUrls: z.array(z.string()).max(5).optional(),
  // Auto-captured screenshot of the current page — included in model context
  // for visual awareness but NOT persisted in conversation history.
  pageScreenshotUrl: z.string().url().max(2000).optional(),
  // PDF attachments: signed URL + original filename + already-extracted text.
  attachmentPdfs: z
    .array(
      z.object({
        url: z.string().max(2000),
        name: z.string().max(200),
        extractedText: z.string().max(8000).optional(),
      }),
    )
    .max(3)
    .optional(),
  // User's current geolocation from navigator.geolocation — sent by the
  // frontend when available. Lets Elaine answer location-aware queries
  // (nearby places, weather, directions) without asking first.
  userLat: z.number().min(-90).max(90).optional(),
  userLng: z.number().min(-180).max(180).optional(),
});

// How elAIne confirms a turn that proposes more than one write-action:
// "one_by_one" (default, safest) shows each proposed action individually,
// confirm/skip before the next appears; "all_at_once" shows every proposed
// action together with one Confirm all / Cancel all; "auto_run" executes
// them immediately with no confirmation step and reports back afterward.
const ACTION_CONFIRMATION_MODES = [
  "one_by_one",
  "all_at_once",
  "auto_run",
] as const;
type ActionConfirmationMode = (typeof ACTION_CONFIRMATION_MODES)[number];

// Desktop dimensions for the floating chat widget popup — "compact" is the
// default (a normal-sized popup, not screen-filling); mobile always fills
// the available width regardless of this setting (see ElaineWidget).
const CHAT_WINDOW_SIZES = ["compact", "comfortable", "large"] as const;
type ChatWindowSize = (typeof CHAT_WINDOW_SIZES)[number];

const SettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    actionConfirmationMode: z.enum(ACTION_CONFIRMATION_MODES).optional(),
    chatWindowSize: z.enum(CHAT_WINDOW_SIZES).optional(),
  })
  .refine(
    (v) =>
      v.enabled !== undefined ||
      v.actionConfirmationMode !== undefined ||
      v.chatWindowSize !== undefined,
    {
      message: "At least one setting must be provided",
    },
  );

// Copied intentionally from routes/travels/trips.ts and wishlist.ts, which
// each keep their own small copy of this helper rather than sharing one.
async function geocodeDestination(
  destination: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`;
    const data = await fetchJsonSafe<Array<{ lat: string; lon: string }>>(url, {
      headers: { "User-Agent": "Batchelor-App/1.0" },
    });
    if (data[0])
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch {
    return null;
  }
}

async function getTripLabelInfo(
  tripId: number,
): Promise<{ title: string; destination: string } | null> {
  const [trip] = await db
    .select({
      title: travelsTrips.title,
      destination: travelsTrips.destination,
    })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return trip ?? null;
}

async function getWishlistLabelInfo(
  wishlistId: number,
): Promise<{ destination: string } | null> {
  const [item] = await db
    .select({ destination: travelsWishlist.destination })
    .from(travelsWishlist)
    .where(eq(travelsWishlist.id, wishlistId));
  return item ?? null;
}

async function getReminderLabelInfo(
  reminderId: number,
): Promise<{ title: string } | null> {
  const [item] = await db
    .select({ title: travelsReminders.title })
    .from(travelsReminders)
    .where(eq(travelsReminders.id, reminderId));
  return item ?? null;
}

async function getDocumentLabelInfo(documentId: number): Promise<{
  documentType: string | null;
  originalFilename: string | null;
} | null> {
  const [item] = await db
    .select({
      documentType: travelsTripDocuments.documentType,
      originalFilename: travelsTripDocuments.originalFilename,
    })
    .from(travelsTripDocuments)
    .where(eq(travelsTripDocuments.id, documentId));
  return item ?? null;
}

const TRIP_STATUS_ENUM = [
  "wishlist",
  "planning",
  "booked",
  "active",
  "completed",
] as const;

// ---------------------------------------------------------------------------
// Action registry. Each entry is the single source of truth for one
// confirmable write-action: its Zod payload schema (server-side validation,
// unchanged trust boundary), the JSON Schema exposed to the model as a
// function tool, how to phrase the user-facing confirmation label, and how
// to execute it once the user confirms. To add a new action in future: add
// one entry here, and add its variant to the ActionBody union below.
// ---------------------------------------------------------------------------

const CreateTripActionPayload = z.object({
  title: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  status: z.enum(TRIP_STATUS_ENUM).optional(),
  startDate: z.string().max(20).optional(),
  endDate: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});

const AddWishlistActionPayload = z.object({
  destination: z.string().min(1).max(200),
  targetDate: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});

const AddPackingItemActionPayload = z.object({
  tripId: z.number().int().positive(),
  item: z.string().min(1).max(200),
});

const UpdateTripStatusActionPayload = z.object({
  tripId: z.number().int().positive(),
  status: z.enum(TRIP_STATUS_ENUM),
});

// At least one editable field must be present — this action is for editing
// existing trip details (dates/notes/destination), not for status changes
// (that stays on update_trip_status) or full trip replacement.
const UpdateTripDetailsActionPayload = z
  .object({
    tripId: z.number().int().positive(),
    destination: z.string().min(1).max(200).optional(),
    startDate: z.string().max(20).optional(),
    endDate: z.string().max(20).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (payload) =>
      payload.destination !== undefined ||
      payload.startDate !== undefined ||
      payload.endDate !== undefined ||
      payload.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

const CancelTripActionPayload = z.object({
  tripId: z.number().int().positive(),
});

const MarkWishlistDoneActionPayload = z.object({
  wishlistId: z.number().int().positive(),
  done: z.boolean().optional(),
});

const RemoveWishlistItemActionPayload = z.object({
  wishlistId: z.number().int().positive(),
});

// Wishlist entries are the closest thing this app has to a standalone
// "destination" record (Travels' /destinations page is a read-only grouping
// of trips by destination string, not an editable resource — see
// destinations.ts). Destination lifecycle management maps onto: create via
// add_wishlist/create_trip, update via this action or update_trip_details,
// delete via remove_wishlist_item/cancel_trip.
const UpdateWishlistItemActionPayload = z
  .object({
    wishlistId: z.number().int().positive(),
    destination: z.string().min(1).max(200).optional(),
    targetDate: z.string().max(20).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (payload) =>
      payload.destination !== undefined ||
      payload.targetDate !== undefined ||
      payload.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

const RemovePackingItemActionPayload = z.object({
  tripId: z.number().int().positive(),
  item: z.string().min(1).max(200),
});

const AddReminderActionPayload = z.object({
  tripId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().max(20).optional(),
  recipientEmails: z.array(z.email()).max(20).optional(),
  syncToCalendar: z.boolean().optional(),
});

const SyncReminderToCalendarActionPayload = z.object({
  tripId: z.number().int().positive(),
  reminderId: z.number().int().positive(),
  syncToCalendar: z.boolean().optional(),
});

const EditReminderActionPayload = z.object({
  tripId: z.number().int().positive(),
  reminderId: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().max(20).nullable().optional(),
  done: z.boolean().optional(),
  recipientEmails: z.array(z.email()).max(20).optional(),
  syncToCalendar: z.boolean().optional(),
});

const DeleteReminderActionPayload = z.object({
  tripId: z.number().int().positive(),
  reminderId: z.number().int().positive(),
});

const AddConnectedCalendarActionPayload = z.object({
  googleCalendarId: z.string().min(1).max(500),
  calendarSummary: z.string().min(1).max(200),
  primaryColor: z.string().min(1).max(20).optional(),
});

const DisconnectCalendarActionPayload = z.object({});

const AddItineraryDayActionPayload = z.object({
  tripId: z.number().int().positive(),
  date: z.string().max(20).optional(),
  title: z.string().min(1).max(200),
  activityName: z.string().max(200).optional(),
  activityTime: z.string().max(20).optional(),
  activityDescription: z.string().max(1000).optional(),
});

const RegenerateItineraryDayActionPayload = z.object({
  tripId: z.number().int().positive(),
  dayNumber: z.number().int().positive(),
});

const RescanDocumentActionPayload = z.object({
  tripId: z.number().int().positive(),
  documentId: z.number().int().positive(),
});

const GenerateItineraryActionPayload = z.object({
  tripId: z.number().int().positive(),
});

const ConfirmItineraryActivityActionPayload = z.object({
  tripId: z.number().int().positive(),
  dayNumber: z.number().int().positive(),
  activityNumber: z.number().int().positive(),
  confirmed: z.boolean().optional(),
});

const RemoveItineraryActivityActionPayload = z.object({
  tripId: z.number().int().positive(),
  dayNumber: z.number().int().positive(),
  activityNumber: z.number().int().positive(),
});

const SendEmailActionPayload = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

// Hub account-settings actions. These act on the calling user's own account
// only (no id in the payload) and mirror routes/auth.ts's
// /auth/test-email, /auth/test-sms, /auth/phone/send-code, /auth/phone/verify
// exactly, including their consent/format/rate-limit requirements.
const SendTestEmailActionPayload = z.object({});

const SendTestSmsActionPayload = z.object({});

// Matches the E.164 validation in routes/auth.ts's phone verification route.
const E164_RE = /^\+[1-9]\d{6,14}$/;
const PHONE_CODE_EXPIRY_MS = 1000 * 60 * 10;
const MAX_PHONE_CODE_ATTEMPTS = 5;

const SendPhoneVerificationCodeActionPayload = z.object({
  phoneNumber: z.string().regex(E164_RE, "Must be in E.164 format"),
  consent: z.literal(true),
});

const VerifyPhoneCodeActionPayload = z.object({
  code: z.string().regex(/^\d{6}$/, "Must be a 6-digit code"),
});

// Hub Elaine-settings action — updates the calling user's own per-user Elaine
// preferences (enabled, chatWindowSize). actionConfirmationMode is handled by
// the separate set_action_confirmation_mode soft tool and is not included here.
const UpdateElaineSettingsActionPayload = z
  .object({
    enabled: z.boolean().optional(),
    chatWindowSize: z.enum(CHAT_WINDOW_SIZES).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.chatWindowSize !== undefined, {
    message: "At least one setting must be provided",
  });

const GenerateTripShareLinkActionPayload = z.object({
  tripId: z.number().int().positive(),
});

const RevokeTripShareLinkActionPayload = z.object({
  tripId: z.number().int().positive(),
});

const DeleteTripPhotoActionPayload = z.object({
  tripId: z.number().int().positive(),
  photoId: z.number().int().positive(),
});

// Card ids must match the whitelists enforced server-side in
// routes/travels/card-layout.ts (CARD_ORDER_IDS / COLLAPSE_CARD_IDS). Kept in
// sync here since that route doesn't export them; unknown ids are silently
// dropped by these executors, mirroring the route's own behavior.
const CARD_ORDER_IDS = [
  "reminders",
  "itinerary",
  "documents",
  "packing-todo",
  "photos",
  "magnets",
  "weather-nearby",
] as const;

const COLLAPSE_CARD_IDS = [
  "reminders",
  "itinerary",
  "documents",
  "packing",
  "todo",
  "photos",
  "magnets",
  "weather-nearby",
] as const;

const UpdateCardLayoutActionPayload = z.object({
  cardOrder: z.array(z.string().min(1).max(50)).min(1).max(50),
});

const UpdateTripCardCollapseActionPayload = z.object({
  tripId: z.number().int().positive(),
  collapsedCards: z.array(z.string().min(1).max(50)).max(50),
});

// Control Panel config update — owner-only, applies to app-wide tuning
// constants stored in app_config. The executor re-checks isOwner so
// non-owner users who somehow trigger the action still get a 403.
const UpdateAppConfigActionPayload = z.object({
  module: z.string().min(1).max(100),
  key: z.string().min(1).max(100),
  value: z.string().min(0).max(1000),
});

const ActionBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_trip"),
    payload: CreateTripActionPayload,
  }),
  z.object({
    type: z.literal("add_wishlist"),
    payload: AddWishlistActionPayload,
  }),
  z.object({
    type: z.literal("add_packing_item"),
    payload: AddPackingItemActionPayload,
  }),
  z.object({
    type: z.literal("update_trip_status"),
    payload: UpdateTripStatusActionPayload,
  }),
  z.object({
    type: z.literal("update_trip_details"),
    payload: UpdateTripDetailsActionPayload,
  }),
  z.object({
    type: z.literal("cancel_trip"),
    payload: CancelTripActionPayload,
  }),
  z.object({
    type: z.literal("mark_wishlist_done"),
    payload: MarkWishlistDoneActionPayload,
  }),
  z.object({
    type: z.literal("remove_wishlist_item"),
    payload: RemoveWishlistItemActionPayload,
  }),
  z.object({
    type: z.literal("update_wishlist_item"),
    payload: UpdateWishlistItemActionPayload,
  }),
  z.object({
    type: z.literal("remove_packing_item"),
    payload: RemovePackingItemActionPayload,
  }),
  z.object({
    type: z.literal("add_reminder"),
    payload: AddReminderActionPayload,
  }),
  z.object({
    type: z.literal("sync_reminder_to_calendar"),
    payload: SyncReminderToCalendarActionPayload,
  }),
  z.object({
    type: z.literal("edit_reminder"),
    payload: EditReminderActionPayload,
  }),
  z.object({
    type: z.literal("delete_reminder"),
    payload: DeleteReminderActionPayload,
  }),
  z.object({
    type: z.literal("add_itinerary_day"),
    payload: AddItineraryDayActionPayload,
  }),
  z.object({
    type: z.literal("regenerate_itinerary_day"),
    payload: RegenerateItineraryDayActionPayload,
  }),
  z.object({
    type: z.literal("add_connected_calendar"),
    payload: AddConnectedCalendarActionPayload,
  }),
  z.object({
    type: z.literal("disconnect_calendar"),
    payload: DisconnectCalendarActionPayload,
  }),
  z.object({
    type: z.literal("rescan_document"),
    payload: RescanDocumentActionPayload,
  }),
  z.object({
    type: z.literal("generate_itinerary"),
    payload: GenerateItineraryActionPayload,
  }),
  z.object({
    type: z.literal("confirm_itinerary_activity"),
    payload: ConfirmItineraryActivityActionPayload,
  }),
  z.object({
    type: z.literal("remove_itinerary_activity"),
    payload: RemoveItineraryActivityActionPayload,
  }),
  z.object({ type: z.literal("send_email"), payload: SendEmailActionPayload }),
  z.object({
    type: z.literal("send_test_email"),
    payload: SendTestEmailActionPayload,
  }),
  z.object({
    type: z.literal("send_test_sms"),
    payload: SendTestSmsActionPayload,
  }),
  z.object({
    type: z.literal("send_phone_verification_code"),
    payload: SendPhoneVerificationCodeActionPayload,
  }),
  z.object({
    type: z.literal("verify_phone_code"),
    payload: VerifyPhoneCodeActionPayload,
  }),
  z.object({
    type: z.literal("update_elaine_settings"),
    payload: UpdateElaineSettingsActionPayload,
  }),
  z.object({
    type: z.literal("generate_trip_share_link"),
    payload: GenerateTripShareLinkActionPayload,
  }),
  z.object({
    type: z.literal("revoke_trip_share_link"),
    payload: RevokeTripShareLinkActionPayload,
  }),
  z.object({
    type: z.literal("delete_trip_photo"),
    payload: DeleteTripPhotoActionPayload,
  }),
  z.object({
    type: z.literal("update_card_layout"),
    payload: UpdateCardLayoutActionPayload,
  }),
  z.object({
    type: z.literal("update_trip_card_collapse"),
    payload: UpdateTripCardCollapseActionPayload,
  }),
  z.object({
    type: z.literal("update_app_config"),
    payload: UpdateAppConfigActionPayload,
  }),
  ...potteryActionSchemas,
  ...quiltingActionSchemas,
  ...ornamentActionSchemas,
]);

type PendingAction = z.infer<typeof ActionBody>;
type ActionType = PendingAction["type"];

const POTTERY_ACTION_TYPES = new Set<string>([
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
]);
const QUILTING_ACTION_TYPES = new Set<string>([
  "update_fabric",
  "delete_fabric",
  "update_pattern",
  "delete_pattern",
  "create_shopping_item",
  "update_shopping_item",
  "delete_shopping_item",
  "create_quilting_category",
  "delete_quilting_category",
]);
const ORNAMENT_ACTION_TYPES = new Set<string>([
  "update_ornament_item",
  "delete_ornament_item",
  "create_ornament_category",
  "delete_ornament_category",
  "lock_ornament_field",
  "update_ornament_item_categories",
  "delete_ornament_photo",
  "promote_ornament_photo",
  "merge_ornament_categories",
  "bulk_reanalyze_ornaments",
]);

async function buildActionLabel(action: PendingAction): Promise<string> {
  switch (action.type) {
    case "create_trip":
      return `Create a trip to ${action.payload.destination}${
        action.payload.title &&
        action.payload.title !== action.payload.destination
          ? ` ("${action.payload.title}")`
          : ""
      }`;
    case "add_wishlist":
      return `Add "${action.payload.destination}" to the wishlist`;
    case "add_packing_item":
      return `Add "${action.payload.item}" to the packing list`;
    case "update_trip_status": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Move ${name} to "${action.payload.status}"`;
    }
    case "update_trip_details": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      const changes: string[] = [];
      if (action.payload.destination !== undefined)
        changes.push(`destination to "${action.payload.destination}"`);
      if (action.payload.startDate !== undefined)
        changes.push(`start date to ${action.payload.startDate}`);
      if (action.payload.endDate !== undefined)
        changes.push(`end date to ${action.payload.endDate}`);
      if (action.payload.notes !== undefined) changes.push(`notes`);
      return `Update ${name}'s ${changes.join(", ")}`;
    }
    case "cancel_trip": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      return trip
        ? `Cancel your trip to ${trip.destination}`
        : `Cancel this trip`;
    }
    case "mark_wishlist_done": {
      const item = await getWishlistLabelInfo(action.payload.wishlistId);
      const name = item ? `"${item.destination}"` : "this wishlist item";
      return action.payload.done === false
        ? `Mark ${name} as not done`
        : `Mark ${name} as done on the wishlist`;
    }
    case "remove_wishlist_item": {
      const item = await getWishlistLabelInfo(action.payload.wishlistId);
      return item
        ? `Remove "${item.destination}" from the wishlist`
        : `Remove this item from the wishlist`;
    }
    case "update_wishlist_item": {
      const item = await getWishlistLabelInfo(action.payload.wishlistId);
      const name = item ? `"${item.destination}"` : "this wishlist item";
      const changes: string[] = [];
      if (action.payload.destination !== undefined)
        changes.push(`destination to "${action.payload.destination}"`);
      if (action.payload.targetDate !== undefined)
        changes.push(
          action.payload.targetDate === null
            ? `target date removed`
            : `target date to ${action.payload.targetDate}`,
        );
      if (action.payload.notes !== undefined) changes.push(`notes`);
      return `Update ${name}'s ${changes.join(", ")}`;
    }
    case "remove_packing_item":
      return `Remove "${action.payload.item}" from the packing list`;
    case "add_reminder": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      const sync = action.payload.syncToCalendar ?? true;
      return `Add a reminder "${action.payload.title}"${
        action.payload.dueDate ? ` due ${action.payload.dueDate}` : ""
      } for ${name}${sync ? " and sync it to the calendar" : ""}`;
    }
    case "sync_reminder_to_calendar": {
      const reminder = await getReminderLabelInfo(action.payload.reminderId);
      const name = reminder ? `"${reminder.title}"` : "this reminder";
      return action.payload.syncToCalendar === false
        ? `Stop syncing ${name} to the calendar`
        : `Sync ${name} to the calendar`;
    }
    case "edit_reminder": {
      const reminder = await getReminderLabelInfo(action.payload.reminderId);
      const name = reminder ? `"${reminder.title}"` : "this reminder";
      const changes: string[] = [];
      if (action.payload.title !== undefined)
        changes.push(`title to "${action.payload.title}"`);
      if (action.payload.description !== undefined) changes.push(`description`);
      if (action.payload.dueDate !== undefined)
        changes.push(
          action.payload.dueDate
            ? `due date to ${action.payload.dueDate}`
            : "clear the due date",
        );
      if (action.payload.done !== undefined)
        changes.push(action.payload.done ? "mark as done" : "mark as not done");
      if (action.payload.recipientEmails !== undefined)
        changes.push(`recipients`);
      if (action.payload.syncToCalendar !== undefined)
        changes.push(
          action.payload.syncToCalendar
            ? "sync to the calendar"
            : "stop syncing to the calendar",
        );
      return `Update ${name}${changes.length ? `: ${changes.join(", ")}` : ""}`;
    }
    case "delete_reminder": {
      const reminder = await getReminderLabelInfo(action.payload.reminderId);
      const name = reminder ? `"${reminder.title}"` : "this reminder";
      return `Delete ${name}`;
    }
    case "add_itinerary_day": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Add a day "${action.payload.title}"${
        action.payload.date ? ` on ${action.payload.date}` : ""
      } to ${name}'s itinerary`;
    }
    case "regenerate_itinerary_day": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Regenerate day ${action.payload.dayNumber} of ${name}'s itinerary`;
    }
    case "add_connected_calendar":
      return `Connect your "${action.payload.calendarSummary}" Google Calendar`;
    case "disconnect_calendar":
      return `Disconnect your Google Calendar`;
    case "rescan_document": {
      const doc = await getDocumentLabelInfo(action.payload.documentId);
      const name = doc
        ? `"${doc.originalFilename ?? (doc.documentType ? doc.documentType.replace(/_/g, " ") : "document")}"`
        : "this document";
      return `Re-scan ${name} to refresh its extracted details`;
    }
    case "generate_itinerary": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Generate a full AI itinerary for ${name}`;
    }
    case "confirm_itinerary_activity": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return action.payload.confirmed === false
        ? `Mark activity ${action.payload.activityNumber} on day ${action.payload.dayNumber} of ${name}'s itinerary as tentative again`
        : `Mark activity ${action.payload.activityNumber} on day ${action.payload.dayNumber} of ${name}'s itinerary as firm`;
    }
    case "remove_itinerary_activity": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Remove activity ${action.payload.activityNumber} from day ${action.payload.dayNumber} of ${name}'s itinerary`;
    }
    case "send_email":
      return `Email you "${action.payload.subject}"`;
    case "send_test_email":
      return `Send a test email to your account address`;
    case "send_test_sms":
      return `Send a test text message to your verified phone number`;
    case "send_phone_verification_code":
      return `Send a verification code by text to ${action.payload.phoneNumber}`;
    case "verify_phone_code":
      return `Verify your phone number with code ${action.payload.code}`;
    case "update_elaine_settings": {
      const changes: string[] = [];
      if (action.payload.enabled !== undefined)
        changes.push(
          action.payload.enabled ? "enable Elaine" : "disable Elaine",
        );
      if (action.payload.chatWindowSize !== undefined)
        changes.push(`set chat window to "${action.payload.chatWindowSize}"`);
      return changes.join(" and ");
    }
    case "generate_trip_share_link": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Generate a public share link for ${name}`;
    }
    case "revoke_trip_share_link": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Revoke ${name}'s share link (breaks any copy already shared)`;
    }
    case "delete_trip_photo": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Delete this photo from ${name}`;
    }
    case "update_card_layout":
      return `Reorder your Trip Detail cards (${action.payload.cardOrder.join(", ")})`;
    case "update_trip_card_collapse": {
      const trip = await getTripLabelInfo(action.payload.tripId);
      const name = trip ? `"${trip.title || trip.destination}"` : "this trip";
      return `Update which cards are collapsed on ${name}'s page`;
    }
    case "update_app_config":
      return `Update Control Panel: set ${action.payload.module}.${action.payload.key} to "${action.payload.value}"`;
    default:
      if (POTTERY_ACTION_TYPES.has(action.type as PotteryActionType)) {
        return buildPotteryActionLabel(
          action as { type: PotteryActionType; payload: unknown },
        );
      }
      if (QUILTING_ACTION_TYPES.has(action.type as QuiltingActionType)) {
        return buildQuiltingActionLabel(
          action as { type: QuiltingActionType; payload: unknown },
        );
      }
      if (ORNAMENT_ACTION_TYPES.has(action.type as OrnamentActionType)) {
        return buildOrnamentActionLabel(
          action as { type: OrnamentActionType; payload: unknown },
        );
      }
      return "Perform this action";
  }
}

// One executor per action type, keyed by type, so the confirm-and-execute
// route below is a single lookup instead of a growing if/else chain. Every
// write here is scoped to the calling user the same way the equivalent
// hand-written routes (trips.ts, wishlist.ts) are.
type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

type TravelActionType = Exclude<
  ActionType,
  PotteryActionType | QuiltingActionType | OrnamentActionType
>;

const TRAVEL_ACTION_EXECUTORS: Record<TravelActionType, ActionExecutor> = {
  create_trip: (async (
    payload: z.infer<typeof CreateTripActionPayload>,
    userId: number,
  ) => {
    const coords = await geocodeDestination(payload.destination);
    const [row] = await db
      .insert(travelsTrips)
      .values({
        title: payload.title,
        destination: payload.destination,
        status: payload.status ?? "wishlist",
        startDate: payload.startDate,
        endDate: payload.endDate,
        notes: payload.notes,
        userId,
        ...(coords ?? {}),
      })
      .returning();
    return { status: 201, body: { type: "create_trip", result: row } };
  }) as ActionExecutor,

  add_wishlist: (async (
    payload: z.infer<typeof AddWishlistActionPayload>,
    userId: number,
  ) => {
    const coords = await geocodeDestination(payload.destination);
    const [row] = await db
      .insert(travelsWishlist)
      .values({
        destination: payload.destination,
        targetDate: payload.targetDate,
        notes: payload.notes,
        userId,
        ...(coords ?? {}),
      })
      .returning();
    return { status: 201, body: { type: "add_wishlist", result: row } };
  }) as ActionExecutor,

  add_packing_item: (async (
    payload: z.infer<typeof AddPackingItemActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    let [list] = await db
      .select({ id: travelsPackingLists.id })
      .from(travelsPackingLists)
      .where(eq(travelsPackingLists.tripId, payload.tripId));
    if (!list) {
      [list] = await db
        .insert(travelsPackingLists)
        .values({ tripId: payload.tripId })
        .returning({ id: travelsPackingLists.id });
    }
    const [{ maxOrder }] = await db
      .select({
        maxOrder: sql<number | null>`max(${travelsPackingItems.sortOrder})`,
      })
      .from(travelsPackingItems)
      .where(eq(travelsPackingItems.listId, list.id));
    const [row] = await db
      .insert(travelsPackingItems)
      .values({
        listId: list.id,
        text: payload.item,
        sortOrder: maxOrder != null ? maxOrder + 1 : 0,
        addedByUserId: userId,
      })
      .returning();
    return { status: 200, body: { type: "add_packing_item", result: row } };
  }) as ActionExecutor,

  update_trip_status: (async (
    payload: z.infer<typeof UpdateTripStatusActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) return { status: 404, body: { error: "Trip not found" } };
    const [row] = await db
      .update(travelsTrips)
      .set({ status: payload.status })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return { status: 200, body: { type: "update_trip_status", result: row } };
  }) as ActionExecutor,

  update_trip_details: (async (
    payload: z.infer<typeof UpdateTripDetailsActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) return { status: 404, body: { error: "Trip not found" } };
    const updates: Partial<typeof travelsTrips.$inferInsert> = {};
    if (payload.destination !== undefined)
      updates.destination = payload.destination;
    if (payload.startDate !== undefined) updates.startDate = payload.startDate;
    if (payload.endDate !== undefined) updates.endDate = payload.endDate;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.destination !== undefined) {
      const coords = await geocodeDestination(payload.destination);
      if (coords) Object.assign(updates, coords);
    }
    const [row] = await db
      .update(travelsTrips)
      .set(updates)
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return { status: 200, body: { type: "update_trip_details", result: row } };
  }) as ActionExecutor,

  cancel_trip: (async (
    payload: z.infer<typeof CancelTripActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) return { status: 404, body: { error: "Trip not found" } };

    // Same cleanup order as DELETE /trips/:id — remove storage objects
    // before deleting DB rows so nothing orphans in Supabase Storage.
    const photos = await db
      .select({ storagePath: travelsTripPhotos.storagePath })
      .from(travelsTripPhotos)
      .where(eq(travelsTripPhotos.tripId, payload.tripId));
    const docs = await db
      .select({ storagePath: travelsTripDocuments.storagePath })
      .from(travelsTripDocuments)
      .where(eq(travelsTripDocuments.tripId, payload.tripId));

    await Promise.allSettled([
      ...photos.map((p) => deleteTripPhoto(p.storagePath)),
      ...docs.map((d) => deleteDocument(d.storagePath)),
    ]);

    await db
      .delete(travelsTripPhotos)
      .where(eq(travelsTripPhotos.tripId, payload.tripId));
    await db
      .delete(travelsTripDocuments)
      .where(eq(travelsTripDocuments.tripId, payload.tripId));
    await db
      .delete(travelsReminders)
      .where(eq(travelsReminders.tripId, payload.tripId));
    await db.delete(travelsTrips).where(eq(travelsTrips.id, payload.tripId));

    return {
      status: 200,
      body: { type: "cancel_trip", result: { id: payload.tripId } },
    };
  }) as ActionExecutor,

  mark_wishlist_done: (async (
    payload: z.infer<typeof MarkWishlistDoneActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing)
      return { status: 404, body: { error: "Wishlist item not found" } };
    const [row] = await db
      .update(travelsWishlist)
      .set({ done: payload.done ?? true })
      .where(eq(travelsWishlist.id, payload.wishlistId))
      .returning();
    return { status: 200, body: { type: "mark_wishlist_done", result: row } };
  }) as ActionExecutor,

  remove_wishlist_item: (async (
    payload: z.infer<typeof RemoveWishlistItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing)
      return { status: 404, body: { error: "Wishlist item not found" } };
    await db
      .delete(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    return {
      status: 200,
      body: {
        type: "remove_wishlist_item",
        result: { id: payload.wishlistId },
      },
    };
  }) as ActionExecutor,

  update_wishlist_item: (async (
    payload: z.infer<typeof UpdateWishlistItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select()
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing)
      return { status: 404, body: { error: "Wishlist item not found" } };
    let extraCoords: { lat?: number; lng?: number } = {};
    if (payload.destination && payload.destination !== existing.destination) {
      const coords = await geocodeDestination(payload.destination);
      if (coords) extraCoords = coords;
    }
    const [row] = await db
      .update(travelsWishlist)
      .set({
        ...(payload.destination !== undefined && {
          destination: payload.destination,
        }),
        ...(payload.targetDate !== undefined && {
          targetDate: payload.targetDate,
        }),
        ...(payload.notes !== undefined && { notes: payload.notes }),
        ...extraCoords,
      })
      .where(eq(travelsWishlist.id, payload.wishlistId))
      .returning();
    return { status: 200, body: { type: "update_wishlist_item", result: row } };
  }) as ActionExecutor,

  remove_packing_item: (async (
    payload: z.infer<typeof RemovePackingItemActionPayload>,
    _userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    const [list] = await db
      .select({ id: travelsPackingLists.id })
      .from(travelsPackingLists)
      .where(eq(travelsPackingLists.tripId, payload.tripId));
    if (!list)
      return { status: 404, body: { error: "Packing list not found" } };
    const items = await db
      .select()
      .from(travelsPackingItems)
      .where(eq(travelsPackingItems.listId, list.id));
    const match = items.find(
      (i) => i.text.toLowerCase() === payload.item.toLowerCase(),
    );
    if (!match)
      return { status: 404, body: { error: "Packing item not found" } };
    await db
      .delete(travelsPackingItems)
      .where(eq(travelsPackingItems.id, match.id));
    return {
      status: 200,
      body: { type: "remove_packing_item", result: { id: match.id } },
    };
  }) as ActionExecutor,

  add_reminder: (async (
    payload: z.infer<typeof AddReminderActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const syncToCalendar = payload.syncToCalendar ?? true;
    const [row] = await db
      .insert(travelsReminders)
      .values({
        tripId: payload.tripId,
        userId,
        title: payload.title,
        description: payload.description ?? null,
        dueDate: payload.dueDate ?? null,
        done: false,
        recipientEmails: payload.recipientEmails ?? [],
        syncToCalendar,
      })
      .returning();

    if (syncToCalendar && row.dueDate) {
      const target = await getReminderSyncTarget();
      await syncReminderCalendarEvents(
        row.id,
        trip.title,
        row.title,
        row.dueDate,
        target,
        row.alertDaysBefore,
      );
    }

    return { status: 201, body: { type: "add_reminder", result: row } };
  }) as ActionExecutor,

  sync_reminder_to_calendar: (async (
    payload: z.infer<typeof SyncReminderToCalendarActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select()
      .from(travelsReminders)
      .where(eq(travelsReminders.id, payload.reminderId));
    if (!existing || existing.tripId !== payload.tripId) {
      return { status: 404, body: { error: "Reminder not found" } };
    }
    const syncToCalendar = payload.syncToCalendar ?? true;

    const [row] = await db
      .update(travelsReminders)
      .set({ syncToCalendar })
      .where(eq(travelsReminders.id, payload.reminderId))
      .returning();

    const [trip] = await db
      .select({ title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, row.tripId));
    const target = syncToCalendar ? await getReminderSyncTarget() : null;
    await syncReminderCalendarEvents(
      row.id,
      trip?.title ?? "Trip",
      row.title,
      row.dueDate,
      target,
      row.alertDaysBefore,
    );

    return {
      status: 200,
      body: { type: "sync_reminder_to_calendar", result: row },
    };
  }) as ActionExecutor,

  edit_reminder: (async (
    payload: z.infer<typeof EditReminderActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select()
      .from(travelsReminders)
      .where(eq(travelsReminders.id, payload.reminderId));
    if (!existing || existing.tripId !== payload.tripId) {
      return { status: 404, body: { error: "Reminder not found" } };
    }

    const updates: Partial<typeof travelsReminders.$inferInsert> = {};
    if (payload.title !== undefined) updates.title = payload.title;
    if (payload.description !== undefined)
      updates.description = payload.description;
    if (payload.dueDate !== undefined) updates.dueDate = payload.dueDate;
    if (payload.done !== undefined) updates.done = payload.done;
    if (payload.recipientEmails !== undefined)
      updates.recipientEmails = payload.recipientEmails;
    if (payload.syncToCalendar !== undefined)
      updates.syncToCalendar = payload.syncToCalendar;

    const [row] = await db
      .update(travelsReminders)
      .set(updates)
      .where(eq(travelsReminders.id, payload.reminderId))
      .returning();

    const [trip] = await db
      .select({ title: travelsTrips.title })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, row.tripId));

    if (row.syncToCalendar && row.dueDate) {
      const target = await getReminderSyncTarget();
      await syncReminderCalendarEvents(
        row.id,
        trip?.title ?? "Trip",
        row.title,
        row.dueDate,
        target,
        row.alertDaysBefore,
      );
    } else {
      await deleteAllReminderCalendarEvents(row.id);
    }

    return { status: 200, body: { type: "edit_reminder", result: row } };
  }) as ActionExecutor,

  delete_reminder: (async (
    payload: z.infer<typeof DeleteReminderActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select()
      .from(travelsReminders)
      .where(eq(travelsReminders.id, payload.reminderId));
    if (!existing || existing.tripId !== payload.tripId) {
      return { status: 404, body: { error: "Reminder not found" } };
    }

    await deleteAllReminderCalendarEvents(payload.reminderId);
    await db
      .delete(travelsReminders)
      .where(eq(travelsReminders.id, payload.reminderId));

    return {
      status: 200,
      body: { type: "delete_reminder", result: { id: payload.reminderId } },
    };
  }) as ActionExecutor,

  add_itinerary_day: (async (
    payload: z.infer<typeof AddItineraryDayActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, itinerary: travelsTrips.itinerary })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const existing =
      (trip.itinerary as { days: Array<Record<string, unknown>> } | null)
        ?.days ?? [];
    const newDay = {
      date: payload.date ?? "",
      title: payload.title,
      activities: payload.activityName
        ? [
            {
              time: payload.activityTime ?? "09:00",
              name: payload.activityName,
              description: payload.activityDescription ?? "",
              proximity: "",
              tip: "",
            },
          ]
        : [],
    };
    const newItinerary = { days: [...existing, newDay] };
    const [row] = await db
      .update(travelsTrips)
      .set({ itinerary: newItinerary })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return { status: 200, body: { type: "add_itinerary_day", result: row } };
  }) as ActionExecutor,

  regenerate_itinerary_day: (async (
    payload: z.infer<typeof RegenerateItineraryDayActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const dayIndex = payload.dayNumber - 1;
    try {
      const itinerary = await generateItineraryForTrip(
        payload.tripId,
        "balanced",
        ["food", "history", "culture"],
        dayIndex,
      );
      return {
        status: 200,
        body: { type: "regenerate_itinerary_day", result: { itinerary } },
      };
    } catch (err) {
      if (err instanceof ItineraryActionError) {
        return { status: err.status, body: { error: err.message } };
      }
      throw err;
    }
  }) as ActionExecutor,
  add_connected_calendar: (async (
    payload: z.infer<typeof AddConnectedCalendarActionPayload>,
    userId: number,
  ) => {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken)
      return {
        status: 409,
        body: { error: "Google Calendar is not connected." },
      };
    const [row] = await db
      .insert(travelsConnectedCalendars)
      .values({
        userId,
        googleCalendarId: payload.googleCalendarId,
        summary: payload.calendarSummary,
        source: "picked",
        primaryColor: payload.primaryColor ?? "#4285f4",
      })
      .onConflictDoUpdate({
        target: [
          travelsConnectedCalendars.userId,
          travelsConnectedCalendars.googleCalendarId,
        ],
        set: { summary: payload.calendarSummary, updatedAt: new Date() },
      })
      .returning();
    return {
      status: 200,
      body: {
        type: "add_connected_calendar",
        result: {
          googleCalendarId: row.googleCalendarId,
          calendarSummary: row.summary,
        },
      },
    };
  }) as ActionExecutor,
  disconnect_calendar: (async (
    _payload: z.infer<typeof DisconnectCalendarActionPayload>,
    userId: number,
  ) => {
    await db
      .delete(travelsGoogleCalendarConnections)
      .where(eq(travelsGoogleCalendarConnections.userId, userId));
    return { status: 200, body: { type: "disconnect_calendar", result: {} } };
  }) as ActionExecutor,
  rescan_document: (async (
    payload: z.infer<typeof RescanDocumentActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const result = await rescanTripDocument(
      payload.tripId,
      payload.documentId,
      logger,
    );
    if (!result.ok)
      return { status: result.status, body: { error: result.error } };
    return {
      status: 200,
      body: { type: "rescan_document", result: result.document },
    };
  }) as ActionExecutor,
  generate_itinerary: (async (
    payload: z.infer<typeof GenerateItineraryActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    try {
      const itinerary = await generateItineraryForTrip(
        payload.tripId,
        "balanced",
        ["food", "history", "culture"],
      );
      return {
        status: 200,
        body: { type: "generate_itinerary", result: { itinerary } },
      };
    } catch (err) {
      if (err instanceof ItineraryActionError) {
        return { status: err.status, body: { error: err.message } };
      }
      throw err;
    }
  }) as ActionExecutor,
  confirm_itinerary_activity: (async (
    payload: z.infer<typeof ConfirmItineraryActivityActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, itinerary: travelsTrips.itinerary })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const itinerary = trip.itinerary as {
      days?: Array<{ activities?: Array<Record<string, unknown>> }>;
    } | null;
    const dayIndex = payload.dayNumber - 1;
    const activityIndex = payload.activityNumber - 1;
    const day = itinerary?.days?.[dayIndex];
    const activity = day?.activities?.[activityIndex];
    if (!itinerary?.days || !day || !activity) {
      return {
        status: 400,
        body: { error: "Day or activity number out of range" },
      };
    }

    const days = itinerary.days.map((d, i) =>
      i === dayIndex
        ? {
            ...d,
            activities: (d.activities ?? []).map((a, ai) =>
              ai === activityIndex
                ? {
                    ...a,
                    status:
                      payload.confirmed === false ? "tentative" : "confirmed",
                  }
                : a,
            ),
          }
        : d,
    );
    const newItinerary = { days };
    const [row] = await db
      .update(travelsTrips)
      .set({ itinerary: newItinerary })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return {
      status: 200,
      body: { type: "confirm_itinerary_activity", result: row },
    };
  }) as ActionExecutor,
  remove_itinerary_activity: (async (
    payload: z.infer<typeof RemoveItineraryActivityActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, itinerary: travelsTrips.itinerary })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const itinerary = trip.itinerary as {
      days?: Array<{ activities?: Array<Record<string, unknown>> }>;
    } | null;
    const dayIndex = payload.dayNumber - 1;
    const activityIndex = payload.activityNumber - 1;
    const day = itinerary?.days?.[dayIndex];
    const activity = day?.activities?.[activityIndex];
    if (!itinerary?.days || !day || !activity) {
      return {
        status: 400,
        body: { error: "Day or activity number out of range" },
      };
    }

    const days = itinerary.days.map((d, i) =>
      i === dayIndex
        ? {
            ...d,
            activities: (d.activities ?? []).filter(
              (_, ai) => ai !== activityIndex,
            ),
          }
        : d,
    );
    const newItinerary = { days };
    const [row] = await db
      .update(travelsTrips)
      .set({ itinerary: newItinerary })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return {
      status: 200,
      body: { type: "remove_itinerary_activity", result: row },
    };
  }) as ActionExecutor,
  send_email: (async (
    payload: z.infer<typeof SendEmailActionPayload>,
    userId: number,
  ) => {
    if (!resendConfigured()) {
      return {
        status: 503,
        body: { error: "Email sending isn't configured yet." },
      };
    }
    const [user] = await db
      .select({ email: appUsers.email })
      .from(appUsers)
      .where(eq(appUsers.id, userId));
    if (!user?.email)
      return { status: 404, body: { error: "No email address on file" } };

    await sendAssistantEmail(user.email, payload.subject, payload.body);
    return {
      status: 200,
      body: {
        type: "send_email",
        result: { sentTo: user.email, subject: payload.subject },
      },
    };
  }) as ActionExecutor,

  // Hub account-settings actions below are strictly single-user — they act
  // only on the calling user's own row/tokens, mirroring routes/auth.ts's
  // /auth/test-email, /auth/test-sms, /auth/phone/send-code, and
  // /auth/phone/verify exactly (including their error responses).
  send_test_email: (async (
    _payload: z.infer<typeof SendTestEmailActionPayload>,
    userId: number,
  ) => {
    if (!resendConfigured()) {
      return {
        status: 503,
        body: { error: "Email is not available right now." },
      };
    }
    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);
    if (!user) return { status: 401, body: { error: "Not authenticated" } };

    try {
      await sendTestEmail(user.email);
      return {
        status: 200,
        body: { type: "send_test_email", result: { sentTo: user.email } },
      };
    } catch {
      return {
        status: 500,
        body: { error: "Could not send the test email." },
      };
    }
  }) as ActionExecutor,

  send_test_sms: (async (
    _payload: z.infer<typeof SendTestSmsActionPayload>,
    userId: number,
  ) => {
    const [user] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (!user || !user.phoneVerified || !user.phoneNumber) {
      return {
        status: 400,
        body: {
          error: "Verify a phone number first before sending a test SMS.",
        },
      };
    }

    try {
      await sendSms(
        user.phoneNumber,
        "This is a test SMS from your Batchelor App account settings. If you received this, SMS delivery is working!",
      );
      return {
        status: 200,
        body: {
          type: "send_test_sms",
          result: { sentTo: user.phoneNumber },
        },
      };
    } catch (err) {
      if (err instanceof SmsRegistrationPendingError) {
        return {
          status: 503,
          body: {
            error:
              "SMS sending isn't enabled yet — carrier (10DLC) registration is still pending. Your phone number is verified and ready; this will start working once registration completes.",
          },
        };
      }
      if (err instanceof SmsOptedOutError) {
        return {
          status: 409,
          body: {
            error:
              "This phone number has opted out of texts (replied STOP). Reply START from that phone to resubscribe.",
          },
        };
      }
      return { status: 500, body: { error: "Could not send the test SMS." } };
    }
  }) as ActionExecutor,

  send_phone_verification_code: (async (
    payload: z.infer<typeof SendPhoneVerificationCodeActionPayload>,
    userId: number,
  ) => {
    const phoneNumber = payload.phoneNumber.trim();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + PHONE_CODE_EXPIRY_MS);

    try {
      await db.insert(phoneVerificationCodes).values({
        userId,
        phoneNumber,
        codeHash,
        expiresAt,
      });
      await db
        .update(appUsers)
        .set({ smsConsentAt: new Date() })
        .where(eq(appUsers.id, userId));
      await sendSms(
        phoneNumber,
        `Your Batchelor App verification code is ${code}. It expires in 10 minutes.`,
      );
      return {
        status: 200,
        body: {
          type: "send_phone_verification_code",
          result: { phoneNumber },
        },
      };
    } catch (err) {
      if (err instanceof SmsRegistrationPendingError) {
        return {
          status: 503,
          body: {
            error:
              "SMS sending isn't enabled yet — carrier (10DLC) registration is still pending. Your consent has been recorded and will be used for that registration.",
          },
        };
      }
      if (err instanceof SmsOptedOutError) {
        return {
          status: 409,
          body: {
            error:
              "This phone number has opted out of texts (replied STOP). Reply START from that phone to resubscribe before verifying it.",
          },
        };
      }
      return {
        status: 500,
        body: {
          error: "Could not send the verification code. Please try again.",
        },
      };
    }
  }) as ActionExecutor,

  verify_phone_code: (async (
    payload: z.infer<typeof VerifyPhoneCodeActionPayload>,
    userId: number,
  ) => {
    const now = new Date();
    const [record] = await db
      .select()
      .from(phoneVerificationCodes)
      .where(
        and(
          eq(phoneVerificationCodes.userId, userId),
          eq(phoneVerificationCodes.used, false),
          sql`${phoneVerificationCodes.expiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(phoneVerificationCodes.createdAt))
      .limit(1);

    if (!record || record.attempts >= MAX_PHONE_CODE_ATTEMPTS) {
      return {
        status: 400,
        body: {
          error: "This code is invalid or has expired. Request a new one.",
        },
      };
    }

    const providedHash = createHash("sha256")
      .update(payload.code)
      .digest("hex");
    const matches =
      providedHash.length === record.codeHash.length &&
      timingSafeEqual(Buffer.from(providedHash), Buffer.from(record.codeHash));

    if (!matches) {
      const attempts = record.attempts + 1;
      await db
        .update(phoneVerificationCodes)
        .set({ attempts, used: attempts >= MAX_PHONE_CODE_ATTEMPTS })
        .where(eq(phoneVerificationCodes.id, record.id));
      return {
        status: 400,
        body: {
          error: "This code is invalid or has expired. Request a new one.",
        },
      };
    }

    const [user] = await db.transaction(async (tx) => {
      await tx
        .update(phoneVerificationCodes)
        .set({ used: true })
        .where(eq(phoneVerificationCodes.id, record.id));
      return tx
        .update(appUsers)
        .set({
          phoneNumber: record.phoneNumber,
          phoneVerified: true,
          phoneVerifiedAt: now,
        })
        .where(eq(appUsers.id, userId))
        .returning();
    });

    if (!user) return { status: 401, body: { error: "Not authenticated" } };

    return {
      status: 200,
      body: {
        type: "verify_phone_code",
        result: { phoneNumber: user.phoneNumber },
      },
    };
  }) as ActionExecutor,

  // Hub Elaine-settings action — strictly single-user; always scoped to the
  // calling userId. Does NOT touch actionConfirmationMode (that's the separate
  // set_action_confirmation_mode soft tool).
  update_elaine_settings: (async (
    payload: z.infer<typeof UpdateElaineSettingsActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select()
      .from(elaineSettings)
      .where(eq(elaineSettings.userId, userId));
    const enabled = payload.enabled ?? existing?.enabled ?? true;
    const chatWindowSize =
      (payload.chatWindowSize as ChatWindowSize | undefined) ??
      (existing?.chatWindowSize as ChatWindowSize | undefined) ??
      "compact";
    const actionConfirmationMode =
      (existing?.actionConfirmationMode as
        | ActionConfirmationMode
        | undefined) ?? "one_by_one";
    await db
      .insert(elaineSettings)
      .values({ userId, enabled, actionConfirmationMode, chatWindowSize })
      .onConflictDoUpdate({
        target: elaineSettings.userId,
        set: { enabled, chatWindowSize, updatedAt: new Date() },
      });
    return {
      status: 200,
      body: {
        type: "update_elaine_settings",
        result: { enabled, chatWindowSize },
      },
    };
  }) as ActionExecutor,

  // Share/photo actions below intentionally do NOT filter by userId — trips
  // are fully household-shared (see threat_model.md "Household-sharing
  // boundary"), matching the equivalent hand-written routes in
  // routes/travels/share.ts and routes/travels/photos.ts.
  generate_trip_share_link: (async (
    payload: z.infer<typeof GenerateTripShareLinkActionPayload>,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, shareToken: travelsTrips.shareToken })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    if (trip.shareToken) {
      return {
        status: 200,
        body: {
          type: "generate_trip_share_link",
          result: { shareToken: trip.shareToken },
        },
      };
    }

    const token = randomBytes(16).toString("hex");
    await db
      .update(travelsTrips)
      .set({ shareToken: token })
      .where(eq(travelsTrips.id, payload.tripId));

    return {
      status: 200,
      body: { type: "generate_trip_share_link", result: { shareToken: token } },
    };
  }) as ActionExecutor,

  revoke_trip_share_link: (async (
    payload: z.infer<typeof RevokeTripShareLinkActionPayload>,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    await db
      .update(travelsTrips)
      .set({ shareToken: null })
      .where(eq(travelsTrips.id, payload.tripId));

    return {
      status: 200,
      body: { type: "revoke_trip_share_link", result: { id: payload.tripId } },
    };
  }) as ActionExecutor,

  delete_trip_photo: (async (
    payload: z.infer<typeof DeleteTripPhotoActionPayload>,
  ) => {
    const [row] = await db
      .select()
      .from(travelsTripPhotos)
      .where(
        and(
          eq(travelsTripPhotos.id, payload.photoId),
          eq(travelsTripPhotos.tripId, payload.tripId),
        ),
      );
    if (!row) return { status: 404, body: { error: "Photo not found" } };

    await deleteTripPhoto(row.storagePath).catch(() => {});
    await db
      .delete(travelsTripPhotos)
      .where(eq(travelsTripPhotos.id, payload.photoId));

    const [trip] = await db
      .select({ iconPhotoId: travelsTrips.iconPhotoId })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (trip?.iconPhotoId === payload.photoId) {
      await db
        .update(travelsTrips)
        .set({ iconPhotoId: null })
        .where(eq(travelsTrips.id, payload.tripId));
    }

    return {
      status: 200,
      body: { type: "delete_trip_photo", result: { id: payload.photoId } },
    };
  }) as ActionExecutor,

  // Card layout / collapse preferences ARE personal (never household-shared —
  // see threat_model.md), so these two stay scoped by the calling userId,
  // matching routes/travels/card-layout.ts exactly.
  update_card_layout: (async (
    payload: z.infer<typeof UpdateCardLayoutActionPayload>,
    userId: number,
  ) => {
    const cardOrder = payload.cardOrder.filter((id) =>
      (CARD_ORDER_IDS as readonly string[]).includes(id),
    );
    await db
      .insert(travelsCardLayoutPreferences)
      .values({ userId, cardOrder, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: travelsCardLayoutPreferences.userId,
        set: { cardOrder, updatedAt: new Date() },
      });
    return {
      status: 200,
      body: { type: "update_card_layout", result: { cardOrder } },
    };
  }) as ActionExecutor,

  update_trip_card_collapse: (async (
    payload: z.infer<typeof UpdateTripCardCollapseActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const collapsedCards = payload.collapsedCards.filter((id) =>
      (COLLAPSE_CARD_IDS as readonly string[]).includes(id),
    );
    await db
      .insert(travelsTripCardCollapseState)
      .values({
        userId,
        tripId: payload.tripId,
        collapsedCards,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          travelsTripCardCollapseState.userId,
          travelsTripCardCollapseState.tripId,
        ],
        set: { collapsedCards, updatedAt: new Date() },
      });
    return {
      status: 200,
      body: { type: "update_trip_card_collapse", result: { collapsedCards } },
    };
  }) as ActionExecutor,

  update_app_config: (async (
    payload: z.infer<typeof UpdateAppConfigActionPayload>,
    userId: number,
  ) => {
    const [me] = await db
      .select({ isOwner: appUsers.isOwner })
      .from(appUsers)
      .where(eq(appUsers.id, userId));
    if (!me?.isOwner) {
      return {
        status: 403,
        body: {
          error:
            "Admin access required — only the app owner can change Control Panel settings.",
        },
      };
    }
    const knownKey = APP_CONFIG_DEFAULTS.find(
      (d) => d.module === payload.module && d.key === payload.key,
    );
    if (!knownKey) {
      return {
        status: 400,
        body: {
          error: `Config key "${payload.module}.${payload.key}" is not a recognised Control Panel setting. Only keys that are explicitly listed on the Control Panel page may be updated.`,
        },
      };
    }
    const row = await updateConfigValue(
      payload.module,
      payload.key,
      payload.value,
    );
    if (!row) {
      return {
        status: 404,
        body: {
          error: `Config key "${payload.module}.${payload.key}" not found.`,
        },
      };
    }
    return { status: 200, body: { type: "update_app_config", result: row } };
  }) as ActionExecutor,
};

const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...TRAVEL_ACTION_EXECUTORS,
  ...potteryActionExecutors,
  ...quiltingActionExecutors,
  ...ornamentActionExecutors,
};

// ---------------------------------------------------------------------------
// Function-tool definitions handed to the model via real tool-calling
// (`tools` on the chat completion request). One per confirmable write-action,
// plus two standalone tools for navigation suggestions and household memory
// that aren't part of the confirm-then-execute flow.
// ---------------------------------------------------------------------------

const ACTION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
      name: "add_reminder",
      description:
        "Propose creating a new reminder for a trip, e.g. \"remind me to check in for our flight\" or \"remind me to book the hotel by Friday\". Only call this if the trip's numeric id is visible on screen; never guess an id — offer to open the trip instead if you don't have one. If the user gives (or you can see on screen) a specific date the reminder is about, set dueDate to that exact date; never invent a date. If the user asks to also notify/email someone (a connected household member), include their email(s) in recipientEmails; never invent an email address you can't see on screen or that the user didn't give you. syncToCalendar defaults to true (syncs to the Travel Calendar automatically if connected) — only set it to false if the user explicitly asks not to add it to the calendar.",
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
          syncToCalendar: { type: "boolean" },
        },
        required: ["tripId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_reminder_to_calendar",
      description:
        'Propose turning calendar sync on (or off, if syncToCalendar is explicitly false) for an EXISTING reminder, e.g. "sync this to the calendar" or "stop syncing that reminder". Only call this if the reminder\'s numeric id is visible on screen (look for "reminderId: <number>" in the reminders listed for this trip); never guess an id — if you can\'t see the reminder\'s id, ask which reminder they mean or offer to open the trip. Do not use this for creating a brand-new reminder (use add_reminder for that, which already defaults to syncing).',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          reminderId: { type: "integer" },
          syncToCalendar: { type: "boolean" },
        },
        required: ["tripId", "reminderId"],
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
          syncToCalendar: { type: "boolean" },
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
];

const NAVIGATE_TOOL_NAME = "suggest_navigation";
const REMEMBER_TOOL_NAME = "remember_household_fact";

// Per-app allowlists for navigation suggestions. Elaine is one continuous
// conversation across apps, but "suggest_navigation" must only ever point at
// a real path in the app the user is currently viewing (see ChatBody.appId).
const NAVIGATE_ALLOWED_PATHS_BY_APP: Record<AppId, readonly string[]> = {
  travels: [
    "/",
    "/trips",
    "/map",
    "/explore",
    "/wishlist",
    "/destinations",
    "/settings",
  ],
  pottery: [
    "/",
    "/add",
    "/compare",
    "/categories",
    "/maintenance",
    "/settings",
  ],
  quilting: [
    "/fabrics",
    "/fabrics/add",
    "/patterns",
    "/patterns/add",
    "/quilts",
    "/quilts/add",
    "/compare",
    "/blocks",
    "/blocks/new",
    "/library/blocks",
    "/library/blocks/new",
    "/layouts",
    "/layouts/new",
    "/whole-quilt",
    "/whole-quilt/designer",
    "/shopping",
    "/tools/yardage",
    "/categories",
    "/maintenance",
  ],
  ornaments: [
    "/",
    "/add",
    "/scan",
    "/stats",
    "/categories",
    "/maintenance",
    "/settings",
  ],
  hub: ["/", "/account"],
  elaine: ["/", "/memory"],
};

// Dynamic-id path shapes allowed per app, checked against the same regex
// pattern for every app since only the "kind" segment differs.
const NAVIGATE_PATH_RE_BY_APP: Record<AppId, RegExp> = {
  travels: /^\/(trips\/\d+|trips|map|explore|wishlist|destinations|settings)?$/,
  pottery: /^\/(piece\/\d+|add|compare|categories|maintenance|settings)?$/,
  quilting:
    /^\/(fabrics\/\d+|fabrics\/add|fabrics|patterns\/\d+|patterns\/add|patterns|quilts\/\d+|quilts\/add|quilts|compare|blocks\/\d+\/edit|blocks\/\d+\/cut-pattern|blocks\/\d+|blocks\/new|blocks|library\/blocks\/\d+\/edit|library\/blocks\/new|library\/blocks|layouts\/\d+\/edit|layouts\/\d+|layouts\/new|layouts|whole-quilt\/designer|whole-quilt|shopping|tools\/yardage|categories|maintenance)?$/,
  ornaments:
    /^\/(ornament\/\d+|add|scan|stats|categories|maintenance|settings)?$/,
  hub: /^\/(account)?$/,
  elaine: /^\/$/,
};

// Cross-app navigation paths — any app can navigate the user to another app's
// root or a known sub-path. Query params are whitelisted (search, cat, color).
// The client detects these prefixes and uses window.location.href instead of
// the SPA router so the correct React bundle loads.
const CROSS_APP_NAVIGATE_RE =
  /^\/(pottery|quilting|travels|ornaments|elaine)(\/[^?#]*)?(\?[a-zA-Z0-9=+%._~!$&'()*+,;:-]*)?\/?$|^\/barcode-lookup$/;

function navigatePayloadSchemaFor(appId: AppId) {
  return z.object({
    path: z
      .string()
      .max(200)
      .refine(
        (p) =>
          NAVIGATE_PATH_RE_BY_APP[appId].test(p) ||
          CROSS_APP_NAVIGATE_RE.test(p),
        "not an allowed in-app or cross-app path",
      ),
    reason: z.string().min(1).max(300),
  });
}

const NavigateToolPayload = z.object({
  path: z.string().max(60),
  reason: z.string().min(1).max(300),
});

const RememberToolPayload = z.object({
  content: z.string().min(1).max(2000),
  scope: z.enum(["household", "personal", "temporary"]).optional(),
  category: z
    .enum([
      "fact",
      "preference",
      "instruction",
      "person",
      "place",
      "collection",
    ])
    .optional(),
  sensitivity: z.enum(["low", "medium", "high"]).optional(),
  expires_in_days: z.number().int().positive().optional(),
});

const SET_MODE_TOOL_NAME = "set_action_confirmation_mode";

const SetModeToolPayload = z.object({
  mode: z.enum(ACTION_CONFIRMATION_MODES),
});

const WEB_SEARCH_TOOL_NAME = "web_search";

const WebSearchToolPayload = z.object({
  query: z.string().min(1).max(500),
});

const EBAY_SEARCH_TOOL_NAME = "ebay_search";

const EbaySearchToolPayload = z.object({
  query: z.string().min(1).max(300),
  category: z
    .enum(["ornaments", "pottery", "general"])
    .optional()
    .describe(
      "Hint to narrow the search — 'ornaments' adds Hallmark Christmas context, 'pottery' adds collectible pottery context.",
    ),
});

const SEARCH_HALLMARK_TOOL_NAME = "search_hallmark";
const LOOKUP_BARCODE_TOOL_NAME = "lookup_product_barcode";

const SearchHallmarkToolPayload = z.object({
  name: z.string().min(1).max(200).optional(),
  hallmarkSku: z.string().min(1).max(50).optional(),
  year: z.number().int().min(1970).max(2100).optional(),
});

const SEARCH_FLIGHTS_TOOL_NAME = "search_flights";

const SearchFlightsToolPayload = z.object({
  originIata: z.string().min(2).max(10),
  destination: z.string().min(1).max(200),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const FETCH_PAGE_TOOL_NAME = "fetch_page";

const FetchPageToolPayload = z.object({
  url: z.string().url().max(2000),
});

const CONSULT_EXPERTS_TOOL_NAME = "consult_experts";

const ConsultExpertsToolPayload = z.object({
  question: z.string().min(1).max(500),
  context: z.string().max(1000).optional(),
});

const GET_WEATHER_TOOL_NAME = "get_weather_forecast";

const GetWeatherToolPayload = z.object({
  // lat/lng are optional — if omitted the server geocodes from locationName
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  locationName: z.string().max(200),
});

const FIND_NEARBY_PLACES_TOOL_NAME = "find_nearby_places";

const FindNearbyPlacesToolPayload = z.object({
  query: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const GET_ROUTE_INFO_TOOL_NAME = "get_route_info";

const GetRouteInfoToolPayload = z.object({
  origin: z.object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().max(200),
  }),
  destination: z.object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().max(200),
  }),
  mode: z.enum(["DRIVE", "WALK", "BICYCLE", "TRANSIT"]).default("WALK"),
});

const GET_AIR_QUALITY_TOOL_NAME = "get_air_quality";

const GetAirQualityToolPayload = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locationName: z.string().max(200),
});

const GET_POLLEN_FORECAST_TOOL_NAME = "get_pollen_forecast";

const GetPollenForecastToolPayload = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locationName: z.string().max(200),
});

const SHOW_DATA_CARD_TOOL_NAME = "show_data_card";

const ShowDataCardToolPayload = z.object({
  title: z.string().max(120).optional(),
  rows: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(20),
});

const SEARCH_HOUSEHOLD_TOOL_NAME = "search_household_data";

const SearchHouseholdToolPayload = z.object({
  query: z.string().min(1).max(200),
  include: z
    .array(
      z.enum([
        "trips",
        "pottery",
        "ornaments",
        "fabrics",
        "patterns",
        "quilts",
      ]),
    )
    .optional(),
});

const SEARCH_TRIP_DOCUMENTS_TOOL_NAME = "search_trip_documents";

const SearchTripDocumentsToolPayload = z.object({
  query: z.string().min(1).max(200),
  tripId: z.number().int().positive().optional(),
});

const SHOW_POTTERY_ITEM_TOOL_NAME = "show_pottery_item";

const ShowPotteryItemToolPayload = z.object({
  itemId: z.number().int().positive(),
});

const SHOW_FABRIC_SWATCH_TOOL_NAME = "show_fabric_swatch";

const ShowFabricSwatchToolPayload = z.object({
  fabricId: z.number().int().positive(),
});

const SHOW_ORNAMENT_ITEM_TOOL_NAME = "show_ornament_item";

const ShowOrnamentItemToolPayload = z.object({
  itemId: z.number().int().positive(),
});

const SHOW_DESTINATION_CARD_TOOL_NAME = "show_destination_card";

const ShowDestinationCardToolPayload = z.object({
  name: z.string().min(1).max(200),
  country: z.string().max(100).optional(),
  highlights: z.array(z.string().max(200)).max(5).optional(),
});

const GET_EXCHANGE_RATE_TOOL_NAME = "get_exchange_rate";

const GetExchangeRateToolPayload = z.object({
  from: z.string().length(3).toUpperCase(),
  to: z.array(z.string().length(3).toUpperCase()).min(1).max(6),
});

const SHOW_TRIP_CARD_TOOL_NAME = "show_trip_card";

const ShowTripCardToolPayload = z.object({
  tripId: z.number().int().positive().optional(),
  name: z.string().min(1).max(200),
  destination: z.string().max(200).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
  countdownDays: z.number().int().optional(),
});

const SUGGEST_CLOTHING_LAYERS_TOOL_NAME = "suggest_clothing_layers";

const SuggestClothingLayersPayload = z.object({
  destination: z.string().min(1).max(200),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  activities: z.array(z.string()).max(10).optional(),
  climate: z
    .enum(["hot", "cold", "tropical", "temperate", "desert", "variable"])
    .optional(),
});

const CALCULATE_YARDAGE_TOOL_NAME = "calculate_yardage";

const CalculateYardageToolPayload = z.object({
  quiltWidthInches: z.number().positive().max(200),
  quiltHeightInches: z.number().positive().max(200),
  fabricWidthInches: z.number().positive().max(120).default(40),
  bindingStripWidthInches: z.number().positive().max(12).default(2.5),
});

const SOFT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
        "Get a live multi-day weather forecast for a specific place using Google's Weather API — call this whenever the user asks about weather, what to pack for the climate, or whether a planned day might be rained out, instead of guessing or using web_search for this. lat/lng are optional: provide them if you have real coordinates from the screen (e.g. a trip's destination); if not, omit them and just provide locationName — the server will geocode automatically. Never invent coordinates.",
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
];

const QUERY_HOUSEHOLD_TOOL_NAME = "query_household_data";

const SOFT_TOOLS_EXTRA: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
];

const ACTION_TOOL_NAMES = new Set<string>(
  ACTION_TOOLS.map(
    (t) =>
      (t as OpenAI.Chat.Completions.ChatCompletionFunctionTool).function.name,
  ),
);

async function getOrCreateConversation(userId: number) {
  const [existing] = await db
    .select()
    .from(elaineConversations)
    .where(eq(elaineConversations.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(elaineConversations)
    .values({ userId, messages: [] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with another request — read the row that won.
  const [row] = await db
    .select()
    .from(elaineConversations)
    .where(eq(elaineConversations.userId, userId));
  return row;
}

type ProposedAction = { type: string; label: string; payload: unknown };

// Attempts to turn an accumulated tool-call argument buffer into a fully
// validated, ready-to-confirm action. Returns null while the JSON is still
// incomplete (JSON.parse throws) or if the model produced an invalid
// payload — in both cases we simply drop it rather than surfacing a
// malformed/unsafe write-action to the confirmation UI. Called repeatedly
// as the argument buffer grows during streaming, so the `action` SSE event
// can fire the instant a fully-formed call arrives, not just at stream end.
async function tryBuildAction(
  name: string,
  argsBuffer: string,
): Promise<ProposedAction | null> {
  if (!ACTION_TOOL_NAMES.has(name)) return null;
  try {
    const parsedPayload: unknown = JSON.parse(argsBuffer);
    const parsedAction = ActionBody.safeParse({
      type: name,
      payload: parsedPayload,
    });
    if (!parsedAction.success) return null;
    return {
      type: parsedAction.data.type,
      label: await buildActionLabel(parsedAction.data),
      payload: parsedAction.data.payload,
    };
  } catch {
    return null;
  }
}

// Folds any unseen proactive nudges (see lib/travels-nudges.ts) into the
// user's persisted conversation history as ordinary assistant messages, and
// marks them seen so they're never surfaced twice. Returns the (possibly
// updated) message history. Called from GET /assistant/conversation, which
// is what the widget fetches the moment it's opened — this is how an
// unprompted nudge actually becomes a chat bubble the user sees.
async function applyUnseenNudges(userId: number): Promise<ChatMessage[]> {
  const conversation = await getOrCreateConversation(userId);
  const history = (conversation?.messages as ChatMessage[] | null) ?? [];

  const unseen = await db
    .select({
      id: elaineNudges.id,
      message: elaineNudges.message,
    })
    .from(elaineNudges)
    .where(and(eq(elaineNudges.userId, userId), isNull(elaineNudges.seenAt)))
    .orderBy(elaineNudges.createdAt);

  if (unseen.length === 0) return history;

  const updatedHistory: ChatMessage[] = [
    ...history,
    ...unseen.map((n) => ({ role: "assistant" as const, content: n.message })),
  ].slice(-50);

  await db
    .update(elaineConversations)
    .set({ messages: updatedHistory, updatedAt: new Date() })
    .where(eq(elaineConversations.userId, userId));

  await db
    .update(elaineNudges)
    .set({ seenAt: new Date() })
    .where(and(eq(elaineNudges.userId, userId), isNull(elaineNudges.seenAt)));

  return updatedHistory;
}

// ---------------------------------------------------------------------------
// Attachment storage — public `elaine-attachments` Supabase bucket.
// Images are stored under `{userId}/{uuid}.{ext}` and served via the public
// bucket URL (no expiry). Only JPEG, PNG, and WebP are accepted, max 5 MB.
// ---------------------------------------------------------------------------

const ATTACHMENT_BUCKET = "elaine-attachments";
const attachmentStorage = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

let attachmentBucketReady: Promise<void> | null = null;
async function ensureAttachmentBucket(): Promise<void> {
  if (!attachmentBucketReady) {
    attachmentBucketReady = ensureBucketWithPolicy(
      attachmentStorage.storage,
      ATTACHMENT_BUCKET,
      ELAINE_ATTACHMENTS_BUCKET_POLICY,
    ).catch((err) => {
      attachmentBucketReady = null;
      throw err;
    });
  }
  return attachmentBucketReady;
}

const ACCEPTED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: multerLimitForPrefix("/api/elaine/attachments") },
  fileFilter(_req, file, cb) {
    const ok = (ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(
      file.mimetype,
    );
    if (!ok) {
      cb(new Error("Only JPEG, PNG, WebP images and PDFs are accepted"));
    } else {
      cb(null, true);
    }
  },
});

// POST /attachments — upload a single image or PDF for use as a message attachment.
// Images are accepted for AI vision; PDFs have their text extracted server-side.
// Files are stored in the PRIVATE elaine-attachments bucket; a 5-year signed URL
// is returned so the client can display the file and pass it back on chat sends.
router.post(
  "/attachments",
  attachmentUpload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const userId = req.session.userId!;
    const isPdf = req.file.mimetype === "application/pdf";
    const ext = isPdf
      ? "pdf"
      : req.file.mimetype === "image/jpeg"
        ? "jpg"
        : req.file.mimetype === "image/webp"
          ? "webp"
          : "png";
    const storagePath = `${userId}/${randomUUID()}.${ext}`;

    try {
      await ensureAttachmentBucket();
    } catch (err) {
      req.log.error({ err }, "elaine attachment bucket init failed");
      res.status(500).json({ error: "Storage unavailable" });
      return;
    }

    const { error: uploadError } = await attachmentStorage.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      req.log.error({ err: uploadError }, "elaine attachment upload failed");
      res.status(500).json({ error: "Upload failed" });
      return;
    }

    // 5-year signed URL (private bucket — no public URL available).
    const FIVE_YEARS_SECS = 5 * 365 * 24 * 3600;
    const { data: signedData, error: signError } =
      await attachmentStorage.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(storagePath, FIVE_YEARS_SECS);

    if (signError || !signedData) {
      req.log.error({ err: signError }, "elaine attachment sign failed");
      res.status(500).json({ error: "Could not generate file URL" });
      return;
    }

    if (isPdf) {
      // Extract text so the AI can read the document without vision tokens.
      let extractedText: string | undefined;
      try {
        const parsed = await pdfParse(req.file.buffer);
        const raw = parsed.text ?? "";
        extractedText = raw.slice(0, 8000) || undefined;
      } catch (err) {
        req.log.warn({ err }, "elaine pdf text extraction failed (non-fatal)");
      }
      res.status(201).json({
        url: signedData.signedUrl,
        type: "pdf",
        name: req.file.originalname ?? "document.pdf",
        ...(extractedText !== undefined ? { extractedText } : {}),
      });
      return;
    }

    res.status(201).json({ url: signedData.signedUrl, type: "image" });
  },
);

// ---------------------------------------------------------------------------
// Named conversation CRUD
// ---------------------------------------------------------------------------

// GET /conversations — list this user's named conversations, newest first.
// Supports ?q= for server-side search across conversation title and all message content.
// Each row includes a `preview` snippet (≤80 chars from the first user message).
router.get("/conversations", async (req, res) => {
  const userId = req.session.userId!;
  const searchQuery = String(req.query["q"] ?? "").trim();

  // When a search query is provided, first find matching conversation IDs via
  // a DB-level ILIKE across both the conversation title and all message content.
  let matchingConvIds: Set<number> | null = null;
  if (searchQuery) {
    // Escape the LIKE escape character itself FIRST, or a literal "\" in the
    // search query would combine with the following escaped "%"/"_" and let
    // a crafted query re-introduce an unescaped wildcard.
    const pattern = `%${searchQuery.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    // Title matches
    const titleMatches = await db
      .select({ id: elaineHistoryConversations.id })
      .from(elaineHistoryConversations)
      .where(
        and(
          eq(elaineHistoryConversations.userId, userId),
          sql`lower(${elaineHistoryConversations.title}) like lower(${pattern})`,
        ),
      );
    // Message content matches
    const contentMatches = await db
      .select({ conversationId: elaineHistoryMessages.conversationId })
      .from(elaineHistoryMessages)
      .innerJoin(
        elaineHistoryConversations,
        eq(elaineHistoryMessages.conversationId, elaineHistoryConversations.id),
      )
      .where(
        and(
          eq(elaineHistoryConversations.userId, userId),
          sql`lower(${elaineHistoryMessages.content}) like lower(${pattern})`,
        ),
      );
    matchingConvIds = new Set([
      ...titleMatches.map((r) => r.id),
      ...contentMatches
        .map((r) => r.conversationId)
        .filter((id): id is number => id !== null),
    ]);
    // Short-circuit: no matches at all
    if (matchingConvIds.size === 0) {
      res.json([]);
      return;
    }
  }

  // Fetch all (or matching) conversations with message counts.
  const baseWhere = matchingConvIds
    ? and(
        eq(elaineHistoryConversations.userId, userId),
        inArray(elaineHistoryConversations.id, Array.from(matchingConvIds)),
      )
    : eq(elaineHistoryConversations.userId, userId);

  const rows = await db
    .select({
      id: elaineHistoryConversations.id,
      title: elaineHistoryConversations.title,
      createdAt: elaineHistoryConversations.createdAt,
      updatedAt: elaineHistoryConversations.updatedAt,
      messageCount: count(elaineHistoryMessages.id),
    })
    .from(elaineHistoryConversations)
    .leftJoin(
      elaineHistoryMessages,
      eq(elaineHistoryMessages.conversationId, elaineHistoryConversations.id),
    )
    .where(baseWhere)
    .groupBy(elaineHistoryConversations.id)
    .orderBy(desc(elaineHistoryConversations.updatedAt));

  // Resolve preview snippets (first user message ≤80 chars) for each conversation.
  const convIds = rows.map((r) => r.id);
  const previewMap = new Map<number, string | null>();
  if (convIds.length > 0) {
    const firstMsgs = await db
      .select({
        conversationId: elaineHistoryMessages.conversationId,
        content: elaineHistoryMessages.content,
      })
      .from(elaineHistoryMessages)
      .where(
        and(
          eq(elaineHistoryMessages.role, "user"),
          inArray(elaineHistoryMessages.conversationId, convIds),
        ),
      )
      .orderBy(elaineHistoryMessages.createdAt);

    for (const msg of firstMsgs) {
      if (msg.conversationId !== null && !previewMap.has(msg.conversationId)) {
        const snippet = msg.content.replace(/\s+/g, " ").trim().slice(0, 80);
        previewMap.set(msg.conversationId, snippet || null);
      }
    }
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messageCount: Number(r.messageCount),
      preview: previewMap.get(r.id) ?? null,
    })),
  );
});

// POST /conversations — create a new named conversation.
router.post("/conversations", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .insert(elaineHistoryConversations)
    .values({ userId, title: "New conversation" })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Failed to create conversation" });
    return;
  }
  res.status(201).json({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: 0,
    preview: null,
  });
});

// GET /conversations/:id/messages — load messages for a named conversation.
router.get("/conversations/:id/messages", async (req, res) => {
  const userId = req.session.userId!;
  const convId = parseInt(String(req.params["id"] ?? "0"), 10);
  if (!convId) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }
  const [conv] = await db
    .select({ id: elaineHistoryConversations.id })
    .from(elaineHistoryConversations)
    .where(
      and(
        eq(elaineHistoryConversations.id, convId),
        eq(elaineHistoryConversations.userId, userId),
      ),
    );
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(elaineHistoryMessages)
    .where(eq(elaineHistoryMessages.conversationId, convId))
    .orderBy(elaineHistoryMessages.createdAt);
  res.json(
    msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      attachmentUrls: normalizeAttachmentRefs(m.attachmentUrls),
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

// PATCH /conversations/:id — rename a named conversation.
const RenameConversationBody = z.object({
  title: z.string().trim().min(1).max(200),
});
router.patch("/conversations/:id", async (req, res) => {
  const userId = req.session.userId!;
  const convId = parseInt(String(req.params["id"] ?? "0"), 10);
  if (!convId) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }
  const parsed = RenameConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid title" });
    return;
  }
  const [row] = await db
    .update(elaineHistoryConversations)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(
      and(
        eq(elaineHistoryConversations.id, convId),
        eq(elaineHistoryConversations.userId, userId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
});

// DELETE /conversations/:id — permanently remove a named conversation.
router.delete("/conversations/:id", async (req, res) => {
  const userId = req.session.userId!;
  const convId = parseInt(String(req.params["id"] ?? "0"), 10);
  if (!convId) {
    res.status(400).json({ error: "Invalid conversation ID" });
    return;
  }
  await db
    .delete(elaineHistoryConversations)
    .where(
      and(
        eq(elaineHistoryConversations.id, convId),
        eq(elaineHistoryConversations.userId, userId),
      ),
    );
  res.status(204).end();
});

router.get("/conversation", async (req, res) => {
  const userId = req.session.userId!;
  const messages = await applyUnseenNudges(userId);
  res.json({ messages });
});

// Lightweight polling endpoint for the floating-button badge — deliberately
// separate from GET /assistant/conversation (which also marks nudges seen)
// so simply showing a badge never consumes the nudge.
router.get("/nudges/unseen-count", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select({ id: elaineNudges.id })
    .from(elaineNudges)
    .where(and(eq(elaineNudges.userId, userId), isNull(elaineNudges.seenAt)));
  res.json({ count: rows.length });
});

router.delete("/conversation", async (req, res) => {
  const userId = req.session.userId!;

  // Archive the current widget-default conversation so its history remains
  // accessible in the history panel, then create a fresh default thread.
  // This is what backs the "New conversation" button in the floating widget:
  // the next message with conversationId=null would otherwise load the OLD
  // isWidgetDefault row (with all the old messages), so we rotate it here
  // and return the new conversation's ID so the client can pin subsequent
  // sends to the fresh thread explicitly.
  await db
    .update(elaineHistoryConversations)
    .set({ isWidgetDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(elaineHistoryConversations.userId, userId),
        eq(elaineHistoryConversations.isWidgetDefault, true),
      ),
    );
  const [newConv] = await db
    .insert(elaineHistoryConversations)
    .values({ userId, title: "Household", isWidgetDefault: true })
    .returning({ id: elaineHistoryConversations.id });

  // Also clear the legacy rolling thread (pre-history-system storage).
  await getOrCreateConversation(userId);
  await db
    .update(elaineConversations)
    .set({ messages: [], updatedAt: new Date() })
    .where(eq(elaineConversations.userId, userId));

  res.json({ messages: [], conversationId: newConv?.id ?? null });
});

// ─── Shared prompt infrastructure ───────────────────────────────────────────
//
// All five Elaine channels (streaming app chat, floating widget, group
// messenger, SMS/voice, and email) call buildElaineCoreSystemPrompt so they
// all carry the same comprehensive App Map, tool guidance, SEARCH FIRST
// mandate, and household memory.  Only the channel label, page-context
// substitute, confirmation-mode wording, and formatting note differ per
// channel.

const CURRENT_APP_LABEL: Record<AppId, string> = {
  travels: "Travels",
  pottery: "Pottery",
  quilting: "Quilting",
  ornaments: "Ornaments",
  hub: "the Batchelor hub (app launcher)",
  elaine: "her own dedicated space (the Elaine app)",
};

const CONFIRMATION_MODE_EXPLANATION: Record<string, string> = {
  one_by_one:
    "one_by_one — the user reviews and confirms/skips each proposed action individually, one at a time.",
  all_at_once:
    "all_at_once — the user sees every proposed action from this turn together and confirms or cancels them as a group.",
  auto_run:
    "auto_run — proposed actions run immediately with no confirmation step; you should report what you did (or if something failed) after the fact.",
};

async function buildUserContext(userId: number): Promise<{
  userName: string;
  memoryBlock: string;
  memorySummary: string | null;
  existingFactContents: string[];
}> {
  const [user] = await db
    .select({ displayName: appUsers.displayName, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userName = user?.displayName || user?.email || "there";

  const activeMemoryFilter = and(
    eq(elaineMemory.active, true),
    isNull(elaineMemory.deletedAt),
    or(isNull(elaineMemory.expiresAt), sql`${elaineMemory.expiresAt} > NOW()`),
    or(
      sql`${elaineMemory.scope} != 'personal'`,
      eq(elaineMemory.ownerUserId, userId),
    ),
  );

  const [factRows, summaryRows] = await Promise.all([
    db
      .select({ content: elaineMemory.content })
      .from(elaineMemory)
      .where(and(eq(elaineMemory.type, "fact"), activeMemoryFilter))
      .orderBy(desc(elaineMemory.createdAt))
      .limit(30),
    db
      .select({ content: elaineMemory.content })
      .from(elaineMemory)
      .where(and(eq(elaineMemory.type, "summary"), activeMemoryFilter))
      .limit(1),
  ]);

  const existingFactContents = factRows.map((r) => r.content);
  const memoryBlock =
    existingFactContents.length > 0
      ? existingFactContents.map((c) => `- ${c}`).join("\n")
      : "(nothing remembered yet)";
  const memorySummary = summaryRows[0]?.content ?? null;

  return { userName, memoryBlock, memorySummary, existingFactContents };
}

/**
 * Sanitize a raw pageContext string before injecting it into the system prompt.
 * Strips HTML, HTML entities, and common prompt-injection trigger phrases, then
 * caps the result at 6 000 characters so it cannot crowd out tool definitions.
 */
function sanitizePageContext(raw: string | null | undefined): string {
  if (!raw) return "(no page context was shared for this screen)";
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|constraints?|rules?|guidelines?)/gi,
      "[filtered]",
    )
    .replace(/you\s+are\s+now\s+(a|an|the)\b/gi, "[filtered]")
    .replace(
      /disregard\s+(your\s+)?(training|instructions?|guidelines?|rules?)/gi,
      "[filtered]",
    )
    .replace(
      /your\s+(new\s+)?(primary\s+)?(instructions?|task|goal|objective|purpose)\s+(is|are)/gi,
      "[filtered]",
    )
    .replace(/\[\[[\s\S]*?\]\]/g, "[filtered]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

function buildElaineCoreSystemPrompt(params: {
  userName: string;
  channelLabel: string;
  contextBlockLabel: string;
  contextBlock: string;
  memoryBlock: string;
  memorySummary?: string | null;
  actionConfirmationMode: string;
  isTravelsApp: boolean;
  userLocation?: { lat: number; lng: number } | null;
  formattingNote?: string;
  channelAddendum?: string;
}): string {
  const {
    userName,
    channelLabel,
    contextBlockLabel,
    contextBlock,
    memoryBlock,
    memorySummary,
    actionConfirmationMode,
    isTravelsApp,
    userLocation,
    formattingNote,
    channelAddendum,
  } = params;

  const isAutoRun = actionConfirmationMode === "auto_run";

  const confirmationModeSection = isAutoRun
    ? `CONFIRMATION MODE: This channel uses auto-run mode — all action tools execute immediately without any confirmation step. When you do call an action tool, always confirm in your reply what you actually did (or that it failed). For conversational questions, jokes, general knowledge, or anything else that requires no tool call, just answer naturally — you do not need an action to justify a reply. Do not mention confirmation modes to the user; do not call ${SET_MODE_TOOL_NAME}.`
    : `CONFIRMATION MODE: This user's current mode for confirming proposed actions is "${actionConfirmationMode}" — ${CONFIRMATION_MODE_EXPLANATION[actionConfirmationMode]} The three modes are: ${Object.values(CONFIRMATION_MODE_EXPLANATION).join(" | ")} If the user asks how you confirm actions, or asks to change it (e.g. "just do it automatically", "ask me one at a time", "show me everything together"), explain the modes in your visible reply and call ${SET_MODE_TOOL_NAME} once they've decided — never call it just to describe the options. Mention that they can also change this anytime from Settings.`;

  const defaultFormattingNote = `Your visible replies are rendered in a chat bubble with a markdown renderer. Use markdown naturally to make replies easier to read, but keep it light — this is a chat bubble, not a document. Good uses: **bold** for key terms or place names, bullet lists (- item) for 3+ items, numbered lists (1. step) for instructions, ## for a section heading only when the reply is genuinely multi-section. Do not use headers for short replies. Do not use markdown for a single sentence or two — plain prose is fine. Never use backtick code blocks. When you call a weather, places, air-quality, or pollen tool and it succeeds, a rich visual card is automatically shown below your reply — so in that case keep your reply text very short (1–2 sentences summarising the key point) rather than spelling out all the data again in text.`;

  return `You are Elaine, a warm, personable AI assistant built into the Batchelor app — a household account shared across a Pottery collection app, a Quilting collection app, a Christmas Ornaments collection app, and a Travel-planning app, plus a hub/launcher page and your own dedicated Elaine app. You are one continuous assistant: the same conversation and memory follow the user across all of these apps, even though each app has its own pages and tools. You are talking with ${userName}, who is currently reaching you over ${channelLabel}.

PERSONALITY: You're conversational, upbeat, and genuinely helpful — like a knowledgeable friend, not a generic corporate assistant. You can be a little playful. You still give concrete, accurate, step-by-step help when asked.

TODAY'S DATE: ${new Date().toISOString().slice(0, 10)} — always use this when calculating countdowns, "days until", ages, or anything else that depends on knowing what today is. Never guess or rely on training data for the current date.
${userLocation ? `\nUSER'S CURRENT LOCATION: ${userLocation.lat.toFixed(4)}°, ${userLocation.lng.toFixed(4)}° (from the user's device GPS). Use these coordinates automatically as the default for any location-aware query — nearby places, weather, driving time, local store searches — without asking the user where they are. Only request a more specific address if the task genuinely requires street-level precision beyond what coordinates provide.\n` : ""}
APP MAP (every page in every app, so you can always explain what a page is for or point the user to the right one, even if they're not currently on it or in a different app):

Travels app:
- Dashboard ("/"): the home screen — trip stats, a countdown to the next upcoming trip, pending reminders, and a status-grouped list of every trip (wishlist/planning/booked/active/completed).
- Trips ("/trips"): the full trip list with a "New Trip" button/dialog to create one.
- Trip detail ("/trips/:id"): everything about one specific trip — overview/status, packing list, day-by-day itinerary (AI-generatable), reminders, and uploaded documents (tickets, confirmations, etc.).
- World Map ("/map"): an interactive map plotting every trip and wishlist destination as pins, color-coded by status.
- Explore ("/explore"): AI-powered destination search/inspiration — search for a place and get an AI overview and suggestions, with the option to add it to the wishlist.
- Wishlist ("/wishlist"): destinations the household wants to visit someday but hasn't booked yet.
- Destinations ("/destinations"): a browsable, searchable list of every place the household has been or wants to go, grouped and with trip history per destination.
- Travel Calendar ("/travel-calendar"): a shared household calendar view (month/week/list) overlaying each connected member's Google Calendar plus AI-detected trip-date suggestions.
- Gmail ("/gmail"): review AI-found travel emails (flights, hotels, etc.), manually browse/search the connected inbox, and link emails as trip documents.
- Settings ("/settings"): manage account/profile, connect Gmail and Google Calendar, and configure how you (Elaine) behave — enabled/disabled, action confirmation mode, and what you remember about the household.

Pottery app:
- Collection ("/"): the full pottery collection grid/list, with search and filtering.
- Add Piece ("/add"): upload photo(s) of a new pottery piece and let AI analyze/fill in its details.
- Piece detail ("/piece/:id"): everything about one piece — photos, name, maker, style, shape, condition, origin, era, notes, glaze/surface AI analysis, locked fields, and category assignment.
- Compare ("/compare"): pick two or more pieces and compare their AI-derived attributes side by side.
- Scan ("/scan"): AI visual search — snap or upload a photo to find matching/similar pieces already in the collection.
- Stats ("/stats"): collection-wide statistics and breakdowns (counts by category, maker, style, etc.).
- Categories ("/categories"): manage the categories used to organize the collection, including merging categories together.
- Maintenance ("/maintenance"): bulk AI re-analysis and other collection upkeep tools.
- Settings ("/settings"): account/profile settings, plus an "Export for insurance" action that downloads a PDF of every piece's photos and details for insurance/provenance records.

Quilting app:
- Home ("/"): overview/dashboard for the quilting collection.
- Fabrics ("/fabrics", "/fabrics/add", "/fabrics/bulk-add", "/fabrics/:id"): the fabric stash — browse, add one or many fabrics (with AI photo analysis), and view/edit a fabric's details.
- Patterns ("/patterns", "/patterns/add", "/patterns/:id"): quilt patterns — browse, add, and view/edit pattern details.
- Quilts ("/quilts", "/quilts/add", "/quilts/:id"): finished/in-progress quilts — browse, add, and view/edit details.
- Compare ("/compare"): compare fabrics or patterns side by side.
- Blocks ("/blocks", "/blocks/new", "/blocks/:id", "/blocks/:id/edit", "/blocks/:id/cut-pattern"): a quilt-block designer with generated cutting patterns.
- Block Patterns ("/library/blocks", "/library/blocks/new", "/library/blocks/:id/edit"): a library of reusable named block templates (classic quilt blocks like Ohio Star, Log Cabin, Half Square Triangle, plus any custom ones saved from the Block Designer) — browse, search, and open one in the designer to start a new block from it.
- Layouts ("/layouts", "/layouts/new", "/layouts/:id", "/layouts/:id/edit"): plan how blocks/fabrics come together into a quilt layout.
- Whole Quilt ("/whole-quilt", "/whole-quilt/designer"): design/browse whole-quilt layouts.
- Yardage Calculator ("/tools/yardage"): an in-app calculator for backing/binding yardage — you also have a calculate_yardage tool that does this same math on request from anywhere in chat.
- Shopping ("/shopping"): the fabric/supplies shopping list.
- Categories ("/categories"): manage categories used to organize fabrics/patterns.
- Maintenance ("/maintenance"): bulk AI re-analysis and other collection upkeep tools.

Ornaments app:
- Collection ("/"): the full Christmas ornaments collection grid/list, with search and filtering.
- Add Ornament ("/add"): upload a photo of a new ornament and let AI analyze/fill in its details (name, series/collection, year, brand, etc.).
- Ornament detail ("/ornament/:id"): everything about one ornament — photos, name, series/collection, year, brand, condition, origin, dimensions, notes, AI description/motifs/colors, locked fields, category assignment, and book value.
- Scan ("/scan"): barcode/photo scan to look up or find an ornament (UPC barcode lookup + AI visual match).
- Stats ("/stats"): collection-wide statistics — totals, quantities, book value, and breakdowns by series/collection.
- Categories ("/categories"): manage the categories used to organize the collection, including merging categories together.
- Maintenance ("/maintenance"): bulk AI re-analysis and other collection upkeep tools.
- Settings ("/settings"): account/profile settings.

Hub (app launcher):
- Launcher ("/"): lets the household pick which app to open (Pottery, Quilting, Ornaments, Travels, Office).
- Account ("/account"): shared account/profile settings.
- Control Panel ("/control-panel"): admin-only page (app owner only) for tuning app-wide AI behaviour — token limits, request timeouts, and model parameters grouped by module (web_search, openrouter, ornaments, quilting, travels). Linked from the Account page.

If the user asks "what is this page for", "what can I do here", or similar without more specific on-screen detail below, answer using this map (and the live on-screen state if present) rather than saying you don't know. If they ask about a different app than the one they're currently in, you can still answer from this map — you don't need to tell them to switch apps first, though you can suggest navigating there if it's the same app they're already in.

WHAT YOU CAN SEE RIGHT NOW (${contextBlockLabel}):
${contextBlock}

SHARED FAMILY MEMORY:

Conversation summary (a rolling prose summary maintained automatically after every turn — treat as reliable context about who this household is and what they care about):
${memorySummary ?? "(no summary yet — builds up as conversations grow)"}

Specific facts (things explicitly asked to be remembered, or noteworthy details extracted from conversations):
${memoryBlock}

TOOLS: You have tools available for navigation suggestions, remembering household facts, and proposing changes to trips/wishlist/packing lists/reminders. Each tool's own description explains exactly when and how to use it — follow those rules precisely, especially around never fabricating numeric ids and asking permission in your visible reply text before calling any trip/wishlist/packing/reminder tool. If a single request naturally involves more than one write-action (e.g. "add a reminder to book the hotel and add wine tasting to the wishlist"), call all of the relevant action tools in that same turn — don't limit yourself to one. Just make sure your visible reply names everything you're about to do before you call the tools, so nothing is a surprise. Navigation suggestions and remembering a fact can always accompany action tools.

SEARCH FIRST — MANDATORY: Whenever the user asks about or references a trip, pottery piece, ornament, fabric, quilt, or pattern — by name ("my Croatia trip", "the blue bowl"), by destination ("our Sicily trip", "the hotel we're staying at in Catania", "our trip to Italy"), or implicitly ("our hotel", "our upcoming trip", "where we're going", "the place we're going to") — and you don't already have the item's full details in the current page context, act immediately without asking clarifying questions:
- If the user hints at a specific destination (even vaguely, like "Sicily" or "Italy") → call search_household_data with the destination name as the query before writing any reply. Never ask "can you tell me the hotel name?" or "which trip do you mean?" before searching.
- If the user says "our hotel/trip/next destination" with no destination hint at all → call query_household_data with include: ["travels"] to list upcoming trips, then follow up with search_household_data on the trip title to get full details including any booked hotel.
In both cases, make this your FIRST tool call — before writing any reply text and before asking any clarifying question. If the search returns a clear match, show a visual card (show_trip_card) and answer the question using the found data. Only ask for clarification if the search returns zero results or multiple equally plausible matches with no obvious winner.

${confirmationModeSection}

REMINDERS: Use add_reminder for requests like "remind me to check in for our flight" or "remind me to book the hotel by Friday" — it creates a new reminder and syncs it to the calendar by default; include recipientEmails only if the user asked to also notify someone. Use sync_reminder_to_calendar only to toggle calendar sync on or off for a reminder that already exists and whose numeric id you can see on screen (look for "reminderId: <number>" in the reminders listed for the current trip); never use it to create a reminder. Use edit_reminder for changes to an existing reminder (title, description, due date, done state, recipients, or calendar sync) — only include the fields the user asked to change, and never guess a reminder id. Use delete_reminder to permanently remove an existing reminder (also removes its calendar events); never guess a reminder id for either.

ITINERARY: Use add_itinerary_day for requests like "add a day trip to Kyoto on the 14th" — it appends a brand-new day to the trip's itinerary. Use regenerate_itinerary_day for requests like "regenerate day 3" or "come up with a new plan for that day" — it re-runs AI planning for ONE existing day and replaces its activities, using balanced-pace, general-interest defaults since it can't see any per-session style/interest picks the user made in the UI. Only use regenerate_itinerary_day on a day number you can see listed on screen (e.g. "Day 3"); never guess a day number, and never use it to create a new day (use add_itinerary_day for that). Use generate_itinerary for requests like "plan my whole trip" or "generate an itinerary" — it replaces ALL days with a fresh AI-generated plan; if the trip already has itinerary days shown on screen, say so and confirm the user wants to overwrite them before calling it. Each activity you can see on screen has a 1-based day/activity number and a status (tentative or confirmed); tentative activities synced from a document are flagged as such. Use confirm_itinerary_activity to mark a tentative activity firm (or back to tentative) once the user has verified it, and remove_itinerary_activity to delete an activity outright (e.g. a wrong or duplicate document-derived entry) — both require the exact day and activity numbers shown on screen, never guessed.

CALENDAR: Each household member connects their own Google Calendar independently from the Settings page; you can never trigger that OAuth connection yourself — it requires the user to click a real "Connect" button that redirects their browser to Google. If the user asks to connect and you can see from on-screen context that it's not connected yet, ask if they'd like you to take them to Settings and use suggest_navigation for "/settings" — never claim you connected it. Once connected, use add_connected_calendar to add one of their own calendars to their Travel Calendar overlay, but only if you're on the Settings page and can see the connection is active plus the exact googleCalendarId in the on-screen calendar list — never guess one or pick one that isn't listed. Use disconnect_calendar to remove their Google Calendar connection entirely — only when it's shown as connected on screen, and make sure your visible reply asks permission first since this stops all future reminder syncing and removes every calendar they'd connected. Disconnecting or reconnecting only ever affects the current user, never anyone else in the household. Only the app owner can assign which calendar is the shared "Travel" calendar, and you can never do that on their behalf — direct them to the Settings page for that.

WISHLIST & DESTINATIONS: The Destinations page ("/destinations") is a read-only view — it just groups existing trips by destination and has no separate create/edit/delete of its own. "Managing a destination" instead means managing the wishlist entry or trip that represents it: use add_wishlist to add a new destination the household wants to visit ("add Lisbon to the wishlist"), update_wishlist_item to rename it or change its target date/notes ("change that wishlist item to Porto instead", "push the target date back"), and remove_wishlist_item to take it off the wishlist entirely — only when the wishlist item's numeric id is visible on screen, never guessed. Once a destination has an actual trip planned, use create_trip (destination is required), update_trip_details to edit an existing trip's destination/dates/notes, and cancel_trip to delete a trip and everything attached to it. Use mark_wishlist_done when a wishlist destination has been visited or is no longer being considered as "someday", not "done" in the sense of a completed trip.

SHARING & PHOTOS: Use generate_trip_share_link when asked to create/get a shareable link for a trip (returns the existing link if one already exists rather than making a new one) — anyone with the link can view basic trip info, so say so in your reply. Use revoke_trip_share_link to permanently break an existing share link; make clear in your reply that any copy already sent out will stop working. Use delete_trip_photo to permanently remove one photo (memory or magnet) from a trip — only when both the trip's and the photo's numeric ids are visible on screen, and always confirm in your visible reply since this can't be undone.

DISPLAY PREFERENCES: Use update_card_layout when the user wants to reorder the cards on Trip Detail pages (Reminders, Itinerary, Documents, Packing/To-do, Photos, Magnets, Weather & Nearby) — this is personal to the requesting user only, applies to every trip they view, and needs the FULL new order, not just the cards that moved. Use update_trip_card_collapse to collapse/expand specific cards on ONE trip for the requesting user only, again personal and never shared with the household — provide the full set of card ids that should end up collapsed.

IMAGE RECOGNITION: You CAN see and analyze photos attached via the paperclip button. If the user attaches an image and asks "what is this?", "identify this", "describe this", "what ornament is this?", "what's wrong with this?", or any question requiring visual analysis, use your vision fully — describe what you see, identify objects/items/text, assess condition, estimate age or era, compare against what you know, and answer any question about the image content. Never tell the user you cannot see or analyze attached photos — you can.

${isTravelsApp ? `MAGNET CHECK: If the user asks whether they already own a souvenir magnet or wants to check a photo before buying a duplicate, tell them to tap the small camera icon next to the message box — that tool checks the photo against their whole magnet collection and returns an exact match or "not found". Never guess or fabricate a match result. This camera-based collection-check is a Travels-only feature — not available in Pottery, Quilting, or the hub.\n\n` : ""}DOCUMENTS: You can already see each uploaded document's parsed fields (confirmation numbers, dates, etc.) in the on-screen state above — answer questions about them directly instead of asking the user to open or re-read the file. If the user says a document's details look wrong, are missing, or asks you to "re-read"/"re-scan" a document, use rescan_document to re-run AI extraction on the original uploaded file; this only works for a document whose docId you can see on screen (look for "docId: <number>") and never touches fields the user has locked (shown with a lock icon in the app). This does not let you upload a new file — if there's no matching document on screen, tell the user to upload it from the trip's Documents section first. This applies to Travels trip documents only — Pottery and Quilting don't have an equivalent document-upload feature.

POTTERY ITEMS: Use update_pottery_item to edit an existing piece (name, notes, quantity, style, shape, maker, condition, origin, era) — only include fields that actually change, and only if the piece's numeric id is visible on screen (look for "itemId: <number>"); never guess one. This also works right after an upload if the user tells you details in chat instead of typing them into the form. Use delete_pottery_item to permanently remove a piece and its photos — say clearly in your visible reply that this deletes the item, since it's destructive. Use create_pottery_category / delete_pottery_category to manage the categories used to organize the collection; never guess a category id for deletion. Use update_pottery_item_categories to replace the full set of categories assigned to one piece (pass every category id that should end up assigned, not just the ones to add). Use merge_pottery_categories to fold one category into another (e.g. "merge Vases into Vessels") — this deletes the source category, so say so clearly since it's destructive; never guess either category id. Use lock_pottery_field to lock or unlock one AI-derived field (name, patternDescription, style, shape, maker, makerInfo, dimensions, dominantColors, motifs, aiDescription, glazeType) on a piece so future AI re-analysis will or won't overwrite it — only with a visible itemId. Use delete_pottery_photo to remove one supplemental photo from a piece, and promote_pottery_photo to make a supplemental photo the new primary photo (this re-runs AI analysis with the new primary image, subject to locked fields) — both need a visible itemId and imageId, never guessed. Use bulk_reanalyze_pottery to re-run AI analysis on several pieces at once; pass itemIds if specific ones are visible on screen, or omit it to run against every piece still missing AI analysis (capped at 20) — mention in your visible reply that this takes a while and calls AI per item.

QUILTING ITEMS: Use update_fabric / delete_fabric, update_pattern / delete_pattern for editing or removing an existing fabric or pattern — only if its numeric id is visible on screen, never guessed, and be clear in your visible reply that a delete is permanent. You can't create a brand-new fabric or finished quilt from chat since both require an uploaded photo you have no way to attach — but use create_pattern to add a new quilt pattern record (name, designer, block size, difficulty, source, notes; no image) since a pattern's image is optional. Use delete_quilt to permanently remove a finished quilt and its photos — only with a visible quiltId, and say clearly it's permanent. Use create_shopping_item / update_shopping_item / delete_shopping_item to manage the fabric/supplies shopping list. Use create_quilting_category / delete_quilting_category to manage categories; never guess a category id for deletion. Use rename_quilting_category to rename one, and merge_quilting_categories to fold one category into another (destructive to the source category — say so clearly); never guess either category id. Use create_block / create_layout to add a new blank block template or quilt layout (metadata + an empty grid only — this does NOT design the block's pattern or place blocks into the layout, since chat-driven geometry editing isn't supported; tell the user to open the block/layout editor in the app to actually design it). Use delete_block / delete_layout to remove one, only with a visible id. Use bulk_reanalyze_quilting to re-run AI analysis on fabrics, patterns, or finished quilts — pass specific ids when visible on screen, or omit ids to run against everything of that type still needing analysis; mention this takes a while. Use calculate_yardage whenever the user asks how much backing or binding fabric they need for a given quilt size — never do this arithmetic yourself, always call the tool so the numbers are accurate; it's a read-only estimate, not a saved record.

ORNAMENTS ITEMS: Use update_ornament_item to edit an existing ornament (name, notes, quantity, series/collection, year, brand, condition, origin, dimensions) — only include fields that actually change, and only if the ornament's numeric id is visible on screen (look for "itemId: <number>"); never guess one. This also works right after an upload if the user tells you details in chat instead of typing them into the form. Use delete_ornament_item to permanently remove an ornament and its photos — say clearly in your visible reply that this deletes the item, since it's destructive. Use create_ornament_category / delete_ornament_category to manage the categories used to organize the collection; never guess a category id for deletion. Use update_ornament_item_categories to replace the full set of categories assigned to one ornament (pass every category id that should end up assigned, not just the ones to add). Use merge_ornament_categories to fold one category into another — this deletes the source category, so say so clearly since it's destructive; never guess either category id. Use lock_ornament_field to lock or unlock one AI-derived field (name, seriesOrCollection, year, dimensions, dominantColors, motifs, aiDescription, barcodeValue) on an ornament so future AI re-analysis will or won't overwrite it — only with a visible itemId. Use delete_ornament_photo to remove one supplemental photo from an ornament, and promote_ornament_photo to make a supplemental photo the new primary photo (this re-runs AI analysis with the new primary image, subject to locked fields) — both need a visible itemId and imageId, never guessed. Use bulk_reanalyze_ornaments to re-run AI analysis on several ornaments at once; pass itemIds if specific ones are visible on screen, or omit it to run against every ornament still missing AI analysis (capped at 20) — mention in your visible reply that this takes a while and calls AI per item.

CONTEXT-AWARE LOOKUPS — read the on-screen state and act, don't ask: When the user asks a contextual question and the answer is already implicit in the page they're viewing, extract the data silently and call the right tool — never ask them to re-state what you can already see.

**Ornament detail page** (context starts with "Ornament detail — itemId: …"): The context includes the ornament's name, brand, series/collection, year, barcode/UPC, condition, and any existing book value.
- "What's this worth?", "what would this sell for on eBay?", "check eBay for this", "how much is it?", "what's the value?" → call **both** ebay_search AND search_hallmark in the same turn, in parallel. Build the eBay query as "Hallmark Keepsake [name] [year]" (e.g. "Hallmark Keepsake Darth Vader 2023") — do NOT append the word "ornament". Build the search_hallmark query from the ornament name. When you report back: lead with the Hallmark book/retail price from search_hallmark, then give the eBay sold-price range. If eBay returns no results, the Hallmark book value from search_hallmark is still a useful answer — don't say you couldn't find the value just because eBay had nothing. Do not ask which ornament.
- "Look it up on Hallmark", "is this still on Hallmark.com?", "find the Hallmark listing", "what series is this in?", "tell me about this ornament" → call search_hallmark with the ornament's name or series from context. Do not ask which ornament.

**Ornament add page — prefilled from scan** (context starts with "Add ornament page — prefilled from barcode scan"): The user just scanned a barcode and the form is pre-filled with the ornament's name, brand, series/collection, year, and barcode/UPC — all visible in the page context.
- If the user asks "what's this worth?", "look it up on eBay", "how much is it?", "check the price", "what's the value?" → call **both** ebay_search AND search_hallmark in the same turn using the name + year from context. Format the eBay query as "Hallmark Keepsake [name] [year]" (no "ornament" suffix). Lead the answer with Hallmark book/retail price, then eBay sold prices. If eBay has no results, the Hallmark book value from search_hallmark is still a useful answer.
- If the user asks "look it up on Hallmark", "is this on hallmark.com?", "find the Hallmark page" → call search_hallmark using the name or SKU from context.
- You may proactively offer: "I can look this up on eBay and Hallmark.com if you'd like — just ask!" after the user lands here from a scan, but only offer once and don't run the lookup unprompted.

**Barcode scanning**: There is a barcode scan button (camera icon) next to the Elaine chat input — when the user wants to scan a barcode, tell them to tap that button in the chat bar. The scanned barcode code is sent directly as a message. When you see a barcode or UPC number in a message (e.g. "I scanned a barcode: 1234567890"), immediately call lookup_product_barcode with that code — do not navigate anywhere, report the results in chat. For general product barcode lookups without adding to a collection, navigate to /barcode-lookup. To scan a barcode specifically to add a new ornament, navigate to /ornaments/scan. IMPORTANT — Hallmark barcode fallback: if lookup_product_barcode returns "not found" for a barcode starting with "661127" (Hallmark's registered GS1 company prefix), the UPC database simply didn't have a record — the ornament almost certainly exists. In that same turn, immediately also call ebay_search (use the full barcode number as the query, category="ornaments") AND web_search (query = "{barcode} hallmark ornament") to identify the item and find its current market value. Never tell the user the ornament doesn't exist just because the UPC database returned "not found" for a 661127-prefix barcode.

**Trip detail page** (context starts with "Viewing trip … to <destination> … starts <date>, ends <date>"): The context includes the destination, start date, and end date.
- "What are flights like?", "how much would it cost to fly?", "check flights", "find me a flight" → call search_flights with destination extracted from context and startDate/endDate as departDate/returnDate. Do not ask where they're going or when.
- "What's the weather going to be?", "what will the weather be like?" → call get_weather_forecast with the destination from context. Note: weather forecasts are only reliable ~10 days ahead; for trips further out, explain that and offer to search for typical seasonal conditions instead (use web_search).
- "What's near the hotel?", "what restaurants are nearby?", "find things to do there", "what's within walking distance?", "what's cool around our hotel?" → if you know the hotel name (from trip documents, context, or the user just told you), use web_search first with a query like "things to do near [Hotel Name] [City]" or "walking distance attractions [Hotel Name] [City]" — this gives rich, specific, up-to-date results. Never call find_nearby_places without real lat/lng; if you don't have exact coordinates, web_search always gives better results than guessing a location. If you do have the hotel's lat/lng from a prior search result, you may additionally call find_nearby_places for a structured POI list.

**General rule**: If the data needed to call a tool is visible in the on-screen context, treat it as already provided and call the tool. Only ask for clarification if a required parameter is genuinely absent from both what the user said and what's on screen.

EMAIL: Whenever you've just given the user something substantial worth keeping — a list of recommendations, an itinerary summary, packing tips, etc. — offer to email it to them, e.g. "Want me to email you this list?" Only call send_email once they say yes; never call it unprompted or assume they want it. It always goes to their own registered account email, so never ask for an address and never offer to send it to anyone else. Write a short subject and a plain-text body (no markdown/HTML, blank line between paragraphs) — it gets formatted into a nice email automatically. You have no way to export a PDF or Word document, so don't offer that; email is the only export option available.

ACCOUNT & NOTIFICATIONS: These only make sense on the shared Account settings page (hub-account context). Use send_test_email if the user wants to confirm email delivery is working — always their own account address. Use send_test_sms the same way for texts, but only if the page context shows they already have a verified phone number; if not, tell them to verify one first instead of calling it. Use send_phone_verification_code when the user wants to add or change their phone number — you must have their explicit, clearly-stated agreement to receive SMS messages before calling it (set consent to true only then), and the number must be in E.164 format (e.g. +12105551234); ask them to reformat a local number if needed. Use verify_phone_code once they tell you the 6-digit code they received by text — never invent or reuse a code from earlier in the conversation. None of these four actions are available outside the Account page, and none of them ever touch another household member's phone/email. Use update_elaine_settings when the user explicitly asks to toggle Elaine on/off or change the chat window size (compact / comfortable / large) — this is also only appropriate on the Account page, never in other apps. For confirmation-mode changes, use set_action_confirmation_mode instead.

CONTROL PANEL: The Control Panel ("/control-panel", hub app, owner-only) holds every app-wide tuning constant — AI token limits (e.g. itinerary_gen_max_tokens, packing_ai_max_tokens), request timeouts (openrouter.request_timeout_ms), and similar parameters. When a user describes a quality or performance problem that a tuning constant might fix — e.g. "the itinerary keeps getting cut off", "packing suggestions seem short", "search is timing out" — proactively call query_household_data with include: ["app_config"] to read the current values, then explain which setting is likely responsible and what a sensible new value might be. Only propose update_app_config when you are on the Control Panel page and the specific key is visible in the on-screen state; never guess a module or key name. update_app_config is restricted to the app owner (isOwner) — if the user isn't the owner, tell them only the app owner can change these settings. This action is also excluded from the SMS/voice/email channels. Changes take effect within 30 seconds (next cache refresh) without a server restart. When you execute update_app_config, the action result includes the full updated row with the new value — always state the new value explicitly in your reply so the user knows what was changed to. If the user asks a follow-up about the setting you just changed (e.g. "what did you just set it to?"), answer from the action result you already received rather than re-reading the page context, which may not yet reflect the update.

PROACTIVE CONFIG WARNINGS: When the on-screen page context already includes an "App config snapshot" section and a setting there looks likely to cause problems for what the current page does — for example, a very short request timeout on a page that runs AI analysis, or a very low token limit on a page that generates long text — volunteer a one-sentence observation early in your reply (e.g. "By the way, your AI timeout is set to 5 s, which may be why ornament analysis keeps timing out — the app owner can raise it in the Control Panel."). Only do this when the config value is genuinely out of range for the task at hand and is visible in the current page context; do not speculate about settings you haven't seen, and don't repeat the warning in the same conversation if you've already mentioned it.

WEB SEARCH & PAGE READING: You have a real-time web_search tool AND a fetch_page tool — use them actively. Never tell the user to search Google or visit a website themselves; if you catch yourself writing "you could Google this" or "you might want to visit X", stop and call web_search instead. Use web_search proactively (no permission needed) for ANY question that benefits from current or specific information — prices, opening hours, product details, how-to guides, reviews, news, events, visa rules, recipes, recommendations, anything — not just travel topics. Call it multiple times if needed for different angles on the same question. If search results point to a specific page that would have more detail than the summary (e.g. an official site, a how-to article, a product listing), use fetch_page to read that URL and extract the relevant details before you answer. Once you have all the information: write your answer based on what you found, cite sources naturally (e.g. "according to [Site Name]"), and at the very end of your reply always include one Google search link formatted as: 🔍 [Search Google for "your query"](https://www.google.com/search?q=url+encoded+query) — this gives the user a quick way to explore further on their own. Never paste raw search output verbatim, never fabricate a fact instead of searching, and do not use web_search or fetch_page for things already in the on-screen state or for stable general knowledge that definitely hasn't changed.

PRODUCT SEARCH HIERARCHY: When the user asks what something is worth, how much it costs, or where to buy it, work through this order — (1) check the household collection first (query_household_data) to see if they already own it; (2) for ornaments with a barcode, call lookup_product_barcode; (3) call search_hallmark for any Hallmark item; (4) call ebay_search for real sold/market prices — always prefer this over guessing; (5) for current online retail prices or buying on Amazon, use web_search with terms like "site:amazon.com [item name]" or "[item] buy online price"; (6) for local physical stores, use web_search with "[item] for sale near [city]" or "[store type] near [location]". Combine multiple sources for the most useful answer — don't stop after the first one returns a result.

EXPERT ADVICE: For genuine expertise/advice/recommendation questions — a judgment call where being one-sided could actually steer the user wrong (packing/gear advice for specific constraints, which option to book, negotiating tactics, whether something is a good idea, etc.) — use consult_experts rather than just answering solo; it cross-checks more than one independent source and gives you back a single synthesized answer to relay. Don't use it for simple facts, small talk, or anything that needs web_search instead (current/live data). It takes a bit longer than a normal reply — that's expected, not a malfunction.

LIVE MAPS DATA: You also have five Google Maps-backed tools for real, current data instead of guessing — prefer these over web_search when they apply, since they return structured, accurate data rather than a text summary. get_weather_forecast gives a real multi-day forecast for a place (use it for "what's the weather", packing-for-climate, or rain-risk questions). find_nearby_places gives real restaurants/attractions/hotels/etc. with ratings (use it for recommendations or "what's near X"). get_route_info gives real distance/time between two places for a given travel mode (use it for "how far"/"how long to get there" questions). get_air_quality gives real current AQI/category/dominant pollutant (use it for pollution/smog questions or when giving packing/health advice for a destination). get_pollen_forecast gives real grass/tree/weed pollen categories (use it for allergy/hay-fever questions or packing advice when someone has allergies). When someone asks "what should I pack" for a trip, proactively check weather, and check air quality/pollen too if it's relevant (long trip, known allergy mentioned, or the destination is known for pollution) rather than only guessing from general knowledge. For get_weather_forecast: lat/lng are optional — just provide locationName and the server geocodes automatically, so ALWAYS call this tool when asked about weather (never use web_search as a fallback for weather). For find_nearby_places and get_route_info: still need real lat/lng — pull coordinates from on-screen trip/destination data or a prior find_nearby_places result; never invent coordinates. For get_air_quality and get_pollen_forecast: also need lat/lng from context.

FORMATTING: ${formattingNote ?? defaultFormattingNote}

TABLES: When comparing two or more options side by side (flights, hotels, products, trade-offs), use a GFM pipe table — a header row, a separator row of dashes, then one row per item — instead of prose or a bullet list. Keep it to a handful of columns and short cell text so it stays readable in a narrow chat bubble; for a single flat list of facts (not a comparison) use ${SHOW_DATA_CARD_TOOL_NAME} instead of a table.

STRUCTURED FACT CARDS: Use ${SHOW_DATA_CARD_TOOL_NAME} to show a compact card of labeled facts (specs, a cost breakdown, quick reference numbers) alongside your reply, instead of listing them as prose or a bullet list. Don't use it for a side-by-side comparison of multiple options — that's a table's job (see TABLES above). This runs immediately with no confirmation needed.

IMAGES: If web_search returns image results for the query, they're shown automatically as a small gallery below your reply — you don't need to (and shouldn't) embed or reference the image URLs yourself in your text. If you already know a genuinely useful, directly-relevant image URL from some other source (e.g. one already present in on-screen context), you may embed it inline with standard markdown image syntax ![alt text](url) — but never invent an image URL, and don't add images just to decorate a reply.

CITATIONS: When you use web_search, cite sources plainly in your visible reply where it's natural to do so (e.g. "according to [Site Name]" or a short "(source: example.com)" note) rather than only relying on the separate source list appended after your answer — this makes it clear which specific claim came from where, especially if you searched more than once in the same turn.

Keep replies concise and easy to read in a chat bubble.${channelAddendum ? `\n\n${channelAddendum}` : ""}`;
}

// ── Background memory-update helpers ────────────────────────────────────────
// Both are fire-and-forget: called after res.end() so they never block the
// streaming response. Errors are logged and swallowed.

async function updateMemorySummary(
  userId: number,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  const config = await getElaineGlobalConfig();
  const model = config.subagentModel || config.chatModel;

  const [existing] = await db
    .select({ id: elaineMemory.id, content: elaineMemory.content })
    .from(elaineMemory)
    .where(eq(elaineMemory.type, "summary"))
    .limit(1);

  const currentSummary =
    existing?.content ??
    "(no summary yet — this is the first conversation turn)";

  const prompt = `You maintain a brief "memory summary" for Elaine, a household AI assistant. It is 3-5 sentences maximum — a knowledgeable friend's mental model of the household updated continuously after every turn. It captures who the household is, what they care about, what they have been working on, and any patterns or recurring context useful for future conversations.

CURRENT SUMMARY:
${currentSummary}

NEW EXCHANGE:
User: ${userMsg.slice(0, 600)}
Elaine: ${assistantMsg.slice(0, 600)}

Update the summary to incorporate anything worth remembering from this exchange. If nothing significant happened in this turn, return the summary unchanged. Return ONLY the updated summary text — no preamble, no explanation, no quotes.`;

  const newSummary = await callModel(model, async (client, mdl) => {
    const resp = await client.chat.completions.create({
      model: mdl,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
    });
    return resp.choices[0]?.message?.content?.trim() ?? null;
  });

  if (!newSummary) return;

  if (existing) {
    await db
      .update(elaineMemory)
      .set({ content: newSummary })
      .where(eq(elaineMemory.id, existing.id));
  } else {
    await db.insert(elaineMemory).values({
      type: "summary",
      content: newSummary,
      createdByUserId: userId,
    });
  }
}

async function extractAndSaveMemoryFacts(
  userId: number,
  userMsg: string,
  assistantMsg: string,
  existingFactContents: string[],
): Promise<void> {
  const config = await getElaineGlobalConfig();
  const model = config.subagentModel || config.chatModel;

  const knownFacts =
    existingFactContents.length > 0
      ? existingFactContents.map((c) => `- ${c}`).join("\n")
      : "(none yet)";

  const prompt = `You help maintain a household memory system for an AI assistant called Elaine. After each conversation turn, extract any NEW facts, preferences, or household information worth storing permanently — things that would be useful context in a future conversation.

ALREADY KNOWN:
${knownFacts}

NEW EXCHANGE:
User: ${userMsg.slice(0, 600)}
Elaine: ${assistantMsg.slice(0, 600)}

List NEW facts not already covered by what is known. Good candidates: preferences, household names, important dates, ongoing plans, things to remember, interests, constraints. Skip anything ephemeral or already captured above. Return one fact per line starting with "- ". If nothing new is worth storing permanently, return exactly: NONE`;

  const response = await callModel(model, async (client, mdl) => {
    const resp = await client.chat.completions.create({
      model: mdl,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });
    return resp.choices[0]?.message?.content?.trim() ?? null;
  });

  if (!response || response.toUpperCase() === "NONE") return;

  const lines = response
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const fact of lines) {
    if (fact.length > 5 && fact.toUpperCase() !== "NONE") {
      await db
        .insert(elaineMemory)
        .values({ type: "fact", content: fact, createdByUserId: userId });
    }
  }
}

router.post("/chat", async (req, res) => {
  const userId = req.session.userId!;
  const {
    message,
    pageContext,
    appId,
    conversationId,
    attachmentUrls,
    attachmentPdfs,
    pageScreenshotUrl,
    userLat,
    userLng,
  } = ChatBody.parse(req.body);

  // Fetch config early — needed for auto-summarise and other tasks.
  const elaineConfig = await getElaineGlobalConfig();

  const [user] = await db
    .select({ displayName: appUsers.displayName, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userName = user?.displayName || user?.email || "there";

  // ── Resolve the named history conversation ───────────────────────────────
  // When no conversationId is provided (embedded widget across all apps), use
  // the shared "household" widget thread (isWidgetDefault=true) rather than
  // creating a new conversation on every message. The standalone Elaine app
  // always sends an explicit conversationId from its sidebar, so it is
  // unaffected.
  let histConvId: number | null = conversationId ?? null;
  if (histConvId === null) {
    // Look up the existing widget thread for this user.
    const [existing] = await db
      .select({ id: elaineHistoryConversations.id })
      .from(elaineHistoryConversations)
      .where(
        and(
          eq(elaineHistoryConversations.userId, userId),
          eq(elaineHistoryConversations.isWidgetDefault, true),
        ),
      )
      .limit(1);

    if (existing) {
      histConvId = existing.id;
    } else {
      // First widget message — create the shared household thread.
      const [newConv] = await db
        .insert(elaineHistoryConversations)
        .values({ userId, title: "Household", isWidgetDefault: true })
        .returning({ id: elaineHistoryConversations.id });
      histConvId = newConv?.id ?? null;
    }
  } else {
    // Verify the named conversation belongs to this user before loading it.
    const [conv] = await db
      .select({ id: elaineHistoryConversations.id })
      .from(elaineHistoryConversations)
      .where(
        and(
          eq(elaineHistoryConversations.id, histConvId),
          eq(elaineHistoryConversations.userId, userId),
        ),
      );
    if (!conv) histConvId = null;
  }

  // Tag the active Sentry trace with the DB conversation ID so every
  // model call in this turn appears in Sentry AI Conversations.
  if (histConvId !== null) {
    Sentry.setConversationId(`elaine-${histConvId}`);
  }

  // ── Load history + auto-summarise long threads ───────────────────────────
  // When a named thread exceeds 40 messages, we summarise everything except
  // the last 20 turns into a single system block. The summary is cached on
  // the conversation row (summarizedUpToId) so it is only re-generated when
  // new messages have been added since the last summarisation.
  let history: ChatMessage[] = [];
  let summaryPrefixBlock: string | null = null;

  if (histConvId !== null) {
    // Load with IDs so we can detect whether the cached summary is stale.
    const [convRow, histMsgsRaw] = await Promise.all([
      db
        .select({
          summary: elaineHistoryConversations.summary,
          summarizedUpToId: elaineHistoryConversations.summarizedUpToId,
        })
        .from(elaineHistoryConversations)
        .where(eq(elaineHistoryConversations.id, histConvId))
        .then((rows) => rows[0] ?? null),
      db
        .select({
          id: elaineHistoryMessages.id,
          role: elaineHistoryMessages.role,
          content: elaineHistoryMessages.content,
        })
        .from(elaineHistoryMessages)
        .where(eq(elaineHistoryMessages.conversationId, histConvId))
        .orderBy(elaineHistoryMessages.createdAt),
    ]);

    if (histMsgsRaw.length > 40) {
      // Everything except the last 20 messages will be summarised.
      const cutoffMsg = histMsgsRaw[histMsgsRaw.length - 21];
      const recentMsgs = histMsgsRaw.slice(-20);

      const cachedSummary =
        convRow?.summarizedUpToId === cutoffMsg.id && convRow.summary
          ? convRow.summary
          : null;

      if (cachedSummary) {
        summaryPrefixBlock = cachedSummary;
      } else {
        // Generate a fresh summary using the cheaper subagent model.
        const toSummarise = histMsgsRaw.slice(0, histMsgsRaw.length - 20);
        const summaryPrompt = `Summarise the following conversation between a user and Elaine (a household AI assistant) in 4-6 sentences. Focus on: decisions made, topics discussed, actions taken, and context that would help Elaine understand a follow-up. Be concise but specific.\n\n${toSummarise
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Elaine"}: ${m.content.slice(0, 300)}`,
          )
          .join("\n\n")}`;

        const generated = await callModel(
          elaineConfig.subagentModel || elaineConfig.chatModel,
          async (client, mdl) => {
            const resp = await client.chat.completions.create({
              model: mdl,
              messages: [{ role: "user", content: summaryPrompt }],
              max_tokens: 350,
            });
            return resp.choices[0]?.message?.content?.trim() ?? null;
          },
        );

        if (generated) {
          summaryPrefixBlock = generated;
          // Cache it — don't await, just fire off.
          db.update(elaineHistoryConversations)
            .set({ summary: generated, summarizedUpToId: cutoffMsg.id })
            .where(eq(elaineHistoryConversations.id, histConvId))
            .catch((err) =>
              req.log.error({ err }, "Failed to cache conversation summary"),
            );
        }
      }

      history = recentMsgs.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    } else {
      history = histMsgsRaw.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    }
  } else {
    const conversation = await getOrCreateConversation(userId);
    history = (conversation?.messages as ChatMessage[] | null) ?? [];
  }

  // ── Load memory (facts + rolling summary) ───────────────────────────────
  const turnMemoryFilter = and(
    eq(elaineMemory.active, true),
    isNull(elaineMemory.deletedAt),
    or(isNull(elaineMemory.expiresAt), sql`${elaineMemory.expiresAt} > NOW()`),
    or(
      sql`${elaineMemory.scope} != 'personal'`,
      eq(elaineMemory.ownerUserId, userId),
    ),
  );
  const [factRows, memorySummaryRows] = await Promise.all([
    db
      .select({ content: elaineMemory.content })
      .from(elaineMemory)
      .where(and(eq(elaineMemory.type, "fact"), turnMemoryFilter))
      .orderBy(desc(elaineMemory.createdAt))
      .limit(30),
    db
      .select({ content: elaineMemory.content })
      .from(elaineMemory)
      .where(and(eq(elaineMemory.type, "summary"), turnMemoryFilter))
      .limit(1),
  ]);
  const existingFactContents = factRows.map((r) => r.content);
  const memoryBlock =
    existingFactContents.length > 0
      ? existingFactContents.map((c) => `- ${c}`).join("\n")
      : "(nothing remembered yet)";
  const memorySummary = memorySummaryRows[0]?.content ?? null;

  const [settingsRow] = await db
    .select({
      actionConfirmationMode: elaineSettings.actionConfirmationMode,
    })
    .from(elaineSettings)
    .where(eq(elaineSettings.userId, userId));
  const actionConfirmationMode: ActionConfirmationMode =
    (settingsRow?.actionConfirmationMode as
      | ActionConfirmationMode
      | undefined) ?? "one_by_one";

  const appLabel = CURRENT_APP_LABEL[appId];
  const systemPrompt = buildElaineCoreSystemPrompt({
    userName,
    channelLabel: appLabel,
    contextBlockLabel: `live, possibly unsaved, on-screen state in ${appLabel}`,
    contextBlock: sanitizePageContext(pageContext),
    memoryBlock,
    memorySummary,
    actionConfirmationMode,
    isTravelsApp: appId === "travels",
    userLocation:
      userLat != null && userLng != null
        ? { lat: userLat, lng: userLng }
        : null,
  });

  // systemPrompt is now built above via buildElaineCoreSystemPrompt.
  // The old inline template literal has been replaced by that function call.

  // Build the user turn content. PDFs are injected as text blocks (extracted
  // server-side at upload time) before any vision image parts. History messages
  // are always text-only (URLs are stored in the DB but not re-sent to the model).
  const hasImages = attachmentUrls && attachmentUrls.length > 0;
  const hasPdfs = attachmentPdfs && attachmentPdfs.length > 0;
  const hasPageScreenshot = !!pageScreenshotUrl;
  const userTurnContent:
    | OpenAI.Chat.Completions.ChatCompletionContentPart[]
    | string =
    hasImages || hasPdfs || hasPageScreenshot
      ? [
          ...(hasPdfs
            ? attachmentPdfs!.map((pdf) => ({
                type: "text" as const,
                text: `[Attached PDF: ${pdf.name}]\n${pdf.extractedText ?? "(no text extracted)"}`,
              }))
            : []),
          { type: "text" as const, text: message },
          ...(hasImages
            ? attachmentUrls!.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              }))
            : []),
          // Auto-captured page screenshot — included for visual context only,
          // not persisted in conversation history.
          ...(hasPageScreenshot
            ? [
                {
                  type: "image_url" as const,
                  image_url: { url: pageScreenshotUrl! },
                },
              ]
            : []),
        ]
      : message;

  // Combine all attachments (images + PDFs) for history storage. PDFs keep
  // their original upload filename so the UI never has to fall back to the
  // random UUID storage path when rendering the chip.
  const allAttachmentUrls: AttachmentRef[] = [
    ...(attachmentUrls ?? []).map(
      (url): AttachmentRef => ({ url, type: "image" }),
    ),
    ...(attachmentPdfs?.map(
      (p): AttachmentRef => ({ url: p.url, type: "pdf", name: p.name }),
    ) ?? []),
  ];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // When an older thread was summarised, inject the summary as a system
    // message so the model has full context without the token cost of the
    // original turns.
    ...(summaryPrefixBlock
      ? [
          {
            role: "system" as const,
            content: `[EARLIER CONVERSATION — SUMMARISED]\n${summaryPrefixBlock}`,
          },
        ]
      : []),
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userTurnContent },
  ];

  // Streamed as Server-Sent Events so the client can show elAIne's reply (and
  // a proposed action's confirmation card) building up incrementally instead
  // of waiting for the entire completion to land at once.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  let rawContent = "";
  // Citation URLs collected from web_search calls, in tool-call order.
  // Embedded into the final assistant message content so they survive refresh.
  const allCitations: string[] = [];
  // Proposed (not-yet-executed) actions for one_by_one / all_at_once modes,
  // in the order the model produced them.
  const resolvedActions: ProposedAction[] = [];
  let navigate: { path: string; reason: string } | null = null;
  let updatedActionConfirmationMode: ActionConfirmationMode | null = null;
  const executedActions: Array<
    ProposedAction & { status: number; result: unknown }
  > = [];

  // web_search is the one tool whose result the model needs back before it
  // can write its final reply — unlike the other "soft" tools (navigate,
  // remember, set mode) which apply immediately with no further model input.
  // That means a turn using it takes two model calls: one that emits the
  // search tool_call(s), then a second with the results appended as `tool`
  // messages so the model can answer using them. Capped at MAX_ROUNDS so a
  // confused model can't loop indefinitely on our AI spend — one search
  // round plus one mandatory final-answer round covers "look this up, then
  // tell me" without unbounded cost.
  const MAX_ROUNDS = 4;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Indices already turned into a proposed action, so the post-stream pass
    // doesn't double-send one already caught mid-stream. Scoped per round —
    // OpenAI/OpenRouter restart tool-call indices at 0 on every response, so
    // reusing this across rounds could wrongly skip a same-indexed action
    // from a later round. Only used outside auto_run, since auto_run never
    // sends a proposal — it executes instead.
    const sentActionIndices = new Set<number>();
    // Accumulates streamed tool-call fragments by their index. `arguments`
    // arrives as growing string fragments across multiple chunks — this is
    // the standard OpenAI/OpenRouter streaming tool-call shape. `id` only
    // arrives on a tool call's first chunk, alongside its name.
    const toolCallAcc = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    try {
      await callModelWithSubagent(
        elaineConfig.chatModel,
        ASSISTANT_SUBAGENT_INSTRUCTIONS,
        async (client, model, serverTools) => {
          const stream = await client.chat.completions.create(
            {
              model,
              tools: [
                ...(serverTools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[]),
                ...ACTION_TOOLS,
                ...SOFT_TOOLS,
                ...SOFT_TOOLS_EXTRA,
              ],
              messages,
              max_tokens: elaineConfig.maxResponseTokens,
              stream: true,
            },
            { timeout: elaineConfig.requestTimeoutMs },
          );

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              rawContent += delta.content;
              sendEvent("delta", { text: delta.content });
            }

            for (const tc of delta.tool_calls ?? []) {
              const acc = toolCallAcc.get(tc.index) ?? {
                id: "",
                name: "",
                args: "",
              };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              toolCallAcc.set(tc.index, acc);

              // auto_run never proposes mid-stream — every action is executed
              // together in one pass once the full turn (and its arguments)
              // have finished streaming, see below.
              if (
                actionConfirmationMode !== "auto_run" &&
                !sentActionIndices.has(tc.index) &&
                ACTION_TOOL_NAMES.has(acc.name)
              ) {
                const early = await tryBuildAction(acc.name, acc.args);
                if (early) {
                  sendEvent("action", early);
                  sentActionIndices.add(tc.index);
                  resolvedActions.push(early);
                }
              }
            }
          }
        },
        { subagentModel: elaineConfig.subagentModel },
      );
    } catch (err) {
      req.log.error({ err }, "elAIne assistant stream failed");
      sendEvent("error", { message: "elAIne couldn't respond just now." });
      res.end();
      return;
    }

    // Resolve any tool calls not already handled mid-stream. Content no
    // longer needs cleanup here — unlike the old regex-directive scheme, tool
    // calls arrive as a structured field separate from the reply text.
    const HARD_TOOL_NAMES = new Set([
      SEARCH_HOUSEHOLD_TOOL_NAME,
      SHOW_TRIP_CARD_TOOL_NAME,
      SHOW_POTTERY_ITEM_TOOL_NAME,
      SHOW_FABRIC_SWATCH_TOOL_NAME,
      SHOW_ORNAMENT_ITEM_TOOL_NAME,
      WEB_SEARCH_TOOL_NAME,
      EBAY_SEARCH_TOOL_NAME,
      SEARCH_HALLMARK_TOOL_NAME,
      SEARCH_FLIGHTS_TOOL_NAME,
      FETCH_PAGE_TOOL_NAME,
      CONSULT_EXPERTS_TOOL_NAME,
      GET_WEATHER_TOOL_NAME,
      FIND_NEARBY_PLACES_TOOL_NAME,
      GET_ROUTE_INFO_TOOL_NAME,
      GET_AIR_QUALITY_TOOL_NAME,
      GET_POLLEN_FORECAST_TOOL_NAME,
      CALCULATE_YARDAGE_TOOL_NAME,
      QUERY_HOUSEHOLD_TOOL_NAME,
      LOOKUP_BARCODE_TOOL_NAME,
    ]);
    const hardToolCalls: Array<{ id: string; name: string; args: string }> = [];

    for (const [index, { id, name, args }] of toolCallAcc.entries()) {
      if (HARD_TOOL_NAMES.has(name)) {
        if (id) hardToolCalls.push({ id, name, args });
        continue;
      }

      if (name === REMEMBER_TOOL_NAME) {
        try {
          const parsed = RememberToolPayload.safeParse(JSON.parse(args));
          if (parsed.success) {
            const scope = parsed.data.scope ?? "household";
            const expiresAt = parsed.data.expires_in_days
              ? new Date(Date.now() + parsed.data.expires_in_days * 86400000)
              : scope === "temporary"
                ? new Date(Date.now() + 30 * 86400000)
                : undefined;
            await db.insert(elaineMemory).values({
              content: parsed.data.content,
              scope,
              category: parsed.data.category ?? "fact",
              sensitivity: parsed.data.sensitivity ?? "low",
              ownerUserId: scope === "personal" ? userId : null,
              expiresAt,
              createdByUserId: userId,
            });
          }
        } catch {
          // Malformed JSON from the model — drop it, keep the reply text.
        }
        continue;
      }

      if (name === SET_MODE_TOOL_NAME) {
        try {
          const parsed = SetModeToolPayload.safeParse(JSON.parse(args));
          if (parsed.success) {
            updatedActionConfirmationMode = parsed.data.mode;
            await db
              .insert(elaineSettings)
              .values({ userId, actionConfirmationMode: parsed.data.mode })
              .onConflictDoUpdate({
                target: elaineSettings.userId,
                set: {
                  actionConfirmationMode: parsed.data.mode,
                  updatedAt: new Date(),
                },
              });
          }
        } catch {
          // Malformed JSON from the model — drop it.
        }
        continue;
      }

      if (name === SHOW_DATA_CARD_TOOL_NAME) {
        try {
          const parsed = ShowDataCardToolPayload.safeParse(JSON.parse(args));
          if (parsed.success) {
            sendEvent("widget", {
              type: "data_card",
              title: parsed.data.title,
              rows: parsed.data.rows,
            });
          }
        } catch {
          // Malformed JSON from the model — drop it, keep the reply text.
        }
        continue;
      }

      if (name === NAVIGATE_TOOL_NAME) {
        if (navigate) continue; // only surface the first navigate suggestion
        try {
          const parsed = navigatePayloadSchemaFor(appId).safeParse(
            JSON.parse(args),
          );
          if (parsed.success) navigate = parsed.data;
        } catch {
          // Malformed JSON from the model — drop it.
        }
        continue;
      }

      if (!ACTION_TOOL_NAMES.has(name)) continue;

      // auto_run: execute every proposed action from this turn right away —
      // there is no confirmation step, so the reply's "done" event carries
      // what actually happened instead of a pending proposal.
      if (actionConfirmationMode === "auto_run") {
        const finalAction = await tryBuildAction(name, args);
        if (!finalAction) continue;
        const executor = ACTION_EXECUTORS[finalAction.type as ActionType];
        const { status, body } = await executor(
          finalAction.payload as never,
          userId,
        );
        executedActions.push({ ...finalAction, status, result: body });
        continue;
      }

      if (sentActionIndices.has(index)) continue;
      const finalAction = await tryBuildAction(name, args);
      if (finalAction) {
        sendEvent("action", finalAction);
        sentActionIndices.add(index);
        resolvedActions.push(finalAction);
      }
    }

    if (hardToolCalls.length === 0 || round === MAX_ROUNDS - 1) break;

    // Let the user know why the reply is taking longer than usual instead of
    // leaving them wondering if elAIne is hung — this round can involve
    // several sequential/parallel model calls before she writes anything.
    const distinctHardToolNames = new Set(hardToolCalls.map((c) => c.name));
    const STATUS_LABELS: Record<string, string> = {
      [SEARCH_HOUSEHOLD_TOOL_NAME]: "searching your collection",
      [SHOW_TRIP_CARD_TOOL_NAME]: "looking up that trip",
      [SHOW_POTTERY_ITEM_TOOL_NAME]: "looking up that pottery piece",
      [SHOW_FABRIC_SWATCH_TOOL_NAME]: "looking up that fabric",
      [SHOW_ORNAMENT_ITEM_TOOL_NAME]: "looking up that ornament",
      [WEB_SEARCH_TOOL_NAME]: "searching the web",
      [EBAY_SEARCH_TOOL_NAME]: "checking eBay sold listings",
      [SEARCH_HALLMARK_TOOL_NAME]: "searching Hallmark.com",
      [SEARCH_FLIGHTS_TOOL_NAME]: "checking flight prices",
      [FETCH_PAGE_TOOL_NAME]: "reading that page",
      [CONSULT_EXPERTS_TOOL_NAME]: "checking in with a couple of experts",
      [GET_WEATHER_TOOL_NAME]: "checking the forecast",
      [FIND_NEARBY_PLACES_TOOL_NAME]: "looking up places",
      [GET_ROUTE_INFO_TOOL_NAME]: "checking travel times",
      [GET_AIR_QUALITY_TOOL_NAME]: "checking air quality",
      [GET_POLLEN_FORECAST_TOOL_NAME]: "checking pollen levels",
      [CALCULATE_YARDAGE_TOOL_NAME]: "calculating yardage",
      [LOOKUP_BARCODE_TOOL_NAME]: "looking up that barcode",
    };
    const statusMessage = [...distinctHardToolNames]
      .map((n) => STATUS_LABELS[n])
      .join(", ");
    sendEvent("status", {
      message: `${statusMessage.charAt(0).toUpperCase()}${statusMessage.slice(1)}…`,
    });

    // Feed tool results back so the model can write its real answer next
    // round. Reset rawContent first — models essentially never emit text
    // alongside a tool call, but if one did, it'd otherwise be duplicated
    // ahead of the actual answer in the final saved/sent content.
    messages.push({
      role: "assistant",
      content: rawContent || null,
      tool_calls: hardToolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    });
    rawContent = "";

    const webSearchCitations = new Map<string, string[]>();

    await Promise.all(
      hardToolCalls.map(async (call) => {
        const _toolT0 = Date.now();
        let _toolOk = false;
        let resultText: string;
        try {
          if (call.name === WEB_SEARCH_TOOL_NAME) {
            const parsed = WebSearchToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid search query — ask the user to rephrase.";
            } else {
              const { answer, citations, images } = await webSearch(
                parsed.data.query,
              );
              webSearchCitations.set(call.id, citations);
              resultText = answer
                ? citations.length > 0
                  ? `${answer}\n\nSources:\n${citations.map((url, i) => `[${i + 1}] ${url}`).join("\n")}`
                  : answer
                : "No results found for this search.";
              if (images.length > 0) {
                sendEvent("widget", {
                  type: "image_card",
                  images: images.map((img) => ({
                    url: img.url,
                    sourceUrl: img.sourceUrl,
                  })),
                });
              }
            }
          } else if (call.name === EBAY_SEARCH_TOOL_NAME) {
            const parsed = EbaySearchToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid eBay search — ask the user to rephrase the query.";
            } else {
              const { query, category } = parsed.data;
              const fullQuery =
                category === "ornaments"
                  ? buildEbayQuery(query, {})
                  : category === "pottery"
                    ? buildEbayQuery(query, {})
                    : query;
              const ebayResult = await lookupEbayMarketValue(fullQuery, {
                withAspects: category === "ornaments",
              });
              if (!ebayResult) {
                resultText = `No sold listings found on eBay for "${query}". The item may be rare, recently listed, or the query needs to be more specific.`;
              } else {
                const lines = [
                  `eBay sold listings for "${query}" (${ebayResult.listingCount} found):`,
                  `Price range: $${ebayResult.priceMinUsd.toFixed(2)} – $${ebayResult.priceMaxUsd.toFixed(2)} (median $${ebayResult.priceMedianUsd.toFixed(2)})`,
                ];
                if (
                  ebayResult.itemSpecifics &&
                  Object.keys(ebayResult.itemSpecifics).length > 0
                ) {
                  lines.push(
                    "Item attributes: " +
                      Object.entries(ebayResult.itemSpecifics)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", "),
                  );
                }
                lines.push("Recent sold listings:");
                for (const l of ebayResult.listings.slice(0, 5)) {
                  lines.push(
                    `  • ${l.title} — $${l.soldPrice.toFixed(2)}${l.condition ? ` (${l.condition})` : ""}${l.soldDate ? `, sold ${l.soldDate.slice(0, 10)}` : ""}${l.itemUrl ? ` — ${l.itemUrl}` : ""}`,
                  );
                }
                resultText = lines.join("\n");
              }
            }
          } else if (call.name === SEARCH_HALLMARK_TOOL_NAME) {
            const parsed = SearchHallmarkToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid Hallmark search — provide a name or hallmarkSku.";
            } else {
              // DB-first: skip Apify if the ornament is already in the local catalog
              let result = await lookupHallmarkFromDb(parsed.data).catch(
                () => null,
              );
              if (!result && env.apifyApiToken) {
                result = await searchHallmark(parsed.data).catch(
                  (err: unknown) => {
                    logger.warn(
                      { err },
                      "elaine hallmark search failed (non-fatal)",
                    );
                    return null;
                  },
                );
              }
              if (!result) {
                resultText = `No Hallmark product found for "${parsed.data.hallmarkSku ?? parsed.data.name ?? "(unknown)"}". Try a different name or SKU.`;
              } else {
                const lines = [`Hallmark product: ${result.name ?? "Unknown"}`];
                if (result.hallmarkSku)
                  lines.push(`SKU: ${result.hallmarkSku}`);
                if (result.year) lines.push(`Year: ${result.year}`);
                if (result.seriesName)
                  lines.push(`Series: ${result.seriesName}`);
                if (result.artist) lines.push(`Artist: ${result.artist}`);
                if (result.originalRetailPrice != null)
                  lines.push(
                    `Original retail: $${result.originalRetailPrice.toFixed(2)}`,
                  );
                if (result.collectorPriceUsd != null)
                  lines.push(
                    `Collector price: $${result.collectorPriceUsd.toFixed(2)}`,
                  );
                if (result.description)
                  lines.push(`Description: ${result.description}`);
                if (result.hallmarkProductUrl)
                  lines.push(`URL: ${result.hallmarkProductUrl}`);
                resultText = lines.join("\n");
              }
            }
          } else if (call.name === SEARCH_FLIGHTS_TOOL_NAME) {
            const parsed = SearchFlightsToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid flight search — provide originIata and destination.";
            } else if (!env.apifyApiToken) {
              resultText = "Flight search is not configured on this server.";
            } else {
              const result = await lookupFlightPrices(
                parsed.data.originIata,
                parsed.data.destination,
                env.apifyApiToken,
                {
                  departDate: parsed.data.departDate,
                  returnDate: parsed.data.returnDate,
                },
              ).catch((err: unknown) => {
                logger.warn({ err }, "elaine flight search failed (non-fatal)");
                return null;
              });
              if (!result || result.options.length === 0) {
                resultText = `No flights found from ${parsed.data.originIata} to ${parsed.data.destination}. Try a different origin airport code or destination.`;
              } else {
                const dateLabel = parsed.data.departDate
                  ? `${parsed.data.departDate}${parsed.data.returnDate ? ` – ${parsed.data.returnDate}` : ""}`
                  : "~30 days from now, 7-night stay";
                const lines = [
                  `Flights from ${result.originIata} to ${result.destinationQuery}:`,
                  `Cheapest: $${result.priceMinUsd.toFixed(0)} ${result.currency}`,
                  `(Dates: ${dateLabel})`,
                  "",
                  "Options:",
                ];
                for (const opt of result.options.slice(0, 5)) {
                  const parts = [
                    `  • $${opt.price.toFixed(0)} ${opt.currency ?? result.currency}`,
                  ];
                  if (opt.airline) parts.push(opt.airline);
                  if (opt.stops != null)
                    parts.push(
                      opt.stops === 0
                        ? "nonstop"
                        : `${opt.stops} stop${opt.stops > 1 ? "s" : ""}`,
                    );
                  if (opt.durationMinutes)
                    parts.push(
                      `${Math.floor(opt.durationMinutes / 60)}h ${opt.durationMinutes % 60}m`,
                    );
                  if (opt.deepLink) parts.push(`— ${opt.deepLink}`);
                  lines.push(parts.join(", "));
                }
                resultText = lines.join("\n");
              }
            }
          } else if (call.name === FETCH_PAGE_TOOL_NAME) {
            const parsed = FetchPageToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid URL — ask the user to provide a valid https:// link.";
            } else {
              resultText = await fetchPage(parsed.data.url);
            }
          } else if (call.name === CONSULT_EXPERTS_TOOL_NAME) {
            const parsed = ConsultExpertsToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid question — ask the user to rephrase.";
            } else {
              const { answer } = await consultExperts(
                parsed.data.question,
                parsed.data.context,
              );
              resultText =
                answer ||
                "No panel opinion could be gathered — answer from your own best judgment instead.";
            }
          } else if (call.name === GET_WEATHER_TOOL_NAME) {
            const parsed = GetWeatherToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid location — ask the user to clarify.";
            } else {
              const locationName = parsed.data.locationName;
              // Normalize optional lat/lng to null for clean narrowing
              let lat: number | null = parsed.data.lat ?? null;
              let lng: number | null = parsed.data.lng ?? null;
              // Geocode from locationName when coordinates weren't provided
              if (lat == null || lng == null) {
                const geoPlaces = await searchPlaces(locationName);
                if (
                  geoPlaces.length > 0 &&
                  geoPlaces[0].lat != null &&
                  geoPlaces[0].lng != null
                ) {
                  lat = geoPlaces[0].lat;
                  lng = geoPlaces[0].lng;
                }
              }
              if (lat != null && lng != null) {
                const forecast = await getWeatherForecast(lat, lng);
                if (forecast.length > 0) {
                  resultText =
                    `Forecast for ${locationName}:\n` +
                    forecast
                      .map(
                        (d) =>
                          `${d.date}: ${d.conditionDescription}, ${d.minTempC ?? "?"}–${d.maxTempC ?? "?"}°C` +
                          (d.precipitationChancePercent != null
                            ? `, ${d.precipitationChancePercent}% chance of rain`
                            : ""),
                      )
                      .join("\n");
                  sendEvent("widget", {
                    type: "weather",
                    locationName,
                    days: forecast,
                  });
                } else {
                  resultText = `No forecast data available for ${locationName}.`;
                }
              } else {
                resultText = `Couldn't find coordinates for "${locationName}" — tell the user to try a more specific place name.`;
              }
            }
          } else if (call.name === FIND_NEARBY_PLACES_TOOL_NAME) {
            const parsed = FindNearbyPlacesToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid place search — ask the user to rephrase.";
            } else {
              const places = await searchPlaces(
                parsed.data.query,
                parsed.data.lat,
                parsed.data.lng,
              );
              if (places.length > 0) {
                resultText = places
                  .map(
                    (p) =>
                      `${p.name} — ${p.address}${p.rating != null ? ` (${p.rating}★, ${p.userRatingCount ?? 0} ratings)` : ""}`,
                  )
                  .join("\n");
                sendEvent("widget", {
                  type: "places",
                  query: parsed.data.query,
                  places,
                });
              } else {
                resultText = "No places found for that search.";
              }
            }
          } else if (call.name === GET_ROUTE_INFO_TOOL_NAME) {
            const parsed = GetRouteInfoToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid route request — ask the user to clarify origin/destination.";
            } else {
              const route = await computeRoute(
                parsed.data.origin,
                parsed.data.destination,
                [],
                parsed.data.mode as TravelMode,
                false,
              );
              resultText = route
                ? `${parsed.data.origin.label} to ${parsed.data.destination.label} by ${parsed.data.mode.toLowerCase()}: ${(route.distanceMeters / 1000).toFixed(1)} km, about ${Math.round(route.durationSeconds / 60)} minutes.`
                : `No route found between ${parsed.data.origin.label} and ${parsed.data.destination.label}.`;
            }
          } else if (call.name === GET_AIR_QUALITY_TOOL_NAME) {
            const parsed = GetAirQualityToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid location — ask the user to clarify or use on-screen coordinates.";
            } else {
              const airQuality = await getAirQuality(
                parsed.data.lat,
                parsed.data.lng,
              );
              if (airQuality) {
                resultText = `Air quality in ${parsed.data.locationName}: Universal AQI ${airQuality.aqi} (${airQuality.category}), dominant pollutant ${airQuality.dominantPollutant}.`;
                sendEvent("widget", {
                  type: "air_quality",
                  data: {
                    aqi: airQuality.aqi,
                    category: airQuality.category,
                    dominantPollutant: airQuality.dominantPollutant,
                    locationName: parsed.data.locationName,
                  },
                });
              } else {
                resultText = `No air quality data available for ${parsed.data.locationName}.`;
              }
            }
          } else if (call.name === GET_POLLEN_FORECAST_TOOL_NAME) {
            const parsed = GetPollenForecastToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid location — ask the user to clarify or use on-screen coordinates.";
            } else {
              const pollen = await getPollenForecast(
                parsed.data.lat,
                parsed.data.lng,
              );
              if (pollen) {
                resultText =
                  `Pollen forecast for ${parsed.data.locationName} (${pollen.date}): overall ${pollen.overallCategory}. ` +
                  pollen.types
                    .map((t) => `${t.displayName}: ${t.category}`)
                    .join(", ");
                sendEvent("widget", {
                  type: "pollen",
                  data: {
                    date: pollen.date,
                    overallCategory: pollen.overallCategory,
                    locationName: parsed.data.locationName,
                    types: pollen.types,
                  },
                });
              } else {
                resultText = `No pollen data available for ${parsed.data.locationName}.`;
              }
            }
          } else if (call.name === CALCULATE_YARDAGE_TOOL_NAME) {
            const parsed = CalculateYardageToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText =
                "Invalid quilt dimensions — ask the user to clarify.";
            } else {
              const {
                quiltWidthInches: w,
                quiltHeightInches: h,
                fabricWidthInches: fabricWidth,
                bindingStripWidthInches: bindingStripWidth,
              } = parsed.data;

              // Backing needs an ~8" overhang on each dimension for
              // longarm/hand quilting, and must be pieced into panels if the
              // quilt is wider than the fabric bolt.
              const backingWidthNeeded = w + 8;
              const backingHeightNeeded = h + 8;
              const backingPanels = Math.max(
                1,
                Math.ceil(backingWidthNeeded / fabricWidth),
              );
              const backingLengthInches = backingHeightNeeded * backingPanels;
              const backingYards =
                Math.ceil((backingLengthInches / 36) * 8) / 8;

              // Binding: perimeter plus ~15" slack for mitered corners and
              // the join, cut into strips from the fabric bolt.
              const bindingPerimeterInches = 2 * (w + h) + 15;
              const bindingStrips = Math.max(
                1,
                Math.ceil(bindingPerimeterInches / fabricWidth),
              );
              const bindingYards =
                Math.ceil(((bindingStrips * bindingStripWidth) / 36) * 8) / 8;

              resultText =
                `For a ${w}x${h}" finished quilt:\n` +
                `Backing: ~${backingYards} yards` +
                (backingPanels > 1
                  ? ` (pieced from ${backingPanels} panels of ${fabricWidth}" fabric)`
                  : "") +
                `\n` +
                `Binding: ~${bindingYards} yards (${bindingStrips} strip${bindingStrips === 1 ? "" : "s"} of ${bindingStripWidth}" fabric)\n` +
                `These are estimates with standard overhang/slack allowances — round up when buying, and confirm exact yardage against the pattern if one is being followed.`;
              sendEvent("widget", {
                type: "data_card",
                title: `Yardage estimate: ${w}x${h}"`,
                rows: [
                  {
                    label: "Backing",
                    value: `~${backingYards} yd${backingPanels > 1 ? ` (${backingPanels} panels)` : ""}`,
                  },
                  {
                    label: "Binding",
                    value: `~${bindingYards} yd (${bindingStrips} strips)`,
                  },
                ],
              });
            }
          } else if (call.name === SEARCH_TRIP_DOCUMENTS_TOOL_NAME) {
            const parsed = SearchTripDocumentsToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid search — ask the user to rephrase.";
            } else {
              const { query, tripId } = parsed.data;

              // --- Semantic search via doc_chunks pgvector ---
              // Embed the query, find the top-k closest chunks, then hydrate
              // the parent document rows. Falls back to keyword search if no
              // chunks exist yet (documents uploaded before this feature).
              let semanticDocIds: number[] = [];
              try {
                const qEmbedding = await embedText(query);
                const embStr = `[${qEmbedding.join(",")}]`;
                const chunkRows = await db.execute(sql`
                  SELECT dc.trip_document_id, MIN(dc.embedding <=> ${embStr}::vector) AS dist
                  FROM travels_doc_chunks dc
                  JOIN travels_trip_documents d ON d.id = dc.trip_document_id
                  WHERE ${tripId != null ? sql`d.trip_id = ${tripId}` : sql`TRUE`}
                  GROUP BY dc.trip_document_id
                  ORDER BY dist ASC
                  LIMIT 8
                `);
                semanticDocIds = (
                  chunkRows.rows as { trip_document_id: number }[]
                ).map((r) => r.trip_document_id);
              } catch {
                // fallback to keyword below
              }

              // Fetch matching documents (semantic hits first, then keyword fallback)
              const docFilter =
                semanticDocIds.length > 0
                  ? and(
                      tripId != null
                        ? eq(travelsTripDocuments.tripId, tripId)
                        : undefined,
                      inArray(travelsTripDocuments.id, semanticDocIds),
                    )
                  : tripId != null
                    ? eq(travelsTripDocuments.tripId, tripId)
                    : undefined;

              let rows = await db
                .select({
                  id: travelsTripDocuments.id,
                  tripId: travelsTripDocuments.tripId,
                  title: travelsTripDocuments.title,
                  documentType: travelsTripDocuments.documentType,
                  extractedData: travelsTripDocuments.extractedData,
                  rawText: travelsTripDocuments.rawText,
                })
                .from(travelsTripDocuments)
                .where(docFilter)
                .limit(semanticDocIds.length > 0 ? 8 : 50);

              // If semantic found nothing, fall back to keyword scoring
              if (semanticDocIds.length === 0) {
                const q = query.toLowerCase();
                const scored = rows
                  .map((row) => {
                    const haystack = [
                      row.title ?? "",
                      row.documentType ?? "",
                      JSON.stringify(row.extractedData ?? ""),
                    ]
                      .join(" ")
                      .toLowerCase();
                    const words = q.split(/\s+/).filter(Boolean);
                    const hits = words.filter((w) =>
                      haystack.includes(w),
                    ).length;
                    return { row, hits };
                  })
                  .filter((s) => s.hits > 0)
                  .sort((a, b) => b.hits - a.hits)
                  .slice(0, 5);
                rows = scored.map((s) => s.row);
              } else {
                // Preserve semantic ranking order
                const idxMap = new Map(semanticDocIds.map((id, i) => [id, i]));
                rows.sort(
                  (a, b) => (idxMap.get(a.id) ?? 99) - (idxMap.get(b.id) ?? 99),
                );
                rows = rows.slice(0, 5);
              }

              if (rows.length === 0) {
                resultText = `No uploaded trip documents match "${query}".`;
              } else {
                resultText = rows
                  .map((row) => {
                    const parts = [
                      `Document: ${row.title ?? row.documentType ?? "untitled"} (trip #${row.tripId})`,
                    ];
                    if (row.documentType)
                      parts.push(
                        `Type: ${row.documentType.replace(/_/g, " ")}`,
                      );
                    if (
                      row.extractedData &&
                      typeof row.extractedData === "object"
                    ) {
                      const fields = Object.entries(
                        row.extractedData as Record<string, unknown>,
                      )
                        .filter(([, v]) => v != null && v !== "")
                        .map(([k, v]) => `  ${k}: ${String(v)}`)
                        .join("\n");
                      if (fields) parts.push("Extracted fields:\n" + fields);
                    }
                    // Include a snippet of raw text if available for richer context
                    if (row.rawText) {
                      const snippet = row.rawText
                        .slice(0, 600)
                        .replace(/\s+/g, " ");
                      parts.push(`Raw text excerpt: ${snippet}…`);
                    }
                    return parts.join("\n");
                  })
                  .join("\n\n---\n\n");
              }
            }
          } else if (call.name === GET_EXCHANGE_RATE_TOOL_NAME) {
            const parsed = GetExchangeRateToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid currency — ask the user to clarify.";
            } else {
              const { from, to } = parsed.data;
              try {
                const url = `https://api.frankfurter.app/latest?from=${from}&to=${to.join(",")}`;
                const resp = await withRetry(
                  () => fetch(url, { signal: AbortSignal.timeout(8_000) }),
                  { label: "frankfurter-exchange-rate" },
                );
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = (await resp.json()) as {
                  date: string;
                  rates: Record<string, number>;
                };
                const rates = to.map((code) => ({
                  code,
                  rate: json.rates[code] ?? 0,
                }));
                resultText =
                  `Exchange rates from ${from} (as of ${json.date}):\n` +
                  rates
                    .map((r) => `1 ${from} = ${r.rate.toFixed(4)} ${r.code}`)
                    .join("\n");
                sendEvent("widget", {
                  type: "exchange_rate",
                  from,
                  to: rates,
                  lastUpdated: json.date,
                });
              } catch {
                resultText = `Couldn't fetch exchange rates for ${from} right now — tell the user to try again.`;
              }
            }
          } else if (call.name === SHOW_TRIP_CARD_TOOL_NAME) {
            const parsed = ShowTripCardToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid trip data — skipping card.";
            } else {
              // Always compute countdownDays server-side — never trust the
              // model's arithmetic (it guesses "today" from training data).
              let resolvedStartDate = parsed.data.startDate;
              if (!resolvedStartDate && parsed.data.tripId) {
                const [row] = await db
                  .select({ startDate: travelsTrips.startDate })
                  .from(travelsTrips)
                  .where(eq(travelsTrips.id, parsed.data.tripId))
                  .limit(1);
                resolvedStartDate = row?.startDate ?? undefined;
              }
              let serverCountdownDays: number | undefined = undefined;
              if (resolvedStartDate) {
                const tripStart = new Date(resolvedStartDate + "T00:00:00Z");
                const todayUtc = new Date();
                todayUtc.setUTCHours(0, 0, 0, 0);
                serverCountdownDays = Math.round(
                  (tripStart.getTime() - todayUtc.getTime()) /
                    (1000 * 60 * 60 * 24),
                );
              }
              const tripData = {
                ...parsed.data,
                ...(serverCountdownDays !== undefined
                  ? { countdownDays: serverCountdownDays }
                  : {}),
              };
              sendEvent("widget", { type: "trip_card", trip: tripData });
              resultText =
                serverCountdownDays !== undefined
                  ? `Trip card displayed. Server-verified countdown: ${serverCountdownDays} days (${serverCountdownDays < 0 ? "trip is in the past" : serverCountdownDays === 0 ? "trip starts today" : `trip starts in ${serverCountdownDays} day${serverCountdownDays === 1 ? "" : "s"}`}). Use this exact number in your reply — do not recalculate.`
                  : "Trip card displayed.";
            }
          } else if (call.name === LOOKUP_BARCODE_TOOL_NAME) {
            const parsed = z
              .object({ barcode: z.string() })
              .safeParse(JSON.parse(call.args || "{}"));
            if (!parsed.success) {
              resultText = "Invalid barcode argument.";
            } else {
              try {
                const result = await lookupBarcode(parsed.data.barcode);
                const lines: string[] = [];
                if (result.found) {
                  lines.push(`Found: ${result.name ?? "Unknown product"}`);
                  if (result.brand) lines.push(`Brand: ${result.brand}`);
                  if (result.year) lines.push(`Year: ${result.year}`);
                  if (result.seriesOrCollection)
                    lines.push(
                      `Series/Collection: ${result.seriesOrCollection}`,
                    );
                  if (result.description)
                    lines.push(`Description: ${result.description}`);
                  if (result.hallmarkArtist)
                    lines.push(`Artist: ${result.hallmarkArtist}`);
                  if (result.hallmarkSku)
                    lines.push(`Hallmark SKU: ${result.hallmarkSku}`);
                  if (result.hallmarkSeriesName)
                    lines.push(`Hallmark series: ${result.hallmarkSeriesName}`);
                  if (result.hallmarkRetailPriceUsd != null)
                    lines.push(
                      `Original retail price: $${result.hallmarkRetailPriceUsd}`,
                    );
                  if (result.hallmarkCollectorPriceUsd != null)
                    lines.push(
                      `Collector book value: $${result.hallmarkCollectorPriceUsd}`,
                    );
                  if (result.hallmarkInStock != null)
                    lines.push(
                      `In stock on Hallmark.com: ${result.hallmarkInStock ? "yes" : "no"}`,
                    );
                  if (result.hallmarkProductUrl)
                    lines.push(`Hallmark page: ${result.hallmarkProductUrl}`);
                } else {
                  lines.push(
                    `No product found for barcode ${parsed.data.barcode}. Not in the Hallmark catalog or general product database.`,
                  );
                }
                resultText = lines.join("\n");
              } catch (err) {
                req.log.error({ err }, "lookup_product_barcode failed");
                resultText = "Barcode lookup failed. Please try again.";
              }
            }
          } else if (call.name === QUERY_HOUSEHOLD_TOOL_NAME) {
            const parsed = z
              .object({ include: z.array(z.string()).optional() })
              .safeParse(JSON.parse(call.args || "{}"));
            const includeArg = parsed.success ? parsed.data.include : undefined;
            const include = includeArg ?? [
              "pottery",
              "quilting",
              "ornaments",
              "travels",
            ];
            const parts: string[] = [];

            if (include.includes("pottery")) {
              const [row] = await db
                .select({ total: count() })
                .from(potteryItems);
              const recent = await db
                .select({ name: potteryItems.name })
                .from(potteryItems)
                .orderBy(desc(potteryItems.createdAt))
                .limit(3);
              parts.push(
                `Pottery collection: ${row?.total ?? 0} pieces total.` +
                  (recent.length > 0
                    ? ` Recently added: ${recent.map((r) => r.name).join(", ")}.`
                    : ""),
              );
            }

            if (include.includes("quilting")) {
              const [fabRow] = await db
                .select({ total: count() })
                .from(fabrics);
              const [patRow] = await db
                .select({ total: count() })
                .from(quiltPatterns);
              const [quiltRow] = await db
                .select({ total: count() })
                .from(finishedQuilts);
              parts.push(
                `Quilting stash: ${fabRow?.total ?? 0} fabrics, ${patRow?.total ?? 0} patterns, ${quiltRow?.total ?? 0} finished quilts.`,
              );
            }

            if (include.includes("ornaments")) {
              const [ornRow] = await db
                .select({ total: count() })
                .from(ornamentsItems);
              const ornRecent = await db
                .select({ name: ornamentsItems.name })
                .from(ornamentsItems)
                .orderBy(desc(ornamentsItems.createdAt))
                .limit(3);
              parts.push(
                `Ornaments collection: ${ornRow?.total ?? 0} ornaments total.` +
                  (ornRecent.length > 0
                    ? ` Recently added: ${ornRecent.map((r) => r.name).join(", ")}.`
                    : ""),
              );
            }

            if (include.includes("travels")) {
              const [wishRow] = await db
                .select({ total: count() })
                .from(travelsWishlist);
              const activeTrips = await db
                .select({
                  id: travelsTrips.id,
                  title: travelsTrips.title,
                  destination: travelsTrips.destination,
                  status: travelsTrips.status,
                  startDate: travelsTrips.startDate,
                  endDate: travelsTrips.endDate,
                })
                .from(travelsTrips)
                .where(
                  inArray(travelsTrips.status, [
                    "planning",
                    "booked",
                    "in_progress",
                  ] as string[]),
                )
                .orderBy(travelsTrips.startDate);
              const formatRange = (
                start: string | null,
                end: string | null,
              ) => {
                if (!start && !end) return "dates not set yet";
                if (start && end) return `${start} to ${end}`;
                return start ? `starting ${start}` : `ending ${end}`;
              };
              parts.push(
                `Travels: ${activeTrips.length} active trip(s), ${wishRow?.total ?? 0} on the wishlist.` +
                  (activeTrips.length > 0
                    ? " Active trips:\n" +
                      activeTrips
                        .map(
                          (t) =>
                            `- ${t.title} (${t.destination}), status: ${t.status}, dates: ${formatRange(t.startDate, t.endDate)}, tripId: ${t.id}`,
                        )
                        .join("\n")
                    : ""),
              );
            }

            if (include.includes("app_config")) {
              const configRows = await getAllConfig();
              if (configRows.length > 0) {
                const configByModule: Record<string, string[]> = {};
                for (const r of configRows) {
                  if (!configByModule[r.module]) configByModule[r.module] = [];
                  configByModule[r.module].push(
                    `  ${r.key}: ${r.value} — ${r.label}`,
                  );
                }
                const configText = Object.entries(configByModule)
                  .map(([mod, lines]) => `${mod}:\n${lines.join("\n")}`)
                  .join("\n");
                parts.push(
                  `Control Panel settings (current values):\n${configText}`,
                );
              }
            }

            resultText =
              parts.length > 0 ? parts.join("\n") : "No household data found.";
          } else if (call.name === SHOW_POTTERY_ITEM_TOOL_NAME) {
            const parsed = ShowPotteryItemToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid pottery item ID.";
            } else {
              const [row] = await db
                .select({
                  id: potteryItems.id,
                  name: potteryItems.name,
                  maker: potteryItems.maker,
                  style: potteryItems.style,
                  imagePath: potteryItems.imagePath,
                  aiDescription: potteryItems.aiDescription,
                  dominantColors: potteryItems.dominantColors,
                })
                .from(potteryItems)
                .where(eq(potteryItems.id, parsed.data.itemId));
              if (!row) {
                resultText = `Pottery item #${parsed.data.itemId} not found.`;
              } else {
                let imageUrl: string | undefined;
                try {
                  const ONE_HOUR = 3600;
                  const sc = createClient(
                    env.supabaseUrl,
                    env.supabaseServiceRoleKey,
                    {
                      auth: { persistSession: false, autoRefreshToken: false },
                    },
                  );
                  const { data } = await sc.storage
                    .from("pottery")
                    .createSignedUrl(row.imagePath, ONE_HOUR);
                  imageUrl = data?.signedUrl ?? undefined;
                } catch {
                  // non-fatal — widget shows without image
                }
                sendEvent("widget", {
                  type: "pottery_item",
                  item: {
                    itemId: row.id,
                    name: row.name,
                    maker: row.maker ?? undefined,
                    style: row.style ?? undefined,
                    aiDescription: row.aiDescription ?? undefined,
                    dominantColors:
                      row.dominantColors.length > 0
                        ? row.dominantColors
                        : undefined,
                    imageUrl,
                  },
                });
                resultText = `Pottery item card displayed for "${row.name}".`;
              }
            }
          } else if (call.name === SHOW_FABRIC_SWATCH_TOOL_NAME) {
            const parsed = ShowFabricSwatchToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid fabric ID.";
            } else {
              const [row] = await db
                .select({
                  id: fabrics.id,
                  name: fabrics.name,
                  manufacturer: fabrics.manufacturer,
                  designer: fabrics.designer,
                  imagePath: fabrics.imagePath,
                  aiDescription: fabrics.aiDescription,
                  dominantColors: fabrics.dominantColors,
                })
                .from(fabrics)
                .where(eq(fabrics.id, parsed.data.fabricId));
              if (!row) {
                resultText = `Fabric #${parsed.data.fabricId} not found.`;
              } else {
                let imageUrl: string | undefined;
                try {
                  const ONE_HOUR = 3600;
                  const sc = createClient(
                    env.supabaseUrl,
                    env.supabaseServiceRoleKey,
                    {
                      auth: { persistSession: false, autoRefreshToken: false },
                    },
                  );
                  const { data } = await sc.storage
                    .from("quilting")
                    .createSignedUrl(row.imagePath, ONE_HOUR);
                  imageUrl = data?.signedUrl ?? undefined;
                } catch {
                  // non-fatal
                }
                sendEvent("widget", {
                  type: "fabric_swatch",
                  swatch: {
                    fabricId: row.id,
                    name: row.name,
                    manufacturer: row.manufacturer ?? undefined,
                    designer: row.designer ?? undefined,
                    aiDescription: row.aiDescription ?? undefined,
                    dominantColors:
                      row.dominantColors.length > 0
                        ? row.dominantColors
                        : undefined,
                    imageUrl,
                  },
                });
                resultText = `Fabric swatch card displayed for "${row.name}".`;
              }
            }
          } else if (call.name === SHOW_ORNAMENT_ITEM_TOOL_NAME) {
            const parsed = ShowOrnamentItemToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid ornament item ID.";
            } else {
              const [row] = await db
                .select({
                  id: ornamentsItems.id,
                  name: ornamentsItems.name,
                  imagePath: ornamentsItems.imagePath,
                  seriesOrCollection: ornamentsItems.seriesOrCollection,
                  year: ornamentsItems.year,
                  brand: ornamentsItems.brand,
                  aiDescription: ornamentsItems.aiDescription,
                  dominantColors: ornamentsItems.dominantColors,
                })
                .from(ornamentsItems)
                .where(eq(ornamentsItems.id, parsed.data.itemId));
              if (!row) {
                resultText = `Ornament item #${parsed.data.itemId} not found.`;
              } else {
                let imageUrl: string | undefined;
                try {
                  const ONE_HOUR = 3600;
                  const sc = createClient(
                    env.supabaseUrl,
                    env.supabaseServiceRoleKey,
                    {
                      auth: { persistSession: false, autoRefreshToken: false },
                    },
                  );
                  if (row.imagePath) {
                    const { data } = await sc.storage
                      .from("ornaments")
                      .createSignedUrl(row.imagePath, ONE_HOUR);
                    imageUrl = data?.signedUrl ?? undefined;
                  }
                } catch {
                  // non-fatal
                }
                sendEvent("widget", {
                  type: "ornament_item",
                  item: {
                    itemId: row.id,
                    name: row.name,
                    seriesOrCollection: row.seriesOrCollection ?? undefined,
                    year: row.year ?? undefined,
                    brand: row.brand ?? undefined,
                    aiDescription: row.aiDescription ?? undefined,
                    dominantColors:
                      row.dominantColors && row.dominantColors.length > 0
                        ? row.dominantColors
                        : undefined,
                    imageUrl,
                  },
                });
                resultText = `Ornament card displayed for "${row.name}".`;
              }
            }
          } else if (call.name === SHOW_DESTINATION_CARD_TOOL_NAME) {
            const parsed = ShowDestinationCardToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid destination data.";
            } else {
              const { name, country, highlights } = parsed.data;
              const query = country ? `${name}, ${country}` : name;
              const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
              sendEvent("widget", {
                type: "destination_card",
                card: { name, country, highlights, mapsUrl },
              });
              resultText = `Destination card displayed for "${name}".`;
            }
          } else if (call.name === SUGGEST_CLOTHING_LAYERS_TOOL_NAME) {
            const parsed = SuggestClothingLayersPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid parameters for clothing suggestion.";
            } else {
              const { destination, startDate, endDate, activities, climate } =
                parsed.data;
              const dateRange = startDate
                ? `${startDate}${endDate ? ` to ${endDate}` : ""}`
                : "unspecified dates";
              const actStr = activities?.length
                ? `Activities: ${activities.join(", ")}.`
                : "";
              const climateStr = climate ? `Expected climate: ${climate}.` : "";
              const clothingConfig = await getElaineGlobalConfig();
              const advice = await callModel(
                clothingConfig.chatModel,
                async (client, model) => {
                  const completion = await client.chat.completions.create({
                    model,
                    max_tokens: 600,
                    messages: [
                      {
                        role: "system",
                        content:
                          "You are a practical travel-packing expert. Give concise, specific clothing layer recommendations. No generic advice — tailor everything to the destination and dates. Use short bullet points under each heading. Keep the total response under 300 words.",
                      },
                      {
                        role: "user",
                        content: `Layered clothing recommendations for a trip to ${destination} (${dateRange}). ${climateStr} ${actStr}\n\nOrganise as:\n**Base layers** (moisture management)\n**Mid layers** (insulation)\n**Outer layers** (weather protection)\n**Activity-specific** (if applicable)\n**Accessories**`,
                      },
                    ],
                  });
                  return completion;
                },
              );
              resultText =
                advice.choices[0]?.message.content ??
                "Unable to generate clothing suggestions right now.";
            }
          } else if (call.name === SEARCH_HOUSEHOLD_TOOL_NAME) {
            resultText = await executeRestrictedSoftTool(
              SEARCH_HOUSEHOLD_TOOL_NAME,
              call.args,
            );
          } else {
            resultText = "Unsupported tool.";
          }
          _toolOk = true;
        } catch (err) {
          req.log.error(
            { err, tool: call.name },
            "elAIne hard tool call failed",
          );
          resultText =
            "That lookup failed — tell the user you couldn't get that information right now.";
        }
        req.log.info(
          {
            tool: call.name,
            durationMs: Date.now() - _toolT0,
            success: _toolOk,
          },
          "elaine: tool-call",
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultText,
        });
      }),
    );

    // Collect citations from this round's web searches, in tool-call order,
    // into the outer allCitations array so they survive the loop.
    for (const call of hardToolCalls) {
      if (call.name === WEB_SEARCH_TOOL_NAME) {
        allCitations.push(...(webSearchCitations.get(call.id) ?? []));
      }
    }
  }

  // \x1f (ASCII unit separator) is the delimiter before the citation list.
  // \x00 (null byte) is rejected by PostgreSQL JSONB — \x1f is safe and
  // will never appear in model-generated text.
  const citationSuffix =
    allCitations.length > 0 ? `\x1f${JSON.stringify(allCitations)}` : "";
  const content = rawContent.trim() + citationSuffix;

  const updatedHistory: ChatMessage[] = (
    [
      ...history,
      {
        role: "user" as const,
        content: message,
        ...(allAttachmentUrls.length > 0
          ? { attachmentUrls: allAttachmentUrls }
          : {}),
      },
      { role: "assistant" as const, content },
    ] satisfies ChatMessage[]
  ).slice(-50);

  // Save turn to the named history conversation.
  if (histConvId !== null) {
    await db.insert(elaineHistoryMessages).values([
      {
        conversationId: histConvId,
        userId,
        role: "user",
        content: message,
        attachmentUrls: allAttachmentUrls,
      },
      {
        conversationId: histConvId,
        userId,
        role: "assistant",
        content,
        attachmentUrls: [],
      },
    ]);

    // Auto-title from the first user message (first 60 chars), then just
    // bump updatedAt on subsequent turns.
    if (history.length === 0) {
      const autoTitle =
        message.length > 60 ? message.slice(0, 60) + "…" : message;
      await db
        .update(elaineHistoryConversations)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(elaineHistoryConversations.id, histConvId));
    } else {
      await db
        .update(elaineHistoryConversations)
        .set({ updatedAt: new Date() })
        .where(eq(elaineHistoryConversations.id, histConvId));
    }
  }

  // Also keep the rolling elaineConversations row current for backward compat
  // (GET /conversation and the floating widget's initial load still use it).
  await db
    .update(elaineConversations)
    .set({ messages: updatedHistory, updatedAt: new Date() })
    .where(eq(elaineConversations.userId, userId));

  sendEvent("done", {
    role: "assistant",
    content,
    navigate,
    actions: resolvedActions,
    executedActions,
    actionConfirmationMode:
      updatedActionConfirmationMode ?? actionConfirmationMode,
    messages: updatedHistory,
    conversationId: histConvId,
  });
  res.end();

  // Fire-and-forget memory updates — these never block the response.
  // updateMemorySummary maintains the rolling 3-5 sentence household summary.
  // extractAndSaveMemoryFacts pulls out any new facts worth storing long-term.
  updateMemorySummary(userId, message, content).catch((err) =>
    req.log.error({ err }, "updateMemorySummary background task failed"),
  );
  extractAndSaveMemoryFacts(
    userId,
    message,
    content,
    existingFactContents,
  ).catch((err) =>
    req.log.error({ err }, "extractAndSaveMemoryFacts background task failed"),
  );
});

// Action types that send a real SMS (real per-message cost + abuse surface),
// same as the equivalent hand-written /auth routes — must share their rate
// limiter so the assistant path can't bypass the REST route's protection.
const SMS_RATE_LIMITED_ACTION_TYPES = new Set<ActionType>([
  "send_test_sms",
  "send_phone_verification_code",
]);

function runMiddleware(
  middleware: (
    req: Request,
    res: Response,
    next: (err?: unknown) => void,
  ) => void,
  req: Request,
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    middleware(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

// Executes a write-action elAIne proposed in chat, only once the user has
// explicitly confirmed it in the UI. Every write here is scoped to the
// calling user the same way the equivalent hand-written routes are.
router.post("/action", async (req, res) => {
  const userId = req.session.userId!;
  const action = ActionBody.parse(req.body);
  if (SMS_RATE_LIMITED_ACTION_TYPES.has(action.type)) {
    await runMiddleware(phoneVerifyLimiter, req, res);
    if (res.headersSent) return; // limiter already sent a 429
  }
  const executor = ACTION_EXECUTORS[action.type];
  const { status, body } = await executor(action.payload as never, userId);
  res.status(status).json(body);
});

router.get("/settings", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(elaineSettings)
    .where(eq(elaineSettings.userId, userId));
  res.json({
    enabled: row?.enabled ?? true,
    actionConfirmationMode:
      (row?.actionConfirmationMode as ActionConfirmationMode | undefined) ??
      "one_by_one",
    chatWindowSize:
      (row?.chatWindowSize as ChatWindowSize | undefined) ?? "compact",
  });
});

router.put("/settings", async (req, res) => {
  const userId = req.session.userId!;
  const patch = SettingsBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(elaineSettings)
    .where(eq(elaineSettings.userId, userId));
  const enabled = patch.enabled ?? existing?.enabled ?? true;
  const actionConfirmationMode =
    patch.actionConfirmationMode ??
    (existing?.actionConfirmationMode as ActionConfirmationMode | undefined) ??
    "one_by_one";
  const chatWindowSize =
    patch.chatWindowSize ??
    (existing?.chatWindowSize as ChatWindowSize | undefined) ??
    "compact";
  await db
    .insert(elaineSettings)
    .values({ userId, enabled, actionConfirmationMode, chatWindowSize })
    .onConflictDoUpdate({
      target: elaineSettings.userId,
      set: {
        enabled,
        actionConfirmationMode,
        chatWindowSize,
        updatedAt: new Date(),
      },
    });
  res.json({ enabled, actionConfirmationMode, chatWindowSize });
});

// ── Admin (app-owner-only) global config for Elaine's AI behaviour ────────
// Distinct from /settings above (per-user, self-service). These routes are
// gated on app_users.is_owner, the same "single app owner" flag used to
// gate Travel-calendar reassignment — see travel-calendar.ts.
async function requireOwner(req: Request, res: Response): Promise<boolean> {
  const userId = req.session.userId!;
  const [me] = await db
    .select({ isOwner: appUsers.isOwner })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!me?.isOwner) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Daily brief — a personalised once-per-UTC-day morning summary.
// Queries next upcoming trip, overdue reminders, and yesterday's household
// activity across all apps, then asks OpenRouter to compose a 2–4 sentence
// friendly brief with one highlighted action for the day.
// ---------------------------------------------------------------------------

// NOTE ON SCOPING: pottery, quilting, and travels data are fully
// household-shared — there is no per-user ownership boundary within these apps.
// The generated brief draws from household-wide data (all trips, all reminders,
// all collection items regardless of which household member created them), which
// is consistent with the architecture (see replit.md and threat_model.md).
// The userId parameter scopes the CACHE row (one brief per user per UTC day),
// not the content queries.
async function generateDailyBriefContent(userId: number): Promise<string> {
  // userId is used only to ensure the context prompt is addressed to the right
  // person. Content queries are household-wide by design.
  void userId;

  const now = new Date();
  const startOfTodayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startOfYesterdayUtc = new Date(
    startOfTodayUtc.getTime() - 24 * 60 * 60 * 1000,
  );
  const todayDateStr = startOfTodayUtc.toISOString().slice(0, 10);
  const yesterdayIso = startOfYesterdayUtc.toISOString();
  const todayIso = startOfTodayUtc.toISOString();

  const contextParts: string[] = [];

  // 1. Next upcoming trip
  const [nextTrip] = await db
    .select({
      title: travelsTrips.title,
      destination: travelsTrips.destination,
      startDate: travelsTrips.startDate,
    })
    .from(travelsTrips)
    .where(sql`${travelsTrips.startDate} >= ${todayDateStr}::date`)
    .orderBy(travelsTrips.startDate)
    .limit(1);

  if (nextTrip) {
    if (nextTrip.startDate) {
      const tripStart = new Date(nextTrip.startDate + "T00:00:00Z");
      const daysUntil = Math.round(
        (tripStart.getTime() - startOfTodayUtc.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      contextParts.push(
        `Next upcoming trip: "${nextTrip.title}" to ${nextTrip.destination} — ${
          daysUntil === 0
            ? "starts today!"
            : daysUntil === 1
              ? "starts tomorrow!"
              : `starts in ${daysUntil} days`
        } (${nextTrip.startDate})`,
      );
    } else {
      contextParts.push(
        `Next upcoming trip: "${nextTrip.title}" to ${nextTrip.destination} (no date set yet)`,
      );
    }
  } else {
    contextParts.push("No upcoming trips currently planned");
  }

  // 2. Overdue reminders
  const overdueReminders = await db
    .select({
      title: travelsReminders.title,
      dueDate: travelsReminders.dueDate,
    })
    .from(travelsReminders)
    .where(
      and(
        sql`${travelsReminders.dueDate} < ${todayDateStr}::date`,
        eq(travelsReminders.done, false),
      ),
    )
    .orderBy(travelsReminders.dueDate)
    .limit(5);

  if (overdueReminders.length > 0) {
    const list = overdueReminders
      .map((r) => `"${r.title}" (due ${r.dueDate})`)
      .join(", ");
    contextParts.push(`Overdue reminders: ${list}`);
  } else {
    contextParts.push("No overdue reminders");
  }

  // 3. Yesterday's household activity across all apps (parallel queries)
  const [
    newPotteryItems,
    newFabricItems,
    newPatternItems,
    newQuiltItems,
    newOrnamentItems,
    newTripItems,
    newWishlistItems,
  ] = await Promise.all([
    db
      .select({ name: potteryItems.name })
      .from(potteryItems)
      .where(
        and(
          sql`${potteryItems.createdAt} >= ${yesterdayIso}`,
          sql`${potteryItems.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({ name: fabrics.name })
      .from(fabrics)
      .where(
        and(
          sql`${fabrics.createdAt} >= ${yesterdayIso}`,
          sql`${fabrics.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({ name: quiltPatterns.name })
      .from(quiltPatterns)
      .where(
        and(
          sql`${quiltPatterns.createdAt} >= ${yesterdayIso}`,
          sql`${quiltPatterns.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({ name: finishedQuilts.name })
      .from(finishedQuilts)
      .where(
        and(
          sql`${finishedQuilts.createdAt} >= ${yesterdayIso}`,
          sql`${finishedQuilts.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({ name: ornamentsItems.name })
      .from(ornamentsItems)
      .where(
        and(
          sql`${ornamentsItems.createdAt} >= ${yesterdayIso}`,
          sql`${ornamentsItems.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({
        title: travelsTrips.title,
        destination: travelsTrips.destination,
      })
      .from(travelsTrips)
      .where(
        and(
          sql`${travelsTrips.createdAt} >= ${yesterdayIso}`,
          sql`${travelsTrips.createdAt} < ${todayIso}`,
        ),
      ),
    db
      .select({ destination: travelsWishlist.destination })
      .from(travelsWishlist)
      .where(
        and(
          sql`${travelsWishlist.createdAt} >= ${yesterdayIso}`,
          sql`${travelsWishlist.createdAt} < ${todayIso}`,
        ),
      ),
  ]);

  const activityParts: string[] = [];
  if (newPotteryItems.length > 0)
    activityParts.push(
      `${newPotteryItems.length} new pottery piece${newPotteryItems.length > 1 ? "s" : ""}: ${newPotteryItems.map((p) => p.name).join(", ")}`,
    );
  if (newFabricItems.length > 0)
    activityParts.push(
      `${newFabricItems.length} new fabric${newFabricItems.length > 1 ? "s" : ""}: ${newFabricItems.map((f) => f.name).join(", ")}`,
    );
  if (newPatternItems.length > 0)
    activityParts.push(
      `${newPatternItems.length} new quilt pattern${newPatternItems.length > 1 ? "s" : ""}: ${newPatternItems.map((p) => p.name).join(", ")}`,
    );
  if (newQuiltItems.length > 0)
    activityParts.push(
      `${newQuiltItems.length} quilt${newQuiltItems.length > 1 ? "s" : ""} finished: ${newQuiltItems.map((q) => q.name).join(", ")}`,
    );
  if (newOrnamentItems.length > 0)
    activityParts.push(
      `${newOrnamentItems.length} new ornament${newOrnamentItems.length > 1 ? "s" : ""}: ${newOrnamentItems.map((o) => o.name).join(", ")}`,
    );
  if (newTripItems.length > 0)
    activityParts.push(
      `${newTripItems.length} new trip${newTripItems.length > 1 ? "s" : ""} added: ${newTripItems.map((t) => `${t.title} to ${t.destination}`).join(", ")}`,
    );
  if (newWishlistItems.length > 0)
    activityParts.push(
      `${newWishlistItems.length} wishlist destination${newWishlistItems.length > 1 ? "s" : ""} added: ${newWishlistItems.map((w) => w.destination).join(", ")}`,
    );

  contextParts.push(
    activityParts.length > 0
      ? `Yesterday's household activity: ${activityParts.join("; ")}`
      : "No new items added to any collection yesterday",
  );

  const contextText = contextParts.join("\n");
  const config = await getElaineGlobalConfig();

  return callModel(config.chatModel, async (client, model) => {
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 250,
      messages: [
        {
          role: "system",
          content:
            "You are Elaine, a warm and practical personal assistant for the Batchelor household. Write a brief, friendly morning summary (2–4 sentences) from the data below. End with one specific, actionable suggestion for the day. No headers or bullet points — just natural, conversational flowing text. Refer to the household collectively as 'you'.",
        },
        {
          role: "user",
          content: `Today's household status:\n\n${contextText}\n\nWrite the morning brief.`,
        },
      ],
    });
    return (completion.choices[0]?.message?.content ?? "").trim();
  });
}

// GET /daily-brief — return today's brief (generate on first call of the day).
router.get("/daily-brief", aiLimiter, async (req, res) => {
  const userId = req.session.userId!;
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  const todayIso = startOfTodayUtc.toISOString();

  const [existing] = await db
    .select()
    .from(elaineDailyBriefs)
    .where(
      and(
        eq(elaineDailyBriefs.userId, userId),
        sql`${elaineDailyBriefs.generatedAt} >= ${todayIso}`,
      ),
    )
    .orderBy(desc(elaineDailyBriefs.generatedAt))
    .limit(1);

  if (existing) {
    res.json({
      id: existing.id,
      content: existing.content,
      generatedAt: existing.generatedAt.toISOString(),
      dismissed: existing.dismissed,
    });
    return;
  }

  let content: string;
  try {
    content = await generateDailyBriefContent(userId);
  } catch (err) {
    req.log.error({ err }, "elaine daily brief generation failed");
    res.status(503).json({ error: "Brief generation unavailable" });
    return;
  }

  if (!content) {
    res.status(503).json({ error: "Brief generation returned empty content" });
    return;
  }

  try {
    const [row] = await db
      .insert(elaineDailyBriefs)
      .values({ userId, content })
      .returning();
    if (!row) throw new Error("insert returned no row");
    res.json({
      id: row.id,
      content: row.content,
      generatedAt: row.generatedAt.toISOString(),
      dismissed: row.dismissed,
    });
  } catch (err) {
    // Could be a unique-constraint race — reload and return whatever is there.
    req.log.warn({ err }, "elaine daily brief insert failed, reloading");
    const [reloaded] = await db
      .select()
      .from(elaineDailyBriefs)
      .where(
        and(
          eq(elaineDailyBriefs.userId, userId),
          sql`${elaineDailyBriefs.generatedAt} >= ${todayIso}`,
        ),
      )
      .orderBy(desc(elaineDailyBriefs.generatedAt))
      .limit(1);
    if (reloaded) {
      res.json({
        id: reloaded.id,
        content: reloaded.content,
        generatedAt: reloaded.generatedAt.toISOString(),
        dismissed: reloaded.dismissed,
      });
    } else {
      res.status(500).json({ error: "Failed to store brief" });
    }
  }
});

// POST /daily-brief/dismiss — mark today's brief as seen/dismissed.
router.post("/daily-brief/dismiss", async (req, res) => {
  const userId = req.session.userId!;
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  await db
    .update(elaineDailyBriefs)
    .set({ dismissed: true })
    .where(
      and(
        eq(elaineDailyBriefs.userId, userId),
        sql`${elaineDailyBriefs.generatedAt} >= ${startOfTodayUtc.toISOString()}`,
      ),
    );
  res.status(204).end();
});

// POST /daily-brief/regenerate — delete today's brief and generate a fresh one.
router.post("/daily-brief/regenerate", async (req, res) => {
  const userId = req.session.userId!;
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);

  await db
    .delete(elaineDailyBriefs)
    .where(
      and(
        eq(elaineDailyBriefs.userId, userId),
        sql`${elaineDailyBriefs.generatedAt} >= ${startOfTodayUtc.toISOString()}`,
      ),
    );

  let content: string;
  try {
    content = await generateDailyBriefContent(userId);
  } catch (err) {
    req.log.error({ err }, "elaine daily brief regeneration failed");
    res.status(503).json({ error: "Brief generation unavailable" });
    return;
  }

  if (!content) {
    res.status(503).json({ error: "Brief generation returned empty content" });
    return;
  }

  const [row] = await db
    .insert(elaineDailyBriefs)
    .values({ userId, content })
    .returning();

  if (!row) {
    res.status(500).json({ error: "Failed to store regenerated brief" });
    return;
  }

  res.json({
    id: row.id,
    content: row.content,
    generatedAt: row.generatedAt.toISOString(),
    dismissed: false,
  });
});

router.get("/admin/config", async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const config = await getElaineGlobalConfig();
  res.json(config);
});

const AdminConfigBody = z.object({
  chatModel: z.string().min(1).max(200).optional(),
  subagentModel: z.string().min(1).max(200).optional(),
  requestTimeoutMs: z.number().int().min(2000).max(30000).optional(),
  maxResponseTokens: z.number().int().min(50).max(4000).optional(),
  models: z
    .object({
      fastVision: z.string().min(1).max(200).optional(),
      smartVision: z.string().min(1).max(200).optional(),
      advisor: z.string().min(1).max(200).optional(),
      research: z.string().min(1).max(200).optional(),
      expertPanelAlt: z.string().min(1).max(200).optional(),
      embedding: z.string().min(1).max(200).optional(),
      rerank: z.string().min(1).max(200).optional(),
      visualEmbed: z.string().min(1).max(200).optional(),
      fusionModels: z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(6)
        .optional(),
      fusionJudge: z.string().min(1).max(200).optional(),
    })
    .partial()
    .optional(),
  timeouts: z
    .object({
      expertConsultMs: z.number().int().min(1000).max(60000).optional(),
      rerankerMs: z.number().int().min(1000).max(60000).optional(),
      geocodingMs: z.number().int().min(1000).max(30000).optional(),
      fusionMs: z.number().int().min(1000).max(120000).optional(),
    })
    .partial()
    .optional(),
  features: z
    .object({
      enableAdvisor: z.boolean().optional(),
      enableSubagent: z.boolean().optional(),
      enableFusionPotteryExpert: z.boolean().optional(),
      enableFusionTravelDocFallback: z.boolean().optional(),
    })
    .partial()
    .optional(),
  thresholds: z
    .object({
      potterySimilarityYes: z.number().min(0).max(1).optional(),
      potterySimilarityMaybe: z.number().min(0).max(1).optional(),
      potterySimilarityNo: z.number().min(0).max(1).optional(),
      visualEmbedCropTop: z.number().min(0).max(1).optional(),
      visualEmbedCropHeight: z.number().min(0).max(1).optional(),
      aiJpegQuality: z.number().int().min(1).max(100).optional(),
      potteryZoneAnalysisMaxTokens: z
        .number()
        .int()
        .min(50)
        .max(4000)
        .optional(),
      potteryBackstampMaxTokens: z.number().int().min(50).max(4000).optional(),
      travelDocExtractionMaxTokens: z
        .number()
        .int()
        .min(50)
        .max(4000)
        .optional(),
    })
    .partial()
    .optional(),
});

router.put("/admin/config", async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const userId = req.session.userId!;
  const patch = AdminConfigBody.parse(req.body);
  const current = await getElaineGlobalConfig();
  const nextTop = {
    chatModel: patch.chatModel ?? current.chatModel,
    subagentModel: patch.subagentModel ?? current.subagentModel,
    requestTimeoutMs: patch.requestTimeoutMs ?? current.requestTimeoutMs,
    maxResponseTokens: patch.maxResponseTokens ?? current.maxResponseTokens,
  };
  const nextModels = { ...current.models, ...patch.models };
  const nextTimeouts = { ...current.timeouts, ...patch.timeouts };
  const nextFeatures = { ...current.features, ...patch.features };
  const nextThresholds = { ...current.thresholds, ...patch.thresholds };
  await db
    .insert(elaineGlobalConfig)
    .values({
      id: 1,
      ...nextTop,
      extraModels: nextModels,
      timeouts: nextTimeouts,
      features: nextFeatures,
      thresholds: nextThresholds,
      updatedByUserId: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: elaineGlobalConfig.id,
      set: {
        ...nextTop,
        extraModels: nextModels,
        timeouts: nextTimeouts,
        features: nextFeatures,
        thresholds: nextThresholds,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });
  invalidateElaineGlobalConfigCache();
  const updated = await getElaineGlobalConfig();
  res.json(updated);
});

router.get("/admin/models", async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  try {
    const models = await listOpenRouterModels();
    res.json(models);
  } catch (err) {
    logger.error({ err }, "Failed to list OpenRouter models for admin UI");
    res.status(502).json({ error: "Failed to fetch model list" });
  }
});

const MemoryUpsertBody = z.object({
  content: z.string().min(1).max(2000),
  scope: z.enum(["household", "personal", "temporary"]).optional(),
  category: z
    .enum([
      "fact",
      "preference",
      "instruction",
      "person",
      "place",
      "collection",
    ])
    .optional(),
  sensitivity: z.enum(["low", "medium", "high"]).optional(),
  expiresInDays: z.number().int().positive().optional(),
});

function memoryRow(row: {
  id: number;
  content: string;
  type: string;
  scope: string;
  category: string;
  sensitivity: string;
  ownerUserId: number | null;
  expiresAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdByUserId: number | null;
}) {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    scope: row.scope,
    category: row.category,
    sensitivity: row.sensitivity,
    ownerUserId: row.ownerUserId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
  };
}

router.get("/memory", async (req, res) => {
  const userId = req.session.userId as number;
  const rows = await db
    .select({
      id: elaineMemory.id,
      content: elaineMemory.content,
      type: elaineMemory.type,
      scope: elaineMemory.scope,
      category: elaineMemory.category,
      sensitivity: elaineMemory.sensitivity,
      ownerUserId: elaineMemory.ownerUserId,
      expiresAt: elaineMemory.expiresAt,
      active: elaineMemory.active,
      createdAt: elaineMemory.createdAt,
      updatedAt: elaineMemory.updatedAt,
      deletedAt: elaineMemory.deletedAt,
      createdByUserId: elaineMemory.createdByUserId,
    })
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
        or(
          sql`${elaineMemory.scope} != 'personal'`,
          eq(elaineMemory.ownerUserId, userId),
        ),
      ),
    )
    .orderBy(desc(elaineMemory.createdAt));
  res.json(rows.map(memoryRow));
});

router.post("/memory", async (req, res) => {
  const userId = req.session.userId as number;
  const parsed = MemoryUpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const {
    content,
    scope = "household",
    category = "fact",
    sensitivity = "low",
    expiresInDays,
  } = parsed.data;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000)
    : scope === "temporary"
      ? new Date(Date.now() + 30 * 86400000)
      : null;
  const [inserted] = await db
    .insert(elaineMemory)
    .values({
      content,
      scope,
      category,
      sensitivity,
      ownerUserId: scope === "personal" ? userId : null,
      expiresAt: expiresAt ?? undefined,
      createdByUserId: userId,
    })
    .returning({
      id: elaineMemory.id,
      content: elaineMemory.content,
      type: elaineMemory.type,
      scope: elaineMemory.scope,
      category: elaineMemory.category,
      sensitivity: elaineMemory.sensitivity,
      ownerUserId: elaineMemory.ownerUserId,
      expiresAt: elaineMemory.expiresAt,
      active: elaineMemory.active,
      createdAt: elaineMemory.createdAt,
      updatedAt: elaineMemory.updatedAt,
      deletedAt: elaineMemory.deletedAt,
      createdByUserId: elaineMemory.createdByUserId,
    });
  res.status(201).json(memoryRow(inserted));
});

router.patch("/memory/:id", async (req, res) => {
  const userId = req.session.userId as number;
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({
      id: elaineMemory.id,
      scope: elaineMemory.scope,
      ownerUserId: elaineMemory.ownerUserId,
      active: elaineMemory.active,
    })
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.id, id),
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (existing.scope === "personal" && existing.ownerUserId !== userId) {
    res
      .status(403)
      .json({ error: "Cannot edit another user's personal memory" });
    return;
  }
  const parsed = MemoryUpsertBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { content, scope, category, sensitivity, expiresInDays } = parsed.data;
  const newScope =
    scope ?? (existing.scope as "household" | "personal" | "temporary");
  const updates: Record<string, unknown> = {};
  if (content !== undefined) updates["content"] = content;
  if (scope !== undefined) {
    updates["scope"] = scope;
    updates["ownerUserId"] = scope === "personal" ? userId : null;
  }
  if (category !== undefined) updates["category"] = category;
  if (sensitivity !== undefined) updates["sensitivity"] = sensitivity;
  if (expiresInDays !== undefined) {
    updates["expiresAt"] = new Date(Date.now() + expiresInDays * 86400000);
  } else if (scope !== undefined && newScope !== "temporary") {
    updates["expiresAt"] = null;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [updated] = await db
    .update(elaineMemory)
    .set(updates)
    .where(eq(elaineMemory.id, id))
    .returning({
      id: elaineMemory.id,
      content: elaineMemory.content,
      type: elaineMemory.type,
      scope: elaineMemory.scope,
      category: elaineMemory.category,
      sensitivity: elaineMemory.sensitivity,
      ownerUserId: elaineMemory.ownerUserId,
      expiresAt: elaineMemory.expiresAt,
      active: elaineMemory.active,
      createdAt: elaineMemory.createdAt,
      updatedAt: elaineMemory.updatedAt,
      deletedAt: elaineMemory.deletedAt,
      createdByUserId: elaineMemory.createdByUserId,
    });
  res.json(memoryRow(updated));
});

router.delete("/memory/:id", async (req, res) => {
  const userId = req.session.userId as number;
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({
      id: elaineMemory.id,
      scope: elaineMemory.scope,
      ownerUserId: elaineMemory.ownerUserId,
    })
    .from(elaineMemory)
    .where(
      and(
        eq(elaineMemory.id, id),
        eq(elaineMemory.active, true),
        isNull(elaineMemory.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (existing.scope === "personal" && existing.ownerUserId !== userId) {
    res
      .status(403)
      .json({ error: "Cannot delete another user's personal memory" });
    return;
  }
  await db
    .update(elaineMemory)
    .set({ active: false, deletedAt: new Date() })
    .where(eq(elaineMemory.id, id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// AgentPhone SMS/voice bridge — used by routes/agentphone.ts. Deliberately
// NOT the full assistant: no destructive actions (no delete_*, cancel_trip),
// no trip/wishlist creation, no email/itinerary-gen/calendar-connect tools,
// and no UI-oriented "on-screen state" context (SMS/voice have no screen).
// Runs in auto_run mode always — there is no confirmation UI over SMS/voice,
// so every allowed action executes immediately and the reply reports what
// happened. Restricted to a small allowlist of non-destructive household
// actions per task #105.
// ---------------------------------------------------------------------------

// Action types deliberately EXCLUDED from the restricted (SMS/voice/email)
// channels even though everything else gets full parity with in-app chat.
// Each of these relies on state that only exists in an interactive browser
// session and has no sane equivalent over text:
//  - send_test_email / send_test_sms / send_phone_verification_code /
//    verify_phone_code: tied to the *current* logged-in session's own
//    verification flow, not something a household member triggers remotely.
//  - update_card_layout / update_trip_card_collapse: pure on-screen layout
//    state for the web widget — meaningless without a screen.
//  - add_connected_calendar: requires picking a googleCalendarId from an
//    on-screen list rendered by an already-connected OAuth session; there is
//    no such list available over SMS/email (see
//    .agents/memory/travels-calendar-oauth-constraint.md). disconnect_calendar
//    has no such requirement and stays enabled.
const RESTRICTED_EXCLUDED_ACTION_TYPES = new Set<string>([
  "send_test_email",
  "send_test_sms",
  "send_phone_verification_code",
  "verify_phone_code",
  "update_card_layout",
  "update_trip_card_collapse",
  "add_connected_calendar",
  // Admin-only action — requires the owner to be looking at the Control Panel
  // with config keys visible on screen; not meaningful over SMS/voice/email.
  "update_app_config",
]);

// Full parity with the in-app chat widget's action tools, minus the
// session/screen-bound exclusions above. This intentionally includes
// destructive actions (deletes, cancels, sends) per an explicit household
// decision — see threat_model.md's AgentPhone/Resend trust-boundary
// sections for the reasoning and the identity-proof tradeoff this accepts.
export const AGENTPHONE_ACTION_TYPES = new Set<string>(
  ACTION_TOOLS.filter(
    (t) =>
      t.type === "function" &&
      !RESTRICTED_EXCLUDED_ACTION_TYPES.has(t.function.name),
  ).map((t) => (t as { function: { name: string } }).function.name),
);

const AGENTPHONE_ACTION_TOOLS = ACTION_TOOLS.filter(
  (t) => t.type === "function" && AGENTPHONE_ACTION_TYPES.has(t.function.name),
);

// Read/utility "soft" tools also given to the restricted channels — this is
// what lets Elaine answer factual questions ("when's my next trip?") over
// email/SMS instead of refusing, matching the in-app chat's capability.
// Deliberately excludes: SHOW_* visual card tools (no-op without a screen),
// SET_MODE_TOOL_NAME (restricted channels are always auto-run, no
// confirmation modes to switch), and SUGGEST_CLOTHING_LAYERS (needs a
// multi-step subagent flow not worth the added round-trip cost here).
const RESTRICTED_SOFT_TOOL_NAMES = new Set<string>([
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
  SHOW_DATA_CARD_TOOL_NAME,
  LOOKUP_BARCODE_TOOL_NAME,
]);

const RESTRICTED_SOFT_TOOLS = [...SOFT_TOOLS, ...SOFT_TOOLS_EXTRA].filter(
  (t) =>
    t.type === "function" && RESTRICTED_SOFT_TOOL_NAMES.has(t.function.name),
);

// The in-app "suggest_navigation" tool renders a clickable in-app button —
// there is no such UI over SMS/email/voice. Restricted channels get their
// own navigate tool that always requires a cross-app-prefixed path (there is
// no "current app" context outside a browser tab) and resolves it to an
// absolute, clickable URL included directly in the reply text instead.
const RESTRICTED_NAVIGATE_TOOL_NAME = "share_app_link";

const RestrictedNavigatePayload = z.object({
  path: z
    .string()
    .max(200)
    .refine(
      (p) => CROSS_APP_NAVIGATE_RE.test(p),
      "must be an app-prefixed path like /pottery/, /travels/trips/42, /quilting/fabrics",
    ),
  reason: z.string().min(1).max(300),
});

const RESTRICTED_NAVIGATE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: RESTRICTED_NAVIGATE_TOOL_NAME,
    description:
      'Give the user a direct link to a screen in the app — use this whenever you would otherwise tell them to "go to" or "check" a page (e.g. connecting a calendar, viewing photos, browsing the full collection). You can never navigate them yourself over email/SMS/voice, only hand them a URL. Always use an app-prefixed path: "/pottery/", "/pottery/piece/42", "/quilting/fabrics", "/quilting/fabrics/add", "/travels/", "/travels/trips/42", "/ornaments/", "/elaine/". Add query params like ?search=term where useful.',
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'App-prefixed path, e.g. "/travels/trips/42" or "/pottery/?search=polish".',
        },
        reason: {
          type: "string",
          description:
            "Short user-friendly description of what's at that link, e.g. 'your pottery collection filtered for polish pottery'",
        },
      },
      required: ["path", "reason"],
    },
  },
};

function getAppBaseUrl(): string {
  const host = (process.env.REPLIT_DOMAINS ?? "app.batchelor.app")
    .split(",")[0]
    .trim();
  return `https://${host}`;
}

// Pottery/quilting/travels/ornaments are merged into the single "modules"
// artifact, which is mounted at "/modules" — every app-prefixed path the
// model emits (e.g. "/pottery/piece/42") must gain that segment when turned
// into a real clickable URL for an email/SMS/voice reply. Elaine itself
// remains a standalone artifact at "/elaine" and is left untouched.
const MODULE_LINK_PREFIXES = [
  "/pottery",
  "/quilting",
  "/travels",
  "/ornaments",
];
function resolveModuleLinkPath(path: string): string {
  const matchesModule = MODULE_LINK_PREFIXES.some(
    (prefix) =>
      path === prefix ||
      path.startsWith(prefix + "/") ||
      path.startsWith(prefix + "?"),
  );
  return matchesModule ? `/modules${path}` : path;
}

const RESTRICTED_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ...AGENTPHONE_ACTION_TOOLS,
  ...RESTRICTED_SOFT_TOOLS,
  RESTRICTED_NAVIGATE_TOOL,
];

// Executes one of the read/utility "soft" tools for a restricted channel
// turn and returns the text to feed back to the model. Mirrors the logic in
// the main streaming chat handler above, minus any sendEvent/widget calls
// (there is no live UI on this channel — only the final text result matters).
async function executeRestrictedSoftTool(
  name: string,
  args: string,
): Promise<string> {
  try {
    if (name === SEARCH_HOUSEHOLD_TOOL_NAME) {
      const parsed = SearchHouseholdToolPayload.safeParse(
        JSON.parse(args || "{}"),
      );
      if (!parsed.success) return "Invalid search query.";
      const { query, include } = parsed.data;
      const domains = include ?? [
        "trips",
        "pottery",
        "ornaments",
        "fabrics",
        "patterns",
        "quilts",
      ];
      const pat = `%${query}%`;
      const parts: string[] = [];

      if (domains.includes("trips")) {
        const rows = await db
          .select({
            id: travelsTrips.id,
            title: travelsTrips.title,
            destination: travelsTrips.destination,
            status: travelsTrips.status,
            startDate: travelsTrips.startDate,
            endDate: travelsTrips.endDate,
          })
          .from(travelsTrips)
          .where(
            or(
              ilike(travelsTrips.title, pat),
              ilike(travelsTrips.destination, pat),
            ),
          )
          .orderBy(desc(travelsTrips.startDate))
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map((t) => {
            const dates =
              t.startDate && t.endDate
                ? ` ${t.startDate} to ${t.endDate}`
                : t.startDate
                  ? ` starting ${t.startDate}`
                  : "";
            return `- "${t.title}" (${t.destination ?? "no destination"}), status: ${t.status}${dates}, tripId: ${t.id}`;
          });
          parts.push(
            `Found ${rows.length} trip(s) matching "${query}":\n${lines.join("\n")}\nCall show_trip_card with the trip data and tripId to show a visual card.`,
          );
        } else {
          parts.push(`No trips found matching "${query}".`);
        }
      }

      if (domains.includes("pottery")) {
        const rows = await db
          .select({
            id: potteryItems.id,
            name: potteryItems.name,
            maker: potteryItems.maker,
            style: potteryItems.style,
          })
          .from(potteryItems)
          .where(
            or(ilike(potteryItems.name, pat), ilike(potteryItems.maker, pat)),
          )
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map(
            (r) =>
              `- "${r.name}"${r.maker ? ` by ${r.maker}` : ""}${r.style ? `, ${r.style}` : ""}, itemId: ${r.id}`,
          );
          parts.push(
            `Found ${rows.length} pottery piece(s) matching "${query}":\n${lines.join("\n")}\nCall show_pottery_item with the itemId to show a visual card.`,
          );
        } else {
          parts.push(`No pottery pieces found matching "${query}".`);
        }
      }

      if (domains.includes("ornaments")) {
        const rows = await db
          .select({
            id: ornamentsItems.id,
            name: ornamentsItems.name,
            seriesOrCollection: ornamentsItems.seriesOrCollection,
            year: ornamentsItems.year,
          })
          .from(ornamentsItems)
          .where(
            or(
              ilike(ornamentsItems.name, pat),
              ilike(ornamentsItems.seriesOrCollection, pat),
            ),
          )
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map(
            (r) =>
              `- "${r.name}"${r.seriesOrCollection ? `, ${r.seriesOrCollection}` : ""}${r.year ? ` (${r.year})` : ""}, itemId: ${r.id}`,
          );
          parts.push(
            `Found ${rows.length} ornament(s) matching "${query}":\n${lines.join("\n")}`,
          );
        } else {
          parts.push(`No ornaments found matching "${query}".`);
        }
      }

      if (domains.includes("fabrics")) {
        const rows = await db
          .select({
            id: fabrics.id,
            name: fabrics.name,
            designer: fabrics.designer,
            manufacturer: fabrics.manufacturer,
          })
          .from(fabrics)
          .where(
            or(
              ilike(fabrics.name, pat),
              ilike(fabrics.designer, pat),
              ilike(fabrics.manufacturer, pat),
            ),
          )
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map(
            (r) =>
              `- "${r.name}"${r.designer ? ` by ${r.designer}` : ""}${r.manufacturer ? `, ${r.manufacturer}` : ""}, fabricId: ${r.id}`,
          );
          parts.push(
            `Found ${rows.length} fabric(s) matching "${query}":\n${lines.join("\n")}\nCall show_fabric_swatch with the fabricId to show a visual card.`,
          );
        } else {
          parts.push(`No fabrics found matching "${query}".`);
        }
      }

      if (domains.includes("patterns")) {
        const rows = await db
          .select({
            id: quiltPatterns.id,
            name: quiltPatterns.name,
            designer: quiltPatterns.designer,
          })
          .from(quiltPatterns)
          .where(
            or(
              ilike(quiltPatterns.name, pat),
              ilike(quiltPatterns.designer, pat),
            ),
          )
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map(
            (r) =>
              `- "${r.name}"${r.designer ? ` by ${r.designer}` : ""}, patternId: ${r.id}`,
          );
          parts.push(
            `Found ${rows.length} quilt pattern(s) matching "${query}":\n${lines.join("\n")}`,
          );
        } else {
          parts.push(`No quilt patterns found matching "${query}".`);
        }
      }

      if (domains.includes("quilts")) {
        const rows = await db
          .select({
            id: finishedQuilts.id,
            name: finishedQuilts.name,
            dateCompleted: finishedQuilts.dateCompleted,
          })
          .from(finishedQuilts)
          .where(ilike(finishedQuilts.name, pat))
          .limit(5);
        if (rows.length > 0) {
          const lines = rows.map(
            (r) =>
              `- "${r.name}"${r.dateCompleted ? ` (completed ${r.dateCompleted})` : ""}, quiltId: ${r.id}`,
          );
          parts.push(
            `Found ${rows.length} finished quilt(s) matching "${query}":\n${lines.join("\n")}`,
          );
        } else {
          parts.push(`No finished quilts found matching "${query}".`);
        }
      }

      return parts.length > 0
        ? parts.join("\n\n")
        : `No results found for "${query}".`;
    }

    if (name === QUERY_HOUSEHOLD_TOOL_NAME) {
      const parsed = z
        .object({ include: z.array(z.string()).optional() })
        .safeParse(JSON.parse(args || "{}"));
      const include = parsed.success
        ? (parsed.data.include ?? [
            "pottery",
            "quilting",
            "ornaments",
            "travels",
          ])
        : ["pottery", "quilting", "ornaments", "travels"];
      const parts: string[] = [];

      if (include.includes("pottery")) {
        const [row] = await db.select({ total: count() }).from(potteryItems);
        const recent = await db
          .select({ name: potteryItems.name })
          .from(potteryItems)
          .orderBy(desc(potteryItems.createdAt))
          .limit(3);
        parts.push(
          `Pottery collection: ${row?.total ?? 0} pieces total.` +
            (recent.length > 0
              ? ` Recently added: ${recent.map((r) => r.name).join(", ")}.`
              : ""),
        );
      }
      if (include.includes("quilting")) {
        const [fabRow] = await db.select({ total: count() }).from(fabrics);
        const [patRow] = await db
          .select({ total: count() })
          .from(quiltPatterns);
        const [quiltRow] = await db
          .select({ total: count() })
          .from(finishedQuilts);
        parts.push(
          `Quilting stash: ${fabRow?.total ?? 0} fabrics, ${patRow?.total ?? 0} patterns, ${quiltRow?.total ?? 0} finished quilts.`,
        );
      }
      if (include.includes("ornaments")) {
        const [ornRow] = await db
          .select({ total: count() })
          .from(ornamentsItems);
        const ornRecent = await db
          .select({ name: ornamentsItems.name })
          .from(ornamentsItems)
          .orderBy(desc(ornamentsItems.createdAt))
          .limit(3);
        parts.push(
          `Ornaments collection: ${ornRow?.total ?? 0} ornaments total.` +
            (ornRecent.length > 0
              ? ` Recently added: ${ornRecent.map((r) => r.name).join(", ")}.`
              : ""),
        );
      }
      if (include.includes("travels")) {
        const [wishRow] = await db
          .select({ total: count() })
          .from(travelsWishlist);
        const activeTrips = await db
          .select({
            id: travelsTrips.id,
            title: travelsTrips.title,
            destination: travelsTrips.destination,
            status: travelsTrips.status,
            startDate: travelsTrips.startDate,
            endDate: travelsTrips.endDate,
          })
          .from(travelsTrips)
          .where(
            inArray(travelsTrips.status, [
              "planning",
              "booked",
              "in_progress",
            ] as string[]),
          )
          .orderBy(travelsTrips.startDate);
        const formatRange = (start: string | null, end: string | null) => {
          if (!start && !end) return "dates not set yet";
          if (start && end) return `${start} to ${end}`;
          return start ? `starting ${start}` : `ending ${end}`;
        };
        parts.push(
          `Travels: ${activeTrips.length} active trip(s), ${wishRow?.total ?? 0} on the wishlist.` +
            (activeTrips.length > 0
              ? " Active trips:\n" +
                activeTrips
                  .map(
                    (t) =>
                      `- ${t.title} (${t.destination}), status: ${t.status}, dates: ${formatRange(t.startDate, t.endDate)}, tripId: ${t.id}`,
                  )
                  .join("\n")
              : ""),
        );
      }
      return parts.length > 0 ? parts.join("\n") : "No household data found.";
    }

    if (name === WEB_SEARCH_TOOL_NAME) {
      const parsed = WebSearchToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid search query — ask the user to rephrase.";
      const { answer, citations } = await webSearch(parsed.data.query);
      return answer
        ? citations.length > 0
          ? `${answer}\n\nSources:\n${citations.map((url, i) => `[${i + 1}] ${url}`).join("\n")}`
          : answer
        : "No results found for this search.";
    }

    if (name === EBAY_SEARCH_TOOL_NAME) {
      const parsed = EbaySearchToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid eBay search — ask the user to rephrase the query.";
      const { query, category } = parsed.data;
      const fullQuery =
        category === "ornaments" || category === "pottery"
          ? buildEbayQuery(query, {})
          : query;
      const ebayResult = await lookupEbayMarketValue(fullQuery, {
        withAspects: category === "ornaments",
      });
      if (!ebayResult)
        return `No sold listings found on eBay for "${query}". The item may be rare or the query needs to be more specific.`;
      const lines = [
        `eBay sold listings for "${query}" (${ebayResult.listingCount} found):`,
        `Price range: $${ebayResult.priceMinUsd.toFixed(2)} – $${ebayResult.priceMaxUsd.toFixed(2)} (median $${ebayResult.priceMedianUsd.toFixed(2)})`,
      ];
      if (
        ebayResult.itemSpecifics &&
        Object.keys(ebayResult.itemSpecifics).length > 0
      ) {
        lines.push(
          "Item attributes: " +
            Object.entries(ebayResult.itemSpecifics)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", "),
        );
      }
      lines.push("Recent sold listings:");
      for (const l of ebayResult.listings.slice(0, 5)) {
        lines.push(
          `  • ${l.title} — $${l.soldPrice.toFixed(2)}${l.condition ? ` (${l.condition})` : ""}${l.soldDate ? `, sold ${l.soldDate.slice(0, 10)}` : ""}`,
        );
      }
      return lines.join("\n");
    }

    if (name === SEARCH_HALLMARK_TOOL_NAME) {
      const parsed = SearchHallmarkToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid Hallmark search — provide a name or hallmarkSku.";
      // DB-first: skip Apify if the ornament is already in the local catalog
      let result = await lookupHallmarkFromDb(parsed.data).catch(() => null);
      if (!result && env.apifyApiToken) {
        result = await searchHallmark(parsed.data).catch((err: unknown) => {
          logger.warn(
            { err },
            "restricted-elaine hallmark search failed (non-fatal)",
          );
          return null;
        });
      }
      if (!result)
        return `No Hallmark product found for "${parsed.data.hallmarkSku ?? parsed.data.name ?? "(unknown)"}". Try a different name or SKU.`;
      const lines = [`Hallmark product: ${result.name ?? "Unknown"}`];
      if (result.hallmarkSku) lines.push(`SKU: ${result.hallmarkSku}`);
      if (result.year) lines.push(`Year: ${result.year}`);
      if (result.seriesName) lines.push(`Series: ${result.seriesName}`);
      if (result.artist) lines.push(`Artist: ${result.artist}`);
      if (result.originalRetailPrice != null)
        lines.push(
          `Original retail: $${result.originalRetailPrice.toFixed(2)}`,
        );
      if (result.collectorPriceUsd != null)
        lines.push(`Collector price: $${result.collectorPriceUsd.toFixed(2)}`);
      if (result.description) lines.push(`Description: ${result.description}`);
      if (result.hallmarkProductUrl)
        lines.push(`URL: ${result.hallmarkProductUrl}`);
      return lines.join("\n");
    }

    if (name === SEARCH_FLIGHTS_TOOL_NAME) {
      const parsed = SearchFlightsToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid flight search — provide originIata and destination.";
      if (!env.apifyApiToken)
        return "Flight search is not configured on this server.";
      const result = await lookupFlightPrices(
        parsed.data.originIata,
        parsed.data.destination,
        env.apifyApiToken,
        {
          departDate: parsed.data.departDate,
          returnDate: parsed.data.returnDate,
        },
      ).catch((err: unknown) => {
        logger.warn(
          { err },
          "restricted-elaine flight search failed (non-fatal)",
        );
        return null;
      });
      if (!result || result.options.length === 0)
        return `No flights found from ${parsed.data.originIata} to ${parsed.data.destination}. Try a different origin airport code or destination.`;
      const dateLabel = parsed.data.departDate
        ? `${parsed.data.departDate}${parsed.data.returnDate ? ` – ${parsed.data.returnDate}` : ""}`
        : "~30 days from now, 7-night stay";
      const lines = [
        `Flights from ${result.originIata} to ${result.destinationQuery}:`,
        `Cheapest: $${result.priceMinUsd.toFixed(0)} ${result.currency}`,
        `(Dates: ${dateLabel})`,
        "",
        "Options:",
      ];
      for (const opt of result.options.slice(0, 5)) {
        const parts = [
          `  • $${opt.price.toFixed(0)} ${opt.currency ?? result.currency}`,
        ];
        if (opt.airline) parts.push(opt.airline);
        if (opt.stops != null)
          parts.push(
            opt.stops === 0
              ? "nonstop"
              : `${opt.stops} stop${opt.stops > 1 ? "s" : ""}`,
          );
        if (opt.durationMinutes)
          parts.push(
            `${Math.floor(opt.durationMinutes / 60)}h ${opt.durationMinutes % 60}m`,
          );
        if (opt.deepLink) parts.push(`— ${opt.deepLink}`);
        lines.push(parts.join(", "));
      }
      return lines.join("\n");
    }

    if (name === FETCH_PAGE_TOOL_NAME) {
      const parsed = FetchPageToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid URL — ask the user to provide a valid https:// link.";
      return await fetchPage(parsed.data.url);
    }

    if (name === CONSULT_EXPERTS_TOOL_NAME) {
      const parsed = ConsultExpertsToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid question — ask the user to rephrase.";
      const { answer } = await consultExperts(
        parsed.data.question,
        parsed.data.context,
      );
      return answer || "No panel opinion could be gathered.";
    }

    if (name === GET_EXCHANGE_RATE_TOOL_NAME) {
      const parsed = GetExchangeRateToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Invalid currency — ask the user to clarify.";
      const { from, to } = parsed.data;
      const url = `https://api.frankfurter.app/latest?from=${from}&to=${to.join(",")}`;
      const resp = await withRetry(
        () => fetch(url, { signal: AbortSignal.timeout(8_000) }),
        { label: "frankfurter-exchange-rate" },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        date: string;
        rates: Record<string, number>;
      };
      const rates = to.map((code) => ({ code, rate: json.rates[code] ?? 0 }));
      return (
        `Exchange rates from ${from} (as of ${json.date}):\n` +
        rates
          .map((r) => `1 ${from} = ${r.rate.toFixed(4)} ${r.code}`)
          .join("\n")
      );
    }

    if (name === GET_WEATHER_TOOL_NAME) {
      const parsed = GetWeatherToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Invalid location — ask the user to clarify.";
      const locationName = parsed.data.locationName;
      let lat: number | null = parsed.data.lat ?? null;
      let lng: number | null = parsed.data.lng ?? null;
      if (lat == null || lng == null) {
        const geoPlaces = await searchPlaces(locationName);
        if (
          geoPlaces.length > 0 &&
          geoPlaces[0].lat != null &&
          geoPlaces[0].lng != null
        ) {
          lat = geoPlaces[0].lat;
          lng = geoPlaces[0].lng;
        }
      }
      if (lat == null || lng == null) {
        return `Couldn't find coordinates for "${locationName}" — ask the user for a more specific place name.`;
      }
      const forecast = await getWeatherForecast(lat, lng);
      if (forecast.length === 0)
        return `No forecast data available for ${locationName}.`;
      return (
        `Forecast for ${locationName}:\n` +
        forecast
          .map(
            (d) =>
              `${d.date}: ${d.conditionDescription}, ${d.minTempC ?? "?"}–${d.maxTempC ?? "?"}°C` +
              (d.precipitationChancePercent != null
                ? `, ${d.precipitationChancePercent}% chance of rain`
                : ""),
          )
          .join("\n")
      );
    }

    if (name === FIND_NEARBY_PLACES_TOOL_NAME) {
      const parsed = FindNearbyPlacesToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid place search — ask the user to rephrase.";
      const places = await searchPlaces(
        parsed.data.query,
        parsed.data.lat,
        parsed.data.lng,
      );
      if (places.length === 0) return "No places found for that search.";
      return places
        .map(
          (p) =>
            `${p.name} — ${p.address}${p.rating != null ? ` (${p.rating}★, ${p.userRatingCount ?? 0} ratings)` : ""}`,
        )
        .join("\n");
    }

    if (name === GET_ROUTE_INFO_TOOL_NAME) {
      const parsed = GetRouteInfoToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid route request — ask the user to clarify origin/destination.";
      const route = await computeRoute(
        parsed.data.origin,
        parsed.data.destination,
        [],
        parsed.data.mode as TravelMode,
        false,
      );
      return route
        ? `${parsed.data.origin.label} to ${parsed.data.destination.label} by ${parsed.data.mode.toLowerCase()}: ${(route.distanceMeters / 1000).toFixed(1)} km, about ${Math.round(route.durationSeconds / 60)} minutes.`
        : `No route found between ${parsed.data.origin.label} and ${parsed.data.destination.label}.`;
    }

    if (name === GET_AIR_QUALITY_TOOL_NAME) {
      const parsed = GetAirQualityToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Invalid location — ask the user to clarify.";
      const airQuality = await getAirQuality(parsed.data.lat, parsed.data.lng);
      return airQuality
        ? `Air quality in ${parsed.data.locationName}: Universal AQI ${airQuality.aqi} (${airQuality.category}), dominant pollutant ${airQuality.dominantPollutant}.`
        : `No air quality data available for ${parsed.data.locationName}.`;
    }

    if (name === GET_POLLEN_FORECAST_TOOL_NAME) {
      const parsed = GetPollenForecastToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Invalid location — ask the user to clarify.";
      const pollen = await getPollenForecast(parsed.data.lat, parsed.data.lng);
      if (!pollen)
        return `No pollen data available for ${parsed.data.locationName}.`;
      return (
        `Pollen forecast for ${parsed.data.locationName} (${pollen.date}): overall ${pollen.overallCategory}. ` +
        pollen.types.map((t) => `${t.displayName}: ${t.category}`).join(", ")
      );
    }

    if (name === CALCULATE_YARDAGE_TOOL_NAME) {
      const parsed = CalculateYardageToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success)
        return "Invalid quilt dimensions — ask the user to clarify.";
      const {
        quiltWidthInches: w,
        quiltHeightInches: h,
        fabricWidthInches: fabricWidth,
        bindingStripWidthInches: bindingStripWidth,
      } = parsed.data;
      const backingWidthNeeded = w + 8;
      const backingHeightNeeded = h + 8;
      const backingPanels = Math.max(
        1,
        Math.ceil(backingWidthNeeded / fabricWidth),
      );
      const backingLengthInches = backingHeightNeeded * backingPanels;
      const backingYards = Math.ceil((backingLengthInches / 36) * 8) / 8;
      const bindingPerimeterInches = 2 * (w + h) + 15;
      const bindingStrips = Math.max(
        1,
        Math.ceil(bindingPerimeterInches / fabricWidth),
      );
      const bindingYards =
        Math.ceil(((bindingStrips * bindingStripWidth) / 36) * 8) / 8;
      return (
        `For a ${w}x${h}" finished quilt:\n` +
        `Backing: ~${backingYards} yards` +
        (backingPanels > 1
          ? ` (pieced from ${backingPanels} panels of ${fabricWidth}" fabric)`
          : "") +
        `\nBinding: ~${bindingYards} yards (${bindingStrips} strip${bindingStrips === 1 ? "" : "s"} of ${bindingStripWidth}" fabric)`
      );
    }

    if (name === SEARCH_TRIP_DOCUMENTS_TOOL_NAME) {
      const parsed = SearchTripDocumentsToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Invalid search — ask the user to rephrase.";
      const { query, tripId } = parsed.data;
      let semanticDocIds: number[] = [];
      try {
        const qEmbedding = await embedText(query);
        const embStr = `[${qEmbedding.join(",")}]`;
        const chunkRows = await db.execute(sql`
          SELECT dc.trip_document_id, MIN(dc.embedding <=> ${embStr}::vector) AS dist
          FROM travels_doc_chunks dc
          JOIN travels_trip_documents d ON d.id = dc.trip_document_id
          WHERE ${tripId != null ? sql`d.trip_id = ${tripId}` : sql`TRUE`}
          GROUP BY dc.trip_document_id
          ORDER BY dist ASC
          LIMIT 8
        `);
        semanticDocIds = (chunkRows.rows as { trip_document_id: number }[]).map(
          (r) => r.trip_document_id,
        );
      } catch {
        // fallback to keyword below
      }
      const docFilter =
        semanticDocIds.length > 0
          ? and(
              tripId != null
                ? eq(travelsTripDocuments.tripId, tripId)
                : undefined,
              inArray(travelsTripDocuments.id, semanticDocIds),
            )
          : tripId != null
            ? eq(travelsTripDocuments.tripId, tripId)
            : undefined;
      let rows = await db
        .select({
          id: travelsTripDocuments.id,
          tripId: travelsTripDocuments.tripId,
          title: travelsTripDocuments.title,
          documentType: travelsTripDocuments.documentType,
          extractedData: travelsTripDocuments.extractedData,
          rawText: travelsTripDocuments.rawText,
        })
        .from(travelsTripDocuments)
        .where(docFilter)
        .limit(semanticDocIds.length > 0 ? 8 : 50);
      if (semanticDocIds.length === 0) {
        const q = query.toLowerCase();
        const scored = rows
          .map((row) => {
            const haystack = [
              row.title ?? "",
              row.documentType ?? "",
              JSON.stringify(row.extractedData ?? ""),
            ]
              .join(" ")
              .toLowerCase();
            const words = q.split(/\s+/).filter(Boolean);
            const hits = words.filter((w) => haystack.includes(w)).length;
            return { row, hits };
          })
          .filter((s) => s.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 5);
        rows = scored.map((s) => s.row);
      } else {
        const idxMap = new Map(semanticDocIds.map((id, i) => [id, i]));
        rows.sort(
          (a, b) => (idxMap.get(a.id) ?? 99) - (idxMap.get(b.id) ?? 99),
        );
        rows = rows.slice(0, 5);
      }
      if (rows.length === 0)
        return `No uploaded trip documents match "${query}".`;
      return rows
        .map((row) => {
          const parts = [
            `Document: ${row.title ?? row.documentType ?? "untitled"} (trip #${row.tripId})`,
          ];
          if (row.documentType)
            parts.push(`Type: ${row.documentType.replace(/_/g, " ")}`);
          if (row.extractedData && typeof row.extractedData === "object") {
            const fields = Object.entries(
              row.extractedData as Record<string, unknown>,
            )
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => `  ${k}: ${String(v)}`)
              .join("\n");
            if (fields) parts.push("Extracted fields:\n" + fields);
          }
          return parts.join("\n");
        })
        .join("\n\n---\n\n");
    }

    if (name === REMEMBER_TOOL_NAME) {
      const parsed = RememberToolPayload.safeParse(JSON.parse(args));
      if (!parsed.success) return "Couldn't save that note.";
      return "noted"; // no-op result text; the insert below is the real effect
    }

    return "Unsupported tool.";
  } catch (err) {
    logger.error(
      { err, name },
      "restricted-channel soft tool execution failed",
    );
    return "That lookup failed on our end — tell the user to try again or use the app.";
  }
}

export interface AgentphoneChatMessage {
  role: "user" | "assistant";
  content: string;
}

const AGENTPHONE_CHANNEL_ADDENDUM =
  "CHANNEL: You are replying over SMS or a phone call. Keep replies short — one to three sentences, plain text only, no markdown, no emojis, no bullet points, since this may be read aloud or sent as a text message. Use share_app_link to give the user a direct URL whenever a request needs an actual screen (e.g. connecting a calendar, uploading a photo). Actions run immediately — always briefly confirm what you did (or that it failed).";

// Builds a compact text snapshot of trips/reminders/packing lists standing
// in for the on-screen state the web widget's tools normally rely on to
// avoid guessed ids. Household-shared by design (see threat_model.md) — not
// filtered to the requesting phone number's userId.
async function buildAgentphoneContext(): Promise<string> {
  const trips = await db
    .select({
      id: travelsTrips.id,
      title: travelsTrips.title,
      destination: travelsTrips.destination,
      status: travelsTrips.status,
      startDate: travelsTrips.startDate,
      endDate: travelsTrips.endDate,
    })
    .from(travelsTrips)
    .orderBy(desc(travelsTrips.id))
    .limit(30);

  const packingRows = await db
    .select({
      tripId: travelsPackingLists.tripId,
      text: travelsPackingItems.text,
      packed: travelsPackingItems.packed,
    })
    .from(travelsPackingItems)
    .innerJoin(
      travelsPackingLists,
      eq(travelsPackingItems.listId, travelsPackingLists.id),
    )
    .where(
      inArray(
        travelsPackingLists.tripId,
        trips.map((t) => t.id),
      ),
    );
  const packingByTrip = new Map<
    number,
    Array<{ text: string; packed: boolean }>
  >();
  for (const row of packingRows) {
    const list = packingByTrip.get(row.tripId) ?? [];
    list.push({ text: row.text, packed: row.packed });
    packingByTrip.set(row.tripId, list);
  }

  const reminders = await db
    .select({
      id: travelsReminders.id,
      tripId: travelsReminders.tripId,
      title: travelsReminders.title,
      dueDate: travelsReminders.dueDate,
      syncToCalendar: travelsReminders.syncToCalendar,
    })
    .from(travelsReminders)
    .where(eq(travelsReminders.done, false))
    .orderBy(desc(travelsReminders.id))
    .limit(50);

  const tripLines = trips.map((t) => {
    const packing = packingByTrip.get(t.id) ?? [];
    const packingText =
      packing.length > 0
        ? ` | packing: ${packing.map((p) => `${p.text}${p.packed ? " (packed)" : ""}`).join(", ")}`
        : "";
    const dates =
      t.startDate && t.endDate
        ? `${t.startDate} to ${t.endDate}`
        : t.startDate
          ? `starting ${t.startDate}`
          : t.endDate
            ? `ending ${t.endDate}`
            : "dates not set yet";
    return `tripId: ${t.id} — "${t.title || t.destination}" (${t.destination}), status: ${t.status}, dates: ${dates}${packingText}`;
  });

  const reminderLines = reminders.map(
    (r) =>
      `reminderId: ${r.id} (tripId: ${r.tripId}) — "${r.title}"${
        r.dueDate ? `, due ${r.dueDate}` : ""
      }${r.syncToCalendar ? "" : ", not synced to calendar"}`,
  );

  return [
    trips.length > 0 ? `Trips:\n${tripLines.join("\n")}` : "No trips yet.",
    reminders.length > 0
      ? `Open reminders:\n${reminderLines.join("\n")}`
      : "No open reminders.",
  ].join("\n\n");
}

// Shared restricted-turn engine used by both the AgentPhone (SMS/voice) and
// Resend (email) bridges. Same tool set, same auto-run semantics, same
// household-lookup/action-execution glue — only the system prompt, token
// budget, and reply-channel label differ per caller.
async function runRestrictedElaineTurn(params: {
  userId: number;
  inputText: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  channelLabel: string;
  channelAddendum?: string;
  formattingNote?: string;
  onWidget?: (w: Record<string, unknown>) => void;
}): Promise<{
  replyText: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}> {
  const {
    userId,
    inputText,
    history,
    maxTokens,
    channelLabel,
    channelAddendum,
    formattingNote,
    onWidget,
  } = params;
  // Group all model calls in this restricted turn under one Sentry AI
  // Conversation keyed by channel + user so threads stay stable over time.
  Sentry.setConversationId(`${channelLabel}-user-${userId}`);
  const config = await getElaineGlobalConfig();
  const [{ userName, memoryBlock, memorySummary }, contextBlock] =
    await Promise.all([buildUserContext(userId), buildAgentphoneContext()]);

  const systemPrompt = buildElaineCoreSystemPrompt({
    userName,
    channelLabel,
    contextBlockLabel: `household data snapshot (replying over ${channelLabel} — no screen state available)`,
    contextBlock,
    memoryBlock,
    memorySummary,
    actionConfirmationMode: "auto_run",
    isTravelsApp: false,
    formattingNote,
    channelAddendum,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...history.slice(-10).map(
      (m) =>
        ({
          role: m.role,
          content: m.content,
        }) as OpenAI.Chat.Completions.ChatCompletionMessageParam,
    ),
    { role: "user", content: inputText },
  ];

  let replyText = "";
  const MAX_ROUNDS = 3;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const completion = await callModel(config.chatModel, (client, model) =>
      client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages,
        tools: RESTRICTED_TOOLS,
      }),
    );
    const message = completion.choices[0]?.message;
    if (!message) break;
    replyText = (message.content ?? "").trim();
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) break;

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let resultText = `That action isn't available over ${channelLabel}.`;

      if (name === RESTRICTED_NAVIGATE_TOOL_NAME) {
        const parsed = RestrictedNavigatePayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        resultText = parsed.success
          ? `Link (share this exactly as-is in your reply): ${getAppBaseUrl()}${resolveModuleLinkPath(parsed.data.path)}`
          : "Invalid link path — describe it in words instead.";
      } else if (name === REMEMBER_TOOL_NAME) {
        const parsed = RememberToolPayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        if (!parsed.success) {
          resultText = "Couldn't save that note.";
        } else {
          try {
            const rScope = parsed.data.scope ?? "household";
            const rExpiresAt = parsed.data.expires_in_days
              ? new Date(Date.now() + parsed.data.expires_in_days * 86400000)
              : rScope === "temporary"
                ? new Date(Date.now() + 30 * 86400000)
                : undefined;
            await db.insert(elaineMemory).values({
              content: parsed.data.content,
              scope: rScope,
              category: parsed.data.category ?? "fact",
              sensitivity: parsed.data.sensitivity ?? "low",
              ownerUserId: rScope === "personal" ? userId : null,
              expiresAt: rExpiresAt,
              createdByUserId: userId,
            });
            resultText = "Noted and saved for later.";
          } catch (err) {
            logger.error({ err }, "restricted-channel remember tool failed");
            resultText = "Couldn't save that note on our end.";
          }
        }
      } else if (name === SHOW_TRIP_CARD_TOOL_NAME) {
        const parsed = ShowTripCardToolPayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        if (!parsed.success) {
          resultText = "Invalid trip data.";
        } else {
          let resolvedStartDate = parsed.data.startDate;
          if (!resolvedStartDate && parsed.data.tripId) {
            const [row] = await db
              .select({ startDate: travelsTrips.startDate })
              .from(travelsTrips)
              .where(eq(travelsTrips.id, parsed.data.tripId))
              .limit(1);
            resolvedStartDate = row?.startDate ?? undefined;
          }
          let serverCountdownDays: number | undefined = undefined;
          if (resolvedStartDate) {
            const tripStart = new Date(resolvedStartDate + "T00:00:00Z");
            const todayUtc = new Date();
            todayUtc.setUTCHours(0, 0, 0, 0);
            serverCountdownDays = Math.round(
              (tripStart.getTime() - todayUtc.getTime()) /
                (1000 * 60 * 60 * 24),
            );
          }
          const tripData = {
            ...parsed.data,
            ...(serverCountdownDays !== undefined
              ? { countdownDays: serverCountdownDays }
              : {}),
          };
          if (onWidget) onWidget({ type: "trip_card", trip: tripData });
          resultText =
            serverCountdownDays !== undefined
              ? `Trip card shown. Server-verified countdown: ${serverCountdownDays} days (${serverCountdownDays < 0 ? "trip is in the past" : serverCountdownDays === 0 ? "trip starts today" : `trip starts in ${serverCountdownDays} day${serverCountdownDays === 1 ? "" : "s"}`}). Use this exact number in your reply — do not recalculate.`
              : "Trip card shown.";
        }
      } else if (name === SHOW_POTTERY_ITEM_TOOL_NAME) {
        const parsed = ShowPotteryItemToolPayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        if (!parsed.success) {
          resultText = "Invalid pottery item ID.";
        } else {
          const [row] = await db
            .select({
              id: potteryItems.id,
              name: potteryItems.name,
              maker: potteryItems.maker,
              style: potteryItems.style,
              imagePath: potteryItems.imagePath,
              aiDescription: potteryItems.aiDescription,
              dominantColors: potteryItems.dominantColors,
            })
            .from(potteryItems)
            .where(eq(potteryItems.id, parsed.data.itemId));
          if (!row) {
            resultText = `Pottery item #${parsed.data.itemId} not found.`;
          } else {
            let imageUrl: string | undefined;
            try {
              const sc = createClient(
                env.supabaseUrl,
                env.supabaseServiceRoleKey,
                { auth: { persistSession: false, autoRefreshToken: false } },
              );
              const { data } = await sc.storage
                .from("pottery")
                .createSignedUrl(row.imagePath, 3600);
              imageUrl = data?.signedUrl ?? undefined;
            } catch {
              // non-fatal
            }
            if (onWidget)
              onWidget({
                type: "pottery_item",
                item: {
                  itemId: row.id,
                  name: row.name,
                  maker: row.maker ?? undefined,
                  style: row.style ?? undefined,
                  aiDescription: row.aiDescription ?? undefined,
                  dominantColors:
                    row.dominantColors.length > 0
                      ? row.dominantColors
                      : undefined,
                  imageUrl,
                },
              });
            resultText = `Pottery item card shown for "${row.name}".`;
          }
        }
      } else if (name === SHOW_FABRIC_SWATCH_TOOL_NAME) {
        const parsed = ShowFabricSwatchToolPayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        if (!parsed.success) {
          resultText = "Invalid fabric ID.";
        } else {
          const [row] = await db
            .select({
              id: fabrics.id,
              name: fabrics.name,
              manufacturer: fabrics.manufacturer,
              designer: fabrics.designer,
              dominantColors: fabrics.dominantColors,
              imagePath: fabrics.imagePath,
              aiDescription: fabrics.aiDescription,
            })
            .from(fabrics)
            .where(eq(fabrics.id, parsed.data.fabricId));
          if (!row) {
            resultText = `Fabric #${parsed.data.fabricId} not found.`;
          } else {
            let imageUrl: string | undefined;
            try {
              if (row.imagePath) {
                const sc = createClient(
                  env.supabaseUrl,
                  env.supabaseServiceRoleKey,
                  { auth: { persistSession: false, autoRefreshToken: false } },
                );
                const { data } = await sc.storage
                  .from("quilting")
                  .createSignedUrl(row.imagePath, 3600);
                imageUrl = data?.signedUrl ?? undefined;
              }
            } catch {
              // non-fatal
            }
            if (onWidget)
              onWidget({
                type: "fabric_swatch",
                swatch: {
                  fabricId: row.id,
                  name: row.name,
                  manufacturer: row.manufacturer ?? undefined,
                  designer: row.designer ?? undefined,
                  dominantColors:
                    row.dominantColors && row.dominantColors.length > 0
                      ? row.dominantColors
                      : undefined,
                  aiDescription: row.aiDescription ?? undefined,
                  imageUrl,
                },
              });
            resultText = `Fabric swatch card shown for "${row.name}".`;
          }
        }
      } else if (name === SHOW_ORNAMENT_ITEM_TOOL_NAME) {
        const parsed = ShowOrnamentItemToolPayload.safeParse(
          JSON.parse(call.function.arguments || "{}"),
        );
        if (!parsed.success) {
          resultText = "Invalid ornament item ID.";
        } else {
          const [row] = await db
            .select({
              id: ornamentsItems.id,
              name: ornamentsItems.name,
              seriesOrCollection: ornamentsItems.seriesOrCollection,
              year: ornamentsItems.year,
              brand: ornamentsItems.brand,
              imagePath: ornamentsItems.imagePath,
              aiDescription: ornamentsItems.aiDescription,
              dominantColors: ornamentsItems.dominantColors,
            })
            .from(ornamentsItems)
            .where(eq(ornamentsItems.id, parsed.data.itemId));
          if (!row) {
            resultText = `Ornament #${parsed.data.itemId} not found.`;
          } else {
            let imageUrl: string | undefined;
            try {
              const sc = createClient(
                env.supabaseUrl,
                env.supabaseServiceRoleKey,
                { auth: { persistSession: false, autoRefreshToken: false } },
              );
              const { data } = await sc.storage
                .from("ornaments")
                .createSignedUrl(row.imagePath, 3600);
              imageUrl = data?.signedUrl ?? undefined;
            } catch {
              // non-fatal
            }
            if (onWidget)
              onWidget({
                type: "ornament_item",
                item: {
                  itemId: row.id,
                  name: row.name,
                  seriesOrCollection: row.seriesOrCollection ?? undefined,
                  year: row.year ?? undefined,
                  brand: row.brand ?? undefined,
                  aiDescription: row.aiDescription ?? undefined,
                  dominantColors:
                    row.dominantColors && row.dominantColors.length > 0
                      ? row.dominantColors
                      : undefined,
                  imageUrl,
                },
              });
            resultText = `Ornament card shown for "${row.name}".`;
          }
        }
      } else if (name === SHOW_DATA_CARD_TOOL_NAME) {
        try {
          const parsed = ShowDataCardToolPayload.safeParse(
            JSON.parse(call.function.arguments || "{}"),
          );
          if (parsed.success) {
            if (onWidget) {
              onWidget({
                type: "data_card",
                title: parsed.data.title,
                rows: parsed.data.rows,
              });
              resultText = "Data card shown.";
            } else {
              const lines = parsed.data.rows.map(
                (r) => `${r.label}: ${r.value}`,
              );
              resultText = parsed.data.title
                ? `${parsed.data.title}\n${lines.join("\n")}`
                : lines.join("\n");
            }
          }
        } catch {
          // Malformed JSON — drop it.
        }
      } else if (RESTRICTED_SOFT_TOOL_NAMES.has(name)) {
        resultText = await executeRestrictedSoftTool(
          name,
          call.function.arguments,
        );
      } else if (AGENTPHONE_ACTION_TYPES.has(name)) {
        try {
          const finalAction = await tryBuildAction(
            name,
            call.function.arguments,
          );
          if (finalAction) {
            const executor = ACTION_EXECUTORS[finalAction.type as ActionType];
            const { status, body } = await executor(
              finalAction.payload as never,
              userId,
            );
            resultText =
              status < 400
                ? `Done: ${finalAction.label}.`
                : `Failed (${status}): ${JSON.stringify(body)}`;
          } else {
            resultText =
              "Couldn't understand that request clearly enough to act — ask the user to clarify.";
          }
        } catch (err) {
          logger.error(
            { err, name },
            `${channelLabel} restricted action execution failed`,
          );
          resultText =
            "That action failed on our end — tell the user to try again or use the app.";
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultText,
      });
    }
  }

  // If all MAX_ROUNDS were consumed by tool calls and the model never produced
  // a text reply (e.g. show_trip_card → web_search → fetch_page used all 3
  // rounds), make one final forced call with tool_choice:"none" so the model
  // can synthesise the tool results it already has into an actual answer.
  // Only fires when there are accumulated tool results in context (messages
  // will have grown beyond the initial system+history+user set).
  if (!replyText && messages.length > 2 + Math.min(history.length, 10)) {
    try {
      const finalCompletion = await callModel(
        config.chatModel,
        (client, model) =>
          client.chat.completions.create({
            model,
            max_tokens: maxTokens,
            messages,
            tool_choice: "none",
          }),
      );
      replyText = (finalCompletion.choices[0]?.message?.content ?? "").trim();
    } catch (err) {
      logger.warn({ err }, `${channelLabel} final-synthesis call failed`);
    }
  }

  if (!replyText) {
    replyText =
      "Sorry, I couldn't process that — please try again or use the app.";
  }

  const updatedHistory = [
    ...history,
    { role: "user" as const, content: inputText },
    { role: "assistant" as const, content: replyText },
  ].slice(-20);

  return { replyText, history: updatedHistory };
}

// Runs one restricted, non-streaming Elaine turn for an inbound SMS message
// or voice-call transcript. Always auto-executes any allowed tool call
// (there is no confirmation UI over SMS/voice) and returns the trimmed
// conversation history to persist alongside the reply text.
export async function runAgentphoneTurn(params: {
  userId: number;
  inputText: string;
  history: AgentphoneChatMessage[];
}): Promise<{ replyText: string; history: AgentphoneChatMessage[] }> {
  return runRestrictedElaineTurn({
    ...params,
    maxTokens: 300,
    channelLabel: "SMS/voice",
    channelAddendum: AGENTPHONE_CHANNEL_ADDENDUM,
    formattingNote:
      "Your replies will be sent as SMS text or read aloud over a phone call. Use plain text only — NO markdown, NO emojis, NO bullet points. Keep it to one to three sentences.",
  });
}

// ---------------------------------------------------------------------------
// Elaine inbound-email bridge — used by routes/elaine-email.ts. Reuses the
// exact same restricted, non-destructive tool allowlist as the AgentPhone
// SMS/voice bridge above (AGENTPHONE_ACTION_TYPES / AGENTPHONE_ACTION_TOOLS):
// no delete_*, no trip/wishlist creation, no email/itinerary-gen/calendar-
// connect tools, no on-screen state context. Runs in auto_run mode always —
// there's no confirmation UI over email, so every allowed action executes
// immediately and the reply reports what happened.
// ---------------------------------------------------------------------------

export interface ElaineEmailChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ELAINE_EMAIL_CHANNEL_ADDENDUM =
  "CHANNEL: You are replying by email. Use share_app_link to give the user a direct URL whenever a request needs an actual screen (e.g. connecting a calendar, uploading a photo). Actions run immediately — always briefly confirm what you did (or that it failed). Sign off naturally as Elaine; do not repeat a greeting like 'Hi' if the message is a quick reply.";

// Runs one restricted, non-streaming Elaine turn for an inbound email from a
// known household member. Mirrors runAgentphoneTurn's shape/behavior exactly
// (same tool allowlist, same auto-run semantics) but with an email-appropriate
// system prompt and slightly longer context/history budget since email has
// no character-count pressure.
export async function runElaineEmailTurn(params: {
  userId: number;
  inputText: string;
  history: ElaineEmailChatMessage[];
}): Promise<{ replyText: string; history: ElaineEmailChatMessage[] }> {
  return runRestrictedElaineTurn({
    ...params,
    maxTokens: 500,
    channelLabel: "email",
    channelAddendum: ELAINE_EMAIL_CHANNEL_ADDENDUM,
    formattingNote:
      "Your replies will be sent as plain-text email. Use NO markdown syntax (no **, no #, no - lists). A short paragraph or two is usually enough.",
  });
}

// ---------------------------------------------------------------------------
// Messenger @elaine bridge — used by routes/messenger/conversations.ts when a
// group-chat message mentions @elaine. Runs the same restricted engine as the
// AgentPhone/email bridges with a messenger-specific system prompt, and
// returns any widget cards emitted during the turn so the caller can persist
// them as message metadata for the client to render.
// ---------------------------------------------------------------------------

export async function runMessengerElaineTurn(params: {
  userId: number;
  conversationId: number;
  inputText: string;
  senderName: string;
}): Promise<{ replyText: string; widgets: Record<string, unknown>[] }> {
  // Tag Sentry trace so messenger turns appear in AI Conversations grouped
  // by the messenger conversation thread.
  Sentry.setConversationId(`messenger-${params.conversationId}`);
  const widgets: Record<string, unknown>[] = [];

  // Load the last 20 messages from this conversation as history (excluding
  // the just-inserted current message which is always the most recent row).
  const recentRows = await db
    .select({
      senderId: messengerMessages.senderId,
      body: messengerMessages.body,
    })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.conversationId, params.conversationId),
        isNull(messengerMessages.deletedAt),
      ),
    )
    .orderBy(desc(messengerMessages.createdAt))
    .limit(21);

  // Most-recent row is the current user message just inserted — skip it to
  // avoid it appearing twice (it's re-added as inputText by the engine).
  const history = recentRows
    .slice(1)
    .reverse()
    .map((m) => ({
      role: m.senderId === null ? ("assistant" as const) : ("user" as const),
      content: m.body,
    }));

  const { replyText } = await runRestrictedElaineTurn({
    userId: params.userId,
    inputText: params.inputText,
    history,
    maxTokens: 500,
    channelLabel: "the group messenger",
    channelAddendum: `CHANNEL: You are in the Batchelor household group messenger — ${params.senderName} has @mentioned you. Keep replies friendly and concise (under 200 words unless detail is truly needed). Markdown renders in the messenger, so you may use it lightly. Use share_app_link to give direct URLs when a request needs a screen.`,
    onWidget: (w) => widgets.push(w),
  });

  return { replyText, widgets };
}

// ---------------------------------------------------------------------------
// Elaine Slack bridge — used by routes/slack.ts when a DM or /elaine slash
// command arrives from a known household member. Reuses the exact same
// restricted engine and AGENTPHONE_ACTION_TYPES allowlist as the AgentPhone
// and email bridges — same tool set, same auto-run semantics — but with a
// Slack-appropriate formatting note that permits basic Slack markdown and
// slightly richer output than SMS.
// ---------------------------------------------------------------------------

export interface ElaineSlackChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ELAINE_SLACK_CHANNEL_ADDENDUM =
  "CHANNEL: You are replying via Slack DM. Use share_app_link to give the user a direct URL whenever a request needs an actual screen (e.g. connecting a calendar, uploading a photo). Actions run immediately — always briefly confirm what you did (or that it failed). Slack supports basic markdown (*bold*, _italic_) — use it lightly.";

export async function runElaineSlackTurn(params: {
  userId: number;
  inputText: string;
  history: ElaineSlackChatMessage[];
}): Promise<{ replyText: string; history: ElaineSlackChatMessage[] }> {
  return runRestrictedElaineTurn({
    ...params,
    maxTokens: 600,
    channelLabel: "Slack",
    channelAddendum: ELAINE_SLACK_CHANNEL_ADDENDUM,
    formattingNote:
      "Your replies will be sent as Slack messages. You may use basic Slack markdown (*bold*, _italic_) lightly. Keep responses concise — two to four sentences is usually ideal, though more detail is fine when genuinely needed. Do not use email-style sign-offs.",
  });
}

export default router;
