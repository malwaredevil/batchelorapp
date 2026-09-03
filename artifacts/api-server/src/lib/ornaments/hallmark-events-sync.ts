import { eq } from "drizzle-orm";
import { db, ornamentsHallmarkEventSync } from "@workspace/db";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listAllCalendarEvents,
  updateCalendarEvent,
  type CalendarEvent,
} from "../google-calendar";
import {
  getHallmarkCalendarConnection,
  getValidAccessToken,
} from "../google-calendar-tokens";
import { logger } from "../logger";
import {
  recordScheduledTaskFailure,
  recordScheduledTaskSuccess,
  shouldRunScheduledTask,
} from "../scheduler-guard";
import {
  fetchHallmarkEventsSource,
  type HallmarkEventCandidate,
  type HallmarkEventsSourceResult,
} from "./hallmark-events-source";

export const HALLMARK_EVENTS_TASK_NAME = "hallmark-events-sync";
export const HALLMARK_EVENTS_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_ID = 1;
const SCANNER_KEY = "batchelorHallmarkSyncKey";
const SCANNER_SOURCE = "batchelorHallmarkSource";
const SCANNER_VERSION = "hallmark-event-sync:v1";
const SCHEDULER_TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface HallmarkSyncAction {
  action: "create" | "update" | "delete" | "unchanged";
  sourceKey?: string;
  eventId?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
}

export interface HallmarkSyncResult {
  mode: "dry-run" | "apply";
  status: "success" | "dry_run";
  sourceUrl: string;
  sourceFingerprint: string;
  fetchedAt: string;
  candidateCount: number;
  rejectedCount: number;
  candidates: HallmarkEventCandidate[];
  rejected: HallmarkEventsSourceResult["rejected"];
  actions: HallmarkSyncAction[];
}

export class HallmarkSyncPreviewStaleError extends Error {
  readonly expectedSourceFingerprint: string;
  readonly actualSourceFingerprint: string;

  constructor(
    expectedSourceFingerprint: string,
    actualSourceFingerprint: string,
  ) {
    super(
      "The Hallmark source changed after this preview. Run a new preview before applying.",
    );
    this.name = "HallmarkSyncPreviewStaleError";
    this.expectedSourceFingerprint = expectedSourceFingerprint;
    this.actualSourceFingerprint = actualSourceFingerprint;
  }
}

let activeRun: Promise<HallmarkSyncResult> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildHallmarkCalendarEventInput(
  candidate: HallmarkEventCandidate,
) {
  const description = [
    "Official Hallmark Keepsake event window.",
    candidate.details,
    `Source: ${candidate.sourceUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: candidate.title,
    description,
    location: null,
    allDay: true,
    start: candidate.startDate,
    end: candidate.endDate,
    colorId: null,
    extendedProperties: {
      private: {
        [SCANNER_KEY]: `${SCANNER_VERSION}:${candidate.sourceKey}`,
        [SCANNER_SOURCE]: candidate.sourceUrl,
      },
    },
  } as const;
}

export function getHallmarkSourceKeyFromCalendarEvent(
  event: CalendarEvent,
): string | null {
  const value = event.extendedProperties?.private?.[SCANNER_KEY];
  return value?.startsWith(`${SCANNER_VERSION}:`)
    ? value.slice(`${SCANNER_VERSION}:`.length)
    : null;
}

export function planHallmarkCalendarSync(
  candidates: HallmarkEventCandidate[],
  existing: CalendarEvent[],
  sourceYear: number,
): HallmarkSyncAction[] {
  const owned = new Map(
    existing
      .map(
        (event) =>
          [getHallmarkSourceKeyFromCalendarEvent(event), event] as const,
      )
      .filter((entry): entry is [string, CalendarEvent] => Boolean(entry[0])),
  );
  const candidateKeys = new Set(
    candidates.map((candidate) => candidate.sourceKey),
  );
  const actions: HallmarkSyncAction[] = [];

  for (const candidate of candidates) {
    const event = owned.get(candidate.sourceKey);
    if (!event) {
      actions.push({
        action: "create",
        sourceKey: candidate.sourceKey,
        title: candidate.title,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
      });
      continue;
    }
    const expected = buildHallmarkCalendarEventInput(candidate);
    const needsUpdate =
      event.title !== expected.title ||
      event.start !== expected.start ||
      event.end !== expected.end ||
      event.description !== expected.description;
    actions.push({
      action: needsUpdate ? "update" : "unchanged",
      sourceKey: candidate.sourceKey,
      eventId: event.id,
      title: candidate.title,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
    });
  }

  for (const [key, event] of owned) {
    if (key.endsWith(`:${sourceYear}`) && !candidateKeys.has(key)) {
      actions.push({
        action: "delete",
        sourceKey: key,
        eventId: event.id,
        title: event.title,
      });
    }
  }
  return actions;
}

export function assertHallmarkSourceFingerprint(
  expectedSourceFingerprint: string,
  actualSourceFingerprint: string,
): void {
  if (expectedSourceFingerprint !== actualSourceFingerprint) {
    throw new HallmarkSyncPreviewStaleError(
      expectedSourceFingerprint,
      actualSourceFingerprint,
    );
  }
}

async function writeState(values: {
  sourceUrl: string;
  sourceFetchedAt?: Date;
  sourceFingerprint?: string;
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  lastStatus: string;
  lastError?: string | null;
  candidateCount: number;
  rejectedCount: number;
  candidates: HallmarkEventCandidate[];
  rejected: HallmarkEventsSourceResult["rejected"];
}): Promise<void> {
  const row = {
    id: STATE_ID,
    sourceUrl: values.sourceUrl,
    sourceFetchedAt: values.sourceFetchedAt,
    sourceFingerprint: values.sourceFingerprint,
    lastRunAt: values.lastRunAt,
    lastSuccessAt: values.lastSuccessAt,
    lastStatus: values.lastStatus,
    lastError: values.lastError ?? null,
    candidateCount: values.candidateCount,
    rejectedCount: values.rejectedCount,
    candidates: values.candidates,
    rejected: values.rejected,
    updatedAt: new Date(),
  };
  await db.insert(ornamentsHallmarkEventSync).values(row).onConflictDoUpdate({
    target: ornamentsHallmarkEventSync.id,
    set: row,
  });
}

export async function getHallmarkEventSyncStatus() {
  const [state] = await db
    .select()
    .from(ornamentsHallmarkEventSync)
    .where(eq(ornamentsHallmarkEventSync.id, STATE_ID));
  return state ?? null;
}

async function runSync(
  mode: "dry-run" | "apply",
  expectedSourceFingerprint?: string,
): Promise<HallmarkSyncResult> {
  const startedAt = new Date();
  let source: HallmarkEventsSourceResult | undefined;
  try {
    source = await fetchHallmarkEventsSource();
    if (!source.complete || source.candidates.length === 0 || !source.year) {
      throw new Error(
        "Hallmark source did not produce a complete, year-consistent event set; calendar was not changed",
      );
    }
    if (mode === "apply" && expectedSourceFingerprint) {
      assertHallmarkSourceFingerprint(
        expectedSourceFingerprint,
        source.fingerprint,
      );
    }
    const actions: HallmarkSyncAction[] = [];

    if (mode === "dry-run") {
      const conn = await getHallmarkCalendarConnection();
      if (conn) {
        const accessToken = await getValidAccessToken(conn.userId);
        if (accessToken) {
          const existing = await listAllCalendarEvents(
            accessToken,
            conn.googleCalendarId,
          );
          actions.push(
            ...planHallmarkCalendarSync(
              source.candidates,
              existing,
              source.year,
            ),
          );
        }
      }
    } else {
      const conn = await getHallmarkCalendarConnection();
      if (!conn) throw new Error("No Hallmark calendar is configured");
      const accessToken = await getValidAccessToken(conn.userId);
      if (!accessToken) throw new Error("Could not connect to Google Calendar");
      const existing = await listAllCalendarEvents(
        accessToken,
        conn.googleCalendarId,
      );
      const owned = new Map(
        existing
          .map(
            (event) =>
              [getHallmarkSourceKeyFromCalendarEvent(event), event] as const,
          )
          .filter((entry): entry is [string, CalendarEvent] =>
            Boolean(entry[0]),
          ),
      );
      const candidateKeys = new Set(
        source.candidates.map((candidate) => candidate.sourceKey),
      );
      for (const candidate of source.candidates) {
        const event = owned.get(candidate.sourceKey);
        if (!event) {
          const created = await createCalendarEvent(
            accessToken,
            conn.googleCalendarId,
            buildHallmarkCalendarEventInput(candidate),
          );
          actions.push({
            action: "create",
            sourceKey: candidate.sourceKey,
            eventId: created.id,
            title: candidate.title,
            startDate: candidate.startDate,
            endDate: candidate.endDate,
          });
          continue;
        }
        const expected = buildHallmarkCalendarEventInput(candidate);
        const needsUpdate =
          event.title !== expected.title ||
          event.start !== expected.start ||
          event.end !== expected.end ||
          event.description !== expected.description;
        if (needsUpdate) {
          await updateCalendarEvent(
            accessToken,
            conn.googleCalendarId,
            event.id,
            expected,
          );
          actions.push({
            action: "update",
            sourceKey: candidate.sourceKey,
            eventId: event.id,
            title: candidate.title,
            startDate: candidate.startDate,
            endDate: candidate.endDate,
          });
        } else {
          actions.push({
            action: "unchanged",
            sourceKey: candidate.sourceKey,
            eventId: event.id,
            title: candidate.title,
            startDate: candidate.startDate,
            endDate: candidate.endDate,
          });
        }
      }
      for (const [key, event] of owned) {
        if (key.endsWith(`:${source.year}`) && !candidateKeys.has(key)) {
          await deleteCalendarEvent(
            accessToken,
            conn.googleCalendarId,
            event.id,
          );
          actions.push({
            action: "delete",
            sourceKey: key,
            eventId: event.id,
            title: event.title,
          });
        }
      }
    }

    await writeState({
      sourceUrl: source.sourceUrl,
      sourceFetchedAt: new Date(source.fetchedAt),
      sourceFingerprint: source.fingerprint,
      lastRunAt: startedAt,
      lastSuccessAt: mode === "apply" ? new Date() : undefined,
      lastStatus: mode === "apply" ? "success" : "dry_run",
      candidateCount: source.candidates.length,
      rejectedCount: source.rejected.length,
      candidates: source.candidates,
      rejected: source.rejected,
    });
    return {
      mode,
      status: mode === "apply" ? "success" : "dry_run",
      sourceUrl: source.sourceUrl,
      sourceFingerprint: source.fingerprint,
      fetchedAt: source.fetchedAt,
      candidateCount: source.candidates.length,
      rejectedCount: source.rejected.length,
      candidates: source.candidates,
      rejected: source.rejected,
      actions,
    };
  } catch (error) {
    await writeState({
      sourceUrl:
        source?.sourceUrl ??
        "https://www.hallmark.com/keepsake-ornament-events/",
      sourceFetchedAt: source ? new Date(source.fetchedAt) : undefined,
      sourceFingerprint: source?.fingerprint,
      lastRunAt: startedAt,
      lastStatus: "error",
      lastError: errorMessage(error).slice(0, 2_000),
      candidateCount: source?.candidates.length ?? 0,
      rejectedCount: source?.rejected.length ?? 0,
      candidates: source?.candidates ?? [],
      rejected: source?.rejected ?? [],
    });
    throw error;
  }
}

export async function runHallmarkEventsSync(
  mode: "dry-run" | "apply" = "apply",
  expectedSourceFingerprint?: string,
): Promise<HallmarkSyncResult> {
  if (activeRun) throw new Error("Hallmark event sync is already running");
  activeRun = runSync(mode, expectedSourceFingerprint);
  try {
    return await activeRun;
  } finally {
    activeRun = null;
  }
}

export async function runHallmarkEventsScheduled(): Promise<void> {
  if (
    !(await shouldRunScheduledTask(
      HALLMARK_EVENTS_TASK_NAME,
      HALLMARK_EVENTS_SYNC_INTERVAL_MS,
    ))
  ) {
    return;
  }
  const startedAt = Date.now();
  try {
    await runHallmarkEventsSync("apply");
    await recordScheduledTaskSuccess(HALLMARK_EVENTS_TASK_NAME);
    logger.info(
      { durationMs: Date.now() - startedAt },
      "hallmark-events-sync: run complete",
    );
  } catch (error) {
    await recordScheduledTaskFailure(HALLMARK_EVENTS_TASK_NAME);
    logger.error(
      { err: error, durationMs: Date.now() - startedAt },
      "hallmark-events-sync: run failed",
    );
  }
}

export function startHallmarkEventsSyncScheduler(): () => void {
  let stopped = false;
  const tick = async () => {
    await runHallmarkEventsScheduled();
    if (!stopped)
      setTimeout(() => void tick(), SCHEDULER_TICK_INTERVAL_MS).unref();
  };
  void tick();
  logger.info(
    "hallmark-events-sync: started (in-process fallback, runs weekly)",
  );
  return () => {
    stopped = true;
  };
}
