import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { env } from "../env";

export const HALLMARK_EVENTS_URL =
  "https://www.hallmark.com/keepsake-ornament-events/";

const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v2";
const REQUEST_TIMEOUT_MS = 45_000;

const StructuredEvent = z.object({
  sourceKey: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  startDate: z.string().min(1).max(40),
  endDate: z.string().min(1).max(40),
  details: z.string().max(2_000).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
});

const StructuredResponse = z.object({
  events: z.array(StructuredEvent).default([]),
  pageYear: z.number().int().min(2000).max(2100).optional(),
});

const SupportedSourceKey = z.enum(["ornament-premiere", "ornament-debut"]);

const HALLMARK_EVENT_SCHEMA = {
  type: "object",
  properties: {
    pageYear: { type: "integer" },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceKey: { type: "string" },
          title: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          details: { type: "string" },
          year: { type: "integer" },
        },
        required: ["sourceKey", "title", "startDate", "endDate"],
      },
    },
  },
  required: ["events"],
} as const;

const HALLMARK_EVENT_JSON_FORMAT = {
  type: "json",
  schema: HALLMARK_EVENT_SCHEMA,
  prompt:
    "Extract only official Hallmark Keepsake event windows from this page. Include Ornament Premiere and Ornament Debut as events. Exclude artist signings, store-specific signings, product launches, and general announcements. Return the published month/day range exactly, the event category as a stable sourceKey, the page year, and brief supporting details.",
  checkPromptInjection: true,
} as const;

export interface HallmarkEventCandidate {
  sourceKey: string;
  title: string;
  startDate: string;
  endDate: string;
  details: string | null;
  sourceUrl: string;
  year: number;
}

export interface HallmarkRejectedCandidate {
  sourceKey?: string;
  title?: string;
  reason: string;
}

export interface HallmarkEventsSourceResult {
  sourceUrl: string;
  fetchedAt: string;
  fingerprint: string;
  complete: boolean;
  year: number | null;
  candidates: HallmarkEventCandidate[];
  rejected: HallmarkRejectedCandidate[];
}

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    json?: unknown;
    url?: string;
    metadata?: { sourceURL?: string };
  };
  error?: string;
}

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

async function firecrawlRequest(
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<FirecrawlResponse> {
  if (!env.firecrawlApiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured");
  }
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${FIRECRAWL_API_BASE}${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.firecrawlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        fetchImpl,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    const payload = (await response
      .json()
      .catch(() => ({}))) as FirecrawlResponse;
    if (response.ok && payload.success !== false) return payload;
    lastError = new Error(
      `Firecrawl ${path} failed with HTTP ${response.status}: ${
        payload.error ?? "unknown error"
      }`,
    );
    if (response.status < 500 && response.status !== 429) {
      throw lastError;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error(`Firecrawl ${path} failed`);
}

function normalizeDash(value: string): string {
  return value
    .replace(/[–—−]/g, "-")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDatePart(
  value: string,
  defaults: { month?: number; year?: number } = {},
): { month: number; day: number; year: number } | null {
  const normalized = normalizeDash(value);
  const isoMatch = /^(20\d{2})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
  }
  const numericMatch = /^(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?$/.exec(
    normalized,
  );
  if (numericMatch) {
    const parsedYear = numericMatch[3]
      ? Number(numericMatch[3])
      : defaults.year;
    if (!parsedYear) return null;
    return {
      year: parsedYear,
      month: Number(numericMatch[1]),
      day: Number(numericMatch[2]),
    };
  }
  const match =
    /^(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,2})(?:,\s*(20\d{2}))?$/i.exec(
      normalized,
    );
  if (!match) return null;
  const parsedYear = match[3] ? Number(match[3]) : defaults.year;
  const parsedMonth = match[1]
    ? new Date(`${match[1]} 1, ${parsedYear ?? 2000} UTC`).getUTCMonth() + 1
    : defaults.month;
  if (!parsedYear || !parsedMonth) return null;
  return { year: parsedYear, month: parsedMonth, day: Number(match[2]) };
}

function parseDateRange(
  startValue: string,
  endValue: string,
  year: number | undefined,
): { startDate: string; endDate: string; year: number } | null {
  const start = parseDatePart(startValue, { year });
  if (!start) return null;
  const end = parseDatePart(endValue, {
    month: start.month,
    year: start.year,
  });
  if (!end) return null;
  const startDate = `${start.year}-${String(start.month).padStart(2, "0")}-${String(
    start.day,
  ).padStart(2, "0")}`;
  const endDate = `${end.year}-${String(end.month).padStart(2, "0")}-${String(
    end.day,
  ).padStart(2, "0")}`;
  const startDateValue = new Date(`${startDate}T00:00:00Z`);
  const endDateValue = new Date(`${endDate}T00:00:00Z`);
  if (
    Number.isNaN(startDateValue.getTime()) ||
    Number.isNaN(endDateValue.getTime()) ||
    startDateValue.getUTCDate() !== start.day ||
    endDateValue.getUTCDate() !== end.day ||
    endDateValue < startDateValue
  ) {
    return null;
  }
  return { startDate, endDate, year: start.year };
}

function yearFromMarkdown(markdown: string): number | undefined {
  const match = /\b(20\d{2})\b/.exec(markdown);
  return match ? Number(match[1]) : undefined;
}

function sourceKeyForEvent(event: z.infer<typeof StructuredEvent>): string {
  const normalized = event.sourceKey.toLowerCase().replace(/[^a-z-]/g, "");
  if (normalized.includes("premiere")) return "ornament-premiere";
  if (normalized.includes("debut")) return "ornament-debut";
  const title = event.title.toLowerCase();
  if (title.includes("premiere")) return "ornament-premiere";
  if (title.includes("debut")) return "ornament-debut";
  return normalized;
}

function titleForSourceKey(sourceKey: string, fallback: string): string {
  if (sourceKey === "ornament-premiere") {
    return "Hallmark Keepsake Ornament Premiere";
  }
  if (sourceKey === "ornament-debut") {
    return "Hallmark Keepsake Ornament Debut";
  }
  return fallback.trim();
}

function parseStructured(
  payload: FirecrawlResponse,
  sourceUrl: string,
): HallmarkEventsSourceResult {
  const markdown = payload.data?.markdown ?? "";
  const rawJson = payload.data?.json;
  const parsed = StructuredResponse.safeParse(rawJson);
  const pageYear = parsed.success
    ? parsed.data.pageYear
    : yearFromMarkdown(markdown);
  const candidates: HallmarkEventCandidate[] = [];
  const rejected: HallmarkRejectedCandidate[] = [];

  for (const rawEvent of parsed.success ? parsed.data.events : []) {
    const sourceKey = sourceKeyForEvent(rawEvent);
    const supported = SupportedSourceKey.safeParse(sourceKey).success;
    if (!supported) {
      rejected.push({
        sourceKey,
        title: rawEvent.title,
        reason: "Unsupported event category",
      });
      continue;
    }
    const dateRange = parseDateRange(
      rawEvent.startDate,
      rawEvent.endDate,
      rawEvent.year ?? pageYear,
    );
    if (!dateRange) {
      rejected.push({
        sourceKey,
        title: rawEvent.title,
        reason: "Invalid or incomplete date range",
      });
      continue;
    }
    candidates.push({
      sourceKey: `${sourceKey}:${dateRange.year}`,
      title: titleForSourceKey(sourceKey, rawEvent.title),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      details: rawEvent.details?.trim() || null,
      sourceUrl,
      year: dateRange.year,
    });
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ markdown, json: rawJson ?? null }))
    .digest("hex");
  const years = new Set(candidates.map((candidate) => candidate.year));
  const sourceKeys = new Set(
    candidates.map((candidate) => candidate.sourceKey.split(":")[0]),
  );
  const requiredEventsPresent =
    sourceKeys.has("ornament-premiere") && sourceKeys.has("ornament-debut");
  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    fingerprint,
    complete:
      requiredEventsPresent &&
      candidates.length === 2 &&
      sourceKeys.size === candidates.length &&
      years.size === 1,
    year: years.size === 1 ? [...years][0] : (pageYear ?? null),
    candidates,
    rejected,
  };
}

async function scrapeUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<HallmarkEventsSourceResult> {
  const payload = await firecrawlRequest(
    "/scrape",
    {
      url,
      onlyMainContent: true,
      formats: ["markdown", HALLMARK_EVENT_JSON_FORMAT],
    },
    fetchImpl,
  );
  return parseStructured(payload, url);
}

/**
 * Scrape the canonical source first. If it moves or its structure changes,
 * Firecrawl search is used only to locate the new official Hallmark page; the
 * returned result is still parsed through the same strict schema.
 */
export async function fetchHallmarkEventsSource(
  fetchImpl: typeof fetch = fetch,
): Promise<HallmarkEventsSourceResult> {
  let canonicalError: unknown;
  try {
    const result = await scrapeUrl(HALLMARK_EVENTS_URL, fetchImpl);
    if (result.candidates.length > 0) return result;
    canonicalError = new Error(
      "Hallmark event source returned no supported event windows",
    );
  } catch (error) {
    canonicalError = error;
  }

  const fallback = await firecrawlRequest(
    "/search",
    {
      query:
        "site:hallmark.com Keepsake Ornament Premiere Ornament Debut events",
      limit: 5,
      scrapeOptions: {
        onlyMainContent: true,
        formats: ["markdown", HALLMARK_EVENT_JSON_FORMAT],
      },
    },
    fetchImpl,
  );
  const results = Array.isArray(
    (fallback.data as { web?: unknown[] } | undefined)?.web,
  )
    ? ((fallback.data as { web: unknown[] }).web as FirecrawlResponse["data"][])
    : [];
  for (const result of results) {
    const url = result?.metadata?.sourceURL ?? result?.url;
    if (!url || !/^https:\/\/(?:www\.)?hallmark\.com\//i.test(url)) continue;
    const parsed = parseStructured({ success: true, data: result }, url);
    if (parsed.candidates.length > 0) return parsed;
  }
  throw canonicalError instanceof Error
    ? canonicalError
    : new Error("Hallmark event source returned no supported event windows");
}

export function parseHallmarkEventsForTest(
  payload: unknown,
  sourceUrl = HALLMARK_EVENTS_URL,
): HallmarkEventsSourceResult {
  return parseStructured(
    { success: true, data: payload as FirecrawlResponse["data"] },
    sourceUrl,
  );
}
