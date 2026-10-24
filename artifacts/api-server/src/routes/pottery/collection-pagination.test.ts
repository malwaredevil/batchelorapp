import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: unknown },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: 999 };
    next();
  },
}));
vi.mock("../../lib/pottery/openai", () => ({
  analyzeImage: vi.fn(),
  analyzePotteryZones: vi.fn(),
  locateBackstampAndEnhanceMaker: vi.fn(),
  buildEmbeddingText: vi.fn(),
  embedText: vi.fn(),
}));

const state = vi.hoisted(() => ({
  projections: [] as string[][],
  conditions: [] as unknown[],
  ordering: [] as unknown[][],
  limits: [] as number[],
  imageReads: 0,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const rows = Array.from({ length: 225 }, (_, index) => ({
    id: 225 - index,
    userId: (index % 2) + 1,
    name: `Vase ${225 - index}`,
    quantity: 1,
    lockedFields: [],
    notes: "Owner notes ".repeat(1000),
    dimensions: null,
    patternDescription: "Flowers",
    style: null,
    shape: "Vase",
    maker: "Maker",
    makerInfo: "Long biography ".repeat(1000),
    aiDescription: "Long description ".repeat(1000),
    acquiredAt: null,
    dominantColors: ["Blue"],
    motifs: ["Flowers"],
    glazeType: null,
    surfaceZones: { zones: ["Detailed zones ".repeat(1000)] },
    imagePath: "photo",
    thumbnail: null,
    createdAt: new Date("2026-01-01"),
  }));
  return {
    ...actual,
    db: {
      select: (columns: Record<string, unknown>) => {
        let table: unknown;
        let limit = rows.length;
        let offset = 0;
        const builder = {
          from(value: unknown) {
            table = value;
            if (table === actual.potteryItems && !("value" in columns)) {
              state.projections.push(Object.keys(columns));
            }
            return builder;
          },
          where(condition: unknown) {
            if (table === actual.potteryItems) state.conditions.push(condition);
            return builder;
          },
          innerJoin() {
            return builder;
          },
          orderBy(...values: unknown[]) {
            state.ordering.push(values);
            return builder;
          },
          limit(value: number) {
            limit = value;
            state.limits.push(value);
            return builder;
          },
          offset(value: number) {
            offset = value;
            return builder;
          },
          then(
            resolve: (value: unknown[]) => unknown,
            reject?: (reason: unknown) => unknown,
          ) {
            let result: unknown[] = [];
            if (table === actual.potteryItems) {
              result =
                "value" in columns
                  ? [{ value: rows.length }]
                  : rows
                      .slice(offset, offset + limit)
                      .map((row) =>
                        Object.fromEntries(
                          Object.keys(columns).map((key) => [
                            key,
                            row[key as keyof typeof row],
                          ]),
                        ),
                      );
            }
            if (table === actual.potteryImages) {
              state.imageReads++;
              result = [
                {
                  itemId: 225,
                  id: 700,
                  storagePath: "other-photo",
                  label: "Back",
                  position: 0,
                },
              ];
            }
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };
});

import router from "./pottery";
const app = express();
app.use(router);
const dialect = new PgDialect();

describe("pottery bounded gallery pagination", () => {
  it("returns all 225 household pieces with a stable order and no detail payloads", async () => {
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await request(app).get(
        `/items?view=gallery&pageSize=100&page=${page}`,
      );
      expect(result.status).toBe(200);
      expect(result.body.total).toBe(225);
      expect(result.body.items.length).toBe(page === 3 ? 25 : 100);
      for (const item of result.body.items) {
        ids.push(item.id);
        expect(item).not.toHaveProperty("notes");
        expect(item).not.toHaveProperty("makerInfo");
        expect(item).not.toHaveProperty("aiDescription");
        expect(item).not.toHaveProperty("surfaceZones");
        expect(item.images).toEqual([]);
        expect(item.patternDescription).toBe("Flowers");
      }
    }
    expect(new Set(ids).size).toBe(225);
    expect(ids).toEqual(Array.from({ length: 225 }, (_, index) => 225 - index));
    expect(state.imageReads).toBe(0);
    expect(state.limits).toEqual([100, 100, 100]);
    for (const projection of state.projections) {
      for (const field of [
        "notes",
        "makerInfo",
        "aiDescription",
        "surfaceZones",
        "embedding",
        "visualEmbedding",
        "zoneEmbedding",
      ]) {
        expect(projection).not.toContain(field);
      }
    }
    for (const condition of state.conditions) {
      const sql = dialect.sqlToQuery(condition as SQL).sql;
      expect(sql).toContain('"deleted_at" is null');
      expect(sql).not.toContain('"user_id"');
    }
    expect(
      state.ordering[0]!.map((value) => dialect.sqlToQuery(value as SQL).sql),
    ).toEqual([
      '"pottery_items"."created_at" desc',
      '"pottery_items"."id" desc',
    ]);
  });

  it("retains full notes and supplemental images for default lists and details", async () => {
    for (const path of ["/items?pageSize=1", "/items/225"]) {
      const result = await request(app).get(path);
      expect(result.status).toBe(200);
      const item = result.body.items?.[0] ?? result.body;
      expect(item.notes).toContain("Owner notes");
      expect(item.makerInfo).toContain("Long biography");
      expect(item.images[0].id).toBe(700);
    }
  });

  it("keeps the page-size cap and rejects unknown projections", async () => {
    expect(
      (await request(app).get("/items?view=gallery&pageSize=201")).status,
    ).toBe(400);
    expect((await request(app).get("/items?view=invalid")).status).toBe(400);
  });
});
