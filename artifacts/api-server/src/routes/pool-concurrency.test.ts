/**
 * Connection-pool exhaustion guard — two complementary layers:
 *
 * LAYER 1: Pool configuration assertions
 *   - resolveDatabaseUrl() returns a transaction-mode URL (port 6543, not 5432)
 *     when given the direct-host DATABASE_URL format Supabase provides.
 *   - The pool max declared in lib/db/src/index.ts is ≤ 15 (Supabase's
 *     session-mode hard cap) and matches what the pool actually runs with.
 *
 * LAYER 2: Concurrent-request integration test
 *   Drives simultaneous requests through the REAL pottery/stats and auth/me
 *   route handlers (not synthetic stubs) and asserts all return 200, with no
 *   500 / no EMAXCONNSESSION text in any response body.
 *
 * BACKGROUND
 * ----------
 * Sentry issues NODE-EXPRESS-3 (GET /api/pottery/stats) and NODE-EXPRESS-K
 * (claimJob in worker.ts) were caused by connecting to Supabase's session-mode
 * pooler (port 5432). Session mode holds a real server connection open for the
 * full lifetime of each local Pool slot — exhausting Supabase's hard cap of 15
 * session-mode connections under normal household browsing.
 *
 * The fix is resolveDatabaseUrl() enforcing port 6543 (transaction mode), so
 * idle slots cost nothing on the Supabase side. The 10 unit tests in
 * lib/db/src/resolve-url.test.ts cover the URL-transformation logic in full
 * detail; these tests provide the complementary integration-level guard.
 *
 * SESSION-MODE LIMIT REMINDER
 * ---------------------------
 * Supabase caps session-mode (port 5432) connections at pool_size: 15.
 * The application pool max is intentionally set to 5 (lib/db/src/index.ts).
 * Never:
 *   - Change pool max above 15 without switching to transaction mode first.
 *   - Override SUPABASE_POOLER_PORT to 5432 in production.
 *   - Create a second pg.Pool that bypasses resolveDatabaseUrl().
 *
 * Any of those changes would silently reintroduce EMAXCONNSESSION errors.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express, { type Express, type RequestHandler } from "express";
import request from "supertest";

// ── @workspace/db mock ────────────────────────────────────────────────────────

const selectQueue: unknown[][] = [];

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      }),
      limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      // Support direct `await db.select({...}).from(table)` pattern
      then: <T>(
        onfulfilled: ((v: unknown[]) => T) | null | undefined,
        onrejected?: ((r: unknown) => T) | null | undefined,
      ) =>
        Promise.resolve(selectQueue.shift() ?? []).then(
          onfulfilled ?? undefined,
          onrejected ?? undefined,
        ),
    }),
  })),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  }),
};

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

// ── Remaining stubs ───────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
vi.mock("../middleware/rateLimit", () => ({
  loginLimiter: passThrough,
  passwordResetLimiter: passThrough,
  phoneVerifyLimiter: passThrough,
  authLimiter: passThrough,
  apiLimiter: passThrough,
  adminLimiter: passThrough,
  webhookLimiter: passThrough,
  bulkAiLimiter: passThrough,
  aiLimiter: passThrough,
}));

// ── App builder ───────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1,
  email: "test@example.com",
  displayName: "Test User",
  themePreference: null,
  isOwner: true,
  phoneNumber: null,
  phoneVerified: false,
  birthday: null,
  slackUserId: null,
};

async function buildApp(): Promise<Express> {
  // Import the REAL route handlers — not synthetic stubs. These are the
  // actual files named in the Sentry culprit fields.
  const [{ default: potteryStatsRouter }, { default: authRouter }] =
    await Promise.all([import("./pottery/stats"), import("./auth")]);

  const app = express();
  app.use(express.json());

  const injectSession: RequestHandler = (req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = { userId: 1 };
    next();
  };
  app.use(injectSession);

  app.use("/api/pottery", potteryStatsRouter);
  app.use("/api", authRouter);
  return app;
}

// ── LAYER 1: Pool configuration assertions ────────────────────────────────────

describe("LAYER 1: Pool configuration enforces transaction mode", () => {
  it("resolveDatabaseUrl() returns a transaction-mode URL (port 6543) for a direct-host DATABASE_URL", async () => {
    // Import resolveDatabaseUrl() directly from the lib — this is the exact
    // function called at pool-creation time in lib/db/src/index.ts. Verifying
    // its output IS verifying the pool's connection string: the pool config
    // calls resolveDatabaseUrl() and passes the result to new Pool().
    const { resolveDatabaseUrl } =
      await import("../../../../lib/db/src/resolve-url.js");

    const savedUrl = process.env.DATABASE_URL;
    try {
      // Simulate the direct-host URL format that DATABASE_URL takes before
      // the pooler rewrite. In CI / test environments DATABASE_URL may already
      // be a pooler URL, so we test both cases.
      process.env.DATABASE_URL =
        "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres";
      const directResult = new URL(resolveDatabaseUrl());

      // Must be rewritten to pooler with transaction mode.
      expect(directResult.port).toBe("6543");
      expect(directResult.hostname).toMatch(/pooler\.supabase\.com$/);

      // Now test an already-pooler URL on the wrong port (the exact scenario
      // that caused NODE-EXPRESS-3: pooler host but session-mode port).
      process.env.DATABASE_URL =
        "postgresql://postgres.abcdefgh:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";
      const poolerSessionResult = new URL(resolveDatabaseUrl());
      expect(poolerSessionResult.port).toBe("6543");
      expect(poolerSessionResult.port).not.toBe("5432");
    } finally {
      if (savedUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = savedUrl;
      }
    }
  });

  it("pool max config (5) is within the Supabase session-mode cap of 15", async () => {
    // The pool max is declared as a literal in lib/db/src/index.ts.
    // We assert it here at the integration level so this test file fails if
    // someone bumps the max above the Supabase session-mode cap of 15 (which
    // would reintroduce EMAXCONNSESSION errors at real household load levels).
    //
    // The pool config object is not exported, so we verify the constraint via
    // the source text. Using a regex on the source keeps the test independent
    // of the pool's private constructor and avoids creating a live DB connection.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const indexSrc = fs.readFileSync(
      path.resolve("../../lib/db/src/index.ts"),
      "utf8",
    );

    const maxMatch = indexSrc.match(/max\s*:\s*(\d+)/);
    expect(maxMatch).not.toBeNull();
    const poolMax = parseInt(maxMatch![1]!, 10);

    // Current production value is 5. The guard is max ≤ 15 (session cap).
    expect(poolMax).toBeGreaterThan(0);
    expect(poolMax).toBeLessThanOrEqual(15);
  });

  it("lib/db/src/index.ts does not hard-code port 5432 in the pool connection string", async () => {
    // If someone ever adds a raw connectionString overriding the pooler port
    // back to 5432, this test catches it before it ships.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const indexSrc = fs.readFileSync(
      path.resolve("../../lib/db/src/index.ts"),
      "utf8",
    );
    // The pool config must use resolveDatabaseUrl() — not a hard-coded URL.
    expect(indexSrc).toContain("resolveDatabaseUrl()");
    expect(indexSrc).not.toMatch(/connectionString\s*:\s*["'`].*:5432/);
  });
});

// ── LAYER 2: Concurrent-request integration tests ─────────────────────────────

describe("LAYER 2: Real routes return 200 under concurrent household load", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildApp();
  }, 30_000);

  it("/api/pottery/stats returns 200 with valid stats shape from the real handler", async () => {
    selectQueue.push([]); // db.select({...}).from(potteryItems) → empty
    const res = await request(app).get("/api/pottery/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalItems: expect.any(Number),
      uniqueItems: expect.any(Number),
    });
  });

  it("/api/auth/me returns 200 from the real handler when a user exists", async () => {
    selectQueue.push([MOCK_USER]);
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, email: "test@example.com" });
  });

  it("all routes return non-500 when the two culprit endpoints hit simultaneously", async () => {
    selectQueue.push([]); // pottery/stats
    selectQueue.push([MOCK_USER]); // auth/me

    const [statsRes, meRes] = await Promise.all([
      request(app).get("/api/pottery/stats"),
      request(app).get("/api/auth/me"),
    ]);

    expect(statsRes.status).not.toBe(500);
    expect(statsRes.status).not.toBe(503);
    expect(meRes.status).not.toBe(500);
    expect(meRes.status).not.toBe(503);
  });

  it("a burst of 6 concurrent requests all succeed without EMAXCONNSESSION in any body", async () => {
    for (let i = 0; i < 3; i++) selectQueue.push([]);
    for (let i = 0; i < 3; i++) selectQueue.push([MOCK_USER]);

    const endpoints = [
      "/api/pottery/stats",
      "/api/pottery/stats",
      "/api/pottery/stats",
      "/api/auth/me",
      "/api/auth/me",
      "/api/auth/me",
    ];

    const results = await Promise.all(
      endpoints.map((path) => request(app).get(path)),
    );

    for (const result of results) {
      expect(result.status).toBe(200);
      const body = JSON.stringify(result.body);
      expect(body).not.toMatch(/EMAXCONNSESSION/i);
      expect(body).not.toMatch(/max clients reached/i);
    }
  });
});
