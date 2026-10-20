import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { sizeCategoryKey } from "../../lib/pottery/size-label";
import {
  db,
  potteryCategories as cats,
  potteryItemCategories as joinTable,
} from "@workspace/db";
import {
  ListPotteryCategoriesResponse,
  ListPotteryCategoriesResponseItem,
  CreatePotteryCategoryBody,
  DeletePotteryCategoryParams,
  RenamePotteryCategoryParams,
  RenamePotteryCategoryBody,
  MergePotteryCategoryBody,
  UpdatePotteryCategoryColorsBody,
  UpdatePotteryCategoryColorsParams,
} from "@workspace/api-zod";
import {
  buildCategoryRouter,
  normalizeCategoryNameSimple,
  type CategoryOps,
} from "../../lib/category-router-factory";
import { createCategoryCountOps } from "../../lib/collection-category-ops";

// ---------------------------------------------------------------------------
// Domain-specific DB ops
// ---------------------------------------------------------------------------

const ops: CategoryOps = {
  ...createCategoryCountOps(cats, joinTable, joinTable.itemId),

  async create(userId, name, bgColor, textColor) {
    const [row] = await db
      .insert(cats)
      .values({ userId, name, bgColor, textColor })
      .returning({ id: cats.id });
    return row.id;
  },

  async rename(id, name) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('pottery-size-category'))`,
      );
      const [updated] = await tx
        .update(cats)
        .set({ name })
        .where(eq(cats.id, id))
        .returning({ id: cats.id });
      if (updated) {
        const renamedKey = sizeCategoryKey(name);
        await tx
          .update(joinTable)
          .set({ automaticSizeKey: null })
          .where(
            and(
              eq(joinTable.categoryId, id),
              renamedKey
                ? ne(joinTable.automaticSizeKey, renamedKey)
                : isNotNull(joinTable.automaticSizeKey),
            ),
          );
      }
      return !!updated;
    });
  },

  async updateColors(id, bgColor, textColor) {
    const [updated] = await db
      .update(cats)
      .set({ bgColor, textColor })
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!updated;
  },

  async deleteById(id) {
    const [row] = await db
      .delete(cats)
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!row;
  },

  async categoryExists(id) {
    const [row] = await db
      .select({ id: cats.id })
      .from(cats)
      .where(eq(cats.id, id));
    return !!row;
  },

  async getAssignmentsForCategory(categoryId) {
    return db
      .select({ itemId: joinTable.itemId })
      .from(joinTable)
      .where(eq(joinTable.categoryId, categoryId));
  },

  async reattachAssignments(assignments, targetId) {
    const rows = assignments as { itemId: number }[];
    if (rows.length === 0) return;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('pottery-size-category'))`,
      );
      await tx
        .insert(joinTable)
        .values(
          rows.map((r) => ({
            itemId: r.itemId,
            categoryId: targetId,
            automaticSizeKey: null,
          })),
        )
        .onConflictDoUpdate({
          target: [joinTable.itemId, joinTable.categoryId],
          set: { automaticSizeKey: null },
        });
    });
  },

  async deleteCategoryRow(id) {
    await db.delete(cats).where(eq(cats.id, id));
  },
};

// ---------------------------------------------------------------------------
// Build router + exported helpers for Elaine actions
// ---------------------------------------------------------------------------

const { router, merge } = buildCategoryRouter({
  ops,
  normalize: normalizeCategoryNameSimple,
  schemas: {
    listResponse: ListPotteryCategoriesResponse,
    listItem: ListPotteryCategoriesResponseItem,
    createBody: CreatePotteryCategoryBody,
    deleteParams: DeletePotteryCategoryParams,
    renameParams: RenamePotteryCategoryParams,
    renameBody: RenamePotteryCategoryBody,
    mergeBody: MergePotteryCategoryBody,
    mergeSourceIdField: "intoId",
    updateColorsBody: UpdatePotteryCategoryColorsBody,
    updateColorsParams: UpdatePotteryCategoryColorsParams,
  },
  mergeResponse: "no-content",
});

/**
 * Merge pottery category `id` into category `intoId`.
 * Shared by the REST route and Elaine's merge_pottery_categories action.
 */
export async function mergePotteryCategories(
  id: number,
  intoId: number,
): Promise<{ status: number; error?: string }> {
  return merge(id, intoId);
}

export default router;
