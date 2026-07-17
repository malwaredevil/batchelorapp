// Hand-written hooks for Hallmark calendar events. Google Calendar is the
// sole source of truth — the ornaments_hallmark_events DB table has been
// removed. Events are read via useListConnectedCalendarEvents (travels.ts)
// and written via these mutation hooks that proxy through
// POST/PATCH/DELETE /api/ornaments/hallmark-events.
import {
  useMutation,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface HallmarkGCalEventInput {
  title: string;
  description?: string | null;
  startDate: string;
  endDate: string;
}

export interface HallmarkCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string | null;
}

const BASE = "/api/ornaments/hallmark-events";

export function useCreateHallmarkGCalEvent(
  options?: Partial<
    UseMutationOptions<HallmarkCalendarEvent, unknown, HallmarkGCalEventInput>
  >,
) {
  return useMutation({
    mutationFn: (data: HallmarkGCalEventInput) =>
      customFetch<HallmarkCalendarEvent>(BASE, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options,
  });
}

export function useUpdateHallmarkGCalEvent(
  options?: Partial<
    UseMutationOptions<
      HallmarkCalendarEvent,
      unknown,
      { gcalId: string; data: HallmarkGCalEventInput }
    >
  >,
) {
  return useMutation({
    mutationFn: ({ gcalId, data }) =>
      customFetch<HallmarkCalendarEvent>(`${BASE}/${gcalId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    ...options,
  });
}

export function useDeleteHallmarkGCalEvent(
  options?: Partial<UseMutationOptions<void, unknown, string>>,
) {
  return useMutation({
    mutationFn: (gcalId: string) =>
      customFetch<void>(`${BASE}/${gcalId}`, { method: "DELETE" }),
    ...options,
  });
}
