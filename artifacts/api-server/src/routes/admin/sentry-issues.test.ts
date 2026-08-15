/**
 * Tests for the owner-only /api/admin/sentry/issues route:
 *   • rejects invalid environment values with 400
 *   • returns { configured: false } cleanly when Sentry isn't configured
 *   • forwards the environment filter to the issues client
 *   • maps client failures to 502
 *   • 401/403 when unauthenticated / not owner
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const mockListSentryIssues = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ authed: true, owner: true }));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.authed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.session = { userId: 1 };
    next();
  },
}));

vi.mock("../../middleware/owner", () => ({
  requireOwner: (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.owner) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/sentry-issues", () => ({
  listSentryIssues: mockListSentryIssues,
}));

import sentryIssuesRouter from "./sentry-issues";

function makeApp(): Express {
  const app = express();
  app.use("/api/admin/sentry/issues", sentryIssuesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.authed = true;
  authState.owner = true;
});

describe("GET /api/admin/sentry/issues", () => {
  it("returns 401 when unauthenticated", async () => {
    authState.authed = false;
    const res = await request(makeApp()).get("/api/admin/sentry/issues");
    expect(res.status).toBe(401);
    expect(mockListSentryIssues).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner", async () => {
    authState.owner = false;
    const res = await request(makeApp()).get("/api/admin/sentry/issues");
    expect(res.status).toBe(403);
    expect(mockListSentryIssues).not.toHaveBeenCalled();
  });

  it("rejects an invalid environment with 400", async () => {
    const res = await request(makeApp()).get(
      "/api/admin/sentry/issues?environment=staging",
    );
    expect(res.status).toBe(400);
    expect(mockListSentryIssues).not.toHaveBeenCalled();
  });

  it("returns configured:false cleanly when Sentry isn't configured", async () => {
    mockListSentryIssues.mockResolvedValue({ configured: false, issues: [] });
    const res = await request(makeApp()).get("/api/admin/sentry/issues");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: false,
      environment: "production",
      issues: [],
    });
  });

  it("defaults to production and forwards development when requested", async () => {
    mockListSentryIssues.mockResolvedValue({ configured: true, issues: [] });
    await request(makeApp()).get("/api/admin/sentry/issues");
    expect(mockListSentryIssues).toHaveBeenCalledWith({
      environment: "production",
    });
    await request(makeApp()).get(
      "/api/admin/sentry/issues?environment=development",
    );
    expect(mockListSentryIssues).toHaveBeenCalledWith({
      environment: "development",
    });
  });

  it("returns the issues list when configured", async () => {
    const issues = [
      {
        id: "1",
        shortId: "APP-1",
        title: "boom",
        culprit: "x.ts",
        level: "error",
        count: 3,
        userCount: 1,
        firstSeen: "2026-08-14T00:00:00Z",
        lastSeen: "2026-08-15T00:00:00Z",
        permalink: "https://sentry.io/x/1",
        status: "unresolved",
      },
    ];
    mockListSentryIssues.mockResolvedValue({ configured: true, issues });
    const res = await request(makeApp()).get("/api/admin/sentry/issues");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.issues).toEqual(issues);
  });

  it("maps a Sentry API failure to 502", async () => {
    mockListSentryIssues.mockRejectedValue(new Error("Sentry down"));
    const res = await request(makeApp()).get("/api/admin/sentry/issues");
    expect(res.status).toBe(502);
  });
});
