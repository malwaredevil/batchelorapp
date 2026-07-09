import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  fabrics,
  quiltPatterns,
  shoppingItems,
  quiltingCategories,
  finishedQuilts,
  blocks,
  layouts,
  entityCategories,
} from "@workspace/db";
import { bulkReanalyzeFabrics } from "../routes/quilting/fabrics";
import { bulkReanalyzePatterns } from "../routes/quilting/patterns";
import {
  bulkReanalyzeQuilts,
  deleteQuiltById,
} from "../routes/quilting/quilts";
import {
  renameQuiltingCategory,
  mergeQuiltingCategories,
} from "../routes/quilting/categories";

// Elaine's write-actions for the Quilting app. Creating brand-new fabrics or
// finished quilts isn't offered here since both require an uploaded photo
// (imagePath is NOT NULL) and chat has no way to attach one — but a new quilt
// PATTERN can be created since its image is optional. Elaine can also
// update/delete existing fabrics/patterns/quilts, fully manage the shopping
// list and categories, create/delete block and layout metadata (no
// chat-driven cell drawing or grid placement — that stays a navigate-only,
// UI-only workflow), trigger bulk AI re-analysis, and estimate yardage as a
// read-only calculation (see calculate_yardage, a soft tool in index.ts, not
// a QuiltingAction).
//
// Quilting is a fully household-shared collection (see threat_model.md).
// New executors below intentionally do NOT filter by userId beyond what the
// equivalent REST routes already do, to stay consistent with fabric/pattern
// executors above and with the pottery precedent.

const VALID_GRID_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const UpdateFabricActionPayload = z
  .object({
    fabricId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    colorway: z.string().max(200).optional(),
    printType: z.string().max(200).optional(),
    quantity: z.number().min(0).max(9999).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.colorway !== undefined ||
      v.printType !== undefined ||
      v.quantity !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteFabricActionPayload = z.object({
  fabricId: z.number().int().positive(),
});

export const UpdatePatternActionPayload = z
  .object({
    patternId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    designer: z.string().max(200).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.designer !== undefined || v.notes !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeletePatternActionPayload = z.object({
  patternId: z.number().int().positive(),
});

export const CreateShoppingItemActionPayload = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  url: z.string().max(1000).optional(),
  quantity: z.number().min(0).max(9999).optional(),
  unit: z.string().max(50).optional(),
  estimatedPriceUsd: z.number().min(0).optional(),
  store: z.string().max(200).optional(),
});

export const UpdateShoppingItemActionPayload = z
  .object({
    shoppingItemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).optional(),
    quantity: z.number().min(0).max(9999).optional(),
    status: z.enum(["want", "bought"]).optional(),
    actualPriceUsd: z.number().min(0).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.quantity !== undefined ||
      v.status !== undefined ||
      v.actualPriceUsd !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteShoppingItemActionPayload = z.object({
  shoppingItemId: z.number().int().positive(),
});

export const CreateQuiltingCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeleteQuiltingCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const CreatePatternActionPayload = z.object({
  name: z.string().min(1).max(200),
  designer: z.string().max(200).optional(),
  blockSize: z.string().max(100).optional(),
  difficulty: z.string().max(100).optional(),
  sourceType: z.string().max(100).optional(),
  sourceReference: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
  categoryNames: z.array(z.string().max(100)).max(20).optional(),
});

export const DeleteQuiltActionPayload = z.object({
  quiltId: z.number().int().positive(),
});

export const RenameQuiltingCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().min(1).max(100),
});

export const MergeQuiltingCategoriesActionPayload = z.object({
  categoryId: z.number().int().positive(),
  intoCategoryId: z.number().int().positive(),
});

export const CreateBlockActionPayload = z.object({
  name: z.string().min(1).max(100),
  gridSize: z
    .number()
    .int()
    .refine((n): n is (typeof VALID_GRID_SIZES)[number] =>
      (VALID_GRID_SIZES as readonly number[]).includes(n),
    ),
  categoryNames: z.array(z.string().max(100)).max(20).optional(),
});

export const DeleteBlockActionPayload = z.object({
  blockId: z.number().int().positive(),
});

export const CreateLayoutActionPayload = z.object({
  name: z.string().min(1).max(100),
  rows: z.number().int().min(1).max(16),
  cols: z.number().int().min(1).max(16),
  categoryNames: z.array(z.string().max(100)).max(20).optional(),
});

export const DeleteLayoutActionPayload = z.object({
  layoutId: z.number().int().positive(),
});

export const BulkReanalyzeQuiltingActionPayload = z.object({
  entityType: z.enum(["fabric", "pattern", "quilt"]),
  ids: z.array(z.number().int().positive()).max(20).optional(),
});

export const quiltingActionSchemas = [
  z.object({
    type: z.literal("update_fabric"),
    payload: UpdateFabricActionPayload,
  }),
  z.object({
    type: z.literal("delete_fabric"),
    payload: DeleteFabricActionPayload,
  }),
  z.object({
    type: z.literal("update_pattern"),
    payload: UpdatePatternActionPayload,
  }),
  z.object({
    type: z.literal("delete_pattern"),
    payload: DeletePatternActionPayload,
  }),
  z.object({
    type: z.literal("create_shopping_item"),
    payload: CreateShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("update_shopping_item"),
    payload: UpdateShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_shopping_item"),
    payload: DeleteShoppingItemActionPayload,
  }),
  z.object({
    type: z.literal("create_quilting_category"),
    payload: CreateQuiltingCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_quilting_category"),
    payload: DeleteQuiltingCategoryActionPayload,
  }),
  z.object({
    type: z.literal("create_pattern"),
    payload: CreatePatternActionPayload,
  }),
  z.object({
    type: z.literal("delete_quilt"),
    payload: DeleteQuiltActionPayload,
  }),
  z.object({
    type: z.literal("rename_quilting_category"),
    payload: RenameQuiltingCategoryActionPayload,
  }),
  z.object({
    type: z.literal("merge_quilting_categories"),
    payload: MergeQuiltingCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("create_block"),
    payload: CreateBlockActionPayload,
  }),
  z.object({
    type: z.literal("delete_block"),
    payload: DeleteBlockActionPayload,
  }),
  z.object({
    type: z.literal("create_layout"),
    payload: CreateLayoutActionPayload,
  }),
  z.object({
    type: z.literal("delete_layout"),
    payload: DeleteLayoutActionPayload,
  }),
  z.object({
    type: z.literal("bulk_reanalyze_quilting"),
    payload: BulkReanalyzeQuiltingActionPayload,
  }),
] as const;

export type QuiltingActionType =
  | "update_fabric"
  | "delete_fabric"
  | "update_pattern"
  | "delete_pattern"
  | "create_shopping_item"
  | "update_shopping_item"
  | "delete_shopping_item"
  | "create_quilting_category"
  | "delete_quilting_category"
  | "create_pattern"
  | "delete_quilt"
  | "rename_quilting_category"
  | "merge_quilting_categories"
  | "create_block"
  | "delete_block"
  | "create_layout"
  | "delete_layout"
  | "bulk_reanalyze_quilting";

async function getFabricLabelInfo(
  fabricId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: fabrics.name })
    .from(fabrics)
    .where(eq(fabrics.id, fabricId));
  return row ?? null;
}

async function getPatternLabelInfo(
  patternId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: quiltPatterns.name })
    .from(quiltPatterns)
    .where(eq(quiltPatterns.id, patternId));
  return row ?? null;
}

async function getShoppingItemLabelInfo(
  shoppingItemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: shoppingItems.name })
    .from(shoppingItems)
    .where(eq(shoppingItems.id, shoppingItemId));
  return row ?? null;
}

async function getQuiltingCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: quiltingCategories.name })
    .from(quiltingCategories)
    .where(eq(quiltingCategories.id, categoryId));
  return row ?? null;
}

async function getQuiltLabelInfo(
  quiltId: number,
): Promise<{ name: string | null } | null> {
  const [row] = await db
    .select({ name: finishedQuilts.name })
    .from(finishedQuilts)
    .where(eq(finishedQuilts.id, quiltId));
  return row ?? null;
}

async function getBlockLabelInfo(
  blockId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: blocks.name })
    .from(blocks)
    .where(eq(blocks.id, blockId));
  return row ?? null;
}

async function getLayoutLabelInfo(
  layoutId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: layouts.name })
    .from(layouts)
    .where(eq(layouts.id, layoutId));
  return row ?? null;
}

/** Resolve category names → IDs, creating shared household categories as
 * needed. Duplicated per-file (blocks.ts/layouts.ts/patterns.ts already each
 * have their own copy) since categories.ts exports no shared helper. */
async function resolveOrCreateQuiltingCategories(
  names: string[],
): Promise<number[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    20,
  );
  const ids: number[] = [];
  for (const name of unique) {
    const [existing] = await db
      .select({ id: quiltingCategories.id })
      .from(quiltingCategories)
      .where(eq(quiltingCategories.name, name))
      .limit(1);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    try {
      const [created] = await db
        .insert(quiltingCategories)
        .values({ name })
        .returning({ id: quiltingCategories.id });
      if (created) ids.push(created.id);
    } catch {
      const [race] = await db
        .select({ id: quiltingCategories.id })
        .from(quiltingCategories)
        .where(eq(quiltingCategories.name, name))
        .limit(1);
      if (race) ids.push(race.id);
    }
  }
  return ids;
}

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const quiltingActionExecutors: Record<
  QuiltingActionType,
  ActionExecutor
> = {
  update_fabric: (async (
    payload: z.infer<typeof UpdateFabricActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: fabrics.id })
      .from(fabrics)
      .where(and(eq(fabrics.id, payload.fabricId), eq(fabrics.userId, userId)));
    if (!existing) return { status: 404, body: { error: "Fabric not found" } };

    const updates: Partial<typeof fabrics.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.colorway !== undefined) updates.colorway = payload.colorway;
    if (payload.printType !== undefined) updates.printType = payload.printType;
    if (payload.quantity !== undefined) updates.quantity = payload.quantity;

    const [row] = await db
      .update(fabrics)
      .set(updates)
      .where(eq(fabrics.id, payload.fabricId))
      .returning();
    return { status: 200, body: { type: "update_fabric", result: row } };
  }) as ActionExecutor,

  delete_fabric: (async (
    payload: z.infer<typeof DeleteFabricActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: fabrics.id })
      .from(fabrics)
      .where(and(eq(fabrics.id, payload.fabricId), eq(fabrics.userId, userId)));
    if (!existing) return { status: 404, body: { error: "Fabric not found" } };
    await db.delete(fabrics).where(eq(fabrics.id, payload.fabricId));
    return {
      status: 200,
      body: { type: "delete_fabric", result: { id: payload.fabricId } },
    };
  }) as ActionExecutor,

  update_pattern: (async (
    payload: z.infer<typeof UpdatePatternActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltPatterns.id })
      .from(quiltPatterns)
      .where(
        and(
          eq(quiltPatterns.id, payload.patternId),
          eq(quiltPatterns.userId, userId),
        ),
      );
    if (!existing) return { status: 404, body: { error: "Pattern not found" } };

    const updates: Partial<typeof quiltPatterns.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.designer !== undefined) updates.designer = payload.designer;
    if (payload.notes !== undefined) updates.notes = payload.notes;

    const [row] = await db
      .update(quiltPatterns)
      .set(updates)
      .where(eq(quiltPatterns.id, payload.patternId))
      .returning();
    return { status: 200, body: { type: "update_pattern", result: row } };
  }) as ActionExecutor,

  delete_pattern: (async (
    payload: z.infer<typeof DeletePatternActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltPatterns.id })
      .from(quiltPatterns)
      .where(
        and(
          eq(quiltPatterns.id, payload.patternId),
          eq(quiltPatterns.userId, userId),
        ),
      );
    if (!existing) return { status: 404, body: { error: "Pattern not found" } };
    await db
      .delete(quiltPatterns)
      .where(eq(quiltPatterns.id, payload.patternId));
    return {
      status: 200,
      body: { type: "delete_pattern", result: { id: payload.patternId } },
    };
  }) as ActionExecutor,

  create_shopping_item: (async (
    payload: z.infer<typeof CreateShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(shoppingItems)
      .values({
        userId,
        name: payload.name,
        notes: payload.notes,
        url: payload.url,
        quantity: payload.quantity,
        unit: payload.unit ?? "yards",
        estimatedPriceUsd: payload.estimatedPriceUsd,
        store: payload.store,
      })
      .returning();
    return { status: 201, body: { type: "create_shopping_item", result: row } };
  }) as ActionExecutor,

  update_shopping_item: (async (
    payload: z.infer<typeof UpdateShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.id, payload.shoppingItemId),
          eq(shoppingItems.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Shopping item not found" } };

    const updates: Partial<typeof shoppingItems.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.quantity !== undefined) updates.quantity = payload.quantity;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.actualPriceUsd !== undefined)
      updates.actualPriceUsd = payload.actualPriceUsd;

    const [row] = await db
      .update(shoppingItems)
      .set(updates)
      .where(eq(shoppingItems.id, payload.shoppingItemId))
      .returning();
    return { status: 200, body: { type: "update_shopping_item", result: row } };
  }) as ActionExecutor,

  delete_shopping_item: (async (
    payload: z.infer<typeof DeleteShoppingItemActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.id, payload.shoppingItemId),
          eq(shoppingItems.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Shopping item not found" } };
    await db
      .delete(shoppingItems)
      .where(eq(shoppingItems.id, payload.shoppingItemId));
    return {
      status: 200,
      body: {
        type: "delete_shopping_item",
        result: { id: payload.shoppingItemId },
      },
    };
  }) as ActionExecutor,

  create_quilting_category: (async (
    payload: z.infer<typeof CreateQuiltingCategoryActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(quiltingCategories)
      .values({ name: payload.name, userId })
      .returning();
    return {
      status: 201,
      body: { type: "create_quilting_category", result: row },
    };
  }) as ActionExecutor,

  delete_quilting_category: (async (
    payload: z.infer<typeof DeleteQuiltingCategoryActionPayload>,
    userId: number,
  ) => {
    const [existing] = await db
      .select({ id: quiltingCategories.id })
      .from(quiltingCategories)
      .where(
        and(
          eq(quiltingCategories.id, payload.categoryId),
          eq(quiltingCategories.userId, userId),
        ),
      );
    if (!existing)
      return { status: 404, body: { error: "Category not found" } };
    await db
      .delete(quiltingCategories)
      .where(eq(quiltingCategories.id, payload.categoryId));
    return {
      status: 200,
      body: {
        type: "delete_quilting_category",
        result: { id: payload.categoryId },
      },
    };
  }) as ActionExecutor,

  create_pattern: (async (
    payload: z.infer<typeof CreatePatternActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(quiltPatterns)
      .values({
        userId,
        name: payload.name,
        designer: payload.designer ?? null,
        blockSize: payload.blockSize ?? null,
        difficulty: payload.difficulty ?? null,
        sourceType: payload.sourceType ?? null,
        sourceReference: payload.sourceReference ?? null,
        notes: payload.notes ?? null,
        imagePath: null,
      })
      .returning();

    if (payload.categoryNames && payload.categoryNames.length > 0) {
      const catIds = await resolveOrCreateQuiltingCategories(
        payload.categoryNames,
      );
      if (catIds.length > 0) {
        await db.insert(entityCategories).values(
          catIds.map((categoryId) => ({
            entityType: "pattern" as const,
            entityId: row.id,
            categoryId,
          })),
        );
      }
    }

    return { status: 201, body: { type: "create_pattern", result: row } };
  }) as ActionExecutor,

  delete_quilt: (async (payload: z.infer<typeof DeleteQuiltActionPayload>) => {
    const deleted = await deleteQuiltById(payload.quiltId);
    if (!deleted) return { status: 404, body: { error: "Quilt not found" } };
    return {
      status: 200,
      body: { type: "delete_quilt", result: { id: payload.quiltId } },
    };
  }) as ActionExecutor,

  rename_quilting_category: (async (
    payload: z.infer<typeof RenameQuiltingCategoryActionPayload>,
  ) => {
    const result = await renameQuiltingCategory(
      payload.categoryId,
      payload.name,
    );
    if (result.status !== 200) {
      return { status: result.status, body: { error: result.error } };
    }
    return {
      status: 200,
      body: { type: "rename_quilting_category", result: result.row },
    };
  }) as ActionExecutor,

  merge_quilting_categories: (async (
    payload: z.infer<typeof MergeQuiltingCategoriesActionPayload>,
  ) => {
    const result = await mergeQuiltingCategories(
      payload.categoryId,
      payload.intoCategoryId,
    );
    if (result.status !== 200) {
      return { status: result.status, body: { error: result.error } };
    }
    return {
      status: 200,
      body: {
        type: "merge_quilting_categories",
        result: {
          categoryId: payload.categoryId,
          intoCategoryId: payload.intoCategoryId,
        },
      },
    };
  }) as ActionExecutor,

  create_block: (async (
    payload: z.infer<typeof CreateBlockActionPayload>,
    userId: number,
  ) => {
    const cells = new Array(payload.gridSize * payload.gridSize).fill("");
    const [row] = await db
      .insert(blocks)
      .values({
        userId,
        name: payload.name,
        gridSize: payload.gridSize,
        cells,
        seams: [],
      })
      .returning();

    if (payload.categoryNames && payload.categoryNames.length > 0) {
      const catIds = await resolveOrCreateQuiltingCategories(
        payload.categoryNames,
      );
      if (catIds.length > 0) {
        await db.insert(entityCategories).values(
          catIds.map((categoryId) => ({
            entityType: "block" as const,
            entityId: row.id,
            categoryId,
          })),
        );
      }
    }

    return { status: 201, body: { type: "create_block", result: row } };
  }) as ActionExecutor,

  delete_block: (async (payload: z.infer<typeof DeleteBlockActionPayload>) => {
    const [existing] = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(eq(blocks.id, payload.blockId));
    if (!existing) return { status: 404, body: { error: "Block not found" } };
    await db.delete(blocks).where(eq(blocks.id, payload.blockId));
    return {
      status: 200,
      body: { type: "delete_block", result: { id: payload.blockId } },
    };
  }) as ActionExecutor,

  create_layout: (async (
    payload: z.infer<typeof CreateLayoutActionPayload>,
    userId: number,
  ) => {
    const cells = new Array(payload.rows * payload.cols).fill({
      blockId: null,
      rotation: 0,
    });
    const [row] = await db
      .insert(layouts)
      .values({
        userId,
        name: payload.name,
        rows: payload.rows,
        cols: payload.cols,
        cells,
      })
      .returning();

    if (payload.categoryNames && payload.categoryNames.length > 0) {
      const catIds = await resolveOrCreateQuiltingCategories(
        payload.categoryNames,
      );
      if (catIds.length > 0) {
        await db.insert(entityCategories).values(
          catIds.map((categoryId) => ({
            entityType: "layout" as const,
            entityId: row.id,
            categoryId,
          })),
        );
      }
    }

    return { status: 201, body: { type: "create_layout", result: row } };
  }) as ActionExecutor,

  delete_layout: (async (
    payload: z.infer<typeof DeleteLayoutActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: layouts.id })
      .from(layouts)
      .where(eq(layouts.id, payload.layoutId));
    if (!existing) return { status: 404, body: { error: "Layout not found" } };
    await db.delete(layouts).where(eq(layouts.id, payload.layoutId));
    return {
      status: 200,
      body: { type: "delete_layout", result: { id: payload.layoutId } },
    };
  }) as ActionExecutor,

  bulk_reanalyze_quilting: (async (
    payload: z.infer<typeof BulkReanalyzeQuiltingActionPayload>,
  ) => {
    let ids = payload.ids;
    if (!ids || ids.length === 0) {
      if (payload.entityType === "fabric") {
        ids = (await db.select({ id: fabrics.id }).from(fabrics)).map(
          (r) => r.id,
        );
      } else if (payload.entityType === "pattern") {
        ids = (
          await db.select({ id: quiltPatterns.id }).from(quiltPatterns)
        ).map((r) => r.id);
      } else {
        ids = (
          await db.select({ id: finishedQuilts.id }).from(finishedQuilts)
        ).map((r) => r.id);
      }
    }

    const result =
      payload.entityType === "fabric"
        ? await bulkReanalyzeFabrics(ids ?? [])
        : payload.entityType === "pattern"
          ? await bulkReanalyzePatterns(ids ?? [])
          : await bulkReanalyzeQuilts(ids ?? []);

    return {
      status: 200,
      body: { type: "bulk_reanalyze_quilting", result },
    };
  }) as ActionExecutor,
};

export async function buildQuiltingActionLabel(action: {
  type: QuiltingActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_fabric": {
      const payload = action.payload as z.infer<
        typeof UpdateFabricActionPayload
      >;
      const fabric = await getFabricLabelInfo(payload.fabricId);
      const name = fabric ? `"${fabric.name}"` : "this fabric";
      return `Update ${name} in your fabric stash`;
    }
    case "delete_fabric": {
      const payload = action.payload as z.infer<
        typeof DeleteFabricActionPayload
      >;
      const fabric = await getFabricLabelInfo(payload.fabricId);
      const name = fabric ? `"${fabric.name}"` : "this fabric";
      return `Delete ${name} from your fabric stash`;
    }
    case "update_pattern": {
      const payload = action.payload as z.infer<
        typeof UpdatePatternActionPayload
      >;
      const pattern = await getPatternLabelInfo(payload.patternId);
      const name = pattern ? `"${pattern.name}"` : "this pattern";
      return `Update ${name}`;
    }
    case "delete_pattern": {
      const payload = action.payload as z.infer<
        typeof DeletePatternActionPayload
      >;
      const pattern = await getPatternLabelInfo(payload.patternId);
      const name = pattern ? `"${pattern.name}"` : "this pattern";
      return `Delete ${name}`;
    }
    case "create_shopping_item": {
      const payload = action.payload as z.infer<
        typeof CreateShoppingItemActionPayload
      >;
      return `Add "${payload.name}" to your quilting shopping list`;
    }
    case "update_shopping_item": {
      const payload = action.payload as z.infer<
        typeof UpdateShoppingItemActionPayload
      >;
      const item = await getShoppingItemLabelInfo(payload.shoppingItemId);
      const name = item ? `"${item.name}"` : "this shopping item";
      return payload.status === "bought"
        ? `Mark ${name} as bought`
        : `Update ${name} on your shopping list`;
    }
    case "delete_shopping_item": {
      const payload = action.payload as z.infer<
        typeof DeleteShoppingItemActionPayload
      >;
      const item = await getShoppingItemLabelInfo(payload.shoppingItemId);
      const name = item ? `"${item.name}"` : "this shopping item";
      return `Remove ${name} from your shopping list`;
    }
    case "create_quilting_category": {
      const payload = action.payload as z.infer<
        typeof CreateQuiltingCategoryActionPayload
      >;
      return `Create the quilting category "${payload.name}"`;
    }
    case "delete_quilting_category": {
      const payload = action.payload as z.infer<
        typeof DeleteQuiltingCategoryActionPayload
      >;
      const cat = await getQuiltingCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the quilting category ${name}`;
    }
    case "create_pattern": {
      const payload = action.payload as z.infer<
        typeof CreatePatternActionPayload
      >;
      return `Create the quilt pattern "${payload.name}"`;
    }
    case "delete_quilt": {
      const payload = action.payload as z.infer<
        typeof DeleteQuiltActionPayload
      >;
      const quilt = await getQuiltLabelInfo(payload.quiltId);
      const name = quilt?.name ? `"${quilt.name}"` : "this quilt";
      return `Delete ${name} from your finished quilts`;
    }
    case "rename_quilting_category": {
      const payload = action.payload as z.infer<
        typeof RenameQuiltingCategoryActionPayload
      >;
      const cat = await getQuiltingCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Rename ${name} to "${payload.name}"`;
    }
    case "merge_quilting_categories": {
      const payload = action.payload as z.infer<
        typeof MergeQuiltingCategoriesActionPayload
      >;
      const [source, target] = await Promise.all([
        getQuiltingCategoryLabelInfo(payload.categoryId),
        getQuiltingCategoryLabelInfo(payload.intoCategoryId),
      ]);
      const sourceName = source ? `"${source.name}"` : "that category";
      const targetName = target ? `"${target.name}"` : "the other category";
      return `Merge the category ${sourceName} into ${targetName}`;
    }
    case "create_block": {
      const payload = action.payload as z.infer<
        typeof CreateBlockActionPayload
      >;
      return `Create a blank ${payload.gridSize}x${payload.gridSize} block template named "${payload.name}"`;
    }
    case "delete_block": {
      const payload = action.payload as z.infer<
        typeof DeleteBlockActionPayload
      >;
      const block = await getBlockLabelInfo(payload.blockId);
      const name = block ? `"${block.name}"` : "this block";
      return `Delete the block ${name}`;
    }
    case "create_layout": {
      const payload = action.payload as z.infer<
        typeof CreateLayoutActionPayload
      >;
      return `Create a blank ${payload.rows}x${payload.cols} layout named "${payload.name}"`;
    }
    case "delete_layout": {
      const payload = action.payload as z.infer<
        typeof DeleteLayoutActionPayload
      >;
      const layout = await getLayoutLabelInfo(payload.layoutId);
      const name = layout ? `"${layout.name}"` : "this layout";
      return `Delete the layout ${name}`;
    }
    case "bulk_reanalyze_quilting": {
      const payload = action.payload as z.infer<
        typeof BulkReanalyzeQuiltingActionPayload
      >;
      const label =
        payload.entityType === "fabric"
          ? "fabric(s)"
          : payload.entityType === "pattern"
            ? "pattern(s)"
            : "finished quilt(s)";
      return payload.ids && payload.ids.length > 0
        ? `Run AI re-analysis on ${payload.ids.length} ${label}`
        : `Run AI re-analysis on every ${payload.entityType} that needs it`;
    }
  }
}

export const quiltingActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "update_fabric",
        description:
          'Propose editing an EXISTING fabric in the user\'s stash, e.g. "note that I only have half a yard left". Only call this if the fabric\'s numeric id is visible on screen (look for "fabricId: <number>"); never guess an id. Include only the field(s) that actually change.',
        parameters: {
          type: "object",
          properties: {
            fabricId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            colorway: { type: "string" },
            printType: { type: "string" },
            quantity: { type: "number" },
          },
          required: ["fabricId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_fabric",
        description:
          "Propose permanently deleting a fabric and its photo(s). Only call this if the fabric's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the fabric.",
        parameters: {
          type: "object",
          properties: { fabricId: { type: "integer" } },
          required: ["fabricId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_pattern",
        description:
          "Propose editing an EXISTING quilt pattern's name, designer, or notes. Only call this if the pattern's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            patternId: { type: "integer" },
            name: { type: "string" },
            designer: { type: "string" },
            notes: { type: "string" },
          },
          required: ["patternId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_pattern",
        description:
          "Propose permanently deleting a quilt pattern. Only call this if the pattern's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { patternId: { type: "integer" } },
          required: ["patternId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_shopping_item",
        description:
          'Propose adding an item to the quilting shopping list, e.g. "add 2 yards of navy solid to my shopping list".',
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            notes: { type: "string" },
            url: { type: "string" },
            quantity: { type: "number" },
            unit: {
              type: "string",
              description: 'e.g. "yards", "fat quarters"',
            },
            estimatedPriceUsd: { type: "number" },
            store: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_shopping_item",
        description:
          'Propose updating a shopping list item, e.g. "mark that as bought" or "update the price". Only call this if the item\'s numeric id is visible on screen; never guess an id.',
        parameters: {
          type: "object",
          properties: {
            shoppingItemId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            quantity: { type: "number" },
            status: { type: "string", enum: ["want", "bought"] },
            actualPriceUsd: { type: "number" },
          },
          required: ["shoppingItemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_shopping_item",
        description:
          "Propose removing an item from the shopping list. Only call this if the item's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { shoppingItemId: { type: "integer" } },
          required: ["shoppingItemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_quilting_category",
        description: "Propose creating a new quilting category.",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_quilting_category",
        description:
          "Propose permanently deleting a quilting category. Only call this if the category's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { categoryId: { type: "integer" } },
          required: ["categoryId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_pattern",
        description:
          'Propose creating a new quilt pattern record (metadata only, no image), e.g. "add a pattern called Log Cabin by Jane Doe".',
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            designer: { type: "string" },
            blockSize: { type: "string" },
            difficulty: { type: "string" },
            sourceType: { type: "string" },
            sourceReference: { type: "string" },
            notes: { type: "string" },
            categoryNames: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_quilt",
        description:
          "Propose permanently deleting a finished quilt record and its photo(s). Only call this if the quilt's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the quilt.",
        parameters: {
          type: "object",
          properties: { quiltId: { type: "integer" } },
          required: ["quiltId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rename_quilting_category",
        description:
          "Propose renaming an existing quilting category. Only call this if the category's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            categoryId: { type: "integer" },
            name: { type: "string" },
          },
          required: ["categoryId", "name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "merge_quilting_categories",
        description:
          "Propose merging one quilting category into another, moving all items from the source category into the target and deleting the source. Only call this if both category ids are visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            categoryId: {
              type: "integer",
              description: "The source category to be merged away",
            },
            intoCategoryId: {
              type: "integer",
              description: "The target category to keep",
            },
          },
          required: ["categoryId", "intoCategoryId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_block",
        description:
          "Propose creating a new blank block template (metadata + empty grid only — this does NOT design the block's pattern/geometry). Grid size must be one of the app's supported sizes (1-12). E.g. \"create a new 4x4 block called Pinwheel Base\" creates an empty 4x4 grid the user can then design in the block editor.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            gridSize: {
              type: "integer",
              description: "Grid width/height, from 1 to 12",
            },
            categoryNames: { type: "array", items: { type: "string" } },
          },
          required: ["name", "gridSize"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_block",
        description:
          "Propose permanently deleting a block template. Only call this if the block's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { blockId: { type: "integer" } },
          required: ["blockId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_layout",
        description:
          'Propose creating a new blank quilt layout (metadata + empty grid only — this does NOT place blocks into the layout). E.g. "create a 3x4 layout called Sampler Quilt" creates an empty 3x4 grid the user can then fill in the layout editor.',
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            rows: { type: "integer" },
            cols: { type: "integer" },
            categoryNames: { type: "array", items: { type: "string" } },
          },
          required: ["name", "rows", "cols"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_layout",
        description:
          "Propose permanently deleting a quilt layout. Only call this if the layout's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: { layoutId: { type: "integer" } },
          required: ["layoutId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bulk_reanalyze_quilting",
        description:
          'Propose running AI re-analysis on fabrics, patterns, or finished quilts. Pass specific ids when the user names/points at particular items ("re-analyze this fabric"); omit ids to re-analyze every item of that type that needs it ("re-analyze all my patterns").',
        parameters: {
          type: "object",
          properties: {
            entityType: {
              type: "string",
              enum: ["fabric", "pattern", "quilt"],
            },
            ids: { type: "array", items: { type: "integer" } },
          },
          required: ["entityType"],
        },
      },
    },
  ];
