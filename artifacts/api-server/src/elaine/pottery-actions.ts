import { z } from "zod/v4";
import { and, eq, isNull, or } from "drizzle-orm";
import type OpenAI from "openai";
import {
  db,
  potteryItems,
  potteryCategories,
  potteryItemCategories,
  potteryImages,
} from "@workspace/db";
import {
  runItemAnalysis,
  bulkReanalyzePotteryItems,
  promotePotteryImageToPrimary,
} from "../routes/pottery/pottery";
import { mergePotteryCategories } from "../routes/pottery/categories";
import { deleteImage } from "../lib/pottery/storage";

// Elaine's write-actions for the Pottery app. Creating a brand-new item isn't
// offered here since every pottery item requires an uploaded photo
// (imagePath is NOT NULL) and chat has no way to attach one — Elaine can
// update/delete existing items, manage their photos/categories, and manage
// categories overall instead.
//
// Pottery is a fully household-shared collection (see threat_model.md): every
// authenticated user may view/edit/delete every item, there is no per-owner
// boundary. Executors here intentionally do NOT filter by userId beyond what
// the equivalent REST routes already do, to stay consistent with that model.

/** Fields whose value the reanalysis pipeline respects `lockedFields` for. */
const LOCKABLE_FIELDS = [
  "name",
  "patternDescription",
  "style",
  "shape",
  "maker",
  "makerInfo",
  "dimensions",
  "dominantColors",
  "motifs",
  "aiDescription",
  "glazeType",
] as const;

export const UpdatePotteryItemActionPayload = z
  .object({
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    quantity: z.number().int().min(0).max(9999).optional(),
    style: z.string().max(200).optional(),
    shape: z.string().max(200).optional(),
    maker: z.string().max(200).optional(),
    condition: z.string().max(200).optional(),
    origin: z.string().max(200).optional(),
    approximateEra: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.quantity !== undefined ||
      v.style !== undefined ||
      v.shape !== undefined ||
      v.maker !== undefined ||
      v.condition !== undefined ||
      v.origin !== undefined ||
      v.approximateEra !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeletePotteryItemActionPayload = z.object({
  itemId: z.number().int().positive(),
});

export const CreatePotteryCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeletePotteryCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const LockPotteryFieldActionPayload = z.object({
  itemId: z.number().int().positive(),
  field: z.enum(LOCKABLE_FIELDS),
  locked: z.boolean(),
});

export const UpdatePotteryItemCategoriesActionPayload = z.object({
  itemId: z.number().int().positive(),
  categoryIds: z.array(z.number().int().positive()),
});

export const DeletePotteryPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const PromotePotteryPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const MergePotteryCategoriesActionPayload = z.object({
  categoryId: z.number().int().positive(),
  intoCategoryId: z.number().int().positive(),
});

export const BulkReanalyzePotteryActionPayload = z.object({
  itemIds: z.array(z.number().int().positive()).max(20).optional(),
});

export const potteryActionSchemas = [
  z.object({
    type: z.literal("update_pottery_item"),
    payload: UpdatePotteryItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_pottery_item"),
    payload: DeletePotteryItemActionPayload,
  }),
  z.object({
    type: z.literal("create_pottery_category"),
    payload: CreatePotteryCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_pottery_category"),
    payload: DeletePotteryCategoryActionPayload,
  }),
  z.object({
    type: z.literal("lock_pottery_field"),
    payload: LockPotteryFieldActionPayload,
  }),
  z.object({
    type: z.literal("update_pottery_item_categories"),
    payload: UpdatePotteryItemCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("delete_pottery_photo"),
    payload: DeletePotteryPhotoActionPayload,
  }),
  z.object({
    type: z.literal("promote_pottery_photo"),
    payload: PromotePotteryPhotoActionPayload,
  }),
  z.object({
    type: z.literal("merge_pottery_categories"),
    payload: MergePotteryCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("bulk_reanalyze_pottery"),
    payload: BulkReanalyzePotteryActionPayload,
  }),
] as const;

export type PotteryActionType =
  | "update_pottery_item"
  | "delete_pottery_item"
  | "create_pottery_category"
  | "delete_pottery_category"
  | "lock_pottery_field"
  | "update_pottery_item_categories"
  | "delete_pottery_photo"
  | "promote_pottery_photo"
  | "merge_pottery_categories"
  | "bulk_reanalyze_pottery";

async function getPotteryItemLabelInfo(
  itemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: potteryItems.name })
    .from(potteryItems)
    .where(eq(potteryItems.id, itemId));
  return row ?? null;
}

async function getPotteryCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: potteryCategories.name })
    .from(potteryCategories)
    .where(eq(potteryCategories.id, categoryId));
  return row ?? null;
}

type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

export const potteryActionExecutors: Record<PotteryActionType, ActionExecutor> =
  {
    update_pottery_item: (async (
      payload: z.infer<typeof UpdatePotteryItemActionPayload>,
    ) => {
      const [existing] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(eq(potteryItems.id, payload.itemId));
      if (!existing) return { status: 404, body: { error: "Item not found" } };

      const updates: Partial<typeof potteryItems.$inferInsert> = {};
      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.notes !== undefined) updates.notes = payload.notes;
      if (payload.quantity !== undefined) updates.quantity = payload.quantity;
      if (payload.style !== undefined) updates.style = payload.style;
      if (payload.shape !== undefined) updates.shape = payload.shape;
      if (payload.maker !== undefined) updates.maker = payload.maker;
      if (payload.condition !== undefined)
        updates.condition = payload.condition;
      if (payload.origin !== undefined) updates.origin = payload.origin;
      if (payload.approximateEra !== undefined)
        updates.approximateEra = payload.approximateEra;

      const [row] = await db
        .update(potteryItems)
        .set(updates)
        .where(eq(potteryItems.id, payload.itemId))
        .returning();
      return {
        status: 200,
        body: { type: "update_pottery_item", result: row },
      };
    }) as ActionExecutor,

    delete_pottery_item: (async (
      payload: z.infer<typeof DeletePotteryItemActionPayload>,
    ) => {
      const [item] = await db
        .select({
          imagePath: potteryItems.imagePath,
          patternCropPath: potteryItems.patternCropPath,
        })
        .from(potteryItems)
        .where(eq(potteryItems.id, payload.itemId));
      if (!item) return { status: 404, body: { error: "Item not found" } };

      const suppImages = await db
        .select({ storagePath: potteryImages.storagePath })
        .from(potteryImages)
        .where(eq(potteryImages.itemId, payload.itemId));

      await db.delete(potteryItems).where(eq(potteryItems.id, payload.itemId));

      await Promise.all([
        deleteImage(item.imagePath),
        item.patternCropPath
          ? deleteImage(item.patternCropPath)
          : Promise.resolve(),
        ...suppImages.map((img) => deleteImage(img.storagePath)),
      ]);
      return {
        status: 200,
        body: { type: "delete_pottery_item", result: { id: payload.itemId } },
      };
    }) as ActionExecutor,

    create_pottery_category: (async (
      payload: z.infer<typeof CreatePotteryCategoryActionPayload>,
      userId: number,
    ) => {
      const [row] = await db
        .insert(potteryCategories)
        .values({ name: payload.name, userId })
        .returning();
      return {
        status: 201,
        body: { type: "create_pottery_category", result: row },
      };
    }) as ActionExecutor,

    delete_pottery_category: (async (
      payload: z.infer<typeof DeletePotteryCategoryActionPayload>,
    ) => {
      const [existing] = await db
        .select({ id: potteryCategories.id })
        .from(potteryCategories)
        .where(eq(potteryCategories.id, payload.categoryId));
      if (!existing)
        return { status: 404, body: { error: "Category not found" } };
      await db
        .delete(potteryCategories)
        .where(eq(potteryCategories.id, payload.categoryId));
      return {
        status: 200,
        body: {
          type: "delete_pottery_category",
          result: { id: payload.categoryId },
        },
      };
    }) as ActionExecutor,

    lock_pottery_field: (async (
      payload: z.infer<typeof LockPotteryFieldActionPayload>,
    ) => {
      const [existing] = await db
        .select({ lockedFields: potteryItems.lockedFields })
        .from(potteryItems)
        .where(eq(potteryItems.id, payload.itemId));
      if (!existing) return { status: 404, body: { error: "Item not found" } };

      const current = new Set(existing.lockedFields ?? []);
      if (payload.locked) current.add(payload.field);
      else current.delete(payload.field);

      const [row] = await db
        .update(potteryItems)
        .set({ lockedFields: [...current] })
        .where(eq(potteryItems.id, payload.itemId))
        .returning();
      return {
        status: 200,
        body: { type: "lock_pottery_field", result: row },
      };
    }) as ActionExecutor,

    update_pottery_item_categories: (async (
      payload: z.infer<typeof UpdatePotteryItemCategoriesActionPayload>,
    ) => {
      const [existing] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(eq(potteryItems.id, payload.itemId));
      if (!existing) return { status: 404, body: { error: "Item not found" } };

      // Categories are a shared household set — only guard against IDs that
      // don't exist at all, same as the REST route.
      const allCats = await db
        .select({ id: potteryCategories.id })
        .from(potteryCategories);
      const allCatIds = new Set(allCats.map((c) => c.id));
      const safeCategoryIds = payload.categoryIds.filter((id) =>
        allCatIds.has(id),
      );

      await db.transaction(async (tx) => {
        await tx
          .delete(potteryItemCategories)
          .where(eq(potteryItemCategories.itemId, payload.itemId));
        if (safeCategoryIds.length > 0) {
          await tx.insert(potteryItemCategories).values(
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
          type: "update_pottery_item_categories",
          result: { itemId: payload.itemId, categoryIds: safeCategoryIds },
        },
      };
    }) as ActionExecutor,

    delete_pottery_photo: (async (
      payload: z.infer<typeof DeletePotteryPhotoActionPayload>,
    ) => {
      const [item] = await db
        .select({ id: potteryItems.id })
        .from(potteryItems)
        .where(eq(potteryItems.id, payload.itemId));
      if (!item) return { status: 404, body: { error: "Item not found" } };

      const [imageRow] = await db
        .select({
          storagePath: potteryImages.storagePath,
          itemId: potteryImages.itemId,
        })
        .from(potteryImages)
        .where(eq(potteryImages.id, payload.imageId));
      if (!imageRow || imageRow.itemId !== payload.itemId)
        return { status: 404, body: { error: "Photo not found" } };

      await db
        .delete(potteryImages)
        .where(eq(potteryImages.id, payload.imageId));
      await deleteImage(imageRow.storagePath).catch(() => {});

      return {
        status: 200,
        body: {
          type: "delete_pottery_photo",
          result: { itemId: payload.itemId, imageId: payload.imageId },
        },
      };
    }) as ActionExecutor,

    promote_pottery_photo: (async (
      payload: z.infer<typeof PromotePotteryPhotoActionPayload>,
    ) => {
      try {
        const result = await promotePotteryImageToPrimary(
          payload.itemId,
          payload.imageId,
        );
        return {
          status: 200,
          body: { type: "promote_pottery_photo", result },
        };
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const message = err instanceof Error ? err.message : "Unknown error.";
        return { status, body: { error: message } };
      }
    }) as ActionExecutor,

    merge_pottery_categories: (async (
      payload: z.infer<typeof MergePotteryCategoriesActionPayload>,
    ) => {
      const result = await mergePotteryCategories(
        payload.categoryId,
        payload.intoCategoryId,
      );
      if (result.status !== 204) {
        return { status: result.status, body: { error: result.error } };
      }
      return {
        status: 200,
        body: {
          type: "merge_pottery_categories",
          result: {
            categoryId: payload.categoryId,
            intoCategoryId: payload.intoCategoryId,
          },
        },
      };
    }) as ActionExecutor,

    bulk_reanalyze_pottery: (async (
      payload: z.infer<typeof BulkReanalyzePotteryActionPayload>,
    ) => {
      let ids = payload.itemIds;
      if (!ids || ids.length === 0) {
        // No explicit ids given — default to every item missing an
        // embedding or descriptive attributes (the same "stragglers" set
        // shown on the Maintenance page).
        const rows = await db
          .select({ id: potteryItems.id })
          .from(potteryItems)
          .where(
            or(
              isNull(potteryItems.embedding),
              and(
                isNull(potteryItems.patternDescription),
                isNull(potteryItems.style),
                isNull(potteryItems.shape),
              ),
            ),
          );
        ids = rows.map((r) => r.id);
      }
      const result = await bulkReanalyzePotteryItems(ids ?? []);
      return {
        status: 200,
        body: { type: "bulk_reanalyze_pottery", result },
      };
    }) as ActionExecutor,
  };

export async function buildPotteryActionLabel(action: {
  type: PotteryActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_pottery_item": {
      const payload = action.payload as z.infer<
        typeof UpdatePotteryItemActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Update ${name} in your pottery collection`;
    }
    case "delete_pottery_item": {
      const payload = action.payload as z.infer<
        typeof DeletePotteryItemActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Delete ${name} from your pottery collection`;
    }
    case "create_pottery_category": {
      const payload = action.payload as z.infer<
        typeof CreatePotteryCategoryActionPayload
      >;
      return `Create the pottery category "${payload.name}"`;
    }
    case "delete_pottery_category": {
      const payload = action.payload as z.infer<
        typeof DeletePotteryCategoryActionPayload
      >;
      const cat = await getPotteryCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the pottery category ${name}`;
    }
    case "lock_pottery_field": {
      const payload = action.payload as z.infer<
        typeof LockPotteryFieldActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return payload.locked
        ? `Lock the ${payload.field} field on ${name} so AI re-analysis can't overwrite it`
        : `Unlock the ${payload.field} field on ${name}`;
    }
    case "update_pottery_item_categories": {
      const payload = action.payload as z.infer<
        typeof UpdatePotteryItemCategoriesActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Update the categories assigned to ${name}`;
    }
    case "delete_pottery_photo": {
      const payload = action.payload as z.infer<
        typeof DeletePotteryPhotoActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Delete a photo from ${name}`;
    }
    case "promote_pottery_photo": {
      const payload = action.payload as z.infer<
        typeof PromotePotteryPhotoActionPayload
      >;
      const item = await getPotteryItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this item";
      return `Make that photo the primary photo for ${name} and re-run AI analysis`;
    }
    case "merge_pottery_categories": {
      const payload = action.payload as z.infer<
        typeof MergePotteryCategoriesActionPayload
      >;
      const [source, target] = await Promise.all([
        getPotteryCategoryLabelInfo(payload.categoryId),
        getPotteryCategoryLabelInfo(payload.intoCategoryId),
      ]);
      const sourceName = source ? `"${source.name}"` : "that category";
      const targetName = target ? `"${target.name}"` : "the other category";
      return `Merge the category ${sourceName} into ${targetName}`;
    }
    case "bulk_reanalyze_pottery": {
      const payload = action.payload as z.infer<
        typeof BulkReanalyzePotteryActionPayload
      >;
      return payload.itemIds && payload.itemIds.length > 0
        ? `Run AI re-analysis on ${payload.itemIds.length} pottery item(s)`
        : `Run AI re-analysis on every pottery item that needs it`;
    }
  }
}

export const potteryActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "update_pottery_item",
        description:
          'Propose editing an EXISTING pottery item in the user\'s collection, e.g. "rename that piece" or "note that it has a chip" — also use this right after an upload to fill in metadata like maker, style, shape, condition, origin, or era if the user tells you those details in chat. Only call this if the item\'s numeric id is visible on screen (look for "itemId: <number>"); never guess an id. Include only the field(s) that actually change.',
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "integer" },
            name: { type: "string" },
            notes: { type: "string" },
            quantity: { type: "integer" },
            style: { type: "string" },
            shape: { type: "string" },
            maker: { type: "string" },
            condition: { type: "string" },
            origin: { type: "string" },
            approximateEra: { type: "string" },
          },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_pottery_item",
        description:
          "Propose permanently deleting a pottery item and its photo(s). Only call this if the item's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the item.",
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
        name: "create_pottery_category",
        description:
          'Propose creating a new pottery category to organize the collection, e.g. "add a Stoneware category".',
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
        name: "delete_pottery_category",
        description:
          "Propose permanently deleting a pottery category. Only call this if the category's numeric id is visible on screen; never guess an id.",
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
        name: "lock_pottery_field",
        description:
          'Propose locking or unlocking one AI-derived field on a pottery item so future AI re-analysis will (locked) or won\'t (unlocked) overwrite it, e.g. "lock the maker on this piece" or "unlock the style field". Only call this if the item\'s numeric id is visible on screen; never guess an id.',
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
        name: "update_pottery_item_categories",
        description:
          'Propose replacing the full set of categories assigned to a pottery item, e.g. "put this piece in Stoneware and Vases". Pass the complete list of category ids that should be assigned (this replaces the existing set, it does not append). Only call this if the item\'s numeric id and the category ids are visible on screen; never guess an id.',
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
        name: "delete_pottery_photo",
        description:
          "Propose permanently deleting one supplemental (non-primary) photo from a pottery item. Only call this if both the item's numeric id and the photo's numeric image id are visible on screen; never guess either.",
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
        name: "promote_pottery_photo",
        description:
          "Propose making a supplemental photo the new primary photo for a pottery item (e.g. \"use that second photo as the main one instead\"). This swaps the images and re-runs AI analysis using the new primary photo, so it can change the item's AI-derived fields (subject to any locked fields). Only call this if both the item's numeric id and the photo's numeric image id are visible on screen; never guess either.",
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
        name: "merge_pottery_categories",
        description:
          'Propose merging one pottery category into another — every item in the source category is re-assigned to the target category, then the source category is deleted. E.g. "merge Vases into Vessels". Only call this if both category ids are visible on screen; never guess either. This is destructive to the source category, so say so clearly in your visible reply.',
        parameters: {
          type: "object",
          properties: {
            categoryId: {
              type: "integer",
              description: "The source category to merge away (deleted).",
            },
            intoCategoryId: {
              type: "integer",
              description: "The target category that survives.",
            },
          },
          required: ["categoryId", "intoCategoryId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bulk_reanalyze_pottery",
        description:
          'Propose running AI re-analysis on multiple pottery items at once, e.g. "re-analyze all my stragglers" or "refresh the AI details on these 3 pieces". If specific item ids are visible on screen, pass them in itemIds; if the user means "everything that needs it" and no specific ids are visible, omit itemIds and it will run against every item currently missing AI analysis (capped at 20 per run). This can take a while and calls AI for each item, so mention that in your visible reply.',
        parameters: {
          type: "object",
          properties: {
            itemIds: { type: "array", items: { type: "integer" } },
          },
        },
      },
    },
  ];
