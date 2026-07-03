import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  layouts,
  blocks,
  fabrics,
  entityCategories,
  quiltingCategories as categories,
} from "@workspace/db";
import { requireAuth } from "../../middleware/auth";

const router: IRouter = Router();
router.use(requireAuth);

const MAX_CATEGORY_NAMES = 20;
const MAX_CATEGORY_NAME_LEN = 100;

const LayoutCellSchema = z.object({
  blockId: z.number().int().nullable(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});

const SashingFields = {
  sashingWidthInches: z.number().min(0).max(6).nullable().optional(),
  sashingColor: z.string().max(20).nullable().optional(),
  borderWidthInches: z.number().min(0).max(6).nullable().optional(),
  borderColor: z.string().max(20).nullable().optional(),
  cornerstoneColor: z.string().max(20).nullable().optional(),
};

const CreateLayoutSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((s: string) => s.trim()),
  rows: z.number().int().min(1).max(16),
  cols: z.number().int().min(1).max(16),
  cells: z.array(LayoutCellSchema),
  categoryNames: z
    .array(z.string().max(MAX_CATEGORY_NAME_LEN))
    .max(MAX_CATEGORY_NAMES)
    .optional(),
  ...SashingFields,
});

const UpdateLayoutSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .transform((s: string) => s.trim())
    .optional(),
  rows: z.number().int().min(1).max(16).optional(),
  cols: z.number().int().min(1).max(16).optional(),
  cells: z.array(LayoutCellSchema).optional(),
  categoryNames: z
    .array(z.string().max(MAX_CATEGORY_NAME_LEN))
    .max(MAX_CATEGORY_NAMES)
    .optional(),
  ...SashingFields,
});

type LayoutCell = z.infer<typeof LayoutCellSchema>;

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
      .where(and(eq(categories.name, name), eq(categories.userId, userId)))
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
        // Name taken globally — skip
      }
    }
  }
  return ids;
}

async function fetchLayoutCategories(
  layoutIds: number[],
): Promise<Map<number, CategoryResult[]>> {
  if (layoutIds.length === 0) return new Map();
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
        eq(entityCategories.entityType, "layout"),
        inArray(entityCategories.entityId, layoutIds),
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

function normalizeCells(
  cells: LayoutCell[],
  rows: number,
  cols: number,
): LayoutCell[] {
  const size = rows * cols;
  const result = cells.slice(0, size);
  while (result.length < size) result.push({ blockId: null, rotation: 0 });
  return result;
}

function parseCells(raw: unknown): LayoutCell[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => ({
    blockId: typeof c?.blockId === "number" ? c.blockId : null,
    rotation: ([0, 90, 180, 270] as number[]).includes(c?.rotation)
      ? c.rotation
      : 0,
  }));
}

const HEX_RE = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g;

async function fetchBlockCellsMap(
  blockIds: number[],
  userId: number,
): Promise<Map<number, string[]>> {
  if (blockIds.length === 0) return new Map();
  const rows = await db
    .select({ id: blocks.id, cells: blocks.cells })
    .from(blocks)
    .where(and(inArray(blocks.id, blockIds), eq(blocks.userId, userId)));

  const FAB_RE = /\bfab:(\d+)/g;
  const allFabricIds = new Set<number>();
  for (const r of rows) {
    for (const cell of r.cells) {
      for (const m of cell.matchAll(FAB_RE)) allFabricIds.add(Number(m[1]));
    }
  }

  const fabricColorMap = new Map<number, string[]>();
  if (allFabricIds.size > 0) {
    const fabRows = await db
      .select({ id: fabrics.id, dominantColors: fabrics.dominantColors })
      .from(fabrics)
      .where(and(inArray(fabrics.id, [...allFabricIds]), eq(fabrics.userId, userId)));
    for (const fr of fabRows) fabricColorMap.set(fr.id, fr.dominantColors ?? []);
  }

  const HEX_RE_LOCAL = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g;
  const m = new Map<number, string[]>();
  for (const r of rows) {
    const effective: string[] = [];
    for (const cell of r.cells) {
      let matched = false;
      for (const match of cell.matchAll(FAB_RE)) {
        matched = true;
        // Fabric dominantColors may be CSS color names OR hex — push as-is.
        effective.push(...(fabricColorMap.get(Number(match[1])) ?? []));
      }
      if (!matched) {
        // Non-fabric cell: extract hex colour codes (handles "nwse:#xxx:#yyy" etc.)
        for (const hm of cell.matchAll(HEX_RE_LOCAL)) effective.push(hm[0].toLowerCase());
      }
    }
    m.set(r.id, effective);
  }
  return m;
}

function extractLayoutColors(
  row: typeof layouts.$inferSelect,
  blockCellsMap: Map<number, string[]>,
): string[] {
  const freq = new Map<string, number>();

  function addStr(s: string | null | undefined, weight = 1) {
    if (!s) return;
    for (const m of s.matchAll(HEX_RE)) {
      const c = m[0].toLowerCase();
      freq.set(c, (freq.get(c) ?? 0) + weight);
    }
  }

  addStr(row.sashingColor, 3);
  addStr(row.borderColor, 3);
  addStr(row.cornerstoneColor, 3);

  for (const cell of parseCells(row.cells)) {
    if (cell.blockId === null) continue;
    for (const colorStr of blockCellsMap.get(cell.blockId) ?? []) {
      if (!colorStr) continue;
      // Effective strings may be CSS color names (e.g. "light blue") or hex codes.
      // Add them directly — HEX_RE would miss named colors.
      const c = colorStr.toLowerCase();
      freq.set(c, (freq.get(c) ?? 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .slice(0, 10);
}

function serialize(
  row: typeof layouts.$inferSelect,
  cats: CategoryResult[] = [],
  dominantColors: string[] = [],
) {
  return {
    id: row.id,
    name: row.name,
    rows: row.rows,
    cols: row.cols,
    cells: parseCells(row.cells),
    categories: cats,
    dominantColors,
    sashingWidthInches: row.sashingWidthInches ?? null,
    sashingColor: row.sashingColor ?? null,
    borderWidthInches: row.borderWidthInches ?? null,
    borderColor: row.borderColor ?? null,
    cornerstoneColor: row.cornerstoneColor ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/layouts", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(layouts)
    .where(eq(layouts.userId, userId))
    .orderBy(desc(layouts.createdAt));
  const catMap = await fetchLayoutCategories(rows.map((r) => r.id));

  const allBlockIds = new Set<number>();
  for (const row of rows) {
    for (const cell of parseCells(row.cells)) {
      if (cell.blockId !== null) allBlockIds.add(cell.blockId);
    }
  }
  const blockCellsMap = await fetchBlockCellsMap([...allBlockIds], userId);

  res.json(
    rows.map((r) =>
      serialize(r, catMap.get(r.id) ?? [], extractLayoutColors(r, blockCellsMap)),
    ),
  );
});

router.post("/layouts", async (req, res) => {
  const userId = req.session.userId!;
  const data = CreateLayoutSchema.parse(req.body);
  const cells = normalizeCells(data.cells, data.rows, data.cols);
  const [row] = await db
    .insert(layouts)
    .values({
      userId,
      name: data.name,
      rows: data.rows,
      cols: data.cols,
      cells,
      sashingWidthInches: data.sashingWidthInches ?? null,
      sashingColor: data.sashingColor ?? null,
      borderWidthInches: data.borderWidthInches ?? null,
      borderColor: data.borderColor ?? null,
      cornerstoneColor: data.cornerstoneColor ?? null,
    })
    .returning();

  let cats: CategoryResult[] = [];
  if (data.categoryNames && data.categoryNames.length > 0) {
    const catIds = await resolveOrCreateCategories(data.categoryNames, userId);
    if (catIds.length > 0) {
      await db.insert(entityCategories).values(
        catIds.map((cid) => ({
          entityType: "layout" as const,
          entityId: row.id,
          categoryId: cid,
        })),
      );
    }
    const catMap = await fetchLayoutCategories([row.id]);
    cats = catMap.get(row.id) ?? [];
  }

  res.status(201).json(serialize(row, cats));
});

router.get("/layouts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.session.userId!;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(layouts)
    .where(and(eq(layouts.id, id), eq(layouts.userId, userId)));
  if (!row) {
    res.status(404).json({ error: "Layout not found" });
    return;
  }
  const catMap = await fetchLayoutCategories([id]);
  const blockIds = [
    ...new Set(
      parseCells(row.cells)
        .map((c) => c.blockId)
        .filter((bid): bid is number => bid !== null),
    ),
  ];
  const blockCellsMap = await fetchBlockCellsMap(blockIds, userId);
  res.json(serialize(row, catMap.get(id) ?? [], extractLayoutColors(row, blockCellsMap)));
});

router.patch("/layouts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.session.userId!;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const data = UpdateLayoutSchema.parse(req.body);
  const update: Partial<typeof layouts.$inferInsert> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.rows !== undefined) update.rows = data.rows;
  if (data.cols !== undefined) update.cols = data.cols;
  if (data.cells !== undefined) {
    const [existing] = await db
      .select({ rows: layouts.rows, cols: layouts.cols })
      .from(layouts)
      .where(and(eq(layouts.id, id), eq(layouts.userId, userId)));
    const rows = data.rows ?? existing?.rows ?? 5;
    const cols = data.cols ?? existing?.cols ?? 5;
    update.cells = normalizeCells(data.cells, rows, cols);
  }
  if ("sashingWidthInches" in data)
    update.sashingWidthInches = data.sashingWidthInches ?? null;
  if ("sashingColor" in data) update.sashingColor = data.sashingColor ?? null;
  if ("borderWidthInches" in data)
    update.borderWidthInches = data.borderWidthInches ?? null;
  if ("borderColor" in data) update.borderColor = data.borderColor ?? null;
  if ("cornerstoneColor" in data)
    update.cornerstoneColor = data.cornerstoneColor ?? null;
  let row: (typeof layouts.$inferSelect) | undefined;
  if (Object.keys(update).length > 0) {
    const [updated] = await db
      .update(layouts)
      .set(update)
      .where(and(eq(layouts.id, id), eq(layouts.userId, userId)))
      .returning();
    row = updated;
  } else {
    const [existing] = await db
      .select()
      .from(layouts)
      .where(and(eq(layouts.id, id), eq(layouts.userId, userId)));
    row = existing;
  }
  if (!row) {
    res.status(404).json({ error: "Layout not found" });
    return;
  }

  if (data.categoryNames !== undefined) {
    await db
      .delete(entityCategories)
      .where(
        and(
          eq(entityCategories.entityType, "layout"),
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
            entityType: "layout" as const,
            entityId: id,
            categoryId: cid,
          })),
        );
      }
    }
  }

  const catMap = await fetchLayoutCategories([id]);
  res.json(serialize(row, catMap.get(id) ?? []));
});

router.delete("/layouts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.session.userId!;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // Verify ownership before deleting
  const [existing] = await db
    .select({ id: layouts.id })
    .from(layouts)
    .where(and(eq(layouts.id, id), eq(layouts.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Layout not found" });
    return;
  }

  await db
    .delete(entityCategories)
    .where(
      and(
        eq(entityCategories.entityType, "layout"),
        eq(entityCategories.entityId, id),
      ),
    );
  await db
    .delete(layouts)
    .where(and(eq(layouts.id, id), eq(layouts.userId, userId)));
  res.status(204).send();
});

export default router;
