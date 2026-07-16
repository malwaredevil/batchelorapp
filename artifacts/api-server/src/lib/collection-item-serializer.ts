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

function buildImgsMap(
  rows: Array<ImageResult & { itemId: number }>,
): Map<number, ImageResult[]> {
  const map = new Map<number, ImageResult[]>();
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push({
      id: row.id,
      url: row.url,
      label: row.label,
      position: row.position,
    });
  }
  for (const imgs of map.values()) {
    imgs.sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return map;
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
