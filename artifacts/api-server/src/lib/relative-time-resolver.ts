import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, appUsers } from "@workspace/db";
import { isValidIanaTimeZone } from "./timezone";

// ---------------------------------------------------------------------------
// Deterministic relative-time resolver (issue #525).
//
// Elaine's schedule-related action tools (call_contact / message_contact /
// the reminders action, see communication-actions.ts) let the user speak in
// relative terms ("tomorrow", "next week", "in 3 days"...). The model is
// NOT trusted to compute the actual datetime itself — LLMs are unreliable at
// exact date arithmetic and have no reliable notion of "today" without being
// told. Instead, the model's only job is to translate the user's words into
// one of the structured RelativeTimeSpec variants below; this module then
// computes the exact datetime deterministically in code, in the requesting
// user's timezone (same app_users.timezone fallback pattern already used by
// comm-check-scheduler.ts's getEffectiveTimezone()).
//
// Each spec variant maps 1:1 to an unambiguous phrase so the type system
// itself prevents nonsensical combinations (e.g. there is no way to express
// "next period start" for a bare day, since "next day" isn't a meaningful
// calendar-boundary phrase the way "next week"/"next month" are).
// ---------------------------------------------------------------------------

const DEFAULT_TIMEZONE = "Europe/Berlin";
const DEFAULT_HOUR = 0;
const DEFAULT_MINUTE = 1;

export interface ClockTime {
  hour: number; // 0-23
  minute: number; // 0-59
}

export type RelativeTimeSpec =
  // "tomorrow" -> { kind: "days-from-now", count: 1 }
  // "in 3 days" -> { kind: "days-from-now", count: 3 }
  | { kind: "days-from-now"; count: number; clockTime?: ClockTime }
  // "in a week" -> { kind: "weeks-from-now", count: 1 }
  // "in 2 weeks" -> { kind: "weeks-from-now", count: 2 }
  | { kind: "weeks-from-now"; count: number; clockTime?: ClockTime }
  // "in 3 months" -> { kind: "months-from-now", count: 3 }
  | { kind: "months-from-now"; count: number; clockTime?: ClockTime }
  // "next week" -> the Sunday that starts the following week.
  | { kind: "next-week-start"; clockTime?: ClockTime }
  // "next month" -> the 1st of the following month.
  | { kind: "next-month-start"; clockTime?: ClockTime }
  // "next Tuesday" -> the next upcoming occurrence of that weekday, always
  // strictly in the future (if today IS that weekday, resolves 7 days out).
  | { kind: "next-weekday"; dayOfWeek: number; clockTime?: ClockTime };

// Zod mirror of RelativeTimeSpec above — the single source of truth for
// validating this shape wherever a tool payload accepts it (reminder-actions.ts's
// create_reminder `when` field, and communication-actions.ts's call_contact /
// message_contact `scheduleAt` field). Keep in lockstep with the TS type by
// hand; there is no automated sync.
const ClockTimeZod = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export const RelativeTimeSpecZod = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("days-from-now"),
    count: z.number().int().positive(),
    clockTime: ClockTimeZod.optional(),
  }),
  z.object({
    kind: z.literal("weeks-from-now"),
    count: z.number().int().positive(),
    clockTime: ClockTimeZod.optional(),
  }),
  z.object({
    kind: z.literal("months-from-now"),
    count: z.number().int().positive(),
    clockTime: ClockTimeZod.optional(),
  }),
  z.object({
    kind: z.literal("next-week-start"),
    clockTime: ClockTimeZod.optional(),
  }),
  z.object({
    kind: z.literal("next-month-start"),
    clockTime: ClockTimeZod.optional(),
  }),
  z.object({
    kind: z.literal("next-weekday"),
    dayOfWeek: z.number().int().min(0).max(6),
    clockTime: ClockTimeZod.optional(),
  }),
]);

// Shared JSON-schema fragment for tool definitions that accept a
// RelativeTimeSpec, so the model gets identical guidance regardless of which
// tool (create_reminder / call_contact / message_contact) it's calling.
export const RELATIVE_TIME_SPEC_JSON_SCHEMA = {
  type: "object",
  description:
    "Structured relative-time spec — you compute WHICH variant applies from the user's words, never the actual datetime yourself; resolveRelativeTime computes the exact datetime deterministically in code.",
  properties: {
    kind: {
      type: "string",
      enum: [
        "days-from-now",
        "weeks-from-now",
        "months-from-now",
        "next-week-start",
        "next-month-start",
        "next-weekday",
      ],
      description:
        '"days-from-now"/count for "tomorrow" (count=1) or "in N days"; ' +
        '"weeks-from-now"/count for "in a week" (count=1) or "in N weeks"; ' +
        '"months-from-now"/count for "in N months"; ' +
        '"next-week-start" for "next week" (Sunday of the following week); ' +
        '"next-month-start" for "next month" (1st of the following month); ' +
        '"next-weekday"/dayOfWeek for "next Tuesday" etc (0=Sunday..6=Saturday) — always resolves to a future date, never today even if today is that weekday.',
    },
    count: {
      type: "integer",
      description:
        "Required for days-from-now/weeks-from-now/months-from-now, omit otherwise.",
    },
    dayOfWeek: {
      type: "integer",
      description:
        "Required for next-weekday (0=Sunday..6=Saturday), omit otherwise.",
    },
    clockTime: {
      type: "object",
      description:
        'Only include when the user gave an explicit time (e.g. "at 9am"); omit to use the default of 00:01.',
      properties: {
        hour: { type: "integer", description: "0-23" },
        minute: { type: "integer", description: "0-59" },
      },
    },
  },
  required: ["kind"],
} as const;

// Thrown when a spec is malformed (e.g. count <= 0, invalid dayOfWeek, or an
// invalid clockTime). Callers MUST treat this as "ask the user to clarify",
// never as a reason to guess a fallback datetime — see issue #525's explicit
// "do not guess at ambiguous cases" requirement.
export class RelativeTimeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelativeTimeResolutionError";
  }
}

function assertValidClockTime(clockTime: ClockTime | undefined): void {
  if (!clockTime) return;
  if (
    !Number.isInteger(clockTime.hour) ||
    clockTime.hour < 0 ||
    clockTime.hour > 23 ||
    !Number.isInteger(clockTime.minute) ||
    clockTime.minute < 0 ||
    clockTime.minute > 59
  ) {
    throw new RelativeTimeResolutionError(
      `Invalid clockTime: ${JSON.stringify(clockTime)}`,
    );
  }
}

function assertPositiveCount(count: number, kind: string): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RelativeTimeResolutionError(
      `Invalid count for ${kind}: ${count} (must be a positive integer)`,
    );
  }
}

// Returns the given timezone's local Y/M/D/H/M as plain numbers, using the
// same Intl.DateTimeFormat approach as comm-check-scheduler.ts so date math
// below operates on the *local calendar date* rather than the UTC date.
function getLocalDateParts(
  tz: string,
  now: Date,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// Returns the weekday (0=Sunday..6=Saturday) of the given local calendar
// date in the given timezone.
function getLocalWeekday(tz: string, now: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? 0;
}

// Returns the number of milliseconds to ADD to a UTC instant to get the
// local wall-clock time in `tz` at that instant (i.e. the zone's current UTC
// offset, DST-aware, evaluated AT `utcInstant` — not at some unrelated
// reference time, since that would misapply e.g. an August DST offset to a
// November target date).
function getOffsetMillis(tz: string, utcInstant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(utcInstant);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return localAsUtc - utcInstant.getTime();
}

// Returns the UTC instant corresponding to a given local calendar
// date+time in `tz`. Computes the offset at (an initial guess of) the
// TARGET instant itself, rather than at some unrelated "now" reference, so
// this stays exact across DST transitions between "now" and the target date
// (e.g. resolving a November date from an August "now" in a zone that
// observes DST). Re-checks once after the first correction to handle the
// rare case where the initial guess landed on the wrong side of a DST
// boundary.
function localDateTimeToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset1 = getOffsetMillis(tz, guess);
  const corrected = new Date(guess.getTime() - offset1);
  const offset2 = getOffsetMillis(tz, corrected);
  if (offset2 === offset1) return corrected;
  return new Date(guess.getTime() - offset2);
}

function addLocalDays(
  tz: string,
  base: Date,
  days: number,
  clockTime: ClockTime | undefined,
): Date {
  const parts = getLocalDateParts(tz, base);
  // Advance the calendar date by `days` using UTC-based date math on the
  // Y/M/D triple (safe: this never touches wall-clock time, only the date
  // components), then re-anchor to the target timezone's wall clock.
  const advanced = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  const hour = clockTime?.hour ?? DEFAULT_HOUR;
  const minute = clockTime?.minute ?? DEFAULT_MINUTE;
  return localDateTimeToUtc(
    tz,
    advanced.getUTCFullYear(),
    advanced.getUTCMonth() + 1,
    advanced.getUTCDate(),
    hour,
    minute,
  );
}

function addLocalMonths(
  tz: string,
  base: Date,
  months: number,
  clockTime: ClockTime | undefined,
  dayOverride?: number,
): Date {
  const parts = getLocalDateParts(tz, base);
  const targetMonthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const day = dayOverride ?? parts.day;
  // Clamp to the last valid day of the target month (e.g. Jan 31 + 1 month
  // -> Feb 28/29, not Mar 3).
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const hour = clockTime?.hour ?? DEFAULT_HOUR;
  const minute = clockTime?.minute ?? DEFAULT_MINUTE;
  return localDateTimeToUtc(tz, year, month + 1, clampedDay, hour, minute);
}

/**
 * Pure, deterministic resolution of a structured relative-time spec into an
 * exact UTC Date, interpreted in `timezone`. No model/AI call happens here —
 * see the module doc comment. Throws RelativeTimeResolutionError for any
 * malformed spec; callers must surface that as "please clarify the time",
 * never silently fall back to a guessed datetime.
 */
export function resolveRelativeTime(
  spec: RelativeTimeSpec,
  timezone: string,
  now: Date = new Date(),
): Date {
  const tz = isValidIanaTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  assertValidClockTime(spec.clockTime);

  switch (spec.kind) {
    case "days-from-now": {
      assertPositiveCount(spec.count, "days-from-now");
      return addLocalDays(tz, now, spec.count, spec.clockTime);
    }
    case "weeks-from-now": {
      assertPositiveCount(spec.count, "weeks-from-now");
      return addLocalDays(tz, now, spec.count * 7, spec.clockTime);
    }
    case "months-from-now": {
      assertPositiveCount(spec.count, "months-from-now");
      return addLocalMonths(tz, now, spec.count, spec.clockTime);
    }
    case "next-week-start": {
      // The Sunday that starts "this" local week, plus 7 days.
      const todayWeekday = getLocalWeekday(tz, now);
      const daysBackToThisSunday = -todayWeekday;
      const thisSunday = addLocalDays(tz, now, daysBackToThisSunday, {
        hour: 0,
        minute: 1,
      });
      return addLocalDays(tz, thisSunday, 7, spec.clockTime);
    }
    case "next-month-start": {
      // The 1st of the following local month.
      return addLocalMonths(tz, now, 1, spec.clockTime, 1);
    }
    case "next-weekday": {
      if (
        !Number.isInteger(spec.dayOfWeek) ||
        spec.dayOfWeek < 0 ||
        spec.dayOfWeek > 6
      ) {
        throw new RelativeTimeResolutionError(
          `Invalid dayOfWeek: ${spec.dayOfWeek} (must be 0-6, 0=Sunday)`,
        );
      }
      const todayWeekday = getLocalWeekday(tz, now);
      // Always strictly in the future: if today IS the target weekday,
      // resolve to next week's occurrence (7 days out), not today.
      let daysAhead = (spec.dayOfWeek - todayWeekday + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      return addLocalDays(tz, now, daysAhead, spec.clockTime);
    }
    default: {
      const _exhaustive: never = spec;
      throw new RelativeTimeResolutionError(
        `Unknown relative-time spec kind: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

// Resolves the effective timezone for a specific user (not the household
// owner — communication-actions.ts callers know exactly which user's
// "tomorrow" they're computing), falling back to DEFAULT_TIMEZONE, mirroring
// getEffectiveTimezone()'s owner-wide fallback pattern in
// comm-check-scheduler.ts.
export async function getUserTimezone(userId: number): Promise<string> {
  const [user] = await db
    .select({ timezone: appUsers.timezone })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return user?.timezone && isValidIanaTimeZone(user.timezone)
    ? user.timezone
    : DEFAULT_TIMEZONE;
}
