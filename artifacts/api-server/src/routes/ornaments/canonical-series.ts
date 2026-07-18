import { Router, type IRouter } from "express";
import { eq, desc, asc, and } from "drizzle-orm";
import {
  db,
  ornamentSeries,
  ornamentSeriesEntries,
  ornamentItemSeriesLinks,
  ornamentsItems,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { z } from "zod/v4";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /canonical-series  — list all series
// ---------------------------------------------------------------------------
router.get("/canonical-series", async (_req, res) => {
  const rows = await db
    .select()
    .from(ornamentSeries)
    .orderBy(asc(ornamentSeries.name));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /canonical-series/:seriesId  — series + entries
// ---------------------------------------------------------------------------
router.get("/canonical-series/:seriesId", async (req, res) => {
  const seriesId = parseInt(String(req.params["seriesId"] ?? ""), 10);
  if (isNaN(seriesId)) {
    res.status(400).json({ error: "Invalid seriesId" });
    return;
  }

  const [series] = await db
    .select()
    .from(ornamentSeries)
    .where(eq(ornamentSeries.id, seriesId));
  if (!series) {
    res.status(404).json({ error: "Series not found" });
    return;
  }

  const entries = await db
    .select()
    .from(ornamentSeriesEntries)
    .where(eq(ornamentSeriesEntries.seriesId, seriesId))
    .orderBy(asc(ornamentSeriesEntries.year));

  res.json({ ...series, entries });
});

// ---------------------------------------------------------------------------
// POST /items/:id/series-link  — link an item to a canonical series entry
// ---------------------------------------------------------------------------
const LinkBody = z.object({
  seriesEntryId: z.number().int().positive(),
  confidence: z.enum(["manual", "ai_high", "ai_medium", "ai_low"]).optional(),
});

router.post("/items/:id/series-link", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const parsed = LinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const [item] = await db
    .select()
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, id));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const [entry] = await db
    .select()
    .from(ornamentSeriesEntries)
    .where(eq(ornamentSeriesEntries.id, parsed.data.seriesEntryId));
  if (!entry) {
    res.status(404).json({ error: "Series entry not found" });
    return;
  }

  const [link] = await db
    .insert(ornamentItemSeriesLinks)
    .values({
      itemId: id,
      seriesEntryId: parsed.data.seriesEntryId,
      confirmedByUserId: req.session.userId,
      confirmedAt: new Date(),
      confidence: parsed.data.confidence ?? "manual",
    })
    .onConflictDoUpdate({
      target: ornamentItemSeriesLinks.itemId,
      set: {
        seriesEntryId: parsed.data.seriesEntryId,
        confirmedByUserId: req.session.userId,
        confirmedAt: new Date(),
        confidence: parsed.data.confidence ?? "manual",
      },
    })
    .returning();

  res.json(link);
});

// ---------------------------------------------------------------------------
// DELETE /items/:id/series-link  — unlink an item from its canonical series
// ---------------------------------------------------------------------------
router.delete("/items/:id/series-link", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  await db
    .delete(ornamentItemSeriesLinks)
    .where(eq(ornamentItemSeriesLinks.itemId, id));

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// GET /items/:id/series-link  — get the current series link for an item
// ---------------------------------------------------------------------------
router.get("/items/:id/series-link", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const [link] = await db
    .select()
    .from(ornamentItemSeriesLinks)
    .where(eq(ornamentItemSeriesLinks.itemId, id));

  if (!link) {
    res.json(null);
    return;
  }

  const [entry] = await db
    .select()
    .from(ornamentSeriesEntries)
    .where(eq(ornamentSeriesEntries.id, link.seriesEntryId));

  if (!entry) {
    res.json(null);
    return;
  }

  const [series] = await db
    .select()
    .from(ornamentSeries)
    .where(eq(ornamentSeries.id, entry.seriesId));

  res.json({ link, entry, series: series ?? null });
});

export default router;
