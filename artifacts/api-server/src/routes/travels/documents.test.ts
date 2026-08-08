import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const {
  insertCalls,
  updateCalls,
  deleteCalls,
  lastReturning,
  makeInsertBuilder,
  makeUpdateBuilder,
  makeDeleteBuilder,
} = createTrackedMutationBuilders();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
  delete: vi.fn((table: unknown) => makeDeleteBuilder(table)),
  insert: vi.fn((table: unknown) => makeInsertBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const deleteDocument = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/travels-storage", () => ({
  uploadDocument: vi.fn().mockResolvedValue("travels/mock-path.pdf"),
  downloadDocument: vi.fn().mockResolvedValue({
    buffer: Buffer.from(""),
    contentType: "application/pdf",
  }),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

vi.mock("../../lib/travel-document-extraction", () => ({
  extractFromImage: vi.fn().mockResolvedValue({}),
  extractFromPdf: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../lib/openai", () => ({
  embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const sendItinerarySyncEmail = vi.fn().mockResolvedValue(undefined);
let resendConfiguredMock = true;
vi.mock("../../lib/email", () => ({
  sendItinerarySyncEmail: (...args: unknown[]) =>
    sendItinerarySyncEmail(...args),
  resendConfigured: () => resendConfiguredMock,
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    next();
  },
}));

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 42;

const silentLog = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
};

// Pre-warmed in beforeAll so the first dynamic import completes before any
// test's per-test timeout starts ticking. Without this, the module load
// itself exhausts the default 5 s per-test timeout before the assertion runs.
import type { IRouter } from "express";
let documentsRouter: IRouter;

beforeAll(async () => {
  const mod = await import("./documents");
  documentsRouter = mod.default;
}, 30_000);

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser("test-session-secret"));
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
    };
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/travels", documentsRouter);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (
        err &&
        typeof err === "object" &&
        Array.isArray((err as { issues?: unknown }).issues)
      ) {
        res.status(400).json({ error: "Invalid request." });
        return;
      }
      res.status(500).json({ error: "Something went wrong." });
    },
  );
  return app;
}

function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser("test-session-secret"));
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {};
    (req as unknown as { log: typeof silentLog }).log = silentLog;
    next();
  });
  app.use("/api/travels", documentsRouter);
  return app;
}

beforeEach(() => {
  selectQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  lastReturning.value = [];
  vi.clearAllMocks();
  deleteDocument.mockResolvedValue(undefined);
  resendConfiguredMock = true;
  sendItinerarySyncEmail.mockClear();
});

// ---------------------------------------------------------------------------
// GET /api/travels/documents/unmatched
// ---------------------------------------------------------------------------

describe("GET /api/travels/documents/unmatched", () => {
  it("returns 401 without a session", async () => {
    const app = await buildUnauthApp();

    const res = await request(app).get("/api/travels/documents/unmatched");

    expect(res.status).toBe(401);
  });

  it("returns an empty list when there are no unmatched documents", async () => {
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/documents/unmatched");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns unmatched documents ordered by createdAt", async () => {
    const docs = [
      { id: 1, status: "unmatched", tripId: null, createdAt: "2026-01-01" },
      { id: 2, status: "unmatched", tripId: null, createdAt: "2026-01-02" },
    ];
    selectQueue.push(docs);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/documents/unmatched");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(1);
    expect(res.body[1].id).toBe(2);
    expect(dbMock.select).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/travels/documents/unmatched/count
// ---------------------------------------------------------------------------

describe("GET /api/travels/documents/unmatched/count", () => {
  it("returns 401 without a session", async () => {
    const app = await buildUnauthApp();

    const res = await request(app).get(
      "/api/travels/documents/unmatched/count",
    );

    expect(res.status).toBe(401);
  });

  it("returns zero when there are no unmatched documents", async () => {
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app).get(
      "/api/travels/documents/unmatched/count",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });

  it("returns the correct count of unmatched documents", async () => {
    selectQueue.push([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const app = await buildApp();

    const res = await request(app).get(
      "/api/travels/documents/unmatched/count",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/travels/trips/:id/documents/:docId — itinerary categorization
// and post-sync notification email
// ---------------------------------------------------------------------------

describe("PATCH /api/travels/trips/:id/documents/:docId", () => {
  function findItineraryUpdate() {
    return updateCalls.find(
      (c) => c.set && typeof c.set === "object" && "itinerary" in c.set,
    );
  }

  it("labels an airport_transfer document as rideshare, not rental car, and emails the household", async () => {
    const existingDoc = {
      id: 50,
      tripId: 16,
      extractedData: {},
      lockedFields: [],
    };
    selectQueue.push([existingDoc]); // document lookup
    selectQueue.push([
      {
        itinerary: { days: [] },
        title: "Catania, Sicily — John's 50th",
        destination: "Catania, Sicily",
      },
    ]); // trip lookup inside syncItineraryFromDocument
    selectQueue.push([{ email: "a@example.com" }, { email: "b@example.com" }]); // household emails for the notification
    lastReturning.value = [{ ...existingDoc }];
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/16/documents/50")
      .send({
        extractedData: {
          documentType: "airport_transfer",
          providerName: "Uber",
          transferType: "minibus",
          pickupDateTime: "2026-08-08T18:30:00+02:00",
          pickupLocation: "Via Antonello da Messina 43",
          dropoffDateTime: "2026-08-08T18:58:00+02:00",
          dropoffLocation: "Eurowings, Terminal A, CTA",
          notes: "Fare €79.30",
        },
      });

    expect(res.status).toBe(200);
    const itineraryUpdate = findItineraryUpdate();
    expect(itineraryUpdate).toBeDefined();
    const itinerary = (
      itineraryUpdate!.set as { itinerary: { days: { activities: any[] }[] } }
    ).itinerary;
    const activities = itinerary.days.flatMap((d) => d.activities);
    expect(activities).toHaveLength(2);
    expect(activities.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "Rideshare pickup: Uber",
        "Rideshare drop-off: Uber",
      ]),
    );
    expect(activities.every((a) => a.proximity === "🚕")).toBe(true);
    expect(activities.some((a) => a.name.includes("Rental car"))).toBe(false);

    expect(sendItinerarySyncEmail).toHaveBeenCalledTimes(1);
    const [toEmails, tripTitle, tripDestination, changes] =
      sendItinerarySyncEmail.mock.calls[0];
    expect(toEmails).toEqual(["a@example.com", "b@example.com"]);
    expect(tripTitle).toBe("Catania, Sicily — John's 50th");
    expect(tripDestination).toBe("Catania, Sicily");
    expect(changes).toHaveLength(2);
    expect(changes.join(" ")).toMatch(/Rideshare pickup: Uber/);
    expect(changes.join(" ")).toMatch(/Rideshare drop-off: Uber/);
  });

  it("still labels a genuine car_rental document as rental car pickup/drop-off (regression guard)", async () => {
    const existingDoc = {
      id: 49,
      tripId: 16,
      extractedData: {},
      lockedFields: [],
    };
    selectQueue.push([existingDoc]);
    selectQueue.push([
      { itinerary: { days: [] }, title: "Sicily Trip", destination: "Sicily" },
    ]);
    selectQueue.push([{ email: "a@example.com" }]);
    lastReturning.value = [{ ...existingDoc }];
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/16/documents/49")
      .send({
        extractedData: {
          documentType: "car_rental",
          providerName: "Europcar",
          pickupDateTime: "2026-08-05T09:00:00",
          pickupLocation: "Catania Airport",
          dropoffDateTime: "2026-08-08T09:00:00",
          dropoffLocation: "Catania Airport",
        },
      });

    expect(res.status).toBe(200);
    const itinerary = (
      findItineraryUpdate()!.set as {
        itinerary: { days: { activities: any[] }[] };
      }
    ).itinerary;
    const activities = itinerary.days.flatMap((d) => d.activities);
    expect(activities.map((a) => a.name)).toEqual(
      expect.arrayContaining([
        "Rental car pickup: Europcar",
        "Rental car drop-off: Europcar",
      ]),
    );
    expect(activities.every((a) => a.proximity === "🚗")).toBe(true);
  });

  it("skips the notification email when the resync produces no real change", async () => {
    const flightData = {
      departureDateTime: "2026-09-01T10:00:00",
      flightNumber: "BA123",
      fromLocation: "LHR",
      toLocation: "JFK",
      providerName: "British Airways",
    };
    const existingDoc = {
      id: 60,
      tripId: 16,
      extractedData: flightData,
      lockedFields: [],
    };
    const existingActivity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
      status: "tentative" as const,
      sourceDocumentId: 60,
      sourceField: "departureDateTime",
      dataRichness: 5,
    };
    selectQueue.push([existingDoc]);
    selectQueue.push([
      {
        itinerary: {
          days: [
            {
              date: "2026-09-01",
              title: "Travel Day",
              activities: [existingActivity],
            },
          ],
        },
        title: "Sicily Trip",
        destination: "Sicily",
      },
    ]);
    lastReturning.value = [{ ...existingDoc }];
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/16/documents/60")
      .send({ extractedData: flightData });

    expect(res.status).toBe(200);
    expect(sendItinerarySyncEmail).not.toHaveBeenCalled();
  });

  it("skips the notification email when Resend isn't configured, even with real changes", async () => {
    resendConfiguredMock = false;
    const existingDoc = {
      id: 61,
      tripId: 16,
      extractedData: {},
      lockedFields: [],
    };
    selectQueue.push([existingDoc]);
    selectQueue.push([
      { itinerary: { days: [] }, title: "Sicily Trip", destination: "Sicily" },
    ]);
    lastReturning.value = [{ ...existingDoc }];
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/16/documents/61")
      .send({
        extractedData: {
          departureDateTime: "2026-09-01T10:00:00",
          flightNumber: "BA123",
        },
      });

    expect(res.status).toBe(200);
    expect(sendItinerarySyncEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/travels/documents/:docId/assign
// ---------------------------------------------------------------------------

describe("PATCH /api/travels/documents/:docId/assign", () => {
  it("returns 401 without a session", async () => {
    const app = await buildUnauthApp();

    const res = await request(app)
      .patch("/api/travels/documents/1/assign")
      .send({ tripId: 7 });

    expect(res.status).toBe(401);
  });

  it("400s when tripId is missing from the body", async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/1/assign")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tripId/);
  });

  it("400s when tripId is not a number", async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/1/assign")
      .send({ tripId: "not-a-number" });

    expect(res.status).toBe(400);
  });

  it("400s when docId is not a valid integer", async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/not-a-number/assign")
      .send({ tripId: 7 });

    expect(res.status).toBe(400);
  });

  it("404s when the target trip does not exist", async () => {
    selectQueue.push([]); // tripExists → not found
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/1/assign")
      .send({ tripId: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Trip not found/);
  });

  it("404s when the document does not exist", async () => {
    selectQueue.push([{ id: 7 }]); // tripExists → found
    selectQueue.push([]); // document lookup → not found
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/99/assign")
      .send({ tripId: 7 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Document not found/);
  });

  it("assigns the document to the trip and sets status to linked", async () => {
    const existingDoc = {
      id: 5,
      tripId: null,
      status: "unmatched",
      storagePath: "travels/doc.pdf",
      userId: TEST_USER_ID,
      extractedData: {},
    };
    selectQueue.push([{ id: 7 }]); // tripExists → found
    selectQueue.push([existingDoc]); // document lookup
    // syncItineraryFromDocument: trip itinerary lookup → empty (returns early)
    selectQueue.push([]);
    lastReturning.value = [{ ...existingDoc, tripId: 7, status: "linked" }];
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/5/assign")
      .send({ tripId: 7 });

    expect(res.status).toBe(200);
    expect(res.body.tripId).toBe(7);
    expect(res.body.status).toBe("linked");
    expect(updateCalls.length).toBeGreaterThan(0);
    const assignUpdate = updateCalls.find(
      (c) =>
        c.set &&
        typeof c.set === "object" &&
        (c.set as { status?: string }).status === "linked",
    );
    expect(assignUpdate).toBeDefined();
    expect((assignUpdate!.set as { tripId?: number }).tripId).toBe(7);
  });

  it("still succeeds even if itinerary sync fails (it is non-fatal)", async () => {
    const existingDoc = {
      id: 6,
      tripId: null,
      status: "unmatched",
      storagePath: "travels/doc2.pdf",
      userId: TEST_USER_ID,
      extractedData: { departureDateTime: "2026-06-01T09:00:00" },
    };
    selectQueue.push([{ id: 7 }]); // tripExists → found
    selectQueue.push([existingDoc]); // document lookup
    // syncItineraryFromDocument: trip itinerary lookup → returns a trip so sync runs
    selectQueue.push([{ itinerary: { days: [] } }]);
    lastReturning.value = [{ ...existingDoc, tripId: 7, status: "linked" }];
    const app = await buildApp();

    const res = await request(app)
      .patch("/api/travels/documents/6/assign")
      .send({ tripId: 7 });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/travels/documents/:docId
// ---------------------------------------------------------------------------

describe("DELETE /api/travels/documents/:docId", () => {
  it("returns 401 without a session", async () => {
    const app = await buildUnauthApp();

    const res = await request(app).delete("/api/travels/documents/1");

    expect(res.status).toBe(401);
  });

  it("400s when docId is not a valid integer", async () => {
    const app = await buildApp();

    const res = await request(app).delete(
      "/api/travels/documents/not-a-number",
    );

    expect(res.status).toBe(400);
  });

  it("404s when the document does not exist", async () => {
    selectQueue.push([]); // document lookup → not found
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/documents/99");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Not found/);
  });

  it("soft-deletes the document and returns 204", async () => {
    const doc = {
      id: 10,
      tripId: null,
      status: "unmatched",
      storagePath: "travels/forward-attach.pdf",
      userId: TEST_USER_ID,
    };
    selectQueue.push([doc]); // document lookup → found
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/documents/10");

    expect(res.status).toBe(204);
    // Storage cleanup is deferred to the purge job; only a DB update happens.
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("soft-deletes the DB record regardless of storage path (storage deferred to purge)", async () => {
    const doc = {
      id: 11,
      tripId: null,
      status: "unmatched",
      storagePath: "travels/missing.pdf",
      userId: TEST_USER_ID,
    };
    selectQueue.push([doc]); // document lookup → found
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/documents/11");

    expect(res.status).toBe(204);
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("soft-deletes only (no hard db.delete calls; storage and Gmail cleanup deferred)", async () => {
    const doc = {
      id: 12,
      tripId: null,
      status: "unmatched",
      storagePath: "travels/gmail-doc.pdf",
      userId: TEST_USER_ID,
    };
    selectQueue.push([doc]); // document lookup → found
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/documents/12");

    expect(res.status).toBe(204);
    // Standalone route soft-deletes only — no hard DB deletes.
    // Gmail scan-decision cleanup runs only in the trip-scoped route.
    expect(deleteCalls.length).toBe(0);
    expect(updateCalls.length).toBeGreaterThan(0);
  });
});
