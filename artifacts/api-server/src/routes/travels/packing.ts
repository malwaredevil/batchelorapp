import { Router, type IRouter } from "express";
import { eq, asc, and, max } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  travelsTrips,
  travelsPackingLists,
  travelsPackingItems,
  travelsPackingTemplates,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { getModels, getOpenRouterClient } from "../../lib/ai-client";
import { logger } from "../../lib/logger";
import { getConfig } from "../../lib/app-config";

const router: IRouter = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateList(
  tripId: number,
): Promise<{ id: number; tripId: number; name: string; createdAt: Date }> {
  const [existing] = await db
    .select()
    .from(travelsPackingLists)
    .where(eq(travelsPackingLists.tripId, tripId));
  if (existing) return existing;
  const [created] = await db
    .insert(travelsPackingLists)
    .values({ tripId })
    .returning();
  return created!;
}

async function tripExists(tripId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: travelsTrips.id })
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));
  return !!row;
}

// ── GET /trips/:tripId/packing ────────────────────────────────────────────────
// Returns the packing list (auto-created if it doesn't exist) with all items.

router.get("/trips/:tripId/packing", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const list = await getOrCreateList(tripId);
  const items = await db
    .select()
    .from(travelsPackingItems)
    .where(eq(travelsPackingItems.listId, list.id))
    .orderBy(
      asc(travelsPackingItems.sortOrder),
      asc(travelsPackingItems.createdAt),
    );
  res.json({ ...list, items });
});

// ── POST /trips/:tripId/packing/items ─────────────────────────────────────────

const CreateItemBody = z.object({
  text: z.string().min(1).max(500),
  sortOrder: z.number().int().optional(),
});

router.post("/trips/:tripId/packing/items", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const body = CreateItemBody.parse(req.body);
  const userId = req.session.userId!;
  const list = await getOrCreateList(tripId);

  // Default sortOrder = max existing + 1 so new items always append
  let nextOrder = body.sortOrder;
  if (nextOrder === undefined) {
    const [{ maxOrder }] = await db
      .select({ maxOrder: max(travelsPackingItems.sortOrder) })
      .from(travelsPackingItems)
      .where(eq(travelsPackingItems.listId, list.id));
    nextOrder = maxOrder != null ? maxOrder + 1 : 0;
  }

  const [item] = await db
    .insert(travelsPackingItems)
    .values({
      listId: list.id,
      text: body.text,
      sortOrder: nextOrder,
      addedByUserId: userId,
    })
    .returning();
  res.status(201).json(item);
});

// ── PATCH /trips/:tripId/packing/items/:itemId ────────────────────────────────

const UpdateItemBody = z.object({
  text: z.string().min(1).max(500).optional(),
  packed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

router.patch("/trips/:tripId/packing/items/:itemId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(tripId) || isNaN(itemId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const list = await db
    .select({ id: travelsPackingLists.id })
    .from(travelsPackingLists)
    .where(eq(travelsPackingLists.tripId, tripId));
  if (!list[0]) {
    res.status(404).json({ error: "Packing list not found" });
    return;
  }
  const body = UpdateItemBody.parse(req.body);
  const [updated] = await db
    .update(travelsPackingItems)
    .set(body)
    .where(
      and(
        eq(travelsPackingItems.id, itemId),
        eq(travelsPackingItems.listId, list[0].id),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(updated);
});

// ── DELETE /trips/:tripId/packing/items/:itemId ───────────────────────────────

router.delete("/trips/:tripId/packing/items/:itemId", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(tripId) || isNaN(itemId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [list] = await db
    .select({ id: travelsPackingLists.id })
    .from(travelsPackingLists)
    .where(eq(travelsPackingLists.tripId, tripId));
  if (!list) {
    res.status(404).json({ error: "Packing list not found" });
    return;
  }
  const result = await db
    .delete(travelsPackingItems)
    .where(
      and(
        eq(travelsPackingItems.id, itemId),
        eq(travelsPackingItems.listId, list.id),
      ),
    )
    .returning({ id: travelsPackingItems.id });
  if (!result[0]) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.status(204).send();
});

// ── POST /trips/:tripId/packing/items/bulk ────────────────────────────────────
// Insert multiple items at once (used by load-template and AI generate).

const BulkCreateBody = z.object({
  items: z
    .array(z.object({ text: z.string().min(1).max(500) }))
    .min(1)
    .max(100),
});

router.post("/trips/:tripId/packing/items/bulk", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  if (!(await tripExists(tripId))) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const body = BulkCreateBody.parse(req.body);
  const userId = req.session.userId!;
  const list = await getOrCreateList(tripId);

  const existing = await db
    .select({ sortOrder: travelsPackingItems.sortOrder })
    .from(travelsPackingItems)
    .where(eq(travelsPackingItems.listId, list.id))
    .orderBy(asc(travelsPackingItems.sortOrder));

  const nextOrder =
    existing.length > 0 ? Math.max(...existing.map((r) => r.sortOrder)) + 1 : 0;

  const rows = body.items.map((item, i) => ({
    listId: list.id,
    text: item.text,
    sortOrder: nextOrder + i,
    addedByUserId: userId,
  }));

  const created = await db.insert(travelsPackingItems).values(rows).returning();
  res.status(201).json(created);
});

// ── POST /trips/:tripId/packing/generate ─────────────────────────────────────
// SSE endpoint: streams AI-generated packing suggestions for the trip.
// Client reads the stream and adds items one at a time.

router.post("/trips/:tripId/packing/generate", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }

  const [trip] = await db
    .select()
    .from(travelsTrips)
    .where(eq(travelsTrips.id, tripId));

  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const dateRange =
    trip.startDate && trip.endDate
      ? `${trip.startDate} to ${trip.endDate}`
      : trip.startDate
        ? `starting ${trip.startDate}`
        : "dates not set";

  const season = (() => {
    if (!trip.startDate) return "";
    const month = new Date(trip.startDate + "T12:00:00").getMonth() + 1;
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
  })();

  const transport =
    trip.transportTo === "flew"
      ? "flying"
      : trip.transportTo === "train"
        ? "taking the train"
        : trip.transportTo === "drove"
          ? "driving"
          : "";

  const prompt = `You are a helpful travel packing assistant. Generate a concise, practical packing list for the following trip.

Destination: ${trip.destination}
Dates: ${dateRange}${season ? ` (${season})` : ""}
Travellers: ${trip.travellerCount}${transport ? `\nGetting there: ${transport}` : ""}${trip.accommodationName ? `\nStaying at: ${trip.accommodationName}` : ""}${trip.notes ? `\nTrip notes: ${trip.notes}` : ""}

Return ONLY a JSON array of strings — one item per line, no categories, no markdown, no extra text. Each string is a packing item (e.g. "Passport", "Sunscreen SPF50", "Power adapter"). Aim for 15–25 practical items tailored to this specific trip.

Example format:
["Passport", "Travel insurance documents", "Phone charger", ...]`;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const models = await getModels();
    const client = await getOpenRouterClient();

    const stream = await client.chat.completions.create({
      model: models.fastVision,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: await getConfig("travels", "packing_ai_max_tokens", 1000),
    } as Parameters<typeof client.chat.completions.create>[0]);

    let fullText = "";
    for await (const chunk of stream as AsyncIterable<{
      choices: Array<{ delta?: { content?: string } }>;
    }>) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        fullText += text;
        sendEvent("chunk", { text });
      }
    }

    // Parse the completed JSON array
    try {
      const stripped = fullText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const items = JSON.parse(stripped) as string[];
      if (Array.isArray(items)) {
        sendEvent("done", {
          items: items
            .filter(
              (s): s is string => typeof s === "string" && s.trim().length > 0,
            )
            .map((s) => s.trim()),
        });
      } else {
        sendEvent("error", { message: "Unexpected AI response format" });
      }
    } catch {
      sendEvent("error", { message: "Failed to parse AI response" });
    }
  } catch (err) {
    logger.error({ err }, "packing generate SSE error");
    sendEvent("error", { message: "AI generation failed" });
  } finally {
    res.end();
  }
});

// ── GET /packing-templates ────────────────────────────────────────────────────

router.get("/packing-templates", async (_req, res) => {
  const templates = await db
    .select()
    .from(travelsPackingTemplates)
    .orderBy(asc(travelsPackingTemplates.createdAt));
  res.json(templates);
});

// ── POST /packing-templates ───────────────────────────────────────────────────

const CreateTemplateBody = z.object({
  name: z.string().min(1).max(200),
  items: z.array(z.string().min(1).max(500)).min(1).max(100),
});

router.post("/packing-templates", async (req, res) => {
  const userId = req.session.userId!;
  const body = CreateTemplateBody.parse(req.body);
  const [template] = await db
    .insert(travelsPackingTemplates)
    .values({ userId, name: body.name, items: body.items })
    .returning();
  res.status(201).json(template);
});

// ── DELETE /packing-templates/:templateId ─────────────────────────────────────

router.delete("/packing-templates/:templateId", async (req, res) => {
  const templateId = parseInt(req.params.templateId, 10);
  if (isNaN(templateId)) {
    res.status(400).json({ error: "Invalid templateId" });
    return;
  }
  const result = await db
    .delete(travelsPackingTemplates)
    .where(eq(travelsPackingTemplates.id, templateId))
    .returning({ id: travelsPackingTemplates.id });
  if (!result[0]) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.status(204).send();
});

// ── POST /trips/:tripId/packing/items/reorder ─────────────────────────────────
// Batch update sortOrder for a set of items (drag-and-drop reorder).

const ReorderBody = z.object({
  order: z.array(z.number().int()).min(1),
});

router.post("/trips/:tripId/packing/items/reorder", async (req, res) => {
  const tripId = parseInt(req.params.tripId, 10);
  if (isNaN(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  const [list] = await db
    .select({ id: travelsPackingLists.id })
    .from(travelsPackingLists)
    .where(eq(travelsPackingLists.tripId, tripId));
  if (!list) {
    res.status(404).json({ error: "Packing list not found" });
    return;
  }
  const body = ReorderBody.parse(req.body);

  // Validate: submitted IDs must exactly match the list's current item IDs
  const existing = await db
    .select({ id: travelsPackingItems.id })
    .from(travelsPackingItems)
    .where(eq(travelsPackingItems.listId, list.id));

  const existingIds = new Set(existing.map((r) => r.id));
  const submittedIds = body.order;

  if (submittedIds.length !== existingIds.size) {
    res.status(400).json({ error: "order length does not match item count" });
    return;
  }
  const hasDuplicates = new Set(submittedIds).size !== submittedIds.length;
  if (hasDuplicates) {
    res.status(400).json({ error: "order contains duplicate item IDs" });
    return;
  }
  const unknownIds = submittedIds.filter((id) => !existingIds.has(id));
  if (unknownIds.length > 0) {
    res.status(400).json({ error: "order contains IDs not in this list" });
    return;
  }

  // Apply atomically inside a transaction
  await db.transaction(async (tx) => {
    await Promise.all(
      submittedIds.map((itemId, idx) =>
        tx
          .update(travelsPackingItems)
          .set({ sortOrder: idx })
          .where(
            and(
              eq(travelsPackingItems.id, itemId),
              eq(travelsPackingItems.listId, list.id),
            ),
          ),
      ),
    );
  });

  res.json({ reordered: submittedIds.length });
});

// ── POST /trips/:tripId/packing/load-template/:templateId ─────────────────────
// Merges all items from a template into the trip's packing list (skipping
// duplicates by case-insensitive text match).

router.post(
  "/trips/:tripId/packing/load-template/:templateId",
  async (req, res) => {
    const tripId = parseInt(req.params.tripId, 10);
    const templateId = parseInt(req.params.templateId, 10);
    if (isNaN(tripId) || isNaN(templateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!(await tripExists(tripId))) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const [template] = await db
      .select()
      .from(travelsPackingTemplates)
      .where(eq(travelsPackingTemplates.id, templateId));
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const userId = req.session.userId!;
    const list = await getOrCreateList(tripId);
    const existing = await db
      .select()
      .from(travelsPackingItems)
      .where(eq(travelsPackingItems.listId, list.id))
      .orderBy(asc(travelsPackingItems.sortOrder));

    const existingTexts = new Set(
      existing.map((i) => i.text.trim().toLowerCase()),
    );
    const nextOrder =
      existing.length > 0
        ? Math.max(...existing.map((r) => r.sortOrder)) + 1
        : 0;

    const templateItems = (template.items as string[]).filter(
      (text): text is string =>
        typeof text === "string" &&
        text.trim().length > 0 &&
        !existingTexts.has(text.trim().toLowerCase()),
    );

    if (templateItems.length === 0) {
      res.json({ added: 0, items: [] });
      return;
    }

    const rows = templateItems.map((text, i) => ({
      listId: list.id,
      text: text.trim(),
      sortOrder: nextOrder + i,
      addedByUserId: userId,
    }));

    const created = await db
      .insert(travelsPackingItems)
      .values(rows)
      .returning();
    res.status(201).json({ added: created.length, items: created });
  },
);

export default router;
