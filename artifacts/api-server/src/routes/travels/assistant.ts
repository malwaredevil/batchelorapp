import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  appUsers,
  travelsAssistantConversations,
  travelsAssistantSettings,
  travelsHouseholdMemory,
  travelsTrips,
  travelsTripDocuments,
  travelsTripPhotos,
  travelsReminders,
  travelsWishlist,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { callModelWithSubagent, MODELS } from "../../lib/ai-client";
import { deleteTripPhoto } from "../../lib/travels/storage";
import { deleteDocument } from "../../lib/travels-storage";
import {
  getConnectedTargetUserIds,
  syncReminderCalendarEvents,
} from "./reminders";
import { generateItineraryForTrip, ItineraryActionError } from "./ai";

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
  "You are a fast research helper for a friendly travel assistant named elAIne. You will be given a small, self-contained sub-task (e.g. list facts, summarize options, draft a short list). Answer concisely and factually in plain text so elAIne can incorporate your answer into her reply.";

type ChatMessage = { role: "user" | "assistant"; content: string };

const ChatBody = z.object({
  message: z.string().min(1).max(4000),
  // Freeform description of what's currently on the user's screen — page
  // name plus any live/unsaved field values a page has chosen to publish via
  // usePageAssistantContext(). Never persisted; only used for this one call.
  pageContext: z.string().max(6000).optional(),
});

// How elAIne confirms a turn that proposes more than one write-action:
// "one_by_one" (default, safest) shows each proposed action individually,
// confirm/skip before the next appears; "all_at_once" shows every proposed
// action together with one Confirm all / Cancel all; "auto_run" executes
// them immediately with no confirmation step and reports back afterward.
const ACTION_CONFIRMATION_MODES = ["one_by_one", "all_at_once", "auto_run"] as const;
type ActionConfirmationMode = (typeof ACTION_CONFIRMATION_MODES)[number];

const SettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    actionConfirmationMode: z.enum(ACTION_CONFIRMATION_MODES).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.actionConfirmationMode !== undefined, {
    message: "At least one setting must be provided",
  });

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
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch {
    return null;
  }
}

async function getTripLabelInfo(
  tripId: number,
): Promise<{ title: string; destination: string } | null> {
  const [trip] = await db
    .select({ title: travelsTrips.title, destination: travelsTrips.destination })
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

const TRIP_STATUS_ENUM = ["wishlist", "planning", "booked", "active", "completed"] as const;

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
  syncToCalendar: z.boolean().optional(),
});

const SyncReminderToCalendarActionPayload = z.object({
  tripId: z.number().int().positive(),
  reminderId: z.number().int().positive(),
  syncToCalendar: z.boolean().optional(),
});

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

const ActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_trip"), payload: CreateTripActionPayload }),
  z.object({ type: z.literal("add_wishlist"), payload: AddWishlistActionPayload }),
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
  z.object({ type: z.literal("cancel_trip"), payload: CancelTripActionPayload }),
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
  z.object({ type: z.literal("add_reminder"), payload: AddReminderActionPayload }),
  z.object({
    type: z.literal("sync_reminder_to_calendar"),
    payload: SyncReminderToCalendarActionPayload,
  }),
  z.object({
    type: z.literal("add_itinerary_day"),
    payload: AddItineraryDayActionPayload,
  }),
  z.object({
    type: z.literal("regenerate_itinerary_day"),
    payload: RegenerateItineraryDayActionPayload,
  }),
]);

type PendingAction = z.infer<typeof ActionBody>;
type ActionType = PendingAction["type"];

async function buildActionLabel(action: PendingAction): Promise<string> {
  switch (action.type) {
    case "create_trip":
      return `Create a trip to ${action.payload.destination}${
        action.payload.title && action.payload.title !== action.payload.destination
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
      return trip ? `Cancel your trip to ${trip.destination}` : `Cancel this trip`;
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

const ACTION_EXECUTORS: Record<ActionType, ActionExecutor> = {
  create_trip: (async (payload: z.infer<typeof CreateTripActionPayload>, userId: number) => {
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

  add_wishlist: (async (payload: z.infer<typeof AddWishlistActionPayload>, userId: number) => {
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
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    const existing =
      (trip.packingList as Array<{ item: string; packed: boolean }> | null) ?? [];
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
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
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
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
    if (!existing) return { status: 404, body: { error: "Trip not found" } };
    const updates: Partial<typeof travelsTrips.$inferInsert> = {};
    if (payload.destination !== undefined) updates.destination = payload.destination;
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

  cancel_trip: (async (payload: z.infer<typeof CancelTripActionPayload>, userId: number) => {
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
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

    await db.delete(travelsTripPhotos).where(eq(travelsTripPhotos.tripId, payload.tripId));
    await db
      .delete(travelsTripDocuments)
      .where(eq(travelsTripDocuments.tripId, payload.tripId));
    await db.delete(travelsReminders).where(eq(travelsReminders.tripId, payload.tripId));
    await db.delete(travelsTrips).where(eq(travelsTrips.id, payload.tripId));

    return { status: 200, body: { type: "cancel_trip", result: { id: payload.tripId } } };
  }) as ActionExecutor,

  mark_wishlist_done: (async (
    payload: z.infer<typeof MarkWishlistDoneActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(
        and(eq(travelsWishlist.id, payload.wishlistId), eq(travelsWishlist.userId, userId)),
      );
    if (!existing) return { status: 404, body: { error: "Wishlist item not found" } };
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
        and(eq(travelsWishlist.id, payload.wishlistId), eq(travelsWishlist.userId, userId)),
      );
    if (!existing) return { status: 404, body: { error: "Wishlist item not found" } };
    await db.delete(travelsWishlist).where(eq(travelsWishlist.id, payload.wishlistId));
    return {
      status: 200,
      body: { type: "remove_wishlist_item", result: { id: payload.wishlistId } },
    };
  }) as ActionExecutor,

  remove_packing_item: (async (
    payload: z.infer<typeof RemovePackingItemActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };
    const existingList =
      (trip.packingList as Array<{ item: string; packed: boolean }> | null) ?? [];
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

  add_reminder: (async (payload: z.infer<typeof AddReminderActionPayload>, userId: number) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, title: travelsTrips.title })
      .from(travelsTrips)
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
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
        recipientEmails: [],
        syncToCalendar,
      })
      .returning();

    if (syncToCalendar && row.dueDate) {
      const targetUserIds = await getConnectedTargetUserIds(userId, row.recipientEmails);
      await syncReminderCalendarEvents(row.id, trip.title, row.title, row.dueDate, targetUserIds);
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
    const targetUserIds = syncToCalendar
      ? await getConnectedTargetUserIds(row.userId, row.recipientEmails)
      : [];
    await syncReminderCalendarEvents(
      row.id,
      trip?.title ?? "Trip",
      row.title,
      row.dueDate,
      targetUserIds,
    );

    return { status: 200, body: { type: "sync_reminder_to_calendar", result: row } };
  }) as ActionExecutor,

  add_itinerary_day: (async (
    payload: z.infer<typeof AddItineraryDayActionPayload>,
    userId: number,
  ) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, itinerary: travelsTrips.itinerary })
      .from(travelsTrips)
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const existing =
      (trip.itinerary as { days: Array<Record<string, unknown>> } | null)?.days ?? [];
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
      .where(and(eq(travelsTrips.id, payload.tripId), eq(travelsTrips.userId, userId)));
    if (!trip) return { status: 404, body: { error: "Trip not found" } };

    const dayIndex = payload.dayNumber - 1;
    try {
      const itinerary = await generateItineraryForTrip(
        payload.tripId,
        "balanced",
        ["food", "history", "culture"],
        dayIndex,
      );
      return { status: 200, body: { type: "regenerate_itinerary_day", result: { itinerary } } };
    } catch (err) {
      if (err instanceof ItineraryActionError) {
        return { status: err.status, body: { error: err.message } };
      }
      throw err;
    }
  }) as ActionExecutor,
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
        "Propose creating a new trip. Ask permission in your reply's visible text first (e.g. \"Want me to create a trip to Rome for August?\"), then call this.",
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
        'Propose editing a trip\'s destination, dates, and/or notes, e.g. "push my Rome trip back a week" or "add a note that we\'re flying instead of driving". Not for status changes (use update_trip_status). Include only the field(s) that actually change; you must include at least one. Only call this if the trip\'s numeric id is visible on screen; never guess an id, and never guess new dates the user didn\'t specify — compute exact dates from what you can see on screen, or ask instead of guessing.',
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
        "Propose permanently deleting a trip and everything attached to it (photos, documents, reminders). Only call this if the trip's numeric id is visible on screen; never guess an id. Since this is destructive, your visible reply text must clearly say it will DELETE the trip, not just \"cancel\" it ambiguously.",
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
        'Propose creating a new reminder for a trip, e.g. "remind me to check in for our flight" or "remind me to book the hotel by Friday". Only call this if the trip\'s numeric id is visible on screen; never guess an id — offer to open the trip instead if you don\'t have one. If the user gives (or you can see on screen) a specific date the reminder is about, set dueDate to that exact date; never invent a date. syncToCalendar defaults to true (syncs to the family Google Calendar automatically if connected) — only set it to false if the user explicitly asks not to add it to the calendar.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          title: { type: "string", description: "Short reminder title" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
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
      name: "add_itinerary_day",
      description:
        'Propose adding a new day to a trip\'s itinerary, e.g. "add a day trip to Kyoto on the 14th". Only call this if the trip\'s numeric id is visible on screen; never guess an id — offer to open the trip instead if you don\'t have one. Use the exact date the user gave (YYYY-MM-DD) if known; never invent a date. Optionally include a single starting activity if the user described one.',
      parameters: {
        type: "object",
        properties: {
          tripId: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD, if known" },
          title: { type: "string", description: "Short theme/title for the day" },
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
          dayNumber: { type: "integer", description: "1-based day number as shown on screen" },
        },
        required: ["tripId", "dayNumber"],
      },
    },
  },
];

const NAVIGATE_TOOL_NAME = "suggest_navigation";
const REMEMBER_TOOL_NAME = "remember_household_fact";

const NAVIGATE_ALLOWED_PATHS = [
  "/",
  "/trips",
  "/map",
  "/explore",
  "/wishlist",
  "/import",
  "/destinations",
  "/settings",
] as const;
// "/trips/:id" is also allowed with a concrete numeric id, e.g. "/trips/42".
const NAVIGATE_PATH_RE = /^\/(trips\/\d+|trips|map|explore|wishlist|import|destinations|settings)?$/;

const NavigateToolPayload = z.object({
  path: z.string().max(50).regex(NAVIGATE_PATH_RE, "not an allowed in-app path"),
  reason: z.string().min(1).max(300),
});

const RememberToolPayload = z.object({
  content: z.string().min(1).max(2000),
});

const SET_MODE_TOOL_NAME = "set_action_confirmation_mode";

const SetModeToolPayload = z.object({
  mode: z.enum(ACTION_CONFIRMATION_MODES),
});

const SOFT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: NAVIGATE_TOOL_NAME,
      description:
        'Suggest moving the user to another screen. You are never allowed to navigate them yourself — the UI only offers a button, the user must click it. First ASK in plain language in your visible reply (e.g. "Want me to open your Wishlist so you can add that?"). Only call this if you actually just asked permission in your visible text, and never for the page the user is already on.',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: [...NAVIGATE_ALLOWED_PATHS, "/trips/{id}"],
            description:
              'One of the listed static paths, or "/trips/{id}" with a real numeric id substituted in, e.g. "/trips/42".',
          },
          reason: { type: "string", description: "Short reason shown to the user" },
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
              'one_by_one = confirm each proposed action individually before the next is shown (default, safest). all_at_once = show every proposed action together with one Confirm all / Cancel all. auto_run = execute proposed actions immediately with no confirmation and report back afterward.',
          },
        },
        required: ["mode"],
      },
    },
  },
];

const ACTION_TOOL_NAMES = new Set<string>(
  ACTION_TOOLS.map((t) => (t as OpenAI.Chat.Completions.ChatCompletionFunctionTool).function.name),
);

async function getOrCreateConversation(userId: number) {
  const [existing] = await db
    .select()
    .from(travelsAssistantConversations)
    .where(eq(travelsAssistantConversations.userId, userId));
  if (existing) return existing;

  const [created] = await db
    .insert(travelsAssistantConversations)
    .values({ userId, messages: [] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with another request — read the row that won.
  const [row] = await db
    .select()
    .from(travelsAssistantConversations)
    .where(eq(travelsAssistantConversations.userId, userId));
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
async function tryBuildAction(name: string, argsBuffer: string): Promise<ProposedAction | null> {
  if (!ACTION_TOOL_NAMES.has(name)) return null;
  try {
    const parsedPayload: unknown = JSON.parse(argsBuffer);
    const parsedAction = ActionBody.safeParse({ type: name, payload: parsedPayload });
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

router.get("/assistant/conversation", async (req, res) => {
  const userId = req.session.userId!;
  const conversation = await getOrCreateConversation(userId);
  res.json({
    messages: (conversation?.messages as ChatMessage[] | null) ?? [],
  });
});

router.delete("/assistant/conversation", async (req, res) => {
  const userId = req.session.userId!;
  await getOrCreateConversation(userId);
  await db
    .update(travelsAssistantConversations)
    .set({ messages: [], updatedAt: new Date() })
    .where(eq(travelsAssistantConversations.userId, userId));
  res.json({ messages: [] });
});

router.post("/assistant/chat", async (req, res) => {
  const userId = req.session.userId!;
  const { message, pageContext } = ChatBody.parse(req.body);

  const [user] = await db
    .select({ displayName: appUsers.displayName, email: appUsers.email })
    .from(appUsers)
    .where(eq(appUsers.id, userId));
  const userName = user?.displayName || user?.email || "there";

  const conversation = await getOrCreateConversation(userId);
  const history = (conversation?.messages as ChatMessage[] | null) ?? [];

  const memoryRows = await db
    .select({ content: travelsHouseholdMemory.content })
    .from(travelsHouseholdMemory)
    .orderBy(desc(travelsHouseholdMemory.createdAt))
    .limit(50);
  const memoryBlock =
    memoryRows.length > 0
      ? memoryRows.map((m) => `- ${m.content}`).join("\n")
      : "(nothing remembered yet)";

  const [settingsRow] = await db
    .select({ actionConfirmationMode: travelsAssistantSettings.actionConfirmationMode })
    .from(travelsAssistantSettings)
    .where(eq(travelsAssistantSettings.userId, userId));
  const actionConfirmationMode: ActionConfirmationMode =
    (settingsRow?.actionConfirmationMode as ActionConfirmationMode | undefined) ?? "one_by_one";

  const CONFIRMATION_MODE_EXPLANATION: Record<ActionConfirmationMode, string> = {
    one_by_one:
      'one_by_one — the user reviews and confirms/skips each proposed action individually, one at a time.',
    all_at_once:
      'all_at_once — the user sees every proposed action from this turn together and confirms or cancels them as a group.',
    auto_run:
      'auto_run — proposed actions run immediately with no confirmation step; you should report what you did (or if something failed) after the fact.',
  };

  const systemPrompt = `You are elAIne, a warm, personable AI assistant built into a family travel-planning app. You are talking with ${userName}.

PERSONALITY: You're conversational, upbeat, and genuinely helpful — like a well-traveled friend, not a generic corporate assistant. You can be a little playful. You still give concrete, accurate, step-by-step help when asked.

WHAT YOU CAN SEE RIGHT NOW (live, possibly unsaved, on-screen state):
${pageContext ? pageContext : "(no page context was shared for this screen)"}

SHARED FAMILY MEMORY (facts you've picked up from any family member — treat as true for the whole household, not just the person asking):
${memoryBlock}

TOOLS: You have tools available for navigation suggestions, remembering household facts, and proposing changes to trips/wishlist/packing lists/reminders. Each tool's own description explains exactly when and how to use it — follow those rules precisely, especially around never fabricating numeric ids and asking permission in your visible reply text before calling any trip/wishlist/packing/reminder tool. If a single request naturally involves more than one write-action (e.g. "add a reminder to book the hotel and add wine tasting to the wishlist"), call all of the relevant action tools in that same turn — don't limit yourself to one. Just make sure your visible reply names everything you're about to do before you call the tools, so nothing is a surprise. Navigation suggestions and remembering a fact can always accompany action tools.

CONFIRMATION MODE: This user's current mode for confirming proposed actions is "${actionConfirmationMode}" — ${CONFIRMATION_MODE_EXPLANATION[actionConfirmationMode]} The three modes are: ${Object.values(CONFIRMATION_MODE_EXPLANATION).join(" | ")} If the user asks how you confirm actions, or asks to change it (e.g. "just do it automatically", "ask me one at a time", "show me everything together"), explain the modes in your visible reply and call ${SET_MODE_TOOL_NAME} once they've decided — never call it just to describe the options. Mention that they can also change this anytime from Settings.

REMINDERS: Use add_reminder for requests like "remind me to check in for our flight" or "remind me to book the hotel by Friday" — it creates a new reminder and syncs it to the calendar by default. Use sync_reminder_to_calendar only to toggle calendar sync on or off for a reminder that already exists and whose numeric id you can see on screen (look for "reminderId: <number>" in the reminders listed for the current trip); never use it to create a reminder.

ITINERARY: Use add_itinerary_day for requests like "add a day trip to Kyoto on the 14th" — it appends a brand-new day to the trip's itinerary. Use regenerate_itinerary_day for requests like "regenerate day 3" or "come up with a new plan for that day" — it re-runs AI planning for ONE existing day and replaces its activities, using balanced-pace, general-interest defaults since it can't see any per-session style/interest picks the user made in the UI. Only use regenerate_itinerary_day on a day number you can see listed on screen (e.g. "Day 3"); never guess a day number, and never use it to create a new day (use add_itinerary_day for that).

Keep replies concise and easy to read in a chat bubble.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
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
  // Proposed (not-yet-executed) actions for one_by_one / all_at_once modes,
  // in the order the model produced them.
  const resolvedActions: ProposedAction[] = [];
  // Indices already turned into a proposed action, so the post-stream pass
  // doesn't double-send one already caught mid-stream. Only used outside
  // auto_run, since auto_run never sends a proposal — it executes instead.
  const sentActionIndices = new Set<number>();
  // Accumulates streamed tool-call fragments by their index. `arguments`
  // arrives as growing string fragments across multiple chunks — this is
  // the standard OpenAI/OpenRouter streaming tool-call shape.
  const toolCallAcc = new Map<number, { name: string; args: string }>();

  try {
    await callModelWithSubagent(
      MODELS.FAST_VISION,
      ASSISTANT_SUBAGENT_INSTRUCTIONS,
      async (client, model, serverTools) => {
        const stream = await client.chat.completions.create({
          model,
          tools: [
            ...(serverTools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[]),
            ...ACTION_TOOLS,
            ...SOFT_TOOLS,
          ],
          messages,
          max_tokens: 700,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            rawContent += delta.content;
            sendEvent("delta", { text: delta.content });
          }

          for (const tc of delta.tool_calls ?? []) {
            const acc = toolCallAcc.get(tc.index) ?? { name: "", args: "" };
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
  const content = rawContent.trim();
  let navigate: { path: string; reason: string } | null = null;
  let updatedActionConfirmationMode: ActionConfirmationMode | null = null;
  const executedActions: Array<ProposedAction & { status: number; result: unknown }> = [];

  for (const [index, { name, args }] of toolCallAcc.entries()) {
    if (name === REMEMBER_TOOL_NAME) {
      try {
        const parsed = RememberToolPayload.safeParse(JSON.parse(args));
        if (parsed.success) {
          await db
            .insert(travelsHouseholdMemory)
            .values({ content: parsed.data.content, createdByUserId: userId });
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
            .insert(travelsAssistantSettings)
            .values({ userId, actionConfirmationMode: parsed.data.mode })
            .onConflictDoUpdate({
              target: travelsAssistantSettings.userId,
              set: { actionConfirmationMode: parsed.data.mode, updatedAt: new Date() },
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
        const parsed = NavigateToolPayload.safeParse(JSON.parse(args));
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
      const { status, body } = await executor(finalAction.payload as never, userId);
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

  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: "user", content: message },
    { role: "assistant", content },
  ];

  await db
    .update(travelsAssistantConversations)
    .set({ messages: updatedHistory, updatedAt: new Date() })
    .where(eq(travelsAssistantConversations.userId, userId));

  sendEvent("done", {
    role: "assistant",
    content,
    navigate,
    actions: resolvedActions,
    executedActions,
    actionConfirmationMode: updatedActionConfirmationMode ?? actionConfirmationMode,
    messages: updatedHistory,
  });
  res.end();
});

// Executes a write-action elAIne proposed in chat, only once the user has
// explicitly confirmed it in the UI. Every write here is scoped to the
// calling user the same way the equivalent hand-written routes are.
router.post("/assistant/action", async (req, res) => {
  const userId = req.session.userId!;
  const action = ActionBody.parse(req.body);
  const executor = ACTION_EXECUTORS[action.type];
  const { status, body } = await executor(action.payload as never, userId);
  res.status(status).json(body);
});

router.get("/assistant/settings", async (req, res) => {
  const userId = req.session.userId!;
  const [row] = await db
    .select()
    .from(travelsAssistantSettings)
    .where(eq(travelsAssistantSettings.userId, userId));
  res.json({
    enabled: row?.enabled ?? true,
    actionConfirmationMode:
      (row?.actionConfirmationMode as ActionConfirmationMode | undefined) ?? "one_by_one",
  });
});

router.put("/assistant/settings", async (req, res) => {
  const userId = req.session.userId!;
  const patch = SettingsBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(travelsAssistantSettings)
    .where(eq(travelsAssistantSettings.userId, userId));
  const enabled = patch.enabled ?? existing?.enabled ?? true;
  const actionConfirmationMode =
    patch.actionConfirmationMode ??
    (existing?.actionConfirmationMode as ActionConfirmationMode | undefined) ??
    "one_by_one";
  await db
    .insert(travelsAssistantSettings)
    .values({ userId, enabled, actionConfirmationMode })
    .onConflictDoUpdate({
      target: travelsAssistantSettings.userId,
      set: { enabled, actionConfirmationMode, updatedAt: new Date() },
    });
  res.json({ enabled, actionConfirmationMode });
});

router.get("/assistant/memory", async (_req, res) => {
  const rows = await db
    .select({
      id: travelsHouseholdMemory.id,
      content: travelsHouseholdMemory.content,
      createdAt: travelsHouseholdMemory.createdAt,
      createdByUserId: travelsHouseholdMemory.createdByUserId,
    })
    .from(travelsHouseholdMemory)
    .orderBy(desc(travelsHouseholdMemory.createdAt));
  res.json(rows);
});

router.delete("/assistant/memory/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: travelsHouseholdMemory.id })
    .from(travelsHouseholdMemory)
    .where(eq(travelsHouseholdMemory.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(travelsHouseholdMemory).where(eq(travelsHouseholdMemory.id, id));
  res.status(204).end();
});

export default router;
