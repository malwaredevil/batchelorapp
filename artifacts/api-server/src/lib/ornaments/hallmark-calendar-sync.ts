// Superseded: the ornaments_hallmark_events DB table has been removed.
// Hallmark events are now written directly to Google Calendar via
// artifacts/api-server/src/routes/ornaments/hallmark-events.ts.
// This file exports a no-op stub so any stale imports continue to compile.

export interface HallmarkEventSyncInput {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  googleEventId: string | null;
}

export async function syncHallmarkEventToGoogle(
  _action: "create" | "update" | "delete",
  event: HallmarkEventSyncInput,
): Promise<string | null> {
  return event.googleEventId;
}
