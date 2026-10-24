import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  selectDistinct: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: { selectDistinct: mocks.selectDistinct },
}));
vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) =>
    req.headers["x-test-auth"] === "yes"
      ? next()
      : res.status(401).json({ error: "Unauthorized" }),
}));
import { potteryItems } from "@workspace/db";
import fieldOptionsRouter from "./field-options";

const app = express();
app.use(fieldOptionsRouter);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectDistinct.mockReturnValue({
    from: vi.fn(() => ({ where: mocks.where })),
  });
});

describe("lightweight pottery edit options", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/field-options")).status).toBe(401);
    expect(mocks.selectDistinct).not.toHaveBeenCalled();
  });

  it("selects only makers, trims, deduplicates and sorts the shared options", async () => {
    mocks.where.mockResolvedValue([
      { maker: " Zeta " },
      { maker: "Alpha" },
      { maker: "Zeta" },
      { maker: null },
      { maker: " " },
    ]);
    const res = await request(app)
      .get("/field-options")
      .set("x-test-auth", "yes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ makers: ["Alpha", "Zeta"] });
    expect(mocks.selectDistinct).toHaveBeenCalledWith({
      maker: getTableColumns(potteryItems).maker,
    });
    // The only predicate is active/deleted status, not the requesting user.
    const predicate = mocks.where.mock.calls[0][0];
    expect(predicate.queryChunks).toContain(potteryItems.deletedAt);
    expect(JSON.stringify(res.body).length).toBeLessThan(100);
  });

  it("returns an empty option list for an empty collection", async () => {
    mocks.where.mockResolvedValue([]);
    const res = await request(app)
      .get("/field-options")
      .set("x-test-auth", "yes");
    expect(res.body).toEqual({ makers: [] });
  });
});
