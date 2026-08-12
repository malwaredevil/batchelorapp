/**
 * Tests for the /cached endpoint on the integrations-health router.
 *
 * Key invariant: GET /cached must NEVER invoke runAllChecks (i.e. trigger live
 * external API calls). It should return cached data when a valid cache entry
 * exists and 204 No Content otherwise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    openrouterApiKey: undefined,
    openaiApiKey: undefined,
    jinaApiKey: undefined,
    voyageApiKey: undefined,
    resendApiKey: undefined,
    apifyApiToken: undefined,
    slackBotToken: undefined,
    googleClientId: undefined,
    googleClientSecret: undefined,
    googleMapsApiKey: undefined,
    googleWalletIssuerId: undefined,
    googleWalletServiceAccountJson: undefined,
    sentryDsn: undefined,
    ebayAppId: undefined,
    ebayCertId: undefined,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...real,
    db: {
      execute: vi.fn(async () => []),
    },
  };
});

// ── Auth mocks ────────────────────────────────────────────────────────────────

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: { session?: { userId?: number } },
    _res: unknown,
    next: () => void,
  ) => {
    req.session = { userId: 1 };
    next();
  },
}));

vi.mock("../../middleware/owner", () => ({
  requireOwner: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

// ── Router import (must come after all vi.mock calls) ────────────────────────

import integrationsHealthRouter, {
  _setTestCache,
  _runCheckForTest,
} from "./integrations-health";

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/admin/integrations/health", integrationsHealthRouter);
  return app;
}

// ── Fixture ───────────────────────────────────────────────────────────────────

const MOCK_CHECKS = [
  { service: "Supabase", status: "ok" as const, latencyMs: 12 },
  { service: "OpenRouter", status: "missing_key" as const },
];

const MOCK_CACHED_RESULT = {
  data: { checks: MOCK_CHECKS, cachedAt: "2026-08-01T10:00:00.000Z" },
  expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now — not expired
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /admin/integrations/health/cached", () => {
  beforeEach(() => {
    // Reset cache before every test
    _setTestCache(null);
  });

  it("returns 204 when no cache exists (cold start)", async () => {
    const app = buildApp();
    const res = await request(app).get("/admin/integrations/health/cached");
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("returns 204 when the cache has expired", async () => {
    _setTestCache({
      data: { checks: MOCK_CHECKS, cachedAt: "2026-08-01T09:00:00.000Z" },
      expiresAt: Date.now() - 1, // already expired
    });
    const app = buildApp();
    const res = await request(app).get("/admin/integrations/health/cached");
    expect(res.status).toBe(204);
  });

  it("returns cached data with fromCache:true when a valid cache exists", async () => {
    _setTestCache(MOCK_CACHED_RESULT);
    const app = buildApp();
    const res = await request(app).get("/admin/integrations/health/cached");
    expect(res.status).toBe(200);
    expect(res.body.fromCache).toBe(true);
    expect(res.body.cachedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(res.body.checks).toHaveLength(2);
    expect(res.body.checks[0].service).toBe("Supabase");
    expect(res.body.checks[0].status).toBe("ok");
  });

  it("does not run live checks on no-cache load (fetch is never called)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // Ensure cache is empty so a naive implementation would try to run checks
    _setTestCache(null);
    const app = buildApp();
    await request(app).get("/admin/integrations/health/cached");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not run live checks on expired-cache load (fetch is never called)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    _setTestCache({
      data: { checks: MOCK_CHECKS, cachedAt: "2026-08-01T08:00:00.000Z" },
      expiresAt: Date.now() - 1000,
    });
    const app = buildApp();
    await request(app).get("/admin/integrations/health/cached");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ── runCheck retry / no-retry behaviour ───────────────────────────────────────
//
// These tests use fake timers to control the 2-second retry delay and the
// 15-second outer timeout without actually waiting in real time.

describe("_runCheckForTest retry behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper: make a trivial fn that throws on the first N calls then succeeds.
  function fnThrowsThenSucceeds(throwCount: number) {
    let calls = 0;
    return async (_key: string) => {
      calls++;
      if (calls <= throwCount) {
        throw new Error("network error");
      }
      return { ok: true as const };
    };
  }

  it("returns ok when a thrown exception is followed by a successful retry", async () => {
    const fn = fnThrowsThenSucceeds(1);
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    // Advance past the retry delay (2 s) so the second attempt can run.
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("ok");
    expect(result.service).toBe("TestSvc");
  });

  it("returns error after all attempts fail with thrown exceptions", async () => {
    const fn = fnThrowsThenSucceeds(99); // always throws
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/network error/);
  });

  it("returns ok when a 5xx response is followed by a successful retry", async () => {
    let calls = 0;
    const fn = async (_key: string) => {
      calls++;
      if (calls === 1) {
        return {
          ok: false as const,
          retryable: true,
          detail: "HTTP 503: Service Unavailable",
        };
      }
      return { ok: true as const };
    };
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("ok");
    expect(calls).toBe(2);
  });

  it("returns ok when a 429 response is followed by a successful retry", async () => {
    let calls = 0;
    const fn = async (_key: string) => {
      calls++;
      if (calls === 1) {
        return {
          ok: false as const,
          retryable: true,
          detail: "HTTP 429: Too Many Requests",
        };
      }
      return { ok: true as const };
    };
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry on a 401 (permanent auth failure) — returns error immediately with one call", async () => {
    let calls = 0;
    const fn = async (_key: string) => {
      calls++;
      return {
        ok: false as const,
        retryable: false,
        detail: "HTTP 401: Unauthorized",
      };
    };
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    // Even after advancing timers there should be no second call.
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("error");
    expect(result.detail).toBe("HTTP 401: Unauthorized");
    expect(calls).toBe(1);
  });

  it("does NOT retry on a 403 (forbidden) — returns error immediately with one call", async () => {
    let calls = 0;
    const fn = async (_key: string) => {
      calls++;
      return {
        ok: false as const,
        retryable: false,
        detail: "HTTP 403: Forbidden",
      };
    };
    const resultPromise = _runCheckForTest("TestSvc", "key", fn);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.status).toBe("error");
    expect(calls).toBe(1);
  });

  it("returns missing_key immediately when key is undefined", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    const result = await _runCheckForTest("TestSvc", undefined, fn);
    expect(result.status).toBe("missing_key");
    expect(fn).not.toHaveBeenCalled();
  });
});
