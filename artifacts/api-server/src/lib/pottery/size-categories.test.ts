import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  assigned: vi.fn(),
  created: vi.fn(),
  values: vi.fn(),
  deleteWhere: vi.fn(),
  updateWhere: vi.fn(),
  set: vi.fn(),
  manual: vi.fn(),
  items: [] as { id: number; userId: number; dimensions: string | null }[],
  categories: [] as { id: number; name: string }[],
  links: [] as { categoryId: number; automaticSizeKey: string | null }[],
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { transaction: async (run: (tx: unknown) => unknown) => run(mocks) },
}));
import {
  potteryCategories,
  potteryItemCategories,
  potteryItems,
} from "@workspace/db";
import {
  matchPotteryCategoryIds,
  replacePotteryItemCategories,
  syncPotterySizeCategory,
} from "./size-categories";
import { sizeCategoryKey } from "./size-label";

const item = { id: 10, userId: 2, dimensions: '8" (20 cm)' };
const eight = { id: 8, name: "8″ (20 cm)" };
const six = { id: 6, name: "6″ (15 cm)" };
const key8 = sizeCategoryKey(eight.name)!;
const key6 = sizeCategoryKey(six.name)!;
const sqlParams = (sql: SQL) => new PgDialect().sqlToQuery(sql).params;

describe("pottery size-category persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.items = [{ ...item }];
    mocks.categories = [];
    mocks.links = [];
    mocks.select.mockImplementation(() => {
      let rows: unknown[] = [];
      const builder = {
        from: (table: unknown) => {
          rows =
            table === potteryItems
              ? mocks.items
              : table === potteryCategories
                ? mocks.categories
                : mocks.links;
          return builder;
        },
        where: () => builder,
        limit: () => builder,
        for: () => builder,
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return builder;
    });
    mocks.created.mockResolvedValue([eight]);
    mocks.assigned.mockResolvedValue([{ itemId: 10 }]);
    mocks.manual.mockResolvedValue(undefined);
    mocks.insert.mockImplementation((table) => ({
      values: (values: unknown) => {
        mocks.values(table, values);
        return {
          onConflictDoNothing: () => ({
            returning:
              table === potteryCategories ? mocks.created : mocks.assigned,
          }),
          onConflictDoUpdate: mocks.manual,
        };
      },
    }));
    mocks.delete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
  });

  it("creates and applies a missing size with explicit automatic provenance", async () => {
    expect(await syncPotterySizeCategory(10)).toEqual({
      status: "matched",
      categoryIds: [8],
      createdCount: 1,
      appliedCount: 1,
      removedCount: 0,
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenLastCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 8, automaticSizeKey: key8 },
    ]);
  });

  it("reuses a manually created equivalent category without duplicating it", async () => {
    mocks.categories = [{ id: 99, name: '8" (20cm)' }];
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      categoryIds: [99],
      createdCount: 0,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("adds separate labels for different axes", async () => {
    mocks.items[0].dimensions = "8″ × 6″";
    mocks.categories = [eight, six];
    mocks.assigned.mockResolvedValue([{ itemId: 10 }, { itemId: 10 }]);
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      categoryIds: [8, 6],
      appliedCount: 2,
    });
    expect(mocks.values).toHaveBeenLastCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 8, automaticSizeKey: key8 },
      { itemId: 10, categoryId: 6, automaticSizeKey: key6 },
    ]);
  });

  it("assigns identical axes only once", async () => {
    mocks.items[0].dimensions = "8″ × 8″";
    mocks.categories = [eight];
    await syncPotterySizeCategory(10);
    expect(mocks.values).toHaveBeenLastCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 8, automaticSizeKey: key8 },
    ]);
  });

  it("removes only a proven automatic obsolete size, scoped to this piece and origin", async () => {
    mocks.categories = [eight, six];
    mocks.links = [{ categoryId: 6, automaticSizeKey: key6 }];
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      removedCount: 1,
    });
    expect(sqlParams(mocks.deleteWhere.mock.calls[0][0])).toEqual([
      10,
      6,
      key6,
    ]);
  });

  it("preserves manual and unknown-provenance labels even when their size is obsolete", async () => {
    mocks.categories = [eight, six];
    mocks.links = [{ categoryId: 6, automaticSizeKey: null }];
    await syncPotterySizeCategory(10);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not adopt an existing manual matching label on conflict", async () => {
    mocks.categories = [eight];
    mocks.links = [{ categoryId: 8, automaticSizeKey: null }];
    mocks.assigned.mockResolvedValue([]);
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      appliedCount: 0,
      removedCount: 0,
    });
    expect(mocks.manual).not.toHaveBeenCalled();
  });

  it("preserves a user-renamed automatic label and relinquishes its provenance", async () => {
    mocks.categories = [eight, { id: 6, name: "Favorite" }];
    mocks.links = [{ categoryId: 6, automaticSizeKey: key6 }];
    await syncPotterySizeCategory(10);
    expect(mocks.set).toHaveBeenCalledWith({ automaticSizeKey: null });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("preserves an axis label still needed by another axis", async () => {
    mocks.items[0].dimensions = "8″ × 6″";
    mocks.categories = [eight, six];
    mocks.links = [{ categoryId: 6, automaticSizeKey: key6 }];
    await syncPotterySizeCategory(10);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it.each([null, "unknown", "not measured"])(
    "clears only managed sizes when measurements become %s",
    async (dimensions) => {
      mocks.items[0].dimensions = dimensions;
      mocks.categories = [six];
      mocks.links = [{ categoryId: 6, automaticSizeKey: key6 }];
      expect(await syncPotterySizeCategory(10)).toEqual({
        status: "unmeasured",
        removedCount: 1,
      });
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );

  it("does nothing for a missing/deleted piece", async () => {
    mocks.items = [];
    expect(await syncPotterySizeCategory(10)).toEqual({ status: "missing" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("retains unchanged provenance on full-selection edits", async () => {
    mocks.categories = [eight];
    mocks.links = [{ categoryId: 8, automaticSizeKey: key8 }];
    await replacePotteryItemCategories(10, [8]);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.manual).not.toHaveBeenCalled();
  });

  it("marks an explicitly added household label manual without downgrading unchanged automatic links", async () => {
    mocks.categories = [eight, six];
    mocks.links = [{ categoryId: 8, automaticSizeKey: key8 }];
    await replacePotteryItemCategories(10, [8, 6, 6]);
    expect(mocks.values).toHaveBeenCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 6, automaticSizeKey: null },
    ]);
    expect(mocks.manual).toHaveBeenCalledWith(
      expect.objectContaining({ set: { automaticSizeKey: null } }),
    );
  });

  it("does not swallow database failures", async () => {
    mocks.execute.mockRejectedValue(new Error("database offline"));
    await expect(syncPotterySizeCategory(10)).rejects.toThrow(
      "database offline",
    );
  });

  it("excludes all dimension labels from generic phrase matching", () => {
    expect(
      matchPotteryCategoryIds(
        [eight, six, { id: 3, name: "Blue" }],
        ["Blue", "8″ (20 cm)"],
      ),
    ).toEqual([3]);
  });
});
