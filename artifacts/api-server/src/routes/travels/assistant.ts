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

const router: IRouter = Router();
router.use(requireAuth);

// elAIne is a single persistent, personable assistant that follows the user
// across every page of the Travels app (replaces the old per-trip chat).
// She is given: (1) whatever is live on the user's current screen, including
// unsaved input, (2) shared household memory from every family member, and
// (3) two tool-like affordances handled as structured JSON directives rather
// than real function-calling, since the executing model here is a fast/cheap
// chat model: suggesting navigation (never auto-followed) and remembering a
// new household fact.

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

// Payload schemas for the write-actions elAIne can propose. Kept intentionally
// small (a subset of the full create schemas) since elAIne proposes these
// from a short chat exchange, not a full form.
const CreateTripActionPayload = z.object({
  title: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  status: z
    .enum(["wishlist", "planning", "booked", "active", "completed"])
    .optional(),
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
  status: z.enum(["wishlist", "planning", "booked", "active", "completed"]),
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
]);

type PendingAction = z.infer<typeof ActionBody>;

// Looks up a trip's title/destination so confirmation labels can name the
// record instead of saying "this trip". Returns null if the trip can't be
// found (e.g. already deleted) so callers can fall back to a generic label.
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
  }
}

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

// Very lightweight structured directives the model can emit at the END of
// its reply, on their own line, which we strip out before showing the
// message to the user. Kept intentionally simple (no real tool-calling loop)
// since elAIne runs on a fast chat model tuned for low latency.
const NAVIGATE_RE = /\[\[NAVIGATE:\s*(\/[a-zA-Z0-9/_-]*)\s*\|\s*([^\]]+)\]\]/;
const REMEMBER_RE = /\[\[REMEMBER:\s*([^\]]+)\]\]/;
const ACTION_RE = /\[\[ACTION:\s*(\w+)\s*\|\s*(\{[^{}]*\})\s*\]\]/;

async function extractDirectives(raw: string): Promise<{
  content: string;
  navigate: { path: string; reason: string } | null;
  remember: string | null;
  action: { type: string; label: string; payload: unknown } | null;
}> {
  let content = raw;
  let navigate: { path: string; reason: string } | null = null;
  let remember: string | null = null;
  let action: { type: string; label: string; payload: unknown } | null = null;

  const navMatch = content.match(NAVIGATE_RE);
  if (navMatch) {
    navigate = { path: navMatch[1], reason: navMatch[2].trim() };
    content = content.replace(NAVIGATE_RE, "").trim();
  }

  const rememberMatch = content.match(REMEMBER_RE);
  if (rememberMatch) {
    remember = rememberMatch[1].trim();
    content = content.replace(REMEMBER_RE, "").trim();
  }

  const actionMatch = content.match(ACTION_RE);
  if (actionMatch) {
    action = await tryExtractAction(content);
    content = content.replace(ACTION_RE, "").trim();
  }

  return { content, navigate, remember, action };
}

// Attempts to pull a fully-formed [[ACTION: ...]] directive out of a (possibly
// still-growing, mid-stream) content buffer. Returns null until the closing
// `]]` has actually arrived — ACTION_RE requires it — so this is also what
// lets the streaming chat route detect the directive "as soon as it's fully
// received" rather than guessing from a partial JSON payload.
async function tryExtractAction(
  content: string,
): Promise<{ type: string; label: string; payload: unknown } | null> {
  const actionMatch = content.match(ACTION_RE);
  if (!actionMatch) return null;
  try {
    const parsedPayload: unknown = JSON.parse(actionMatch[2]);
    const parsedAction = ActionBody.safeParse({
      type: actionMatch[1],
      payload: parsedPayload,
    });
    if (parsedAction.success) {
      return {
        type: parsedAction.data.type,
        label: await buildActionLabel(parsedAction.data),
        payload: parsedAction.data.payload,
      };
    }
    // If validation fails, we silently drop the action rather than
    // surfacing a malformed/unsafe write-action to the confirmation UI.
  } catch {
    // Malformed JSON from the model — drop the action, keep the reply text.
  }
  return null;
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

NAVIGATION: You are never allowed to move the user to another screen yourself. If going somewhere else in the app would genuinely help (e.g. opening the Wishlist to add something, or a specific trip's page), first ASK in plain language ("Want me to open your Wishlist so you can add that?"). Only if it clearly helps, append this exact machine-readable line as the LAST line of your reply, on its own line, with a real in-app path from this list: /, /trips, /trips/:id, /map, /explore, /wishlist, /import, /destinations, /settings:
[[NAVIGATE: /path | short reason]]
Never include this line unless you actually just asked permission in your reply's visible text. Never include it for the page the user is already on.

REMEMBERING: If the user shares a fact worth remembering for the whole household later (a preference, a recurring detail, something another family member would want to know), append this exact line as the LAST line of your reply (after any NAVIGATE line):
[[REMEMBER: the fact, written plainly]]
Only do this for genuinely durable, household-relevant facts — not small talk, not one-off questions.

TAKING ACTION: You can propose making an actual change for the user — you never make the change yourself, the user always has to press a confirm button first. When the user clearly asks you to do one of the following, first briefly confirm in plain language what you're about to do (e.g. "Want me to create a trip to Rome for August?"), then append this exact machine-readable line as the LAST line of your reply (after any NAVIGATE/REMEMBER lines), with compact single-line JSON and no comments:
[[ACTION: <type> | {"...":"..."}]]
Only ever emit ONE action line per reply. Valid types and their JSON payload shape:
- create_trip: {"title": string, "destination": string, "status"?: "wishlist"|"planning"|"booked"|"active"|"completed", "startDate"?: "YYYY-MM-DD", "endDate"?: "YYYY-MM-DD", "notes"?: string}
- add_wishlist: {"destination": string, "targetDate"?: "YYYY-MM-DD", "notes"?: string}
- add_packing_item: {"tripId": number, "item": string} — only use this if you can see a specific trip's numeric id in the on-screen state above (look for "tripId: <number>"); never guess an id, and never use this type if no trip id is visible — offer to open the trip instead.
- update_trip_status: {"tripId": number, "status": "wishlist"|"planning"|"booked"|"active"|"completed"} — move a trip to a different stage, e.g. "mark my Tokyo trip as booked". Only use this if the trip's numeric id is visible in the on-screen state above; never guess an id.
- update_trip_details: {"tripId": number, "destination"?: string, "startDate"?: "YYYY-MM-DD", "endDate"?: "YYYY-MM-DD", "notes"?: string} — edit a trip's dates, destination, and/or notes, e.g. "push my Rome trip back a week" or "add a note that we're flying instead of driving". Only use this for these specific fields, not status (use update_trip_status for that). Include only the field(s) that actually change; you must include at least one. Only use this if the trip's numeric id is visible in the on-screen state above; never guess an id, and never guess new dates the user didn't specify (ask them for the exact new date if it's ambiguous, e.g. "a week later" — compute it from the date you can see on screen instead of guessing).
- cancel_trip: {"tripId": number} — permanently deletes a trip and everything attached to it (photos, documents, reminders). Only use this if the trip's numeric id is visible in the on-screen state above; never guess an id. Since this is destructive, make sure your confirmation text in the reply clearly says it will delete the trip, not just "cancel" it ambiguously.
- mark_wishlist_done: {"wishlistId": number, "done"?: boolean} — marks a wishlist item done (or not done if done is explicitly false). Only use this if the wishlist item's numeric id is visible in the on-screen state above; never guess an id.
- remove_wishlist_item: {"wishlistId": number} — permanently deletes a wishlist item. Only use this if the wishlist item's numeric id is visible in the on-screen state above; never guess an id.
- remove_packing_item: {"tripId": number, "item": string} — removes an existing item from a trip's packing list by name. Only use this if the trip's numeric id is visible in the on-screen state above; never guess an id, and use the exact item text as it appears on screen.
Never include an ACTION line unless you just asked permission in your reply's visible text, and never fabricate ids or facts not given to you.

Keep replies concise and easy to read in a chat bubble.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  // Streamed as Server-Sent Events so the client can show elAIne's reply (and
  // a proposed [[ACTION: ...]] directive) building up incrementally instead
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

  try {
    await callModelWithSubagent(
      MODELS.FAST_VISION,
      ASSISTANT_SUBAGENT_INSTRUCTIONS,
      async (client, model, tools) => {
        const stream = await client.chat.completions.create({
          model,
          ...(tools
            ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] }
            : {}),
          messages,
          max_tokens: 700,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (!delta) continue;
          rawContent += delta;
          sendEvent("delta", { text: delta });

          if (!actionSent) {
            const action = await tryExtractAction(rawContent);
            if (action) {
              sendEvent("action", action);
              actionSent = true;
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

  const { content, navigate, remember, action } = await extractDirectives(rawContent);

  if (remember) {
    await db
      .insert(travelsHouseholdMemory)
      .values({ content: remember, createdByUserId: userId });
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

  sendEvent("done", { role: "assistant", content, navigate, action, messages: updatedHistory });
  res.end();
});

// Executes a write-action elAIne proposed in chat, only once the user has
// explicitly confirmed it in the UI. Every write here is scoped to the
// calling user the same way the equivalent hand-written routes are.
router.post("/assistant/action", async (req, res) => {
  const userId = req.session.userId!;
  const action = ActionBody.parse(req.body);

  if (action.type === "create_trip") {
    const { payload } = action;
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
    res.status(201).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "add_wishlist") {
    const { payload } = action;
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
    res.status(201).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "add_packing_item") {
    const { payload } = action;
    const [trip] = await db
      .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const existing =
      (trip.packingList as Array<{ item: string; packed: boolean }> | null) ?? [];
    const updatedList = [...existing, { item: payload.item, packed: false }];
    const [row] = await db
      .update(travelsTrips)
      .set({ packingList: updatedList })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    res.status(200).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "update_trip_status") {
    const { payload } = action;
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const [row] = await db
      .update(travelsTrips)
      .set({ status: payload.status })
      .where(eq(travelsTrips.id, payload.tripId))
      .returning();
    res.status(200).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "update_trip_details") {
    const { payload } = action;
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
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
    res.status(200).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "cancel_trip") {
    const { payload } = action;
    const [existing] = await db
      .select({ id: travelsTrips.id })
      .from(travelsTrips)
      .where(eq(travelsTrips.id, payload.tripId));
    if (!existing) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

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

    res.status(200).json({ type: action.type, result: { id: payload.tripId } });
    return;
  }

  if (action.type === "mark_wishlist_done") {
    const { payload } = action;
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing) {
      res.status(404).json({ error: "Wishlist item not found" });
      return;
    }
    const [row] = await db
      .update(travelsWishlist)
      .set({ done: payload.done ?? true })
      .where(eq(travelsWishlist.id, payload.wishlistId))
      .returning();
    res.status(200).json({ type: action.type, result: row });
    return;
  }

  if (action.type === "remove_wishlist_item") {
    const { payload } = action;
    const [existing] = await db
      .select({ id: travelsWishlist.id })
      .from(travelsWishlist)
      .where(eq(travelsWishlist.id, payload.wishlistId));
    if (!existing) {
      res.status(404).json({ error: "Wishlist item not found" });
      return;
    }
    await db.delete(travelsWishlist).where(eq(travelsWishlist.id, payload.wishlistId));
    res.status(200).json({ type: action.type, result: { id: payload.wishlistId } });
    return;
  }

  // remove_packing_item
  const { payload } = action;
  const [trip] = await db
    .select({ id: travelsTrips.id, packingList: travelsTrips.packingList })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, payload.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
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
  res.status(200).json({ type: action.type, result: row });
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

router.delete("/assistant/memory/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(travelsHouseholdMemory).where(eq(travelsHouseholdMemory.id, id));
  res.status(204).end();
});

export default router;
