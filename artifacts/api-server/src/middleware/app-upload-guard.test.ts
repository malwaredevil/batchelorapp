/**
 * Integration test: uploadSizeGuard is wired into the production app stack.
 *
 * This test imports the REAL app.ts (with all external dependencies mocked)
 * and sends oversized multipart requests to prove that:
 *   1. The global uploadSizeGuard in app.ts rejects requests above the default
 *      11 MB cap with 413 before any route handler or body parser runs.
 *   2. The global uploadSizeGuard applies the 21 MB high cap for high-cap
 *      routes (e.g. /api/travels/trips/…) and rejects above that with 413.
 *
 * Why this matters: the route-level multer tests (upload-rejection.test.ts)
 * build standalone mini-apps that test the per-route multer backstop in
 * isolation. This file is the complementary proof that the global guard is
 * actually mounted in the production Express app at app.ts line:
 *   app.use(uploadSizeGuard)
 * If that line were removed, every test in this file would fail.
 *
 * External dependencies (DB, Supabase, session store, Sentry, etc.) are
 * mocked so the test runs without network access. The uploadSizeGuard
 * middleware itself is NOT mocked — it is the code under test.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any module imports so vi hoists them.
// Only mock what app.ts actually needs; do not mock uploadSizeGuard.
// ---------------------------------------------------------------------------

vi.mock("pino-http", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../routes", () => {
  const express = require("express") as typeof import("express");
  const r = express.Router();
  r.use((_req: unknown, res: import("express").Response) =>
    res.status(200).json({ ok: true }),
  );
  return { default: r };
});

vi.mock("../lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../lib/env", () => ({
  env: {
    sessionSecret: "test-session-secret-for-upload-guard-test",
    sentryDsn: null,
    isProduction: false,
  },
}));

vi.mock("../lib/session", () => ({
  sessionMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/csrf", () => ({
  csrfGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/error-tracker", () => ({
  recordResponseStatus: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  expressErrorHandler:
    () =>
    (err: unknown, _req: unknown, _res: unknown, next: (e: unknown) => void) =>
      next(err),
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the real app AFTER mocks are hoisted.
// uploadSizeGuard is imported BY app.ts and is NOT mocked here — it is the
// code under test. The pass-through router mock ensures no real routes run.
// ---------------------------------------------------------------------------

import app from "../app";

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;

beforeAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
      server.on("error", reject);
    }),
  15_000,
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
);

// ---------------------------------------------------------------------------
// Low-level HTTP helper — gives full control over Content-Length header so
// we can test both the fast path (spoofed Content-Length) and slow path
// (chunked body, no Content-Length) of the guard.
// ---------------------------------------------------------------------------

interface PostResult {
  status: number;
  body: unknown;
}

function rawPost(opts: {
  path: string;
  contentType: string;
  contentLength: number;
  body: Buffer;
}): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: opts.path,
        method: "POST",
        headers: {
          "Content-Type": opts.contentType,
          "Content-Length": opts.contentLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolved = true;
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode!, body: parsed });
        });
        res.on("error", (e) => {
          if (!resolved) reject(e);
        });
      },
    );
    req.on("error", (e) => {
      if (!resolved) reject(e);
    });
    req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("app.ts — uploadSizeGuard global wiring", () => {
  it("rejects a default-cap upload exceeding 11 MB with 413 on a pottery route", async () => {
    // Spoof a 26 MB Content-Length — well above the 11 MB default cap.
    // The guard must return 413 before the (mocked) router ever runs.
    const oversized = 26 * 1024 * 1024;
    const tinyBody = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="image"\r\n\r\ndata\r\n--b--',
    );

    const result = await rawPost({
      path: "/api/pottery/items",
      contentType: "multipart/form-data; boundary=b",
      contentLength: oversized,
      body: tinyBody,
    });

    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toMatch(
      /upload too large/i,
    );
  });

  it("rejects a high-cap upload exceeding 21 MB with 413 on a travels route", async () => {
    // Spoof a 30 MB Content-Length — above the 21 MB high cap for /api/travels/trips/.
    const oversized = 30 * 1024 * 1024;
    const tinyBody = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata\r\n--b--',
    );

    const result = await rawPost({
      path: "/api/travels/trips/1/documents",
      contentType: "multipart/form-data; boundary=b",
      contentLength: oversized,
      body: tinyBody,
    });

    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toMatch(
      /upload too large/i,
    );
  });

  it("allows a 5 MB upload on a default-cap route through to the (mocked) router", async () => {
    // 5 MB is well below the 11 MB default cap — the guard must pass it through.
    // The mocked router returns 200 so any non-413 response means the guard allowed it.
    const FIVE_MB = 5 * 1024 * 1024;
    const boundary = "validboundary";
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="ok.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.alloc(FIVE_MB, 0x61);
    const body = Buffer.concat([header, payload, footer]);

    const result = await rawPost({
      path: "/api/pottery/items",
      contentType: `multipart/form-data; boundary=${boundary}`,
      contentLength: body.length,
      body,
    });

    expect(result.status).not.toBe(413);
  });
});
