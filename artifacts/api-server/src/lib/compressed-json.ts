import type { Request, Response } from "express";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const compress = promisify(gzip);
const COMPRESSION_MIN_BYTES = 16 * 1024;

/**
 * Compress large JSON responses without changing their public shape. Kept
 * opt-in for catalog reads: do not buffer streams or compress auth responses.
 * Express negotiates quality values, including an explicit gzip;q=0.
 */
export async function sendCompressedJson(
  req: Request,
  res: Response,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json);
  res.vary("Accept-Encoding");
  if (
    bytes >= COMPRESSION_MIN_BYTES &&
    req.acceptsEncodings("gzip", "identity") === "gzip"
  ) {
    const compressed = await compress(json);
    res.set("Content-Encoding", "gzip");
    res.type("application/json").send(compressed);
    return;
  }
  res.type("application/json").send(json);
}
