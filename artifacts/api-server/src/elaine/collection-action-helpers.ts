/**
 * Shared action-executor builder helpers for household-collection domains
 * (currently Pottery and Ornaments, but extensible to future domains).
 *
 * Each builder accepts domain-specific async callbacks that wrap the Drizzle
 * table operations, so the shared control-flow logic (guard checks, set
 * manipulation, transaction structure, storage cleanup) lives in one place.
 * Any security or consistency fix to a shared pattern automatically applies to
 * every domain that uses the builder.
 *
 * Usage:
 *   const lockField = createLockFieldExecutor({
 *     fetchLockedFields: (id) => db.select({lockedFields: items.lockedFields}).from(items).where(eq(items.id, id)).then(r => r[0] ?? null),
 *     updateLockedFields: (id, fields) => db.update(items).set({lockedFields: fields}).where(eq(items.id, id)),
 *     actionType: "lock_pottery_field",
 *   });
 */

/** Shared executor signature used in every domain action map. */
export type ActionExecutor = (
  payload: never,
  userId: number,
) => Promise<{ status: number; body: unknown }>;

// ---------------------------------------------------------------------------
// Generic DB label helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the name of an entity (item or category) for use in user-visible
 * action labels. Returns null if the entity no longer exists.
 */
export async function fetchEntityName(
  query: () => Promise<{ name: string } | undefined>,
): Promise<{ name: string } | null> {
  return (await query()) ?? null;
}

// ---------------------------------------------------------------------------
// lock_field executor builder
// ---------------------------------------------------------------------------

interface LockFieldConfig {
  fetchLockedFields: (
    itemId: number,
  ) => Promise<{ lockedFields: string[] | null } | null>;
  updateLockedFields: (itemId: number, fields: string[]) => Promise<unknown>;
  actionType: string;
}

export function createLockFieldExecutor(
  config: LockFieldConfig,
): ActionExecutor {
  return (async (payload: {
    itemId: number;
    field: string;
    locked: boolean;
  }) => {
    const existing = await config.fetchLockedFields(payload.itemId);
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    const current = new Set(existing.lockedFields ?? []);
    if (payload.locked) current.add(payload.field);
    else current.delete(payload.field);

    const result = await config.updateLockedFields(payload.itemId, [
      ...current,
    ]);
    return { status: 200, body: { type: config.actionType, result } };
  }) as ActionExecutor;
}

// ---------------------------------------------------------------------------
// update_item_categories executor builder
// ---------------------------------------------------------------------------

interface UpdateItemCategoriesConfig {
  fetchItem: (itemId: number) => Promise<{ id: number } | null>;
  fetchAllCategoryIds: () => Promise<number[]>;
  replaceItemCategories: (
    itemId: number,
    categoryIds: number[],
  ) => Promise<void>;
  actionType: string;
}

export function createUpdateItemCategoriesExecutor(
  config: UpdateItemCategoriesConfig,
): ActionExecutor {
  return (async (payload: { itemId: number; categoryIds: number[] }) => {
    const existing = await config.fetchItem(payload.itemId);
    if (!existing) return { status: 404, body: { error: "Item not found" } };

    const allCatIds = new Set(await config.fetchAllCategoryIds());
    const safeCategoryIds = payload.categoryIds.filter((id) =>
      allCatIds.has(id),
    );

    await config.replaceItemCategories(payload.itemId, safeCategoryIds);

    return {
      status: 200,
      body: {
        type: config.actionType,
        result: { itemId: payload.itemId, categoryIds: safeCategoryIds },
      },
    };
  }) as ActionExecutor;
}

// ---------------------------------------------------------------------------
// delete_photo executor builder
// ---------------------------------------------------------------------------

interface DeletePhotoConfig {
  fetchItem: (itemId: number) => Promise<{ id: number } | null>;
  fetchImage: (
    imageId: number,
  ) => Promise<{ storagePath: string; itemId: number } | null>;
  deleteDbImage: (imageId: number) => Promise<void>;
  deleteStorageImage: (storagePath: string) => Promise<void>;
  actionType: string;
}

export function createDeletePhotoExecutor(
  config: DeletePhotoConfig,
): ActionExecutor {
  return (async (payload: { itemId: number; imageId: number }) => {
    const item = await config.fetchItem(payload.itemId);
    if (!item) return { status: 404, body: { error: "Item not found" } };

    const imageRow = await config.fetchImage(payload.imageId);
    if (!imageRow || imageRow.itemId !== payload.itemId)
      return { status: 404, body: { error: "Photo not found" } };

    await config.deleteDbImage(payload.imageId);
    await config.deleteStorageImage(imageRow.storagePath).catch(() => {});

    return {
      status: 200,
      body: {
        type: config.actionType,
        result: { itemId: payload.itemId, imageId: payload.imageId },
      },
    };
  }) as ActionExecutor;
}
