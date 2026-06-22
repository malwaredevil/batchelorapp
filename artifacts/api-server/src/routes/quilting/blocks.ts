import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, desc, asc, inArray, and } from "drizzle-orm";
import {
  db,
  blocks,
  entityCategories,
  quiltingCategories as categories,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { detectBlockSeams } from "../../lib/openai";

const router: IRouter = Router();
router.use(requireAuth);

const VALID_GRID_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
type GridSize = (typeof VALID_GRID_SIZES)[number];

function isValidGridSize(n: number): n is GridSize {
  return (VALID_GRID_SIZES as readonly number[]).includes(n);
}

const MAX_CATEGORY_NAMES = 20;
const MAX_CATEGORY_NAME_LEN = 100;

const SeamLineSchema = z.object({
  axis: z.enum(["h", "v"]),
  pos: z.number().int(),
  cellIdx: z.number().int(),
  clipStart: z.number().optional(),
  clipEnd: z.number().optional(),
});

const CreateBlockSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((s: string) => s.trim()),
  gridSize: z
    .number()
    .int()
    .refine(isValidGridSize, { message: "gridSize must be 1–12" }),
  cells: z.array(z.string()),
  seams: z.array(SeamLineSchema).optional(),
  blockSizeInches: z.number().min(1).max(120).nullable().optional(),
  seamAllowanceInches: z.number().min(0.0625).max(1).nullable().optional(),
  categoryNames: z
    .array(z.string().max(MAX_CATEGORY_NAME_LEN))
    .max(MAX_CATEGORY_NAMES)
    .optional(),
});

const UpdateBlockSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((s: string) => s.trim())
    .optional(),
  gridSize: z
    .number()
    .int()
    .refine(isValidGridSize, { message: "gridSize must be 1–12" })
    .optional(),
  cells: z.array(z.string()).optional(),
  seams: z.array(SeamLineSchema).optional(),
  blockSizeInches: z.number().min(1).max(120).nullable().optional(),
  seamAllowanceInches: z.number().min(0.0625).max(1).nullable().optional(),
  categoryNames: z
    .array(z.string().max(MAX_CATEGORY_NAME_LEN))
    .max(MAX_CATEGORY_NAMES)
    .optional(),
});

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

interface CategoryResult {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
}

/** Resolve category names → IDs, creating any that don't exist yet. */
async function resolveOrCreateCategories(names: string[]): Promise<number[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    MAX_CATEGORY_NAMES,
  );
  const ids: number[] = [];
  for (const name of unique) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .limit(1);
    if (existing) {
      ids.push(existing.id);
    } else {
      const [created] = await db
        .insert(categories)
        .values({ name })
        .returning({ id: categories.id });
      if (created) ids.push(created.id);
    }
  }
  return ids;
}

/** Fetch categories for a batch of block IDs. */
async function fetchBlockCategories(
  blockIds: number[],
): Promise<Map<number, CategoryResult[]>> {
  if (blockIds.length === 0) return new Map();
  const rows = await db
    .select({
      entityId: entityCategories.entityId,
      id: categories.id,
      name: categories.name,
      bgColor: categories.bgColor,
      textColor: categories.textColor,
    })
    .from(entityCategories)
    .innerJoin(categories, eq(entityCategories.categoryId, categories.id))
    .where(
      and(
        eq(entityCategories.entityType, "block"),
        inArray(entityCategories.entityId, blockIds),
      ),
    );

  const map = new Map<number, CategoryResult[]>();
  for (const row of rows) {
    if (!map.has(row.entityId)) map.set(row.entityId, []);
    map.get(row.entityId)!.push({
      id: row.id,
      name: row.name,
      bgColor: row.bgColor,
      textColor: row.textColor,
    });
  }
  return map;
}

function serialize(
  row: typeof blocks.$inferSelect,
  cats: CategoryResult[] = [],
) {
  return {
    id: row.id,
    name: row.name,
    gridSize: row.gridSize,
    cells: row.cells,
    seams: (row.seams as object[]) ?? [],
    blockSizeInches: row.blockSizeInches ?? null,
    seamAllowanceInches: row.seamAllowanceInches ?? null,
    categories: cats,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeCells(cells: string[], gridSize: number): string[] {
  // Preserve rectangular block dimensions — derive row count from actual cells, not gridSize²
  const rowCount = Math.max(1, Math.ceil(cells.length / gridSize));
  const size = gridSize * rowCount;
  const result = cells.slice(0, size).map((c) => c || "");
  while (result.length < size) result.push("");
  return result;
}

const DetectSeamsSchema = z.object({
  image: z.string().min(1).max(2_000_000),
  gridW: z.number().int().min(1).max(20),
  gridH: z.number().int().min(1).max(20),
});

router.post("/blocks/detect-seams", aiLimiter, async (req, res) => {
  const parsed = DetectSeamsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request" });
    return;
  }
  const { image, gridW, gridH } = parsed.data;
  if (!image.startsWith("data:image/")) {
    res.status(400).json({ message: "image must be a data URL" });
    return;
  }
  const { seams, diagSeams } = await detectBlockSeams(image, gridW, gridH);
  res.json({ seams, diagSeams });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

router.get("/blocks", async (_req, res) => {
  const rows = await db.select().from(blocks).orderBy(desc(blocks.createdAt));
  const catMap = await fetchBlockCategories(rows.map((r) => r.id));
  res.json(rows.map((r) => serialize(r, catMap.get(r.id) ?? [])));
});

router.post("/blocks", async (req, res) => {
  const data = CreateBlockSchema.parse(req.body);
  const cells = normalizeCells(data.cells, data.gridSize);
  const [row] = await db
    .insert(blocks)
    .values({
      name: data.name,
      gridSize: data.gridSize,
      cells,
      seams: data.seams ?? [],
      blockSizeInches: data.blockSizeInches ?? null,
      seamAllowanceInches: data.seamAllowanceInches ?? null,
    })
    .returning();

  let cats: CategoryResult[] = [];
  if (data.categoryNames && data.categoryNames.length > 0) {
    const catIds = await resolveOrCreateCategories(data.categoryNames);
    if (catIds.length > 0) {
      await db.insert(entityCategories).values(
        catIds.map((cid) => ({
          entityType: "block" as const,
          entityId: row.id,
          categoryId: cid,
        })),
      );
    }
    const catMap = await fetchBlockCategories([row.id]);
    cats = catMap.get(row.id) ?? [];
  }

  res.status(201).json(serialize(row, cats));
});

router.get("/blocks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(blocks).where(eq(blocks.id, id));
  if (!row) {
    res.status(404).json({ error: "Block not found" });
    return;
  }
  const catMap = await fetchBlockCategories([id]);
  res.json(serialize(row, catMap.get(id) ?? []));
});

router.patch("/blocks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const data = UpdateBlockSchema.parse(req.body);
  const update: Partial<typeof blocks.$inferInsert> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.gridSize !== undefined) update.gridSize = data.gridSize;
  if (data.cells !== undefined) {
    let gridSize: number = data.gridSize ?? 8;
    if (data.gridSize === undefined) {
      const row = await db
        .select({ gridSize: blocks.gridSize })
        .from(blocks)
        .where(eq(blocks.id, id));
      gridSize = row[0]?.gridSize ?? 8;
    }
    update.cells = normalizeCells(data.cells, gridSize);
  }
  if ("seams" in data && data.seams !== undefined) update.seams = data.seams;
  if ("blockSizeInches" in data)
    update.blockSizeInches = data.blockSizeInches ?? null;
  if ("seamAllowanceInches" in data)
    update.seamAllowanceInches = data.seamAllowanceInches ?? null;

  const [row] = await db
    .update(blocks)
    .set(update)
    .where(eq(blocks.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

  // Replace category assignments when categoryNames is provided (even if empty array = clear all).
  if (data.categoryNames !== undefined) {
    await db
      .delete(entityCategories)
      .where(
        and(
          eq(entityCategories.entityType, "block"),
          eq(entityCategories.entityId, id),
        ),
      );
    if (data.categoryNames.length > 0) {
      const catIds = await resolveOrCreateCategories(data.categoryNames);
      if (catIds.length > 0) {
        await db.insert(entityCategories).values(
          catIds.map((cid) => ({
            entityType: "block" as const,
            entityId: id,
            categoryId: cid,
          })),
        );
      }
    }
  }

  const catMap = await fetchBlockCategories([id]);
  res.json(serialize(row, catMap.get(id) ?? []));
});

router.delete("/blocks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // Cascade-delete category assignments for this block.
  await db
    .delete(entityCategories)
    .where(
      and(
        eq(entityCategories.entityType, "block"),
        eq(entityCategories.entityId, id),
      ),
    );
  await db.delete(blocks).where(eq(blocks.id, id));
  res.status(204).send();
});

export default router;
