import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CategoryOps } from "../../lib/category-router-factory";

const mocks = vi.hoisted(() => ({
  ops: null as CategoryOps | null,
  execute: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  conditions: vi.fn(),
  values: vi.fn(),
  conflict: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { transaction: async (run: (tx: unknown) => unknown) => run(mocks) },
}));
vi.mock("../../lib/category-router-factory", async (importOriginal) => {
  const { Router } = await import("express");
  return {
    ...(await importOriginal<
      typeof import("../../lib/category-router-factory")
    >()),
    buildCategoryRouter: (options: { ops: CategoryOps }) => {
      mocks.ops = options.ops;
      return { router: Router(), merge: vi.fn() };
    },
  };
});
import { potteryItemCategories } from "@workspace/db";
import { sizeCategoryKey } from "../../lib/pottery/size-label";
import "./categories";

describe("pottery label provenance across household category edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockImplementation((table) => ({
      set: () => ({
        where: (condition: SQL) => {
          mocks.conditions(table, condition);
          return {
            returning: async () => [{ id: 7 }],
            then: (resolve: (value: undefined) => unknown) =>
              Promise.resolve(undefined).then(resolve),
          };
        },
      }),
    }));
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.conflict });
  });
  it("does not downgrade unchanged/equivalent automatic measurements on rename", async () => {
    await mocks.ops!.rename(7, '8" (20cm)');
    const condition = mocks.conditions.mock.calls.find(
      ([table]) => table === potteryItemCategories,
    )![1];
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.params).toEqual([7, sizeCategoryKey("8″")]);
    expect(query.sql).toContain("<>");
  });
  it("protects a deliberate rename to a non-size label", async () => {
    await mocks.ops!.rename(7, "Favorite");
    const condition = mocks.conditions.mock.calls.find(
      ([table]) => table === potteryItemCategories,
    )![1];
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.params).toEqual([7]);
    expect(query.sql).toContain("is not null");
  });
  it("makes explicitly merged assignments manual even if the target was automatic", async () => {
    await mocks.ops!.reattachAssignments([{ itemId: 10 }], 7);
    expect(mocks.values).toHaveBeenCalledWith([
      { itemId: 10, categoryId: 7, automaticSizeKey: null },
    ]);
    expect(mocks.conflict).toHaveBeenCalledWith(
      expect.objectContaining({ set: { automaticSizeKey: null } }),
    );
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
