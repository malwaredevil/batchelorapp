import { inArray } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { OrnamentItemRow } from "@workspace/db";
import {
  db,
  ornamentsItemCategories as itemCategories,
  ornamentsCategories as categories,
  ornamentsImages,
} from "@workspace/db";
import {
  createCollectionSerializer,
  type CategoryResult,
  type ImageResult,
} from "../collection-item-serializer";

type ItemRowForSerialization = Omit<
  OrnamentItemRow,
  "embedding" | "visualEmbedding"
>;

export type { CategoryResult };

export interface OrnamentImageResult extends ImageResult {}

export interface SerializedItem {
  id: number;
  name: string;
  brand: string;
  seriesOrCollection: string | null;
  year: number | null;
  barcodeValue: string | null;
  quantity: number;
  lockedFields: string[];
  notes: string | null;
  dimensions: string | null;
  condition: string | null;
  origin: string | null;
  aiDescription: string | null;
  acquiredAt: string | null;
  dominantColors: string[];
  motifs: string[];
  bookValue: string | null;
  bookValueSource: string | null;
  bookValueUpdatedAt: Date | null;
  categories: CategoryResult[];
  images: OrnamentImageResult[];
  imageUrl: string;
  createdAt: Date;
}

const { serializeItem, serializeItems } = createCollectionSerializer<
  ItemRowForSerialization,
  SerializedItem
>({
  async fetchRawCategories(itemIds) {
    if (itemIds.length === 0) return [];
    return db
      .select({
        itemId: itemCategories.itemId,
        id: categories.id,
        name: categories.name,
        bgColor: categories.bgColor,
        textColor: categories.textColor,
      })
      .from(itemCategories)
      .innerJoin(categories, eq(itemCategories.categoryId, categories.id))
      .where(inArray(itemCategories.itemId, itemIds));
  },

  async fetchRawImages(itemIds) {
    if (itemIds.length === 0) return [];
    const rows = await db
      .select()
      .from(ornamentsImages)
      .where(inArray(ornamentsImages.itemId, itemIds));
    return rows.map((r) => ({
      itemId: r.itemId,
      id: r.id,
      url: `/api/ornaments/items/${r.itemId}/images/${r.id}`,
      label: r.label,
      position: r.position,
    }));
  },

  toItem(row, cats, imgs) {
    return {
      id: row.id,
      name: row.name,
      brand: row.brand,
      seriesOrCollection: row.seriesOrCollection,
      year: row.year,
      barcodeValue: row.barcodeValue,
      quantity: row.quantity,
      lockedFields: row.lockedFields ?? [],
      notes: row.notes,
      dimensions: row.dimensions,
      condition: row.condition,
      origin: row.origin,
      aiDescription: row.aiDescription,
      acquiredAt: row.acquiredAt,
      dominantColors: row.dominantColors ?? [],
      motifs: row.motifs ?? [],
      bookValue: row.bookValue,
      bookValueSource: row.bookValueSource,
      bookValueUpdatedAt: row.bookValueUpdatedAt,
      categories: cats,
      images: imgs,
      imageUrl: `/api/ornaments/items/${row.id}/image`,
      createdAt: row.createdAt,
    };
  },
});

export { serializeItem, serializeItems };
