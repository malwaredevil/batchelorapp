/**
 * Global upload size guard middleware.
 *
 * Runs before all body parsers and multer, providing a first-line rejection
 * of oversized multipart/form-data requests via two complementary paths:
 *
 *   Fast path  — Content-Length header present and over limit → 413 before
 *                any body bytes are read from the socket.
 *
 *   Slow path  — No Content-Length (chunked Transfer-Encoding): count bytes
 *                as they flow in and respond 413 as soon as the running total
 *                crosses the cap, then destroy the socket so the transfer is
 *                aborted client-side.
 *
 * Limits are route-aware so the global guard is the PRIMARY rejection point
 * and per-route multer fileSize limits remain a secondary backstop:
 *   • default  11 MB  → routes with a 10 MB multer limit (pottery, ornaments…)
 *   • high cap 21 MB  → routes with a 20 MB multer limit (travels, elaine, messenger)
 *
 * Path prefixes for the high cap are matched against req.path, which includes
 * the full "/api/…" prefix at app.use() level.
 *
 * The canonical list of high-cap prefixes lives in upload-limits.ts
 * (HIGH_UPLOAD_PREFIXES) so that route files can call multerLimitForPrefix()
 * and derive their per-route multer cap from the same list — making the prefix
 * list the single source of truth for both the guard threshold and the per-route
 * multer configuration.
 */

import type { Request, Response, NextFunction } from "express";

// Re-export from the shared upload-limits module so all existing imports from
// this file continue to work without changes.  The canonical values live in
// upload-limits.ts so they can also be imported by lib/storage-core.ts without
// creating a lib → middleware layering violation.
export {
  DEFAULT_MULTER_FILE_BYTES,
  HIGH_MULTER_FILE_BYTES,
  ELAINE_ATTACHMENT_FILE_BYTES,
  HIGH_UPLOAD_PREFIXES,
  multerLimitForPrefix,
} from "../lib/upload-limits";

import { HIGH_UPLOAD_PREFIXES } from "../lib/upload-limits";

/** Guard threshold for standard routes — 1 MB above DEFAULT_MULTER_FILE_BYTES. */
export const DEFAULT_UPLOAD_BYTES = 11 * 1024 * 1024; // 11 MB

/** Guard threshold for high-cap routes — 1 MB above HIGH_MULTER_FILE_BYTES. */
export const HIGH_UPLOAD_BYTES = 21 * 1024 * 1024; // 21 MB

export function uploadSizeGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Normalise to lowercase — MIME types are case-insensitive.
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    next();
    return;
  }

  const limitBytes = HIGH_UPLOAD_PREFIXES.some((p) => req.path.startsWith(p))
    ? HIGH_UPLOAD_BYTES
    : DEFAULT_UPLOAD_BYTES;

  const cl = parseInt(req.headers["content-length"] ?? "", 10);
  const hasUsableContentLength = !Number.isNaN(cl) && cl >= 0;

  if (hasUsableContentLength) {
    // Fast path: Content-Length present — reject before any body read.
    // When within limit: call next() immediately with NO data listeners so
    // we never race multer/busboy for chunks.
    if (cl > limitBytes) {
      req.log?.warn(
        { contentLength: cl, limitBytes, path: req.path },
        "upload-size-guard: rejected via Content-Length",
      );
      res.set("Connection", "close");
      res.status(413).json({
        error: `Upload too large. Maximum file size is ${limitBytes / (1024 * 1024)} MB.`,
      });
      return;
    }
    next();
    return;
  }

  // Slow path: chunked Transfer-Encoding or missing Content-Length.
  // Only reached for requests without a usable Content-Length header —
  // attaching "data" listeners here does not race multer on normal uploads.
  let received = 0;
  let aborted = false;

  const cleanup = () => {
    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
  };

  const onData = (chunk: Buffer) => {
    received += chunk.length;
    if (received > limitBytes && !aborted) {
      aborted = true;
      cleanup();
      req.log?.warn(
        { receivedBytes: received, limitBytes, path: req.path },
        "upload-size-guard: rejected via byte count",
      );
      if (!res.headersSent) {
        res.set("Connection", "close");
        res.status(413).json({
          error: `Upload too large. Maximum file size is ${limitBytes / (1024 * 1024)} MB.`,
        });
        // Destroy the socket after the response is flushed so the 413 reaches
        // the client before the connection is torn down.
        res.on("finish", () => req.socket?.destroy());
      }
    }
  };

  const onEnd = cleanup;

  req.on("data", onData);
  req.on("end", onEnd);
  next();
}
