/**
 * Quilting "Can I Make This?" analyses
 * POST /patterns/:id/analyses  — run a stash-vs-requirements analysis
 * GET  /patterns/:id/analyses  — list previous analyses for a pattern
 * GET  /patterns/:id/analyses/:analysisId  — get one analysis
 * POST /patterns/:id/analyses/:analysisId/apply  — apply shopping proposal to list
 *
 * Pattern variants & requirements (sub-resources of a pattern)
 * GET    /patterns/:id/variants
 * POST   /patterns/:id/variants
 * PATCH  /patterns/:id/variants/:variantId
 * DELETE /patterns/:id/variants/:variantId
 * GET    /patterns/:id/variants/:variantId/requirements
 * PUT    /patterns/:id/variants/:variantId/requirements  — replace full requirement list
 */
import { Router, type IRouter } from "express";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import {
  db,
  quiltPatterns,
  fabrics,
  patternVariants,
  patternRequirements,
  quiltingAnalyses,
  shoppingItems,
  type QuiltingAnalysisRow,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { callModel, getModels } from "../../lib/ai-client";
import { logger } from "../../lib/logger";
import { z } from "zod/v4";

const router: IRouter = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Pattern variants
// ---------------------------------------------------------------------------

router.get("/patterns/:id/variants", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(patternId)) {
    res.status(400).json({ error: "Invalid pattern id" });
    return;
  }
  const rows = await db
    .select()
    .from(patternVariants)
    .where(eq(patternVariants.patternId, patternId))
    .orderBy(asc(patternVariants.id));
  res.json(rows);
});

const CreateVariantBody = z.object({
  name: z.string().min(1).max(120),
  finishedWidth: z.number().positive().optional(),
  finishedHeight: z.number().positive().optional(),
  sizeUnit: z.string().default("inches"),
  blockCount: z.number().int().positive().optional(),
  skillLevel: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/patterns/:id/variants", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(patternId)) {
    res.status(400).json({ error: "Invalid pattern id" });
    return;
  }
  const [pattern] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, patternId));
  if (!pattern) {
    res.status(404).json({ error: "Pattern not found" });
    return;
  }
  const parsed = CreateVariantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }
  const [row] = await db
    .insert(patternVariants)
    .values({ patternId, ...parsed.data })
    .returning();
  res.status(201).json(row);
});

const UpdateVariantBody = CreateVariantBody.partial();

router.patch("/patterns/:id/variants/:variantId", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  const variantId = parseInt(String(req.params["variantId"] ?? ""), 10);
  if (isNaN(patternId) || isNaN(variantId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateVariantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }
  const [updated] = await db
    .update(patternVariants)
    .set(parsed.data)
    .where(
      and(
        eq(patternVariants.id, variantId),
        eq(patternVariants.patternId, patternId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }
  res.json(updated);
});

router.delete("/patterns/:id/variants/:variantId", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  const variantId = parseInt(String(req.params["variantId"] ?? ""), 10);
  if (isNaN(patternId) || isNaN(variantId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(patternVariants)
    .where(
      and(
        eq(patternVariants.id, variantId),
        eq(patternVariants.patternId, patternId),
      ),
    );
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Pattern requirements
// ---------------------------------------------------------------------------

router.get(
  "/patterns/:id/variants/:variantId/requirements",
  async (req, res) => {
    const patternId = parseInt(String(req.params["id"] ?? ""), 10);
    const variantId = parseInt(String(req.params["variantId"] ?? ""), 10);
    if (isNaN(patternId) || isNaN(variantId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await db
      .select()
      .from(patternRequirements)
      .where(eq(patternRequirements.variantId, variantId))
      .orderBy(asc(patternRequirements.id));
    res.json(rows);
  },
);

const RequirementRow = z.object({
  role: z.string().min(1),
  colorDescription: z.string().optional(),
  quantityYards: z.number().positive().optional(),
  quantityFatQuarters: z.number().positive().optional(),
  widthAssumptionInches: z.number().positive().default(44),
  seamAllowanceInches: z.number().positive().default(0.25),
  notes: z.string().optional(),
  isExtracted: z.boolean().default(false),
  extractionConfidence: z.string().optional(),
});

const PutRequirementsBody = z.object({
  requirements: z.array(RequirementRow),
});

router.put(
  "/patterns/:id/variants/:variantId/requirements",
  async (req, res) => {
    const patternId = parseInt(String(req.params["id"] ?? ""), 10);
    const variantId = parseInt(String(req.params["variantId"] ?? ""), 10);
    if (isNaN(patternId) || isNaN(variantId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [variant] = await db
      .select()
      .from(patternVariants)
      .where(
        and(
          eq(patternVariants.id, variantId),
          eq(patternVariants.patternId, patternId),
        ),
      );
    if (!variant) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }

    const parsed = PutRequirementsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error });
      return;
    }

    await db
      .delete(patternRequirements)
      .where(eq(patternRequirements.variantId, variantId));

    const rows =
      parsed.data.requirements.length > 0
        ? await db
            .insert(patternRequirements)
            .values(parsed.data.requirements.map((r) => ({ variantId, ...r })))
            .returning()
        : [];

    res.json(rows);
  },
);

// ---------------------------------------------------------------------------
// AI-powered requirement extraction from pattern
// ---------------------------------------------------------------------------

router.post(
  "/patterns/:id/variants/:variantId/extract-requirements",
  aiLimiter,
  async (req, res) => {
    const patternId = parseInt(String(req.params["id"] ?? ""), 10);
    const variantId = parseInt(String(req.params["variantId"] ?? ""), 10);
    if (isNaN(patternId) || isNaN(variantId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [pattern] = await db
      .select()
      .from(quiltPatterns)
      .where(eq(quiltPatterns.id, patternId));
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    const [variant] = await db
      .select()
      .from(patternVariants)
      .where(
        and(
          eq(patternVariants.id, variantId),
          eq(patternVariants.patternId, patternId),
        ),
      );
    if (!variant) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }

    const models = await getModels();

    const prompt = [
      `Extract fabric requirements from this quilt pattern.`,
      `Pattern: ${pattern.name}`,
      `Variant: ${variant.name}`,
      variant.finishedWidth
        ? `Finished size: ${variant.finishedWidth} x ${variant.finishedHeight} ${variant.sizeUnit}`
        : "",
      variant.blockCount ? `Block count: ${variant.blockCount}` : "",
      ``,
      `Pattern notes/description: ${pattern.notes ?? "none"}`,
      ``,
      `Return a JSON array of requirement objects. Each must have:`,
      `  role: string — e.g. "background", "accent 1", "border"`,
      `  colorDescription: string | null — color hint from pattern`,
      `  quantityYards: number | null — yards needed (44" wide assumed)`,
      `  quantityFatQuarters: number | null — fat quarters needed (alternative to yards)`,
      `  widthAssumptionInches: number — fabric width assumption (default 44)`,
      `  seamAllowanceInches: number — seam allowance (default 0.25)`,
      `  notes: string | null`,
      `  isExtracted: true`,
      `  extractionConfidence: "high" | "medium" | "low"`,
      ``,
      `Return ONLY the JSON array.`,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await callModel(models.fastVision, (client, model) =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    );

    const raw = completion.choices[0]?.message?.content ?? "[]";
    let requirements: unknown[] = [];
    try {
      const trimmed = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      requirements = JSON.parse(trimmed);
      if (!Array.isArray(requirements)) requirements = [];
    } catch {
      requirements = [];
    }

    res.json({ requirements });
  },
);

// ---------------------------------------------------------------------------
// Analyses (can-i-make-this)
// ---------------------------------------------------------------------------

router.get("/patterns/:id/analyses", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(patternId)) {
    res.status(400).json({ error: "Invalid pattern id" });
    return;
  }
  const rows = await db
    .select()
    .from(quiltingAnalyses)
    .where(eq(quiltingAnalyses.patternId, patternId))
    .orderBy(desc(quiltingAnalyses.createdAt));
  res.json(rows);
});

router.get("/patterns/:id/analyses/:analysisId", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  const analysisId = parseInt(String(req.params["analysisId"] ?? ""), 10);
  if (isNaN(patternId) || isNaN(analysisId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(quiltingAnalyses)
    .where(
      and(
        eq(quiltingAnalyses.id, analysisId),
        eq(quiltingAnalyses.patternId, patternId),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  res.json(row);
});

const RunAnalysisBody = z.object({
  variantId: z.number().int().positive().optional(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
});

router.post("/patterns/:id/analyses", aiLimiter, async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(patternId)) {
    res.status(400).json({ error: "Invalid pattern id" });
    return;
  }

  const [pattern] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, patternId));
  if (!pattern) {
    res.status(404).json({ error: "Pattern not found" });
    return;
  }

  const parsed = RunAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const variantId = parsed.data.variantId ?? null;
  let requirements: {
    role: string;
    colorDescription: string | null;
    quantityYards: number | null;
    quantityFatQuarters: number | null;
  }[] = [];

  if (variantId) {
    const reqRows = await db
      .select()
      .from(patternRequirements)
      .where(eq(patternRequirements.variantId, variantId));
    requirements = reqRows.map((r) => ({
      role: r.role,
      colorDescription: r.colorDescription ?? null,
      quantityYards: r.quantityYards ? Number(r.quantityYards) : null,
      quantityFatQuarters: r.quantityFatQuarters
        ? Number(r.quantityFatQuarters)
        : null,
    }));
  }

  // Take a stash snapshot
  const stash = await db
    .select({
      id: fabrics.id,
      name: fabrics.name,
      dominantColors: fabrics.dominantColors,
      quantity: fabrics.quantity,
      quantityUnit: fabrics.quantityUnit,
      printType: fabrics.printType,
      notes: fabrics.notes,
    })
    .from(fabrics);

  const [pending] = await db
    .insert(quiltingAnalyses)
    .values({
      patternId,
      variantId,
      createdByUserId: req.session.userId,
      status: "running",
      stashSnapshotAt: new Date(),
      assumptions: parsed.data.assumptions ?? {},
      requirementRows: requirements,
      shoppingProposal: [],
    })
    .returning();

  res.status(202).json(pending);

  // Run the AI analysis in the background
  void (async () => {
    try {
      const models = await getModels();

      const prompt = [
        `You are a quilting assistant. Given the stash fabrics and pattern requirements below,`,
        `determine if the quilter has enough fabric to make this quilt and what they still need.`,
        ``,
        `Pattern: ${pattern.name}`,
        variantId ? `Variant ID: ${variantId}` : "",
        ``,
        `FABRIC REQUIREMENTS:`,
        requirements.length > 0
          ? requirements
              .map(
                (r) =>
                  `  - ${r.role}: ${r.quantityYards ?? "?"} yards (${r.colorDescription ?? "any color"})`,
              )
              .join("\n")
          : "  (no requirements specified — infer from pattern name/description if possible)",
        ``,
        `STASH INVENTORY (${stash.length} fabrics):`,
        stash
          .slice(0, 60)
          .map(
            (f) =>
              `  [id:${f.id}] "${f.name}" — ${f.quantity ?? "?"} ${f.quantityUnit ?? "yards"}, colors: ${(f.dominantColors ?? []).join(", ")}`,
          )
          .join("\n"),
        stash.length > 60 ? `  ... and ${stash.length - 60} more fabrics` : "",
        ``,
        `Return a JSON object with:`,
        `  readiness: "ready" | "partial" | "shopping_needed" | "unknown"`,
        `  requirementRows: array of { role, colorDescription, quantityYards, quantityFatQuarters, coveredByFabricIds: number[], shortfallYards: number | null, notes: string | null }`,
        `  shoppingProposal: array of { role, colorDescription, quantityYards, suggestedSearchQuery: string, estimatedCostUsd: number | null }`,
        `  summary: string — one paragraph readable summary for the quilter`,
        ``,
        `Return ONLY the JSON object.`,
      ]
        .filter(Boolean)
        .join("\n");

      const completion = await callModel(models.smartVision, (client, model) =>
        client.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 3000,
          temperature: 0.1,
        }),
      );

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let result: {
        readiness?: string;
        requirementRows?: unknown[];
        shoppingProposal?: unknown[];
      } = {};
      try {
        const trimmed = raw
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
        result = JSON.parse(trimmed);
      } catch {
        result = {};
      }

      await db
        .update(quiltingAnalyses)
        .set({
          status: "done",
          readiness: result.readiness ?? "unknown",
          requirementRows: result.requirementRows ?? requirements,
          shoppingProposal: result.shoppingProposal ?? [],
        })
        .where(eq(quiltingAnalyses.id, pending.id));
    } catch (err) {
      logger.error({ err }, "quilting analysis background job failed");
      await db
        .update(quiltingAnalyses)
        .set({ status: "error" })
        .where(eq(quiltingAnalyses.id, pending.id));
    }
  })();
});

// ---------------------------------------------------------------------------
// POST /patterns/:id/analyses/:analysisId/apply
// — add the shopping proposal items to the quilting shopping list
// ---------------------------------------------------------------------------

const ApplyAnalysisBody = z.object({
  selectedIndices: z.array(z.number().int().min(0)).optional(),
});

router.post("/patterns/:id/analyses/:analysisId/apply", async (req, res) => {
  const patternId = parseInt(String(req.params["id"] ?? ""), 10);
  const analysisId = parseInt(String(req.params["analysisId"] ?? ""), 10);
  if (isNaN(patternId) || isNaN(analysisId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(quiltingAnalyses)
    .where(
      and(
        eq(quiltingAnalyses.id, analysisId),
        eq(quiltingAnalyses.patternId, patternId),
      ),
    );
  if (!analysis) {
    res.status(404).json({ error: "Analysis not found" });
    return;
  }
  if (analysis.status !== "done") {
    res.status(409).json({ error: "Analysis not complete yet" });
    return;
  }

  const parsed = ApplyAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error });
    return;
  }

  const ShoppingItemSchema = z.object({
    role: z.string(),
    colorDescription: z.string().nullable().optional(),
    quantityYards: z.number().nullable().optional(),
    suggestedSearchQuery: z.string().nullable().optional(),
  });

  const proposal = z
    .array(ShoppingItemSchema)
    .safeParse(analysis.shoppingProposal);
  if (!proposal.success || proposal.data.length === 0) {
    res.json({ added: 0, items: [] });
    return;
  }

  const items = parsed.data.selectedIndices
    ? proposal.data.filter((_, i) => parsed.data.selectedIndices!.includes(i))
    : proposal.data;

  if (items.length === 0) {
    res.json({ added: 0, items: [] });
    return;
  }

  const [patternRow] = await db
    .select()
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, patternId));

  const inserted = await db
    .insert(shoppingItems)
    .values(
      items.map((item) => ({
        name: `${item.role}${item.colorDescription ? ` (${item.colorDescription})` : ""} — for ${patternRow?.name ?? "pattern"}`,
        quantity: item.quantityYards ?? null,
        unit: item.quantityYards ? "yards" : null,
        notes: item.suggestedSearchQuery
          ? `Search: ${item.suggestedSearchQuery}`
          : null,
        status: "want",
      })),
    )
    .returning();

  await db
    .update(quiltingAnalyses)
    .set({
      appliedAt: new Date(),
      appliedByUserId: req.session.userId,
    })
    .where(eq(quiltingAnalyses.id, analysisId));

  res.json({ added: inserted.length, items: inserted });
});

export default router;
