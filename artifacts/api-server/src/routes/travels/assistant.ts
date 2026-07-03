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
  travelsWishlist,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { callModelWithSubagent, MODELS } from "../../lib/ai-client";

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

const ActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_trip"), payload: CreateTripActionPayload }),
  z.object({ type: z.literal("add_wishlist"), payload: AddWishlistActionPayload }),
  z.object({
    type: z.literal("add_packing_item"),
    payload: AddPackingItemActionPayload,
  }),
]);

type PendingAction = z.infer<typeof ActionBody>;

function buildActionLabel(action: PendingAction): string {
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

function extractDirectives(raw: string): {
  content: string;
  navigate: { path: string; reason: string } | null;
  remember: string | null;
  action: { type: string; label: string; payload: unknown } | null;
} {
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
    content = content.replace(ACTION_RE, "").trim();
    try {
      const parsedPayload: unknown = JSON.parse(actionMatch[2]);
      const parsedAction = ActionBody.safeParse({
        type: actionMatch[1],
        payload: parsedPayload,
      });
      if (parsedAction.success) {
        action = {
          type: parsedAction.data.type,
          label: buildActionLabel(parsedAction.data),
          payload: parsedAction.data.payload,
        };
      }
      // If validation fails, we silently drop the action rather than
      // surfacing a malformed/unsafe write-action to the confirmation UI.
    } catch {
      // Malformed JSON from the model — drop the action, keep the reply text.
    }
  }

  return { content, navigate, remember, action };
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
Never include an ACTION line unless you just asked permission in your reply's visible text, and never fabricate ids or facts not given to you.

Keep replies concise and easy to read in a chat bubble.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  const rawContent = await callModelWithSubagent(
    MODELS.FAST_VISION,
    ASSISTANT_SUBAGENT_INSTRUCTIONS,
    async (client, model, tools) => {
      const response = await client.chat.completions.create({
        model,
        ...(tools ? { tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
        messages,
        max_tokens: 700,
      });
      return response.choices[0]?.message?.content ?? "";
    },
  );

  const { content, navigate, remember, action } = extractDirectives(rawContent);

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

  res.json({ role: "assistant", content, navigate, action, messages: updatedHistory });
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

  // add_packing_item
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
