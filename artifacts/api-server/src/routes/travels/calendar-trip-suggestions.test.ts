import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock("../../lib/travels-calendar-scan", () => ({
  scanCalendarForTripSuggestions: mocks.scan,
}));
vi.mock("../../middleware/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../middleware/rateLimit", () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/trip-calendar-sync", () => ({
  linkExistingCalendarEvent: vi.fn(),
}));
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn() },
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {},
}));

import router from "./calendar-trip-suggestions";
const app = express();
app.use((req, _res, next) => {
  req.session = { userId: 1 } as typeof req.session;
  next();
});
app.use(router);

describe("manual calendar scan", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reports a caught timeout as unavailable instead of a successful empty scan", async () => {
    mocks.scan.mockResolvedValue({ scanned: 4, created: 0, completed: false });
    const response = await request(app).post("/calendar-trip-suggestions/scan");
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("timed out");
    expect(response.body).not.toHaveProperty("created");
  });

  it("returns a completed scan normally", async () => {
    const result = { scanned: 4, created: 1, completed: true };
    mocks.scan.mockResolvedValue(result);
    const response = await request(app).post("/calendar-trip-suggestions/scan");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ scanned: 4, created: 1 });
  });

  it("does not expose unexpected error details", async () => {
    mocks.scan.mockRejectedValue(new Error("private provider failure"));
    const response = await request(app).post("/calendar-trip-suggestions/scan");
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Could not scan your connected calendars right now.",
    });
  });
});
