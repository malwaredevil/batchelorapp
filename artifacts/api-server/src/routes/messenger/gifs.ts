import { Router, type IRouter } from "express";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const GIPHY_BASE = "https://api.giphy.com/v1/gifs";
/** Household app — keep the picker to clean content regardless of who's using it. */
const RATING = "g";
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

interface GiphyImageVariant {
  url: string;
  width: string;
  height: string;
}

interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_width: GiphyImageVariant;
    fixed_height_small: GiphyImageVariant;
  };
}

interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

function toGifResult(g: GiphyGif): GifResult {
  const full = g.images.fixed_width;
  const preview = g.images.fixed_height_small ?? full;
  return {
    id: g.id,
    title: g.title || "GIF",
    previewUrl: preview.url,
    url: full.url,
    width: Number(full.width) || 0,
    height: Number(full.height) || 0,
  };
}

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

router.get("/gifs/trending", async (req, res) => {
  if (!env.giphyApiKey) {
    res.status(503).json({ error: "GIF search is not configured" });
    return;
  }
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  try {
    const params = new URLSearchParams({
      api_key: env.giphyApiKey,
      limit: String(limit),
      offset: String(offset),
      rating: RATING,
    });
    const resp = await fetch(`${GIPHY_BASE}/trending?${params}`);
    if (!resp.ok) {
      res.status(502).json({ error: "GIPHY request failed" });
      return;
    }
    const json = (await resp.json()) as { data: GiphyGif[] };
    res.json({ results: json.data.map(toGifResult) });
  } catch (err) {
    logger.error(err, "messenger: gif trending failed");
    res.status(502).json({ error: "GIPHY request failed" });
  }
});

router.get("/gifs/search", async (req, res) => {
  if (!env.giphyApiKey) {
    res.status(503).json({ error: "GIF search is not configured" });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  try {
    const params = new URLSearchParams({
      api_key: env.giphyApiKey,
      q,
      limit: String(limit),
      offset: String(offset),
      rating: RATING,
    });
    const resp = await fetch(`${GIPHY_BASE}/search?${params}`);
    if (!resp.ok) {
      res.status(502).json({ error: "GIPHY request failed" });
      return;
    }
    const json = (await resp.json()) as { data: GiphyGif[] };
    res.json({ results: json.data.map(toGifResult) });
  } catch (err) {
    logger.error(err, "messenger: gif search failed");
    res.status(502).json({ error: "GIPHY request failed" });
  }
});

export default router;
