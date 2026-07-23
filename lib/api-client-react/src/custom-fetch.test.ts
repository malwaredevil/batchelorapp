/**
 * Unit tests for getUploadErrorMessage.
 *
 * This function is the client-side bridge between a 413 HTTP response from the
 * server and the toast message shown to the user.  The server returns:
 *
 *   HTTP 413  { "error": "File is too large. Please upload a smaller file." }
 *
 * or, from the global upload size guard:
 *
 *   HTTP 413  { "error": "Upload too large. Maximum file size is 10 MB." }
 *
 * getUploadErrorMessage must surface that exact message so users see
 * actionable text ("too large") rather than a generic "Something went wrong".
 *
 * These tests exercise the full chain: a real ApiError is constructed from a
 * mock Response whose body matches the server's production JSON shape, then
 * getUploadErrorMessage is called with it and the output is asserted.
 */

import { describe, it, expect } from "vitest";
import { ApiError, getUploadErrorMessage } from "./custom-fetch";

// ---------------------------------------------------------------------------
// Helpers — build ApiError instances that mirror real server responses
// ---------------------------------------------------------------------------

function make413Error(body: Record<string, unknown>): ApiError {
  const bodyJson = JSON.stringify(body);
  const response = new Response(bodyJson, {
    status: 413,
    statusText: "Payload Too Large",
    headers: { "Content-Type": "application/json" },
  });
  return new ApiError(response, body, {
    method: "POST",
    url: "/api/pottery/items",
  });
}

function makeOtherError(status: number, body: Record<string, unknown>): ApiError {
  const bodyJson = JSON.stringify(body);
  const response = new Response(bodyJson, {
    status,
    statusText: "Error",
    headers: { "Content-Type": "application/json" },
  });
  return new ApiError(response, body, {
    method: "POST",
    url: "/api/pottery/items",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getUploadErrorMessage — 413 responses", () => {
  it("surfaces the server 'error' field verbatim for multer LIMIT_FILE_SIZE (pottery / quilting / ornaments)", () => {
    // This is the exact body shape returned by app.ts when multer hits
    // LIMIT_FILE_SIZE: { error: "File is too large. Please upload a smaller file." }
    const err = make413Error({
      error: "File is too large. Please upload a smaller file.",
    });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("File is too large. Please upload a smaller file.");
    expect(msg).toMatch(/too large/i);
  });

  it("surfaces the server 'error' field verbatim for the global uploadSizeGuard (default 10 MB cap)", () => {
    // uploadSizeGuard returns: { error: "Upload too large. Maximum file size is 10 MB." }
    const err = make413Error({
      error: "Upload too large. Maximum file size is 10 MB.",
    });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("Upload too large. Maximum file size is 10 MB.");
    expect(msg).toMatch(/too large/i);
    expect(msg).toMatch(/10 MB/);
  });

  it("surfaces the server 'error' field for the high-cap uploadSizeGuard (20 MB, travels / elaine)", () => {
    const err = make413Error({
      error: "Upload too large. Maximum file size is 20 MB.",
    });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("Upload too large. Maximum file size is 20 MB.");
    expect(msg).toMatch(/too large/i);
    expect(msg).toMatch(/20 MB/);
  });

  it("uses 'message' field when 'error' is absent (alternative server response shape)", () => {
    const err = make413Error({ message: "File is too large." });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("File is too large.");
    expect(msg).toMatch(/too large/i);
  });

  it("falls back to the built-in message when the 413 body has no usable field", () => {
    const err = make413Error({});

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("File too large — please upload a smaller file.");
    expect(msg).toMatch(/too large/i);
  });

  it("falls back to the built-in message when the 413 body fields are empty strings", () => {
    const err = make413Error({ error: "", message: "" });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("File too large — please upload a smaller file.");
    expect(msg).toMatch(/too large/i);
  });

  it("falls back to the built-in message when the 413 body is null", () => {
    const response = new Response("{}", {
      status: 413,
      statusText: "Payload Too Large",
      headers: { "Content-Type": "application/json" },
    });
    const err = new ApiError(response, null, {
      method: "POST",
      url: "/api/quilting/fabrics",
    });

    const msg = getUploadErrorMessage(err);

    expect(msg).toBe("File too large — please upload a smaller file.");
    expect(msg).toMatch(/too large/i);
  });
});

describe("getUploadErrorMessage — non-413 responses", () => {
  it("returns the ApiError message for a 400 validation error", () => {
    const err = makeOtherError(400, { error: "Invalid file type." });

    const msg = getUploadErrorMessage(err);

    // Non-413 ApiErrors surface the error's own .message, which buildErrorMessage
    // assembles from the response status + body fields.
    expect(msg).toContain("HTTP 400");
    expect(msg).toContain("Invalid file type.");
  });

  it("returns the fallback for a plain Error with no message", () => {
    const err = Object.assign(new Error(), { message: "" });
    const msg = getUploadErrorMessage(err, "Upload failed. Please try again.");
    expect(msg).toBe("Upload failed. Please try again.");
  });

  it("returns a plain Error's message when present", () => {
    const err = new Error("Network error");
    const msg = getUploadErrorMessage(err);
    expect(msg).toBe("Network error");
  });

  it("returns the custom fallback for unknown error types", () => {
    const msg = getUploadErrorMessage("not an error", "Custom fallback.");
    expect(msg).toBe("Custom fallback.");
  });

  it("uses the default fallback when no custom fallback is provided and error is unknown", () => {
    const msg = getUploadErrorMessage(null);
    expect(msg).toBe("Upload failed. Please try again.");
  });
});
