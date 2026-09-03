import { z } from "zod/v4";
import { and, eq, isNull } from "drizzle-orm";
import type OpenAI from "openai";
import {
  createLockFieldExecutor,
  createUpdateItemCategoriesExecutor,
  createDeletePhotoExecutor,
  type ActionExecutor,
} from "./collection-action-helpers";
import {
  db,
  magnetsItems,
  magnetsCategories,
  magnetsItemCategories,
  magnetsImages,
} from "@workspace/db";
import { getCategoryPalette } from "@workspace/web-core/colors";
import { analyzeMagnetImage } from "../lib/magnets/openai";
import { deleteImage } from "../lib/magnets/storage";
import { resolveOrCreateMagnetCategories } from "../lib/magnets/resolve-categories";
import { logActivity } from "../lib/soft-delete";
import { env } from "../lib/env";
import { consumeAiRateLimit } from "../middleware/rateLimit";

// Elaine's write-actions for the Magnets app. Camera Bulk Add is browser-only
// (requires live camera attachment) and is NOT offered here — Elaine can
// update/delete existing items, manage their photos/categories, manage
// categories overall, and reanalyze items instead.
//
// Magnets is a fully household-shared collection like pottery/quilting/ornaments:
// every authenticated user may view/edit/delete every item. Executors here
// intentionally do NOT filter by userId beyond what the equivalent REST routes
// already do.

const LOCKABLE_FIELDS = ["name", "description"] as const;

export const UpdateMagnetItemActionPayload = z
  .object({
    itemId: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    notes: z.string().max(4000).optional(),
    description: z.string().max(4000).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.notes !== undefined ||
      v.description !== undefined,
    { message: "At least one field to update must be provided" },
  );

export const DeleteMagnetItemActionPayload = z.object({
  itemId: z.number().int().positive(),
});

export const CreateMagnetCategoryActionPayload = z.object({
  name: z.string().min(1).max(100),
});

export const DeleteMagnetCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
});

export const RenameMagnetCategoryActionPayload = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().min(1).max(100),
});

export const MergeMagnetCategoriesActionPayload = z.object({
  categoryId: z.number().int().positive(),
  intoCategoryId: z.number().int().positive(),
});

export const LockMagnetFieldActionPayload = z.object({
  itemId: z.number().int().positive(),
  field: z.enum(LOCKABLE_FIELDS),
  locked: z.boolean(),
});

export const UpdateMagnetItemCategoriesActionPayload = z.object({
  itemId: z.number().int().positive(),
  categoryIds: z.array(z.number().int().positive()),
});

export const DeleteMagnetPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const PromoteMagnetPhotoActionPayload = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export const ReanalyzeMagnetActionPayload = z.object({
  itemId: z.number().int().positive(),
});

export const AddPhotoToMagnetsPayload = z.object({
  attachmentUrl: z.string().url().max(2000),
});

export const magnetActionSchemas = [
  z.object({
    type: z.literal("update_magnet_item"),
    payload: UpdateMagnetItemActionPayload,
  }),
  z.object({
    type: z.literal("delete_magnet_item"),
    payload: DeleteMagnetItemActionPayload,
  }),
  z.object({
    type: z.literal("create_magnet_category"),
    payload: CreateMagnetCategoryActionPayload,
  }),
  z.object({
    type: z.literal("delete_magnet_category"),
    payload: DeleteMagnetCategoryActionPayload,
  }),
  z.object({
    type: z.literal("rename_magnet_category"),
    payload: RenameMagnetCategoryActionPayload,
  }),
  z.object({
    type: z.literal("merge_magnet_categories"),
    payload: MergeMagnetCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("lock_magnet_field"),
    payload: LockMagnetFieldActionPayload,
  }),
  z.object({
    type: z.literal("update_magnet_item_categories"),
    payload: UpdateMagnetItemCategoriesActionPayload,
  }),
  z.object({
    type: z.literal("delete_magnet_photo"),
    payload: DeleteMagnetPhotoActionPayload,
  }),
  z.object({
    type: z.literal("promote_magnet_photo"),
    payload: PromoteMagnetPhotoActionPayload,
  }),
  z.object({
    type: z.literal("reanalyze_magnet"),
    payload: ReanalyzeMagnetActionPayload,
  }),
  z.object({
    type: z.literal("add_photo_to_magnets"),
    payload: AddPhotoToMagnetsPayload,
  }),
] as const;

export type MagnetActionType =
  | "update_magnet_item"
  | "delete_magnet_item"
  | "create_magnet_category"
  | "delete_magnet_category"
  | "rename_magnet_category"
  | "merge_magnet_categories"
  | "lock_magnet_field"
  | "update_magnet_item_categories"
  | "delete_magnet_photo"
  | "promote_magnet_photo"
  | "reanalyze_magnet"
  | "add_photo_to_magnets";

async function getMagnetItemLabelInfo(
  itemId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: magnetsItems.name })
    .from(magnetsItems)
    .where(eq(magnetsItems.id, itemId));
  return row ?? null;
}

async function getMagnetCategoryLabelInfo(
  categoryId: number,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: magnetsCategories.name })
    .from(magnetsCategories)
    .where(eq(magnetsCategories.id, categoryId));
  return row ?? null;
}

export const magnetActionExecutors: Record<MagnetActionType, ActionExecutor> = {
  update_magnet_item: (async (
    payload: z.infer<typeof UpdateMagnetItemActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: magnetsItems.id })
      .from(magnetsItems)
      .where(eq(magnetsItems.id, payload.itemId));
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    const updates: Partial<typeof magnetsItems.$inferInsert> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.description !== undefined)
      updates.description = payload.description;

    const [row] = await db
      .update(magnetsItems)
      .set(updates)
      .where(eq(magnetsItems.id, payload.itemId))
      .returning();
    return {
      status: 200,
      body: { type: "update_magnet_item", result: row },
    };
  }) as ActionExecutor,

  delete_magnet_item: (async (
    payload: z.infer<typeof DeleteMagnetItemActionPayload>,
    userId: number,
  ) => {
    const [item] = await db
      .select({ id: magnetsItems.id })
      .from(magnetsItems)
      .where(
        and(
          eq(magnetsItems.id, payload.itemId),
          isNull(magnetsItems.deletedAt),
        ),
      );
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const now = new Date();
    await db
      .update(magnetsImages)
      .set({ deletedAt: now })
      .where(eq(magnetsImages.itemId, payload.itemId));
    await db
      .update(magnetsItems)
      .set({ deletedAt: now })
      .where(eq(magnetsItems.id, payload.itemId));
    void logActivity({
      actorUserId: userId,
      actorChannel: "elaine",
      actionType: "delete_magnet_item",
      entityType: "magnet",
      entityId: payload.itemId,
      reversible: true,
    });
    return {
      status: 200,
      body: { type: "delete_magnet_item", result: { id: payload.itemId } },
    };
  }) as ActionExecutor,

  create_magnet_category: (async (
    payload: z.infer<typeof CreateMagnetCategoryActionPayload>,
    userId: number,
  ) => {
    await db
      .insert(magnetsCategories)
      .values({
        name: payload.name,
        userId,
        ...getCategoryPalette(payload.name),
      })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(magnetsCategories)
      .where(eq(magnetsCategories.name, payload.name));
    return {
      status: 201,
      body: { type: "create_magnet_category", result: row },
    };
  }) as ActionExecutor,

  delete_magnet_category: (async (
    payload: z.infer<typeof DeleteMagnetCategoryActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: magnetsCategories.id })
      .from(magnetsCategories)
      .where(eq(magnetsCategories.id, payload.categoryId));
    if (!existing)
      return { status: 404, body: { error: "Category not found" } };
    await db
      .delete(magnetsCategories)
      .where(eq(magnetsCategories.id, payload.categoryId));
    return {
      status: 200,
      body: {
        type: "delete_magnet_category",
        result: { id: payload.categoryId },
      },
    };
  }) as ActionExecutor,

  rename_magnet_category: (async (
    payload: z.infer<typeof RenameMagnetCategoryActionPayload>,
  ) => {
    const [existing] = await db
      .select({ id: magnetsCategories.id })
      .from(magnetsCategories)
      .where(eq(magnetsCategories.id, payload.categoryId));
    if (!existing)
      return { status: 404, body: { error: "Category not found" } };
    const [row] = await db
      .update(magnetsCategories)
      .set({ name: payload.name })
      .where(eq(magnetsCategories.id, payload.categoryId))
      .returning();
    return {
      status: 200,
      body: { type: "rename_magnet_category", result: row },
    };
  }) as ActionExecutor,

  merge_magnet_categories: (async (
    payload: z.infer<typeof MergeMagnetCategoriesActionPayload>,
  ) => {
    if (payload.categoryId === payload.intoCategoryId) {
      return {
        status: 400,
        body: { error: "Cannot merge a category into itself." },
      };
    }
    const [source, target] = await Promise.all([
      db
        .select({ id: magnetsCategories.id })
        .from(magnetsCategories)
        .where(eq(magnetsCategories.id, payload.categoryId))
        .then((r) => r[0]),
      db
        .select({ id: magnetsCategories.id })
        .from(magnetsCategories)
        .where(eq(magnetsCategories.id, payload.intoCategoryId))
        .then((r) => r[0]),
    ]);
    if (!source || !target) {
      return { status: 404, body: { error: "Category not found" } };
    }

    const sourceItems = await db
      .select({ itemId: magnetsItemCategories.itemId })
      .from(magnetsItemCategories)
      .where(eq(magnetsItemCategories.categoryId, payload.categoryId));

    if (sourceItems.length > 0) {
      await db
        .insert(magnetsItemCategories)
        .values(
          sourceItems.map((r) => ({
            itemId: r.itemId,
            categoryId: payload.intoCategoryId,
          })),
        )
        .onConflictDoNothing();
    }

    await db
      .delete(magnetsCategories)
      .where(eq(magnetsCategories.id, payload.categoryId));

    return {
      status: 200,
      body: {
        type: "merge_magnet_categories",
        result: {
          categoryId: payload.categoryId,
          intoCategoryId: payload.intoCategoryId,
        },
      },
    };
  }) as ActionExecutor,

  lock_magnet_field: createLockFieldExecutor({
    fetchLockedFields: async (itemId) => {
      const [r] = await db
        .select({ lockedFields: magnetsItems.lockedFields })
        .from(magnetsItems)
        .where(eq(magnetsItems.id, itemId));
      return r ?? null;
    },
    updateLockedFields: async (itemId, fields) => {
      const [r] = await db
        .update(magnetsItems)
        .set({ lockedFields: fields })
        .where(eq(magnetsItems.id, itemId))
        .returning();
      return r;
    },
    actionType: "lock_magnet_field",
  }),

  update_magnet_item_categories: createUpdateItemCategoriesExecutor({
    fetchItem: async (itemId) => {
      const [r] = await db
        .select({ id: magnetsItems.id })
        .from(magnetsItems)
        .where(eq(magnetsItems.id, itemId));
      return r ?? null;
    },
    fetchAllCategoryIds: async () => {
      const rows = await db
        .select({ id: magnetsCategories.id })
        .from(magnetsCategories);
      return rows.map((r) => r.id);
    },
    replaceItemCategories: async (itemId, safeCategoryIds) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(magnetsItemCategories)
          .where(eq(magnetsItemCategories.itemId, itemId));
        if (safeCategoryIds.length > 0) {
          await tx
            .insert(magnetsItemCategories)
            .values(
              safeCategoryIds.map((categoryId) => ({ itemId, categoryId })),
            );
        }
      });
    },
    actionType: "update_magnet_item_categories",
  }),

  delete_magnet_photo: createDeletePhotoExecutor({
    fetchItem: async (itemId) => {
      const [r] = await db
        .select({ id: magnetsItems.id })
        .from(magnetsItems)
        .where(eq(magnetsItems.id, itemId));
      return r ?? null;
    },
    fetchImage: async (imageId) => {
      const [r] = await db
        .select({
          storagePath: magnetsImages.storagePath,
          itemId: magnetsImages.itemId,
        })
        .from(magnetsImages)
        .where(eq(magnetsImages.id, imageId));
      return r ?? null;
    },
    deleteDbImage: async (imageId) => {
      await db
        .update(magnetsImages)
        .set({ deletedAt: new Date() })
        .where(eq(magnetsImages.id, imageId));
    },
    deleteStorageImage: deleteImage,
    actionType: "delete_magnet_photo",
  }),

  promote_magnet_photo: (async (
    payload: z.infer<typeof PromoteMagnetPhotoActionPayload>,
  ) => {
    const [item] = await db
      .select({ id: magnetsItems.id, imagePath: magnetsItems.imagePath })
      .from(magnetsItems)
      .where(eq(magnetsItems.id, payload.itemId));
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const [img] = await db
      .select({
        storagePath: magnetsImages.storagePath,
        itemId: magnetsImages.itemId,
      })
      .from(magnetsImages)
      .where(
        and(
          eq(magnetsImages.id, payload.imageId),
          isNull(magnetsImages.deletedAt),
        ),
      );
    if (!img || img.itemId !== payload.itemId) {
      return { status: 404, body: { error: "Photo not found" } };
    }

    const [updated] = await db
      .update(magnetsItems)
      .set({ imagePath: img.storagePath })
      .where(eq(magnetsItems.id, payload.itemId))
      .returning();

    return {
      status: 200,
      body: { type: "promote_magnet_photo", result: updated },
    };
  }) as ActionExecutor,

  reanalyze_magnet: (async (
    payload: z.infer<typeof ReanalyzeMagnetActionPayload>,
    userId: number,
  ) => {
    const { limited } = await consumeAiRateLimit(userId);
    if (limited) {
      return {
        status: 429,
        body: { error: "Too many AI requests, please try again later." },
      };
    }

    const [row] = await db
      .select()
      .from(magnetsItems)
      .where(eq(magnetsItems.id, payload.itemId));
    if (!row || row.deletedAt) {
      return { status: 404, body: { error: "Magnet not found." } };
    }
    if (!row.imagePath) {
      return {
        status: 422,
        body: { error: "This magnet has no primary image to analyse." },
      };
    }

    // Collect supplemental image paths (up to 5, same cap as REST route)
    const MAX_REANALYZE_IMAGES = 5;
    const supplementalRows = await db
      .select({ storagePath: magnetsImages.storagePath })
      .from(magnetsImages)
      .where(
        and(
          eq(magnetsImages.itemId, payload.itemId),
          isNull(magnetsImages.deletedAt),
        ),
      );

    const allPaths = [
      row.imagePath,
      ...supplementalRows.map((r) => r.storagePath),
    ].slice(0, MAX_REANALYZE_IMAGES);

    const { downloadImageAsDataUrl } = await import("../lib/magnets/storage");
    const settled = await Promise.allSettled(
      allPaths.map(downloadImageAsDataUrl),
    );
    const dataUrls = settled
      .filter(
        (s): s is PromiseFulfilledResult<string> => s.status === "fulfilled",
      )
      .map((s) => s.value);

    if (dataUrls.length === 0) {
      return {
        status: 422,
        body: { error: "Could not load any image for this magnet." },
      };
    }

    const lockedFields = (row.lockedFields as string[]) ?? [];
    const analysis = await analyzeMagnetImage(dataUrls, lockedFields);

    const updates: Record<string, unknown> = {};
    if (!lockedFields.includes("name")) updates.name = analysis.name;
    if (!lockedFields.includes("description"))
      updates.description = analysis.description;

    if (Object.keys(updates).length > 0) {
      await db
        .update(magnetsItems)
        .set(updates)
        .where(eq(magnetsItems.id, payload.itemId));
    }
    if (analysis.categories.length > 0) {
      const categoryIds = await resolveOrCreateMagnetCategories(
        analysis.categories,
        userId,
      );
      if (categoryIds.length > 0) {
        await db
          .insert(magnetsItemCategories)
          .values(
            categoryIds.map((categoryId) => ({
              itemId: payload.itemId,
              categoryId,
            })),
          )
          .onConflictDoNothing();
      }
    }

    const [updated] = await db
      .select()
      .from(magnetsItems)
      .where(eq(magnetsItems.id, payload.itemId));

    return {
      status: 200,
      body: { type: "reanalyze_magnet", result: updated },
    };
  }) as ActionExecutor,

  add_photo_to_magnets: (async (
    payload: z.infer<typeof AddPhotoToMagnetsPayload>,
    userId: number,
  ) => {
    // Enforce the AI rate limit before starting expensive vision pipeline —
    // same cap as the REST upload route.
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

    // Use the same pipeline as the magnets route: strip metadata, upload,
    // run AI vision, resolve/create categories.
    try {
      const { sniffAndValidateMime, isImageMimeType, stripMetadata } =
        await import("@workspace/upload-validation");
      const { uploadImage, downloadImageAsDataUrl } =
        await import("../lib/magnets/storage");
      const { resolveOrCreateMagnetCategories } =
        await import("../lib/magnets/resolve-categories");

      let sniffedType: ReturnType<typeof sniffAndValidateMime>;
      try {
        sniffedType = sniffAndValidateMime(buffer, "image/jpeg");
      } catch {
        return {
          status: 400,
          body: {
            error:
              "Unsupported image. Please attach a JPEG, PNG, or WEBP photo.",
          },
        };
      }
      if (!isImageMimeType(sniffedType)) {
        return {
          status: 400,
          body: {
            error:
              "Unsupported image. Please attach a JPEG, PNG, or WEBP photo.",
          },
        };
      }
      const contentType = sniffedType;
      const cleanBuffer = await stripMetadata(buffer, contentType);

      const storagePath = await uploadImage(cleanBuffer, contentType);

      // Insert the item and its primary image in a single transaction.
      let itemId: number;
      {
        const [itemRow] = await db
          .insert(magnetsItems)
          .values({ userId, name: "Untitled magnet" })
          .returning();
        itemId = itemRow.id;
        await db
          .insert(magnetsImages)
          .values({ itemId, storagePath, position: 0 });
        await db
          .update(magnetsItems)
          .set({ imagePath: storagePath })
          .where(eq(magnetsItems.id, itemId));
      }

      // Run AI vision analysis.
      const dataUrl = await downloadImageAsDataUrl(storagePath);
      const analysis = await analyzeMagnetImage([dataUrl], []);

      const updates: Record<string, unknown> = {
        name: analysis.name,
        description: analysis.description ?? null,
      };
      await db
        .update(magnetsItems)
        .set(updates)
        .where(eq(magnetsItems.id, itemId));

      if (analysis.categories.length > 0) {
        const suggestedIds = await resolveOrCreateMagnetCategories(
          analysis.categories,
          userId,
        );
        if (suggestedIds.length > 0) {
          await db
            .insert(magnetsItemCategories)
            .values(suggestedIds.map((categoryId) => ({ itemId, categoryId })))
            .onConflictDoNothing();
        }
      }

      const [finalRow] = await db
        .select()
        .from(magnetsItems)
        .where(eq(magnetsItems.id, itemId));

      return {
        status: 201,
        body: { type: "add_photo_to_magnets", result: finalRow },
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
};

export async function buildMagnetActionLabel(action: {
  type: MagnetActionType;
  payload: unknown;
}): Promise<string> {
  switch (action.type) {
    case "update_magnet_item": {
      const payload = action.payload as z.infer<
        typeof UpdateMagnetItemActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Update ${name} in your magnets collection`;
    }
    case "delete_magnet_item": {
      const payload = action.payload as z.infer<
        typeof DeleteMagnetItemActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Delete ${name} from your magnets collection`;
    }
    case "create_magnet_category": {
      const payload = action.payload as z.infer<
        typeof CreateMagnetCategoryActionPayload
      >;
      return `Create the magnets category "${payload.name}"`;
    }
    case "delete_magnet_category": {
      const payload = action.payload as z.infer<
        typeof DeleteMagnetCategoryActionPayload
      >;
      const cat = await getMagnetCategoryLabelInfo(payload.categoryId);
      const name = cat ? `"${cat.name}"` : "this category";
      return `Delete the magnets category ${name}`;
    }
    case "rename_magnet_category": {
      const payload = action.payload as z.infer<
        typeof RenameMagnetCategoryActionPayload
      >;
      const cat = await getMagnetCategoryLabelInfo(payload.categoryId);
      const from = cat ? `"${cat.name}"` : "this category";
      return `Rename the magnets category ${from} to "${payload.name}"`;
    }
    case "merge_magnet_categories": {
      const payload = action.payload as z.infer<
        typeof MergeMagnetCategoriesActionPayload
      >;
      const [source, target] = await Promise.all([
        getMagnetCategoryLabelInfo(payload.categoryId),
        getMagnetCategoryLabelInfo(payload.intoCategoryId),
      ]);
      const sourceName = source ? `"${source.name}"` : "that category";
      const targetName = target ? `"${target.name}"` : "the other category";
      return `Merge the category ${sourceName} into ${targetName}`;
    }
    case "lock_magnet_field": {
      const payload = action.payload as z.infer<
        typeof LockMagnetFieldActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return payload.locked
        ? `Lock the ${payload.field} field on ${name} so AI re-analysis can't overwrite it`
        : `Unlock the ${payload.field} field on ${name}`;
    }
    case "update_magnet_item_categories": {
      const payload = action.payload as z.infer<
        typeof UpdateMagnetItemCategoriesActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Update the categories assigned to ${name}`;
    }
    case "delete_magnet_photo": {
      const payload = action.payload as z.infer<
        typeof DeleteMagnetPhotoActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Delete a photo from ${name}`;
    }
    case "promote_magnet_photo": {
      const payload = action.payload as z.infer<
        typeof PromoteMagnetPhotoActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Make that photo the primary photo for ${name}`;
    }
    case "reanalyze_magnet": {
      const payload = action.payload as z.infer<
        typeof ReanalyzeMagnetActionPayload
      >;
      const item = await getMagnetItemLabelInfo(payload.itemId);
      const name = item ? `"${item.name}"` : "this magnet";
      return `Run AI re-analysis on ${name}`;
    }
    case "add_photo_to_magnets": {
      return "Add this photo to your magnets collection (runs full AI cataloguing)";
    }
  }
}

export const magnetActionTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "update_magnet_item",
      description:
        'Propose editing an EXISTING magnet in the user\'s collection, e.g. "rename that magnet" or "add a note about this souvenir". Only call this if the item\'s numeric id is visible on screen (look for "itemId: <number>"); never guess an id. Include only the field(s) that actually change.',
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "integer" },
          name: { type: "string" },
          notes: { type: "string" },
          description: { type: "string" },
        },
        required: ["itemId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_magnet_item",
      description:
        "Propose permanently deleting a magnet and its photo(s). Only call this if the item's numeric id is visible on screen; never guess an id. Since this is destructive, say clearly in your visible reply that this will DELETE the magnet.",
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
      name: "create_magnet_category",
      description:
        'Propose creating a new magnets category to organize the collection, e.g. "add a Landmarks category".',
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
      name: "delete_magnet_category",
      description:
        "Propose permanently deleting a magnets category. Only call this if the category's numeric id is visible on screen; never guess an id.",
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
      name: "rename_magnet_category",
      description:
        "Propose renaming an existing magnets category, e.g. \"rename 'Destinations' to 'Places Visited'\". Only call this if the category's numeric id is visible on screen; never guess an id.",
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
      name: "merge_magnet_categories",
      description:
        'Propose merging one magnets category into another, e.g. "merge Destinations into Places Visited" — reassigns all items then deletes the source category. Only call this if both category ids are visible on screen; never guess an id.',
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
      name: "lock_magnet_field",
      description:
        "Propose locking or unlocking an AI-derived field on a magnet so future AI re-analysis will (locked) or won't (unlocked) overwrite it, e.g. \"lock the name on this magnet\". Only call this if the item's numeric id is visible on screen; never guess an id.",
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
      name: "update_magnet_item_categories",
      description:
        "Propose replacing the full set of categories assigned to a magnet. Pass the complete list of category ids that should be assigned (this replaces the existing set, it does not append). Only call this if the item's numeric id and the category ids are visible on screen; never guess an id.",
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
      name: "delete_magnet_photo",
      description:
        "Propose deleting one supplemental photo from a magnet. Only call this if both the item's and photo's numeric ids are visible on screen; never guess an id.",
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
      name: "promote_magnet_photo",
      description:
        "Propose making a supplemental photo the new primary photo for a magnet. Only call this if both the item's and photo's numeric ids are visible on screen; never guess an id.",
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
      name: "reanalyze_magnet",
      description:
        "Propose running AI re-analysis on a single magnet to refresh its name, description, and categories from its photo(s). Only call this if the item's numeric id is visible on screen; never guess an id.",
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
      name: "add_photo_to_magnets",
      description:
        "Propose adding the photo the user already attached to this message straight into their magnets collection — runs the exact same full AI cataloguing pipeline (name, description, categories) as uploading via the Magnets page. ONLY call this when the user explicitly asks to add or save the attached photo to their magnets collection. Pass the exact signed URL of the attached image as attachmentUrl. Never call this automatically, speculatively, or without a clear user request. Camera Bulk Add is a separate browser-only feature — not available here.",
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
];
