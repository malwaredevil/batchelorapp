import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, ornamentsItems, ornamentIdentityResearch } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { callModel, getModels } from "../../lib/ai-client";
import { downloadImageAsDataUrl } from "../../lib/storage";
import { logger } from "../../lib/logger";
import { z } from "zod/v4";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /items/:id/identity-research
// ---------------------------------------------------------------------------
router.get("/items/:id/identity-research", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const rows = await db
    .select()
    .from(ornamentIdentityResearch)
    .where(eq(ornamentIdentityResearch.itemId, id))
    .orderBy(desc(ornamentIdentityResearch.createdAt));

  res.json(rows[0] ?? null);
});

// ---------------------------------------------------------------------------
// POST /items/:id/identity-research  — kick off a new research run
// ---------------------------------------------------------------------------
router.post("/items/:id/identity-research", aiLimiter, async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid item id" });
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

  // Insert a pending row immediately so the client can poll
  const [pending] = await db
    .insert(ornamentIdentityResearch)
    .values({
      itemId: id,
      status: "running",
      candidates: [],
    })
    .returning();

  res.status(202).json(pending);

  // Run the AI research in the background
  void (async () => {
    try {
      const models = await getModels();

      // Build image content if available
      const imageContent: { type: "image_url"; image_url: { url: string } }[] =
        [];
      if (item.imagePath) {
        try {
          const dataUrl = await downloadImageAsDataUrl(item.imagePath);
          imageContent.push({
            type: "image_url",
            image_url: { url: dataUrl },
          });
        } catch {
          /* ignore image fetch failure */
        }
      }

      const userContent: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[] = [
        {
          type: "text",
          text: [
            `Identify this ornament from the Hallmark Keepsake collection (or another brand if applicable).`,
            `Known details:`,
            `  Name: ${item.name ?? "unknown"}`,
            `  Series/Collection: ${item.seriesOrCollection ?? "unknown"}`,
            `  Brand: ${item.brand ?? "unknown"}`,
            `  Year: ${item.year ?? "unknown"}`,
            `  Barcode: ${item.barcodeValue ?? "none"}`,
            `  AI Description: ${item.aiDescription ?? "none"}`,
            ``,
            `Return a JSON array of up to 5 candidate identifications, ranked by confidence.`,
            `Each candidate must have these fields:`,
            `  seriesName: string — official series name (or null if standalone)`,
            `  entryName: string — official ornament name`,
            `  year: number — release year`,
            `  brand: string — brand (e.g. "Hallmark")`,
            `  catalogNumber: string | null`,
            `  sequenceNumber: number | null — position in series (1, 2, 3…)`,
            `  retailPriceCents: number | null — original retail price in cents`,
            `  confidence: "high" | "medium" | "low"`,
            `  reasoning: string — why you think this is a match`,
            `  sourceHint: string | null — URL or reference you used`,
            ``,
            `Return ONLY the JSON array, no markdown, no explanation.`,
          ].join("\n"),
        },
        ...imageContent,
      ];

      const completion = await callModel(models.smartVision, (client, model) =>
        client.chat.completions.create({
          model,
          messages: [{ role: "user", content: userContent }],
          max_tokens: 2000,
          temperature: 0.1,
        }),
      );

      const raw = completion.choices[0]?.message?.content ?? "[]";
      let candidates: unknown[] = [];
      try {
        const trimmed = raw
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
        candidates = JSON.parse(trimmed);
        if (!Array.isArray(candidates)) candidates = [];
      } catch {
        candidates = [];
      }

      await db
        .update(ornamentIdentityResearch)
        .set({
          status: "done",
          candidates,
          updatedAt: new Date(),
        })
        .where(eq(ornamentIdentityResearch.id, pending.id));
    } catch (err) {
      logger.error({ err }, "identity-research background job failed");
      await db
        .update(ornamentIdentityResearch)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(ornamentIdentityResearch.id, pending.id));
    }
  })();
});

// ---------------------------------------------------------------------------
// PATCH /items/:id/identity-research/:researchId/decide
// — user picks a candidate or dismisses
// ---------------------------------------------------------------------------
const DecideBody = z.object({
  selectedCandidateIndex: z.union([z.number().int().min(0), z.null()]),
});

router.patch(
  "/items/:id/identity-research/:researchId/decide",
  async (req, res) => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    const researchId = parseInt(String(req.params["researchId"] ?? ""), 10);
    if (isNaN(id) || isNaN(researchId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = DecideBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error });
      return;
    }

    const [row] = await db
      .select()
      .from(ornamentIdentityResearch)
      .where(eq(ornamentIdentityResearch.id, researchId));
    if (!row || row.itemId !== id) {
      res.status(404).json({ error: "Research record not found" });
      return;
    }

    const [updated] = await db
      .update(ornamentIdentityResearch)
      .set({
        selectedCandidateIndex: parsed.data.selectedCandidateIndex,
        decidedByUserId: req.session.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ornamentIdentityResearch.id, researchId))
      .returning();

    res.json(updated);
  },
);

export default router;
