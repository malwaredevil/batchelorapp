import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sendCompressedJson } from "./compressed-json";

const app = express();
const collection = {
  items: Array.from({ length: 200 }, (_, id) => ({
    id,
    name: `Pottery ${id}`,
    patternDescription: "Detailed pottery description. ".repeat(40),
  })),
};
app.get("/large", async (req, res) => {
  await sendCompressedJson(req, res, collection);
});
app.get("/small", async (req, res) => {
  await sendCompressedJson(req, res, { items: [] });
});

describe("opt-in catalog JSON compression", () => {
  it("substantially reduces transfer size while preserving the entire JSON result", async () => {
    const result = await request(app)
      .get("/large")
      .set("Accept-Encoding", "gzip");
    expect(result.status).toBe(200);
    expect(result.headers["content-encoding"]).toBe("gzip");
    expect(result.headers.vary).toContain("Accept-Encoding");
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.body).toEqual(collection);
    expect(Number(result.headers["content-length"])).toBeLessThan(
      Buffer.byteLength(JSON.stringify(collection)) / 5,
    );
  });

  it.each(["identity", "gzip;q=0, identity", "gzip;q=0.2, identity;q=1"])(
    "respects clients that prefer uncompressed responses: %s",
    async (encoding) => {
      const result = await request(app)
        .get("/large")
        .set("Accept-Encoding", encoding);
      expect(result.headers["content-encoding"]).toBeUndefined();
      expect(result.body).toEqual(collection);
    },
  );

  it("does not waste compression on small responses", async () => {
    const result = await request(app)
      .get("/small")
      .set("Accept-Encoding", "gzip");
    expect(result.headers["content-encoding"]).toBeUndefined();
    expect(result.body).toEqual({ items: [] });
  });
});
