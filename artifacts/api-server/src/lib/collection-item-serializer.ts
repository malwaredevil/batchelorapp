/**
 * Generic collection-item serializer factory.
 *
 * Pottery and Ornaments both follow the same serialize pattern:
 *   1. Fetch categories for item IDs (join through an itemCategories pivot)
 *   2. Fetch images for item IDs (sorted by position then id)
 *   3. Map each DB row → a typed API shape using a domain-supplied `toItem`
 *
 * Callers supply three callbacks that encapsulate their specific tables, then
 * receive `serializeItem` / `serializeItems` functions with the boilerplate
 * already handled.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import { pathCacheBuster } from "./path-cache-buster";

export interface CategoryResult {
  id: number;
  name: string;
  bgColor: string | null;
  textColor: string | null;
}

export interface ImageResult {
  id: number;
  url: string;
  label: string | null;
  position: number;
}

/** A drizzle table exposing (at least) the named columns. */
type TableWith<K extends string> = PgTable & Record<K, AnyPgColumn>;

/**
 * Shared `fetchRawCategories` implementation: join items → categories through
 * the domain's pivot table. Pottery and Ornaments differ only in which tables
 * they pass in.
 */
export function makeFetchRawCategories(
  itemCategories: TableWith<"itemId" | "categoryId">,
  categories: TableWith<"id" | "name" | "bgColor" | "textColor">,
): (itemIds: number[]) => Promise<Array<CategoryResult & { itemId: number }>> {
  return async (itemIds) =>
    itemIds.length === 0
      ? []
      : ((await db
          .select({
            itemId: itemCategories.itemId,
            id: categories.id,
            name: categories.name,
            bgColor: categories.bgColor,
            textColor: categories.textColor,
          })
          .from(itemCategories)
          .innerJoin(categories, eq(itemCategories.categoryId, categories.id))
          .where(inArray(itemCategories.itemId, itemIds))) as unknown as Array<
          CategoryResult & { itemId: number }
        >);
}

/**
 * Shared `fetchRawImages` implementation: non-deleted image rows mapped to the
 * standard `/api/<domain>/items/:itemId/images/:id` URL shape. Pottery and
 * Ornaments differ only in the images table and the domain path segment.
 */
export function makeFetchRawImages(
  images: TableWith<
    "id" | "itemId" | "label" | "position" | "storagePath" | "deletedAt"
  >,
  domain: string,
): (itemIds: number[]) => Promise<Array<ImageResult & { itemId: number }>> {
  return async (itemIds) => {
    if (itemIds.length === 0) return [];
    const rows = (await db
      .select({
        itemId: images.itemId,
        id: images.id,
        label: images.label,
        position: images.position,
        storagePath: images.storagePath,
      })
      .from(images)
      .where(
        and(inArray(images.itemId, itemIds), isNull(images.deletedAt)),
      )) as unknown as Array<{
      itemId: number;
      id: number;
      label: string | null;
      position: number;
      storagePath: string;
    }>;
    return rows.map((r) => ({
      itemId: r.itemId,
      id: r.id,
      url: `/api/${domain}/items/${r.itemId}/images/${r.id}?v=${pathCacheBuster(r.storagePath)}`,
      label: r.label,
      position: r.position,
    }));
  };
}

export function groupRowsByItem<TRow extends { itemId: number }, TValue>(
  rows: TRow[],
  toValue: (row: TRow) => TValue,
  compare?: (a: TValue, b: TValue) => number,
): Map<number, TValue[]> {
  const map = new Map<number, TValue[]>();
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push(toValue(row));
  }
  if (compare) {
    for (const values of map.values()) values.sort(compare);
  }
  return map;
}

interface SerializerConfig<TRow extends { id: number }, TItem> {
  fetchRawCategories: (
    itemIds: number[],
  ) => Promise<Array<CategoryResult & { itemId: number }>>;
  fetchRawImages: (
    itemIds: number[],
  ) => Promise<Array<ImageResult & { itemId: number }>>;
  toItem: (row: TRow, cats: CategoryResult[], imgs: ImageResult[]) => TItem;
}

function buildCatsMap(
  rows: Array<CategoryResult & { itemId: number }>,
): Map<number, CategoryResult[]> {
  return groupRowsByItem(rows, (row) => ({
    id: row.id,
    name: row.name,
    bgColor: row.bgColor,
    textColor: row.textColor,
  }));
}

function buildImgsMap(
  rows: Array<ImageResult & { itemId: number }>,
): Map<number, ImageResult[]> {
  return groupRowsByItem(
    rows,
    (row) => ({
      id: row.id,
      url: row.url,
      label: row.label,
      position: row.position,
    }),
    (a, b) => a.position - b.position || a.id - b.id,
  );
}

export function createCollectionSerializer<TRow extends { id: number }, TItem>(
  config: SerializerConfig<TRow, TItem>,
) {
  async function serializeItem(row: TRow): Promise<TItem> {
    const [rawCats, rawImgs] = await Promise.all([
      config.fetchRawCategories([row.id]),
      config.fetchRawImages([row.id]),
    ]);
    return config.toItem(
      row,
      buildCatsMap(rawCats).get(row.id) ?? [],
      buildImgsMap(rawImgs).get(row.id) ?? [],
    );
  }

  async function serializeItems(rows: TRow[]): Promise<TItem[]> {
    if (rows.length === 0) return [];
    const itemIds = rows.map((r) => r.id);
    const [rawCats, rawImgs] = await Promise.all([
      config.fetchRawCategories(itemIds),
      config.fetchRawImages(itemIds),
    ]);
    const catsMap = buildCatsMap(rawCats);
    const imgsMap = buildImgsMap(rawImgs);
    return rows.map((row) =>
      config.toItem(row, catsMap.get(row.id) ?? [], imgsMap.get(row.id) ?? []),
    );
  }

  return { serializeItem, serializeItems };
}
