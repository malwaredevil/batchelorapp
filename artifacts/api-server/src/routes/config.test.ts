/**
 * Tests for PUT /api/config/:module/:key — type-based server-side validation
 * and cache-bust behaviour.
 *
 * The route must:
 *  1. Reject values that don't match the row's stored `type` field (integer,
 *     float, boolean) with a 400, so a mistyped value can never silently
 *     persist and break a downstream AI call.
 *  2. Return the *updated* value in the response body — not the stale cached
 *     value that was there before the PUT.
 *  3. Invalidate the in-memory cache so the very next read (e.g. a GET) goes
 *     straight to the DB and sees the new value with no perceptible delay.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  createDbMockWithBootstrap,
  queueBootstrapOrphanCheck,
} from "../test-helpers/db-mock";

// ── Shared call-capture state ────────────────────────────────────────────────
//
// createDbMockWithBootstrap() wires together:
//  - dbMock       — Drizzle-style mock passed to vi.mock("@workspace/db")
//  - selectQueue  — push row arrays here to drive sequential db.select() calls
//  - updateCalls  — records db.update().set({ value, ... }) calls; bootstrap
//                   label/description-only syncs are filtered out automatically
//                   (see test-helpers/db-mock.ts for the full explanation)
const { dbMock, selectQueue, updateCalls } = createDbMockWithBootstrap();

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: dbMock };
});

vi.mock("../middleware/auth", () => ({
  requireAuth: (
    req: { session: { userId?: number } },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    next();
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const OWNER_USER = { id: 99, isOwner: true };
const NON_OWNER_USER = { id: 88, isOwner: false };

async function buildApp(asOwner = true): Promise<Express> {
  const { default: router } = await import("./config");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: asOwner ? OWNER_USER.id : NON_OWNER_USER.id,
    };
    next();
  });
  app.use("/api/config", router);
  return app;
}

/**
 * Prime the selectQueue with the responses needed for a PUT call:
 *  1. appUsers select (owner check)
 *  2. bootstrapDefaults() orphan-check select — must be present on every cold
 *     module call; see test-helpers/db-mock.ts for the full explanation of why.
 *  3. appConfig select inside getAllRows() — fills the in-memory cache so
 *     getConfigRow() can find the row the PUT handler needs for type lookup.
 *
 * getAllRows() runs a DB query only when the cache is cold. Because each test
 * calls vi.resetModules() in beforeEach, the module-level _bootstrapped flag
 * is always false, so bootstrapDefaults() always runs on the first getAllRows()
 * call, consuming its own select before the cache-fill select fires.
 *
 * Note: Step 3 (label-sync drift check) calls db.select().from(appConfig) with
 * no .where() or .orderBy() — makeSelectBuilder's .then() terminator handles
 * this by returning [] without consuming a queue slot (see db-mock.ts). Step 3
 * therefore sees an empty currentRows (no stale label updates), then Step 4
 * runs its db.update() calls to clear customisedAt, and bootstrapDefaults()
 * completes with _bootstrapStatus = 'success'.
 */
function queueOwnerAndRow(row: {
  module: string;
  key: string;
  type: string;
  value: string;
}) {
  selectQueue.push([OWNER_USER]);
  queueBootstrapOrphanCheck(selectQueue);
  selectQueue.push([
    {
      id: 1,
      module: row.module,
      key: row.key,
      value: row.value,
      type: row.type,
      label: "Test label",
      description: null,
      updatedAt: new Date(),
    },
  ]);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  selectQueue.length = 0;
  updateCalls.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

// ── bootstrapDefaults step coverage ──────────────────────────────────────────
//
// These tests verify that all three bootstrap steps (Step 1: delete orphans,
// Step 2: insert defaults, Step 3: update stale labels) are exercised by the
// mock so that a future regression (e.g. db.delete never called) is caught
// immediately rather than silently passing.
//
// They also verify the error-level escalation behaviour introduced alongside
// the step-coverage fix: an unexpected JS error (one that has neither a
// Node-network code nor a PG SQLSTATE code) must be logged at `error` level,
// not merely `warn`.

describe("bootstrapDefaults — step coverage and error classification", () => {
  it("calls db.delete, db.insert, and db.update during bootstrap", async () => {
    // Prime the select queue so getAllRows() gets the result it needs after
    // bootstrapDefaults() runs.  bootstrapDefaults itself does not need a
    // select result — it only deletes, inserts, and updates.
    selectQueue.push([]);

    const { getConfig } = await import("../lib/app-config");
    // Any getConfig call will trigger getAllRows() → bootstrapDefaults() on a
    // cold cache (vi.resetModules() guarantees cold state per test).
    await getConfig("openrouter", "request_timeout_ms", 12000);

    // Step 1 — DELETE orphaned rows
    expect(dbMock.delete).toHaveBeenCalledTimes(1);
    // Step 2 — INSERT defaults (onConflictDoNothing)
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    // Step 3 — UPDATE stale labels (one call per APP_CONFIG_DEFAULTS entry)
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("logs at warn level (not error) for a DB connectivity error", async () => {
    // Make db.delete throw a Node-style network error (code = ECONNREFUSED)
    // which is classified as a connectivity error (non-fatal).
    dbMock.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
    });

    selectQueue.push([]);

    const { logger } = await import("../lib/logger");
    const { getConfig } = await import("../lib/app-config");
    await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0);
    expect((logger.error as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      0,
    );
  });

  it("logs at error level for an unexpected JS error (not DB connectivity)", async () => {
    // Throw a plain TypeError — no `code` property, not a network error.
    // bootstrapDefaults must escalate this to logger.error rather than
    // silently swallowing it as a non-fatal connectivity issue.
    dbMock.delete.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of null (reading 'map')");
    });

    selectQueue.push([]);

    const { logger } = await import("../lib/logger");
    const { getConfig } = await import("../lib/app-config");
    await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(
      (logger.error as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("getBootstrapStatus returns 'success' after a clean bootstrap", async () => {
    selectQueue.push([]);

    const { getConfig, getBootstrapStatus } = await import("../lib/app-config");
    await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(getBootstrapStatus()).toBe("success");
  });

  it("getBootstrapStatus returns 'warn' after a DB connectivity error", async () => {
    dbMock.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
      });
    });

    selectQueue.push([]);

    const { getConfig, getBootstrapStatus } = await import("../lib/app-config");
    await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(getBootstrapStatus()).toBe("warn");
  });

  it("getBootstrapStatus returns 'error' after an unexpected JS error", async () => {
    dbMock.delete.mockImplementationOnce(() => {
      throw new RangeError("Invalid array length");
    });

    selectQueue.push([]);

    const { getConfig, getBootstrapStatus } = await import("../lib/app-config");
    await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(getBootstrapStatus()).toBe("error");
  });
});

// ── integer type ─────────────────────────────────────────────────────────────

describe("PUT /api/config — integer type validation", () => {
  it("accepts a valid positive integer string", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "5000" });

    expect(res.status).toBe(200);
  });

  it("accepts zero for an integer field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "0" });

    expect(res.status).toBe(200);
  });

  it("rejects a negative integer", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "-500" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative integer/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a decimal (float) string for an integer field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "1.5" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative integer/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a non-numeric string for an integer field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "banana" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative integer/i);
    expect(updateCalls).toHaveLength(0);
  });
});

// ── float type ───────────────────────────────────────────────────────────────

describe("PUT /api/config — float type validation", () => {
  it("accepts a valid float string", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "1.5" });

    expect(res.status).toBe(200);
  });

  it("accepts an integer string for a float field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "2" });

    expect(res.status).toBe(200);
  });

  it("rejects a non-numeric string for a float field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "banana" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid number/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a negative float value", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "-0.5" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative/i);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects a numeric-prefix string like "1abc" for a float field', async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "1abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid number/i);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects a malformed multi-decimal string like "1.2.3" for a float field', async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "1.2.3" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid number/i);
    expect(updateCalls).toHaveLength(0);
  });
});

// ── boolean type ─────────────────────────────────────────────────────────────

describe("PUT /api/config — boolean type validation", () => {
  it('accepts "true" for a boolean field', async () => {
    queueOwnerAndRow({
      module: "elaine",
      key: "enabled",
      type: "boolean",
      value: "false",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/elaine/enabled")
      .send({ value: "true" });

    expect(res.status).toBe(200);
  });

  it('accepts "false" for a boolean field', async () => {
    queueOwnerAndRow({
      module: "elaine",
      key: "enabled",
      type: "boolean",
      value: "true",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/elaine/enabled")
      .send({ value: "false" });

    expect(res.status).toBe(200);
  });

  it('rejects "yes" for a boolean field', async () => {
    queueOwnerAndRow({
      module: "elaine",
      key: "enabled",
      type: "boolean",
      value: "true",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/elaine/enabled")
      .send({ value: "yes" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"true" or "false"/i);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects "1" for a boolean field', async () => {
    queueOwnerAndRow({
      module: "elaine",
      key: "enabled",
      type: "boolean",
      value: "true",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/elaine/enabled")
      .send({ value: "1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"true" or "false"/i);
    expect(updateCalls).toHaveLength(0);
  });
});

// ── string type ──────────────────────────────────────────────────────────────

describe("PUT /api/config — string type validation", () => {
  it("accepts any string value for a string-typed field", async () => {
    queueOwnerAndRow({
      module: "elaine",
      key: "greeting",
      type: "string",
      value: "Hello",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/elaine/greeting")
      .send({ value: "banana or whatever 🎉" });

    expect(res.status).toBe(200);
  });
});

// ── GET /api/config — authentication ─────────────────────────────────────────

async function buildAppUnauthenticated(): Promise<Express> {
  const { default: router } = await import("./config");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // No userId — simulates a request with no session cookie
    (req as unknown as { session: Record<string, unknown> }).session = {};
    next();
  });
  app.use("/api/config", router);
  return app;
}

describe("GET /api/config — authentication", () => {
  it("returns 401 for an unauthenticated request (no session)", async () => {
    const app = await buildAppUnauthenticated();

    const res = await request(app).get("/api/config");

    expect(res.status).toBe(401);
  });

  it("returns 200 with config data for a valid non-owner session", async () => {
    // bootstrapDefaults() runs on module import and calls getAllConfig() once
    // (consuming the first queue entry). The subsequent GET handler call
    // consumes the second. Push two identical row-sets so both reads succeed.
    const configRow = {
      id: 1,
      module: "openrouter",
      key: "request_timeout_ms",
      value: "12000",
      type: "integer",
      label: "Request timeout (ms)",
      description: null,
      updatedAt: new Date(),
    };
    selectQueue.push([configRow]);
    selectQueue.push([configRow]);
    const app = await buildApp(false); // non-owner session

    const res = await request(app).get("/api/config");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.config)).toBe(true);
    expect(res.body.config.length).toBeGreaterThan(0);
    expect(res.body.config[0]).toMatchObject({
      module: "openrouter",
      key: "request_timeout_ms",
    });
  });
});

// ── non-owner and missing body ────────────────────────────────────────────────

describe("PUT /api/config — access control and body validation", () => {
  it("returns 403 when the authenticated user is not an owner", async () => {
    // The route does a DB lookup after session auth to check isOwner.
    // A non-owner session must be rejected before any DB write occurs.
    selectQueue.push([NON_OWNER_USER]);
    const app = await buildApp(false);

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "9000" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
    // No DB write should have happened.
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a non-string value body", async () => {
    selectQueue.push([OWNER_USER]);
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: 12000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  it("returns 404 when the key does not exist", async () => {
    selectQueue.push([OWNER_USER]);
    selectQueue.push([]);
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/nonexistent_key")
      .send({ value: "12000" });

    expect(res.status).toBe(404);
  });
});

// ── integer edge cases ────────────────────────────────────────────────────────

describe("PUT /api/config — integer edge cases", () => {
  it("rejects an empty string for an integer field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative integer/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a whitespace-only string for an integer field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative integer/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("accepts a very large integer string (> MAX_SAFE_INTEGER) and stores it as-is", async () => {
    // Values beyond Number.MAX_SAFE_INTEGER still satisfy `^[0-9]+$` and
    // Number.isFinite, so the PUT succeeds.  getConfig() will return a JS
    // float that may lose integer precision for such values — that is
    // acceptable because no real config field uses numbers that large.
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "99999999999999999999" });

    expect(res.status).toBe(200);
    // The stored string must be echoed back verbatim in the response body.
    expect(res.body.config.value).toBe("99999999999999999999");
  });
});

// ── float edge cases ──────────────────────────────────────────────────────────

describe("PUT /api/config — float edge cases", () => {
  it("rejects an empty string for a float field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid number/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a whitespace-only string for a float field", async () => {
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid number/i);
    expect(updateCalls).toHaveLength(0);
  });

  it("accepts a float with many decimal places and stores it as-is", async () => {
    // JavaScript floats have finite precision (~15 significant digits).
    // The value is stored as a raw string in the DB, so there is no precision
    // loss at the storage layer — getConfig() will return parseFloat of the
    // exact string.  A long-but-valid decimal should sail through validation.
    queueOwnerAndRow({
      module: "openrouter",
      key: "temperature",
      type: "float",
      value: "0.7",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/temperature")
      .send({ value: "0.123456789012345" });

    expect(res.status).toBe(200);
    expect(res.body.config.value).toBe("0.123456789012345");
  });
});

// ── getConfig round-trip type coercion ────────────────────────────────────────
//
// These unit tests call getConfig() directly (bypassing the HTTP layer) to
// confirm that a string stored in the DB is coerced to the correct JS type
// before being returned to the caller.  The specific concern is:
//   - a numeric fallback must receive a number, never a string or NaN
//   - a boolean fallback must receive a boolean, never a string
//   - a string fallback receives the raw stored string
//   - if a malformed value somehow exists in the DB, getConfig() falls back
//     to the caller's default rather than returning NaN / an unusable value

describe("getConfig — round-trip type coercion", () => {
  function makeConfigRow(
    module: string,
    key: string,
    value: string,
    type: string,
  ) {
    return {
      id: 1,
      module,
      key,
      value,
      type,
      label: "Test label",
      description: null,
      updatedAt: new Date(),
    };
  }

  it("returns a JS number (not a string) when the fallback is numeric", async () => {
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([
      makeConfigRow("openrouter", "request_timeout_ms", "5000", "integer"),
    ]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("openrouter", "request_timeout_ms", 12000);

    expect(typeof result).toBe("number");
    expect(result).toBe(5000);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("returns a JS number for a valid float string when the fallback is numeric", async () => {
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([
      makeConfigRow("openrouter", "temperature", "0.5", "float"),
    ]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("openrouter", "temperature", 0.7);

    expect(typeof result).toBe("number");
    expect(result).toBe(0.5);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('returns true (boolean) when the stored value is "true"', async () => {
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([makeConfigRow("elaine", "enabled", "true", "boolean")]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("elaine", "enabled", false);

    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it('returns false (boolean) when the stored value is "false"', async () => {
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([makeConfigRow("elaine", "enabled", "false", "boolean")]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("elaine", "enabled", true);

    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  it("returns the stored string verbatim for a string-type row", async () => {
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([
      makeConfigRow("elaine", "greeting", "Hello world!", "string"),
    ]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("elaine", "greeting", "default");

    expect(typeof result).toBe("string");
    expect(result).toBe("Hello world!");
  });

  it("falls back to the default (not NaN) when a malformed empty-string value is in the DB", async () => {
    // This is a regression-guard test: validateConfigValue now rejects empty
    // strings for integer and float fields at the HTTP boundary, so a value
    // of "" should never reach the DB.  But if it ever does (e.g. through a
    // direct DB write or a future gap), getConfig() must return the caller's
    // fallback rather than NaN, so callers do not have to guard against NaN.
    selectQueue.push([]); // bootstrapDefaults orphan check
    selectQueue.push([
      makeConfigRow("openrouter", "request_timeout_ms", "", "integer"),
    ]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("openrouter", "request_timeout_ms", 12000);

    // parseFloat("") === NaN, so the fallback (12000) must be returned.
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(12000);
  });

  it("falls back to the default when the row does not exist", async () => {
    selectQueue.push([]); // empty result set — key not found

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("openrouter", "nonexistent_key", 9999);

    expect(result).toBe(9999);
  });

  it("returns parsed number with no precision loss for a normal float string", async () => {
    // Confirm that the string "0.123456789012345" round-trips through
    // parseFloat without losing value relative to what Number() would give.
    const stored = "0.123456789012345";
    selectQueue.push([]); // bootstrapDefaults orphan check — no orphaned rows
    selectQueue.push([
      makeConfigRow("openrouter", "temperature", stored, "float"),
    ]);

    const { getConfig } = await import("../lib/app-config");
    const result = await getConfig("openrouter", "temperature", 0.7);

    expect(result).toBe(parseFloat(stored));
    expect(Number.isNaN(result)).toBe(false);
  });
});

// ── customised_at tracking ────────────────────────────────────────────────────
//
// updateConfigValue sets `customised_at` to the current timestamp when the new
// value differs from the APP_CONFIG_DEFAULTS default, and clears it to NULL
// when the admin resets the field back to the default.  The Control Panel uses
// this column to show a "customised" badge only on intentional overrides.

describe("PUT /api/config — customised_at tracking", () => {
  it("sets customised_at (non-null) when writing a non-default value", async () => {
    // Default for openrouter/request_timeout_ms is "12000"; writing "5000"
    // is a deliberate override → customised_at should be stamped.
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "5000" });

    expect(res.status).toBe(200);
    // updateConfigValue must have been called exactly once (no spurious calls
    // from the bootstrapDefaults label-sync step, which sets only label /
    // description and must not appear in updateCalls).
    expect(updateCalls).toHaveLength(1);
    // customised_at must be a non-null timestamp in the response body.
    expect(res.body.config.customisedAt).not.toBeNull();
    expect(typeof res.body.config.customisedAt).toBe("string");
  });

  it("clears customised_at (null) when resetting to the default value", async () => {
    // Writing the default value back ("12000") should clear the override stamp.
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "5000", // currently overridden
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "12000" }); // same as APP_CONFIG_DEFAULTS default

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    // customised_at must be null because the value is back at its default.
    expect(res.body.config.customisedAt).toBeNull();
  });
});

// ── cache-bust behaviour ──────────────────────────────────────────────────────
//
// After a successful PUT, the response body must contain the *new* value and
// the in-memory cache must be cleared so the very next read hits the DB.
// This ensures a Control Panel change takes effect immediately — no 30-second
// wait for the TTL to expire.

describe("PUT /api/config — cache-bust behaviour", () => {
  it("response body contains the updated value, not the pre-update cached value", async () => {
    // Seed: owner check + existing config row (type lookup).
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    const app = await buildApp();

    const res = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "5000" });

    expect(res.status).toBe(200);
    // The response must echo back the value the caller just wrote ("5000"),
    // not the stale pre-update value ("12000") that was in the DB before.
    expect(res.body.config.value).toBe("5000");
  });

  it("a GET immediately after a PUT re-queries the DB (cache was invalidated)", async () => {
    // Sequence of DB select results:
    //  1. Owner check (PUT)
    //  2. getAllRows() inside getConfigRow() — warms the cache with old value
    //  3. getAllRows() inside getAllConfig() for the subsequent GET — must be a
    //     fresh DB hit because updateConfigValue() calls invalidateConfigCache().
    queueOwnerAndRow({
      module: "openrouter",
      key: "request_timeout_ms",
      type: "integer",
      value: "12000",
    });
    // Result 3: fresh rows returned after cache is cleared by the PUT.
    selectQueue.push([
      {
        id: 1,
        module: "openrouter",
        key: "request_timeout_ms",
        value: "5000",
        type: "integer",
        label: "Test label",
        description: null,
        updatedAt: new Date(),
      },
    ]);

    const app = await buildApp();

    // PUT should succeed and clear the cache.
    const putRes = await request(app)
      .put("/api/config/openrouter/request_timeout_ms")
      .send({ value: "5000" });
    expect(putRes.status).toBe(200);

    // Immediate GET — must re-query the DB (selectQueue entry 3 above),
    // returning the freshly-written value with zero delay.
    const getRes = await request(app).get("/api/config/openrouter");
    expect(getRes.status).toBe(200);

    const updatedRow = (
      getRes.body.config as Array<{ key: string; value: string }>
    ).find((r) => r.key === "request_timeout_ms");
    expect(updatedRow?.value).toBe("5000");
  });
});
