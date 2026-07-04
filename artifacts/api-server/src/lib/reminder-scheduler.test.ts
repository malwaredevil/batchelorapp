import { describe, it, expect } from "vitest";
import { daysUntilDue } from "./reminder-scheduler";

describe("daysUntilDue", () => {
  it("returns exactly N for a date N days out, regardless of what time of day 'now' is", () => {
    const dueDate = "2026-07-14"; // 10 days after the fixed "now" below

    const earlyMorning = new Date("2026-07-04T00:05:00Z");
    const lateNight = new Date("2026-07-04T23:55:00Z");
    const midday = new Date("2026-07-04T12:00:00Z");

    expect(daysUntilDue(dueDate, earlyMorning)).toBe(10);
    expect(daysUntilDue(dueDate, lateNight)).toBe(10);
    expect(daysUntilDue(dueDate, midday)).toBe(10);
  });

  it("returns 0 on the due date itself, at any time of day", () => {
    const dueDate = "2026-07-04";

    expect(daysUntilDue(dueDate, new Date("2026-07-04T00:00:01Z"))).toBe(0);
    expect(daysUntilDue(dueDate, new Date("2026-07-04T23:59:59Z"))).toBe(0);
  });

  it("returns a negative value once the due date has passed", () => {
    expect(daysUntilDue("2026-07-01", new Date("2026-07-04T12:00:00Z"))).toBe(-3);
  });

  it("matches its configured alertDaysBefore exactly once across every hour of the scheduler day", () => {
    const dueDate = "2026-07-08"; // "1 day before" should only match on 2026-07-07
    const alertDaysBefore = 1;

    let matchCount = 0;
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(`2026-07-07T${String(hour).padStart(2, "0")}:00:00Z`);
      if (daysUntilDue(dueDate, now) === alertDaysBefore) matchCount++;
    }

    expect(matchCount).toBe(24);
  });

  it("never double-matches across the day boundary due to time-of-day rounding", () => {
    const dueDate = "2026-07-08";
    const alertDaysBefore = 1;

    const justBeforeMidnight = new Date("2026-07-06T23:59:59Z");
    const justAfterMidnight = new Date("2026-07-07T00:00:01Z");

    expect(daysUntilDue(dueDate, justBeforeMidnight)).toBe(2);
    expect(daysUntilDue(dueDate, justAfterMidnight)).toBe(1);
    expect(daysUntilDue(dueDate, justBeforeMidnight)).not.toBe(alertDaysBefore);
  });
});
