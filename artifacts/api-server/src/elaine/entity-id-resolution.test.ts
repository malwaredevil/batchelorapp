/**
 * entity-id-resolution.test.ts
 *
 * Verifies that each Elaine action executor correctly uses the numeric entity
 * ID it receives from the page context — it must not re-derive, guess, or
 * rename the ID.  Four pages are covered:
 *
 *   • Pottery categories   → delete_pottery_category  (pottery-actions.ts)
 *   • Quilting shopping    → delete_shopping_item      (quilting-actions.ts)
 *   • Quilting quilts      → delete_quilt              (quilting-actions.ts)
 *   • Travels wishlist     → remove_wishlist_item      (travel-wishlist-executors.ts)
 *
 * Assertions per executor:
 *   1. 200 + echoed ID on success
 *   2. 404 (no delete) when the row is absent
 *   3. drizzle-orm `eq()` was called with the EXACT supplied ID in the WHERE
 *      clause — an implementation that queries by a different ID but echoes the
 *      supplied one back would still fail here
 *
 * The context-encoding correctness of formatElaineContextEntity /
 * formatElaineContextList is tested in lib/elaine-ui/src/page-context-formatters.test.ts
 * against the real production formatter.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
//
// vi.mock() factories run during module resolution (before module-level `const`
// initialisation).  Objects referenced INSIDE a factory must exist before the
// factory fires — use vi.hoisted() for those.
//
// selectQueue: push the expected row array before each executor call that runs
// a SELECT.  The mock builder shifts one entry from the queue per .from() call.

const { dbMock, selectQueue, deleteQuiltByIdMock, eqSpy } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];

  function makeSelectBuilder() {
    let slot: unknown[] = [];
    const builder = {
      from() {
        slot = selectQueue.shift() ?? [];
        return builder;
      },
      where() {
        return Promise.resolve(slot);
      },
      limit() {
        return Promise.resolve(slot);
      },
      then<T, R = never>(
        onfulfilled?: ((value: unknown[]) => T | PromiseLike<T>) | null,
        onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
      ): Promise<T | R> {
        return Promise.resolve(slot).then(onfulfilled, onrejected) as Promise<
          T | R
        >;
      },
    };
    return builder;
  }

  const dbMock = {
    select: vi.fn(() => makeSelectBuilder()),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    insert: vi.fn(() => ({})),
    update: vi.fn(() => ({})),
  };

  const deleteQuiltByIdMock = vi.fn(async (_id: number) => true as boolean);

  // Placeholder — real drizzle eq() implementation is wired in the vi.mock
  // factory below via mockImplementation (which runs after vi.hoisted completes).
  const eqSpy = vi.fn();

  return { dbMock, selectQueue, deleteQuiltByIdMock, eqSpy };
});

// ─── eq spy ──────────────────────────────────────────────────────────────────
//
// eqSpy is created in vi.hoisted() (above) so it exists when this factory
// fires during module resolution.  mockImplementation wires in the real eq()
// so calls still produce valid drizzle SQL expressions while recording args.

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  eqSpy.mockImplementation(
    (...args: Parameters<typeof actual.eq>) => actual.eq(...args),
  );
  return { ...actual, eq: eqSpy };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/soft-delete", () => ({
  logActivity: vi.fn(async () => undefined),
  softDelete: vi.fn(async () => undefined),
}));

vi.mock("../routes/pottery/pottery", () => ({
  runItemAnalysis: vi.fn(),
  bulkReanalyzePotteryItems: vi.fn(),
  promotePotteryImageToPrimary: vi.fn(),
}));

vi.mock("../routes/pottery/categories", () => ({
  mergePotteryCategories: vi.fn(),
}));

vi.mock("../lib/pottery/storage", () => ({
  deleteImage: vi.fn(),
}));

vi.mock("../routes/quilting/fabrics", () => ({
  bulkReanalyzeFabrics: vi.fn(),
}));

vi.mock("../routes/quilting/patterns", () => ({
  bulkReanalyzePatterns: vi.fn(),
}));

vi.mock("../routes/quilting/quilts", () => ({
  bulkReanalyzeQuilts: vi.fn(),
  deleteQuiltById: (id: number) => deleteQuiltByIdMock(id),
}));

vi.mock("../routes/quilting/categories", () => ({
  renameQuiltingCategory: vi.fn(),
  mergeQuiltingCategories: vi.fn(),
}));

vi.mock("../lib/storage", () => ({
  uploadImage: vi.fn(),
  downloadImageBuffer: vi.fn(),
}));

vi.mock("../lib/crease-removal", () => ({
  detectCreasesFromBuffer: vi.fn(),
  removeCreasesFromBuffer: vi.fn(),
}));

// ─── Subject imports ──────────────────────────────────────────────────────────

import { potteryActionExecutors } from "./pottery-actions";
import { quiltingActionExecutors } from "./quilting-actions";
import { removeWishlistItemExecutor } from "./travel-wishlist-executors";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DUMMY_USER_ID = 99;

/** Checks that eq() was called at least once with the expected numeric value
 *  as its second argument (the ID column value in the WHERE clause). */
function expectEqCalledWithId(expectedId: number) {
  const matchingCall = eqSpy.mock.calls.some(
    ([, val]) => val === expectedId,
  );
  expect(
    matchingCall,
    `expected eq() to have been called with id=${expectedId}, ` +
      `but calls were: ${JSON.stringify(eqSpy.mock.calls.map(([, v]) => v))}`,
  ).toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// delete_pottery_category — pottery categories page
// ─────────────────────────────────────────────────────────────────────────────

describe("Executor fidelity — delete_pottery_category (pottery categories page)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 200 with the exact categoryId supplied by Elaine", async () => {
    const categoryId = 7;
    selectQueue.push([{ id: categoryId }]); // SELECT confirms existence

    const result = await potteryActionExecutors.delete_pottery_category(
      { categoryId } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      type: "delete_pottery_category",
      result: { id: categoryId },
    });
  });

  it("issues the DELETE WHERE clause using the supplied categoryId — not a re-queried ID", async () => {
    const categoryId = 7;
    selectQueue.push([{ id: categoryId }]);

    await potteryActionExecutors.delete_pottery_category(
      { categoryId } as never,
      DUMMY_USER_ID,
    );

    // drizzle eq() must have been called with 7 (for both SELECT and DELETE)
    expectEqCalledWithId(categoryId);
    // The DELETE itself must have been issued once
    expect(dbMock.delete).toHaveBeenCalledOnce();
  });

  it("returns 404 and skips the DELETE when the category does not exist", async () => {
    selectQueue.push([]); // row absent

    const result = await potteryActionExecutors.delete_pottery_category(
      { categoryId: 999 } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(404);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("uses a different categoryId for a different entity — no ID bleed-over", async () => {
    const categoryId = 12; // second category (not the first one in context)
    selectQueue.push([{ id: categoryId }]);

    const result = await potteryActionExecutors.delete_pottery_category(
      { categoryId } as never,
      DUMMY_USER_ID,
    );

    expect((result.body as { result?: { id: number } }).result?.id).toBe(
      categoryId,
    );
    expectEqCalledWithId(categoryId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete_shopping_item — quilting shopping list page
// ─────────────────────────────────────────────────────────────────────────────

describe("Executor fidelity — delete_shopping_item (quilting shopping list page)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 200 with the exact shoppingItemId supplied by Elaine", async () => {
    const shoppingItemId = 23;
    selectQueue.push([{ id: shoppingItemId }]); // ownership check

    const result = await quiltingActionExecutors.delete_shopping_item(
      { shoppingItemId } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      type: "delete_shopping_item",
      result: { id: shoppingItemId },
    });
  });

  it("issues the SELECT/DELETE WHERE clause using the supplied shoppingItemId", async () => {
    const shoppingItemId = 23;
    selectQueue.push([{ id: shoppingItemId }]);

    await quiltingActionExecutors.delete_shopping_item(
      { shoppingItemId } as never,
      DUMMY_USER_ID,
    );

    expectEqCalledWithId(shoppingItemId);
    expect(dbMock.delete).toHaveBeenCalledOnce();
  });

  it("returns 404 when the item is not found for this user — no cross-user deletion", async () => {
    selectQueue.push([]); // not found

    const result = await quiltingActionExecutors.delete_shopping_item(
      { shoppingItemId: 999 } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(404);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("echoes back the exact shoppingItemId that was passed in (not a DB-fetched value)", async () => {
    const shoppingItemId = 41;
    selectQueue.push([{ id: shoppingItemId }]);

    const result = await quiltingActionExecutors.delete_shopping_item(
      { shoppingItemId } as never,
      DUMMY_USER_ID,
    );

    expect(
      (result.body as { result?: { id: number } }).result?.id,
    ).toBe(shoppingItemId);
    expectEqCalledWithId(shoppingItemId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete_quilt — quilting quilts list page
// ─────────────────────────────────────────────────────────────────────────────

describe("Executor fidelity — delete_quilt (quilts list page)", () => {
  beforeEach(() => {
    deleteQuiltByIdMock.mockReset();
    vi.clearAllMocks();
  });

  it("returns 200 with the exact quiltId supplied by Elaine", async () => {
    const quiltId = 5;
    deleteQuiltByIdMock.mockResolvedValueOnce(true);

    const result = await quiltingActionExecutors.delete_quilt(
      { quiltId } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      type: "delete_quilt",
      result: { id: quiltId },
    });
  });

  it("calls the delete helper with exactly the supplied quiltId — not a re-derived ID", async () => {
    const quiltId = 99;
    deleteQuiltByIdMock.mockResolvedValueOnce(true);

    await quiltingActionExecutors.delete_quilt(
      { quiltId } as never,
      DUMMY_USER_ID,
    );

    // deleteQuiltById must receive the numeric ID that Elaine extracted from
    // the context string (quiltId: 99 — "Log Cabin Throw"), not re-queried by name
    expect(deleteQuiltByIdMock).toHaveBeenCalledExactlyOnceWith(quiltId);
  });

  it("returns 404 when deleteQuiltById reports the quilt was not found", async () => {
    deleteQuiltByIdMock.mockResolvedValueOnce(false);

    const result = await quiltingActionExecutors.delete_quilt(
      { quiltId: 999 } as never,
      DUMMY_USER_ID,
    );

    expect(result.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// remove_wishlist_item — travels wishlist page
// ─────────────────────────────────────────────────────────────────────────────

describe("Executor fidelity — remove_wishlist_item (travels wishlist page)", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 200 with the exact wishlistId supplied by Elaine", async () => {
    const wishlistId = 18;
    selectQueue.push([{ id: wishlistId }]); // existence check

    const result = await removeWishlistItemExecutor(wishlistId);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      type: "remove_wishlist_item",
      result: { id: wishlistId },
    });
  });

  it("issues SELECT and DELETE using the supplied wishlistId in the WHERE clause", async () => {
    const wishlistId = 18;
    selectQueue.push([{ id: wishlistId }]);

    await removeWishlistItemExecutor(wishlistId);

    // eq() must have been called with 18 for both SELECT and DELETE predicates
    expectEqCalledWithId(wishlistId);
    expect(dbMock.delete).toHaveBeenCalledOnce();
  });

  it("returns 404 and skips the DELETE when the wishlist item is not found", async () => {
    selectQueue.push([]); // item absent

    const result = await removeWishlistItemExecutor(999);

    expect(result.status).toBe(404);
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("uses a different wishlistId for a different destination — no ID bleed-over", async () => {
    const wishlistId = 34; // "Reykjavik, Iceland" (not the first item in context)
    selectQueue.push([{ id: wishlistId }]);

    const result = await removeWishlistItemExecutor(wishlistId);

    expect(
      (result.body as { result?: { id: number } }).result?.id,
    ).toBe(wishlistId);
    expectEqCalledWithId(wishlistId);
  });
});
