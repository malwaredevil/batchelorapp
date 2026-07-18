/**
 * Quilting fabric identity research
 * POST /fabrics/:id/identity-research  — kick off a new AI research run
 * GET  /fabrics/:id/identity-research  — get the latest research result
 * PATCH /fabrics/:id/identity-research/:researchId/decide  — user picks a candidate
 *
 * Fabric identifiers (SKUs, UPCs, manufacturer codes)
 * GET    /fabrics/:id/identifiers
 * POST   /fabrics/:id/identifiers
 * DELETE /fabrics/:id/identifiers/:identifierId
 */
import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import {
  db,
  fabrics,
  fabricIdentifiers,
  fabricIdentityResearch,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { callModel, getModels } from "../../lib/ai-client";
import { downloadImageAsDataUrl } from "../../lib/storage";
import { logger } from "../../lib/logger";
import { z } from "zod/v4";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Fabric identifiers
// ---------------------------------------------------------------------------

router.get("/fabrics/:id/identifiers", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid fabric id" });
    return;
  }
  const rows = await db
    .select()
    .from(fabricIdentifiers)
    .where(eq(fabricIdentifiers.fabricId, id))
    .orderBy(asc(fabricIdentifiers.id));
  res.json(rows);
});

const CreateIdentifierBody = z.object({
  identifierType: z.string().min(1).max(80),
  identifierValue: z.string().min(1).max(255),
  sourceUrl: z.string().url().optional(),
  confidence: z
    .enum(["manual", "ai_high", "ai_medium", "ai_low"])
    .default("manual"),
});

router.post("/fabrics/:id/identifiers", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid fabric id" });
    return;
  }

  const [fabric] = await db.select().from(fabrics).where(eq(fabrics.id, id));
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found" });
    return;
  }

  const parsed = CreateIdentifierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const [row] = await db
    .insert(fabricIdentifiers)
    .values({
      fabricId: id,
      identifierType: parsed.data.identifierType,
      identifierValue: parsed.data.identifierValue,
      sourceUrl: parsed.data.sourceUrl ?? null,
      confirmedByUserId: req.session.userId,
      confirmedAt: new Date(),
      confidence: parsed.data.confidence,
    })
    .returning();

  res.status(201).json(row);
});

router.delete("/fabrics/:id/identifiers/:identifierId", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  const identifierId = parseInt(String(req.params["identifierId"] ?? ""), 10);
  if (isNaN(id) || isNaN(identifierId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(fabricIdentifiers)
    .where(eq(fabricIdentifiers.id, identifierId));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Fabric identity research
// ---------------------------------------------------------------------------

router.get("/fabrics/:id/identity-research", async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid fabric id" });
    return;
  }
  const rows = await db
    .select()
    .from(fabricIdentityResearch)
    .where(eq(fabricIdentityResearch.fabricId, id))
    .orderBy(desc(fabricIdentityResearch.createdAt));
  res.json(rows[0] ?? null);
});

router.post("/fabrics/:id/identity-research", aiLimiter, async (req, res) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid fabric id" });
    return;
  }

  const [fabric] = await db.select().from(fabrics).where(eq(fabrics.id, id));
  if (!fabric) {
    res.status(404).json({ error: "Fabric not found" });
    return;
  }

  const [pending] = await db
    .insert(fabricIdentityResearch)
    .values({
      fabricId: id,
      status: "running",
      candidates: [],
    })
    .returning();

  res.status(202).json(pending);

  void (async () => {
    try {
      const models = await getModels();

      const imageContent: { type: "image_url"; image_url: { url: string } }[] =
        [];
      if (fabric.imagePath) {
        try {
          const dataUrl = await downloadImageAsDataUrl(fabric.imagePath);
          imageContent.push({
            type: "image_url",
            image_url: { url: dataUrl },
          });
        } catch {
          /* ignore */
        }
      }

      const userContent: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[] = [
        {
          type: "text",
          text: [
            `Identify this quilting fabric from the image and known details.`,
            `Name: ${fabric.name ?? "unknown"}`,
            `Print type: ${fabric.printType ?? "unknown"}`,
            `Colors: ${(fabric.dominantColors ?? []).join(", ") || "unknown"}`,
            `Designer: ${fabric.designer ?? "unknown"}`,
            `Line: ${fabric.lineName ?? "unknown"}`,
            `Manufacturer: ${fabric.manufacturer ?? "unknown"}`,
            `SKU: ${fabric.sku ?? "none"}`,
            `Notes: ${fabric.notes ?? "none"}`,
            ``,
            `Return a JSON array of up to 5 candidate fabric identifications, ranked by confidence.`,
            `Each must have:`,
            `  manufacturer: string — fabric company (e.g. "Moda", "Riley Blake")`,
            `  designer: string | null`,
            `  collection: string | null — fabric line name`,
            `  colorwayName: string | null — colorway within the line`,
            `  sku: string | null — manufacturer SKU / item number`,
            `  upc: string | null`,
            `  yearReleased: number | null`,
            `  fabricContent: string | null — e.g. "100% cotton"`,
            `  widthInches: number | null — typically 42-44"`,
            `  confidence: "high" | "medium" | "low"`,
            `  reasoning: string`,
            `  sourceHint: string | null`,
            ``,
            `Return ONLY the JSON array.`,
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
        .update(fabricIdentityResearch)
        .set({
          status: "done",
          candidates,
          updatedAt: new Date(),
        })
        .where(eq(fabricIdentityResearch.id, pending.id));
    } catch (err) {
      logger.error({ err }, "fabric identity-research background job failed");
      await db
        .update(fabricIdentityResearch)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(fabricIdentityResearch.id, pending.id));
    }
  })();
});

const DecideBody = z.object({
  selectedCandidateIndex: z.union([z.number().int().min(0), z.null()]),
});

router.patch(
  "/fabrics/:id/identity-research/:researchId/decide",
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
      .from(fabricIdentityResearch)
      .where(eq(fabricIdentityResearch.id, researchId));
    if (!row || row.fabricId !== id) {
      res.status(404).json({ error: "Research record not found" });
      return;
    }

    const [updated] = await db
      .update(fabricIdentityResearch)
      .set({
        selectedCandidateIndex: parsed.data.selectedCandidateIndex,
        decidedByUserId: req.session.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(fabricIdentityResearch.id, researchId))
      .returning();

    res.json(updated);
  },
);

export default router;
