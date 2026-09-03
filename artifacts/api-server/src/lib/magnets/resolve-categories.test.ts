import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryPalette } from "@workspace/web-core/colors";

const { dbMock, state } = vi.hoisted(() => {
  const state: { insertedValues: unknown } = { insertedValues: undefined };
  return {
    state,
    dbMock: {
      insert: vi.fn(() => ({
        values: (values: unknown) => {
          state.insertedValues = values;
          return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
        },
      })),
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve([{ id: 1 }, { id: 2 }]),
        }),
      })),
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

import { resolveOrCreateMagnetCategories } from "./resolve-categories";

describe("resolveOrCreateMagnetCategories", () => {
  beforeEach(() => {
    state.insertedValues = undefined;
    vi.clearAllMocks();
  });

  it("assigns the shared palette when creating normalized categories", async () => {
    await expect(
      resolveOrCreateMagnetCategories(["  Travel  ", "Souvenir"], 42),
    ).resolves.toEqual([1, 2]);

    expect(state.insertedValues).toEqual([
      { userId: 42, name: "Travel", ...getCategoryPalette("Travel") },
      { userId: 42, name: "Souvenir", ...getCategoryPalette("Souvenir") },
    ]);
  });
});
