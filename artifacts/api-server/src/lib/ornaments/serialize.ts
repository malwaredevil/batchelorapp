import { eq, inArray } from "drizzle-orm";
import type { OrnamentItemRow } from "@workspace/db";

import {
  db,
  ornamentsItemCategories as itemCategories,
  ornamentsCategories as categories,
  ornamentsImages,
} from "@workspace/db";

type ItemRowForSerialization = Omit<
  OrnamentItemRow,
  "embedding" | "visualEmbedding"
>;

export interface CategoryResult {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
}

export interface OrnamentImageResult {
  id: number;
  url: string;
  label: string | null;
  position: number;
}

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

async function fetchCategoriesForItems(
  itemIds: number[],
): Promise<Map<number, CategoryResult[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
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

  const map = new Map<number, CategoryResult[]>();
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push({
      id: row.id,
      name: row.name,
      bgColor: row.bgColor,
      textColor: row.textColor,
    });
  }
  return map;
}

async function fetchImagesForItems(
  itemIds: number[],
): Promise<Map<number, OrnamentImageResult[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(ornamentsImages)
    .where(inArray(ornamentsImages.itemId, itemIds));

  const map = new Map<number, OrnamentImageResult[]>();
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push({
      id: row.id,
      url: `/api/ornaments/items/${row.itemId}/images/${row.id}`,
      label: row.label,
      position: row.position,
    });
  }
  for (const imgs of map.values()) {
    imgs.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return map;
}

/**
 * Image URLs are authenticated API paths, not signed Supabase bearer URLs —
 * every request goes through requireAuth on the Express router.
 */
function imageApiUrl(id: number): string {
  return `/api/ornaments/items/${id}/image`;
}

function toItem(
  row: ItemRowForSerialization,
  itemCats: CategoryResult[],
  itemImgs: OrnamentImageResult[],
): SerializedItem {
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
    categories: itemCats,
    images: itemImgs,
    imageUrl: imageApiUrl(row.id),
    createdAt: row.createdAt,
  };
}

export async function serializeItem(
  row: ItemRowForSerialization,
): Promise<SerializedItem> {
  const [catsMap, imgsMap] = await Promise.all([
    fetchCategoriesForItems([row.id]),
    fetchImagesForItems([row.id]),
  ]);
  return toItem(row, catsMap.get(row.id) ?? [], imgsMap.get(row.id) ?? []);
}

export async function serializeItems(
  rows: ItemRowForSerialization[],
): Promise<SerializedItem[]> {
  if (rows.length === 0) return [];
  const itemIds = rows.map((r) => r.id);
  const [catsMap, imgsMap] = await Promise.all([
    fetchCategoriesForItems(itemIds),
    fetchImagesForItems(itemIds),
  ]);
  return rows.map((row) =>
    toItem(row, catsMap.get(row.id) ?? [], imgsMap.get(row.id) ?? []),
  );
}
