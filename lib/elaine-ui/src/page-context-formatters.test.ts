/**
 * Tests for the shared Elaine page-context formatters.
 *
 * These tests run against the real production implementation in
 * page-context-formatters.ts.  The output format is load-bearing: Elaine
 * reads the context string and uses the "entityId: N — <name>" pattern to
 * resolve the correct numeric ID before calling an action executor.  A format
 * regression here would cause Elaine to hallucinate IDs on any migrated page.
 *
 * Coverage:
 *   • formatElaineContextEntity — four entity types matching the migrated pages
 *     (pottery categories, quilting shopping list, quilts list, travels wishlist)
 *   • formatElaineContextList — truncation, empty state, omission marker
 *   • Combined output matching the exact strings each page builds
 */

import { describe, expect, it } from "vitest";
import {
  formatElaineContextEntity,
  formatElaineContextList,
} from "./page-context-formatters";

// ─────────────────────────────────────────────────────────────────────────────
// formatElaineContextEntity
// ─────────────────────────────────────────────────────────────────────────────

describe("formatElaineContextEntity — output shape", () => {
  it("produces 'entityId: N — <quoted-name>' for a pottery category", () => {
    const out = formatElaineContextEntity({
      entity: "category",
      id: 7,
      label: "Florals",
    });
    expect(out).toBe('categoryId: 7 — "Florals"');
  });

  it("produces the correct format for a quilting shopping item", () => {
    const out = formatElaineContextEntity({
      entity: "shoppingItem",
      id: 23,
      label: "Blue floral print",
      details: ["status: want"],
    });
    expect(out).toBe('shoppingItemId: 23 — "Blue floral print", status: want');
  });

  it("produces the correct format for a finished quilt", () => {
    const out = formatElaineContextEntity({
      entity: "quilt",
      id: 5,
      label: "Grandmother's Garden",
    });
    expect(out).toBe('quiltId: 5 — "Grandmother\'s Garden"');
  });

  it("produces the correct format for a travels wishlist item", () => {
    const out = formatElaineContextEntity({
      entity: "wishlist",
      id: 18,
      label: "Kyoto, Japan",
    });
    expect(out).toBe('wishlistId: 18 — "Kyoto, Japan"');
  });

  it("JSON-encodes the label so names with quotes are unambiguous", () => {
    const out = formatElaineContextEntity({
      entity: "category",
      id: 3,
      label: 'He said "blue"',
    });
    expect(out).toContain('"He said \\"blue\\""');
  });

  it("appends multiple detail fields separated by comma-space", () => {
    const out = formatElaineContextEntity({
      entity: "category",
      id: 7,
      label: "Florals",
      details: ["3 piece(s)", "unused"],
    });
    expect(out).toBe('categoryId: 7 — "Florals", 3 piece(s), unused');
  });

  it("omits falsy detail entries (null, undefined, false) without breaking format", () => {
    const out = formatElaineContextEntity({
      entity: "shoppingItem",
      id: 23,
      label: "Gold thread",
      details: [null, undefined, false, "status: want"],
    });
    expect(out).toBe('shoppingItemId: 23 — "Gold thread", status: want');
  });

  it("produces no trailing comma when all details are falsy", () => {
    const out = formatElaineContextEntity({
      entity: "quilt",
      id: 99,
      label: "Log Cabin Throw",
      details: [null, false],
    });
    expect(out).toBe('quiltId: 99 — "Log Cabin Throw"');
  });

  it("accepts a string id and includes it verbatim", () => {
    const out = formatElaineContextEntity({
      entity: "thing",
      id: "abc-123",
      label: "Something",
    });
    expect(out).toBe('thingId: abc-123 — "Something"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatElaineContextList
// ─────────────────────────────────────────────────────────────────────────────

describe("formatElaineContextList — output shape", () => {
  it("formats a pottery categories list matching the exact page context", () => {
    const cats = [
      { id: 7, name: "Florals", count: 3 },
      { id: 12, name: "Geometric", count: 0 },
    ];
    const out = formatElaineContextList(cats, {
      label: "Categories (categoryId — name, piece count)",
      formatItem: (c) =>
        formatElaineContextEntity({
          entity: "category",
          id: c.id,
          label: c.name,
          details: [`${c.count ?? 0} piece(s)`],
        }),
    });
    expect(out).toContain('categoryId: 7 — "Florals", 3 piece(s)');
    expect(out).toContain('categoryId: 12 — "Geometric", 0 piece(s)');
    expect(out).toMatch(/^Categories \(categoryId/);
  });

  it("formats a quilting shopping list matching the exact page context", () => {
    const items = [
      { id: 23, name: "Blue floral print", status: "want" },
      { id: 41, name: "Gold thread", status: "ordered" },
    ];
    const out = formatElaineContextList(items, {
      label: "Visible items",
      formatItem: (i) =>
        formatElaineContextEntity({
          entity: "shoppingItem",
          id: i.id,
          label: i.name,
          details: [`status: ${i.status}`],
        }),
      limit: 30,
    });
    expect(out).toContain('shoppingItemId: 23 — "Blue floral print"');
    expect(out).toContain('shoppingItemId: 41 — "Gold thread"');
    expect(out).toContain("status: want");
    expect(out).toContain("status: ordered");
  });

  it("formats a quilts list matching the exact page context", () => {
    const quilts = [
      { id: 5, name: "Grandmother's Garden" },
      { id: 99, name: "Log Cabin Throw" },
    ];
    const out = formatElaineContextList(quilts, {
      label: "Visible quilts",
      formatItem: (q) =>
        formatElaineContextEntity({ entity: "quilt", id: q.id, label: q.name }),
      limit: 30,
    });
    expect(out).toContain('quiltId: 5 — "Grandmother\'s Garden"');
    expect(out).toContain('quiltId: 99 — "Log Cabin Throw"');
  });

  it("formats a travels wishlist matching the exact page context", () => {
    const items = [
      { id: 18, destination: "Kyoto, Japan" },
      { id: 34, destination: "Reykjavik, Iceland" },
    ];
    const out = formatElaineContextList(items, {
      label: "Destinations",
      formatItem: (i) =>
        formatElaineContextEntity({
          entity: "wishlist",
          id: i.id,
          label: i.destination,
        }),
    });
    expect(out).toContain('wishlistId: 18 — "Kyoto, Japan"');
    expect(out).toContain('wishlistId: 34 — "Reykjavik, Iceland"');
  });

  it("truncates to the limit and appends an omission marker", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }));
    const out = formatElaineContextList(items, {
      label: "Items",
      formatItem: (i) =>
        formatElaineContextEntity({ entity: "item", id: i.id, label: i.name }),
      limit: 50,
    });
    expect(out).toContain('itemId: 1 — "Item 1"');
    expect(out).toContain("10 more not shown");
    expect(out).not.toContain('itemId: 60');
  });

  it("uses the default limit of 50 when limit is not specified", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, name: `X${i + 1}` }));
    const out = formatElaineContextList(items, {
      label: "L",
      formatItem: (i) =>
        formatElaineContextEntity({ entity: "x", id: i.id, label: i.name }),
    });
    expect(out).toContain("1 more not shown");
  });

  it("returns the emptyLabel when items array is empty", () => {
    const out = formatElaineContextList([], {
      label: "Categories",
      formatItem: () => "never",
      emptyLabel: "no categories yet",
    });
    expect(out).toBe("Categories: no categories yet");
  });

  it("uses 'none' as the default emptyLabel", () => {
    const out = formatElaineContextList([], {
      label: "Items",
      formatItem: () => "never",
    });
    expect(out).toBe("Items: none");
  });

  it("joins items with '; ' separator", () => {
    const items = [{ id: 1 }, { id: 2 }];
    const out = formatElaineContextList(items, {
      label: "L",
      formatItem: (i) => `id:${i.id}`,
    });
    expect(out).toBe("L: id:1; id:2");
  });
});
