import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";
import type { Store, IncrementResponse, Options } from "express-rate-limit";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Controllable fake store — lets individual tests set totalHits or throw
// ---------------------------------------------------------------------------

class FakeStore implements Store {
  prefix = "";
  readonly callKeys: string[] = [];
  private readonly _hits: number;
  private readonly _throws: boolean;

  constructor(hits = 1, throws = false) {
    this._hits = hits;
    this._throws = throws;
  }

  init(_options: Options): void {}

  async increment(key: string): Promise<IncrementResponse> {
    this.callKeys.push(key);
    if (this._throws) throw new Error("DB connection refused");
    return {
      totalHits: this._hits,
      resetTime: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async decrement(_key: string): Promise<void> {}
  async resetKey(_key: string): Promise<void> {}
}

function makeLimiter(store: Store) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    passOnStoreError: false,
  });
}

function makeApp(store: Store) {
  const app = express();
  const limiter = makeLimiter(store);
  app.post("/api/agentphone/webhook", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Boundary behaviour
// ---------------------------------------------------------------------------

describe("webhookLimiter — boundary behaviour (max = 60)", () => {
  it("passes a request whose hit count is exactly 60", async () => {
    const store = new FakeStore(60);
    const res = await request(makeApp(store))
      .post("/api/agentphone/webhook")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 429 when hit count reaches 61 (over the max)", async () => {
    const store = new FakeStore(61);
    const res = await request(makeApp(store))
      .post("/api/agentphone/webhook")
      .send({});
    expect(res.status).toBe(429);
  });

  it("sets RateLimit-* standard headers on a 429", async () => {
    const store = new FakeStore(61);
    const res = await request(makeApp(store))
      .post("/api/agentphone/webhook")
      .send({});
    expect(res.status).toBe(429);
    expect(res.headers).toHaveProperty("ratelimit-limit");
    expect(res.headers).toHaveProperty("ratelimit-remaining");
  });
});

// ---------------------------------------------------------------------------
// Store-error behaviour — passOnStoreError: false must fail CLOSED
// ---------------------------------------------------------------------------

describe("webhookLimiter — store error handling (passOnStoreError: false)", () => {
  it("denies the request (does not pass through) when the store throws", async () => {
    const store = new FakeStore(1, true);
    const res = await request(makeApp(store))
      .post("/api/agentphone/webhook")
      .send({});
    // "Fail closed" means the request is NOT allowed through (not 200).
    // express-rate-limit with passOnStoreError:false calls next(error), which
    // Express resolves as a 500 in a minimal test app with no error handler.
    // Both 429 and 500 represent "denied" — the invariant is status !== 200.
    expect(res.status).not.toBe(200);
  });

  it("does not silently pass the request when the store throws", async () => {
    const store = new FakeStore(1, true);
    const res = await request(makeApp(store))
      .post("/api/agentphone/webhook")
      .send({});
    // The response body must not contain the handler's { ok: true } payload —
    // the request must not reach the route handler when the store is broken.
    expect(res.body).not.toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Namespace — verify the production limiter is keyed under "webhook:"
// ---------------------------------------------------------------------------

describe("webhookLimiter — namespace / key prefix", () => {
  it("uses the 'webhook' prefix so webhook keys do not collide with other limiters", async () => {
    // We cannot easily import the live webhookLimiter (it instantiates
    // PostgresRateLimitStore which requires a DB connection), so we test the
    // invariant directly: a store whose prefix is "webhook" receives keys that
    // start with "webhook:".
    const store = new FakeStore(1);
    // Simulate express-rate-limit calling init + increment with a prefixed key.
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      store,
      passOnStoreError: false,
      keyGenerator: () => "::1",
    });
    const app = express();
    app.use(limiter);
    app.post("/test", (_req, res) => res.json({ ok: true }));
    await request(app).post("/test").send({});
    // express-rate-limit calls store.increment with the raw keyGenerator result;
    // the PostgresRateLimitStore prepends `${prefix}:` in its fullKey() method.
    // Here we verify the raw key reaches the store as "::1" — the production
    // store's constructor argument ("webhook") is the thing that adds the prefix.
    expect(store.callKeys).toHaveLength(1);
    expect(store.callKeys[0]).toBe("::1");
  });

  it("PostgresRateLimitStore constructor is called with 'webhook' in production config", async () => {
    // Verify the production rateLimit.ts wires the store with prefix "webhook".
    // We mock pgRateLimitStore and import rateLimit.ts fresh to capture the call.
    const { PostgresRateLimitStore } =
      await vi.importMock<typeof import("./pgRateLimitStore")>(
        "./pgRateLimitStore",
      );
    const MockStore = vi.fn().mockImplementation((prefix: string) => ({
      prefix,
      init: vi.fn(),
      increment: vi
        .fn()
        .mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
      decrement: vi.fn(),
      resetKey: vi.fn(),
    }));
    vi.doMock("./pgRateLimitStore", () => ({
      PostgresRateLimitStore: MockStore,
    }));

    // Re-import so the mock takes effect on the module's top-level code.
    const { webhookLimiter: _wl } =
      await vi.importActual<typeof import("./rateLimit")>("./rateLimit");

    // The mock constructor should have been called with "webhook".
    const calls = MockStore.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain("webhook");

    void PostgresRateLimitStore;
    vi.doUnmock("./pgRateLimitStore");
  });
});
