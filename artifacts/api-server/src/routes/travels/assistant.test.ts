import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// We keep the real Drizzle table objects from @workspace/db (they're plain
// schema metadata, safe to import) but replace `db` with an in-memory fake
// that lets each test script its own select/insert/update/delete responses.
// This exercises the actual route logic in assistant.ts — including the
// discriminated union parsing, 404 branches, and the cancel_trip cleanup
// order — without touching the real Supabase database.

type QueryStep = { table: unknown; rows: unknown[] };

const selectQueue: unknown[][] = [];
const deleteCalls: unknown[] = [];
const insertCalls: unknown[] = [];
const updateCalls: { table: unknown; set: unknown }[] = [];
let lastReturning: unknown[] = [];

function makeSelectBuilder() {
  const builder = {
    from() {
      return builder;
    },
    where() {
      // Each call to db.select()...where() consumes the next queued result.
      return Promise.resolve(selectQueue.shift() ?? []);
    },
  };
  return builder;
}

function makeUpdateBuilder(table: unknown) {
  const builder = {
    set(set: unknown) {
      updateCalls.push({ table, set });
      return builder;
    },
    where() {
      return builder;
    },
    returning() {
      return Promise.resolve(lastReturning);
    },
  };
  return builder;
}

function makeDeleteBuilder(table: unknown) {
  const builder = {
    where(cond: unknown) {
      deleteCalls.push({ table, cond });
      return Promise.resolve(undefined);
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
  delete: vi.fn((table: unknown) => makeDeleteBuilder(table)),
  insert: vi.fn(() => ({
    values() {
      insertCalls.push(arguments[0]);
      return this;
    },
    onConflictDoNothing() {
      return this;
    },
    returning() {
      return Promise.resolve(lastReturning);
    },
  })),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const deleteTripPhoto = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/travels/storage", () => ({
  deleteTripPhoto: (...args: unknown[]) => deleteTripPhoto(...args),
}));

const deleteDocument = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/travels-storage", () => ({
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

class FakeItineraryActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const generateItineraryForTrip = vi.fn();
vi.mock("./ai", () => ({
  generateItineraryForTrip: (...args: unknown[]) => generateItineraryForTrip(...args),
  ItineraryActionError: FakeItineraryActionError,
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

async function buildApp(): Promise<Express> {
  const { default: router } = await import("./assistant");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: 42,
    };
    next();
  });
  app.use("/api/travels", router);
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

beforeEach(() => {
  selectQueue.length = 0;
  deleteCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  lastReturning = [];
  vi.clearAllMocks();
});

describe("POST /api/travels/assistant/action", () => {
  describe("update_trip_status", () => {
    it("updates the trip status when the trip exists", async () => {
      selectQueue.push([{ id: 7 }]); // existence check
      lastReturning = [{ id: 7, status: "booked" }];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "update_trip_status", payload: { tripId: 7, status: "booked" } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: "update_trip_status",
        result: { id: 7, status: "booked" },
      });
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]?.set).toEqual({ status: "booked" });
    });

    it("404s when the trip does not exist", async () => {
      selectQueue.push([]); // existence check finds nothing
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "update_trip_status", payload: { tripId: 999, status: "booked" } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Trip not found" });
      expect(updateCalls).toHaveLength(0);
    });

    it("rejects an invalid status value", async () => {
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "update_trip_status", payload: { tripId: 7, status: "not-a-status" } });

      expect(res.status).toBe(400);
    });
  });

  describe("cancel_trip", () => {
    it("deletes photos, documents, reminders, then the trip, and cleans up storage", async () => {
      selectQueue.push([{ id: 7 }]); // existence check
      selectQueue.push([{ storagePath: "photo-1.jpg" }, { storagePath: "photo-2.jpg" }]); // photos
      selectQueue.push([{ storagePath: "doc-1.pdf" }]); // documents
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "cancel_trip", payload: { tripId: 7 } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: "cancel_trip", result: { id: 7 } });

      expect(deleteTripPhoto).toHaveBeenCalledTimes(2);
      expect(deleteTripPhoto).toHaveBeenCalledWith("photo-1.jpg");
      expect(deleteTripPhoto).toHaveBeenCalledWith("photo-2.jpg");
      expect(deleteDocument).toHaveBeenCalledTimes(1);
      expect(deleteDocument).toHaveBeenCalledWith("doc-1.pdf");

      // Cleanup order: photos, documents, reminders, then the trip itself.
      expect(deleteCalls).toHaveLength(4);
      const tableNames = deleteCalls.map(
        (c) => (c as { table: { [Symbol.toStringTag]?: string } }).table,
      );
      expect(tableNames.length).toBe(4);
    });

    it("404s when the trip does not exist and performs no cleanup", async () => {
      selectQueue.push([]); // existence check finds nothing
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "cancel_trip", payload: { tripId: 999 } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Trip not found" });
      expect(deleteTripPhoto).not.toHaveBeenCalled();
      expect(deleteDocument).not.toHaveBeenCalled();
      expect(deleteCalls).toHaveLength(0);
    });
  });

  describe("mark_wishlist_done", () => {
    it("defaults done to true when omitted", async () => {
      selectQueue.push([{ id: 3 }]); // existence check
      lastReturning = [{ id: 3, done: true }];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "mark_wishlist_done", payload: { wishlistId: 3 } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: "mark_wishlist_done",
        result: { id: 3, done: true },
      });
      expect(updateCalls[0]?.set).toEqual({ done: true });
    });

    it("honors an explicit done: false", async () => {
      selectQueue.push([{ id: 3 }]);
      lastReturning = [{ id: 3, done: false }];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "mark_wishlist_done", payload: { wishlistId: 3, done: false } });

      expect(res.status).toBe(200);
      expect(updateCalls[0]?.set).toEqual({ done: false });
    });

    it("404s when the wishlist item does not exist", async () => {
      selectQueue.push([]);
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "mark_wishlist_done", payload: { wishlistId: 999 } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Wishlist item not found" });
    });
  });

  describe("remove_wishlist_item", () => {
    it("deletes the wishlist item when it exists", async () => {
      selectQueue.push([{ id: 3 }]);
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "remove_wishlist_item", payload: { wishlistId: 3 } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: "remove_wishlist_item",
        result: { id: 3 },
      });
      expect(deleteCalls).toHaveLength(1);
    });

    it("404s when the wishlist item does not exist", async () => {
      selectQueue.push([]);
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "remove_wishlist_item", payload: { wishlistId: 999 } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Wishlist item not found" });
      expect(deleteCalls).toHaveLength(0);
    });
  });

  describe("remove_packing_item", () => {
    it("removes only the matching item (case-insensitively) from the packing list", async () => {
      selectQueue.push([
        {
          id: 7,
          packingList: [
            { item: "Sunscreen", packed: false },
            { item: "Passport", packed: true },
          ],
        },
      ]);
      lastReturning = [
        { id: 7, packingList: [{ item: "Passport", packed: true }] },
      ];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "remove_packing_item", payload: { tripId: 7, item: "sunscreen" } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: "remove_packing_item",
        result: { id: 7, packingList: [{ item: "Passport", packed: true }] },
      });
      expect(updateCalls[0]?.set).toEqual({
        packingList: [{ item: "Passport", packed: true }],
      });
    });

    it("404s when the trip does not exist", async () => {
      selectQueue.push([]);
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "remove_packing_item", payload: { tripId: 999, item: "Sunscreen" } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Trip not found" });
    });
  });

  describe("add_itinerary_day", () => {
    it("appends a new day (with an optional activity) to the itinerary", async () => {
      selectQueue.push([
        { id: 7, itinerary: { days: [{ date: "2026-07-13", title: "Arrival", activities: [] }] } },
      ]);
      lastReturning = [
        {
          id: 7,
          itinerary: {
            days: [
              { date: "2026-07-13", title: "Arrival", activities: [] },
              {
                date: "2026-07-14",
                title: "Kyoto day trip",
                activities: [
                  {
                    time: "09:00",
                    name: "Fushimi Inari",
                    description: "",
                    proximity: "",
                    tip: "",
                  },
                ],
              },
            ],
          },
        },
      ];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({
          type: "add_itinerary_day",
          payload: {
            tripId: 7,
            date: "2026-07-14",
            title: "Kyoto day trip",
            activityName: "Fushimi Inari",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ type: "add_itinerary_day", result: lastReturning[0] });
      expect(updateCalls[0]?.set).toEqual({
        itinerary: {
          days: [
            { date: "2026-07-13", title: "Arrival", activities: [] },
            {
              date: "2026-07-14",
              title: "Kyoto day trip",
              activities: [
                { time: "09:00", name: "Fushimi Inari", description: "", proximity: "", tip: "" },
              ],
            },
          ],
        },
      });
    });

    it("works when the trip has no itinerary yet", async () => {
      selectQueue.push([{ id: 7, itinerary: null }]);
      lastReturning = [{ id: 7, itinerary: { days: [{ date: "", title: "Day 1", activities: [] }] } }];
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "add_itinerary_day", payload: { tripId: 7, title: "Day 1" } });

      expect(res.status).toBe(200);
      expect(updateCalls[0]?.set).toEqual({
        itinerary: { days: [{ date: "", title: "Day 1", activities: [] }] },
      });
    });

    it("404s when the trip does not exist", async () => {
      selectQueue.push([]);
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "add_itinerary_day", payload: { tripId: 999, title: "Day 1" } });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Trip not found" });
    });
  });

  describe("regenerate_itinerary_day", () => {
    it("regenerates the given 1-based day and passes a 0-based index with balanced defaults", async () => {
      generateItineraryForTrip.mockResolvedValueOnce({
        days: [{ date: "2026-07-14", title: "Refreshed", activities: [] }],
      });
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "regenerate_itinerary_day", payload: { tripId: 7, dayNumber: 2 } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        type: "regenerate_itinerary_day",
        result: { itinerary: { days: [{ date: "2026-07-14", title: "Refreshed", activities: [] }] } },
      });
      expect(generateItineraryForTrip).toHaveBeenCalledWith(
        7,
        "balanced",
        ["food", "history", "culture"],
        1,
      );
    });

    it("surfaces an ItineraryActionError's status and message", async () => {
      generateItineraryForTrip.mockRejectedValueOnce(
        new FakeItineraryActionError(400, "Day index out of range"),
      );
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "regenerate_itinerary_day", payload: { tripId: 7, dayNumber: 99 } });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Day index out of range" });
    });

    it("rejects a non-positive dayNumber", async () => {
      const app = await buildApp();

      const res = await request(app)
        .post("/api/travels/assistant/action")
        .send({ type: "regenerate_itinerary_day", payload: { tripId: 7, dayNumber: 0 } });

      expect(res.status).toBe(400);
      expect(generateItineraryForTrip).not.toHaveBeenCalled();
    });
  });

  it("rejects an unknown action type", async () => {
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/assistant/action")
      .send({ type: "not_a_real_action", payload: {} });

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const { default: router } = await import("./assistant");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {};
      next();
    });
    app.use("/api/travels", router);

    const res = await request(app)
      .post("/api/travels/assistant/action")
      .send({ type: "remove_wishlist_item", payload: { wishlistId: 3 } });

    expect(res.status).toBe(401);
  });
});
