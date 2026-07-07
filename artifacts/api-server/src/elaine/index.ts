import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { and, eq, desc, isNull, count } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  appUsers,
  elaineConversations,
  elaineNudges,
  elaineSettings,
  elaineMemory,
  elaineGlobalConfig,
  elaineHistoryConversations,
  elaineHistoryMessages,
  travelsTrips,
  travelsTripDocuments,
  travelsTripPhotos,
  travelsReminders,
  travelsWishlist,
  travelsGoogleCalendarConnections,
  travelsConnectedCalendars,
} from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { callModelWithSubagent } from "../lib/ai-client";
import {
  getElaineGlobalConfig,
  invalidateElaineGlobalConfigCache,
} from "../lib/elaine-config";
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
import { sendAssistantEmail, resendConfigured } from "../lib/email";
import { webSearch } from "../lib/web-search";
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
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env";

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

type ChatMessage = { role: "user" | "assistant"; content: string };

const APP_IDS = ["travels", "pottery", "quilting", "hub", "elaine"] as const;
type AppId = (typeof APP_IDS)[number];

const ChatBody = z.object({
  message: z.string().min(1).max(4000),
  // Freeform description of what's currently on the user's screen — page
  // name plus any live/unsaved field values a page has chosen to publish via
  // usePageAssistantContext(). Never persisted; only used for this one call.
  pageContext: z.string().max(6000).optional(),
  // Which app surface the user is currently chatting from, so navigation
  // suggestions stay scoped to real paths in that app. Defaults to "hub"
  // since Elaine is one continuous conversation shown everywhere.
  appId: z.enum(APP_IDS).default("hub"),
  // Named conversation to continue. Omit to auto-create a new one.
  conversationId: z.number().int().positive().optional(),
  // Public Supabase Storage URLs for images the user attached (max 5, 5 MB each).
  attachmentUrls: z.array(z.string()).max(5).optional(),
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
    const res = await fetch(url, {
      headers: { "User-Agent": "Batchelor-App/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
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
  ...potteryActionSchemas,
  ...quiltingActionSchemas,
]);

type PendingAction = z.infer<typeof ActionBody>;
type ActionType = PendingAction["type"];

const POTTERY_ACTION_TYPES = new Set<string>([
  "update_pottery_item",
  "delete_pottery_item",
  "create_pottery_category",
  "delete_pottery_category",
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
  PotteryActionType | QuiltingActionType
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
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    const existing =
      (trip.packingList as Array<{ item: string; packed: boolean }> | null) ??
      [];
    const updatedList = [...existing, { item: payload.item, packed: false }];
    const [row] = await db
      .update(travelsTrips)
      .set({ packingList: updatedList })
      .where(eq(travelsTrips.id, payload.tripId))
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsWishlist.id, payload.wishlistId),
          eq(travelsWishlist.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsWishlist.id, payload.wishlistId),
          eq(travelsWishlist.userId, userId),
        ),
      );
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

  remove_packing_item: (async (
    payload: z.infer<typeof RemovePackingItemActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    const existingList =
      (trip.packingList as Array<{ item: string; packed: boolean }> | null) ??
      [];
    const filteredList = existingList.filter(
      (entry) => entry.item.toLowerCase() !== payload.item.toLowerCase(),
    );
    const [row] = await db
      .update(travelsTrips)
      .set({ packingList: filteredList })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    return { status: 200, body: { type: "remove_packing_item", result: row } };
  }) as ActionExecutor,

  add_reminder: (async (
    payload: z.infer<typeof AddReminderActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, title: travelsTrips.title })
      .from(travelsTrips)
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
    if (
      !existing ||
      existing.tripId !== payload.tripId ||
      existing.userId !== userId
    ) {
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
    if (
      !existing ||
      existing.tripId !== payload.tripId ||
      existing.userId !== userId
    ) {
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
    if (
      !existing ||
      existing.tripId !== payload.tripId ||
      existing.userId !== userId
    ) {
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
      .where(
        and(
          eq(travelsTrips.id, payload.tripId),
          eq(travelsTrips.userId, userId),
        ),
      );
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
};

const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  ...TRAVEL_ACTION_EXECUTORS,
  ...potteryActionExecutors,
  ...quiltingActionExecutors,
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
  ...potteryActionTools,
  ...quiltingActionTools,
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
    "/blocks",
    "/blocks/new",
    "/layouts",
    "/layouts/new",
    "/whole-quilt/designer",
    "/shopping",
    "/categories",
  ],
  hub: ["/", "/account"],
  elaine: ["/"],
};

// Dynamic-id path shapes allowed per app, checked against the same regex
// pattern for every app since only the "kind" segment differs.
const NAVIGATE_PATH_RE_BY_APP: Record<AppId, RegExp> = {
  travels: /^\/(trips\/\d+|trips|map|explore|wishlist|destinations|settings)?$/,
  pottery: /^\/(piece\/\d+|add|compare|categories|maintenance|settings)?$/,
  quilting:
    /^\/(fabrics\/\d+|fabrics\/add|fabrics|patterns\/\d+|patterns\/add|patterns|quilts\/\d+|quilts\/add|quilts|blocks\/\d+\/edit|blocks\/\d+\/cut-pattern|blocks\/new|blocks|layouts\/new|layouts|whole-quilt\/designer|shopping|categories)?$/,
  hub: /^\/(account)?$/,
  elaine: /^\/$/,
};

// Cross-app navigation paths — any app can navigate the user to another app's
// root or a known sub-path. Query params are whitelisted (search, cat, color).
// The client detects these prefixes and uses window.location.href instead of
// the SPA router so the correct React bundle loads.
const CROSS_APP_NAVIGATE_RE =
  /^\/(pottery|quilting|travels|elaine)(\/[^?#]*)?(\?[a-zA-Z0-9=+%._~!$&'()*+,;:-]*)?\/?$/;

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
});

const SET_MODE_TOOL_NAME = "set_action_confirmation_mode";

const SetModeToolPayload = z.object({
  mode: z.enum(ACTION_CONFIRMATION_MODES),
});

const WEB_SEARCH_TOOL_NAME = "web_search";

const WebSearchToolPayload = z.object({
  query: z.string().min(1).max(500),
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
        "Save a durable, household-relevant fact for later (a preference, a recurring detail, something another family member would want to know). Applied immediately, without a user confirmation step — only use this for genuinely durable facts, never small talk or one-off questions.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The fact, written plainly" },
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
  ];

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
const attachmentStorage = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let attachmentBucketReady: Promise<void> | null = null;
async function ensureAttachmentBucket(): Promise<void> {
  if (!attachmentBucketReady) {
    attachmentBucketReady = (async () => {
      const { data } = await attachmentStorage.storage.getBucket(ATTACHMENT_BUCKET);
      if (!data) {
        const { error } = await attachmentStorage.storage.createBucket(ATTACHMENT_BUCKET, {
          public: true,
        });
        if (error && !/already exists/i.test(error.message)) {
          attachmentBucketReady = null;
          throw error;
        }
      }
    })();
  }
  return attachmentBucketReady;
}

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (!ok) {
      cb(new Error("Only JPEG, PNG, and WebP images are accepted"));
    } else {
      cb(null, true);
    }
  },
});

// POST /attachments — upload a single image for use as a message attachment.
router.post("/attachments", attachmentUpload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }
  const userId = req.session.userId!;
  const ext =
    req.file.mimetype === "image/jpeg"
      ? "jpg"
      : req.file.mimetype === "image/webp"
        ? "webp"
        : "png";
  const path = `${userId}/${randomUUID()}.${ext}`;

  try {
    await ensureAttachmentBucket();
  } catch (err) {
    req.log.error({ err }, "elaine attachment bucket init failed");
    res.status(500).json({ error: "Storage unavailable" });
    return;
  }

  const { error: uploadError } = await attachmentStorage.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

  if (uploadError) {
    req.log.error({ err: uploadError }, "elaine attachment upload failed");
    res.status(500).json({ error: "Upload failed" });
    return;
  }

  const { data: publicUrlData } = attachmentStorage.storage
    .from(ATTACHMENT_BUCKET)
    .getPublicUrl(path);

  res.status(201).json({ url: publicUrlData.publicUrl });
});

// ---------------------------------------------------------------------------
// Named conversation CRUD
// ---------------------------------------------------------------------------

// GET /conversations — list this user's named conversations, newest first.
router.get("/conversations", async (req, res) => {
  const userId = req.session.userId!;
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
    .where(eq(elaineHistoryConversations.userId, userId))
    .groupBy(elaineHistoryConversations.id)
    .orderBy(desc(elaineHistoryConversations.updatedAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messageCount: Number(r.messageCount),
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
      attachmentUrls: (m.attachmentUrls as string[]) ?? [],
      createdAt: m.createdAt.toISOString(),
    })),
  );
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
  await getOrCreateConversation(userId);
  await db
    .update(elaineConversations)
    .set({ messages: [], updatedAt: new Date() })
    .where(eq(elaineConversations.userId, userId));
  res.json({ messages: [] });
});

router.post("/chat", async (req, res) => {
  const userId = req.session.userId!;
  const { message, pageContext, appId, conversationId, attachmentUrls } =
    ChatBody.parse(req.body);

  const [user] = await db
    .select({ displayName: appUsers.displayName, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userName = user?.displayName || user?.email || "there";

  // Resolve the named history conversation — create one if not provided.
  let histConvId: number | null = conversationId ?? null;
  if (histConvId === null) {
    const [newConv] = await db
      .insert(elaineHistoryConversations)
      .values({ userId, title: "New conversation" })
      .returning({ id: elaineHistoryConversations.id });
    histConvId = newConv?.id ?? null;
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

  // Load history from named conversation rows (preferred) or fall back to the
  // rolling elaineConversations table for backward compat with pre-history sends.
  let history: ChatMessage[] = [];
  if (histConvId !== null) {
    const histMsgs = await db
      .select({
        role: elaineHistoryMessages.role,
        content: elaineHistoryMessages.content,
      })
      .from(elaineHistoryMessages)
      .where(eq(elaineHistoryMessages.conversationId, histConvId))
      .orderBy(elaineHistoryMessages.createdAt);
    history = histMsgs.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  } else {
    const conversation = await getOrCreateConversation(userId);
    history = (conversation?.messages as ChatMessage[] | null) ?? [];
  }

  const memoryRows = await db
    .select({ content: elaineMemory.content })
    .from(elaineMemory)
    .orderBy(desc(elaineMemory.createdAt))
    .limit(50);
  const memoryBlock =
    memoryRows.length > 0
      ? memoryRows.map((m) => `- ${m.content}`).join("\n")
      : "(nothing remembered yet)";

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

  const elaineConfig = await getElaineGlobalConfig();

  const CONFIRMATION_MODE_EXPLANATION: Record<ActionConfirmationMode, string> =
    {
      one_by_one:
        "one_by_one — the user reviews and confirms/skips each proposed action individually, one at a time.",
      all_at_once:
        "all_at_once — the user sees every proposed action from this turn together and confirms or cancels them as a group.",
      auto_run:
        "auto_run — proposed actions run immediately with no confirmation step; you should report what you did (or if something failed) after the fact.",
    };

  const CURRENT_APP_LABEL: Record<AppId, string> = {
    travels: "Travels",
    pottery: "Pottery",
    quilting: "Quilting",
    hub: "the Batchelor hub (app launcher)",
    elaine: "her own dedicated space (the Elaine app)",
  };

  const systemPrompt = `You are Elaine, a warm, personable AI assistant built into the Batchelor app — a household account shared across a Pottery collection app, a Quilting collection app, and a Travel-planning app, plus a hub/launcher page and your own dedicated Elaine app. You are one continuous assistant: the same conversation and memory follow the user across all of these apps, even though each app has its own pages and tools. You are talking with ${userName}, who is currently using you from ${CURRENT_APP_LABEL[appId]}.

PERSONALITY: You're conversational, upbeat, and genuinely helpful — like a knowledgeable friend, not a generic corporate assistant. You can be a little playful. You still give concrete, accurate, step-by-step help when asked.

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
- Piece detail ("/piece/:id"): everything about one piece — photos, name, maker, style, shape, condition, origin, era, notes, glaze/surface AI analysis.
- Compare ("/compare"): pick two or more pieces and compare their AI-derived attributes side by side.
- Categories ("/categories"): manage the categories used to organize the collection.
- Maintenance ("/maintenance"): bulk AI re-analysis and other collection upkeep tools.
- Settings ("/settings"): account/profile settings.

Quilting app:
- Home ("/"): overview/dashboard for the quilting collection.
- Fabrics ("/fabrics", "/fabrics/add", "/fabrics/bulk-add", "/fabrics/:id"): the fabric stash — browse, add one or many fabrics (with AI photo analysis), and view/edit a fabric's details.
- Patterns ("/patterns", "/patterns/add", "/patterns/:id"): quilt patterns — browse, add, and view/edit pattern details.
- Quilts ("/quilts", "/quilts/add", "/quilts/:id"): finished/in-progress quilts — browse, add, and view/edit details.
- Compare ("/compare"): compare fabrics or patterns side by side.
- Blocks ("/blocks", "/blocks/new", "/blocks/:id", "/blocks/:id/edit", "/blocks/:id/cut-pattern"): a quilt-block designer with generated cutting patterns.
- Layouts ("/layouts", "/layouts/new", "/layouts/:id", "/layouts/:id/edit"): plan how blocks/fabrics come together into a quilt layout.
- Whole Quilt ("/whole-quilt", "/whole-quilt/designer"): design/browse whole-quilt layouts.
- Shopping ("/shopping"): the fabric/supplies shopping list.
- Categories ("/categories"): manage categories used to organize fabrics/patterns.
- Maintenance ("/maintenance"): bulk AI re-analysis and other collection upkeep tools.

Hub (app launcher):
- Launcher ("/"): lets the household pick which app to open (Pottery, Quilting, Travels).
- Account ("/account"): shared account/profile settings.

If the user asks "what is this page for", "what can I do here", or similar without more specific on-screen detail below, answer using this map (and the live on-screen state if present) rather than saying you don't know. If they ask about a different app than the one they're currently in, you can still answer from this map — you don't need to tell them to switch apps first, though you can suggest navigating there if it's the same app they're already in.

WHAT YOU CAN SEE RIGHT NOW (live, possibly unsaved, on-screen state in ${CURRENT_APP_LABEL[appId]}):
${pageContext ? pageContext : "(no page context was shared for this screen)"}

SHARED FAMILY MEMORY (facts you've picked up from any family member — treat as true for the whole household, not just the person asking):
${memoryBlock}

TOOLS: You have tools available for navigation suggestions, remembering household facts, and proposing changes to trips/wishlist/packing lists/reminders. Each tool's own description explains exactly when and how to use it — follow those rules precisely, especially around never fabricating numeric ids and asking permission in your visible reply text before calling any trip/wishlist/packing/reminder tool. If a single request naturally involves more than one write-action (e.g. "add a reminder to book the hotel and add wine tasting to the wishlist"), call all of the relevant action tools in that same turn — don't limit yourself to one. Just make sure your visible reply names everything you're about to do before you call the tools, so nothing is a surprise. Navigation suggestions and remembering a fact can always accompany action tools.

CONFIRMATION MODE: This user's current mode for confirming proposed actions is "${actionConfirmationMode}" — ${CONFIRMATION_MODE_EXPLANATION[actionConfirmationMode]} The three modes are: ${Object.values(CONFIRMATION_MODE_EXPLANATION).join(" | ")} If the user asks how you confirm actions, or asks to change it (e.g. "just do it automatically", "ask me one at a time", "show me everything together"), explain the modes in your visible reply and call ${SET_MODE_TOOL_NAME} once they've decided — never call it just to describe the options. Mention that they can also change this anytime from Settings.

REMINDERS: Use add_reminder for requests like "remind me to check in for our flight" or "remind me to book the hotel by Friday" — it creates a new reminder and syncs it to the calendar by default; include recipientEmails only if the user asked to also notify someone. Use sync_reminder_to_calendar only to toggle calendar sync on or off for a reminder that already exists and whose numeric id you can see on screen (look for "reminderId: <number>" in the reminders listed for the current trip); never use it to create a reminder. Use edit_reminder for changes to an existing reminder (title, description, due date, done state, recipients, or calendar sync) — only include the fields the user asked to change, and never guess a reminder id. Use delete_reminder to permanently remove an existing reminder (also removes its calendar events); never guess a reminder id for either.

ITINERARY: Use add_itinerary_day for requests like "add a day trip to Kyoto on the 14th" — it appends a brand-new day to the trip's itinerary. Use regenerate_itinerary_day for requests like "regenerate day 3" or "come up with a new plan for that day" — it re-runs AI planning for ONE existing day and replaces its activities, using balanced-pace, general-interest defaults since it can't see any per-session style/interest picks the user made in the UI. Only use regenerate_itinerary_day on a day number you can see listed on screen (e.g. "Day 3"); never guess a day number, and never use it to create a new day (use add_itinerary_day for that). Use generate_itinerary for requests like "plan my whole trip" or "generate an itinerary" — it replaces ALL days with a fresh AI-generated plan; if the trip already has itinerary days shown on screen, say so and confirm the user wants to overwrite them before calling it. Each activity you can see on screen has a 1-based day/activity number and a status (tentative or confirmed); tentative activities synced from a document are flagged as such. Use confirm_itinerary_activity to mark a tentative activity firm (or back to tentative) once the user has verified it, and remove_itinerary_activity to delete an activity outright (e.g. a wrong or duplicate document-derived entry) — both require the exact day and activity numbers shown on screen, never guessed.

CALENDAR: Each household member connects their own Google Calendar independently from the Settings page; you can never trigger that OAuth connection yourself — it requires the user to click a real "Connect" button that redirects their browser to Google. If the user asks to connect and you can see from on-screen context that it's not connected yet, ask if they'd like you to take them to Settings and use suggest_navigation for "/settings" — never claim you connected it. Once connected, use add_connected_calendar to add one of their own calendars to their Travel Calendar overlay, but only if you're on the Settings page and can see the connection is active plus the exact googleCalendarId in the on-screen calendar list — never guess one or pick one that isn't listed. Use disconnect_calendar to remove their Google Calendar connection entirely — only when it's shown as connected on screen, and make sure your visible reply asks permission first since this stops all future reminder syncing and removes every calendar they'd connected. Disconnecting or reconnecting only ever affects the current user, never anyone else in the household. Only the app owner can assign which calendar is the shared "Travel" calendar, and you can never do that on their behalf — direct them to the Settings page for that.

${
  appId === "travels"
    ? `MAGNET CHECK: If the user asks whether they already own a souvenir magnet, or wants to check a photo against their collection before buying a duplicate, you have no tool for this and can't see or analyze photos yourself in this text chat — tell them to tap the small camera icon next to the message box, which lets them snap or upload a photo and checks it against their whole collection right there in the chat (no need to navigate anywhere first). Never guess or fabricate a match result. This camera-based check is a Travels-only feature — it is not available in Pottery, Quilting, or the hub.\n\n`
    : ""
}DOCUMENTS: You can already see each uploaded document's parsed fields (confirmation numbers, dates, etc.) in the on-screen state above — answer questions about them directly instead of asking the user to open or re-read the file. If the user says a document's details look wrong, are missing, or asks you to "re-read"/"re-scan" a document, use rescan_document to re-run AI extraction on the original uploaded file; this only works for a document whose docId you can see on screen (look for "docId: <number>") and never touches fields the user has locked (shown with a lock icon in the app). This does not let you upload a new file — if there's no matching document on screen, tell the user to upload it from the trip's Documents section first. This applies to Travels trip documents only — Pottery and Quilting don't have an equivalent document-upload feature.

POTTERY ITEMS: Use update_pottery_item to edit an existing piece (name, notes, quantity, style, shape, maker, condition, origin, era) — only include fields that actually change, and only if the piece's numeric id is visible on screen (look for "itemId: <number>"); never guess one. Use delete_pottery_item to permanently remove a piece and its photos — say clearly in your visible reply that this deletes the item, since it's destructive. Use create_pottery_category / delete_pottery_category to manage the categories used to organize the collection; never guess a category id for deletion.

QUILTING ITEMS: Use update_fabric / delete_fabric, update_pattern / delete_pattern for editing or removing an existing fabric or pattern — only if its numeric id is visible on screen, never guessed, and be clear in your visible reply that a delete is permanent. Use create_shopping_item / update_shopping_item / delete_shopping_item to manage the fabric/supplies shopping list. Use create_quilting_category / delete_quilting_category to manage categories; never guess a category id for deletion.

EMAIL: Whenever you've just given the user something substantial worth keeping — a list of recommendations, an itinerary summary, packing tips, etc. — offer to email it to them, e.g. "Want me to email you this list?" Only call send_email once they say yes; never call it unprompted or assume they want it. It always goes to their own registered account email, so never ask for an address and never offer to send it to anyone else. Write a short subject and a plain-text body (no markdown/HTML, blank line between paragraphs) — it gets formatted into a nice email automatically. You have no way to export a PDF or Word document, so don't offer that; email is the only export option available.

WEB SEARCH: You have a real-time web_search tool, unlike a plain language model — use it proactively (no need to ask permission first) whenever a question depends on current information you can't be confident about from memory alone: opening hours, current prices, weather, visa/entry rules, local events, news, or anything else that changes over time. Don't use it for stable general knowledge or for things already visible in the on-screen state above. Call it as many times as needed for different sub-questions (e.g. rephrase or split into multiple focused searches for a broad question, so you get a fuller picture rather than one narrow result), then write your visible reply based on what it returns — never paste raw search output, and never fabricate a current fact instead of searching for it.

EXPERT ADVICE: For genuine expertise/advice/recommendation questions — a judgment call where being one-sided could actually steer the user wrong (packing/gear advice for specific constraints, which option to book, negotiating tactics, whether something is a good idea, etc.) — use consult_experts rather than just answering solo; it cross-checks more than one independent source and gives you back a single synthesized answer to relay. Don't use it for simple facts, small talk, or anything that needs web_search instead (current/live data). It takes a bit longer than a normal reply — that's expected, not a malfunction.

LIVE MAPS DATA: You also have five Google Maps-backed tools for real, current data instead of guessing — prefer these over web_search when they apply, since they return structured, accurate data rather than a text summary. get_weather_forecast gives a real multi-day forecast for a place (use it for "what's the weather", packing-for-climate, or rain-risk questions). find_nearby_places gives real restaurants/attractions/hotels/etc. with ratings (use it for recommendations or "what's near X"). get_route_info gives real distance/time between two places for a given travel mode (use it for "how far"/"how long to get there" questions). get_air_quality gives real current AQI/category/dominant pollutant (use it for pollution/smog questions or when giving packing/health advice for a destination). get_pollen_forecast gives real grass/tree/weed pollen categories (use it for allergy/hay-fever questions or packing advice when someone has allergies). When someone asks "what should I pack" for a trip, proactively check weather, and check air quality/pollen too if it's relevant (long trip, known allergy mentioned, or the destination is known for pollution) rather than only guessing from general knowledge. For get_weather_forecast: lat/lng are optional — just provide locationName and the server geocodes automatically, so ALWAYS call this tool when asked about weather (never use web_search as a fallback for weather). For find_nearby_places and get_route_info: still need real lat/lng — pull coordinates from on-screen trip/destination data or a prior find_nearby_places result; never invent coordinates. For get_air_quality and get_pollen_forecast: also need lat/lng from context.

FORMATTING: Your visible replies are rendered in a chat bubble with a markdown renderer. Use markdown naturally to make replies easier to read, but keep it light — this is a chat bubble, not a document. Good uses: **bold** for key terms or place names, bullet lists (- item) for 3+ items, numbered lists (1. step) for instructions, ## for a section heading only when the reply is genuinely multi-section. Do not use headers for short replies. Do not use markdown for a single sentence or two — plain prose is fine. Never use backtick code blocks. When you call a weather, places, air-quality, or pollen tool and it succeeds, a rich visual card is automatically shown below your reply — so in that case keep your reply text very short (1–2 sentences summarising the key point) rather than spelling out all the data again in text.

Keep replies concise and easy to read in a chat bubble.`;

  // If the user attached images, format the current user turn as a vision
  // content-array so the model can see them. History messages are always
  // text-only (image URLs are stored in the DB but not re-sent to the model).
  const userTurnContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] | string =
    attachmentUrls && attachmentUrls.length > 0
      ? [
          { type: "text", text: message },
          ...attachmentUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : message;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
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
  const MAX_ROUNDS = 2;

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
      WEB_SEARCH_TOOL_NAME,
      CONSULT_EXPERTS_TOOL_NAME,
      GET_WEATHER_TOOL_NAME,
      FIND_NEARBY_PLACES_TOOL_NAME,
      GET_ROUTE_INFO_TOOL_NAME,
      GET_AIR_QUALITY_TOOL_NAME,
      GET_POLLEN_FORECAST_TOOL_NAME,
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
            await db.insert(elaineMemory).values({
              content: parsed.data.content,
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
      [WEB_SEARCH_TOOL_NAME]: "searching the web",
      [CONSULT_EXPERTS_TOOL_NAME]: "checking in with a couple of experts",
      [GET_WEATHER_TOOL_NAME]: "checking the forecast",
      [FIND_NEARBY_PLACES_TOOL_NAME]: "looking up places",
      [GET_ROUTE_INFO_TOOL_NAME]: "checking travel times",
      [GET_AIR_QUALITY_TOOL_NAME]: "checking air quality",
      [GET_POLLEN_FORECAST_TOOL_NAME]: "checking pollen levels",
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
        let resultText: string;
        try {
          if (call.name === WEB_SEARCH_TOOL_NAME) {
            const parsed = WebSearchToolPayload.safeParse(
              JSON.parse(call.args),
            );
            if (!parsed.success) {
              resultText = "Invalid search query — ask the user to rephrase.";
            } else {
              const { answer, citations } = await webSearch(parsed.data.query);
              webSearchCitations.set(call.id, citations);
              resultText = answer
                ? citations.length > 0
                  ? `${answer}\n\nSources:\n${citations.map((url, i) => `[${i + 1}] ${url}`).join("\n")}`
                  : answer
                : "No results found for this search.";
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
          } else {
            resultText = "Unsupported tool.";
          }
        } catch (err) {
          req.log.error(
            { err, tool: call.name },
            "elAIne hard tool call failed",
          );
          resultText =
            "That lookup failed — tell the user you couldn't get that information right now.";
        }
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

  const updatedHistory: ChatMessage[] = [
    ...history,
    {
      role: "user",
      content: message,
      ...(attachmentUrls && attachmentUrls.length > 0
        ? { attachmentUrls }
        : {}),
    },
    { role: "assistant", content },
  ];

  // Save turn to the named history conversation.
  if (histConvId !== null) {
    await db.insert(elaineHistoryMessages).values([
      {
        conversationId: histConvId,
        userId,
        role: "user",
        content: message,
        attachmentUrls: attachmentUrls ?? [],
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
});

// Executes a write-action elAIne proposed in chat, only once the user has
// explicitly confirmed it in the UI. Every write here is scoped to the
// calling user the same way the equivalent hand-written routes are.
router.post("/action", async (req, res) => {
  const userId = req.session.userId!;
  const action = ActionBody.parse(req.body);
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

router.get("/memory", async (_req, res) => {
  const rows = await db
    .select({
      id: elaineMemory.id,
      content: elaineMemory.content,
      createdAt: elaineMemory.createdAt,
      createdByUserId: elaineMemory.createdByUserId,
    })
    .from(elaineMemory)
    .orderBy(desc(elaineMemory.createdAt));
  res.json(rows);
});

router.delete("/memory/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: elaineMemory.id })
    .from(elaineMemory)
    .where(eq(elaineMemory.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(elaineMemory).where(eq(elaineMemory.id, id));
  res.status(204).end();
});

export default router;
