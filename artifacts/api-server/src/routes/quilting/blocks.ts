import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  blocks,
  fabrics,
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

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

/** Resolve category names → IDs for a specific user, creating per-user
 * categories as needed. Names taken globally by another user are skipped. */
async function resolveOrCreateCategories(
  names: string[],
  userId: number,
): Promise<number[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    MAX_CATEGORY_NAMES,
  );
  const ids: number[] = [];
  for (const name of unique) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name)))
      .limit(1);
    if (existing) {
      ids.push(existing.id);
    } else {
      try {
        const [created] = await db
          .insert(categories)
          .values({ name, userId })
          .returning({ id: categories.id });
        if (created) ids.push(created.id);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        // Name taken globally by another user — skip
      }
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

const FAB_RE = /\bfab:(\d+)/g;
const HEX_RE = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g;

async function buildFabricColorMap(
  allCells: string[][],
): Promise<Map<number, string[]>> {
  const ids = new Set<number>();
  for (const cells of allCells) {
    for (const cell of cells) {
      for (const m of cell.matchAll(FAB_RE)) ids.add(Number(m[1]));
    }
  }
  const map = new Map<number, string[]>();
  if (ids.size === 0) return map;
  const rows = await db
    .select({ id: fabrics.id, dominantColors: fabrics.dominantColors })
    .from(fabrics)
    .where(inArray(fabrics.id, [...ids]));
  for (const r of rows) map.set(r.id, r.dominantColors ?? []);
  return map;
}

/** Extract unique hex colours from a block's cell array, resolving fab:N tokens. */
function extractBlockColors(
  cells: string[],
  fabricColorMap: Map<number, string[]>,
): string[] {
  const freq = new Map<string, number>();
  for (const cell of cells) {
    if (!cell) continue;
    let matched = false;
    for (const m of cell.matchAll(FAB_RE)) {
      matched = true;
      for (const hex of fabricColorMap.get(Number(m[1])) ?? []) {
        const c = hex.toLowerCase();
        freq.set(c, (freq.get(c) ?? 0) + 1);
      }
    }
    if (!matched) {
      for (const m of cell.matchAll(HEX_RE)) {
        const c = m[0].toLowerCase();
        freq.set(c, (freq.get(c) ?? 0) + 1);
      }
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .slice(0, 10);
}

function serialize(
  row: typeof blocks.$inferSelect,
  cats: CategoryResult[] = [],
  fabricColorMap: Map<number, string[]> = new Map(),
) {
  return {
    id: row.id,
    name: row.name,
    gridSize: row.gridSize,
    cells: row.cells,
    seams: (row.seams as object[]) ?? [],
    blockSizeInches: row.blockSizeInches ?? null,
    seamAllowanceInches: row.seamAllowanceInches ?? null,
    dominantColors: extractBlockColors(row.cells, fabricColorMap),
    categories: cats,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeCells(cells: string[], gridSize: number): string[] {
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

router.get("/blocks", async (req, res) => {
  const rows = await db
    .select()
    .from(blocks)
    .orderBy(desc(blocks.createdAt));
  const [catMap, fabricColorMap] = await Promise.all([
    fetchBlockCategories(rows.map((r) => r.id)),
    buildFabricColorMap(rows.map((r) => r.cells)),
  ]);
  res.json(rows.map((r) => serialize(r, catMap.get(r.id) ?? [], fabricColorMap)));
});

router.post("/blocks", async (req, res) => {
  const userId = req.session.userId!;
  const data = CreateBlockSchema.parse(req.body);
  const cells = normalizeCells(data.cells, data.gridSize);
  const [row] = await db
    .insert(blocks)
    .values({
      userId,
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
    const catIds = await resolveOrCreateCategories(data.categoryNames, userId);
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
  const userId = req.session.userId!;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.id, id)));
  if (!row) {
    res.status(404).json({ error: "Block not found" });
    return;
  }
  const [catMap, fabricColorMap] = await Promise.all([
    fetchBlockCategories([id]),
    buildFabricColorMap([row.cells]),
  ]);
  res.json(serialize(row, catMap.get(id) ?? [], fabricColorMap));
});

router.patch("/blocks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.session.userId!;
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
      const [existing] = await db
        .select({ gridSize: blocks.gridSize })
        .from(blocks)
        .where(and(eq(blocks.id, id)));
      gridSize = existing?.gridSize ?? 8;
    }
    update.cells = normalizeCells(data.cells, gridSize);
  }
  if ("seams" in data && data.seams !== undefined) update.seams = data.seams;
  if ("blockSizeInches" in data)
    update.blockSizeInches = data.blockSizeInches ?? null;
  if ("seamAllowanceInches" in data)
    update.seamAllowanceInches = data.seamAllowanceInches ?? null;

  let row: (typeof blocks.$inferSelect) | undefined;
  if (Object.keys(update).length > 0) {
    const [updated] = await db
      .update(blocks)
      .set(update)
      .where(and(eq(blocks.id, id)))
      .returning();
    row = updated;
  } else {
    const [existing] = await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.id, id)));
    row = existing;
  }
  if (!row) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

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
      const catIds = await resolveOrCreateCategories(
        data.categoryNames,
        userId,
      );
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
  const userId = req.session.userId!;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // Verify ownership before deleting
  const [existing] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(and(eq(blocks.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

  await db
    .delete(entityCategories)
    .where(
      and(
        eq(entityCategories.entityType, "block"),
        eq(entityCategories.entityId, id),
      ),
    );
  await db
    .delete(blocks)
    .where(and(eq(blocks.id, id)));
  res.status(204).send();
});

export default router;
