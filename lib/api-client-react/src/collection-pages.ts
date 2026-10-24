/** Fetch a complete lightweight index in bounded requests, never a partial success. */
export async function fetchAllCollectionPages<T extends { id: number }>(
  fetchPage: (page: number) => Promise<{
    items: T[];
    total: number;
    page: number;
    pageSize: number;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  const ids = new Set<number>();
  let expectedTotal: number | undefined;
  let expectedPageSize: number | undefined;
  for (let page = 1; ; page++) {
    const result = await fetchPage(page);
    expectedTotal ??= result.total;
    expectedPageSize ??= result.pageSize;
    if (
      result.page !== page ||
      result.pageSize < 1 ||
      result.pageSize !== expectedPageSize ||
      result.total !== expectedTotal ||
      result.items.length > result.pageSize ||
      (result.items.length === 0 && items.length < expectedTotal)
    ) {
      throw new Error("The collection changed while loading. Please retry.");
    }
    for (const item of result.items) {
      if (ids.has(item.id)) {
        throw new Error("The collection changed while loading. Please retry.");
      }
      ids.add(item.id);
      items.push(item);
    }
    if (items.length === expectedTotal) return items;
    if (items.length > expectedTotal || result.items.length < result.pageSize) {
      throw new Error("The collection changed while loading. Please retry.");
    }
  }
}
