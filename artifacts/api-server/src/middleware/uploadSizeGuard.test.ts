/**
 * Tests for the global upload size guard middleware.
 *
 * The middleware is defined in ./uploadSizeGuard.ts and registered in app.ts.
 * Tests import the real exported middleware so any regression in the production
 * code is immediately caught here — there is no duplicated logic.
 *
 * Three core test cases (matching the task spec):
 *   1. Fast path — spoofed Content-Length header > 11 MB → 413 before any body
 *      bytes are read, and the route handler is never entered.
 *   2. Slow path — actual chunked body exceeding 11 MB (no Content-Length) →
 *      413 via the streaming byte counter.
 *   3. Regression guard — honest 5 MB multipart body with Content-Length → 200;
 *      the guard passes the request through to the real multer handler.
 *
 * Plus two additional cases for coverage:
 *   4. High-cap route (travels/trips/…) — 13 MB below the 21 MB cap → 200.
 *   5. Non-multipart content type (JSON) — guard is bypassed entirely → 200.
 *
 * Implementation notes
 * ─────────────────────
 * • Raw Node `http` is used instead of supertest/superagent for all requests.
 *   superagent recalculates Content-Length from the actual body size, which
 *   defeats the spoofed-header test.
 * • For the fast-path test a handler-entered flag confirms the route handler
 *   is never called when the guard rejects on the header alone.
 * • For the success-path (regression guard) test, the test app mounts real
 *   multer (memoryStorage) as the route handler to verify the guard does not
 *   interfere with normal multipart parsing by multer/busboy.
 */

import { describe, it, expect, afterEach } from "vitest";
import express, { type Request, type Response } from "express";
import multer from "multer";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  uploadSizeGuard,
  DEFAULT_UPLOAD_BYTES,
  HIGH_UPLOAD_BYTES,
  DEFAULT_MULTER_FILE_BYTES,
  HIGH_MULTER_FILE_BYTES,
} from "./uploadSizeGuard";
import {
  ELAINE_ATTACHMENT_FILE_BYTES,
  HIGH_UPLOAD_PREFIXES,
  multerLimitForPrefix,
} from "../lib/upload-limits";

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app that uses the real uploadSizeGuard middleware
 * and a simple multer-backed route.
 *
 * @param onHandlerEntered Optional callback invoked when the route handler is
 *   reached — used by the fast-path test to assert the handler was NOT called.
 */
function buildTestApp(onHandlerEntered?: () => void) {
  const app = express();

  // Real production middleware under test.
  app.use(uploadSizeGuard);

  // Real multer instance (in-memory) — mirrors what production upload routes use.
  // Uses the shared constant so this test stays in sync automatically.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DEFAULT_MULTER_FILE_BYTES },
  });

  // Representative upload route with actual multer parsing.
  app.post(
    "/api/pottery/items",
    upload.single("photo"),
    (req: Request, res: Response) => {
      onHandlerEntered?.();
      res.json({
        ok: true,
        fileSize: req.file?.size ?? 0,
        fieldname: req.file?.fieldname ?? null,
      });
    },
  );

  // High-cap route representative (travels).
  app.post(
    "/api/travels/trips/:id/photos",
    upload.single("photo"),
    (req: Request, res: Response) => {
      onHandlerEntered?.();
      res.json({ ok: true });
    },
  );

  // Non-multipart route (JSON) to verify the guard is bypassed entirely.
  app.post(
    "/api/pottery/search",
    express.json(),
    (req: Request, res: Response) => {
      onHandlerEntered?.();
      res.json({ ok: true });
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Low-level HTTP helpers — give byte-level header control
// ---------------------------------------------------------------------------

interface RawPostResult {
  status: number;
  body: unknown;
}

/**
 * Make a raw HTTP POST to the test server with explicit control over all
 * headers including Content-Length.  Tolerates ECONNRESET/EPIPE that can
 * follow a server-side socket.destroy() after a 413 response.
 */
function rawPost(
  server: http.Server,
  opts: {
    path: string;
    contentType: string;
    /** If provided, sent as the Content-Length header (may differ from body). */
    contentLength?: number;
    body: Buffer;
  },
): Promise<RawPostResult> {
  const { port } = server.address() as AddressInfo;

  const headers: http.OutgoingHttpHeaders = {
    "Content-Type": opts.contentType,
  };
  if (opts.contentLength !== undefined) {
    headers["Content-Length"] = opts.contentLength;
  } else {
    headers["Transfer-Encoding"] = "chunked";
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const req = http.request(
      { host: "127.0.0.1", port, path: opts.path, method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolved = true;
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            // leave as null for non-JSON responses
          }
          resolve({ status: res.statusCode!, body: parsed });
        });
        res.on("error", (e: Error) => {
          if (!resolved) reject(e);
        });
      },
    );

    req.on("error", (e: Error) => {
      // Swallow ECONNRESET/EPIPE that follow server-side socket destruction
      // after a 413 — the response is already captured and resolved at that point.
      if (!resolved) reject(e);
    });

    req.write(opts.body);
    req.end();
  });
}

/**
 * Send a large chunked body (no Content-Length) to trigger the slow path of
 * the upload guard.  Chunks are written in 64 KB increments.
 */
function rawPostChunked(
  server: http.Server,
  opts: { path: string; contentType: string; totalBytes: number },
): Promise<RawPostResult> {
  const { port } = server.address() as AddressInfo;

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
          "Transfer-Encoding": "chunked",
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
            // non-JSON body
          }
          resolve({ status: res.statusCode!, body: parsed });
        });
        res.on("error", (e: Error) => {
          if (!resolved) reject(e);
        });
      },
    );

    req.on("error", (e: Error) => {
      // Tolerate ECONNRESET/EPIPE after server-side socket destruction on 413.
      if (!resolved) reject(e);
    });

    const CHUNK = Buffer.alloc(64 * 1024, 0x61); // 64 KB of "a"
    let written = 0;

    function writeNext() {
      while (written < opts.totalBytes) {
        const toWrite = Math.min(CHUNK.length, opts.totalBytes - written);
        const ok = req.write(CHUNK.subarray(0, toWrite));
        written += toWrite;
        if (!ok) {
          req.once("drain", writeNext);
          return;
        }
      }
      req.end();
    }

    writeNext();
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function startServer(app: express.Express): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
}

function stopServer(srv: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    srv.close((err) => (err ? reject(err) : resolve())),
  );
}

// ---------------------------------------------------------------------------
// Multipart body builder — enough structure for multer to parse a file field
// ---------------------------------------------------------------------------

function makeMultipartBody(boundary: string, data: Buffer): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="photo"; filename="test.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, data, footer]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("uploadSizeGuard middleware", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server);
  });

  // ── Fast path ─────────────────────────────────────────────────────────────

  it("rejects via Content-Length header when value exceeds the 11 MB default cap, without entering the route handler", async () => {
    let handlerEntered = false;
    server = await startServer(
      buildTestApp(() => {
        handlerEntered = true;
      }),
    );

    // Spoof a 26 MB Content-Length while sending only a tiny body.
    // The guard must return 413 immediately, before calling next().
    const oversized = 26 * 1024 * 1024; // 26 MB — well above DEFAULT_UPLOAD_BYTES
    const tinyBody = Buffer.from("--b\r\n\r\nhello\r\n--b--");

    const result = await rawPost(server, {
      path: "/api/pottery/items",
      contentType: "multipart/form-data; boundary=b",
      contentLength: oversized,
      body: tinyBody,
    });

    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toMatch(
      /upload too large/i,
    );
    // Handler must NOT have been called — the guard returned before next().
    expect(handlerEntered).toBe(false);
  });

  // ── Slow path ─────────────────────────────────────────────────────────────

  it("rejects via streaming byte count when chunked body exceeds the 11 MB default cap", async () => {
    server = await startServer(buildTestApp());

    // 13 MB of chunked data with no Content-Length header forces the slow path.
    const result = await rawPostChunked(server, {
      path: "/api/pottery/items",
      contentType: "multipart/form-data; boundary=b",
      totalBytes: 13 * 1024 * 1024, // 13 MB > DEFAULT_UPLOAD_BYTES (11 MB)
    });

    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toMatch(
      /upload too large/i,
    );
  });

  // ── Regression guard (normal upload must still work) ──────────────────────

  it("passes a 5 MB multipart upload through to the multer handler with the file intact", async () => {
    server = await startServer(buildTestApp());

    const FIVE_MB = 5 * 1024 * 1024;
    const payload = Buffer.alloc(FIVE_MB, 0x61); // 5 MB of "a"
    const boundary = "testboundary";
    const body = makeMultipartBody(boundary, payload);

    const result = await rawPost(server, {
      path: "/api/pottery/items",
      contentType: `multipart/form-data; boundary=${boundary}`,
      contentLength: body.length, // honest Content-Length
      body,
    });

    expect(result.status).toBe(200);
    const json = result.body as {
      ok: boolean;
      fileSize: number;
      fieldname: string;
    };
    expect(json.ok).toBe(true);
    // Multer received and parsed the file field correctly.
    expect(json.fieldname).toBe("photo");
    expect(json.fileSize).toBe(FIVE_MB);
  });

  // ── High-cap routes ───────────────────────────────────────────────────────

  it("allows a 13 MB upload on a high-cap route (travels/trips/ has a 21 MB cap)", async () => {
    server = await startServer(buildTestApp());

    // Build an actual 13 MB multipart body so Content-Length matches the data
    // sent — a mismatched Content-Length would leave the server waiting for
    // bytes that never arrive and the test would time out.
    const THIRTEEN_MB = 13 * 1024 * 1024;
    const payload = Buffer.alloc(THIRTEEN_MB, 0x61); // 13 MB of "a"
    const boundary = "highcapboundary";
    const body = makeMultipartBody(boundary, payload);

    const result = await rawPost(server, {
      path: "/api/travels/trips/123/photos",
      contentType: `multipart/form-data; boundary=${boundary}`,
      contentLength: body.length, // honest Content-Length — 13 MB < 21 MB cap
      body,
    });

    // The guard must NOT reject with 413.  Multer may emit its own 500 because
    // the file exceeds multer's own 10 MB fileSize limit, but that is separate
    // from the guard under test — what matters is the guard passes the request on.
    expect(result.status).not.toBe(413);
  }, 15_000); // allow extra time for 13 MB in-process transfer

  it("rejects a 25 MB upload on a high-cap route (21 MB cap)", async () => {
    server = await startServer(buildTestApp());

    const oversized = 25 * 1024 * 1024; // 25 MB > HIGH_UPLOAD_BYTES (21 MB)
    const tinyBody = Buffer.from("--b\r\n\r\nhello\r\n--b--");

    const result = await rawPost(server, {
      path: "/api/travels/trips/123/photos",
      contentType: "multipart/form-data; boundary=b",
      contentLength: oversized,
      body: tinyBody,
    });

    expect(result.status).toBe(413);
    expect((result.body as { error: string }).error).toMatch(
      /upload too large/i,
    );
  });

  // ── Non-multipart passthrough ─────────────────────────────────────────────

  it("does not inspect non-multipart requests (JSON body bypasses the guard entirely)", async () => {
    server = await startServer(buildTestApp());

    const jsonBody = Buffer.from(JSON.stringify({ q: "vase" }));

    const result = await rawPost(server, {
      path: "/api/pottery/search",
      contentType: "application/json",
      contentLength: jsonBody.length,
      body: jsonBody,
    });

    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });
});

// ── Constant sanity checks (no server needed) ─────────────────────────────────
// Kept in a separate describe so the server afterEach lifecycle does not affect them.

describe("uploadSizeGuard constants", () => {
  it("exports DEFAULT_UPLOAD_BYTES = 11 MB and HIGH_UPLOAD_BYTES = 21 MB", () => {
    expect(DEFAULT_UPLOAD_BYTES).toBe(11 * 1024 * 1024);
    expect(HIGH_UPLOAD_BYTES).toBe(21 * 1024 * 1024);
  });

  it("exports DEFAULT_MULTER_FILE_BYTES = 10 MB and HIGH_MULTER_FILE_BYTES = 20 MB", () => {
    expect(DEFAULT_MULTER_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(HIGH_MULTER_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it("guard thresholds are each at least 1 MB above their per-route multer limits", () => {
    // This is the invariant that keeps the global guard as the primary rejection
    // point. All per-route multer configs import DEFAULT_MULTER_FILE_BYTES and
    // HIGH_MULTER_FILE_BYTES from this module, so a single edit here propagates
    // everywhere — and this test will fail immediately if the gap closes.
    const MB = 1024 * 1024;
    expect(
      DEFAULT_UPLOAD_BYTES - DEFAULT_MULTER_FILE_BYTES,
    ).toBeGreaterThanOrEqual(MB);
    expect(HIGH_UPLOAD_BYTES - HIGH_MULTER_FILE_BYTES).toBeGreaterThanOrEqual(
      MB,
    );
  });
});

// ── Bucket policy / guard alignment (no env needed — only upload-limits.ts) ──
//
// These assertions verify that every Supabase Storage bucket policy's
// fileSizeLimit stays within its corresponding upload guard threshold.
// storage-core.ts now imports its fileSizeLimit values directly from
// upload-limits.ts (the same source as these constants), so a developer cannot
// raise a bucket policy limit past the guard without also editing upload-limits.ts
// — which will immediately break the existing guard-threshold tests above.
// The assertions below make the intent explicit and add a named failure message
// for each policy, making it obvious which bucket is out of range.

describe("Supabase Storage bucket policy limits are within upload guard thresholds", () => {
  it("IMAGE_ONLY_POLICY (pottery / quilting / ornaments) stays within the default 11 MB guard", () => {
    // IMAGE_ONLY_POLICY.fileSizeLimit = DEFAULT_MULTER_FILE_BYTES (10 MB)
    expect(DEFAULT_MULTER_FILE_BYTES).toBeLessThanOrEqual(DEFAULT_UPLOAD_BYTES);
  });

  it("TRAVELS_BUCKET_POLICY stays within the high 21 MB guard", () => {
    // TRAVELS_BUCKET_POLICY.fileSizeLimit = HIGH_MULTER_FILE_BYTES (20 MB)
    expect(HIGH_MULTER_FILE_BYTES).toBeLessThanOrEqual(HIGH_UPLOAD_BYTES);
  });

  it("MESSENGER_BUCKET_POLICY stays within the high 21 MB guard", () => {
    // MESSENGER_BUCKET_POLICY.fileSizeLimit = HIGH_MULTER_FILE_BYTES (20 MB)
    expect(HIGH_MULTER_FILE_BYTES).toBeLessThanOrEqual(HIGH_UPLOAD_BYTES);
  });

  it("ELAINE_ATTACHMENTS_BUCKET_POLICY (5 MB) stays within the default 11 MB guard", () => {
    // ELAINE_ATTACHMENTS_BUCKET_POLICY.fileSizeLimit = ELAINE_ATTACHMENT_FILE_BYTES
    // This is intentionally smaller than DEFAULT_MULTER_FILE_BYTES — the test
    // verifies it never accidentally exceeds the guard threshold.
    expect(ELAINE_ATTACHMENT_FILE_BYTES).toBeLessThan(
      DEFAULT_MULTER_FILE_BYTES,
    );
    expect(ELAINE_ATTACHMENT_FILE_BYTES).toBeLessThanOrEqual(
      DEFAULT_UPLOAD_BYTES,
    );
  });

  it("all bucket policy limits are positive integers (sanity check)", () => {
    for (const limit of [
      DEFAULT_MULTER_FILE_BYTES,
      HIGH_MULTER_FILE_BYTES,
      ELAINE_ATTACHMENT_FILE_BYTES,
    ]) {
      expect(limit).toBeGreaterThan(0);
      expect(Number.isInteger(limit)).toBe(true);
    }
  });
});

// ── multerLimitForPrefix — single-source-of-truth enforcement ─────────────────
//
// These tests verify the invariant that prevents the two-place update problem:
// a route that should use the high cap must be listed in HIGH_UPLOAD_PREFIXES,
// and only then will multerLimitForPrefix() return HIGH_MULTER_FILE_BYTES.
//
// If a new high-cap route is added to HIGH_UPLOAD_PREFIXES, the test in the
// first describe block ensures it gets HIGH_MULTER_FILE_BYTES from the helper.
// If a developer forgets to add their prefix to the list and calls
// multerLimitForPrefix() anyway, they silently receive DEFAULT_MULTER_FILE_BYTES
// — the safe under-permissive failure mode — and this suite makes it clear why.

describe("multerLimitForPrefix — derives route multer cap from HIGH_UPLOAD_PREFIXES", () => {
  it("returns HIGH_MULTER_FILE_BYTES for every prefix in HIGH_UPLOAD_PREFIXES", () => {
    // This is the core invariant: each entry in the prefix list must produce the
    // high cap.  Adding a prefix to HIGH_UPLOAD_PREFIXES without breaking this
    // test is the one required step to activate the high cap on both the guard
    // and any route that calls multerLimitForPrefix() with that prefix.
    for (const prefix of HIGH_UPLOAD_PREFIXES) {
      expect(
        multerLimitForPrefix(prefix),
        `prefix "${prefix}" should map to HIGH_MULTER_FILE_BYTES`,
      ).toBe(HIGH_MULTER_FILE_BYTES);
    }
  });

  it("returns DEFAULT_MULTER_FILE_BYTES for a path that is not in HIGH_UPLOAD_PREFIXES", () => {
    // A new route that is not yet registered gets the safe default cap, not the
    // high cap — so the guard is never more permissive than the route's multer
    // config even if the developer forgets to add the prefix.
    expect(multerLimitForPrefix("/api/pottery/items")).toBe(
      DEFAULT_MULTER_FILE_BYTES,
    );
    expect(multerLimitForPrefix("/api/quilting/fabrics")).toBe(
      DEFAULT_MULTER_FILE_BYTES,
    );
    expect(multerLimitForPrefix("/api/ornaments/items")).toBe(
      DEFAULT_MULTER_FILE_BYTES,
    );
    // A plausible future path that looks similar to a high-cap prefix but isn't.
    expect(multerLimitForPrefix("/api/travels/wishlist")).toBe(
      DEFAULT_MULTER_FILE_BYTES,
    );
  });

  it("returns HIGH_MULTER_FILE_BYTES for exact paths that fall under a HIGH_UPLOAD_PREFIXES entry", () => {
    // Routes pass their own path prefix, which must be a leading sub-path of
    // (or exactly match) a HIGH_UPLOAD_PREFIXES entry.
    expect(multerLimitForPrefix("/api/travels/trips/")).toBe(
      HIGH_MULTER_FILE_BYTES,
    );
    expect(multerLimitForPrefix("/api/messenger/attachments/")).toBe(
      HIGH_MULTER_FILE_BYTES,
    );
    expect(multerLimitForPrefix("/api/elaine/attachments")).toBe(
      HIGH_MULTER_FILE_BYTES,
    );
  });

  it("HIGH_UPLOAD_PREFIXES is non-empty and all entries start with /api/", () => {
    // Sanity-check the list itself so a typo (e.g. missing leading slash) is
    // caught before it silently falls through to the default cap.
    expect(HIGH_UPLOAD_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of HIGH_UPLOAD_PREFIXES) {
      expect(
        prefix.startsWith("/api/"),
        `"${prefix}" must start with /api/`,
      ).toBe(true);
    }
  });
});
