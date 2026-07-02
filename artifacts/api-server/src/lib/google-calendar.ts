// Google Calendar integration (Replit connector "google-calendar").
// Provides one shared, connected Google account for the whole household.
// Reminders are auto-synced to a single chosen "Family" calendar; see
// travels_calendar_settings for the selected calendar id.
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  htmlLink?: string;
}

async function proxyJson<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await connectors.proxy("google-calendar", path, {
    method: options?.method ?? "GET",
    ...(options?.body !== undefined
      ? { body: JSON.stringify(options.body), headers: { "Content-Type": "application/json" } }
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

export async function isGoogleCalendarConnected(): Promise<boolean> {
  try {
    await connectors.listConnections({ connector_names: "google-calendar" });
    // A successful proxy call is the real signal; listConnections can succeed
    // even when the connection isn't authorized for this Repl. Do a cheap read.
    await proxyJson("/users/me/calendarList?maxResults=1");
    return true;
  } catch (err) {
    logger.warn({ err }, "google-calendar: connection check failed");
    return false;
  }
}

export async function listGoogleCalendars(): Promise<GoogleCalendarListItem[]> {
  const data = await proxyJson<{
    items?: Array<{ id: string; summary?: string; primary?: boolean }>;
  }>("/users/me/calendarList");
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
// the day before so it shows up as a native alert on everyone's phone.
export async function createReminderEvent(
  input: CreateReminderEventInput,
): Promise<GoogleCalendarEvent> {
  const nextDay = addDays(input.dueDate, 1);
  return proxyJson<GoogleCalendarEvent>(
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
  calendarId: string,
  eventId: string,
  input: Omit<CreateReminderEventInput, "calendarId">,
): Promise<GoogleCalendarEvent> {
  const nextDay = addDays(input.dueDate, 1);
  return proxyJson<GoogleCalendarEvent>(
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
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await proxyJson<void>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    // Event may have already been deleted directly in Google Calendar — don't
    // fail the reminder deletion over a missing downstream event.
    logger.warn({ err, calendarId, eventId }, "google-calendar: delete event failed");
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
