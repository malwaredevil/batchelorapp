import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const selectQueue: unknown[][] = [];
const insertCalls: { table: unknown; values: unknown }[] = [];
const updateCalls: { table: unknown; set: unknown }[] = [];
const deleteCalls: { table: unknown }[] = [];
let lastReturning: unknown[] = [];

function makeSelectBuilder() {
  const resultPromise = Promise.resolve(selectQueue.shift() ?? []);
  const builder = {
    from() {
      return builder;
    },
    where() {
      return builder;
    },
    orderBy() {
      return resultPromise;
    },
    limit() {
      return resultPromise;
    },
    then(onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
      return resultPromise.then(onFulfilled, onRejected);
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
    where() {
      deleteCalls.push({ table });
      return Promise.resolve(undefined);
    },
  };
  return builder;
}

function makeInsertBuilder(table: unknown) {
  const builder = {
    values(values: unknown) {
      insertCalls.push({ table, values });
      return builder;
    },
    onConflictDoNothing() {
      return builder;
    },
    onConflictDoUpdate(config: { set: unknown }) {
      updateCalls.push({ table: "upsert", set: config.set });
      return builder;
    },
    returning() {
      return Promise.resolve(lastReturning);
    },
  };
  return builder;
}

const dbMock = {
  select: vi.fn(() => makeSelectBuilder()),
  update: vi.fn((table: unknown) => makeUpdateBuilder(table)),
  delete: vi.fn((table: unknown) => makeDeleteBuilder(table)),
  insert: vi.fn((table: unknown) => makeInsertBuilder(table)),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

const getValidGmailAccessToken = vi.fn();
vi.mock("../../lib/gmail-tokens", () => ({
  getValidGmailAccessToken: (...args: unknown[]) => getValidGmailAccessToken(...args),
}));

const gmailOAuthEnabled = vi.fn(() => true);
const generateAuthUrl = vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?mock=1");
vi.mock("../../lib/gmail-oauth", () => ({
  createGmailOAuthClient: () => ({ generateAuthUrl }),
  gmailOAuthEnabled: () => gmailOAuthEnabled(),
  GMAIL_SCOPES: ["https://www.googleapis.com/auth/gmail.readonly"],
}));

const searchMessagesPage = vi.fn();
const getMessageSummary = vi.fn();
const getMessage = vi.fn();
const getAttachment = vi.fn();
const parseGmailMessage = vi.fn();
vi.mock("../../lib/gmail-api", () => ({
  searchMessagesPage: (...args: unknown[]) => searchMessagesPage(...args),
  getMessageSummary: (...args: unknown[]) => getMessageSummary(...args),
  getMessage: (...args: unknown[]) => getMessage(...args),
  getAttachment: (...args: unknown[]) => getAttachment(...args),
  parseGmailMessage: (...args: unknown[]) => parseGmailMessage(...args),
}));

const extractFromEmailText = vi.fn().mockResolvedValue({});
const extractFromImage = vi.fn().mockResolvedValue({});
const extractFromPdf = vi.fn().mockResolvedValue({});
vi.mock("../../lib/travel-document-extraction", () => ({
  extractFromEmailText: (...args: unknown[]) => extractFromEmailText(...args),
  extractFromImage: (...args: unknown[]) => extractFromImage(...args),
  extractFromPdf: (...args: unknown[]) => extractFromPdf(...args),
}));

const uploadDocument = vi.fn().mockResolvedValue("gmail/mock-storage-path.txt");
vi.mock("../../lib/travels-storage", () => ({
  uploadDocument: (...args: unknown[]) => uploadDocument(...args),
}));

const scanGmailForUser = vi.fn();
vi.mock("../../lib/gmail-scan", () => ({
  scanGmailForUser: (...args: unknown[]) => scanGmailForUser(...args),
}));

const syncItineraryFromDocument = vi.fn().mockResolvedValue(undefined);
vi.mock("./documents", () => ({
  syncItineraryFromDocument: (...args: unknown[]) => syncItineraryFromDocument(...args),
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

async function buildApp(): Promise<Express> {
  const { default: router } = await import("./gmail");
  const app = express();
  app.use(express.json());
  app.use(cookieParser("test-session-secret"));
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
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  lastReturning = [];
  vi.clearAllMocks();
  gmailOAuthEnabled.mockReturnValue(true);
});

describe("GET /api/travels/gmail/status", () => {
  it("reports disconnected when no connection row exists", async () => {
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, googleEmail: null, lastScanAt: null });
  });

  it("reports connected with the stored google email", async () => {
    selectQueue.push([{ googleEmail: "someone@gmail.com", lastScanAt: "2026-01-01T00:00:00.000Z" }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/status");

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.googleEmail).toBe("someone@gmail.com");
  });
});

describe("GET /api/travels/gmail/connect", () => {
  it("503s when Gmail OAuth is not configured", async () => {
    gmailOAuthEnabled.mockReturnValue(false);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/connect");

    expect(res.status).toBe(503);
  });

  it("redirects to Google's OAuth consent screen when configured", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/connect");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
    expect(generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "consent", access_type: "offline" }),
    );
  });
});

describe("GET /api/travels/gmail/suggestions", () => {
  it("only returns the current user's pending decisions", async () => {
    selectQueue.push([{ id: 1, userId: TEST_USER_ID, status: "pending" }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/suggestions");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(dbMock.select).toHaveBeenCalled();
  });
});

describe("POST /api/travels/gmail/suggestions/:id/dismiss", () => {
  it("404s when the decision does not belong to the current user", async () => {
    lastReturning = [];
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/suggestions/99/dismiss");

    expect(res.status).toBe(404);
  });

  it("marks the decision dismissed when owned by the current user", async () => {
    lastReturning = [{ id: 5, userId: TEST_USER_ID, status: "dismissed" }];
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/suggestions/5/dismiss");

    expect(res.status).toBe(200);
    expect(updateCalls[0]?.set).toMatchObject({ status: "dismissed" });
  });

  it("400s on a non-numeric id", async () => {
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/suggestions/not-a-number/dismiss");

    expect(res.status).toBe(400);
  });
});

describe("GET /api/travels/gmail/inbox", () => {
  it("409s when Gmail is not connected", async () => {
    getValidGmailAccessToken.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/inbox");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Gmail is not connected." });
  });

  it("searches the inbox and flags already-decided messages", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    searchMessagesPage.mockResolvedValue({
      messages: [{ id: "msg-1" }, { id: "msg-2" }],
      nextPageToken: null,
    });
    getMessageSummary
      .mockResolvedValueOnce({ id: "msg-1", threadId: "t1", subject: "Flight", from: "a@delta.com", date: null })
      .mockResolvedValueOnce({ id: "msg-2", threadId: "t2", subject: "Hotel", from: "b@marriott.com", date: null });
    selectQueue.push([{ gmailMessageId: "msg-1", status: "linked" }]);
    const app = await buildApp();

    const res = await request(app).get("/api/travels/gmail/inbox");

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].alreadyLinked).toBe(true);
    expect(res.body.messages[1].alreadyLinked).toBe(false);
  });
});

describe("POST /api/travels/gmail/messages/:messageId/link", () => {
  it("409s when Gmail is not connected", async () => {
    getValidGmailAccessToken.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/gmail/messages/msg-1/link")
      .send({ tripId: 7 });

    expect(res.status).toBe(409);
  });

  it("404s when the trip does not exist", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    selectQueue.push([]); // trip lookup finds nothing
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/gmail/messages/msg-1/link")
      .send({ tripId: 999 });

    expect(res.status).toBe(404);
  });

  it("409s when the message is already linked", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    selectQueue.push([{ id: 7 }]); // trip lookup
    selectQueue.push([{ status: "linked" }]); // existing decision lookup
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/gmail/messages/msg-1/link")
      .send({ tripId: 7 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This email is already linked to a trip." });
  });

  it("imports the email body as a document when there is no attachment", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    selectQueue.push([{ id: 7 }]); // trip lookup
    selectQueue.push([]); // no existing decision
    getMessage.mockResolvedValue({ threadId: "t1" });
    parseGmailMessage.mockReturnValue({
      subject: "Flight confirmation",
      from: "a@delta.com",
      date: null,
      textBody: "Your flight is confirmed.",
      attachments: [],
    });
    lastReturning = [{ id: 55, tripId: 7 }];
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/gmail/messages/msg-1/link")
      .send({ tripId: 7 });

    expect(res.status).toBe(201);
    expect(extractFromEmailText).toHaveBeenCalled();
    expect(uploadDocument).toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    const app = await buildApp();

    const res = await request(app)
      .post("/api/travels/gmail/messages/msg-1/link")
      .send({ tripId: "not-a-number" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/travels/gmail/messages/:messageId/ignore", () => {
  it("409s when Gmail is not connected", async () => {
    getValidGmailAccessToken.mockResolvedValue(null);
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/messages/msg-1/ignore");

    expect(res.status).toBe(409);
  });

  it("records an ignored decision for the message", async () => {
    getValidGmailAccessToken.mockResolvedValue("mock-access-token");
    getMessageSummary.mockResolvedValue({
      id: "msg-1",
      threadId: "t1",
      subject: "Newsletter",
      from: "noreply@example.com",
      date: null,
    });
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/messages/msg-1/ignore");

    expect(res.status).toBe(204);
    expect(updateCalls.some((c) => c.table === "upsert" && (c.set as { status?: string }).status === "ignored")).toBe(
      true,
    );
  });
});

describe("DELETE /api/travels/gmail/disconnect", () => {
  it("removes the stored connection for the current user", async () => {
    const app = await buildApp();

    const res = await request(app).delete("/api/travels/gmail/disconnect");

    expect(res.status).toBe(204);
    expect(deleteCalls).toHaveLength(1);
  });
});

describe("POST /api/travels/gmail/scan", () => {
  it("502s when the scan fails", async () => {
    scanGmailForUser.mockRejectedValue(new Error("boom"));
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/scan");

    expect(res.status).toBe(502);
  });

  it("returns the scan result and updates lastScanAt on success", async () => {
    scanGmailForUser.mockResolvedValue({ scanned: 10, suggested: 2 });
    const app = await buildApp();

    const res = await request(app).post("/api/travels/gmail/scan");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 10, suggested: 2 });
    expect(updateCalls.some((c) => "lastScanAt" in (c.set as object))).toBe(true);
  });
});
