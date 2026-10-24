import { describe, expect, it, vi } from "vitest";
import { fetchAllCollectionPages } from "./collection-pages";

describe("complete collection index", () => {
  it.each([0, 200, 225, 400])("loads all %i items in bounded pages", async (total) => {
    const items = Array.from({ length: total }, (_, id) => ({ id: id + 1 }));
    const fetchPage = vi.fn(async (page: number) => ({
      items: items.slice((page - 1) * 100, page * 100),
      total, page, pageSize: 100,
    }));
    expect(await fetchAllCollectionPages(fetchPage)).toEqual(items);
    expect(fetchPage).toHaveBeenCalledTimes(Math.max(1, Math.ceil(total / 100)));
  });

  it("rejects rather than exposing an incomplete collection after a later page fails", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 1 }], total: 2, page: 1, pageSize: 1 })
      .mockRejectedValueOnce(new Error("Network failure"));
    await expect(fetchAllCollectionPages(fetchPage)).rejects.toThrow("Network failure");
  });

  it.each([
    { items: [], total: 3, page: 2, pageSize: 2 },
    { items: [{ id: 2 }], total: 3, page: 2, pageSize: 2 },
    { items: [{ id: 3 }], total: 4, page: 2, pageSize: 2 },
    { items: [{ id: 3 }], total: 3, page: 1, pageSize: 2 },
  ])("rejects inconsistent pagination instead of silently hiding items: %j", async (secondPage) => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 1 }, { id: 2 }], total: 3, page: 1, pageSize: 2 })
      .mockResolvedValueOnce(secondPage);
    await expect(fetchAllCollectionPages(fetchPage)).rejects.toThrow("Please retry");
  });
});
