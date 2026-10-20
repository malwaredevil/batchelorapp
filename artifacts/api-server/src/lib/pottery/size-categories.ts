import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  potteryItems,
  potteryCategories,
  potteryItemCategories,
} from "@workspace/db";
import { matchCategoryIds, type NamedCategory } from "../collection-parsing";
import {
  potterySizeLabels,
  sizeCategoryKey,
  type PotterySize,
} from "./size-label";

type CategoryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller holds the size-category transaction lock; cache includes newly created rows. */
export async function resolvePotterySizeCategories(
  tx: CategoryTransaction,
  sizes: PotterySize[],
  userId: number | null,
  categories: NamedCategory[],
) {
  const ids: number[] = [];
  let createdCount = 0;
  for (const size of sizes) {
    let category = categories.find((c) => sizeCategoryKey(c.name) === size.key);
    if (!category) {
      const inserted = await tx
        .insert(potteryCategories)
        .values({ name: size.name, userId })
        .onConflictDoNothing()
        .returning({ id: potteryCategories.id, name: potteryCategories.name });
      createdCount += inserted.length;
      category = inserted[0];
      if (!category) {
        [category] = await tx
          .select({ id: potteryCategories.id, name: potteryCategories.name })
          .from(potteryCategories)
          .where(eq(potteryCategories.name, size.name));
      }
      if (category) categories.push(category);
    }
    if (!category) throw new Error("Could not resolve pottery size category");
    ids.push(category.id);
  }
  return { categoryIds: [...new Set(ids)], createdCount };
}

/** Size matching is exact, not phrase matching against another dimension. */
export function matchPotteryCategoryIds(
  categories: NamedCategory[],
  values: unknown[],
) {
  return matchCategoryIds(
    categories.filter((c) => !sizeCategoryKey(c.name)),
    values,
  );
}

/**
 * Shared by uploads, edits, scans, Elaine and the existing-collection backfill.
 * Additive only: never deletes or renames a household's existing labels.
 */
export async function syncPotterySizeCategory(itemId: number) {
  return db.transaction(async (tx) => {
    // Serialize alias lookup + creation across requests/processes, not just JS.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('pottery-size-category'))`,
    );
    const [item] = await tx
      .select({
        id: potteryItems.id,
        userId: potteryItems.userId,
        dimensions: potteryItems.dimensions,
      })
      .from(potteryItems)
      .where(and(eq(potteryItems.id, itemId), isNull(potteryItems.deletedAt)))
      .limit(1)
      .for("update");
    if (!item) return { status: "missing" as const };
    const sizes = potterySizeLabels(item.dimensions);
    if (!sizes.length) return { status: "unmeasured" as const };
    const categories = await tx
      .select({ id: potteryCategories.id, name: potteryCategories.name })
      .from(potteryCategories);
    const resolved = await resolvePotterySizeCategories(
      tx,
      sizes,
      item.userId,
      categories,
    );
    const assigned = await tx
      .insert(potteryItemCategories)
      .values(
        resolved.categoryIds.map((categoryId) => ({ itemId, categoryId })),
      )
      .onConflictDoNothing()
      .returning({ itemId: potteryItemCategories.itemId });
    return {
      status: "matched" as const,
      ...resolved,
      appliedCount: assigned.length,
    };
  });
}
