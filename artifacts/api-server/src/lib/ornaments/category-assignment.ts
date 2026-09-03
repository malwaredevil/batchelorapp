import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  ornamentsCategories,
  ornamentsItemCategories,
  ornamentsItems,
} from "@workspace/db";
import {
  applyExistingCategories,
  type AdditiveCategoryAssignmentResult,
} from "../collection-category-ops";

type OrnamentCategoryMatchEntity = {
  id: number;
  name: string;
  brand: string | null;
  seriesOrCollection: string | null;
  dimensions: string | null;
  motifs: string[];
  dominantColors: string[];
  notes: string | null;
  description: string | null;
  aiDescription: string | null;
  origin: string | null;
  barcodeValue: string | null;
};

/**
 * Match all approved stored ornament signals. This is deliberately shared by
 * creation, every recognition path, and maintenance so a category never
 * depends on which screen refreshed an ornament.
 */
function ornamentCategoryMatchValues(
  item: OrnamentCategoryMatchEntity,
): unknown[] {
  return [
    item.name,
    item.brand,
    item.seriesOrCollection,
    item.dimensions,
    item.motifs,
    item.dominantColors,
    item.notes,
    item.description,
    item.aiDescription,
    item.origin,
    item.barcodeValue,
  ];
}

export async function applyExistingOrnamentCategories(
  ids?: readonly number[],
): Promise<AdditiveCategoryAssignmentResult> {
  return applyExistingCategories<OrnamentCategoryMatchEntity>(
    {
      listCategories: () =>
        db
          .select({
            id: ornamentsCategories.id,
            name: ornamentsCategories.name,
          })
          .from(ornamentsCategories),
      listEntities: async (requestedIds) => {
        if (requestedIds && requestedIds.length === 0) return [];
        return db
          .select({
            id: ornamentsItems.id,
            name: ornamentsItems.name,
            brand: ornamentsItems.brand,
            seriesOrCollection: ornamentsItems.seriesOrCollection,
            dimensions: ornamentsItems.dimensions,
            motifs: ornamentsItems.motifs,
            dominantColors: ornamentsItems.dominantColors,
            notes: ornamentsItems.notes,
            description: ornamentsItems.description,
            aiDescription: ornamentsItems.aiDescription,
            origin: ornamentsItems.origin,
            barcodeValue: ornamentsItems.barcodeValue,
          })
          .from(ornamentsItems)
          .where(
            and(
              isNull(ornamentsItems.deletedAt),
              requestedIds
                ? inArray(ornamentsItems.id, [...requestedIds])
                : undefined,
            ),
          );
      },
      getMatchValues: ornamentCategoryMatchValues,
      getAssignedCategoryIds: async (itemId) => {
        const rows = await db
          .select({ categoryId: ornamentsItemCategories.categoryId })
          .from(ornamentsItemCategories)
          .where(eq(ornamentsItemCategories.itemId, itemId));
        return rows.map((row) => row.categoryId);
      },
      addAssignments: async (itemId, categoryIds) => {
        const rows = await db
          .insert(ornamentsItemCategories)
          .values(
            categoryIds.map((categoryId) => ({
              itemId,
              categoryId,
            })),
          )
          .onConflictDoNothing()
          .returning({ itemId: ornamentsItemCategories.itemId });
        return rows.length;
      },
    },
    ids,
  );
}
