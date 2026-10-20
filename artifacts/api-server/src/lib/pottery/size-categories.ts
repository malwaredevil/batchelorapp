import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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

async function lockItem(tx: CategoryTransaction, itemId: number) {
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
  return item;
}

type SizeItem = NonNullable<Awaited<ReturnType<typeof lockItem>>>;

async function syncSizes(tx: CategoryTransaction, item: SizeItem) {
  const itemId = item.id;
  const sizes = potterySizeLabels(item.dimensions);
  const categories = await tx
    .select({ id: potteryCategories.id, name: potteryCategories.name })
    .from(potteryCategories);
  const resolved = await resolvePotterySizeCategories(
    tx,
    sizes,
    item.userId,
    categories,
  );
  const existing = await tx
    .select({
      categoryId: potteryItemCategories.categoryId,
      automaticSizeKey: potteryItemCategories.automaticSizeKey,
    })
    .from(potteryItemCategories)
    .where(eq(potteryItemCategories.itemId, itemId));
  const desiredKeys = new Set(sizes.map((size) => size.key));
  const categoryKeys = new Map(
    categories.map((category) => [category.id, sizeCategoryKey(category.name)]),
  );
  const renamed = existing.filter(
    (link) =>
      link.automaticSizeKey &&
      categoryKeys.get(link.categoryId) !== link.automaticSizeKey,
  );
  // A renamed label is now a deliberate household choice, not an automatic size.
  if (renamed.length)
    await tx
      .update(potteryItemCategories)
      .set({ automaticSizeKey: null })
      .where(
        and(
          eq(potteryItemCategories.itemId, itemId),
          inArray(
            potteryItemCategories.categoryId,
            renamed.map((link) => link.categoryId),
          ),
        ),
      );
  const obsolete = existing.filter(
    (link) =>
      link.automaticSizeKey &&
      categoryKeys.get(link.categoryId) === link.automaticSizeKey &&
      !desiredKeys.has(link.automaticSizeKey),
  );
  if (obsolete.length)
    await tx
      .delete(potteryItemCategories)
      .where(
        and(
          eq(potteryItemCategories.itemId, itemId),
          or(
            ...obsolete.map((link) =>
              and(
                eq(potteryItemCategories.categoryId, link.categoryId),
                eq(
                  potteryItemCategories.automaticSizeKey,
                  link.automaticSizeKey!,
                ),
              ),
            ),
          ),
        ),
      );
  if (!sizes.length)
    return { status: "unmeasured" as const, removedCount: obsolete.length };
  const assigned = await tx
    .insert(potteryItemCategories)
    .values(
      resolved.categoryIds.map((categoryId) => ({
        itemId,
        categoryId,
        automaticSizeKey: categoryKeys.get(categoryId)!,
      })),
    )
    .onConflictDoNothing()
    .returning({ itemId: potteryItemCategories.itemId });
  return {
    status: "matched" as const,
    ...resolved,
    appliedCount: assigned.length,
    removedCount: obsolete.length,
  };
}

/** Replace only provably automatic obsolete sizes; manual/unknown links win. */
export async function syncPotterySizeCategory(itemId: number) {
  return db.transaction((tx) =>
    syncPotterySizeCategoryInTransaction(tx, itemId),
  );
}

/** Supports atomic maintenance and callers already in a transaction. */
export async function syncPotterySizeCategoryInTransaction(
  tx: CategoryTransaction,
  itemId: number,
) {
  const item = await lockItem(tx, itemId);
  return item ? syncSizes(tx, item) : { status: "missing" as const };
}

/** Full-selection saves must retain provenance for unchanged associations. */
export async function replacePotteryItemCategories(
  itemId: number,
  categoryIds: number[],
) {
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, itemId);
    if (!item) return { status: "missing" as const };
    const existing = await tx
      .select({ categoryId: potteryItemCategories.categoryId })
      .from(potteryItemCategories)
      .where(eq(potteryItemCategories.itemId, itemId));
    const selected = new Set(categoryIds);
    const previous = new Set(existing.map((link) => link.categoryId));
    const removed = existing.filter((link) => !selected.has(link.categoryId));
    if (removed.length)
      await tx.delete(potteryItemCategories).where(
        and(
          eq(potteryItemCategories.itemId, itemId),
          inArray(
            potteryItemCategories.categoryId,
            removed.map((link) => link.categoryId),
          ),
        ),
      );
    const added = [...selected].filter(
      (categoryId) => !previous.has(categoryId),
    );
    if (added.length)
      await tx
        .insert(potteryItemCategories)
        .values(
          added.map((categoryId) => ({
            itemId,
            categoryId,
            automaticSizeKey: null,
          })),
        )
        .onConflictDoUpdate({
          target: [
            potteryItemCategories.itemId,
            potteryItemCategories.categoryId,
          ],
          set: { automaticSizeKey: null },
        });
    return syncSizes(tx, item);
  });
}
