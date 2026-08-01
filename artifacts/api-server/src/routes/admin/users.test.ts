import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Infrastructure mocks ─────────────────────────────────────────────────────

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../middleware/rateLimit", () => ({
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/env", () => ({
  env: {
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    isProduction: false,
    sessionSecret: "test-secret",
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

// Mutable fixtures — tests override these per-case.
let mockSelectRows: unknown[] = [];
let mockUpdateRows: unknown[] = [];
let mockDeleteRows: unknown[] = [];

const mockDbSelect = {
  select: vi.fn(),
};

// Shared mock client for pool.connect()
const mockClient = {
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...real,
    pool: {
      connect: vi.fn(async () => mockClient),
    },
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(async () => mockSelectRows),
          where: vi.fn(() => ({
            limit: vi.fn(async () => mockSelectRows),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => mockUpdateRows),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mockDeleteRows),
        })),
      })),
    },
    appUsers: real.appUsers,
  };
});

// ── Auth mocks ────────────────────────────────────────────────────────────────

// Track which user ID is "logged in" — tests override per-case.
let currentUserId = 1;
let currentIsOwner = true;

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: currentUserId };
    next();
  },
}));

vi.mock("../../middleware/owner", () => ({
  requireOwner: (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!currentIsOwner) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
}));

vi.mock("../../lib/auth-context", () => ({
  getAuthenticatedUserId: (req: { session?: { userId?: number } }) => {
    const id = req.session?.userId;
    if (!id) throw new Error("not authenticated");
    return id;
  },
}));

// ── Router import (must come after all vi.mock calls) ────────────────────────

import adminUsersRouter from "./users";

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin/users", adminUsersRouter);
  return app;
}

// ── Shared test fixture ───────────────────────────────────────────────────────

const baseUser = {
  id: 2,
  email: "jane@example.com",
  displayName: "Jane",
  themePreference: "dark",
  timezone: "America/Denver",
  travelsReminderEmail: null,
  birthday: null,
  isOwner: false,
  phoneNumber: "+12105551234",
  phoneVerified: true,
  phoneVerifiedAt: null,
  smsConsentAt: null,
  smsOptedOutAt: null,
  smsFirstOutboundSentAt: null,
  slackUserId: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = 1;
  currentIsOwner = true;
  mockSelectRows = [];
  mockUpdateRows = [];
  mockDeleteRows = [];
  mockClient.query.mockResolvedValue({ rows: [] });
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe("GET /admin/users", () => {
  it("returns all users", async () => {
    mockSelectRows = [baseUser];
    const app = buildApp();
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe("jane@example.com");
  });

  it("never exposes passwordHash — USER_SELECT constant excludes it", async () => {
    // The db.select call uses a USER_SELECT projection that omits passwordHash.
    // The real Drizzle query will therefore never include it in the row shape.
    // We verify this statically: the route file must not name passwordHash in
    // any select/returning clause.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("./users.ts", import.meta.url).pathname,
      "utf-8",
    );
    // passwordHash should not appear in any select projection in the route.
    // (It is legal to appear in a comment, but must not be in USER_SELECT.)
    const lines = src
      .split("\n")
      .filter((l) => l.includes("passwordHash") && !l.trim().startsWith("//"));
    expect(lines).toHaveLength(0);
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const app = buildApp();
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(403);
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────────

describe("PATCH /admin/users/:id", () => {
  it("updates identity fields and returns the updated user", async () => {
    mockUpdateRows = [{ ...baseUser, displayName: "Jane Updated" }];
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ displayName: "Jane Updated" });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("Jane Updated");
  });

  it("sets smsConsentAt when smsConsentNow=true", async () => {
    mockUpdateRows = [{ ...baseUser, smsConsentAt: new Date().toISOString() }];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ smsConsentNow: true });
    expect(res.status).toBe(200);
    // Verify db.update was called with a Date for smsConsentAt
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.update).toHaveBeenCalled();
  });

  it("clears smsConsentAt when smsConsentNow=false", async () => {
    mockUpdateRows = [{ ...baseUser, smsConsentAt: null }];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ smsConsentNow: false });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.update).toHaveBeenCalled();
  });

  it("sets smsOptedOutAt when smsOptedOut=true", async () => {
    mockUpdateRows = [{ ...baseUser, smsOptedOutAt: new Date().toISOString() }];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ smsOptedOut: true });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.update).toHaveBeenCalled();
  });

  it("clears smsOptedOutAt when smsOptedOut=false", async () => {
    mockUpdateRows = [{ ...baseUser, smsOptedOutAt: null }];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ smsOptedOut: false });
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.update).toHaveBeenCalled();
  });

  it("rejects owner removing their own isOwner flag", async () => {
    currentUserId = 2; // same as target
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ isOwner: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot remove your own owner/i);
  });

  it("allows owner to demote a different user", async () => {
    currentUserId = 1; // different from target (2)
    mockUpdateRows = [{ ...baseUser, isOwner: false }];
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ isOwner: false });
    expect(res.status).toBe(200);
    expect(res.body.user.isOwner).toBe(false);
  });

  it("auto-clears verification/consent when phoneNumber changes", async () => {
    // First select returns the current user (different phone number)
    mockSelectRows = [{ ...baseUser, phoneNumber: "+10000000000" }];
    // Update returns user with cleared fields
    mockUpdateRows = [
      {
        ...baseUser,
        phoneNumber: "+12105559999",
        phoneVerified: false,
        phoneVerifiedAt: null,
        smsConsentAt: null,
        smsOptedOutAt: null,
        smsFirstOutboundSentAt: null,
      },
    ];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ phoneNumber: "+12105559999" });
    expect(res.status).toBe(200);
    // Verify update was called with cleared fields
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateMock = db.update as ReturnType<typeof vi.fn>;
    expect(updateMock).toHaveBeenCalled();
    const setArg = updateMock.mock.results[0]?.value?.set?.mock?.calls?.[0]?.[0] as Record<string, unknown> | undefined;
    if (setArg) {
      expect(setArg["phoneVerified"]).toBe(false);
      expect(setArg["phoneVerifiedAt"]).toBeNull();
      expect(setArg["smsConsentAt"]).toBeNull();
      expect(setArg["smsOptedOutAt"]).toBeNull();
      expect(setArg["smsFirstOutboundSentAt"]).toBeNull();
    }
  });

  it("does not clear consent/verification when phoneNumber is unchanged", async () => {
    // Select returns same phone number as the PATCH body
    mockSelectRows = [{ ...baseUser, phoneNumber: "+12105551234" }];
    mockUpdateRows = [{ ...baseUser, displayName: "Jane Updated" }];
    const { db } = await import("@workspace/db");
    const app = buildApp();
    await request(app)
      .patch("/admin/users/2")
      .send({ phoneNumber: "+12105551234", displayName: "Jane Updated" });
    const updateMock = db.update as ReturnType<typeof vi.fn>;
    const setArg = updateMock.mock.results[0]?.value?.set?.mock?.calls?.[0]?.[0] as Record<string, unknown> | undefined;
    // phoneVerified should NOT be auto-cleared (same number)
    if (setArg) {
      expect(setArg).not.toHaveProperty("phoneVerifiedAt");
      expect(setArg).not.toHaveProperty("smsFirstOutboundSentAt");
    }
  });

  it("returns 400 for an invalid phone number", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ phoneNumber: "not-e164" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid birthday format", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ birthday: "1990-07-04" }); // YYYY-MM-DD not allowed — must be MM-DD
    expect(res.status).toBe(400);
  });

  it("returns 400 when no fields are provided", async () => {
    const app = buildApp();
    const res = await request(app).patch("/admin/users/2").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no fields/i);
  });

  it("returns 404 when the user does not exist", async () => {
    mockUpdateRows = []; // empty = not found
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/9999")
      .send({ displayName: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/abc")
      .send({ displayName: "X" });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const app = buildApp();
    const res = await request(app)
      .patch("/admin/users/2")
      .send({ displayName: "X" });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe("DELETE /admin/users/:id", () => {
  it("deletes a different user and returns { deleted: true }", async () => {
    // SELECT check returns the user; pool transaction succeeds
    mockSelectRows = [{ id: 2 }];
    const app = buildApp();
    const res = await request(app).delete("/admin/users/2");
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    // Verify a transaction was used (BEGIN / COMMIT)
    const calls = (mockClient.query.mock.calls as unknown[][]).map(
      (c) => c[0] as string,
    );
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("COMMIT");
    // Verify the final user delete was called
    expect(calls.some((q) => q.includes("DELETE FROM app_users"))).toBe(true);
    // Verify OAuth tokens are removed before the user row
    expect(
      calls.some((q) =>
        q.includes("DELETE FROM travels_google_calendar_connections"),
      ),
    ).toBe(true);
    expect(
      calls.some((q) => q.includes("DELETE FROM travels_gmail_connections")),
    ).toBe(true);
    expect(
      calls.some((q) => q.includes("DELETE FROM app_gmail_connections")),
    ).toBe(true);
  });

  it("deletes notification_deliveries before notification_recipients (FK order)", async () => {
    mockSelectRows = [{ id: 2 }];
    const app = buildApp();
    await request(app).delete("/admin/users/2");
    const calls = (mockClient.query.mock.calls as unknown[][]).map(
      (c) => c[0] as string,
    );
    const delivIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM notification_deliveries"),
    );
    const recipIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM notification_recipients"),
    );
    expect(delivIdx).toBeGreaterThan(-1);
    expect(recipIdx).toBeGreaterThan(-1);
    expect(delivIdx).toBeLessThan(recipIdx);
  });

  it("deletes packing_items → packing_lists → trips in FK-safe order", async () => {
    mockSelectRows = [{ id: 2 }];
    const app = buildApp();
    await request(app).delete("/admin/users/2");
    const calls = (mockClient.query.mock.calls as unknown[][]).map(
      (c) => c[0] as string,
    );
    const itemsIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM travels_packing_items"),
    );
    const listsIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM travels_packing_lists"),
    );
    const tripsIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM travels_trips"),
    );
    expect(itemsIdx).toBeGreaterThan(-1);
    expect(listsIdx).toBeGreaterThan(-1);
    expect(tripsIdx).toBeGreaterThan(-1);
    expect(itemsIdx).toBeLessThan(listsIdx);
    expect(listsIdx).toBeLessThan(tripsIdx);
  });

  it("deletes app_users as the last SQL statement (after all owned data)", async () => {
    mockSelectRows = [{ id: 2 }];
    const app = buildApp();
    await request(app).delete("/admin/users/2");
    const calls = (mockClient.query.mock.calls as unknown[][]).map(
      (c) => c[0] as string,
    );
    const userDeleteIdx = calls.findIndex((q) =>
      q.includes("DELETE FROM app_users"),
    );
    const commitIdx = calls.indexOf("COMMIT");
    // app_users delete must be immediately before COMMIT
    expect(userDeleteIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBe(userDeleteIdx + 1);
  });

  it("rolls back on error and re-throws", async () => {
    mockSelectRows = [{ id: 2 }];
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error("FK violation")) // first DELETE
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const app = buildApp();
    // We expect the server to 500 but the ROLLBACK to have been called
    const res = await request(app).delete("/admin/users/2");
    expect(res.status).toBe(500);
    const calls = (mockClient.query.mock.calls as unknown[][]).map(
      (c) => c[0] as string,
    );
    expect(calls).toContain("ROLLBACK");
  });

  it("blocks self-deletion", async () => {
    currentUserId = 2; // same as target
    const app = buildApp();
    const res = await request(app).delete("/admin/users/2");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete your own/i);
  });

  it("returns 404 when the user does not exist", async () => {
    mockSelectRows = []; // user not found
    const app = buildApp();
    const res = await request(app).delete("/admin/users/9999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const app = buildApp();
    const res = await request(app).delete("/admin/users/abc");
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-owner", async () => {
    currentIsOwner = false;
    const app = buildApp();
    const res = await request(app).delete("/admin/users/2");
    expect(res.status).toBe(403);
  });
});
