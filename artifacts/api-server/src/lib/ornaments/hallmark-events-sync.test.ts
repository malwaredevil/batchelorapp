import { describe, expect, it } from "vitest";
import {
  assertHallmarkSourceFingerprint,
  buildHallmarkCalendarEventInput,
  getHallmarkSourceKeyFromCalendarEvent,
  planHallmarkCalendarSync,
} from "./hallmark-events-sync";
import type { HallmarkEventCandidate } from "./hallmark-events-source";

const premiere: HallmarkEventCandidate = {
  sourceKey: "ornament-premiere:2026",
  title: "Hallmark Keepsake Ornament Premiere",
  startDate: "2026-07-11",
  endDate: "2026-07-19",
  details: "Shop the new Keepsake ornaments.",
  sourceUrl: "https://www.hallmark.com/keepsake-ornament-events/",
  year: 2026,
};

const debut: HallmarkEventCandidate = {
  ...premiere,
  sourceKey: "ornament-debut:2026",
  title: "Hallmark Keepsake Ornament Debut",
  startDate: "2026-10-10",
  endDate: "2026-10-18",
};

describe("Hallmark calendar reconciliation", () => {
  it("rejects applying a preview when the source fingerprint changed", () => {
    expect(() =>
      assertHallmarkSourceFingerprint("preview-fingerprint", "new-fingerprint"),
    ).toThrow(
      "The Hallmark source changed after this preview. Run a new preview before applying.",
    );
  });

  it("accepts applying a preview when the source fingerprint is unchanged", () => {
    expect(() =>
      assertHallmarkSourceFingerprint("same-fingerprint", "same-fingerprint"),
    ).not.toThrow();
  });

  it("writes stable private metadata that follows a date correction", () => {
    const input = buildHallmarkCalendarEventInput(premiere);

    expect(input.extendedProperties?.private).toEqual({
      batchelorHallmarkSyncKey: "hallmark-event-sync:v1:ornament-premiere:2026",
      batchelorHallmarkSource:
        "https://www.hallmark.com/keepsake-ornament-events/",
    });
  });

  it("plans only scanner-owned changes and preserves manual calendar events", () => {
    const events = [
      {
        id: "owned-premiere",
        title: premiere.title,
        description: "Old source details",
        location: null,
        allDay: true,
        start: premiere.startDate,
        end: premiere.endDate,
        colorId: null,
        extendedProperties: {
          private: {
            batchelorHallmarkSyncKey:
              "hallmark-event-sync:v1:ornament-premiere:2026",
          },
        },
      },
      {
        id: "owned-stale",
        title: "Old Hallmark event",
        description: null,
        location: null,
        allDay: true,
        start: "2026-02-01",
        end: "2026-02-02",
        colorId: null,
        extendedProperties: {
          private: {
            batchelorHallmarkSyncKey:
              "hallmark-event-sync:v1:retired-event:2026",
          },
        },
      },
      {
        id: "manual-event",
        title: "Family ornament shopping",
        description: "Created by the household",
        location: null,
        allDay: true,
        start: "2026-07-12",
        end: "2026-07-12",
        colorId: null,
      },
    ];

    const actions = planHallmarkCalendarSync([premiere, debut], events, 2026);

    expect(actions).toEqual([
      expect.objectContaining({
        action: "update",
        sourceKey: "ornament-premiere:2026",
        eventId: "owned-premiere",
      }),
      expect.objectContaining({
        action: "create",
        sourceKey: "ornament-debut:2026",
      }),
      expect.objectContaining({
        action: "delete",
        sourceKey: "retired-event:2026",
        eventId: "owned-stale",
      }),
    ]);
    expect(actions.some((action) => action.eventId === "manual-event")).toBe(
      false,
    );
    expect(getHallmarkSourceKeyFromCalendarEvent(events[2])).toBeNull();
  });
});
