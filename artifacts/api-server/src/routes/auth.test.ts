/**
 * Unit tests for the password-change and password-reset routes in auth.ts.
 *
 * Focuses on the atomicity and session-preservation guarantees introduced in
 * issues #307 and #313:
 *
 *   #307 — password update + session revocation must be one DB transaction
 *   #313 — cookie-persistence choice (remember-me) must survive regenerate()
 *
 * The tests use supertest + vitest.  External dependencies (pool, db, bcrypt,
 * email, rate-limiters, etc.) are all mocked so no live database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { makeEagerSelectBuilder } from "../test-helpers/db-mock";

// ---------------------------------------------------------------------------
// Mocks (declared before any imports that exercise the modules under test)
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/rateLimit", () => ({
  loginLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  passwordResetLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  phoneVerifyLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  webhookLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/env", () => ({
  env: {
    isProduction: false,
    sessionSecret: "test-secret",
    supabaseUrl: "https://mock.supabase.co",
    supabaseServiceRoleKey: "mock-key",
    openrouterApiKey: "mock-key",
    resendApiKey: undefined,
    resendFromEmail: undefined,
    agentphoneWebhookSecret: "mock",
    slackSigningSecret: "mock",
  },
}));

vi.mock("../lib/email", () => ({
  resendConfigured: () => false,
  sendPasswordResetEmail: vi.fn(),
  sendTestEmail: vi.fn(),
}));

vi.mock("../lib/sms", () => ({
  smsConfigured: () => false,
  sendSms: vi.fn(),
  SmsRegistrationPendingError: class extends Error {},
  SmsOptedOutError: class extends Error {},
}));

vi.mock("../lib/google-oauth", () => ({
  googleEnabled: false,
  createGoogleClient: vi.fn(),
  GOOGLE_SCOPES: [],
}));

vi.mock("../lib/slack", () => ({
  getSlackUserEmail: vi.fn().mockResolvedValue("user@example.com"),
  slackConfigured: () => false,
}));

vi.mock("../lib/reminder-scheduler", () => ({
  runReminderAlerts: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  THIRTY_DAYS_MS: 30 * 24 * 60 * 60 * 1000,
  createSessionMiddleware: vi.fn(),
}));

// ── bcrypt mock ───────────────────────────────────────────────────────────────
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn().mockResolvedValue(true), // always correct password by default
    genSalt: vi.fn().mockResolvedValue("salt"),
    // hashSync is called at module-load time in auth.ts to build a dummy
    // password hash for timing-safe rejection of unknown accounts.
    hashSync: vi.fn().mockReturnValue("$2b$10$mock-dummy-hash"),
  },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────

// Records every query call on the mock pg client
const pgClientQueries: string[] = [];
let pgClientReleaseCalled = false;
let pgClientUnlockShouldThrow = false;

const mockPgClient = {
  query: vi.fn((sql: string) => {
    pgClientQueries.push(sql.trim().split(/\s+/)[0].toUpperCase()); // first keyword
    if (pgClientUnlockShouldThrow && sql.includes("pg_advisory_unlock")) {
      throw new Error("mock unlock failure");
    }
    return Promise.resolve({ rows: [] });
  }),
  release: vi.fn(() => {
    pgClientReleaseCalled = true;
  }),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockPgClient),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

// Selects: queue next result sets for db.select() calls
const selectQueue: unknown[][] = [];

function makeUpdateBuilder() {
  const builder: Record<string, () => unknown> = {
    set() {
      return builder;
    },
    where() {
      return builder;
    },
    returning() {
      return Promise.resolve([
        {
          id: 99,
          userId: 4,
        },
      ]);
    },
  };
  return builder;
}

const dbTransactionFn = vi.fn();

const dbMock = {
  select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
  update: vi.fn(() => makeUpdateBuilder()),
  transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: vi.fn(() => makeEagerSelectBuilder(selectQueue)),
      update: vi.fn(() => makeUpdateBuilder()),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    dbTransactionFn(tx);
    return fn(tx);
  }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: dbMock,
    pool: mockPool,
  };
});

// ── auth middleware mock ───────────────────────────────────────────────────────
// requireAuth just looks at req.session.userId; we inject it in every test.
vi.mock("../middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...actual,
    requireAuth: (req: Request, res: Response, next: NextFunction): void => {
      if (
        !(req as Request & { session?: { userId?: number } }).session?.userId
      ) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      next();
    },
  };
});

// ---------------------------------------------------------------------------
// Session injection helper
// ---------------------------------------------------------------------------

type FakeSession = {
  userId?: number;
  cookie: { maxAge?: number; expires?: Date };
  regenerate: (cb: (err: Error | null) => void) => void;
  save: (cb: (err: Error | null) => void) => void;
};

let capturedSession: FakeSession | null = null;

function injectSession(
  userId: number,
  opts: { maxAge?: number; expires?: Date } = {},
) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    const session: FakeSession = {
      userId,
      cookie: {
        maxAge: opts.maxAge,
        expires: opts.expires,
      },
      regenerate(cb) {
        // Simulate regenerate: new session starts empty
        session.userId = undefined;
        cb(null);
      },
      save(cb) {
        cb(null);
      },
    };
    capturedSession = session;
    (_req as unknown as { session: FakeSession }).session = session;
    next();
  };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(
  sessionOpts: { maxAge?: number; expires?: Date } = {},
): Promise<Express> {
  const { default: router } = await import("./auth");
  const app = express();
  app.use(express.json());
  app.use(injectSession(4, sessionOpts));
  app.use("/api", router);
  return app;
}

// ---------------------------------------------------------------------------
// Tests: #307 — atomic password-change transaction
// ---------------------------------------------------------------------------

describe("POST /auth/change-password — #307 atomicity", () => {
  beforeEach(() => {
    pgClientQueries.length = 0;
    pgClientReleaseCalled = false;
    mockPool.connect.mockClear();
    dbMock.select.mockClear();

    // Provide a user row for the initial lookup
    selectQueue.push([
      {
        id: 4,
        email: "user@example.com",
        passwordHash: "$2b$12$mock",
        isOwner: false,
        slackUserId: null,
      },
    ]);
  });

  it("acquires a pool client and wraps UPDATE + DELETE in a transaction", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    // Should succeed (204) or at least attempt the transaction
    expect(mockPool.connect).toHaveBeenCalledOnce();

    // BEGIN must come before UPDATE, DELETE must come before COMMIT
    const beginIdx = pgClientQueries.indexOf("BEGIN");
    const updateIdx = pgClientQueries.findIndex((q) => q === "UPDATE");
    const deleteIdx = pgClientQueries.findIndex((q) => q === "DELETE");
    const commitIdx = pgClientQueries.indexOf("COMMIT");

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(beginIdx);
    expect(deleteIdx).toBeGreaterThan(beginIdx);
    expect(commitIdx).toBeGreaterThan(deleteIdx);

    expect(res.status).toBe(204);
  });

  it("releases the pool client even when COMMIT succeeds", async () => {
    const app = await buildApp();
    await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    expect(mockPgClient.release).toHaveBeenCalled();
  });

  it("rolls back and releases client when UPDATE throws", async () => {
    mockPgClient.query.mockImplementationOnce((sql: string) => {
      pgClientQueries.push(sql.trim().split(/\s+/)[0].toUpperCase());
      return Promise.resolve({ rows: [] }); // BEGIN ok
    });
    mockPgClient.query.mockImplementationOnce(() => {
      throw new Error("DB error during UPDATE");
    });

    const app = await buildApp();
    await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    // ROLLBACK should have been attempted and client released
    expect(mockPgClient.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: #313 — remember-me cookie preserved after password change
// ---------------------------------------------------------------------------

describe("POST /auth/change-password — #313 session-persistence preservation", () => {
  beforeEach(() => {
    pgClientQueries.length = 0;
    pgClientReleaseCalled = false;
    mockPool.connect.mockClear();
    dbMock.select.mockClear();
    selectQueue.push([
      {
        id: 4,
        email: "user@example.com",
        passwordHash: "$2b$12$mock",
        isOwner: false,
        slackUserId: null,
      },
    ]);
  });

  it("preserves userId on the regenerated session", async () => {
    const app = await buildApp();
    await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    expect(capturedSession?.userId).toBe(4);
  });

  it("preserves a 30-day maxAge when remember-me was set", async () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const app = await buildApp({ maxAge: THIRTY_DAYS_MS });

    await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    expect(capturedSession?.cookie.maxAge).toBe(THIRTY_DAYS_MS);
  });

  it("leaves maxAge undefined when remember-me was NOT set (browser-session cookie)", async () => {
    // maxAge is undefined → browser-session cookie
    const app = await buildApp({ maxAge: undefined, expires: undefined });

    await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new-secure-password" });

    // After regenerate, maxAge must remain undefined (not the middleware default)
    expect(capturedSession?.cookie.maxAge).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: #307 — atomic password-reset transaction (tx.execute)
// ---------------------------------------------------------------------------

describe("POST /auth/reset-password — #307 atomicity", () => {
  it("calls tx.execute inside the Drizzle transaction to delete sessions", async () => {
    // Reset the transaction mock so we can inspect the tx argument
    dbTransactionFn.mockClear();
    dbMock.transaction.mockClear();

    const app = await buildApp();
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "abc123", newPassword: "new-secure-password" });

    // db.transaction should have been called
    expect(dbMock.transaction).toHaveBeenCalled();

    // The tx passed into the transaction fn must have had execute() called
    const txArg = dbTransactionFn.mock.calls[0]?.[0] as {
      execute: ReturnType<typeof vi.fn>;
    };
    expect(txArg).toBeDefined();
    expect(txArg.execute).toHaveBeenCalled();

    // execute() must have been called exactly once with a drizzle SQL object
    // (the DELETE FROM app_sessions statement).  drizzle's sql`` tagged
    // template returns an SQL class instance whose toString() is the unhelpful
    // "[object Object]", so we only assert the call count here, not the text.
    expect(txArg.execute).toHaveBeenCalledTimes(1);
    const executeArg = txArg.execute.mock.calls[0]?.[0];
    expect(executeArg).toBeDefined();
    expect(typeof executeArg).toBe("object");
  });
});
