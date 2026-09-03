import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: 1 };
    next();
  },
}));

let seriesRows: Record<string, unknown>[] = [];
const mockWhere = vi.fn();

function makeSelectBuilder() {
  const builder = {
    from: () => builder,
    where: () => {
      mockWhere();
      return Promise.resolve(seriesRows);
    },
  };
  return builder;
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn(() => makeSelectBuilder()),
    },
  };
});

import type { IRouter } from "express";

let statsRouter: IRouter;

async function getRouter(): Promise<IRouter> {
  if (!statsRouter) {
    const mod = await import("./stats");
    statsRouter = mod.default;
  }
  return statsRouter;
}

function buildApp(router: IRouter): Express {
  const app = express();
  app.use("/ornaments", router);
  return app;
}

describe("GET /ornaments/series", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seriesRows = [];
  });

  it("keeps the first stored spelling, combines casing duplicates, and ignores blank values", async () => {
    seriesRows = [
      { seriesOrCollection: "Frosty Friends" },
      { seriesOrCollection: "frosty friends" },
      { seriesOrCollection: "  Star Wars  " },
      { seriesOrCollection: "   " },
      { seriesOrCollection: null },
    ];

    const response = await request(buildApp(await getRouter())).get(
      "/ornaments/series",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { seriesOrCollection: "Frosty Friends", count: 2 },
      { seriesOrCollection: "Star Wars", count: 1 },
    ]);
  });

  it("queries only the active collection rows before forming suggestions", async () => {
    const source = readFileSync(
      fileURLToPath(new URL("./stats.ts", import.meta.url)),
      "utf8",
    );
    const seriesRoute = source.slice(source.indexOf('router.get("/series"'));

    expect(seriesRoute).toContain("isNull(ornamentsItems.deletedAt)");
  });
});

describe("GET /ornaments/stats valuation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seriesRows = [];
  });

  it("uses mixed market signals, retail fallback, and quantity for totals and series", async () => {
    seriesRows = [
      {
        seriesOrCollection: "Book",
        quantity: 2,
        bookValue: "10",
        retailValueUsd: "99",
        ebayPriceMinUsd: null,
        ebayPriceMaxUsd: null,
        ebayLastSoldPriceUsd: null,
        aiAppraisal: null,
      },
      {
        seriesOrCollection: "eBay",
        quantity: 3,
        bookValue: null,
        retailValueUsd: null,
        ebayPriceMinUsd: "20",
        ebayPriceMaxUsd: "40",
        ebayLastSoldPriceUsd: null,
        aiAppraisal: null,
      },
      {
        seriesOrCollection: "Appraisal",
        quantity: 2,
        bookValue: null,
        retailValueUsd: null,
        ebayPriceMinUsd: null,
        ebayPriceMaxUsd: null,
        ebayLastSoldPriceUsd: null,
        aiAppraisal: "Estimated collector value: $5-$15",
      },
      {
        seriesOrCollection: "Retail fallback",
        quantity: 4,
        bookValue: null,
        retailValueUsd: "8",
        ebayPriceMinUsd: null,
        ebayPriceMaxUsd: null,
        ebayLastSoldPriceUsd: null,
        aiAppraisal: null,
      },
      {
        seriesOrCollection: "Unpriced",
        quantity: 1,
        bookValue: null,
        retailValueUsd: null,
        ebayPriceMinUsd: null,
        ebayPriceMaxUsd: null,
        ebayLastSoldPriceUsd: null,
        aiAppraisal: null,
      },
    ];

    const response = await request(buildApp(await getRouter())).get(
      "/ornaments/stats",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalItems: 5,
      totalQuantity: 12,
      totalEstimatedValue: 162,
      itemsWithEstimatedValue: 4,
      valuationPolicy: "market_signals_then_retail_fallback",
    });
    expect(response.body.bySeriesOrCollection).toEqual(
      expect.arrayContaining([
        { seriesOrCollection: "eBay", count: 1, totalValue: 90 },
        { seriesOrCollection: "Retail fallback", count: 1, totalValue: 32 },
        { seriesOrCollection: "Book", count: 1, totalValue: 20 },
      ]),
    );
  });

  it("filters deleted records before they can affect estimates", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./stats.ts", import.meta.url)),
      "utf8",
    );
    const statsRoute = source.slice(source.indexOf('router.get("/stats"'));

    expect(statsRoute).toContain("isNull(ornamentsItems.deletedAt)");
  });
});
