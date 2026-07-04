import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const selectQueue: unknown[][] = [];
const updateCalls: { table: unknown; set: unknown }[] = [];

function makeSelectBuilder() {
  const builder = {
    from() {
      return builder;
    },
    where() {
      return Promise.resolve(selectQueue.shift() ?? []);
    },
    orderBy() {
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
      return Promise.resolve(undefined);
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../../lib/email", () => ({
  sendReminderAlertEmail: vi.fn(),
  resendConfigured: vi.fn(() => false),
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

const TEST_USER_ID = 42;

async function buildApp(): Promise<Express> {
  const { default: router } = await import("./settings");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: TEST_USER_ID,
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
  updateCalls.length = 0;
  vi.clearAllMocks();
});

describe("GET /api/travels/settings", () => {
  it("returns reminderEmail and timezone for the current user", async () => {
    selectQueue.push([{ travelsReminderEmail: "me@example.com", timezone: "America/New_York" }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/settings");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: "me@example.com", timezone: "America/New_York" });
  });

  it("defaults both fields to null when the user row is missing values", async () => {
    selectQueue.push([{ travelsReminderEmail: null, timezone: null }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/settings");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: null, timezone: null });
  });
});

describe("PUT /api/travels/settings/timezone", () => {
  it("accepts a valid IANA timezone and persists it", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings/timezone")
      .send({ timezone: "America/Los_Angeles" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ timezone: "America/Los_Angeles" });
    expect(updateCalls[0]?.set).toEqual({ timezone: "America/Los_Angeles" });
  });

  it("accepts null to clear the timezone", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings/timezone")
      .send({ timezone: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ timezone: null });
  });

  it("rejects an invalid IANA timezone name", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings/timezone")
      .send({ timezone: "Not/AZone" });

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a missing timezone field", async () => {
    const app = await buildApp();

    const res = await request(app).put("/api/travels/settings/timezone").send({});

    expect(res.status).toBe(400);
  });
});
