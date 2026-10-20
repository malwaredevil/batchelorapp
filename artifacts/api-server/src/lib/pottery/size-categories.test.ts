import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  assigned: vi.fn(),
  created: vi.fn(),
  values: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { transaction: async (run: (tx: unknown) => unknown) => run(mocks) },
}));
import { potteryCategories, potteryItemCategories } from "@workspace/db";
import {
  matchPotteryCategoryIds,
  syncPotterySizeCategory,
} from "./size-categories";

function selectRows(rows: unknown[]) {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    for: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return builder;
}
const item = { id: 10, userId: 2, dimensions: '8" (20 cm)' };

describe("pottery size-category persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.select
      .mockReturnValueOnce(selectRows([item]))
      .mockReturnValueOnce(selectRows([]));
    mocks.created.mockResolvedValue([{ id: 8, name: "8″ (20 cm)" }]);
    mocks.assigned.mockResolvedValue([{ itemId: 10 }]);
    mocks.insert.mockImplementation((table) => ({
      values: (values: unknown) => {
        const returning =
          table === potteryCategories ? mocks.created : mocks.assigned;
        mocks.values(table, values);
        return { onConflictDoNothing: () => ({ returning }) };
      },
    }));
  });
  it("creates and applies a missing size atomically", async () => {
    expect(await syncPotterySizeCategory(10)).toEqual({
      status: "matched",
      categoryIds: [8],
      createdCount: 1,
      appliedCount: 1,
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });
  it("reuses a manually created equivalent label", async () => {
    mocks.select
      .mockReset()
      .mockReturnValueOnce(selectRows([item]))
      .mockReturnValueOnce(selectRows([{ id: 99, name: '8" (20cm)' }]));
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      categoryIds: [99],
      createdCount: 0,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
  it("creates missing axis labels and reuses other axis labels in one assignment", async () => {
    mocks.select
      .mockReset()
      .mockReturnValueOnce(
        selectRows([{ ...item, dimensions: "8″ (20 cm) × 6″ (15 cm)" }]),
      )
      .mockReturnValueOnce(selectRows([{ id: 66, name: '6" (15 cm)' }]));
    mocks.assigned.mockResolvedValue([{ itemId: 10 }, { itemId: 10 }]);
    expect(await syncPotterySizeCategory(10)).toEqual({
      status: "matched",
      categoryIds: [8, 66],
      createdCount: 1,
      appliedCount: 2,
    });
    expect(mocks.values).toHaveBeenLastCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 8 },
      { itemId: 10, categoryId: 66 },
    ]);
  });
  it("assigns a square's identical axes only once", async () => {
    mocks.select
      .mockReset()
      .mockReturnValueOnce(selectRows([{ ...item, dimensions: "8″ × 8″" }]))
      .mockReturnValueOnce(selectRows([{ id: 8, name: '8" (20 cm)' }]));
    await syncPotterySizeCategory(10);
    expect(mocks.values).toHaveBeenLastCalledWith(potteryItemCategories, [
      { itemId: 10, categoryId: 8 },
    ]);
    expect(mocks.created).not.toHaveBeenCalled();
  });
  it("is idempotent and leaves other assignments untouched", async () => {
    mocks.assigned.mockResolvedValue([]);
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      appliedCount: 0,
    });
    expect(mocks).not.toHaveProperty("delete");
  });
  it.each([null, "unknown", "not measured"])(
    "does nothing for %s",
    async (dimensions) => {
      mocks.select
        .mockReset()
        .mockReturnValue(selectRows([{ ...item, dimensions }]));
      expect(await syncPotterySizeCategory(10)).toEqual({
        status: "unmeasured",
      });
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );
  it("does nothing for a missing/deleted item", async () => {
    mocks.select.mockReset().mockReturnValue(selectRows([]));
    expect(await syncPotterySizeCategory(10)).toEqual({ status: "missing" });
  });
  it("resolves a concurrent exact-name insert without duplicating the category", async () => {
    mocks.created.mockResolvedValue([]);
    mocks.select.mockReturnValueOnce(
      selectRows([{ id: 88, name: "8″ (20 cm)" }]),
    );
    expect(await syncPotterySizeCategory(10)).toMatchObject({
      categoryIds: [88],
      createdCount: 0,
    });
  });
  it("does not swallow database failures", async () => {
    mocks.execute.mockRejectedValue(new Error("database offline"));
    await expect(syncPotterySizeCategory(10)).rejects.toThrow(
      "database offline",
    );
  });
  it("keeps partial and wrong-size labels out of generic text auto-matching", () => {
    expect(
      matchPotteryCategoryIds(
        [
          { id: 1, name: "8″ (20 cm)" },
          { id: 2, name: "8″ (20 cm) × 6″ (15 cm)" },
          { id: 3, name: "Blue" },
        ],
        ["Blue", "8″ (20 cm) × 6″ (15 cm)"],
      ),
    ).toEqual([3]);
  });
});
