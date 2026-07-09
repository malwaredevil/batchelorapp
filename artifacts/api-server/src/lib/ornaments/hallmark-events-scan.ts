/**
 * AI auto-discovery of upcoming major Hallmark ornament/collector events
 * (Keepsake Ornament Premiere, Ornament Debut / "Ornament Days", the annual
 * Collector's Club convention, etc).
 *
 * Pipeline:
 *  1. Live web search (Perplexity Sonar via webSearch()) across a handful of
 *     targeted queries to gather current, cited source text.
 *  2. Multi-model consensus extraction: the combined search text is handed to
 *     `callFusion()`, which runs 2+ independent model opinions in parallel
 *     plus a judge/synthesis pass (see ai-client.ts). This is the explicit
 *     "multiple AI calls for consensus/verification on dates" step — a date
 *     only survives into the final list if the panel converges on it (or the
 *     judge picks the best-supported single opinion when they don't).
 *  3. Application-level de-duplication against existing
 *     ornaments_hallmark_events rows, keyed by (startDate, endDate) rather
 *     than title: the AI rewords the same real-world event differently on
 *     every run (e.g. "Artist Signing - Jacksonville, FL" vs "2026 Hallmark
 *     Artist Signing Event – Jacksonville, FL"), so a title-based key
 *     silently let hundreds of reworded duplicates through in practice. Two
 *     genuinely distinct events essentially never share an exact
 *     (startDate, endDate) pair, so this is both simpler and far more
 *     robust than trying to fuzzy-match titles.
 *  4. Insert new rows and best-effort mirror to the shared Hallmark Google
 *     Calendar via the same syncHallmarkEventToGoogle() helper the CRUD
 *     routes use.
 *
 * Best-effort throughout: any stage failing logs and returns a zero-result
 * summary rather than throwing, so this is always safe to call from the
 * monthly scheduler or the manual "Scan now" route.
 */
import { asc, eq } from "drizzle-orm";
import { db, ornamentsHallmarkEvents } from "@workspace/db";
import { webSearch } from "../web-search";
import { callFusion } from "../ai-client";
import { syncHallmarkEventToGoogle } from "./hallmark-calendar-sync";
import { shouldRunScheduledTask } from "../scheduler-guard";
import { logger } from "../logger";

const SEARCH_QUERIES = [
  "Hallmark Keepsake Ornament Premiere event dates and locations this year and next year",
  "Hallmark Ornament Debut Days dates this year and next year",
  "Hallmark Keepsake Ornament Collector's Club convention dates this year and next year",
  "upcoming Hallmark Gold Crown ornament collector events and open house dates",
];

interface DiscoveredEvent {
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
}

function parseAiJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(stripped);
}

function isValidIsoDate(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Gathers current web search results for each targeted query. Best-effort
 * per query — one failing query (timeout, no results) doesn't sink the scan.
 */
async function gatherSearchContext(): Promise<string> {
  const sections: string[] = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const result = await webSearch(query);
      if (result.answer) {
        const citations =
          result.citations.length > 0
            ? `\nSources: ${result.citations.join(", ")}`
            : "";
        sections.push(`Q: ${query}\nA: ${result.answer}${citations}`);
      }
    } catch (err) {
      logger.warn(
        { err, query },
        "hallmark-events-scan: web search query failed",
      );
    }
  }
  return sections.join("\n\n---\n\n");
}

/**
 * Multi-model consensus extraction pass. Each panel model independently
 * reads the same search context and proposes a structured event list; the
 * fusion judge then reconciles them into one final list, dropping dates the
 * panel couldn't agree on rather than guessing.
 */
async function extractEventsWithConsensus(
  searchContext: string,
): Promise<DiscoveredEvent[]> {
  if (!searchContext.trim()) return [];

  const buildMessages = () => [
    {
      role: "system" as const,
      content:
        "You are extracting a precise, dated event calendar for a Hallmark ornament collector household from raw web search results. Only include an event if you have a specific, well-supported start date. If sources disagree or a date is vague (e.g. only a month, or a past year with no confirmed recurrence), omit it rather than guessing. Do not invent events not present in the source text.",
    },
    {
      role: "user" as const,
      content: `Web search results about upcoming Hallmark ornament/collector events:\n\n${searchContext}\n\nExtract every specific, dated event (Keepsake Ornament Premiere, Ornament Debut Days, Collector's Club convention, Gold Crown store open houses/sale events, etc). Return ONLY valid JSON in this exact shape, with no extra text:\n{\n  "events": [\n    {\n      "title": "Short event title",\n      "description": "1-2 sentence description or null",\n      "startDate": "YYYY-MM-DD or null if not confidently known",\n      "endDate": "YYYY-MM-DD or same as startDate if single-day or unknown"\n    }\n  ]\n}\nIf no dated events are found, return {"events": []}.`,
    },
  ];

  let raw: string;
  try {
    raw = await callFusion(buildMessages, {
      maxTokens: 1500,
      responseFormatJson: true,
    });
  } catch (err) {
    logger.warn(
      { err },
      "hallmark-events-scan: consensus extraction call failed",
    );
    return [];
  }

  if (!raw) return [];

  try {
    const parsed = parseAiJson(raw) as { events?: DiscoveredEvent[] };
    if (!Array.isArray(parsed.events)) return [];
    return parsed.events
      .filter(
        (e): e is DiscoveredEvent =>
          typeof e?.title === "string" && e.title.trim().length > 0,
      )
      .filter((e) => isValidIsoDate(e.startDate))
      .map((e) => ({
        title: e.title.trim(),
        description:
          typeof e.description === "string" && e.description.trim()
            ? e.description.trim()
            : null,
        startDate: e.startDate,
        endDate: isValidIsoDate(e.endDate) ? e.endDate : e.startDate,
      }));
  } catch (err) {
    logger.warn(
      { err, raw },
      "hallmark-events-scan: failed to parse consensus extraction JSON",
    );
    return [];
  }
}

export interface HallmarkEventScanResult {
  searched: number;
  discovered: number;
  created: number;
  skippedDuplicates: number;
}

/**
 * Runs the full discovery pipeline and inserts any genuinely new events,
 * mirroring each to the shared Hallmark Google Calendar when configured.
 * Best-effort: never throws.
 */
export async function scanForHallmarkEvents(): Promise<HallmarkEventScanResult> {
  const zero: HallmarkEventScanResult = {
    searched: SEARCH_QUERIES.length,
    discovered: 0,
    created: 0,
    skippedDuplicates: 0,
  };

  let searchContext: string;
  try {
    searchContext = await gatherSearchContext();
  } catch (err) {
    logger.error({ err }, "hallmark-events-scan: search stage failed");
    return zero;
  }

  const discovered = await extractEventsWithConsensus(searchContext);
  if (discovered.length === 0) return zero;

  const existing = await db
    .select({
      startDate: ornamentsHallmarkEvents.startDate,
      endDate: ornamentsHallmarkEvents.endDate,
    })
    .from(ornamentsHallmarkEvents)
    .orderBy(asc(ornamentsHallmarkEvents.startDate));

  const existingKeys = new Set(
    existing.map((r) => `${r.startDate}::${r.endDate}`),
  );

  let created = 0;
  let skippedDuplicates = 0;

  for (const event of discovered) {
    if (!isValidIsoDate(event.startDate) || !isValidIsoDate(event.endDate)) {
      continue;
    }
    const key = `${event.startDate}::${event.endDate}`;
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    existingKeys.add(key);

    try {
      const [row] = await db
        .insert(ornamentsHallmarkEvents)
        .values({
          userId: null,
          title: event.title,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
        })
        .returning();
      if (!row) continue;

      const googleEventId = await syncHallmarkEventToGoogle("create", {
        title: row.title,
        description: row.description,
        startDate: row.startDate,
        endDate: row.endDate,
        googleEventId: null,
      });
      if (googleEventId) {
        await db
          .update(ornamentsHallmarkEvents)
          .set({ googleEventId })
          .where(eq(ornamentsHallmarkEvents.id, row.id));
      }
      created += 1;
    } catch (err) {
      logger.warn(
        { err, title: event.title },
        "hallmark-events-scan: failed to insert discovered event",
      );
    }
  }

  logger.info(
    {
      searched: SEARCH_QUERIES.length,
      discovered: discovered.length,
      created,
      skippedDuplicates,
    },
    "hallmark-events-scan: run complete",
  );

  return {
    searched: SEARCH_QUERIES.length,
    discovered: discovered.length,
    created,
    skippedDuplicates,
  };
}

const SCAN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // ~monthly (guard interval)

// Node clamps setInterval/setTimeout delays to a 32-bit signed int
// (~24.8 days, 2,147,483,647ms). SCAN_INTERVAL_MS (30 days) EXCEEDS that, so
// passing it directly to setInterval would silently overflow and fire almost
// immediately and repeatedly forever — this is the exact bug that caused a
// tight loop of "skipped" checks (and, before the shouldRunScheduledTask
// guard existed, would have caused a tight loop of full multi-model AI scans
// — a very plausible mechanism for burning a large AI spend in under a
// second). Instead we poll on a safe, well-under-the-limit cadence (6h) and
// let the persisted guard decide whether a real ~monthly scan is actually due.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — safely under the int32 limit

/**
 * Best-effort in-process monthly scheduler, same caveat as the other
 * schedulers in this codebase (autoscale instances can sleep for long
 * stretches, so this is a convenience, not a delivery guarantee). Polls every
 * 6 hours (see POLL_INTERVAL_MS note above) but the persisted
 * shouldRunScheduledTask() guard means an actual scan only fires roughly
 * every ~30 days, so restarting the server (e.g. during development) never
 * re-triggers this expensive multi-model AI scan. Safe to call repeatedly —
 * application-level de-dup also means a re-run never creates duplicate
 * events even if it does fire.
 */
export function startHallmarkEventsScanScheduler(): void {
  const run = async (): Promise<void> => {
    if (!(await shouldRunScheduledTask("hallmark-events-scan", SCAN_INTERVAL_MS))) {
      logger.info(
        "hallmark-events-scan: skipped (ran within the last ~30 days)",
      );
      return;
    }
    const t0 = Date.now();
    logger.info("hallmark-events-scan: run starting");
    try {
      await scanForHallmarkEvents();
      logger.info(
        { durationMs: Date.now() - t0 },
        "hallmark-events-scan: run complete",
      );
    } catch (err) {
      logger.error(
        { err, durationMs: Date.now() - t0 },
        "hallmark-events-scan: run failed",
      );
    }
  };

  void run();

  const interval = setInterval(() => void run(), POLL_INTERVAL_MS);
  interval.unref();

  logger.info(
    "hallmark-events-scan: started (in-process fallback, polls every 6h, scans ~monthly)",
  );
}
