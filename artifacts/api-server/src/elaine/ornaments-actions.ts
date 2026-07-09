import { z } from "zod/v4";
import { and, eq, isNull, or } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  ornamentsItems,
  ornamentsCategories,
  ornamentsItemCategories,
  ornamentsImages,
} from "@workspace/db";
import {
  bulkReanalyzeOrnamentItems,
  promoteOrnamentImageToPrimary,
} from "../routes/ornaments/ornaments";
import { deleteImage } from "../lib/ornaments/storage";

// Elaine's write-actions for the Ornaments app. Creating a brand-new item
// isn't offered here since every ornament requires an uploaded photo
// (imagePath is NOT NULL) and chat has no way to attach one — Elaine can
// update/delete existing items, manage their photos/categories, and manage
// categories overall instead. Mirrors pottery-actions.ts.
//
// Ornaments is (per replit.md/threat_model.md) a fully household-shared
// collection like pottery/quilting/travels: every authenticated user may
// view/edit/delete every item, there is no per-owner boundary. Executors
// here intentionally do NOT filter by userId beyond what the equivalent
// REST routes already do.

const LOCKABLE_FIELDS = [
  "name",
  "seriesOrCollection",
  "year",
  "dimensions",
  "dominantColors",
  "motifs",
  "aiDescription",
  "barcodeValue",
] as const;

export const UpdateOrnamentItemActionPayload = z
  .object({
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    quantity: z.number().int().min(0).max(9999).optional(),
    seriesOrCollection: z.string().max(200).optional(),
    year: z.number().int().min(1800).max(2100).optional(),
    brand: z.string().max(200).optional(),
    condition: z.string().max(200).optional(),
    origin: z.string().max(200).optional(),
    dimensions: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.quantity !== undefined ||
      v.seriesOrCollection !== undefined ||
      v.year !== undefined ||
      v.brand !== undefined ||
      v.condition !== undefined ||
      v.origin !== undefined ||
      v.dimensions !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteOrnamentItemActionPayload = z.object({
  itemId: z.number().int().positive(),
});

export const CreateOrnamentCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeleteOrnamentCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const LockOrnamentFieldActionPayload = z.object({
  itemId: z.number().int().positive(),
  field: z.enum(LOCKABLE_FIELDS),
  locked: z.boolean(),
});

export const UpdateOrnamentItemCategoriesActionPayload = z.object({
  itemId: z.number().int().positive(),
  categoryIds: z.array(z.number().int().positive()),
});

export const DeleteOrnamentPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const PromoteOrnamentPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const MergeOrnamentCategoriesActionPayload = z.object({
  categoryId: z.number().int().positive(),
  intoCategoryId: z.number().int().positive(),
});

export const BulkReanalyzeOrnamentsActionPayload = z.object({
  itemIds: z.array(z.number().int().positive()).max(20).optional(),
});

export const ornamentActionSchemas = [
  z.object({
    type: z.literal("update_ornament_item"),
    payload: UpdateOrnamentItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_ornament_item"),
    payload: DeleteOrnamentItemActionPayload,
  }),
  z.object({
    type: z.literal("create_ornament_category"),
    payload: CreateOrnamentCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_ornament_category"),
    payload: DeleteOrnamentCategoryActionPayload,
  }),
  z.object({
    type: z.literal("lock_ornament_field"),
    payload: LockOrnamentFieldActionPayload,
  }),
  z.object({
    type: z.literal("update_ornament_item_categories"),
    payload: UpdateOrnamentItemCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("delete_ornament_photo"),
    payload: DeleteOrnamentPhotoActionPayload,
  }),
  z.object({
    type: z.literal("promote_ornament_photo"),
    payload: PromoteOrnamentPhotoActionPayload,
  }),
  z.object({
    type: z.literal("merge_ornament_categories"),
    payload: MergeOrnamentCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("bulk_reanalyze_ornaments"),
    payload: BulkReanalyzeOrnamentsActionPayload,
  }),
] as const;

export type OrnamentActionType =
  | "update_ornament_item"
  | "delete_ornament_item"
  | "create_ornament_category"
  | "delete_ornament_category"
  | "lock_ornament_field"
  | "update_ornament_item_categories"
  | "delete_ornament_photo"
  | "promote_ornament_photo"
  | "merge_ornament_categories"
  | "bulk_reanalyze_ornaments";

async function getOrnamentItemLabelInfo(
  itemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: ornamentsItems.name })
    .from(ornamentsItems)
    .where(eq(ornamentsItems.id, itemId));
  return row ?? null;
}

async function getOrnamentCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: ornamentsCategories.name })
    .from(ornamentsCategories)
    .where(eq(ornamentsCategories.id, categoryId));
  return row ?? null;
}

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const ornamentActionExecutors: Record<
  OrnamentActionType,
  ActionExecutor
> = {
  update_ornament_item: (async (
    payload: z.infer<typeof UpdateOrnamentItemActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: ornamentsItems.id })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    const updates: Partial<typeof ornamentsItems.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.quantity !== undefined) updates.quantity = payload.quantity;
    if (payload.seriesOrCollection !== undefined)
      updates.seriesOrCollection = payload.seriesOrCollection;
    if (payload.year !== undefined) updates.year = payload.year;
    if (payload.brand !== undefined) updates.brand = payload.brand;
    if (payload.condition !== undefined)
      updates.condition = payload.condition;
    if (payload.origin !== undefined) updates.origin = payload.origin;
    if (payload.dimensions !== undefined)
      updates.dimensions = payload.dimensions;

    const [row] = await db
      .update(ornamentsItems)
      .set(updates)
      .where(eq(ornamentsItems.id, payload.itemId))
      .returning();
    return {
      status: 200,
      body: { type: "update_ornament_item", result: row },
    };
  }) as ActionExecutor,

  delete_ornament_item: (async (
    payload: z.infer<typeof DeleteOrnamentItemActionPayload>,
  ) => {
    const [item] = await db
      .select({ imagePath: ornamentsItems.imagePath })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const suppImages = await db
      .select({ storagePath: ornamentsImages.storagePath })
      .from(ornamentsImages)
      .where(eq(ornamentsImages.itemId, payload.itemId));

    await db
      .delete(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));

    await Promise.all([
      deleteImage(item.imagePath),
      ...suppImages.map((img) => deleteImage(img.storagePath)),
    ]);
    return {
      status: 200,
      body: { type: "delete_ornament_item", result: { id: payload.itemId } },
    };
  }) as ActionExecutor,

  create_ornament_category: (async (
    payload: z.infer<typeof CreateOrnamentCategoryActionPayload>,
    userId: number,
  ) => {
    const [row] = await db
      .insert(ornamentsCategories)
      .values({ name: payload.name, userId })
      .returning();
    return {
      status: 201,
      body: { type: "create_ornament_category", result: row },
    };
  }) as ActionExecutor,

  delete_ornament_category: (async (
    payload: z.infer<typeof DeleteOrnamentCategoryActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: ornamentsCategories.id })
      .from(ornamentsCategories)
      .where(eq(ornamentsCategories.id, payload.categoryId));
    if (!existing)
      return { status: 404, body: { error: "Category not found" } };
    await db
      .delete(ornamentsCategories)
      .where(eq(ornamentsCategories.id, payload.categoryId));
    return {
      status: 200,
      body: {
        type: "delete_ornament_category",
        result: { id: payload.categoryId },
      },
    };
  }) as ActionExecutor,

  lock_ornament_field: (async (
    payload: z.infer<typeof LockOrnamentFieldActionPayload>,
  ) => {
    const [existing] = await db
      .select({ lockedFields: ornamentsItems.lockedFields })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    const current = new Set(existing.lockedFields ?? []);
    if (payload.locked) current.add(payload.field);
    else current.delete(payload.field);

    const [row] = await db
      .update(ornamentsItems)
      .set({ lockedFields: [...current] })
      .where(eq(ornamentsItems.id, payload.itemId))
      .returning();
    return {
      status: 200,
      body: { type: "lock_ornament_field", result: row },
    };
  }) as ActionExecutor,

  update_ornament_item_categories: (async (
    payload: z.infer<typeof UpdateOrnamentItemCategoriesActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: ornamentsItems.id })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    // Categories are a shared household set — only guard against IDs that
    // don't exist at all, same as the REST route.
    const allCats = await db
      .select({ id: ornamentsCategories.id })
      .from(ornamentsCategories);
    const allCatIds = new Set(allCats.map((c) => c.id));
    const safeCategoryIds = payload.categoryIds.filter((id) =>
      allCatIds.has(id),
    );

    await db.transaction(async (tx) => {
      await tx
        .delete(ornamentsItemCategories)
        .where(eq(ornamentsItemCategories.itemId, payload.itemId));
      if (safeCategoryIds.length > 0) {
        await tx.insert(ornamentsItemCategories).values(
          safeCategoryIds.map((categoryId) => ({
            itemId: payload.itemId,
            categoryId,
          })),
        );
      }
    });

    return {
      status: 200,
      body: {
        type: "update_ornament_item_categories",
        result: { itemId: payload.itemId, categoryIds: safeCategoryIds },
      },
    };
  }) as ActionExecutor,

  delete_ornament_photo: (async (
    payload: z.infer<typeof DeleteOrnamentPhotoActionPayload>,
  ) => {
    const [item] = await db
      .select({ id: ornamentsItems.id })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const [imageRow] = await db
      .select({
        storagePath: ornamentsImages.storagePath,
        itemId: ornamentsImages.itemId,
      })
      .from(ornamentsImages)
      .where(eq(ornamentsImages.id, payload.imageId));
    if (!imageRow || imageRow.itemId !== payload.itemId)
      return { status: 404, body: { error: "Photo not found" } };

    await db
      .delete(ornamentsImages)
      .where(eq(ornamentsImages.id, payload.imageId));
    await deleteImage(imageRow.storagePath).catch(() => {});

    return {
      status: 200,
      body: {
        type: "delete_ornament_photo",
        result: { itemId: payload.itemId, imageId: payload.imageId },
      },
    };
  }) as ActionExecutor,

  promote_ornament_photo: (async (
    payload: z.infer<typeof PromoteOrnamentPhotoActionPayload>,
  ) => {
    try {
      const result = await promoteOrnamentImageToPrimary(
        payload.itemId,
        payload.imageId,
      );
      return {
        status: 200,
        body: { type: "promote_ornament_photo", result },
      };
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : "Unknown error.";
      return { status, body: { error: message } };
    }
  }) as ActionExecutor,

  merge_ornament_categories: (async (
    payload: z.infer<typeof MergeOrnamentCategoriesActionPayload>,
  ) => {
    if (payload.categoryId === payload.intoCategoryId) {
      return {
        status: 400,
        body: { error: "Cannot merge a category into itself." },
      };
    }
    const [source, target] = await Promise.all([
      db
        .select({ id: ornamentsCategories.id })
        .from(ornamentsCategories)
        .where(eq(ornamentsCategories.id, payload.categoryId))
        .then((r) => r[0]),
      db
        .select({ id: ornamentsCategories.id })
        .from(ornamentsCategories)
        .where(eq(ornamentsCategories.id, payload.intoCategoryId))
        .then((r) => r[0]),
    ]);
    if (!source || !target) {
      return { status: 404, body: { error: "Category not found" } };
    }

    const sourceItems = await db
      .select({ itemId: ornamentsItemCategories.itemId })
      .from(ornamentsItemCategories)
      .where(eq(ornamentsItemCategories.categoryId, payload.categoryId));

    if (sourceItems.length > 0) {
      await db
        .insert(ornamentsItemCategories)
        .values(
          sourceItems.map((r) => ({
            itemId: r.itemId,
            categoryId: payload.intoCategoryId,
          })),
        )
        .onConflictDoNothing();
    }

    await db
      .delete(ornamentsCategories)
      .where(eq(ornamentsCategories.id, payload.categoryId));

    return {
      status: 200,
      body: {
        type: "merge_ornament_categories",
        result: {
          categoryId: payload.categoryId,
          intoCategoryId: payload.intoCategoryId,
        },
      },
    };
  }) as ActionExecutor,

  bulk_reanalyze_ornaments: (async (
    payload: z.infer<typeof BulkReanalyzeOrnamentsActionPayload>,
  ) => {
    let ids = payload.itemIds;
    if (!ids || ids.length === 0) {
      // No explicit ids given — default to every item missing an embedding
      // or descriptive attributes (the same "stragglers" set shown on the
      // Maintenance page).
      const rows = await db
        .select({ id: ornamentsItems.id })
        .from(ornamentsItems)
        .where(
          or(
            isNull(ornamentsItems.embedding),
            and(
              isNull(ornamentsItems.seriesOrCollection),
              isNull(ornamentsItems.year),
            ),
          ),
        );
      ids = rows.map((r) => r.id);
    }
    const result = await bulkReanalyzeOrnamentItems(ids ?? []);
    return {
      status: 200,
      body: { type: "bulk_reanalyze_ornaments", result },
    };
  }) as ActionExecutor,
};

export async function buildOrnamentActionLabel(action: {
  type: OrnamentActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_ornament_item": {
      const payload = action.payload as z.infer<
        typeof UpdateOrnamentItemActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return `Update ${name} in your ornaments collection`;
    }
    case "delete_ornament_item": {
      const payload = action.payload as z.infer<
        typeof DeleteOrnamentItemActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return `Delete ${name} from your ornaments collection`;
    }
    case "create_ornament_category": {
      const payload = action.payload as z.infer<
        typeof CreateOrnamentCategoryActionPayload
      >;
      return `Create the ornaments category "${payload.name}"`;
    }
    case "delete_ornament_category": {
      const payload = action.payload as z.infer<
        typeof DeleteOrnamentCategoryActionPayload
      >;
      const cat = await getOrnamentCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the ornaments category ${name}`;
    }
    case "lock_ornament_field": {
      const payload = action.payload as z.infer<
        typeof LockOrnamentFieldActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return payload.locked
        ? `Lock the ${payload.field} field on ${name} so AI re-analysis can't overwrite it`
        : `Unlock the ${payload.field} field on ${name}`;
    }
    case "update_ornament_item_categories": {
      const payload = action.payload as z.infer<
        typeof UpdateOrnamentItemCategoriesActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return `Update the categories assigned to ${name}`;
    }
    case "delete_ornament_photo": {
      const payload = action.payload as z.infer<
        typeof DeleteOrnamentPhotoActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return `Delete a photo from ${name}`;
    }
    case "promote_ornament_photo": {
      const payload = action.payload as z.infer<
        typeof PromoteOrnamentPhotoActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return `Make that photo the primary photo for ${name} and re-run AI analysis`;
    }
    case "merge_ornament_categories": {
      const payload = action.payload as z.infer<
        typeof MergeOrnamentCategoriesActionPayload
      >;
      const [source, target] = await Promise.all([
        getOrnamentCategoryLabelInfo(payload.categoryId),
        getOrnamentCategoryLabelInfo(payload.intoCategoryId),
      ]);
      const sourceName = source ? `"${source.name}"` : "that category";
      const targetName = target ? `"${target.name}"` : "the other category";
      return `Merge the category ${sourceName} into ${targetName}`;
    }
    case "bulk_reanalyze_ornaments": {
      const payload = action.payload as z.infer<
        typeof BulkReanalyzeOrnamentsActionPayload
      >;
      return payload.itemIds && payload.itemIds.length > 0
        ? `Run AI re-analysis on ${payload.itemIds.length} ornament(s)`
        : `Run AI re-analysis on every ornament that needs it`;
    }
  }
}

export const ornamentActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "update_ornament_item",
        description:
          'Propose editing an EXISTING ornament in the user\'s collection, e.g. "rename that ornament" or "note that it has a chip" — also use this right after an upload to fill in metadata like seriesOrCollection, year, brand, condition, origin, or dimensions if the user tells you those details in chat. Only call this if the item\'s numeric id is visible on screen (look for "itemId: <number>"); never guess an id. Include only the field(s) that actually change.',
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            quantity: { type: "integer" },
            seriesOrCollection: { type: "string" },
            year: { type: "integer" },
            brand: { type: "string" },
            condition: { type: "string" },
            origin: { type: "string" },
            dimensions: { type: "string" },
          },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_ornament_item",
        description:
          "Propose permanently deleting an ornament and its photo(s). Only call this if the item's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the ornament.",
        parameters: {
          type: "object",
          properties: { itemId: { type: "integer" } },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_ornament_category",
        description:
          'Propose creating a new ornaments category to organize the collection, e.g. "add a Keepsake category".',
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
        name: "delete_ornament_category",
        description:
          "Propose permanently deleting an ornaments category. Only call this if the category's numeric id is visible on screen; never guess an id.",
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
        name: "lock_ornament_field",
        description:
          'Propose locking or unlocking one AI-derived field on an ornament so future AI re-analysis will (locked) or won\'t (unlocked) overwrite it, e.g. "lock the series on this ornament" or "unlock the year field". Only call this if the item\'s numeric id is visible on screen; never guess an id.',
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            field: { type: "string", enum: [...LOCKABLE_FIELDS] },
            locked: { type: "boolean" },
          },
          required: ["itemId", "field", "locked"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_ornament_item_categories",
        description:
          'Propose replacing the full set of categories assigned to an ornament, e.g. "put this in Keepsake and Vintage". Pass the complete list of category ids that should be assigned (this replaces the existing set, it does not append). Only call this if the item\'s numeric id and the category ids are visible on screen; never guess an id.',
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            categoryIds: { type: "array", items: { type: "integer" } },
          },
          required: ["itemId", "categoryIds"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_ornament_photo",
        description:
          "Propose deleting one supplemental photo from an ornament (not the primary photo). Only call this if both the item's and photo's numeric ids are visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            imageId: { type: "integer" },
          },
          required: ["itemId", "imageId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "promote_ornament_photo",
        description:
          "Propose making a supplemental photo the new primary photo for an ornament, which also re-runs AI analysis on it. Only call this if both the item's and photo's numeric ids are visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            imageId: { type: "integer" },
          },
          required: ["itemId", "imageId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "merge_ornament_categories",
        description:
          'Propose merging one ornaments category into another, e.g. "merge Santa into Keepsake" — reassigns all items then deletes the source category. Only call this if both category ids are visible on screen; never guess an id.',
        parameters: {
          type: "object",
          properties: {
            categoryId: { type: "integer" },
            intoCategoryId: { type: "integer" },
          },
          required: ["categoryId", "intoCategoryId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bulk_reanalyze_ornaments",
        description:
          'Propose running AI re-analysis on a batch of ornaments (max 20 ids), or on every ornament missing attributes/embeddings if no ids are given, e.g. "reanalyze all my ornaments that need it".',
        parameters: {
          type: "object",
          properties: {
            itemIds: { type: "array", items: { type: "integer" } },
          },
        },
      },
    },
  ];
