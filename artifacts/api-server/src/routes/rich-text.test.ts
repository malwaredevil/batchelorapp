import express from "express";
import type { Session, SessionData } from "express-session";
import request from "supertest";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, appUsers: {} }));
vi.mock("../lib/env", () => ({ env: { isProduction: true } }));
vi.mock("../lib/sentry", () => ({ Sentry: { setUser: vi.fn() } }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../lib/rich-text-storage", () => ({
  uploadRichTextImage: vi.fn(),
}));

import router from "./rich-text";
import { uploadRichTextImage } from "../lib/rich-text-storage";

function createApp(userId?: number) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = (userId ? { userId } : {}) as Session & SessionData;
    next();
  });
  app.use("/api/rich-text", router);
  return app;
}

describe("rich-text upload authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadRichTextImage).mockResolvedValue(
      "https://storage.example.test/signed/image.png",
    );
  });

  it("rejects anonymous multipart uploads without an Origin before storage", async () => {
    const response = await request(createApp())
      .post("/api/rich-text/upload-image")
      .attach("file", Buffer.from("image data"), {
        filename: "image.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(uploadRichTextImage).not.toHaveBeenCalled();
  });

  it("rejects anonymous requests before even parsing malformed multipart bodies", async () => {
    const response = await request(createApp())
      .post("/api/rich-text/upload-image")
      .set("Content-Type", "multipart/form-data")
      .send("missing boundary");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(uploadRichTextImage).not.toHaveBeenCalled();
  });

  it("preserves authenticated image processing and signed URL responses", async () => {
    const image = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();
    const response = await request(createApp(1))
      .post("/api/rich-text/upload-image")
      .attach("file", image, {
        filename: "image.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      url: "https://storage.example.test/signed/image.png",
    });
    expect(uploadRichTextImage).toHaveBeenCalledExactlyOnceWith(
      expect.any(Buffer),
      "image/png",
      "image.png",
    );
  });

  it("preserves missing-file validation for authenticated users", async () => {
    const response = await request(createApp(1)).post(
      "/api/rich-text/upload-image",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "file is required" });
    expect(uploadRichTextImage).not.toHaveBeenCalled();
  });
});
