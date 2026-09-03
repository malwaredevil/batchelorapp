import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  fabrics,
  finishedQuilts,
  magnetsItems,
  ornamentsItems,
  potteryItems,
  quiltPatterns,
} from "@workspace/db";
import {
  collectionSearchArrayText,
  createCollectionTextSearch,
  escapeCollectionSearchLikePattern,
  normalizeCollectionSearchTokens,
} from "./collection-text-search";

function compile(query: ReturnType<typeof createCollectionTextSearch>) {
  const dialect = new PgDialect();
  return {
    where: query.where
      ? dialect.sqlToQuery(query.where)
      : { sql: "", params: [] },
    relevance: query.relevance
      ? dialect.sqlToQuery(query.relevance)
      : { sql: "", params: [] },
  };
}

describe("collection text search", () => {
  it("normalizes case and treats each meaningful word as a required token", () => {
    expect(normalizeCollectionSearchTokens("  Sweet   DECADES  ")).toEqual([
      "sweet",
      "decades",
    ]);

    const search = createCollectionTextSearch("Sweet decades", {
      title: [ornamentsItems.name],
      collection: [ornamentsItems.seriesOrCollection],
      broad: [ornamentsItems.description],
    });
    const { where } = compile(search);

    expect(where.sql).toMatch(/\)\s+and\s+\(/i);
    expect(where.params).toEqual(
      expect.arrayContaining(["%sweet%", "%sweets%", "%decades%", "%decade%"]),
    );
  });

  it("uses title, collection, then broad-only relevance tiers", () => {
    const search = createCollectionTextSearch("sweet decades", {
      title: [ornamentsItems.name],
      collection: [ornamentsItems.seriesOrCollection],
      broad: [ornamentsItems.description],
    });
    const { relevance } = compile(search);

    expect(relevance.sql).toMatch(/case/i);
    expect(relevance.sql).toMatch(/when/i);
    expect(relevance.params).toEqual(
      expect.arrayContaining(["%sweet%", "%decade%"]),
    );
  });

  it("escapes wildcard input so it never broadens a user query", () => {
    expect(escapeCollectionSearchLikePattern("100%_\\")).toBe("100\\%\\_\\\\");

    const search = createCollectionTextSearch("100%_\\", {
      title: [magnetsItems.name],
      broad: [magnetsItems.notes, magnetsItems.description],
    });
    const { where } = compile(search);

    expect(where.sql).toContain("escape '\\'");
    expect(where.params).toContain("%100\\%\\_\\\\%");
  });

  it("uses the indexed immutable wrapper for array-backed search fields", () => {
    const search = createCollectionTextSearch("flower", {
      title: [potteryItems.name],
      broad: [collectionSearchArrayText(potteryItems.motifs)],
    });
    const { where } = compile(search);

    expect(where.sql).toContain("collection_search_text");
    expect(where.sql).toContain("motifs");
  });

  it.each([
    ["pottery", potteryItems.name, [potteryItems.maker]],
    ["magnets", magnetsItems.name, [magnetsItems.description]],
    ["fabrics", fabrics.name, [fabrics.designer]],
    ["quilts", finishedQuilts.name, [finishedQuilts.recipient]],
    ["patterns", quiltPatterns.name, [quiltPatterns.designer]],
  ])("builds a strict adapter for %s", (_name, title, broad) => {
    const search = createCollectionTextSearch("blue flower", {
      title: [title],
      broad,
    });
    const { where, relevance } = compile(search);

    expect(search.tokens).toEqual(["blue", "flower"]);
    expect(where.sql).toMatch(/and/i);
    expect(relevance.sql).toMatch(/case/i);
  });
});
