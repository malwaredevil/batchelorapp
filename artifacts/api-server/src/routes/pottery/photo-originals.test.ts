import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import createPhotoOriginalRoutes from "./photo-originals";

describe("pottery original route input validation", () => {
  it.each([
    "/items/7/photos/invalid/original-info",
    "/items/-1/photos/primary/original-info",
    "/items/7/photos/-1/original",
    "/items/7/photos/999999999999999999999/original-info",
    "/items/7/photos/2147483648/original-info",
    "/items/2147483648/photos/primary/original-info",
  ])("returns a safe 400 rather than a server error for %s", async (path) => {
    const app = express();
    app.use(createPhotoOriginalRoutes(vi.fn()));
    const result = await request(app).get(path);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid pottery photo reference." });
  });
});
