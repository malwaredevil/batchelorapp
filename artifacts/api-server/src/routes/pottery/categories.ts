import { asc, eq, count as sqlCount, notInArray, type SQL } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Domain-specific DB ops
// ---------------------------------------------------------------------------

const ops: CategoryOps = {
  async listWithCounts() {
    return db
      .select({
        id: cats.id,
        name: cats.name,
        bgColor: cats.bgColor,
        textColor: cats.textColor,
        count: sqlCount(joinTable.itemId),
      })
      .from(cats)
      .leftJoin(joinTable, eq(joinTable.categoryId, cats.id))
      .groupBy(cats.id, cats.name, cats.bgColor, cats.textColor)
      .orderBy(asc(cats.name));
  },

  async fetchWithCount(id) {
    const [row] = await db
      .select({
        id: cats.id,
        name: cats.name,
        bgColor: cats.bgColor,
        textColor: cats.textColor,
        count: sqlCount(joinTable.itemId),
      })
      .from(cats)
      .leftJoin(joinTable, eq(joinTable.categoryId, cats.id))
      .where(eq(cats.id, id))
      .groupBy(cats.id, cats.name, cats.bgColor, cats.textColor);
    return row ?? null;
  },

  async create(userId, name, bgColor, textColor) {
    const [row] = await db
      .insert(cats)
      .values({ userId, name, bgColor, textColor })
      .returning({ id: cats.id });
    return row.id;
  },

  async rename(id, name) {
    const [updated] = await db
      .update(cats)
      .set({ name })
      .where(eq(cats.id, id))
      .returning({ id: cats.id });
    return !!updated;
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

  async deleteUnused() {
    const usedRows = await db
      .select({ categoryId: joinTable.categoryId })
      .from(joinTable);
    const usedIds = [...new Set(usedRows.map((r) => r.categoryId))];
    const where: SQL | undefined =
      usedIds.length > 0 ? notInArray(cats.id, usedIds) : undefined;
    const deleted = await db
      .delete(cats)
      .where(where)
      .returning({ id: cats.id });
    return deleted.length;
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
    await db
      .insert(joinTable)
      .values(rows.map((r) => ({ itemId: r.itemId, categoryId: targetId })))
      .onConflictDoNothing();
  },

  async deleteCategoryRow(id) {
    await db.delete(cats).where(eq(cats.id, id));
  },
};

// ---------------------------------------------------------------------------
// Build router + exported helpers for Elaine actions
// ---------------------------------------------------------------------------

const { router, merge, rename } = buildCategoryRouter({
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
