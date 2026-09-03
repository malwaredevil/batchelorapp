import { z } from "zod/v4";
import { and, eq, isNull, or } from "drizzle-orm";
import type OpenAI from "openai";
import {
  createLockFieldExecutor,
  createUpdateItemCategoriesExecutor,
  createDeletePhotoExecutor,
  type ActionExecutor,
} from "./collection-action-helpers";
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
  createOrnamentItemFromBuffer,
} from "../routes/ornaments/ornaments";
import {
  suggestOrnamentCategories,
  createAndBackfillOrnamentCategories,
} from "../routes/ornaments/categories";
import { deleteImage } from "../lib/ornaments/storage";
import { scheduleOrnamentRecognition } from "../lib/ornaments/recognition";
import {
  lookupOrnamentEbayData,
  buildEbayQuery,
} from "../lib/pottery/ebay-market-value";
import { logActivity } from "../lib/soft-delete";
import { env } from "../lib/env";
import { consumeAiRateLimit } from "../middleware/rateLimit";
import { getCategoryPalette } from "@workspace/web-core/colors";

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
  itemIds: z.array(z.number().int().positive()).max(100).optional(),
});

export const AddPhotoToOrnamentsPayload = z.object({
  attachmentUrl: z.string().url().max(2000),
});

export const OrnamentEbayPriceLookupActionPayload = z.object({
  itemId: z.number().int().positive(),
  force: z.boolean().optional(),
});

export const SuggestAndCreateOrnamentCategoriesActionPayload = z.object({});

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
  z.object({
    type: z.literal("add_photo_to_ornaments"),
    payload: AddPhotoToOrnamentsPayload,
  }),
  z.object({
    type: z.literal("ornament_ebay_price_lookup"),
    payload: OrnamentEbayPriceLookupActionPayload,
  }),
  z.object({
    type: z.literal("suggest_and_create_ornament_categories"),
    payload: SuggestAndCreateOrnamentCategoriesActionPayload,
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
  | "bulk_reanalyze_ornaments"
  | "add_photo_to_ornaments"
  | "ornament_ebay_price_lookup"
  | "suggest_and_create_ornament_categories";

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
    userId: number,
  ) => {
    const [item] = await db
      .select({ id: ornamentsItems.id })
      .from(ornamentsItems)
      .where(
        and(
          eq(ornamentsItems.id, payload.itemId),
          isNull(ornamentsItems.deletedAt),
        ),
      );
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const now = new Date();
    await db
      .update(ornamentsImages)
      .set({ deletedAt: now })
      .where(eq(ornamentsImages.itemId, payload.itemId));
    await db
      .update(ornamentsItems)
      .set({ deletedAt: now })
      .where(eq(ornamentsItems.id, payload.itemId));
    void logActivity({
      actorUserId: userId,
      actorChannel: "elaine",
      actionType: "delete_ornament_item",
      entityType: "ornament",
      entityId: payload.itemId,
      reversible: true,
    });
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
      .values({
        name: payload.name,
        userId,
        ...getCategoryPalette(payload.name),
      })
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

  lock_ornament_field: createLockFieldExecutor({
    fetchLockedFields: async (itemId) => {
      const [r] = await db
        .select({ lockedFields: ornamentsItems.lockedFields })
        .from(ornamentsItems)
        .where(eq(ornamentsItems.id, itemId));
      return r ?? null;
    },
    updateLockedFields: async (itemId, fields) => {
      const [r] = await db
        .update(ornamentsItems)
        .set({ lockedFields: fields })
        .where(eq(ornamentsItems.id, itemId))
        .returning();
      return r;
    },
    actionType: "lock_ornament_field",
  }),

  update_ornament_item_categories: createUpdateItemCategoriesExecutor({
    fetchItem: async (itemId) => {
      const [r] = await db
        .select({ id: ornamentsItems.id })
        .from(ornamentsItems)
        .where(eq(ornamentsItems.id, itemId));
      return r ?? null;
    },
    fetchAllCategoryIds: async () => {
      const rows = await db
        .select({ id: ornamentsCategories.id })
        .from(ornamentsCategories);
      return rows.map((r) => r.id);
    },
    replaceItemCategories: async (itemId, safeCategoryIds) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(ornamentsItemCategories)
          .where(eq(ornamentsItemCategories.itemId, itemId));
        if (safeCategoryIds.length > 0) {
          await tx
            .insert(ornamentsItemCategories)
            .values(
              safeCategoryIds.map((categoryId) => ({ itemId, categoryId })),
            );
        }
      });
    },
    actionType: "update_ornament_item_categories",
  }),

  delete_ornament_photo: createDeletePhotoExecutor({
    fetchItem: async (itemId) => {
      const [r] = await db
        .select({ id: ornamentsItems.id })
        .from(ornamentsItems)
        .where(eq(ornamentsItems.id, itemId));
      return r ?? null;
    },
    fetchImage: async (imageId) => {
      const [r] = await db
        .select({
          storagePath: ornamentsImages.storagePath,
          itemId: ornamentsImages.itemId,
        })
        .from(ornamentsImages)
        .where(eq(ornamentsImages.id, imageId));
      return r ?? null;
    },
    deleteDbImage: async (imageId) => {
      const [image] = await db
        .select({ itemId: ornamentsImages.itemId })
        .from(ornamentsImages)
        .where(eq(ornamentsImages.id, imageId));
      await db.delete(ornamentsImages).where(eq(ornamentsImages.id, imageId));
      if (image) scheduleOrnamentRecognition(image.itemId);
    },
    deleteStorageImage: deleteImage,
    actionType: "delete_ornament_photo",
  }),

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

  ornament_ebay_price_lookup: (async (
    payload: z.infer<typeof OrnamentEbayPriceLookupActionPayload>,
    userId: number,
  ) => {
    if (!env.ebayAppId) {
      return { status: 503, body: { error: "eBay API not configured." } };
    }

    const EBAY_CACHE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

    const [item] = await db
      .select({
        id: ornamentsItems.id,
        name: ornamentsItems.name,
        brand: ornamentsItems.brand,
        seriesOrCollection: ornamentsItems.seriesOrCollection,
        year: ornamentsItems.year,
        barcodeValue: ornamentsItems.barcodeValue,
        ebayPriceCachedAt: ornamentsItems.ebayPriceCachedAt,
        ebayPriceMinUsd: ornamentsItems.ebayPriceMinUsd,
        ebayPriceMaxUsd: ornamentsItems.ebayPriceMaxUsd,
        ebayPriceListings: ornamentsItems.ebayPriceListings,
        ebayLastSoldPriceUsd: ornamentsItems.ebayLastSoldPriceUsd,
        ebayLastSoldDate: ornamentsItems.ebayLastSoldDate,
      })
      .from(ornamentsItems)
      .where(eq(ornamentsItems.id, payload.itemId));

    if (!item) {
      return { status: 404, body: { error: "Ornament not found." } };
    }

    const force = payload.force === true;
    const cacheAgeMs = item.ebayPriceCachedAt
      ? Date.now() - item.ebayPriceCachedAt.getTime()
      : Infinity;

    if (
      !force &&
      cacheAgeMs < EBAY_CACHE_STALE_AFTER_MS &&
      (item.ebayPriceMinUsd != null || item.ebayLastSoldPriceUsd != null)
    ) {
      const cachedListings = item.ebayPriceListings as unknown[] | null;
      const searchQuery = buildEbayQuery(item.name, {
        brand: item.brand,
        seriesOrCollection: item.seriesOrCollection,
        year: item.year,
      });
      return {
        status: 200,
        body: {
          type: "ornament_ebay_price_lookup",
          result: {
            forSale:
              item.ebayPriceMinUsd != null
                ? {
                    priceMinUsd: Number(item.ebayPriceMinUsd),
                    priceMaxUsd: item.ebayPriceMaxUsd
                      ? Number(item.ebayPriceMaxUsd)
                      : null,
                    listingCount: cachedListings?.length ?? 0,
                  }
                : null,
            lastSold: item.ebayLastSoldPriceUsd
              ? {
                  priceUsd: Number(item.ebayLastSoldPriceUsd),
                  soldDate: item.ebayLastSoldDate?.toISOString() ?? null,
                }
              : null,
            searchQuery,
            cachedAt: item.ebayPriceCachedAt!.toISOString(),
            fromCache: true,
          },
        },
      };
    }

    // Enforce the AI rate limit before triggering a paid Apify eBay scrape.
    const { limited } = await consumeAiRateLimit(userId);
    if (limited) {
      return {
        status: 429,
        body: { error: "Too many AI requests, please try again later." },
      };
    }

    const query = buildEbayQuery(item.name, {
      brand: item.brand,
      seriesOrCollection: item.seriesOrCollection,
      year: item.year,
    });

    let result: Awaited<ReturnType<typeof lookupOrnamentEbayData>>;
    try {
      result = await lookupOrnamentEbayData(query, {
        upc: item.barcodeValue ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 503,
        body: {
          error: `eBay lookup is temporarily unavailable. Please try again in a moment. (${msg.slice(0, 120)})`,
        },
      };
    }

    if (!result) {
      return {
        status: 422,
        body: { error: "No eBay listings found for this ornament." },
      };
    }

    await db
      .update(ornamentsItems)
      .set({
        ebayPriceMinUsd: result.forSale
          ? String(result.forSale.priceMinUsd)
          : null,
        ebayPriceMaxUsd: result.forSale
          ? String(result.forSale.priceMaxUsd)
          : null,
        ebayPriceMedianUsd: null,
        ebayPriceCachedAt: new Date(),
        ebayPriceListings: result.forSale
          ? (result.forSale.listings as unknown as Record<string, unknown>[])
          : null,
        ebayLastSoldPriceUsd: result.lastSold
          ? String(result.lastSold.priceUsd)
          : null,
        ebayLastSoldDate: result.lastSold?.soldDate
          ? new Date(result.lastSold.soldDate)
          : null,
      })
      .where(eq(ornamentsItems.id, payload.itemId));

    return {
      status: 200,
      body: {
        type: "ornament_ebay_price_lookup",
        result: {
          forSale: result.forSale
            ? {
                priceMinUsd: result.forSale.priceMinUsd,
                priceMaxUsd: result.forSale.priceMaxUsd,
                listingCount: result.forSale.listingCount,
              }
            : null,
          lastSold: result.lastSold
            ? {
                priceUsd: result.lastSold.priceUsd,
                soldDate: result.lastSold.soldDate,
                listingCount: result.lastSold.listingCount,
              }
            : null,
          searchQuery: result.searchQuery,
          cachedAt: result.cachedAt,
          fromCache: false,
        },
      },
    };
  }) as ActionExecutor,

  add_photo_to_ornaments: (async (
    payload: z.infer<typeof AddPhotoToOrnamentsPayload>,
    userId: number,
  ) => {
    // Enforce the AI rate limit before starting expensive vision/embedding
    // pipelines — same cap as the POST /items upload route.
    const { limited } = await consumeAiRateLimit(userId);
    if (limited) {
      return {
        status: 429,
        body: { error: "Too many AI requests, please try again later." },
      };
    }
    // Validate URL is from this application's Supabase storage to prevent SSRF
    if (!payload.attachmentUrl.startsWith(env.supabaseUrl + "/storage/")) {
      return {
        status: 400,
        body: {
          error: "Attachment URL is not from this application's storage",
        },
      };
    }
    let buffer: Buffer;
    try {
      const response = await fetch(payload.attachmentUrl);
      if (!response.ok) {
        return {
          status: 502,
          body: { error: "Failed to fetch attachment from storage" },
        };
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } catch {
      return {
        status: 502,
        body: { error: "Failed to fetch attachment from storage" },
      };
    }
    try {
      const result = await createOrnamentItemFromBuffer(userId, buffer);
      return {
        status: 201,
        body: { type: "add_photo_to_ornaments", result },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const rawStatus = (err as { status?: unknown }).status;
      const errStatus =
        typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600
          ? rawStatus
          : 500;
      return { status: errStatus, body: { error: message } };
    }
  }) as ActionExecutor,

  suggest_and_create_ornament_categories: (async (
    _payload: z.infer<typeof SuggestAndCreateOrnamentCategoriesActionPayload>,
    userId: number,
  ) => {
    // Enforce the AI rate limit before triggering the paid category-naming
    // call — same cap as the web POST /categories/suggest route (aiLimiter).
    const { limited } = await consumeAiRateLimit(userId);
    if (limited) {
      return {
        status: 429,
        body: { error: "Too many AI requests, please try again later." },
      };
    }

    const suggestedNames = await suggestOrnamentCategories();
    if (suggestedNames.length === 0) {
      return {
        status: 200,
        body: {
          type: "suggest_and_create_ornament_categories",
          result: {
            suggestedNames: [],
            createdCount: 0,
            assignmentsCreated: 0,
          },
        },
      };
    }
    const result = await createAndBackfillOrnamentCategories(
      userId,
      suggestedNames,
    );
    return {
      status: 200,
      body: {
        type: "suggest_and_create_ornament_categories",
        result: {
          suggestedNames,
          createdCount: result.createdCount,
          assignmentsCreated: result.assignmentsCreated,
        },
      },
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
    case "add_photo_to_ornaments": {
      return "Add this photo to your ornaments collection (runs full AI cataloguing)";
    }
    case "ornament_ebay_price_lookup": {
      const payload = action.payload as z.infer<
        typeof OrnamentEbayPriceLookupActionPayload
      >;
      const item = await getOrnamentItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this ornament";
      return payload.force
        ? `Refresh eBay prices for ${name} (bypasses cache)`
        : `Look up eBay prices for ${name}`;
    }
    case "suggest_and_create_ornament_categories": {
      return "Analyze the ornament collection for recurring themes, propose new categories, then create the proposed ones and assign them to every matching ornament";
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
          'Propose editing an EXISTING ornament in the user\'s collection, e.g. "rename that ornament" or "note that it has a chip" — also use this right after an upload to fill in metadata like seriesOrCollection, year, brand, origin, or dimensions if the user tells you those details in chat. Only call this if the item\'s numeric id is visible on screen (look for "itemId: <number>"); never guess an id. Include only the field(s) that actually change.',
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
    {
      type: "function",
      function: {
        name: "add_photo_to_ornaments",
        description:
          "Propose adding the photo the user already attached to this message straight into their ornaments collection — runs the exact same full AI cataloguing pipeline (name, series/collection, year, UPC lookup, eBay market value, colours, description) as uploading via the Ornaments page. ONLY call this when the user explicitly asks to add or save the attached photo to their ornaments collection. Pass the exact signed URL of the attached image as attachmentUrl. Never call this automatically, speculatively, or without a clear user request.",
        parameters: {
          type: "object",
          properties: {
            attachmentUrl: {
              type: "string",
              description:
                "The exact signed URL of the image the user attached to this message",
            },
          },
          required: ["attachmentUrl"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ornament_ebay_price_lookup",
        description:
          "Look up current eBay prices for an ornament the user is viewing — returns both for-sale listing prices and the most recent sold price. Returns the cached result unless force is true. Pass force: true when the user explicitly asks to refresh, get fresh/current/updated prices, or says the price has changed — otherwise omit it (or pass false) to use the 7-day cache. Only call this if the item's numeric id is visible on screen; never guess an id.",
        parameters: {
          type: "object",
          properties: {
            itemId: {
              type: "integer",
              description: "Numeric id of the ornament to look up",
            },
            force: {
              type: "boolean",
              description:
                "Pass true to bypass the 7-day cache and fetch fresh eBay data. Only set this when the user explicitly requests a refresh or says prices have changed.",
            },
          },
          required: ["itemId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "suggest_and_create_ornament_categories",
        description:
          'Propose analyzing the whole ornaments collection (names, series, motifs, colors, brand, notes) to come up with new category names that reflect recurring themes actually in the data, then create the proposed categories and immediately assign every existing matching ornament to them — e.g. "suggest and create some ornament categories" or "organize my ornaments into categories". Names that already match an existing category are skipped automatically. Takes no parameters.',
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ];
