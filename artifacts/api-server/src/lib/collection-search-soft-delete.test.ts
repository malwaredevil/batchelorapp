/**
 * Behavioral tests: soft-deleted items must not appear in semantic search results
 *
 * `semanticCollectionSearch` has two independent layers that must both exclude
 * deleted rows:
 *
 *   1. The raw-SQL vector lanes receive a `visibilityWhere` predicate that is
 *      interpolated into the WHERE clause of every pgvector similarity query.
 *      This stops deleted rows from entering the candidate pool in the first place.
 *
 *   2. The `fetchDocuments` callback (caller-provided) re-applies the same
 *      isNull(deletedAt) filter when hydrating candidates.  Any row that
 *      disappears between the vector scan and hydration (e.g. deleted in a
 *      concurrent request) is stripped by the `visibleCandidateIds` guard before
 *      the final reranker step.
 *
 * The tests below exercise layer 2 by feeding a deleted item's id through the
 * mocked vector lane (simulating a vector match) and then having `fetchDocuments`
 * return nothing for that id — exactly what the isNull guard achieves in
 * production.  The assertion is that the deleted id never appears in the output.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — all values used inside vi.mock() factories must live here.
// ---------------------------------------------------------------------------

const {
  mockEmbedText,
  mockJinaEmbedding,
  mockDbExecuteRows,
  mockRRFResult,
  mockRerankResult,
  dbMock,
} = vi.hoisted(() => {
  const mockDbExecuteRows: { rows: Array<{ id: number; similarity: number }> } =
    {
      rows: [],
    };

  const dbMock = {
    execute: vi.fn(async () => mockDbExecuteRows),
  };

  return {
    mockEmbedText: vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValue([0.1, 0.2, 0.3]),
    mockJinaEmbedding: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    mockDbExecuteRows,
    mockRRFResult: [] as Array<{ id: number; similarity: number }>,
    mockRerankResult: [] as number[],
    dbMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("./openai", () => ({
  embedText: mockEmbedText,
}));

vi.mock("./visual-embed", () => ({
  getJinaTextEmbedding: mockJinaEmbedding,
}));

vi.mock("./reranker", () => ({
  reciprocalRankFusion: vi.fn(
    (_lanes: unknown, _k: unknown, _pool: unknown) => mockRRFResult,
  ),
  rerankCandidates: vi.fn(
    async (_query: unknown, _docs: unknown, _limit: unknown) =>
      mockRerankResult,
  ),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are registered)
// ---------------------------------------------------------------------------

import { semanticCollectionSearch } from "./collection-search";
import { isNull, sql } from "drizzle-orm";
import { potteryItems, fabrics } from "@workspace/db";

beforeEach(() => {
  vi.clearAllMocks();
  mockDbExecuteRows.rows = [];
  mockRRFResult.length = 0;
  mockRerankResult.length = 0;
  mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
  mockJinaEmbedding.mockResolvedValue(null);
  dbMock.execute.mockImplementation(async () => mockDbExecuteRows);
});

// ---------------------------------------------------------------------------
// Helper: build CollectionSearchOptions for tests
// ---------------------------------------------------------------------------

type FetchDocuments = (
  ids: number[],
) => Promise<Array<{ id: number; text: string }>>;

function makeOptions(
  fetchDocuments: FetchDocuments,
  table: typeof potteryItems | typeof fabrics = potteryItems,
) {
  const visibilityWhere =
    table === fabrics
      ? isNull(fabrics.deletedAt)
      : isNull(potteryItems.deletedAt);

  return {
    query: "blue vase",
    table,
    textEmbeddingCol: "embedding",
    visualEmbeddingCol: "visual_embedding",
    visibilityWhere: visibilityWhere as ReturnType<typeof isNull>,
    db: dbMock as unknown as Parameters<
      typeof semanticCollectionSearch
    >[0]["db"],
    fetchDocuments,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("semanticCollectionSearch — soft-delete exclusion", () => {
  it("returns an empty array when embedText returns no vector", async () => {
    mockEmbedText.mockResolvedValue([]);

    const result = await semanticCollectionSearch(makeOptions(async () => []));

    expect(result).toEqual([]);
  });

  it("excludes a deleted item that passes the vector lane but is absent from fetchDocuments", async () => {
    // Scenario: id 42 is a deleted item whose embedding closely matches the query.
    // It appears in the mocked vector lane results (the raw SQL guard would normally
    // prevent this, but we simulate a race-window or test the second defence layer).
    const deletedId = 42;
    const activeId = 7;

    mockDbExecuteRows.rows = [
      { id: deletedId, similarity: 0.99 }, // deleted — highest similarity
      { id: activeId, similarity: 0.8 },
    ];

    // RRF merges both ids.
    mockRRFResult.push(
      { id: deletedId, similarity: 0.99 },
      { id: activeId, similarity: 0.8 },
    );

    // Reranker returns only the active id (called after visible-candidate filter).
    mockRerankResult.push(activeId);

    // fetchDocuments simulates isNull(deletedAt): the deleted item is NOT returned.
    const fetchDocuments = vi.fn(async (ids: number[]) =>
      ids
        .filter((id) => id !== deletedId)
        .map((id) => ({ id, text: `Item ${id}` })),
    );

    const result = await semanticCollectionSearch(makeOptions(fetchDocuments));

    expect(result).not.toContain(deletedId);
    expect(result).toContain(activeId);
  });

  it("passes all candidate ids (including deleted) to fetchDocuments so the guard can filter them", async () => {
    // fetchDocuments is responsible for the isNull guard; it must receive every
    // candidate id so it can decide which ones are still visible.
    const deletedId = 99;
    const activeId = 1;

    mockDbExecuteRows.rows = [
      { id: deletedId, similarity: 0.95 },
      { id: activeId, similarity: 0.7 },
    ];
    mockRRFResult.push(
      { id: deletedId, similarity: 0.95 },
      { id: activeId, similarity: 0.7 },
    );
    mockRerankResult.push(activeId);

    const fetchDocuments = vi.fn(async (ids: number[]) =>
      ids
        .filter((id) => id !== deletedId)
        .map((id) => ({ id, text: `text-${id}` })),
    );

    await semanticCollectionSearch(makeOptions(fetchDocuments));

    expect(fetchDocuments).toHaveBeenCalledTimes(1);
    const calledWithIds: number[] = fetchDocuments.mock.calls[0]![0];
    expect(calledWithIds).toContain(deletedId);
    expect(calledWithIds).toContain(activeId);
  });

  it("returns an empty array and skips reranking when every vector candidate is deleted", async () => {
    const deletedIds = [10, 11, 12];

    mockDbExecuteRows.rows = deletedIds.map((id) => ({ id, similarity: 0.9 }));
    mockRRFResult.push(...deletedIds.map((id) => ({ id, similarity: 0.9 })));
    // mockRerankResult stays empty

    // fetchDocuments returns nothing — all candidates were deleted.
    const fetchDocuments = vi.fn(async (_ids: number[]) => []);

    const result = await semanticCollectionSearch(makeOptions(fetchDocuments));

    expect(result).toEqual([]);
    // rerankCandidates must not be called when there are no visible docs.
    const { rerankCandidates } = await import("./reranker");
    expect(rerankCandidates).not.toHaveBeenCalled();
  });

  it("works correctly for the fabrics table too", async () => {
    const deletedFabricId = 55;
    const activeFabricId = 3;

    mockDbExecuteRows.rows = [
      { id: deletedFabricId, similarity: 0.97 },
      { id: activeFabricId, similarity: 0.75 },
    ];
    mockRRFResult.push(
      { id: deletedFabricId, similarity: 0.97 },
      { id: activeFabricId, similarity: 0.75 },
    );
    mockRerankResult.push(activeFabricId);

    const fetchDocuments = vi.fn(async (ids: number[]) =>
      ids
        .filter((id) => id !== deletedFabricId)
        .map((id) => ({ id, text: `Fabric ${id}` })),
    );

    const result = await semanticCollectionSearch(
      makeOptions(fetchDocuments, fabrics),
    );

    expect(result).not.toContain(deletedFabricId);
    expect(result).toContain(activeFabricId);
  });
});

describe("semanticCollectionSearch — visibilityWhere predicate shape", () => {
  it("isNull(potteryItems.deletedAt) produces a defined SQL predicate object", () => {
    const where = isNull(potteryItems.deletedAt);
    // Drizzle's isNull() returns an SQL object (not null/undefined).
    expect(where).toBeDefined();
    expect(where).not.toBeNull();
    // It should be an object (drizzle SQL node), not a primitive.
    expect(typeof where).toBe("object");
  });

  it("isNull(fabrics.deletedAt) produces a defined SQL predicate object", () => {
    const where = isNull(fabrics.deletedAt);
    expect(where).toBeDefined();
    expect(where).not.toBeNull();
    expect(typeof where).toBe("object");
  });
});

describe("fabric pairings endpoint — hydration soft-delete guard", () => {
  it("the pairings hydration query combines inArray(topIds) with isNull(fabrics.deletedAt)", async () => {
    // Source-code assertion: verifies the fix is present and not accidentally reverted.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");

    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../artifacts/api-server/src/routes/quilting/fabrics.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    // Extract the pairings route block.
    const startMarker = 'router.get("/fabrics/:id/pairings"';
    const endMarker =
      "// ---------------------------------------------------------------------------\n// Get one";
    const pairingsBlock = source.slice(
      source.indexOf(startMarker),
      source.indexOf(endMarker),
    );

    expect(pairingsBlock).toContain("isNull(fabrics.deletedAt)");
    expect(pairingsBlock).toContain("inArray(fabrics.id, topIds)");

    // Both guards must appear together in a single and(...) expression.
    expect(pairingsBlock).toMatch(
      /\.where\(\s*and\(\s*inArray\(fabrics\.id,\s*topIds\),\s*isNull\(fabrics\.deletedAt\)\s*\)\)/,
    );
  });
});
