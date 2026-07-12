import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createDbMockWithBootstrap } from "../../test-helpers/db-mock";
import { sendReminderAlertEmail, resendConfigured } from "../../lib/email";

const { dbMock, selectQueue } = createDbMockWithBootstrap();

let eqSpy: ReturnType<typeof vi.fn>;
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  eqSpy = vi.fn((...args: Parameters<typeof actual.eq>) => actual.eq(...args));
  return { ...actual, eq: eqSpy };
});

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
  vi.clearAllMocks();
  vi.resetModules();
});

describe("GET /api/travels/users", () => {
  it("returns id, email, displayName, and phoneVerified for each user", async () => {
    selectQueue.push([
      {
        id: 1,
        email: "alice@example.com",
        displayName: "Alice",
        phoneVerified: true,
      },
      {
        id: 2,
        email: "bob@example.com",
        displayName: null,
        phoneVerified: false,
      },
    ]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 1,
        email: "alice@example.com",
        displayName: "Alice",
        phoneVerified: true,
      },
      {
        id: 2,
        email: "bob@example.com",
        displayName: null,
        phoneVerified: false,
      },
    ]);
  });

  it("returns an empty array when there are no users", async () => {
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/users");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("does not expose password hash or other sensitive fields", async () => {
    selectQueue.push([
      {
        id: 3,
        email: "carol@example.com",
        displayName: "Carol",
        phoneVerified: false,
      },
    ]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/users");

    expect(res.status).toBe(200);
    const [user] = res.body as Record<string, unknown>[];
    expect(Object.keys(user)).toEqual([
      "id",
      "email",
      "displayName",
      "phoneVerified",
    ]);
  });
});

describe("GET /api/travels/settings", () => {
  it("returns reminderEmail and timezone for the current user", async () => {
    selectQueue.push([
      { travelsReminderEmail: "me@example.com", timezone: "America/New_York" },
    ]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/settings");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reminderEmail: "me@example.com",
      timezone: "America/New_York",
    });
  });

  it("defaults both fields to null when the user row is missing values", async () => {
    selectQueue.push([{ travelsReminderEmail: null, timezone: null }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/settings");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: null, timezone: null });
  });

  it("normalizes an empty-string travelsReminderEmail to null", async () => {
    selectQueue.push([{ travelsReminderEmail: "", timezone: null }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/settings");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: null, timezone: null });
  });

  it("normalizes a whitespace-only travelsReminderEmail to null", async () => {
    selectQueue.push([{ travelsReminderEmail: "   ", timezone: null }]);
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
    expect(dbMock.update).toHaveBeenCalledOnce();
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
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects a missing timezone field", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings/timezone")
      .send({});

    expect(res.status).toBe(400);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("scopes the update to the session userId", async () => {
    const { appUsers } = await import("@workspace/db");
    const app = await buildApp();

    await request(app)
      .put("/api/travels/settings/timezone")
      .send({ timezone: "Europe/London" });

    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(eqSpy).toHaveBeenCalledWith(appUsers.id, TEST_USER_ID);
  });

  it("does not call dbMock.update when the timezone value is invalid", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings/timezone")
      .send({ timezone: "Fake/Zone" });

    expect(res.status).toBe(400);
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/travels/settings (reminder-email)", () => {
  it("returns 200 and persists a valid email address", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings")
      .send({ reminderEmail: "alerts@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: "alerts@example.com" });
    expect(dbMock.update).toHaveBeenCalledOnce();
  });

  it("returns 200 and persists null to clear the reminder email", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings")
      .send({ reminderEmail: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminderEmail: null });
    expect(dbMock.update).toHaveBeenCalledOnce();
  });

  it("returns 400 when reminderEmail is a malformed address", async () => {
    const app = await buildApp();

    const res = await request(app)
      .put("/api/travels/settings")
      .send({ reminderEmail: "not-an-email" });

    expect(res.status).toBe(400);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("returns 400 when reminderEmail is missing from the body", async () => {
    const app = await buildApp();

    const res = await request(app).put("/api/travels/settings").send({});

    expect(res.status).toBe(400);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("scopes the update to the session userId", async () => {
    const { appUsers } = await import("@workspace/db");
    const app = await buildApp();

    await request(app)
      .put("/api/travels/settings")
      .send({ reminderEmail: "scoped@example.com" });

    expect(dbMock.update).toHaveBeenCalledOnce();
    // Verify the WHERE clause was built with eq(appUsers.id, TEST_USER_ID),
    // not a hardcoded value or a different session field.
    expect(eqSpy).toHaveBeenCalledWith(appUsers.id, TEST_USER_ID);
  });
});

describe("POST /api/travels/settings/test-email", () => {
  it("returns 400 when Resend is not configured", async () => {
    vi.mocked(resendConfigured).mockReturnValue(false);
    const app = await buildApp();

    const res = await request(app).post("/api/travels/settings/test-email");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
    expect(sendReminderAlertEmail).not.toHaveBeenCalled();
  });

  it("returns 200 with sent:true when user exists and email sends", async () => {
    vi.mocked(resendConfigured).mockReturnValue(true);
    selectQueue.push([{ email: "traveller@example.com" }]);
    vi.mocked(sendReminderAlertEmail).mockResolvedValue(undefined);
    const app = await buildApp();

    const res = await request(app).post("/api/travels/settings/test-email");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, to: "traveller@example.com" });
    expect(sendReminderAlertEmail).toHaveBeenCalledOnce();
  });

  it("returns 502 when sendReminderAlertEmail throws", async () => {
    vi.mocked(resendConfigured).mockReturnValue(true);
    selectQueue.push([{ email: "traveller@example.com" }]);
    vi.mocked(sendReminderAlertEmail).mockRejectedValue(
      new Error("Resend API error"),
    );
    const app = await buildApp();

    const res = await request(app).post("/api/travels/settings/test-email");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Resend API error");
  });

  it("returns 404 when no user row is found", async () => {
    vi.mocked(resendConfigured).mockReturnValue(true);
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app).post("/api/travels/settings/test-email");

    expect(res.status).toBe(404);
    expect(sendReminderAlertEmail).not.toHaveBeenCalled();
  });
});
