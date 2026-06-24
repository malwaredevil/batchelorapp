import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

// ── Widget slot types ─────────────────────────────────────────────────────────
type StaticSlot = { t: "s"; id: string };
type RssSlot = { t: "r"; iid: string; title: string; url: string };
type WidgetSlot = StaticSlot | RssSlot;

const SlotSchema = z.union([
  z.object({ t: z.literal("s"), id: z.string().max(64) }),
  z.object({
    t: z.literal("r"),
    iid: z.string().max(64),
    title: z.string().max(128),
    url: z.string().max(512),
  }),
]);

const PreferencesBody = z.object({
  slots: z.array(SlotSchema).max(60),
});

function parseStoredSlots(raw: string): WidgetSlot[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 0) return [];
    // Legacy format: string[]
    if (typeof parsed[0] === "string") {
      return (parsed as string[]).map((id) => ({ t: "s" as const, id }));
    }
    // New format: WidgetSlot[]
    return parsed.filter((item): item is WidgetSlot => {
      if (typeof item !== "object" || item === null) return false;
      const s = item as Record<string, unknown>;
      if (s["t"] === "s") return typeof s["id"] === "string";
      if (s["t"] === "r")
        return typeof s["iid"] === "string" && typeof s["url"] === "string";
      return false;
    });
  } catch {
    return null;
  }
}

// ── Preferences ───────────────────────────────────────────────────────────────
router.get("/hub/preferences", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  try {
    const [user] = await db
      .select({ hubWidgetIds: appUsers.hubWidgetIds })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const slots = user.hubWidgetIds ? parseStoredSlots(user.hubWidgetIds) : null;
    res.json({ slots });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch hub preferences");
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/hub/preferences", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = PreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  try {
    await db
      .update(appUsers)
      .set({ hubWidgetIds: JSON.stringify(parsed.data.slots) })
      .where(eq(appUsers.id, userId));

    res.json({ slots: parsed.data.slots });
  } catch (err) {
    req.log.error({ err }, "Failed to save hub preferences");
    res.status(500).json({ error: "Server error" });
  }
});

// ── RSS proxy ─────────────────────────────────────────────────────────────────
function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
    return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  return false;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractText(raw: string): string {
  const cdataMatch = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdataMatch) return cdataMatch[1].trim();
  return unescapeHtml(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseRss(xml: string): {
  feedTitle: string;
  items: Array<{ title: string; link: string; pubDate: string; description: string }>;
} {
  const feedTitleMatch = xml.match(
    /<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/,
  );
  const feedTitle = feedTitleMatch ? extractText(feedTitleMatch[1]) : "RSS Feed";

  // Handle both RSS <item> and Atom <entry>
  const tagRe = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
  const itemMatches = [...xml.matchAll(tagRe)];

  const items = itemMatches.slice(0, 8).map((m) => {
    const item = m[1];
    const titleRaw =
      item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "";
    // RSS uses <link>, Atom uses <link href="..."/>
    const linkRaw =
      item.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ??
      item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ??
      "";
    const pubDateRaw =
      item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1] ??
      item.match(/<published[^>]*>([\s\S]*?)<\/published>/)?.[1] ??
      item.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1] ??
      "";
    const descRaw =
      item.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1] ??
      item.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ??
      "";
    return {
      title: extractText(titleRaw).slice(0, 200),
      link: extractText(linkRaw).trim().slice(0, 500),
      pubDate: pubDateRaw.trim().slice(0, 100),
      description: extractText(descRaw).slice(0, 300),
    };
  });

  return { feedTitle, items };
}

function formatRelativeDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw.slice(0, 16);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

router.get("/hub/rss", requireAuth, async (req, res) => {
  const rawUrl = typeof req.query["url"] === "string" ? req.query["url"] : null;
  if (!rawUrl) {
    res.status(400).json({ error: "url query param required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are allowed" });
    return;
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    res.status(400).json({ error: "Internal addresses are not allowed" });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Batchelor/1.0 RSS Reader",
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      res.status(502).json({ error: `Feed returned HTTP ${response.status}` });
      return;
    }

    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
      res.status(413).json({ error: "Feed response too large (max 2 MB)" });
      return;
    }

    const xml = await response.text();
    if (xml.length > MAX_BYTES) {
      res.status(413).json({ error: "Feed response too large (max 2 MB)" });
      return;
    }
    if (!xml.includes("<item") && !xml.includes("<entry")) {
      res
        .status(422)
        .json({ error: "URL does not appear to be a valid RSS/Atom feed" });
      return;
    }

    const result = parseRss(xml);
    // Add formatted relative dates
    const enriched = {
      feedTitle: result.feedTitle,
      items: result.items.map((item) => ({
        ...item,
        relativeDate: formatRelativeDate(item.pubDate),
      })),
    };

    res.json(enriched);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      res.status(504).json({ error: "Feed timed out after 10 seconds" });
      return;
    }
    req.log.error({ err }, "RSS proxy error");
    res.status(502).json({ error: "Failed to fetch feed" });
  }
});

// ── Weather config ────────────────────────────────────────────────────────────
const WeatherConfigBody = z.object({
  city: z.string().max(200),
  country: z.string().max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  unit: z.enum(["celsius", "fahrenheit"]),
});

router.get("/hub/weather-config", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  try {
    const [user] = await db
      .select({ hubWeatherConfig: appUsers.hubWeatherConfig })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let config = null;
    if (user.hubWeatherConfig) {
      try {
        config = JSON.parse(user.hubWeatherConfig) as unknown;
      } catch {
        config = null;
      }
    }

    res.json({ config });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch weather config");
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/hub/weather-config", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = WeatherConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  try {
    await db
      .update(appUsers)
      .set({ hubWeatherConfig: JSON.stringify(parsed.data) })
      .where(eq(appUsers.id, userId));

    res.json({ config: parsed.data });
  } catch (err) {
    req.log.error({ err }, "Failed to save weather config");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
