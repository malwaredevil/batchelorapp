import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

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

vi.mock("../../lib/soft-delete", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../../lib/magnets/serialize", () => ({
  serializeItem: vi.fn(),
  serializeItems: vi.fn(async (rows: unknown[]) =>
    rows.map((row) => ({
      lockedFields: [],
      categories: [],
      images: [],
      imageUrl: null,
      primaryImageId: null,
      ...(row as object),
    })),
  ),
}));

vi.mock("../../lib/magnets/openai", () => ({
  analyzeMagnetImage: vi.fn(),
}));

vi.mock("../../lib/magnets/storage", () => ({
  downloadImageAsDataUrl: vi.fn(),
}));

vi.mock("../../lib/magnets/resolve-categories", () => ({
  resolveOrCreateMagnetCategories: vi.fn(),
}));

let selectQueue: unknown[][] = [];
let whereConditions: unknown[] = [];
let orderByValues: unknown[][] = [];
let limitValues: unknown[] = [];
let offsetValues: unknown[] = [];

function compileSql(sqlObject: unknown) {
  const dialect = new PgDialect();
  return dialect.sqlToQuery(
    sqlObject as Parameters<typeof dialect.sqlToQuery>[0],
  );
}

function makeSelectBuilder() {
  let result: unknown[] = [];
  const builder: Record<string, unknown> = {
    from: () => {
      result = selectQueue.shift() ?? [];
      return builder;
    },
    where: (condition: unknown) => {
      whereConditions.push(condition);
      return builder;
    },
    orderBy: (...values: unknown[]) => {
      orderByValues.push(values);
      return builder;
    },
    limit: (value: unknown) => {
      limitValues.push(value);
      return builder;
    },
    offset: (value: unknown) => {
      offsetValues.push(value);
      return builder;
    },
    then<T1 = unknown[], T2 = never>(
      resolve?: ((value: unknown[]) => T1 | PromiseLike<T1>) | null,
      reject?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) {
      return Promise.resolve(result).then(resolve, reject) as Promise<T1 | T2>;
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

let magnetsRouter: (typeof import("express"))["Router"] extends never
  ? never
  : express.Router;

async function getRouter() {
  if (!magnetsRouter) {
    const module = await import("./magnets");
    magnetsRouter = module.default as express.Router;
  }
  return magnetsRouter;
}

function buildApp(router: express.Router): Express {
  const app = express();
  app.use("/magnets", router);
  return app;
}

describe("GET /magnets/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    whereConditions = [];
    orderByValues = [];
    limitValues = [];
    offsetValues = [];
  });

  it("returns the requested page with the total matching count", async () => {
    selectQueue = [
      [{ value: 5 }],
      [
        {
          id: 4,
          name: "Paris",
          createdAt: "2026-08-04T00:00:00.000Z",
        },
        {
          id: 2,
          name: "London",
          createdAt: "2026-08-03T00:00:00.000Z",
        },
      ],
    ];

    const response = await request(buildApp(await getRouter()))
      .get(
        "/magnets/items?page=2&pageSize=2&sort=name-asc&q=on&categoryIds=3&categoryIds=7&uncategorized=false",
      )
      .expect(200);

    expect(response.body).toMatchObject({
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
    expect(response.body.items).toHaveLength(2);
    expect(limitValues).toEqual([2]);
    expect(offsetValues).toEqual([2]);
    expect(orderByValues).toHaveLength(1);
    expect(orderByValues[0]!.length).toBeGreaterThanOrEqual(2);
    expect(compileSql(orderByValues[0]![0]).sql).toMatch(/case/i);

    const compiled = compileSql(whereConditions[0]);
    expect(compiled.sql).toMatch(/exists\s*\(/i);
    expect(compiled.sql).toMatch(/category_id in \(\$\d+, \$\d+\)/i);
    expect(compiled.sql).not.toMatch(/not exists/i);
    expect(compiled.params).toEqual(
      expect.arrayContaining([3, 7, "%on%", "%ons%"]),
    );
  });

  it("keeps an empty result on a single page", async () => {
    selectQueue = [[{ value: 0 }], []];

    const response = await request(buildApp(await getRouter()))
      .get("/magnets/items?page=4&pageSize=50&uncategorized=true")
      .expect(200);

    expect(response.body).toMatchObject({
      items: [],
      total: 0,
      page: 4,
      pageSize: 50,
      totalPages: 1,
    });

    const compiled = compileSql(whereConditions[0]);
    expect(compiled.sql).toMatch(/not exists\s*\(/i);
    expect(compiled.sql).not.toMatch(/category_id in/i);
    expect(compiled.params).toEqual([]);
  });
});
