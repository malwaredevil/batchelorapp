import { eq } from "drizzle-orm";
import {
  db,
  quiltingCategories as cats,
  entityCategories as joinTable,
} from "@workspace/db";
import {
  ListQuiltingCategoriesResponse,
  ListQuiltingCategoriesResponseItem,
  CreateQuiltingCategoryBody,
  DeleteQuiltingCategoryParams,
  RenameQuiltingCategoryParams,
  RenameQuiltingCategoryBody,
  MergeQuiltingCategoryBody,
  UpdateQuiltingCategoryColorsBody,
  UpdateQuiltingCategoryColorsParams,
} from "@workspace/api-zod";
import {
  buildCategoryRouter,
  normalizeCategoryNameAggressive,
  type CategoryOps,
  type RenameResult,
  type MergeResult,
} from "../../lib/category-router-factory";
import { createCategoryCountOps } from "../../lib/collection-category-ops";

// ---------------------------------------------------------------------------
// Domain-specific DB ops
// ---------------------------------------------------------------------------

const ops: CategoryOps = {
  // listWithCounts, fetchWithCount, deleteUnused — shared helper parameterized
  // by entityId (Quilting's polymorphic pivot uses entityId, not itemId).
  ...createCategoryCountOps(cats, joinTable, joinTable.entityId),

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

  async categoryExists(id) {
    const [row] = await db
      .select({ id: cats.id })
      .from(cats)
      .where(eq(cats.id, id));
    return !!row;
  },

  async getAssignmentsForCategory(categoryId) {
    return db
      .select({
        entityType: joinTable.entityType,
        entityId: joinTable.entityId,
      })
      .from(joinTable)
      .where(eq(joinTable.categoryId, categoryId));
  },

  async reattachAssignments(assignments, targetId) {
    const rows = assignments as {
      entityType: string;
      entityId: number;
    }[];
    if (rows.length === 0) return;
    await db
      .insert(joinTable)
      .values(
        rows.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          categoryId: targetId,
        })),
      )
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
  normalize: normalizeCategoryNameAggressive,
  schemas: {
    listResponse: ListQuiltingCategoriesResponse,
    listItem: ListQuiltingCategoriesResponseItem,
    createBody: CreateQuiltingCategoryBody,
    deleteParams: DeleteQuiltingCategoryParams,
    renameParams: RenameQuiltingCategoryParams,
    renameBody: RenameQuiltingCategoryBody,
    mergeBody: MergeQuiltingCategoryBody,
    mergeSourceIdField: "targetId",
    updateColorsBody: UpdateQuiltingCategoryColorsBody,
    updateColorsParams: UpdateQuiltingCategoryColorsParams,
  },
  mergeResponse: "json-count",
});

/**
 * Rename a quilting category.
 * Shared by the REST route and Elaine's rename_quilting_category action.
 */
export async function renameQuiltingCategory(
  id: number,
  rawName: string,
): Promise<RenameResult> {
  return rename(id, rawName);
}

/**
 * Merge one quilting category into another.
 * Shared by the REST route and Elaine's merge_quilting_categories action.
 */
export async function mergeQuiltingCategories(
  id: number,
  targetId: number,
): Promise<MergeResult> {
  return merge(id, targetId);
}

export default router;
