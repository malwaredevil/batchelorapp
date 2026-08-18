import { describe, expect, it } from "vitest";
import {
  resolveRelativeTime,
  resolveNaiveIsoInTimeZone,
  hasUtcOffset,
  RelativeTimeResolutionError,
  RelativeTimeSpecZod,
} from "./relative-time-resolver";

// Fixed "now" for deterministic tests: Wednesday, 2026-08-12 15:30 local
// time in America/Denver (UTC-6 during DST). All expected values below were
// computed by hand against this anchor.
const NOW = new Date("2026-08-12T21:30:00Z"); // 2026-08-12 15:30 America/Denver
const TZ = "America/Denver";

function localParts(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

describe("resolveRelativeTime", () => {
  it('"tomorrow" -> 00:01 the next calendar day', () => {
    const result = resolveRelativeTime(
      { kind: "days-from-now", count: 1 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-13 00:01");
  });

  it('"next week" -> 00:01 on the Sunday of the following week', () => {
    // 2026-08-12 is a Wednesday. "This" week's Sunday is 2026-08-09.
    // Next week's Sunday is 2026-08-16.
    const result = resolveRelativeTime({ kind: "next-week-start" }, TZ, NOW);
    expect(localParts(result)).toBe("2026-08-16 00:01");
  });

  it('"in a week" -> 00:01 on the same weekday, 7 days later', () => {
    const result = resolveRelativeTime(
      { kind: "weeks-from-now", count: 1 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-19 00:01");
  });

  it('"in 3 days" -> 00:01, 3 days later', () => {
    const result = resolveRelativeTime(
      { kind: "days-from-now", count: 3 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-15 00:01");
  });

  it('"next month" -> 00:01 the 1st of the following month', () => {
    const result = resolveRelativeTime({ kind: "next-month-start" }, TZ, NOW);
    expect(localParts(result)).toBe("2026-09-01 00:01");
  });

  it('"next month" from December rolls the year over', () => {
    const decNow = new Date("2026-12-15T20:00:00Z"); // mid-December
    const result = resolveRelativeTime(
      { kind: "next-month-start" },
      TZ,
      decNow,
    );
    expect(localParts(result)).toBe("2027-01-01 00:01");
  });

  it('"in 2 weeks" -> 14 days later', () => {
    const result = resolveRelativeTime(
      { kind: "weeks-from-now", count: 2 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-26 00:01");
  });

  it('"in 3 months" adds calendar months, not 90 days', () => {
    const result = resolveRelativeTime(
      { kind: "months-from-now", count: 3 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-11-12 00:01");
  });

  it("clamps end-of-month overflow (Jan 31 + 1 month -> Feb 28)", () => {
    const jan31 = new Date("2026-01-31T20:00:00Z"); // 2026-01-31 in America/Denver
    const result = resolveRelativeTime(
      { kind: "months-from-now", count: 1 },
      TZ,
      jan31,
    );
    expect(localParts(result)).toBe("2026-02-28 00:01");
  });

  it('"next Tuesday at 9am" uses the explicit clock time instead of 00:01', () => {
    // 2026-08-12 is a Wednesday (dayOfWeek 3). Next Tuesday (dayOfWeek 2) is
    // 2026-08-18.
    const result = resolveRelativeTime(
      { kind: "next-weekday", dayOfWeek: 2, clockTime: { hour: 9, minute: 0 } },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-18 09:00");
  });

  it('"next Wednesday" (today IS Wednesday) resolves 7 days out, never today', () => {
    const result = resolveRelativeTime(
      { kind: "next-weekday", dayOfWeek: 3 },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-19 00:01");
  });

  it("rejects a negative count instead of guessing (0 = today is allowed for days-from-now)", () => {
    expect(() =>
      resolveRelativeTime({ kind: "days-from-now", count: -2 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
  });

  it("rejects an invalid dayOfWeek instead of guessing", () => {
    expect(() =>
      resolveRelativeTime({ kind: "next-weekday", dayOfWeek: 9 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
  });

  it("rejects an invalid clockTime instead of guessing", () => {
    expect(() =>
      resolveRelativeTime(
        { kind: "days-from-now", count: 1, clockTime: { hour: 25, minute: 0 } },
        TZ,
        NOW,
      ),
    ).toThrow(RelativeTimeResolutionError);
  });

  it('"in 20 minutes" -> now + 20 minutes exactly, timezone-independent', () => {
    const result = resolveRelativeTime(
      { kind: "minutes-from-now", count: 20 },
      TZ,
      NOW,
    );
    expect(result.getTime()).toBe(NOW.getTime() + 20 * 60_000);
  });

  it('"in 2 hours" -> now + 2 hours exactly', () => {
    const result = resolveRelativeTime(
      { kind: "hours-from-now", count: 2 },
      TZ,
      NOW,
    );
    expect(result.getTime()).toBe(NOW.getTime() + 2 * 3_600_000);
  });

  it("rejects a non-positive count for minutes-from-now/hours-from-now", () => {
    expect(() =>
      resolveRelativeTime({ kind: "minutes-from-now", count: 0 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
    expect(() =>
      resolveRelativeTime({ kind: "hours-from-now", count: -1 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
  });

  it("falls back to the default timezone for an invalid IANA name", () => {
    // Should not throw — falls back to Europe/Berlin rather than crashing.
    const result = resolveRelativeTime(
      { kind: "days-from-now", count: 1 },
      "Not/ARealZone",
      NOW,
    );
    expect(result instanceof Date).toBe(true);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});

describe("hasUtcOffset / resolveNaiveIsoInTimeZone", () => {
  it("detects presence and absence of a UTC offset", () => {
    expect(hasUtcOffset("2026-08-17T16:15:00+02:00")).toBe(true);
    expect(hasUtcOffset("2026-08-17T16:15:00Z")).toBe(true);
    expect(hasUtcOffset("2026-08-17T16:15:00-0500")).toBe(true);
    expect(hasUtcOffset("2026-08-17T16:15:00")).toBe(false);
    expect(hasUtcOffset("2026-08-17T16:15")).toBe(false);
  });

  it("interprets a naive datetime as wall-clock time in the given zone", () => {
    // Berlin is UTC+2 in August (CEST).
    const result = resolveNaiveIsoInTimeZone(
      "2026-08-17T16:15:00",
      "Europe/Berlin",
    );
    expect(result.toISOString()).toBe("2026-08-17T14:15:00.000Z");
  });

  it("handles winter (standard-time) dates across DST", () => {
    // Berlin is UTC+1 in December (CET).
    const result = resolveNaiveIsoInTimeZone(
      "2026-12-01T09:00",
      "Europe/Berlin",
    );
    expect(result.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("rejects garbage input", () => {
    expect(() =>
      resolveNaiveIsoInTimeZone("tomorrow at 4", "Europe/Berlin"),
    ).toThrow(RelativeTimeResolutionError);
  });
});

describe("days-from-now count 0 (today)", () => {
  it('resolves "today at 16:45" to the same local calendar day', () => {
    const result = resolveRelativeTime(
      { kind: "days-from-now", count: 0, clockTime: { hour: 16, minute: 45 } },
      TZ,
      NOW,
    );
    expect(localParts(result)).toBe("2026-08-12 16:45");
  });

  it("rejects count 0 without an explicit clockTime (would resolve to the past)", () => {
    expect(() =>
      resolveRelativeTime({ kind: "days-from-now", count: 0 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
    expect(
      RelativeTimeSpecZod.safeParse({ kind: "days-from-now", count: 0 })
        .success,
    ).toBe(false);
    expect(
      RelativeTimeSpecZod.safeParse({
        kind: "days-from-now",
        count: 0,
        clockTime: { hour: 16, minute: 45 },
      }).success,
    ).toBe(true);
  });

  it("still rejects count 0 for the other kinds", () => {
    expect(() =>
      resolveRelativeTime({ kind: "weeks-from-now", count: 0 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
    expect(() =>
      resolveRelativeTime({ kind: "months-from-now", count: 0 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
  });

  it("rejects negative days-from-now", () => {
    expect(() =>
      resolveRelativeTime({ kind: "days-from-now", count: -1 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
  });
});
