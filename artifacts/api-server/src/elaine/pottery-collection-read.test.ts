import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const state = vi.hoisted(() => ({
  owner: true,
  rows: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  limits: [] as number[],
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: (columns: Record<string, unknown>) => {
        let table: unknown;
        let condition: SQL | undefined;
        let limit = Infinity;
        const builder = {
          from(value: unknown) {
            table = value;
            return builder;
          },
          where(value: SQL) {
            condition = value;
            return builder;
          },
          orderBy() {
            return builder;
          },
          limit(value: number) {
            limit = value;
            state.limits.push(value);
            return builder;
          },
          then(resolve: (rows: unknown[]) => unknown) {
            if (table === actual.appUsers)
              return Promise.resolve([{ isOwner: state.owner }]).then(resolve);
            const query = new PgDialect().sqlToQuery(condition!);
            state.queries.push(query);
            let rows = state.rows.filter((row) => row.deletedAt === null);
            for (const match of query.sql.matchAll(
              /"(?:pottery_items|quilting_fabrics|ornaments_items)"\."id" (<=|>|=) \$(\d+)/g,
            )) {
              const bound = Number(query.params[Number(match[2]) - 1]);
              rows = rows.filter((row) =>
                match[1] === "<="
                  ? Number(row.id) <= bound
                  : match[1] === ">"
                    ? Number(row.id) > bound
                    : Number(row.id) === bound,
              );
            }
            if ("value" in columns) {
              const expr = new PgDialect().sqlToQuery(columns.value as SQL).sql;
              return Promise.resolve([
                {
                  value: expr.startsWith("max(")
                    ? rows.length
                      ? Math.max(...rows.map((row) => Number(row.id)))
                      : null
                    : rows.length,
                },
              ]).then(resolve);
            }
            const result = rows
              .sort((a, b) => Number(a.id) - Number(b.id))
              .slice(0, limit)
              .map((row) =>
                Object.fromEntries(
                  Object.keys(columns).map((key) => [key, row[key]]),
                ),
              );
            return Promise.resolve(result).then(resolve);
          },
        };
        return builder;
      },
    },
  };
});

import {
  BrowsePotteryPayload,
  browsePotteryCollection,
  potteryReviewEvidence,
  readPotteryReviewItem,
} from "./pottery-collection-read";
import {
  BrowseFabricPayload,
  BrowseOrnamentPayload,
  browseFabricCollection,
  browseOrnamentCollection,
} from "./household-collection-read";

beforeEach(() => {
  state.owner = true;
  state.queries = [];
  state.limits = [];
  state.rows = Array.from({ length: 225 }, (_, index) => ({
    id: index + 1,
    userId: (index % 2) + 1,
    deletedAt: null,
    name: `Bowl ${index + 1}`,
    patternDescription: index === 0 ? null : "Blue painted flowers",
    aiDescription: null,
    description: index === 0 ? null : "Printed box description",
    descriptionGenerated: false,
    designer: "Saved designer",
    printType: "floral",
    motifs: ["flowers"],
    dominantColors: ["blue"],
    surfaceZones: { rim: "dots" },
    imagePath: "private-path",
  }));
  state.rows.push({ id: 226, deletedAt: new Date(), name: "Deleted bowl" });
});

describe.each([
  {
    domain: "fabrics",
    browse: browseFabricCollection,
    schema: BrowseFabricPayload,
    defaultSize: 50,
    maxSize: 500,
    idKey: "fabricId",
  },
  {
    domain: "ornaments",
    browse: browseOrnamentCollection,
    schema: BrowseOrnamentPayload,
    defaultSize: 60,
    maxSize: 200,
    idKey: "itemId",
  },
])(
  "$domain full collection review",
  ({ domain, browse, schema, defaultSize, maxSize, idKey }) => {
    it("reads multiple pages across uploaders, excluding deleted records with explicit coverage and evidence", async () => {
      const ids: number[] = [];
      let cursor: unknown;
      do {
        const page = JSON.parse(
          await browse(99, JSON.stringify({ pageSize: 100, cursor })),
        );
        expect(page.coverage).toMatchObject({
          total: 225,
          returned: page.items.length,
          remaining: 225 - ids.length - page.items.length,
          complete: page.nextCursor === null,
          photosInspected: 0,
        });
        expect(page.evidencePolicy).toContain("Saved catalog metadata only");
        expect(page.evidencePolicy).toContain("current-message attachments");
        for (const row of page.items) {
          expect(row).toMatchObject({
            evidenceSource: "saved_catalog_metadata",
            photosInspected: 0,
          });
          expect(row).not.toHaveProperty("imagePath");
          expect(row).not.toHaveProperty("userId");
          expect(row).not.toHaveProperty("embedding");
        }
        if (ids.length === 0) {
          expect(page.coverage.missingDecorativeDescriptions).toBe(
            domain === "fabrics" ? 100 : 1,
          );
          expect(page.items[0].missingDecorativeDescription).toBe(true);
          if (domain === "ornaments")
            expect(page.items[1].descriptionGenerated).toBe(false);
          else expect(page.items[1].printType).toBe("floral");
        }
        ids.push(
          ...page.items.map((row: Record<string, number>) => row[idKey]),
        );
        cursor = page.nextCursor;
        expect(ids.length).toBeLessThanOrEqual(225);
      } while (cursor);
      expect(ids).toEqual(Array.from({ length: 225 }, (_, index) => index + 1));
      expect(new Set(ids).size).toBe(225);
      expect(
        state.queries.every((q) => q.sql.includes('"deleted_at" is null')),
      ).toBe(true);
      expect(state.queries.every((q) => !q.sql.includes("user_id"))).toBe(true);
      expect(state.limits).toEqual([100, 100, 100]);
    });

    it("keeps the initial boundary through earlier and unread deletions and later additions", async () => {
      const first = JSON.parse(await browse(99, '{"pageSize":100}'));
      state.rows[0].deletedAt = new Date();
      state.rows[100].deletedAt = new Date();
      state.rows.push({ id: 227, deletedAt: null, name: "Later addition" });
      const second = JSON.parse(
        await browse(
          99,
          JSON.stringify({ pageSize: maxSize, cursor: first.nextCursor }),
        ),
      );
      expect(second.throughId).toBe(225);
      expect(
        second.items.map((row: Record<string, number>) => row[idKey]),
      ).toEqual(Array.from({ length: 124 }, (_, index) => index + 102));
      expect(second.coverage).toMatchObject({
        total: 223,
        returned: 124,
        remaining: 0,
        complete: true,
      });
      expect(second.nextCursor).toBeNull();
    });

    it("rejects non-owners and unverified identities before collection access", async () => {
      state.owner = false;
      expect(await browse(99, "{}")).toMatch(/Access denied/);
      state.owner = true;
      expect(await browse(99, "{}", false)).toMatch(/Access denied/);
      expect(state.queries).toEqual([]);
    });

    it("preserves each domain's limits and rejects invalid or forged cursors", async () => {
      expect(schema.parse({}).pageSize).toBe(defaultSize);
      expect(schema.parse({ pageSize: maxSize }).pageSize).toBe(maxSize);
      for (const value of [
        { pageSize: maxSize + 1 },
        { pageSize: 0 },
        { pageSize: 1.5 },
        { cursor: { afterId: 6, throughId: 2 } },
        { cursor: { afterId: -1, throughId: 2 } },
        { cursor: { afterId: 1 } },
        { cursor: { afterId: 0, throughId: 225, userId: 1 } },
        { userId: 1 },
      ])
        expect(await browse(99, JSON.stringify(value))).toContain(
          `Invalid ${domain} browse`,
        );
      expect(await browse(99, "{")).toContain(`Invalid ${domain} browse`);
      expect(state.queries).toEqual([]);
      const first = JSON.parse(await browse(99, "{}"));
      expect(first.coverage.returned).toBe(defaultSize);
    });

    it("reports empty collections and a deleted unread remainder honestly", async () => {
      const first = JSON.parse(await browse(99, '{"pageSize":100}'));
      state.rows.forEach((row) => {
        if (Number(row.id) > 100) row.deletedAt = new Date();
      });
      const final = JSON.parse(
        await browse(99, JSON.stringify({ cursor: first.nextCursor })),
      );
      expect(final.coverage).toMatchObject({
        total: 100,
        returned: 0,
        remaining: 0,
        complete: true,
      });
      expect(final.nextCursor).toBeNull();
      state.rows = [];
      const empty = JSON.parse(await browse(99, "{}"));
      expect(empty.coverage).toMatchObject({
        total: 0,
        returned: 0,
        remaining: 0,
        complete: true,
      });
      expect(empty.items).toEqual([]);
      expect(empty.throughId).toBe(0);
    });
  },
);

describe("owner-authorized pottery review browsing", () => {
  it("reads all pages once across uploaders with stable IDs and explicit metadata coverage", async () => {
    const ids: number[] = [];
    let cursor: unknown;
    let pageCount = 0;
    do {
      const page = JSON.parse(
        await browsePotteryCollection(
          99,
          JSON.stringify({ pageSize: 100, cursor }),
        ),
      );
      expect(page.coverage.total).toBe(225);
      expect(page.coverage.photosInspected).toBe(0);
      expect(page.coverage.returned).toBe(page.items.length);
      expect(page.coverage.remaining).toBe(
        225 - ids.length - page.items.length,
      );
      expect(page.coverage.complete).toBe(page.nextCursor === null);
      ids.push(...page.items.map((item: { itemId: number }) => item.itemId));
      cursor = page.nextCursor;
      pageCount++;
      expect(pageCount).toBeLessThan(5);
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 225 }, (_, index) => index + 1));
    expect(new Set(ids).size).toBe(225);
    expect(
      state.queries.every((q) => q.sql.includes('"deleted_at" is null')),
    ).toBe(true);
    expect(state.queries.every((q) => !q.sql.includes("user_id"))).toBe(true);
    expect(state.limits).toEqual([100, 100, 100]);
  });

  it("does not skip or duplicate IDs after an earlier deletion or include later additions", async () => {
    const first = JSON.parse(
      await browsePotteryCollection(99, '{"pageSize":100}'),
    );
    state.rows[0].deletedAt = new Date();
    state.rows.push({ id: 227, deletedAt: null, name: "New addition" });
    const second = JSON.parse(
      await browsePotteryCollection(
        99,
        JSON.stringify({ pageSize: 200, cursor: first.nextCursor }),
      ),
    );
    expect(second.items.map((row: { itemId: number }) => row.itemId)).toEqual(
      Array.from({ length: 125 }, (_, index) => index + 101),
    );
    expect(second.coverage.total).toBe(224);
    expect(second.nextCursor).toBeNull();
  });

  it("denies non-owners and unverified channels before reading collection rows", async () => {
    state.owner = false;
    expect(await browsePotteryCollection(99, "{}")).toMatch(/Access denied/);
    state.owner = true;
    expect(await browsePotteryCollection(99, "{}", false)).toMatch(
      /Access denied/,
    );
    expect(state.queries).toEqual([]);
  });

  it("preserves existing default/maximum page sizes and rejects malformed/fractional inputs", async () => {
    expect(BrowsePotteryPayload.parse({}).pageSize).toBe(60);
    for (const input of [
      { pageSize: 201 },
      { pageSize: 0 },
      { pageSize: 1.5 },
      { cursor: { afterId: 5, throughId: 2 } },
      { cursor: { afterId: -1, throughId: 2 } },
    ]) {
      expect(await browsePotteryCollection(99, JSON.stringify(input))).toMatch(
        /Invalid pottery browse/,
      );
    }
    expect(await browsePotteryCollection(99, "{")).toMatch(
      /Invalid pottery browse/,
    );
    expect(state.queries).toEqual([]);
  });

  it("handles empty collections and cursors with no surviving remainder", async () => {
    state.rows = [];
    const page = JSON.parse(await browsePotteryCollection(99, "{}"));
    expect(page.items).toEqual([]);
    expect(page.coverage).toMatchObject({
      total: 0,
      returned: 0,
      remaining: 0,
      complete: true,
    });
    expect(page.nextCursor).toBeNull();
  });

  it("returns saved decoration to the model without treating a card or storage URL as vision", async () => {
    const row = await readPotteryReviewItem(2);
    const evidence = potteryReviewEvidence(row!);
    expect(evidence).toMatchObject({
      itemId: 2,
      patternDescription: "Blue painted flowers",
      motifs: ["flowers"],
      surfaceZones: { rim: "dots" },
      evidenceSource: "saved_catalog_metadata",
      photosInspected: 0,
      missingDecorativeDescription: false,
    });
    expect(evidence).not.toHaveProperty("imagePath");
    expect(
      potteryReviewEvidence((await readPotteryReviewItem(1))!)
        .missingDecorativeDescription,
    ).toBe(true);
    expect(await readPotteryReviewItem(226)).toBeUndefined();
    expect(await readPotteryReviewItem(999)).toBeUndefined();
  });
});
