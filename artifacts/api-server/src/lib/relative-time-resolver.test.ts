import { describe, expect, it } from "vitest";
import {
  resolveRelativeTime,
  RelativeTimeResolutionError,
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

  it("rejects a non-positive count instead of guessing", () => {
    expect(() =>
      resolveRelativeTime({ kind: "days-from-now", count: 0 }, TZ, NOW),
    ).toThrow(RelativeTimeResolutionError);
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
