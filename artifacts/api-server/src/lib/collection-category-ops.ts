/**
 * Shared category DB ops for collections whose categories live in a
 * dedicated `<domain>Categories` table joined through a pivot table keyed by
 * `categoryId` (Pottery, Ornaments, Quilting).
 *
 * Provides the read/count/cleanup subset of `CategoryOps`
 * (`listWithCounts`, `fetchWithCount`, `deleteUnused`) parameterized by the
 * two tables and the entity-count column; each domain spreads the result
 * into its own `CategoryOps`.
 */
import { and, asc, eq, count as sqlCount, notInArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import type { CategoryOps, CategoryRow } from "./category-router-factory";

type CategoriesTable = PgTable &
  Record<"id" | "name" | "bgColor" | "textColor", AnyPgColumn>;
/** The pivot table only needs to expose `categoryId`; the count column is passed separately. */
type ItemCategoriesTable = PgTable & Record<"categoryId", AnyPgColumn>;

export type CategoryCountOps = Pick<
  CategoryOps,
  "listWithCounts" | "fetchWithCount" | "deleteUnused"
>;

export interface CategoryCountOpsOptions {
  /**
   * When set, every op is scoped to the authenticated user: queries add
   * `userColumn = userId` and refuse to run without a userId. Household-
   * shared domains (pottery, ornaments) omit this; owner-scoped scaffolded
   * modules pass their categories table's userId column.
   */
  userColumn?: AnyPgColumn;
}

export function createCategoryCountOps(
  cats: CategoriesTable,
  joinTable: ItemCategoriesTable,
  /** The join-table column to count per category (e.g. `itemId`, `entityId`). */
  countColumn: AnyPgColumn,
  options: CategoryCountOpsOptions = {},
): CategoryCountOps {
  const { userColumn } = options;
  /** Owner predicate (or undefined for household-shared domains). */
  const ownerWhere = (userId?: number) => {
    if (!userColumn) return undefined;
    if (userId == null)
      throw new Error(
        "createCategoryCountOps: owner-scoped ops called without a userId",
      );
    return eq(userColumn, userId);
  };

  /** Base categories-with-count query, before where/group/order. */
  const withCounts = () =>
    db
      .select({
        id: cats.id,
        name: cats.name,
        bgColor: cats.bgColor,
        textColor: cats.textColor,
        count: sqlCount(countColumn),
      })
      .from(cats)
      .leftJoin(joinTable, eq(joinTable.categoryId, cats.id));

  const groupCols = () => [cats.id, cats.name, cats.bgColor, cats.textColor];

  return {
    listWithCounts: async (userId?: number) =>
      (await withCounts()
        .where(ownerWhere(userId))
        .groupBy(...groupCols())
        .orderBy(asc(cats.name))) as unknown as CategoryRow[],

    fetchWithCount: async (id, userId?: number) =>
      (
        (await withCounts()
          .where(and(eq(cats.id, id), ownerWhere(userId)))
          .groupBy(...groupCols())) as unknown as CategoryRow[]
      )[0] ?? null,

    deleteUnused: async (userId?: number) => {
      const used = await db
        .selectDistinct({ categoryId: joinTable.categoryId })
        .from(joinTable);
      const unusedWhere =
        used.length > 0
          ? notInArray(
              cats.id,
              used.map((r) => r.categoryId),
            )
          : undefined;
      const deleted = await db
        .delete(cats)
        .where(and(unusedWhere, ownerWhere(userId)))
        .returning({ id: cats.id });
      return deleted.length;
    },
  };
}
