import { asc, eq, count as sqlCount, notInArray, type SQL } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Domain-specific DB ops
// Quilting uses entityCategories (polymorphic: entityId + entityType)
// ---------------------------------------------------------------------------

const ops: CategoryOps = {
  async listWithCounts() {
    return db
      .select({
        id: cats.id,
        name: cats.name,
        bgColor: cats.bgColor,
        textColor: cats.textColor,
        count: sqlCount(joinTable.entityId),
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
        count: sqlCount(joinTable.entityId),
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
