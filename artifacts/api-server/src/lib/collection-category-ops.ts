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
import {
  and,
  asc,
  eq,
  count as sqlCount,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { getCategoryPalette } from "@workspace/web-core/colors";
import type { CategoryOps, CategoryRow } from "./category-router-factory";
import { matchCategoryIds, type NamedCategory } from "./collection-parsing";

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

/**
 * Fill missing legacy colours without replacing a color selected by a user.
 * List routes call this idempotently so existing rows repair themselves as
 * they are used, rather than requiring a risky one-off migration.
 */
export async function backfillMissingCategoryColors(
  cats: CategoriesTable,
): Promise<void> {
  const rows = await db
    .select({
      id: cats.id,
      name: cats.name,
      bgColor: cats.bgColor,
      textColor: cats.textColor,
    })
    .from(cats)
    .where(or(isNull(cats.bgColor), isNull(cats.textColor)));

  await Promise.all(
    rows.flatMap((row) => {
      const palette = getCategoryPalette(String(row.name));
      const updates: Promise<unknown>[] = [];
      if (row.bgColor == null) {
        updates.push(
          db
            .update(cats)
            .set({ bgColor: palette.bgColor })
            .where(and(eq(cats.id, row.id), isNull(cats.bgColor))),
        );
      }
      if (row.textColor == null) {
        updates.push(
          db
            .update(cats)
            .set({ textColor: palette.textColor })
            .where(and(eq(cats.id, row.id), isNull(cats.textColor))),
        );
      }
      return updates;
    }),
  );
}

export interface AdditiveCategoryAssignment {
  entityId: number;
  matchedCategoryIds: number[];
  assignmentsCreated: number;
  error?: string;
}

export interface AdditiveCategoryAssignmentResult {
  total: number;
  matched: number;
  assignmentsCreated: number;
  failed: number;
  outcomes: AdditiveCategoryAssignment[];
}

/**
 * Portable, additive assignment operation for collection categories.
 *
 * The adapter owns the collection's visibility rules, table shape, and pivot
 * insert. This keeps household-shared and polymorphic collections from
 * leaking authorization or entity-type assumptions into the matcher.
 */
export interface AdditiveCategoryAssignmentAdapter<
  TEntity extends { id: number },
> {
  listCategories(): Promise<NamedCategory[]>;
  listEntities(ids?: readonly number[]): Promise<TEntity[]>;
  getMatchValues(entity: TEntity): unknown[];
  getAssignedCategoryIds(entityId: number): Promise<number[]>;
  addAssignments(
    entityId: number,
    categoryIds: readonly number[],
  ): Promise<number>;
}

export async function applyExistingCategories<TEntity extends { id: number }>(
  adapter: AdditiveCategoryAssignmentAdapter<TEntity>,
  ids?: readonly number[],
): Promise<AdditiveCategoryAssignmentResult> {
  const [categories, entities] = await Promise.all([
    adapter.listCategories(),
    adapter.listEntities(ids),
  ]);
  const outcomes: AdditiveCategoryAssignment[] = [];
  let assignmentsCreated = 0;

  // Deliberately sequential: a maintenance request may cover the whole
  // collection, so we bound DB pressure while still recording a failure for
  // one entity and continuing with the rest.
  for (const entity of entities) {
    const matchedCategoryIds = matchCategoryIds(
      categories,
      adapter.getMatchValues(entity),
    );
    try {
      const assigned = new Set(await adapter.getAssignedCategoryIds(entity.id));
      const missing = matchedCategoryIds.filter((id) => !assigned.has(id));
      const created =
        missing.length > 0
          ? await adapter.addAssignments(entity.id, missing)
          : 0;
      assignmentsCreated += created;
      outcomes.push({
        entityId: entity.id,
        matchedCategoryIds,
        assignmentsCreated: created,
      });
    } catch (error) {
      outcomes.push({
        entityId: entity.id,
        matchedCategoryIds,
        assignmentsCreated: 0,
        error:
          error instanceof Error
            ? error.message
            : "Category assignment failed.",
      });
    }
  }

  return {
    total: entities.length,
    matched: outcomes.filter((outcome) => outcome.matchedCategoryIds.length > 0)
      .length,
    assignmentsCreated,
    failed: outcomes.filter((outcome) => outcome.error).length,
    outcomes,
  };
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
    listWithCounts: async (userId?: number) => {
      await backfillMissingCategoryColors(cats);
      return (await withCounts()
        .where(ownerWhere(userId))
        .groupBy(...groupCols())
        .orderBy(asc(cats.name))) as unknown as CategoryRow[];
    },

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
