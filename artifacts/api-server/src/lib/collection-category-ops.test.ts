import { describe, expect, it } from "vitest";
import {
  applyExistingCategories,
  type AdditiveCategoryAssignmentAdapter,
} from "./collection-category-ops";
import { resolveCategoryPalette } from "@workspace/web-core/colors";

type TestEntity = { id: number; values: unknown[] };

function makeAdapter(
  entities: TestEntity[],
  assignments = new Map<number, Set<number>>(),
): AdditiveCategoryAssignmentAdapter<TestEntity> {
  return {
    listCategories: async () => [
      { id: 1, name: "Winter" },
      { id: 2, name: "Keepsake" },
    ],
    listEntities: async (ids) =>
      entities.filter((entity) => !ids || ids.includes(entity.id)),
    getMatchValues: (entity) => entity.values,
    getAssignedCategoryIds: async (id) => [...(assignments.get(id) ?? [])],
    addAssignments: async (id, categoryIds) => {
      if (id === 3) throw new Error("temporary database error");
      const assigned = assignments.get(id) ?? new Set<number>();
      categoryIds.forEach((categoryId) => assigned.add(categoryId));
      assignments.set(id, assigned);
      return categoryIds.length;
    },
  };
}

describe("applyExistingCategories", () => {
  it("adds only missing matching assignments and is safe to retry", async () => {
    const assignments = new Map([[1, new Set([1])]]);
    const adapter = makeAdapter(
      [
        { id: 1, values: ["Winter Keepsake ornament"] },
        { id: 2, values: ["No matching phrase"] },
      ],
      assignments,
    );

    const first = await applyExistingCategories(adapter);
    expect(first).toMatchObject({
      total: 2,
      matched: 1,
      assignmentsCreated: 1,
      failed: 0,
    });
    expect(assignments.get(1)).toEqual(new Set([1, 2]));

    const retry = await applyExistingCategories(adapter);
    expect(retry.assignmentsCreated).toBe(0);
    expect(retry.outcomes).toEqual([
      { entityId: 1, matchedCategoryIds: [1, 2], assignmentsCreated: 0 },
      { entityId: 2, matchedCategoryIds: [], assignmentsCreated: 0 },
    ]);
  });

  it("keeps processing after a per-entity failure and supports selected entities", async () => {
    const assignments = new Map<number, Set<number>>();
    const result = await applyExistingCategories(
      makeAdapter(
        [
          { id: 1, values: ["Winter"] },
          { id: 3, values: ["Keepsake"] },
        ],
        assignments,
      ),
      [1, 3],
    );

    expect(result.assignmentsCreated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.outcomes).toContainEqual({
      entityId: 3,
      matchedCategoryIds: [2],
      assignmentsCreated: 0,
      error: "temporary database error",
    });
    expect(assignments.get(1)).toEqual(new Set([1]));
  });
});

describe("resolveCategoryPalette", () => {
  it("preserves complete custom colors and derives readable legacy fallbacks", () => {
    expect(
      resolveCategoryPalette({
        name: "Custom",
        bgColor: "#123456",
        textColor: "#fefefe",
      }),
    ).toEqual({ bgColor: "#123456", textColor: "#fefefe" });

    const legacy = resolveCategoryPalette({
      name: "Winter Keepsake",
      bgColor: null,
      textColor: null,
    });
    expect(legacy.bgColor).toMatch(/^#/);
    expect(legacy.textColor).toMatch(/^#/);
  });
});
