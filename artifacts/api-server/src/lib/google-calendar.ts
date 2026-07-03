// Google Calendar API access on behalf of a connected user (per-user OAuth,
// see google-calendar-oauth.ts / google-calendar-tokens.ts). Each function
// takes that user's live access token and talks to the Calendar REST API
// directly — no shared connector, no shared calendar.
import { logger } from "./logger";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  htmlLink?: string;
}

async function calendarApiJson<T>(
  accessToken: string,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${CALENDAR_API_BASE}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(options?.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google Calendar API ${options?.method ?? "GET"} ${path} failed: ${res.status} ${text}`,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function listGoogleCalendars(
  accessToken: string,
): Promise<GoogleCalendarListItem[]> {
  const data = await calendarApiJson<{
    items?: Array<{ id: string; summary?: string; primary?: boolean }>;
  }>(accessToken, "/users/me/calendarList");
  return (data.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? item.id,
    primary: item.primary,
  }));
}

export interface CreateReminderEventInput {
  calendarId: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  description?: string;
}

// Reminders are all-day events on their due date, with a popup notification
// the day before so it shows up as a native alert on the recipient's phone.
export async function createReminderEvent(
  accessToken: string,
  input: CreateReminderEventInput,
): Promise<GoogleCalendarEvent> {
  const nextDay = addDays(input.dueDate, 1);
  return calendarApiJson<GoogleCalendarEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(input.calendarId)}/events`,
    {
      method: "POST",
      body: {
        summary: input.title,
        description: input.description,
        start: { date: input.dueDate },
        end: { date: nextDay },
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 24 * 60 }],
        },
      },
    },
  );
}

export async function updateReminderEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: Omit<CreateReminderEventInput, "calendarId">,
): Promise<GoogleCalendarEvent> {
  const nextDay = addDays(input.dueDate, 1);
  return calendarApiJson<GoogleCalendarEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: {
        summary: input.title,
        description: input.description,
        start: { date: input.dueDate },
        end: { date: nextDay },
      },
    },
  );
}

export async function deleteReminderEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await calendarApiJson<void>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    // Event may have already been deleted directly in Google Calendar — don't
    // fail the reminder deletion over a missing downstream event.
    logger.warn(
      { err, calendarId, eventId },
      "google-calendar: delete event failed",
    );
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Generic calendar events (Family Calendar — arbitrary events, not just
// reminders). Supports both all-day events (date-only) and timed events
// (dateTime with offset), unlike the reminder-shaped functions above.
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  allDay: boolean;
  // All-day: "YYYY-MM-DD" (inclusive start, exclusive end per Google's model
  // — callers pass the last inclusive day; we add one day for `end` here).
  // Timed: RFC3339 datetime string with offset, e.g. "2026-07-10T14:00:00-04:00".
  start: string;
  end: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  start: string;
  end: string;
  htmlLink?: string;
}

interface RawGoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

function toGoogleEventBody(input: CalendarEventInput) {
  return {
    summary: input.title,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: input.allDay
      ? { date: input.start }
      : { dateTime: input.start },
    end: input.allDay
      ? { date: addDays(input.end, 1) }
      : { dateTime: input.end },
  };
}

function fromGoogleEvent(raw: RawGoogleEvent): CalendarEvent {
  const allDay = Boolean(raw.start?.date);
  return {
    id: raw.id,
    title: raw.summary ?? "(untitled event)",
    description: raw.description ?? null,
    location: raw.location ?? null,
    allDay,
    start: raw.start?.date ?? raw.start?.dateTime ?? "",
    // All-day events store an exclusive end date from Google; convert back to
    // the last inclusive day for display/editing.
    end: allDay
      ? subtractDays(raw.end?.date ?? raw.start?.date ?? "", 1)
      : (raw.end?.dateTime ?? raw.start?.dateTime ?? ""),
    htmlLink: raw.htmlLink,
  };
}

function subtractDays(dateStr: string, days: number): string {
  if (!dateStr) return dateStr;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// List events in [timeMinISO, timeMaxISO). Both bounds are RFC3339 datetimes.
export async function listCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await calendarApiJson<{ items?: RawGoogleEvent[] }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
  );
  return (data.items ?? [])
    .filter((item) => item.status !== "cancelled")
    .map(fromGoogleEvent);
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const raw = await calendarApiJson<RawGoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: toGoogleEventBody(input) },
  );
  return fromGoogleEvent(raw);
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const raw = await calendarApiJson<RawGoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: toGoogleEventBody(input) },
  );
  return fromGoogleEvent(raw);
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await calendarApiJson<void>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}
