import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq, desc } from "drizzle-orm";
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

const SettingsBody = z.object({
  enabled: z.boolean(),
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

  add_packing_item: (async (payload: z.infer<typeof AddPackingItemActionPayload>) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
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

  update_trip_status: (async (payload: z.infer<typeof UpdateTripStatusActionPayload>) => {
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

  update_trip_details: (async (payload: z.infer<typeof UpdateTripDetailsActionPayload>) => {
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
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

  cancel_trip: (async (payload: z.infer<typeof CancelTripActionPayload>) => {
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

    await db.delete(travelsTripPhotos).where(eq(travelsTripPhotos.tripId, payload.tripId));
    await db
      .delete(travelsTripDocuments)
      .where(eq(travelsTripDocuments.tripId, payload.tripId));
    await db.delete(travelsReminders).where(eq(travelsReminders.tripId, payload.tripId));
    await db.delete(travelsTrips).where(eq(travelsTrips.id, payload.tripId));

    return { status: 200, body: { type: "cancel_trip", result: { id: payload.tripId } } };
  }) as ActionExecutor,

  mark_wishlist_done: (async (payload: z.infer<typeof MarkWishlistDoneActionPayload>) => {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing) return { status: 404, body: { error: "Wishlist item not found" } };
    const [row] = await db
      .update(travelsWishlist)
      .set({ done: payload.done ?? true })
      .where(eq(travelsWishlist.id, payload.wishlistId))
      .returning();
    return { status: 200, body: { type: "mark_wishlist_done", result: row } };
  }) as ActionExecutor,

  remove_wishlist_item: (async (payload: z.infer<typeof RemoveWishlistItemActionPayload>) => {
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing) return { status: 404, body: { error: "Wishlist item not found" } };
    await db.delete(travelsWishlist).where(eq(travelsWishlist.id, payload.wishlistId));
    return {
      status: 200,
      body: { type: "remove_wishlist_item", result: { id: payload.wishlistId } },
    };
  }) as ActionExecutor,

  remove_packing_item: (async (payload: z.infer<typeof RemovePackingItemActionPayload>) => {
    const [trip] = await db
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
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

  const systemPrompt = `You are elAIne, a warm, personable AI assistant built into a family travel-planning app. You are talking with ${userName}.

PERSONALITY: You're conversational, upbeat, and genuinely helpful — like a well-traveled friend, not a generic corporate assistant. You can be a little playful. You still give concrete, accurate, step-by-step help when asked.

WHAT YOU CAN SEE RIGHT NOW (live, possibly unsaved, on-screen state):
${pageContext ? pageContext : "(no page context was shared for this screen)"}

SHARED FAMILY MEMORY (facts you've picked up from any family member — treat as true for the whole household, not just the person asking):
${memoryBlock}

TOOLS: You have tools available for navigation suggestions, remembering household facts, and proposing changes to trips/wishlist/packing lists/reminders. Each tool's own description explains exactly when and how to use it — follow those rules precisely, especially around never fabricating numeric ids and asking permission in your visible reply text before calling any trip/wishlist/packing/reminder tool. Prefer calling at most one write-action tool per turn so the user isn't asked to confirm several things at once; navigation suggestions and remembering a fact can still accompany it.

REMINDERS: Use add_reminder for requests like "remind me to check in for our flight" or "remind me to book the hotel by Friday" — it creates a new reminder and syncs it to the calendar by default. Use sync_reminder_to_calendar only to toggle calendar sync on or off for a reminder that already exists and whose numeric id you can see on screen (look for "reminderId: <number>" in the reminders listed for the current trip); never use it to create a reminder.

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
  let actionSent = false;
  let resolvedAction: ProposedAction | null = null;
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

            if (!actionSent && ACTION_TOOL_NAMES.has(acc.name)) {
              const early = await tryBuildAction(acc.name, acc.args);
              if (early) {
                sendEvent("action", early);
                actionSent = true;
                resolvedAction = early;
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

  for (const { name, args } of toolCallAcc.values()) {
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

    if (!actionSent && ACTION_TOOL_NAMES.has(name)) {
      const finalAction = await tryBuildAction(name, args);
      if (finalAction) {
        sendEvent("action", finalAction);
        actionSent = true;
        resolvedAction = finalAction;
      }
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
    action: resolvedAction,
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
  res.json({ enabled: row?.enabled ?? true });
});

router.put("/assistant/settings", async (req, res) => {
  const userId = req.session.userId!;
  const { enabled } = SettingsBody.parse(req.body);
  await db
    .insert(travelsAssistantSettings)
    .values({ userId, enabled })
    .onConflictDoUpdate({
      target: travelsAssistantSettings.userId,
      set: { enabled, updatedAt: new Date() },
    });
  res.json({ enabled });
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

export default router;
