import { and, inArray, isNull } from "drizzle-orm";
import { pathCacheBuster } from "../path-cache-buster";
import { eq } from "drizzle-orm";
import type { PotteryItemRow } from "@workspace/db";
import {
  db,
  potteryItemCategories as itemCategories,
  potteryCategories as categories,
  potteryImages,
} from "@workspace/db";
import {
  createCollectionSerializer,
  type CategoryResult,
  type ImageResult,
} from "../collection-item-serializer";

type ItemRowForSerialization = Omit<
  PotteryItemRow,
  "embedding" | "visualEmbedding" | "zoneEmbedding"
>;

export type { CategoryResult };

export interface PotteryImageResult extends ImageResult {}

export interface SerializedItem {
  id: number;
  name: string;
  quantity: number;
  lockedFields: string[];
  notes: string | null;
  dimensions: string | null;
  patternDescription: string | null;
  style: string | null;
  shape: string | null;
  maker: string | null;
  makerInfo: string | null;
  aiDescription: string | null;
  acquiredAt: string | null;
  dominantColors: string[];
  motifs: string[];
  glazeType: string | null;
  surfaceZones: unknown;
  categories: CategoryResult[];
  images: PotteryImageResult[];
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
      .from(potteryImages)
      .where(
        and(
          inArray(potteryImages.itemId, itemIds),
          isNull(potteryImages.deletedAt),
        ),
      );
    return rows.map((r) => ({
      itemId: r.itemId,
      id: r.id,
      url: `/api/pottery/items/${r.itemId}/images/${r.id}?v=${pathCacheBuster(r.storagePath)}`,
      label: r.label,
      position: r.position,
    }));
  },

  toItem(row, cats, imgs) {
    return {
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      lockedFields: row.lockedFields ?? [],
      notes: row.notes,
      dimensions: row.dimensions,
      patternDescription: row.patternDescription,
      style: row.style,
      shape: row.shape,
      maker: row.maker,
      makerInfo: row.makerInfo,
      aiDescription: row.aiDescription,
      acquiredAt: row.acquiredAt,
      dominantColors: row.dominantColors ?? [],
      motifs: row.motifs ?? [],
      glazeType: row.glazeType ?? null,
      surfaceZones: row.surfaceZones ?? null,
      categories: cats,
      images: imgs,
      imageUrl: `/api/pottery/items/${row.id}/image?v=${pathCacheBuster(row.imagePath)}`,
      createdAt: row.createdAt,
    };
  },
});

export { serializeItem, serializeItems };
