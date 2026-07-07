import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, blockTemplates } from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const MAX_TAGS = 20;
const MAX_TAG_LEN = 100;
const MAX_NAME_LEN = 120;
const MAX_THUMBNAIL_LEN = 500_000;

const SeamLineSchema = z.object({
  axis: z.enum(["h", "v"]),
  pos: z.number().int(),
  cellIdx: z.number().int(),
  clipStart: z.number().optional(),
  clipEnd: z.number().optional(),
});

const CreateTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_LEN)
    .transform((s: string) => s.trim()),
  tags: z
    .array(z.string().max(MAX_TAG_LEN).transform((s: string) => s.trim()))
    .max(MAX_TAGS)
    .optional()
    .default([]),
  gridW: z.number().int().min(1).max(20),
  gridH: z.number().int().min(1).max(20),
  cells: z.array(z.string()),
  seams: z.array(SeamLineSchema).optional().default([]),
  blockSizeInches: z.number().min(1).max(120).nullable().optional(),
  seamAllowanceInches: z.number().min(0.0625).max(1).nullable().optional(),
  thumbnailSvg: z.string().max(MAX_THUMBNAIL_LEN).optional().nullable(),
});

const PatchTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_LEN)
    .transform((s: string) => s.trim())
    .optional(),
  tags: z
    .array(z.string().max(MAX_TAG_LEN).transform((s: string) => s.trim()))
    .max(MAX_TAGS)
    .optional(),
});

function formatTemplate(row: typeof blockTemplates.$inferSelect) {
  return {
    id: row.id,
    createdByUserId: row.createdByUserId,
    name: row.name,
    tags: row.tags ?? [],
    gridW: row.gridW,
    gridH: row.gridH,
    cells: row.cells ?? [],
    seams: (row.seams as object[]) ?? [],
    blockSizeInches: row.blockSizeInches ?? null,
    seamAllowanceInches: row.seamAllowanceInches ?? null,
    thumbnailSvg: row.thumbnailSvg ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /block-templates — list all (household-shared, no user filter)
router.get("/block-templates", async (_req, res) => {
  const rows = await db
    .select()
    .from(blockTemplates)
    .orderBy(desc(blockTemplates.createdAt));
  res.json(rows.map(formatTemplate));
});

// GET /block-templates/:id
router.get("/block-templates/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [row] = await db
    .select()
    .from(blockTemplates)
    .where(eq(blockTemplates.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatTemplate(row));
});

// POST /block-templates — create
router.post("/block-templates", async (req, res) => {
  const parsed = CreateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const userId: number = (req.session as { userId?: number }).userId ?? 0;

  const [row] = await db
    .insert(blockTemplates)
    .values({
      createdByUserId: userId || null,
      name: d.name,
      tags: d.tags,
      gridW: d.gridW,
      gridH: d.gridH,
      cells: d.cells,
      seams: d.seams,
      blockSizeInches: d.blockSizeInches ?? null,
      seamAllowanceInches: d.seamAllowanceInches ?? null,
      thumbnailSvg: d.thumbnailSvg ?? null,
    })
    .returning();

  res.status(201).json(formatTemplate(row!));
});

// PATCH /block-templates/:id — rename / retag
router.patch("/block-templates/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = PatchTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const d = parsed.data;
  const updates: Partial<typeof blockTemplates.$inferInsert> & {
    updatedAt?: Date;
  } = { updatedAt: new Date() };
  if (d.name !== undefined) updates.name = d.name;
  if (d.tags !== undefined) updates.tags = d.tags;

  const [row] = await db
    .update(blockTemplates)
    .set(updates)
    .where(eq(blockTemplates.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatTemplate(row));
});

// DELETE /block-templates/:id
router.delete("/block-templates/:id", async (req, res) => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const result = await db
    .delete(blockTemplates)
    .where(eq(blockTemplates.id, id))
    .returning({ id: blockTemplates.id });

  if (result.length === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

export default router;
