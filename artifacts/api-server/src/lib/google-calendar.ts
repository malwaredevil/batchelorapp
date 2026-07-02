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
