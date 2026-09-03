/**
 * categories-suggest.test.ts
 *
 * Route-level integration tests for the AI-suggested ornament categories
 * feature (Task #1077):
 *   - POST /categories/suggest
 *   - POST /categories/create-and-backfill
 *
 * Covers:
 *   1. suggest: filters out AI-proposed names that already match an existing
 *      category name (case/whitespace-insensitive).
 *   2. suggest: returns [] without ever calling the AI when the collection
 *      has no items yet.
 *   3. create-and-backfill: creates the accepted names (deduped/normalized),
 *      then backfills matches from matchCategoryIds against every item.
 *   4. create-and-backfill: skips assignments for items already assigned to
 *      a given category (no duplicate join rows).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Logger ────────────────────────────────────────────────────────────────────
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Rate limiters (pass-through) ──────────────────────────────────────────────
vi.mock("../../middleware/rateLimit", () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── AI suggestion call (the only paid/external call in this flow) ─────────────
const mockSuggestOrnamentCategoryNames = vi.fn();
vi.mock("../../lib/ornaments/openai", () => ({
  suggestOrnamentCategoryNames: mockSuggestOrnamentCategoryNames,
}));

// ── Matching logic — reused unchanged per this feature's scope; mocked here
//    so each test controls exactly which categories a given item matches. ────
const mockMatchCategoryIds = vi.fn();
vi.mock("../../lib/collection-parsing", () => ({
  matchCategoryIds: mockMatchCategoryIds,
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// A generic chainable select builder backed by a FIFO queue: each call to
// db.select(...).from(...) consumes the next queued row-set. Every other
// chain method (leftJoin/where/groupBy/orderBy/limit) is a pass-through, and
// the builder itself is thenable so `await db.select()...` resolves to the
// row-set regardless of which method call is last in the chain.

let selectQueue: unknown[][] = [];
let insertReturnQueue: unknown[][] = [];

function makeSelectBuilder() {
  let slot: unknown[] = [];
  const builder: Record<string, unknown> = {
    from: () => {
      slot = selectQueue.shift() ?? [];
      return builder;
    },
    leftJoin: () => builder,
    where: () => builder,
    groupBy: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then<T1 = unknown[], T2 = never>(
      ok?: ((v: unknown[]) => T1 | PromiseLike<T1>) | null,
      err?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
    ) {
      return Promise.resolve(slot).then(ok, err) as Promise<T1 | T2>;
    },
  };
  return builder;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const mockDb = {
    select: vi.fn(() => makeSelectBuilder()),
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertReturnQueue.shift() ?? []),
        }),
      }),
    })),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { ...actual, db: mockDb };
});

// ── Router import (deferred so mocks are registered first) ────────────────────
import type { IRouter } from "express";

let categoriesRouter: IRouter;

async function getRouter(): Promise<IRouter> {
  if (!categoriesRouter) {
    const mod = await import("./categories");
    categoriesRouter = mod.default;
  }
  return categoriesRouter;
}

function buildApp(router: IRouter): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: 1,
    };
    next();
  });
  app.use("/ornaments", router);
  return app;
}

describe("POST /ornaments/categories/suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    insertReturnQueue = [];
  });

  it("filters out AI-proposed names that already match an existing category", async () => {
    // 1st select: gatherCollectionSignals' item rows (must be non-empty or
    // suggestOrnamentCategories short-circuits before ever calling the AI).
    selectQueue.push([
      {
        name: "Frosty Friends 2003",
        seriesOrCollection: "Frosty Friends",
        motifs: ["penguin"],
        dominantColors: ["white"],
        brand: "Hallmark",
        notes: null,
      },
    ]);
    // 2nd select: existing category names.
    selectQueue.push([{ name: "star wars" }]);

    mockSuggestOrnamentCategoryNames.mockResolvedValue([
      "Star Wars", // already exists (case-insensitive) → filtered out
      "Frosty Friends", // new → kept
      "Frosty Friends", // duplicate within the AI's own output → deduped
    ]);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/categories/suggest");

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual(["Frosty Friends"]);
    expect(mockSuggestOrnamentCategoryNames).toHaveBeenCalledOnce();
  });

  it("returns [] without calling the AI when the collection has no items", async () => {
    selectQueue.push([]); // no ornament rows at all

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app).post("/ornaments/categories/suggest");

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
    expect(mockSuggestOrnamentCategoryNames).not.toHaveBeenCalled();
  });
});

describe("POST /ornaments/categories/create-and-backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    insertReturnQueue = [];
  });

  it("creates accepted names (deduped/normalized) and backfills matches, skipping already-assigned items", async () => {
    // insert(cats).values(...).onConflictDoNothing().returning() → 1 created
    insertReturnQueue.push([{ id: 10 }]);

    // 1st select inside createAndBackfillOrnamentCategories: all categories
    // (existing + newly created) used for matching.
    selectQueue.push([
      { id: 1, name: "Star Wars" },
      { id: 10, name: "Frosty Friends" },
    ]);
    // 2nd select: every non-deleted item.
    selectQueue.push([
      {
        id: 100,
        name: "Frosty Friends 2003",
        seriesOrCollection: "Frosty Friends",
        dimensions: null,
        motifs: [],
      },
      {
        id: 101,
        name: "Darth Vader",
        seriesOrCollection: "Star Wars",
        dimensions: null,
        motifs: [],
      },
    ]);
    // The portable additive operation reads assignments per item. Item 100
    // has none; item 101 already has category 1 and must not be duplicated.
    selectQueue.push([]);
    selectQueue.push([{ categoryId: 1 }]);

    // matchCategoryIds is called once per item; drive it by item id via the
    // call-order (item 100 first, then 101).
    mockMatchCategoryIds
      .mockReturnValueOnce([10]) // item 100 matches "Frosty Friends"
      .mockReturnValueOnce([1]); // item 101 matches "Star Wars" (already assigned)

    // insert(joinTable).values(...).onConflictDoNothing().returning() → 1 new assignment
    insertReturnQueue.push([{ itemId: 100 }]);

    // The list route repairs only incomplete legacy rows before returning
    // counts. This empty result means no repair query writes are needed.
    selectQueue.push([]);
    // Final select: ops.listWithCounts() result returned in the response body.
    selectQueue.push([
      {
        id: 1,
        name: "Star Wars",
        bgColor: "#0f172a",
        textColor: "#ffffff",
        count: 1,
      },
      {
        id: 10,
        name: "Frosty Friends",
        bgColor: "#4f46e5",
        textColor: "#ffffff",
        count: 1,
      },
    ]);

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app)
      .post("/ornaments/categories/create-and-backfill")
      .send({ names: ["  frosty friends  "] });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(1);
    // Only item 100's match is a genuinely new assignment; item 101's match
    // (category 1) was already recorded and must not be double-inserted.
    expect(res.body.assignmentsCreated).toBe(1);
    expect(res.body.categories).toHaveLength(2);
  });

  it("skips insert entirely when every proposed name is blank/whitespace", async () => {
    // No categories/items/assignments exist yet. The final two selects are
    // the missing-color check and category-count result.
    selectQueue.push([]); // allCats
    selectQueue.push([]); // items
    selectQueue.push([]); // missing legacy colors
    selectQueue.push([]); // final listWithCounts

    const router = await getRouter();
    const app = buildApp(router);
    const res = await request(app)
      .post("/ornaments/categories/create-and-backfill")
      // Both pass the wire schema's min-length(1) check but normalize to
      // an empty string after trimming, so no category should be created.
      .send({ names: ["   ", "  "] });

    expect(res.status).toBe(200);
    expect(res.body.createdCount).toBe(0);
    expect(res.body.assignmentsCreated).toBe(0);
  });
});
