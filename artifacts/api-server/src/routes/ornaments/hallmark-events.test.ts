/**
 * Route-level authorization and safety coverage for the owner-only Hallmark
 * sync controls.
 *
 * The public Hallmark calendar CRUD routes remain household-shared. These
 * manual sync controls are different: even a dry-run can call the paid source
 * API, and an apply must never write from a stale preview.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const {
  mockFetchHallmarkEventsSource,
  mockCreateCalendarEvent,
  mockUpdateCalendarEvent,
  mockDeleteCalendarEvent,
  mockListAllCalendarEvents,
  mockGetHallmarkCalendarConnection,
  mockGetValidAccessToken,
  mockGetHallmarkEventSyncStatus,
  mockRunHallmarkEventsSync,
  authState,
  realRunState,
} = vi.hoisted(() => ({
  mockFetchHallmarkEventsSource: vi.fn(),
  mockCreateCalendarEvent: vi.fn(),
  mockUpdateCalendarEvent: vi.fn(),
  mockDeleteCalendarEvent: vi.fn(),
  mockListAllCalendarEvents: vi.fn(),
  mockGetHallmarkCalendarConnection: vi.fn(),
  mockGetValidAccessToken: vi.fn(),
  mockGetHallmarkEventSyncStatus: vi.fn(),
  mockRunHallmarkEventsSync: vi.fn(),
  authState: { authed: true, owner: true },
  realRunState: { run: undefined as unknown },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    res: { status: (statusCode: number) => { json: (body: unknown) => void } },
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
    res: { status: (statusCode: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.owner) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/google-calendar-tokens", () => ({
  getHallmarkCalendarConnection: mockGetHallmarkCalendarConnection,
  getValidAccessToken: mockGetValidAccessToken,
}));

vi.mock("../../lib/google-calendar", () => ({
  createCalendarEvent: mockCreateCalendarEvent,
  updateCalendarEvent: mockUpdateCalendarEvent,
  deleteCalendarEvent: mockDeleteCalendarEvent,
  listAllCalendarEvents: mockListAllCalendarEvents,
}));

vi.mock("../../lib/ornaments/hallmark-events-source", () => ({
  fetchHallmarkEventsSource: mockFetchHallmarkEventsSource,
}));

vi.mock("../../lib/ornaments/hallmark-events-sync", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../lib/ornaments/hallmark-events-sync")
    >();
  realRunState.run = actual.runHallmarkEventsSync;
  return {
    ...actual,
    getHallmarkEventSyncStatus: mockGetHallmarkEventSyncStatus,
    runHallmarkEventsSync: mockRunHallmarkEventsSync,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
    },
  };
});

import hallmarkEventsRouter from "./hallmark-events";

const SYNC_PATH = "/api/ornaments/hallmark-events/admin/sync";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/ornaments", hallmarkEventsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHallmarkEventSyncStatus.mockReset();
  mockRunHallmarkEventsSync.mockReset();
  authState.authed = true;
  authState.owner = true;
  mockFetchHallmarkEventsSource.mockResolvedValue({
    sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
    fetchedAt: "2026-09-02T12:00:00.000Z",
    fingerprint: "b".repeat(64),
    complete: true,
    year: 2026,
    candidates: [
      {
        sourceKey: "ornament-premiere:2026",
        title: "Hallmark Keepsake Ornament Premiere",
        startDate: "2026-07-11",
        endDate: "2026-07-19",
        details: "Shop the new Keepsake ornaments.",
        sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
        year: 2026,
      },
    ],
    rejected: [],
  });
});

describe("Hallmark sync authorization", () => {
  it("returns 403 for an authenticated non-owner requesting sync status", async () => {
    authState.owner = false;

    const res = await request(makeApp()).get(SYNC_PATH);

    expect(res.status).toBe(403);
    expect(mockGetHallmarkEventSyncStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["dry-run", { dryRun: true }],
    ["apply", { dryRun: false }],
  ])(
    "returns 403 for an authenticated non-owner requesting a %s sync",
    async (_mode, body) => {
      authState.owner = false;

      const res = await request(makeApp()).post(SYNC_PATH).send(body);

      expect(res.status).toBe(403);
      expect(mockRunHallmarkEventsSync).not.toHaveBeenCalled();
    },
  );

  it("allows an owner to read sync status", async () => {
    const status = {
      lastStatus: "success",
      candidateCount: 12,
    };
    mockGetHallmarkEventSyncStatus.mockResolvedValue(status);

    const res = await request(makeApp()).get(SYNC_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(status);
    expect(mockGetHallmarkEventSyncStatus).toHaveBeenCalledOnce();
  });

  it("allows an owner to run a dry-run sync", async () => {
    const result = { mode: "dry-run", status: "dry_run", actions: [] };
    mockRunHallmarkEventsSync.mockResolvedValue(result);

    const res = await request(makeApp()).post(SYNC_PATH).send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(mockRunHallmarkEventsSync).toHaveBeenCalledWith(
      "dry-run",
      undefined,
    );
  });

  it("allows an owner to run an apply sync", async () => {
    const result = { mode: "apply", status: "success", actions: [] };
    mockRunHallmarkEventsSync.mockResolvedValue(result);

    const res = await request(makeApp())
      .post(SYNC_PATH)
      .send({ dryRun: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(mockRunHallmarkEventsSync).toHaveBeenCalledWith("apply", undefined);
  });
});

describe("Hallmark stale preview protection", () => {
  it("rejects a stale preview before attempting any calendar write", async () => {
    const stalePreviewFingerprint = "a".repeat(64);
    mockRunHallmarkEventsSync.mockImplementation(
      (mode: "dry-run" | "apply", sourceFingerprint?: string) =>
        (
          realRunState.run as typeof import("../../lib/ornaments/hallmark-events-sync").runHallmarkEventsSync
        )(mode, sourceFingerprint),
    );

    const response = await request(makeApp())
      .post(SYNC_PATH)
      .send({ dryRun: false, sourceFingerprint: stalePreviewFingerprint });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "STALE_PREVIEW",
      error:
        "The Hallmark source changed after this preview. Run a new preview before applying.",
      expectedSourceFingerprint: stalePreviewFingerprint,
      actualSourceFingerprint: "b".repeat(64),
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
    expect(mockUpdateCalendarEvent).not.toHaveBeenCalled();
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(mockListAllCalendarEvents).not.toHaveBeenCalled();
    expect(mockGetHallmarkCalendarConnection).not.toHaveBeenCalled();
  });
});

describe("Hallmark incomplete source protection", () => {
  it("returns the existing failure response without changing the calendar", async () => {
    mockFetchHallmarkEventsSource.mockResolvedValueOnce({
      sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
      fetchedAt: "2026-09-02T12:00:00.000Z",
      fingerprint: "c".repeat(64),
      complete: false,
      year: 2026,
      candidates: [],
      rejected: [],
    });
    mockRunHallmarkEventsSync.mockImplementation(
      (mode: "dry-run" | "apply", sourceFingerprint?: string) =>
        (
          realRunState.run as typeof import("../../lib/ornaments/hallmark-events-sync").runHallmarkEventsSync
        )(mode, sourceFingerprint),
    );

    const response = await request(makeApp())
      .post(SYNC_PATH)
      .send({ dryRun: false });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Hallmark event sync failed.",
    });
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
    expect(mockUpdateCalendarEvent).not.toHaveBeenCalled();
    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(mockListAllCalendarEvents).not.toHaveBeenCalled();
    expect(mockGetHallmarkCalendarConnection).not.toHaveBeenCalled();
    expect(mockGetValidAccessToken).not.toHaveBeenCalled();
  });
});
