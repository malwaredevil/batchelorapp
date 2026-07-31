/**
 * Tests for queryHouseholdData (the core of Elaine's query_household_data tool).
 *
 * TWO properties are verified for each collection branch:
 *
 * 1. PREDICATE CHECK — the query actually applies isNull(<table>.deletedAt).
 *    Achieved by spying on `isNull` from drizzle-orm and asserting it was called
 *    with the correct column reference.  If the WHERE clause is removed or changed
 *    to a different column, these assertions fail.
 *
 * 2. COUNT PASSTHROUGH — the count returned by the DB flows into the reply string
 *    unchanged, including 0 (all soft-deleted) and the pre→post drop pattern.
 *
 * selectQueue slots per pottery/ornaments branch (2 selects each):
 *   slot 0 — count query  (terminates at .where())
 *   slot 1 — recent query (terminates at .where().orderBy().limit())
 *
 * quilting branch fires 3 count selects and no recent query.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted objects — must be created before vi.mock() factories run so that the
// factories can close over them.  vi.hoisted() guarantees execution before any
// import or mock factory.
// ---------------------------------------------------------------------------
const { isNullSpy, dbMock, selectQueue } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isNullSpy = vi.fn<any>();

  const selectQueue: unknown[][] = [];

  // Returns a chainable query builder whose result is the next slot from
  // selectQueue.  Supports two termination styles:
  //   • await builder.from(T).where(cond)            (.then thenable)
  //   • await builder.from(T).where(cond).orderBy().limit(n)
  // and the bare-from style (no .where):
  //   • await builder.from(T)                        (.then thenable)
  function makeQueryBuilder() {
    const result = selectQueue.shift() ?? [];
    const promise = Promise.resolve(result);

    const afterOrderBy = { limit: (_n: number) => promise };

    const afterWhere = {
      orderBy: (..._args: unknown[]) => afterOrderBy,
      then<T, U = never>(
        onfulfilled?: ((v: unknown[]) => T | PromiseLike<T>) | null,
        onrejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ): Promise<T | U> {
        return promise.then(onfulfilled, onrejected) as Promise<T | U>;
      },
    };

    const afterFrom = {
      where: (_cond: unknown) => afterWhere,
      orderBy: (..._args: unknown[]) => promise,
      then<T, U = never>(
        onfulfilled?: ((v: unknown[]) => T | PromiseLike<T>) | null,
        onrejected?: ((r: unknown) => U | PromiseLike<U>) | null,
      ): Promise<T | U> {
        return promise.then(onfulfilled, onrejected) as Promise<T | U>;
      },
    };

    return { from: (_table: unknown) => afterFrom };
  }

  const dbMock = {
    select: vi.fn(() => makeQueryBuilder()),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    insert: vi.fn(() => ({
      values: () => ({ onConflictDoNothing: () => Promise.resolve([]) }),
    })),
    delete: vi.fn(() => ({ where: () => Promise.resolve() })),
  };

  return { isNullSpy, dbMock, selectQueue };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Spy on isNull: forward to the real implementation (so predicates are still
// valid SQL objects) but record every call so tests can assert on the argument.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  isNullSpy.mockImplementation(
    (...args: Parameters<typeof actual.isNull>) => actual.isNull(...args),
  );
  return { ...actual, isNull: isNullSpy };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../lib/app-config", () => ({
  getAllConfig: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { queryHouseholdData } from "./household-counts";

beforeEach(() => {
  selectQueue.length = 0;
  // clearAllMocks resets call history without touching mock implementations.
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Import the mocked @workspace/db table objects for predicate assertions. */
async function dbTables() {
  return import("@workspace/db");
}

// ---------------------------------------------------------------------------
// Ornaments
// ---------------------------------------------------------------------------

describe("queryHouseholdData — ornaments", () => {
  it("applies isNull(ornamentsItems.deletedAt) to the count query", async () => {
    selectQueue.push([{ total: 5 }]);
    selectQueue.push([{ name: "Frosty" }]);

    await queryHouseholdData(["ornaments"]);

    const { ornamentsItems } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(ornamentsItems.deletedAt);
  });

  it("applies isNull(ornamentsItems.deletedAt) to the recent-items query", async () => {
    selectQueue.push([{ total: 5 }]);
    selectQueue.push([{ name: "Frosty" }]);

    await queryHouseholdData(["ornaments"]);

    const { ornamentsItems } = await dbTables();
    // Both the count and recent queries must use the soft-delete predicate.
    const calls = isNullSpy.mock.calls.map((c) => c[0]);
    const deletedAtCalls = calls.filter((col) => col === ornamentsItems.deletedAt);
    expect(deletedAtCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports the DB count unchanged in the reply text", async () => {
    selectQueue.push([{ total: 5 }]);
    selectQueue.push([{ name: "Frosty" }, { name: "Rudolph" }]);

    const result = await queryHouseholdData(["ornaments"]);

    expect(result).toContain("5 ornaments");
    expect(result).toContain("Frosty");
    expect(result).toContain("Rudolph");
  });

  it("reports 0 ornaments when the count query returns 0 (simulates all soft-deleted)", async () => {
    selectQueue.push([{ total: 0 }]);
    selectQueue.push([]); // empty recents — filtered out by soft-delete WHERE

    const result = await queryHouseholdData(["ornaments"]);

    expect(result).toContain("0 ornaments");
    expect(result).not.toMatch(/Recently added/);
  });

  it("reflects a count drop from pre- to post-delete", async () => {
    // Before delete: 3 alive
    selectQueue.push([{ total: 3 }]);
    selectQueue.push([{ name: "Angel" }, { name: "Star" }, { name: "Bell" }]);
    const before = await queryHouseholdData(["ornaments"]);
    expect(before).toContain("3 ornaments");

    // After soft-delete: 2 alive, Bell excluded from recents by the WHERE filter
    selectQueue.push([{ total: 2 }]);
    selectQueue.push([{ name: "Angel" }, { name: "Star" }]);
    const after = await queryHouseholdData(["ornaments"]);
    expect(after).toContain("2 ornaments");
    expect(after).not.toContain("Bell");
  });
});

// ---------------------------------------------------------------------------
// Pottery
// ---------------------------------------------------------------------------

describe("queryHouseholdData — pottery", () => {
  it("applies isNull(potteryItems.deletedAt) to the count query", async () => {
    selectQueue.push([{ total: 12 }]);
    selectQueue.push([{ name: "Blue Vase" }]);

    await queryHouseholdData(["pottery"]);

    const { potteryItems } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(potteryItems.deletedAt);
  });

  it("applies isNull(potteryItems.deletedAt) to the recent-items query", async () => {
    selectQueue.push([{ total: 12 }]);
    selectQueue.push([{ name: "Blue Vase" }]);

    await queryHouseholdData(["pottery"]);

    const { potteryItems } = await dbTables();
    const calls = isNullSpy.mock.calls.map((c) => c[0]);
    const deletedAtCalls = calls.filter((col) => col === potteryItems.deletedAt);
    expect(deletedAtCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports 0 pieces when all pottery items are soft-deleted", async () => {
    selectQueue.push([{ total: 0 }]);
    selectQueue.push([]);

    const result = await queryHouseholdData(["pottery"]);

    expect(result).toContain("0 pieces");
    expect(result).not.toMatch(/Recently added/);
  });

  it("reflects a count drop from pre- to post-delete", async () => {
    selectQueue.push([{ total: 4 }]);
    selectQueue.push([{ name: "Pitcher" }, { name: "Bowl" }]);
    const before = await queryHouseholdData(["pottery"]);
    expect(before).toContain("4 pieces");

    selectQueue.push([{ total: 3 }]);
    selectQueue.push([{ name: "Pitcher" }]);
    const after = await queryHouseholdData(["pottery"]);
    expect(after).toContain("3 pieces");
    expect(after).not.toContain("Bowl");
  });
});

// ---------------------------------------------------------------------------
// Quilting
// ---------------------------------------------------------------------------

describe("queryHouseholdData — quilting", () => {
  it("applies isNull(deletedAt) to fabric, pattern, and finished-quilt count queries", async () => {
    selectQueue.push([{ total: 10 }]); // fabrics count
    selectQueue.push([{ total: 5 }]);  // quiltPatterns count
    selectQueue.push([{ total: 2 }]);  // finishedQuilts count

    await queryHouseholdData(["quilting"]);

    const { fabrics, quiltPatterns, finishedQuilts } = await dbTables();
    const calledWith = isNullSpy.mock.calls.map((c) => c[0]);
    expect(calledWith).toContain(fabrics.deletedAt);
    expect(calledWith).toContain(quiltPatterns.deletedAt);
    expect(calledWith).toContain(finishedQuilts.deletedAt);
  });

  it("reports all three quilting counts correctly", async () => {
    selectQueue.push([{ total: 10 }]);
    selectQueue.push([{ total: 5 }]);
    selectQueue.push([{ total: 2 }]);

    const result = await queryHouseholdData(["quilting"]);

    expect(result).toContain("10 fabrics");
    expect(result).toContain("5 patterns");
    expect(result).toContain("2 finished quilts");
  });

  it("reports 0 for each quilting category when all items are soft-deleted", async () => {
    selectQueue.push([{ total: 0 }]);
    selectQueue.push([{ total: 0 }]);
    selectQueue.push([{ total: 0 }]);

    const result = await queryHouseholdData(["quilting"]);

    expect(result).toContain("0 fabrics");
    expect(result).toContain("0 patterns");
    expect(result).toContain("0 finished quilts");
  });
});

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

describe("queryHouseholdData — pottery + ornaments together", () => {
  it("applies separate isNull predicates for each collection", async () => {
    selectQueue.push([{ total: 8 }]);  // pottery count
    selectQueue.push([{ name: "Bowl" }]); // pottery recent
    selectQueue.push([{ total: 3 }]);  // ornaments count
    selectQueue.push([{ name: "Angel" }]); // ornaments recent

    await queryHouseholdData(["pottery", "ornaments"]);

    const { potteryItems, ornamentsItems } = await dbTables();
    const calledWith = isNullSpy.mock.calls.map((c) => c[0]);
    expect(calledWith).toContain(potteryItems.deletedAt);
    expect(calledWith).toContain(ornamentsItems.deletedAt);
  });

  it("shows 0 for a fully-deleted collection alongside a non-zero other", async () => {
    selectQueue.push([{ total: 0 }]);  // pottery — all deleted
    selectQueue.push([]);              // pottery recent — empty
    selectQueue.push([{ total: 7 }]); // ornaments — 7 alive
    selectQueue.push([{ name: "Star" }]); // ornaments recent

    const result = await queryHouseholdData(["pottery", "ornaments"]);

    expect(result).toContain("0 pieces");
    expect(result).toContain("7 ornaments");
    expect(result).toContain("Star");
  });
});
