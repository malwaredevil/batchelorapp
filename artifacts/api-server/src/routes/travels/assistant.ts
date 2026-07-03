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

function extractDirectives(raw: string): {
  content: string;
  navigate: { path: string; reason: string } | null;
  remember: string | null;
} {
  let content = raw;
  let navigate: { path: string; reason: string } | null = null;
  let remember: string | null = null;

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

  return { content, navigate, remember };
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

  const { content, navigate, remember } = extractDirectives(rawContent);

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

  res.json({ role: "assistant", content, navigate, messages: updatedHistory });
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
