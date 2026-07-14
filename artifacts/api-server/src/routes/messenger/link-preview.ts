import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, messengerLinkPreviews } from "@workspace/db";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const PREVIEW_TIMEOUT_MS = 6000;

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
}

async function fetchPreview(url: string): Promise<{
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Batchelor/1.0 (link preview bot)" },
    });
    clearTimeout(timeout);
    if (!resp.ok) return { title: null, description: null, imageUrl: null };
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html"))
      return { title: null, description: null, imageUrl: null };
    const html = await resp.text();
    const title =
      extractMeta(html, "og:title") ??
      extractMeta(html, "twitter:title") ??
      extractTitle(html);
    const description =
      extractMeta(html, "og:description") ??
      extractMeta(html, "twitter:description");
    const imageUrl =
      extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");
    return { title, description, imageUrl };
  } catch (err) {
    clearTimeout(timeout);
    logger.warn({ url, err }, "messenger: link preview fetch failed");
    return { title: null, description: null, imageUrl: null };
  }
}

router.get("/link-preview", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are supported" });
    return;
  }

  const cached = await db
    .select()
    .from(messengerLinkPreviews)
    .where(eq(messengerLinkPreviews.url, url))
    .limit(1);

  if (cached[0]) {
    res.json({
      url: cached[0].url,
      title: cached[0].title,
      description: cached[0].description,
      imageUrl: cached[0].imageUrl,
    });
    return;
  }

  const preview = await fetchPreview(url);

  const [row] = await db
    .insert(messengerLinkPreviews)
    .values({
      url,
      title: preview.title,
      description: preview.description,
      imageUrl: preview.imageUrl,
    })
    .onConflictDoUpdate({
      target: messengerLinkPreviews.url,
      set: {
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        fetchedAt: new Date(),
      },
    })
    .returning();

  res.json({
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
  });
});

export default router;
