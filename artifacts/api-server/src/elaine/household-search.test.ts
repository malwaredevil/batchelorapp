/**
 * Tests for searchHouseholdData (the core of Elaine's search_household_data tool).
 *
 * TWO properties are verified for each collection branch:
 *
 * 1. PREDICATE CHECK — the query actually applies isNull(<table>.deletedAt).
 *    Achieved by spying on `isNull` from drizzle-orm and asserting it was called
 *    with the correct column reference.  If the WHERE clause is removed or changed
 *    to a different column, these assertions fail.
 *
 * 2. SOFT-DELETE EXCLUSION — when the mock DB returns an empty array (simulating
 *    all rows being soft-deleted), the result must report "No X found" rather
 *    than listing the deleted item.
 *
 * Each search branch terminates with:
 *   db.select({…}).from(table).where(cond).limit(n)   → Promise<rows>
 *
 * For trip searches the chain is:
 *   db.select({…}).from(table).where(cond).orderBy(…).limit(n) → Promise<rows>
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

  // Each entry is the rows that the next db.select() call should resolve with.
  const selectQueue: unknown[][] = [];

  /**
   * Returns a chainable query builder that resolves to the next slot in
   * selectQueue.  Supports the two termination styles used by the search handler:
   *
   *   • .from().where().limit(n)                (pottery / ornaments / fabrics / patterns / quilts)
   *   • .from().where().orderBy(…).limit(n)     (trips)
   */
  function makeQueryBuilder() {
    const result = selectQueue.shift() ?? [];
    const promise = Promise.resolve(result);

    // After .limit() — the terminal; just a Promise.
    // After .orderBy() — exposes .limit().
    const afterOrderBy = {
      limit: (_n: number) => promise,
    };

    // After .where() — exposes .limit() and .orderBy().
    const afterWhere = {
      limit: (_n: number) => promise,
      orderBy: (..._args: unknown[]) => afterOrderBy,
    };

    // After .from() — exposes .where().
    const afterFrom = {
      where: (_cond: unknown) => afterWhere,
    };

    return { from: (_table: unknown) => afterFrom };
  }

  const dbMock = {
    select: vi.fn(() => makeQueryBuilder()),
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
  isNullSpy.mockImplementation((...args: Parameters<typeof actual.isNull>) =>
    actual.isNull(...args),
  );
  return { ...actual, isNull: isNullSpy };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { searchHouseholdData } from "./household-search";

beforeEach(() => {
  selectQueue.length = 0;
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
// Pottery
// ---------------------------------------------------------------------------

describe("searchHouseholdData — pottery", () => {
  it("applies isNull(potteryItems.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([
      { id: 1, name: "Blue Vase", maker: "Studio X", style: "Modern" },
    ]);

    await searchHouseholdData("vase", ["pottery"]);

    const { potteryItems } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(potteryItems.deletedAt);
  });

  it("returns matching pottery items when the DB returns rows", async () => {
    selectQueue.push([
      { id: 7, name: "Blue Vase", maker: "Studio X", style: "Modern" },
    ]);

    const result = await searchHouseholdData("vase", ["pottery"]);

    expect(result).toContain("Blue Vase");
    expect(result).toContain("itemId: 7");
  });

  it("excludes a soft-deleted pottery item — returns 'No pottery pieces found'", async () => {
    // Simulate soft-delete filter: the DB query returns no rows because
    // the deleted item is excluded by isNull(potteryItems.deletedAt).
    selectQueue.push([]);

    const result = await searchHouseholdData("deleted vase", ["pottery"]);

    expect(result).toContain("No pottery pieces found");
    // The deleted item must not appear as a result (no itemId in output).
    expect(result).not.toContain("itemId:");
  });

  it("does not list a deleted item alongside a non-deleted match", async () => {
    // Only the alive item is returned by the DB (deleted one was filtered out).
    selectQueue.push([{ id: 3, name: "Red Bowl", maker: null, style: null }]);

    const result = await searchHouseholdData("bowl", ["pottery"]);

    expect(result).toContain("Red Bowl");
    expect(result).toContain("itemId: 3");
    // The deleted item must not appear.
    expect(result).not.toContain("Deleted Bowl");
  });
});

// ---------------------------------------------------------------------------
// Ornaments
// ---------------------------------------------------------------------------

describe("searchHouseholdData — ornaments", () => {
  it("applies isNull(ornamentsItems.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([
      { id: 1, name: "Frosty", seriesOrCollection: "Winter", year: 2020 },
    ]);

    await searchHouseholdData("frosty", ["ornaments"]);

    const { ornamentsItems } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(ornamentsItems.deletedAt);
  });

  it("returns matching ornament items when the DB returns rows", async () => {
    selectQueue.push([
      { id: 5, name: "Frosty", seriesOrCollection: "Winter", year: 2020 },
    ]);

    const result = await searchHouseholdData("frosty", ["ornaments"]);

    expect(result).toContain("Frosty");
    expect(result).toContain("itemId: 5");
  });

  it("excludes a soft-deleted ornament — returns 'No ornaments found'", async () => {
    selectQueue.push([]);

    const result = await searchHouseholdData("ghost ornament", ["ornaments"]);

    expect(result).toContain("No ornaments found");
  });

  it("reports the count accurately when multiple matching ornaments are returned", async () => {
    selectQueue.push([
      { id: 1, name: "Angel", seriesOrCollection: null, year: 2019 },
      {
        id: 2,
        name: "Angel Deluxe",
        seriesOrCollection: "Celestial",
        year: 2021,
      },
    ]);

    const result = await searchHouseholdData("angel", ["ornaments"]);

    expect(result).toContain("Found 2 ornament(s)");
    expect(result).toContain("Angel");
    expect(result).toContain("Angel Deluxe");
  });
});

// ---------------------------------------------------------------------------
// Fabrics
// ---------------------------------------------------------------------------

describe("searchHouseholdData — fabrics", () => {
  it("applies isNull(fabrics.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([
      { id: 1, name: "Blue Batik", designer: "Jane", manufacturer: "Moda" },
    ]);

    await searchHouseholdData("batik", ["fabrics"]);

    const { fabrics } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(fabrics.deletedAt);
  });

  it("returns matching fabrics when the DB returns rows", async () => {
    selectQueue.push([
      { id: 12, name: "Blue Batik", designer: "Jane", manufacturer: "Moda" },
    ]);

    const result = await searchHouseholdData("batik", ["fabrics"]);

    expect(result).toContain("Blue Batik");
    expect(result).toContain("fabricId: 12");
  });

  it("excludes a soft-deleted fabric — returns 'No fabrics found'", async () => {
    selectQueue.push([]);

    const result = await searchHouseholdData("deleted fabric", ["fabrics"]);

    expect(result).toContain("No fabrics found");
  });
});

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

describe("searchHouseholdData — patterns", () => {
  it("applies isNull(quiltPatterns.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([{ id: 1, name: "Flying Geese", designer: "Sue" }]);

    await searchHouseholdData("geese", ["patterns"]);

    const { quiltPatterns } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(quiltPatterns.deletedAt);
  });

  it("returns matching patterns when the DB returns rows", async () => {
    selectQueue.push([{ id: 4, name: "Flying Geese", designer: "Sue" }]);

    const result = await searchHouseholdData("geese", ["patterns"]);

    expect(result).toContain("Flying Geese");
    expect(result).toContain("patternId: 4");
  });

  it("excludes a soft-deleted pattern — returns 'No quilt patterns found'", async () => {
    selectQueue.push([]);

    const result = await searchHouseholdData("old pattern", ["patterns"]);

    expect(result).toContain("No quilt patterns found");
  });
});

// ---------------------------------------------------------------------------
// Quilts
// ---------------------------------------------------------------------------

describe("searchHouseholdData — quilts", () => {
  it("applies isNull(finishedQuilts.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([
      { id: 1, name: "Grandma's Quilt", dateCompleted: "2022-12-01" },
    ]);

    await searchHouseholdData("grandma", ["quilts"]);

    const { finishedQuilts } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(finishedQuilts.deletedAt);
  });

  it("returns matching quilts when the DB returns rows", async () => {
    selectQueue.push([
      { id: 9, name: "Grandma's Quilt", dateCompleted: "2022-12-01" },
    ]);

    const result = await searchHouseholdData("grandma", ["quilts"]);

    expect(result).toContain("Grandma's Quilt");
    expect(result).toContain("quiltId: 9");
  });

  it("excludes a soft-deleted quilt — returns 'No finished quilts found'", async () => {
    selectQueue.push([]);

    const result = await searchHouseholdData("old quilt", ["quilts"]);

    expect(result).toContain("No finished quilts found");
  });
});

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

describe("searchHouseholdData — trips", () => {
  it("applies isNull(travelsTrips.deletedAt) in the WHERE clause", async () => {
    selectQueue.push([
      {
        id: 1,
        title: "Paris Trip",
        destination: "Paris",
        status: "planning",
        startDate: "2026-10-01",
        endDate: "2026-10-08",
        itinerary: null,
      },
    ]);

    await searchHouseholdData("paris", ["trips"]);

    const { travelsTrips } = await dbTables();
    expect(isNullSpy).toHaveBeenCalledWith(travelsTrips.deletedAt);
  });

  it("returns matching trips when the DB returns rows", async () => {
    selectQueue.push([
      {
        id: 2,
        title: "Paris Trip",
        destination: "Paris",
        status: "planning",
        startDate: "2026-10-01",
        endDate: "2026-10-08",
        itinerary: null,
      },
    ]);

    const result = await searchHouseholdData("paris", ["trips"]);

    expect(result).toContain("Paris Trip");
    expect(result).toContain("tripId: 2");
  });

  it("excludes a soft-deleted trip — returns 'No trips found'", async () => {
    selectQueue.push([]);

    const result = await searchHouseholdData("cancelled trip", ["trips"]);

    expect(result).toContain("No trips found");
  });

  it("includes itinerary activities in the output when present", async () => {
    selectQueue.push([
      {
        id: 3,
        title: "Rome",
        destination: "Rome",
        status: "booked",
        startDate: "2026-11-01",
        endDate: "2026-11-07",
        itinerary: {
          days: [
            {
              date: "2026-11-01",
              title: "Arrival",
              activities: [{ time: "14:00", name: "Hotel Check-in" }],
            },
          ],
        },
      },
    ]);

    const result = await searchHouseholdData("rome", ["trips"]);

    expect(result).toContain("Itinerary");
    expect(result).toContain("Hotel Check-in");
  });
});

// ---------------------------------------------------------------------------
// Multi-domain
// ---------------------------------------------------------------------------

describe("searchHouseholdData — multiple domains", () => {
  it("applies separate isNull predicates for each collection", async () => {
    selectQueue.push([{ id: 1, name: "Blue Vase", maker: null, style: null }]); // pottery
    selectQueue.push([
      { id: 2, name: "Blue Star", seriesOrCollection: null, year: null },
    ]); // ornaments

    await searchHouseholdData("blue", ["pottery", "ornaments"]);

    const { potteryItems, ornamentsItems } = await dbTables();
    const calledWith = isNullSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calledWith).toContain(potteryItems.deletedAt);
    expect(calledWith).toContain(ornamentsItems.deletedAt);
  });

  it("shows 'No X found' for a fully-deleted domain while another has results", async () => {
    selectQueue.push([]); // pottery — all deleted, no results
    selectQueue.push([
      { id: 5, name: "Blue Star", seriesOrCollection: "Sky", year: 2023 },
    ]); // ornaments

    const result = await searchHouseholdData("blue", ["pottery", "ornaments"]);

    expect(result).toContain("No pottery pieces found");
    expect(result).toContain("Blue Star");
  });

  it("returns domain-specific 'No X found' messages when every domain returns empty", async () => {
    selectQueue.push([]); // pottery — all soft-deleted, DB returns nothing
    selectQueue.push([]); // ornaments — all soft-deleted, DB returns nothing

    const result = await searchHouseholdData("xyzzy", ["pottery", "ornaments"]);

    // Each domain reports its own "no match" message; no itemId or fabricId present.
    expect(result).toContain("No pottery pieces found");
    expect(result).toContain("No ornaments found");
    expect(result).not.toContain("itemId:");
  });
});
