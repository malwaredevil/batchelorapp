// Shared helper for best-effort mirroring of an ornaments_hallmark_events row
// to the designated shared "Hallmark" Google Calendar
// (travels_connected_calendars, is_hallmark_calendar = true), when one has
// been designated. Used by both the CRUD routes (hallmark-events.ts) and the
// AI auto-discovery scanner (hallmark-events-scan.ts) so the sync/no-sync
// semantics stay identical regardless of how a row was created.
import {
  getHallmarkCalendarConnection,
  getValidAccessToken,
} from "../google-calendar-tokens";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../google-calendar";
import { logger } from "../logger";

export interface HallmarkEventSyncInput {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  googleEventId: string | null;
}

export async function syncHallmarkEventToGoogle(
  action: "create" | "update" | "delete",
  event: HallmarkEventSyncInput,
): Promise<string | null> {
  const calendar = await getHallmarkCalendarConnection();
  if (!calendar) return event.googleEventId;

  const accessToken = await getValidAccessToken(calendar.userId);
  if (!accessToken) return event.googleEventId;

  try {
    if (action === "delete") {
      if (event.googleEventId) {
        await deleteCalendarEvent(
          accessToken,
          calendar.googleCalendarId,
          event.googleEventId,
        );
      }
      return null;
    }

    const input = {
      title: event.title,
      description: event.description,
      location: null,
      allDay: true,
      start: event.startDate,
      end: event.endDate,
      colorId: null,
    };

    if (action === "update" && event.googleEventId) {
      const updated = await updateCalendarEvent(
        accessToken,
        calendar.googleCalendarId,
        event.googleEventId,
        input,
      );
      return updated.id;
    }

    const created = await createCalendarEvent(
      accessToken,
      calendar.googleCalendarId,
      input,
    );
    return created.id;
  } catch (err) {
    logger.error(
      { err, action },
      "hallmark-calendar-sync: best-effort Google Calendar sync failed",
    );
    return event.googleEventId;
  }
}
