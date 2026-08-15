import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  makeEagerSelectBuilder,
  createTrackedMutationBuilders,
} from "../../test-helpers/db-mock";
import {
  extractFromPdf,
  extractFromImage,
} from "../../lib/travel-document-extraction";

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

// Records the raw condition object passed to every db.select().where(...)
// call, so tests can assert which columns a query actually scoped on (e.g.
// that a trip-scoped lookup filters by tripId, not just by id) without a
// real database. See columnNamesIn() below for how these are inspected.
const selectWhereCalls: unknown[] = [];

const dbMock = {
  select: vi.fn(() => {
    const builder = makeEagerSelectBuilder(selectQueue);
    const originalWhere = builder.where.bind(builder);
    builder.where = (...args: unknown[]) => {
      selectWhereCalls.push(args[0]);
      return originalWhere();
    };
    return builder;
  }),
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
let syncItineraryFromDocument: (typeof import("./documents"))["syncItineraryFromDocument"];

beforeAll(async () => {
  const mod = await import("./documents");
  documentsRouter = mod.default;
  syncItineraryFromDocument = mod.syncItineraryFromDocument;
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
  selectWhereCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  lastReturning.value = [];
  vi.clearAllMocks();
  deleteDocument.mockResolvedValue(undefined);
  resendConfiguredMock = true;
  sendItinerarySyncEmail.mockClear();
});

/**
 * Recursively walk a Drizzle SQL condition's queryChunks and collect the db
 * column names it references (e.g. "id", "trip_id"). Used to assert that a
 * trip-scoped query actually filters by tripId, not just by the row id —
 * guarding against a regression where a `.where(eq(id, docId))` lookup
 * silently drops its `and(eq(tripId, tripId))` clause and lets one trip's
 * document be read/deleted/downloaded through another trip's URL.
 */
function columnNamesIn(condition: unknown): Set<string> {
  const names = new Set<string>();
  function walk(node: unknown): void {
    if (node == null || typeof node !== "object") return;
    const name = (node as { name?: unknown }).name;
    if (typeof name === "string" && "table" in (node as object)) {
      names.add(name);
    }
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) {
      for (const c of chunks) walk(c);
    }
  }
  walk(condition);
  return names;
}

// ---------------------------------------------------------------------------
// GET /api/travels/trips/:id/documents
// ---------------------------------------------------------------------------

describe("GET /api/travels/trips/:id/documents", () => {
  it("returns 400 for a non-numeric trip id", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/travels/trips/nope/documents");

    expect(res.status).toBe(400);
  });

  it("404s when the trip does not exist", async () => {
    selectQueue.push([]); // tripExists → not found
    const app = await buildApp();

    const res = await request(app).get("/api/travels/trips/999/documents");

    expect(res.status).toBe(404);
  });

  it("scopes the document query to this trip (not just non-deleted rows)", async () => {
    selectQueue.push([{ id: 5 }]); // tripExists → found
    selectQueue.push([{ id: 1, tripId: 5 }]); // docs list
    const app = await buildApp();

    const res = await request(app).get("/api/travels/trips/5/documents");

    expect(res.status).toBe(200);
    // The docs-list select must be the second .where() call (after
    // tripExists) and must filter on tripId, not just deletedAt — otherwise
    // every trip's Documents page would show every other trip's documents.
    const docsListCondition = selectWhereCalls[1];
    expect(columnNamesIn(docsListCondition)).toContain("trip_id");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/travels/trips/:id/documents/:docId
// ---------------------------------------------------------------------------

describe("DELETE /api/travels/trips/:id/documents/:docId", () => {
  it("returns 400 when tripId is not numeric", async () => {
    const app = await buildApp();

    const res = await request(app).delete(
      "/api/travels/trips/nope/documents/1",
    );

    expect(res.status).toBe(400);
  });

  it("404s when the document does not belong to this trip", async () => {
    selectQueue.push([]); // scoped lookup finds nothing for this trip
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/trips/5/documents/10");

    expect(res.status).toBe(404);
  });

  it("scopes both the lookup and the soft-delete by tripId, not just docId", async () => {
    const doc = {
      id: 10,
      tripId: 5,
      userId: TEST_USER_ID,
      storagePath: "travels/doc.pdf",
      originalFilename: "doc.pdf",
    };
    selectQueue.push([doc]); // scoped document lookup
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/trips/5/documents/10");

    expect(res.status).toBe(200);
    // Guard against a regression where the lookup (and the update it gates)
    // only filters by id, which would let a document from a different trip
    // be deleted via this trip's URL.
    expect(columnNamesIn(selectWhereCalls[0])).toContain("trip_id");
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it("hard-deletes the document's embedding chunks so Elaine's semantic search can't keep surfacing them", async () => {
    const { travelsDocChunks } = await import("@workspace/db");
    const doc = {
      id: 10,
      tripId: 5,
      userId: TEST_USER_ID,
      storagePath: "travels/doc.pdf",
      originalFilename: "doc.pdf",
    };
    selectQueue.push([doc]); // scoped document lookup
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/trips/5/documents/10");

    expect(res.status).toBe(200);
    // travelsDocChunks rows have no deleted_at column, so a soft-deleted
    // document's chunks would otherwise remain searchable indefinitely.
    expect(deleteCalls.some((c) => c.table === travelsDocChunks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/travels/trips/:id/documents/:docId/download
// ---------------------------------------------------------------------------

describe("GET /api/travels/trips/:id/documents/:docId/download", () => {
  it("returns 400 when tripId is not numeric", async () => {
    const app = await buildApp();

    const res = await request(app).get(
      "/api/travels/trips/nope/documents/1/download",
    );

    expect(res.status).toBe(400);
  });

  it("404s when the document does not belong to this trip", async () => {
    selectQueue.push([]); // scoped lookup finds nothing for this trip
    const app = await buildApp();

    const res = await request(app).get(
      "/api/travels/trips/5/documents/10/download",
    );

    expect(res.status).toBe(404);
  });

  it("scopes the lookup by tripId, not just docId, before serving the file", async () => {
    const doc = {
      id: 10,
      tripId: 5,
      storagePath: "travels/doc.pdf",
      originalFilename: "doc.pdf",
    };
    selectQueue.push([doc]); // scoped document lookup
    const app = await buildApp();

    const res = await request(app).get(
      "/api/travels/trips/5/documents/10/download",
    );

    expect(res.status).toBe(200);
    // Guard against a document from a different trip being downloadable
    // through this trip's URL.
    expect(columnNamesIn(selectWhereCalls[0])).toContain("trip_id");
  });
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
// POST /api/travels/trips/:id/documents — upload + extraction
//
// Regression coverage for a merge-introduced corruption where this handler
// called rescanTripDocument(tripId, docId, ...) — which requires an already
// -existing row and needs a real docId — before any document had been
// inserted, then tried to look the "document" up with a bare select() using
// that (always-undefined) docId instead of inserting a new row. The fix
// calls extractFromPdf/extractFromImage directly on the uploaded buffer and
// performs a real insert().values().returning().
// ---------------------------------------------------------------------------

const PDF_MAGIC = Buffer.from("%PDF-1.4 this is a fake pdf file for testing");

describe("POST /api/travels/trips/:id/documents", () => {
  it("returns 401 without a session", async () => {
    const app = await buildUnauthApp();

    const res = await request(app)
      .post("/api/travels/trips/7/documents")
      .attach("file", PDF_MAGIC, {
        filename: "ticket.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(401);
  });

  it("404s when the target trip does not exist", async () => {
    selectQueue.push([]); // tripExists → not found
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/trips/999/documents")
      .attach("file", PDF_MAGIC, {
        filename: "ticket.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(404);
  });

  it("400s when no file is attached", async () => {
    selectQueue.push([{ id: 7 }]); // tripExists → found
    const app = await buildApp();

    const res = await request(app).post("/api/travels/trips/7/documents");

    expect(res.status).toBe(400);
  });

  it("extracts data directly from the uploaded buffer and inserts a new document row (not a rescan of a non-existent row)", async () => {
    vi.mocked(extractFromPdf).mockResolvedValueOnce({
      data: {},
      sourceSpans: { source: "pdf_text", textLength: 0, fieldOffsets: [] },
    });
    selectQueue.push([{ id: 7 }]); // tripExists → found
    selectQueue.push([]); // syncItineraryFromDocument trip lookup → not found, returns early
    const insertedDoc = {
      id: 10,
      tripId: 7,
      userId: TEST_USER_ID,
      storagePath: "travels/mock-path.pdf",
      title: null,
      documentType: null,
      extractedData: {},
      sourceSpans: null,
      rawText: null,
      status: "processed",
    };
    lastReturning.value = [insertedDoc];
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/trips/7/documents")
      .attach("file", PDF_MAGIC, {
        filename: "ticket.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    expect(extractFromPdf).toHaveBeenCalledTimes(1);
    expect(extractFromImage).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0]!.values as Record<string, unknown>;
    expect(values.tripId).toBe(7);
    expect(values.userId).toBe(TEST_USER_ID);
    expect(values.status).toBe("processed");
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

  it("returns 400 for a non-numeric tripId or docId", async () => {
    const app = buildApp();

    const res = await request(app).patch("/api/travels/trips/nope/documents/1");

    expect(res.status).toBe(400);
  });

  it("404s when the document does not belong to this trip", async () => {
    // Simulate the scoped lookup (id = docId AND tripId = :id) finding
    // nothing — which is what happens when the docId exists on a DIFFERENT
    // trip than the one in the URL.
    selectQueue.push([]); // scoped lookup returns empty
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/5/documents/10")
      .send({ title: "Changed title" });

    expect(res.status).toBe(404);
  });

  it("scopes the document lookup by tripId, not just docId", async () => {
    // Guard against a regression where a document belonging to trip B
    // could be mutated through trip A's URL.
    const existingDoc = {
      id: 10,
      tripId: 5,
      extractedData: {},
      lockedFields: [],
    };
    selectQueue.push([existingDoc]); // scoped lookup finds the doc
    lastReturning.value = [existingDoc];
    const app = buildApp();

    const res = await request(app)
      .patch("/api/travels/trips/5/documents/10")
      .send({ title: "Updated" });

    expect(res.status).toBe(200);
    // The initial SELECT must filter on both id and trip_id.
    expect(columnNamesIn(selectWhereCalls[0])).toContain("trip_id");
    expect(columnNamesIn(selectWhereCalls[0])).toContain("id");
  });

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

// ---------------------------------------------------------------------------
// DELETE /api/travels/trips/:id/documents/:docId
// ---------------------------------------------------------------------------

describe("DELETE /api/travels/trips/:id/documents/:docId", () => {
  it("detaches the itinerary sourceDocumentId link after a successful delete", async () => {
    // The document lookup is scoped by both id AND tripId, so doc.tripId
    // always equals the route's :id after a successful lookup.
    // Regression guard: the itinerary write must target the correct tripId.
    const TRIP_ID = 16;
    const DOC_ID = 77;
    const doc = {
      id: DOC_ID,
      tripId: TRIP_ID,
      userId: TEST_USER_ID,
      originalFilename: "boarding-pass.pdf",
    };
    const activity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
      status: "tentative" as const,
      sourceDocumentId: DOC_ID,
      sourceField: "departureDateTime",
      dataRichness: 5,
    };
    selectQueue.push([doc]); // trip-scoped document lookup
    selectQueue.push([
      {
        itinerary: {
          days: [
            {
              date: "2026-09-01",
              title: "Travel Day",
              activities: [activity],
            },
          ],
        },
      },
    ]); // trip itinerary lookup

    const app = buildApp();

    const res = await request(app).delete(
      `/api/travels/trips/${TRIP_ID}/documents/${DOC_ID}`,
    );

    expect(res.status).toBe(200);

    const itineraryUpdate = updateCalls.find(
      (c) => c.set && typeof c.set === "object" && "itinerary" in c.set,
    );
    expect(itineraryUpdate).toBeDefined();

    // The write must target the correct tripId. Use drizzle-orm's own
    // public SQL-compile path (PgDialect.sqlToQuery) so this stays valid
    // across internal drizzle-orm representation changes.
    const dialect = new PgDialect();
    const params = dialect.sqlToQuery(
      itineraryUpdate!.where as Parameters<typeof dialect.sqlToQuery>[0],
    ).params;
    expect(params).toContain(TRIP_ID);

    // The activity's sourceDocumentId link was actually stripped.
    const itinerary = (
      itineraryUpdate!.set as {
        itinerary: { days: { activities: any[] }[] };
      }
    ).itinerary;
    const activities = itinerary.days.flatMap((d) => d.activities);
    expect(activities[0].sourceDocumentId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncItineraryFromDocument — photo carry-over across all three branches
// ---------------------------------------------------------------------------

type TestActivity = {
  time: string;
  name: string;
  description: string;
  proximity: string;
  tip: string;
  status?: string;
  sourceDocumentId?: number;
  sourceField?: string;
  dataRichness?: number;
  /** @deprecated legacy scalar */
  photoId?: number;
  /** canonical multi-photo array (task #708+) */
  photoIds?: number[];
};

type TestDay = { date: string; title: string; activities: TestActivity[] };
type TestItinerary = { days: TestDay[] };

/** Pull the itinerary value from the most recent db.update({ itinerary }) call. */
function lastWrittenItinerary(): TestItinerary {
  for (let i = updateCalls.length - 1; i >= 0; i--) {
    const s = updateCalls[i]?.set;
    if (s && typeof s === "object" && "itinerary" in (s as object)) {
      return (s as { itinerary: TestItinerary }).itinerary;
    }
  }
  throw new Error("No itinerary update found in updateCalls");
}

/** Mirror of the server helper — normalises both legacy photoId and photoIds. */
function getPhotoIds(a: TestActivity | undefined): number[] {
  if (!a) return [];
  if (a.photoIds && a.photoIds.length > 0) return a.photoIds;
  if (a.photoId != null) return [a.photoId];
  return [];
}

describe("syncItineraryFromDocument — photo carry-over", () => {
  const TRIP_ID = 1;
  const DOC_ID = 10;

  // Rich flight data that generates exactly one departure activity.
  const flightExtractedData = {
    departureDateTime: "2026-09-01T10:00:00",
    flightNumber: "BA123",
    fromLocation: "LHR",
    toLocation: "JFK",
    providerName: "British Airways",
    arrivalDateTime: "2026-09-01T13:00:00",
    referenceNumber: "ABCDEF",
    seatNumbers: ["12A"],
    passengerNames: ["Alice"],
  };

  // ── fresh-add branch ────────────────────────────────────────────────────

  it("fresh-add branch: single photoIds entry survives an idempotent resync", async () => {
    // First sync: empty itinerary → activity added fresh.
    selectQueue.push([
      { itinerary: { days: [] }, title: "NYC Trip", destination: "New York" },
    ]);
    selectQueue.push([{ email: "alice@example.com" }]); // notifyItinerarySync

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterFirst = lastWrittenItinerary();
    expect(afterFirst.days).toHaveLength(1);
    const act = afterFirst.days[0]!.activities[0]!;
    expect(act.sourceDocumentId).toBe(DOC_ID);

    // User pins one photo (canonical array shape from task #708).
    act.photoIds = [999];

    // Second sync: same extractedData → idempotent, photoIds must survive.
    updateCalls.length = 0;
    selectQueue.push([
      { itinerary: afterFirst, title: "NYC Trip", destination: "New York" },
    ]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterSecond = lastWrittenItinerary();
    const activities = afterSecond.days.flatMap((d) => d.activities);
    expect(activities).toHaveLength(1);
    expect(getPhotoIds(activities[0]!)).toEqual([999]);
  });

  it("fresh-add branch: multiple photoIds all survive an idempotent resync", async () => {
    // First sync: empty itinerary.
    selectQueue.push([
      { itinerary: { days: [] }, title: "NYC Trip", destination: "New York" },
    ]);
    selectQueue.push([{ email: "alice@example.com" }]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterFirst = lastWrittenItinerary();
    const act = afterFirst.days[0]!.activities[0]!;

    // User attaches three photos.
    act.photoIds = [11, 22, 33];

    updateCalls.length = 0;
    selectQueue.push([
      { itinerary: afterFirst, title: "NYC Trip", destination: "New York" },
    ]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterSecond = lastWrittenItinerary();
    const activities = afterSecond.days.flatMap((d) => d.activities);
    expect(getPhotoIds(activities[0]!)).toEqual([11, 22, 33]);
  });

  it("fresh-add branch: legacy scalar photoId is normalised to photoIds on resync", async () => {
    // Simulate an activity written by old code (scalar photoId).
    selectQueue.push([
      { itinerary: { days: [] }, title: "NYC Trip", destination: "New York" },
    ]);
    selectQueue.push([{ email: "alice@example.com" }]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterFirst = lastWrittenItinerary();
    const act = afterFirst.days[0]!.activities[0]!;
    // Old code wrote scalar photoId instead of photoIds.
    act.photoId = 777;

    updateCalls.length = 0;
    selectQueue.push([
      { itinerary: afterFirst, title: "NYC Trip", destination: "New York" },
    ]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const afterSecond = lastWrittenItinerary();
    const activities = afterSecond.days.flatMap((d) => d.activities);
    // Legacy scalar must be read and re-written as photoIds array.
    expect(getPhotoIds(activities[0]!)).toEqual([777]);
  });

  // ── rich-wins replace branch ────────────────────────────────────────────

  it("rich-wins replace branch: photoIds survive when the same doc out-richnesses a rival", async () => {
    // Itinerary has a low-richness rival (docId=99) and our own activity
    // (docId=10) with photoIds already attached.  On resync our richer doc
    // replaces the rival slot; photoIds from previousForDoc must be preserved.
    const rivalActivity: TestActivity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
      status: "tentative",
      sourceDocumentId: 99,
      sourceField: "departureDateTime",
      dataRichness: 1,
    };
    const ownActivity: TestActivity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
      status: "tentative",
      sourceDocumentId: DOC_ID,
      sourceField: "departureDateTime",
      dataRichness: 5,
      photoIds: [101, 102],
    };
    const setupItinerary: TestItinerary = {
      days: [
        {
          date: "2026-09-01",
          title: "Travel Day",
          activities: [rivalActivity, ownActivity],
        },
      ],
    };

    selectQueue.push([
      { itinerary: setupItinerary, title: "NYC Trip", destination: "New York" },
    ]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const result = lastWrittenItinerary();
    const activities = result.days.flatMap((d) => d.activities);
    const ours = activities.find((a) => a.sourceDocumentId === DOC_ID);
    expect(ours).toBeDefined();
    expect(getPhotoIds(ours!)).toEqual([101, 102]);
  });

  // ── legacy-dedup replace branch ─────────────────────────────────────────

  it("legacy-dedup replace branch: photoIds survive when a legacy (untracked) activity is upgraded", async () => {
    // Legacy activities have a proximity emoji but no sourceField /
    // sourceDocumentId.  The sync must replace the legacy slot and carry the
    // photoIds from the previous docId=10 activity.
    const legacyActivity: TestActivity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
    };
    const ownActivity: TestActivity = {
      time: "10:00",
      name: "Flight BA123: LHR → JFK",
      description: "British Airways",
      proximity: "✈️",
      tip: "",
      status: "tentative",
      sourceDocumentId: DOC_ID,
      sourceField: "departureDateTime",
      dataRichness: 5,
      photoIds: [55, 66],
    };
    const setupItinerary: TestItinerary = {
      days: [
        {
          date: "2026-09-01",
          title: "Travel Day",
          activities: [legacyActivity, ownActivity],
        },
      ],
    };

    selectQueue.push([
      { itinerary: setupItinerary, title: "NYC Trip", destination: "New York" },
    ]);

    await syncItineraryFromDocument(TRIP_ID, DOC_ID, flightExtractedData);

    const result = lastWrittenItinerary();
    const activities = result.days.flatMap((d) => d.activities);
    const ours = activities.find((a) => a.sourceDocumentId === DOC_ID);
    expect(ours).toBeDefined();
    expect(getPhotoIds(ours!)).toEqual([55, 66]);
  });
});
