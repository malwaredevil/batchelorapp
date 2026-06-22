import { eq, inArray } from "drizzle-orm";
import type { PotteryItemRow } from "@workspace/db";

import {
  db,
  potteryItemCategories as itemCategories,
  potteryCategories as categories,
  potteryImages,
} from "@workspace/db";

// Embedding is excluded from list/detail queries — serialize only needs the rest.
type ItemRowForSerialization = Omit<PotteryItemRow, "embedding">;

export interface CategoryResult {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
}

export interface PotteryImageResult {
  id: number;
  url: string;
  label: string | null;
  position: number;
}

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
  categories: CategoryResult[];
  images: PotteryImageResult[];
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
): Promise<Map<number, PotteryImageResult[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(potteryImages)
    .where(inArray(potteryImages.itemId, itemIds));

  const map = new Map<number, PotteryImageResult[]>();
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push({
      id: row.id,
      url: `/api/pottery/items/${row.itemId}/images/${row.id}`,
      label: row.label,
      position: row.position,
    });
  }
  // Sort by position within each item
  for (const imgs of map.values()) {
    imgs.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return map;
}

/**
 * Image URLs are authenticated API paths, not signed Supabase bearer URLs.
 * Every request to these paths goes through requireAuth on the Express router,
 * so image access is tied to a valid session.  No bearer URL ever reaches the
 * browser that would work after logout or session revocation.
 */
function imageApiUrl(id: number): string {
  return `/api/pottery/items/${id}/image`;
}

function toItem(
  row: ItemRowForSerialization,
  itemCats: CategoryResult[],
  itemImgs: PotteryImageResult[],
): SerializedItem {
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
