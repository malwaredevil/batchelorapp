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
  // "in 20 minutes" -> { kind: "minutes-from-now", count: 20 }. No clockTime
  // (a sub-day offset already IS the exact time; there is nothing to
  // override).
  | { kind: "minutes-from-now"; count: number }
  // "in 2 hours" -> { kind: "hours-from-now", count: 2 }. Same rationale as
  // minutes-from-now: no clockTime field.
  | { kind: "hours-from-now"; count: number }
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
  | { kind: "next-weekday"; dayOfWeek: number; clockTime?: ClockTime }
  // "at 3:45pm" / "call me at 9am" -> a bare clock time with NO explicit day.
  // Resolves to the next upcoming occurrence: today if that time hasn't
  // passed yet (in the target timezone), otherwise tomorrow. This exists so
  // the model NEVER has to compute an exact ISO datetime (with the correct
  // UTC offset) itself for an absolute time-of-day request — doing so was
  // the root cause of a real incident where "call me at 3:45 PM my time"
  // came back with a wildly wrong timezone, because there was previously no
  // structured way to express "today/next occurrence at this clock time".
  | { kind: "at-clock-time"; clockTime: ClockTime };

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
    kind: z.literal("minutes-from-now"),
    count: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("hours-from-now"),
    count: z.number().int().positive(),
  }),
  z
    .object({
      kind: z.literal("days-from-now"),
      // 0 is allowed here (and only here): "today at 4:45 PM" is naturally
      // expressed as days-from-now count=0 + clockTime by models (#1110).
      // A clockTime is REQUIRED with count 0 — otherwise the default 00:01
      // resolves to a time already in the past, which the scheduler would
      // dispatch immediately.
      count: z.number().int().nonnegative(),
      clockTime: ClockTimeZod.optional(),
    })
    .refine((v) => v.count > 0 || v.clockTime !== undefined, {
      message: 'days-from-now count 0 ("today") requires an explicit clockTime',
      path: ["clockTime"],
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
  z.object({
    kind: z.literal("at-clock-time"),
    clockTime: ClockTimeZod,
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
        "minutes-from-now",
        "hours-from-now",
        "days-from-now",
        "weeks-from-now",
        "months-from-now",
        "next-week-start",
        "next-month-start",
        "next-weekday",
        "at-clock-time",
      ],
      description:
        '"minutes-from-now"/count for "in 20 minutes"; ' +
        '"hours-from-now"/count for "in 2 hours" or "in an hour" (count=1); ' +
        '"days-from-now"/count for "tomorrow" (count=1), "in N days", or "today at <time>" (count=0 — clockTime is REQUIRED with count 0); ' +
        '"weeks-from-now"/count for "in a week" (count=1) or "in N weeks"; ' +
        '"months-from-now"/count for "in N months"; ' +
        '"next-week-start" for "next week" (Sunday of the following week); ' +
        '"next-month-start" for "next month" (1st of the following month); ' +
        '"next-weekday"/dayOfWeek for "next Tuesday" etc (0=Sunday..6=Saturday) — always resolves to a future date, never today even if today is that weekday; ' +
        '"at-clock-time"/clockTime for a bare time of day with NO explicit day, e.g. "at 3:45pm", "call me at 9am", "today at 2pm" — resolves to today if that time hasn\'t passed yet, otherwise tomorrow. ALWAYS use this (never an exact ISO datetime you compute yourself) whenever the user names a clock time without an explicit future day.',
    },
    count: {
      type: "integer",
      description:
        "Required for minutes-from-now/hours-from-now/days-from-now/weeks-from-now/months-from-now, omit otherwise.",
    },
    dayOfWeek: {
      type: "integer",
      description:
        "Required for next-weekday (0=Sunday..6=Saturday), omit otherwise.",
    },
    clockTime: {
      type: "object",
      description:
        'Required for at-clock-time. For days-from-now/weeks-from-now/months-from-now/next-week-start/next-month-start/next-weekday, only include when the user gave an explicit time (e.g. "at 9am"); omit to use the default of 00:01. Never include for minutes-from-now/hours-from-now — those already resolve to an exact instant.',
      properties: {
        hour: { type: "integer", description: "0-23" },
        minute: { type: "integer", description: "0-59" },
      },
    },
  },
  required: ["kind"],
} as const;

// Shared field/JSON-schema pair for an OPTIONAL explicit-timezone override,
// used as a sibling to scheduleAt/when across every scheduling tool
// (call_contact, message_contact, call_me, create_reminder, snooze_reminder)
// so they all give the model identical guidance. When present and a valid
// IANA identifier, callers must use it for BOTH resolving the spec/instant
// AND formatting the confirmation — never one without the other, or the
// approval card and the executed time can disagree (see MEMORY.md's
// elaine-scheduled-time-display-timezone note). When absent (the common
// case), callers fall back to the user's own profile timezone
// (getUserTimezone) — never the server's local timezone.
export const explicitTimezoneField = z
  .string()
  .optional()
  .describe(
    "IANA timezone (e.g. 'Asia/Tokyo', 'America/Los_Angeles') — ONLY set this when the user explicitly names a timezone, city, or region DIFFERENT from their own for this specific request (e.g. 'call me at 9am Tokyo time', 'remind me at 3pm Pacific time'). Omit entirely to use the user's own account timezone by default — never guess or invent a timezone the user didn't name.",
  );

export const EXPLICIT_TIMEZONE_JSON_SCHEMA = {
  type: "string",
  description:
    "Optional IANA timezone (e.g. 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London') to use for resolving AND confirming this specific time. ONLY include when the user explicitly names a timezone, city, or region different from their own — e.g. 'call me at 9am Tokyo time', 'remind me at 3pm Pacific time'. Omit entirely otherwise so the user's own account timezone is used; never guess one.",
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

function assertNonNegativeCount(count: number, kind: string): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RelativeTimeResolutionError(
      `Invalid count for ${kind}: ${count} (must be a non-negative integer)`,
    );
  }
}
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

const UTC_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
export function resolveRelativeTime(
  spec: RelativeTimeSpec,
  timezone: string,
  now: Date = new Date(),
): Date {
  const tz = isValidIanaTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
  // minutes-from-now/hours-from-now have no clockTime field at all (a
  // sub-day offset already IS the exact instant), so guard the property
  // access rather than assuming every variant has it.
  assertValidClockTime("clockTime" in spec ? spec.clockTime : undefined);

  switch (spec.kind) {
    case "minutes-from-now": {
      assertPositiveCount(spec.count, "minutes-from-now");
      return new Date(now.getTime() + spec.count * 60_000);
    }
    case "hours-from-now": {
      assertPositiveCount(spec.count, "hours-from-now");
      return new Date(now.getTime() + spec.count * 3_600_000);
    }
    case "days-from-now": {
      // count 0 = "today at clockTime" — models naturally emit this for
      // "call me at 4:45 PM today" (#1110), so it's valid here (only here:
      // a 0-count for the other kinds means "now" and makes no sense as a
      // schedule request). clockTime is mandatory with count 0: the 00:01
      // default would resolve to a time already in the past, which the
      // scheduler dispatches immediately.
      assertNonNegativeCount(spec.count, "days-from-now");
      if (spec.count === 0 && !spec.clockTime) {
        throw new RelativeTimeResolutionError(
          'days-from-now count 0 ("today") requires an explicit clockTime',
        );
      }
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
    case "at-clock-time": {
      // Today at that clock time if it's still ahead of `now`, otherwise
      // roll to tomorrow — mirrors next-weekday's "always in the future"
      // convention, but for a bare time of day with no named weekday.
      const todayAt = addLocalDays(tz, now, 0, spec.clockTime);
      return todayAt.getTime() > now.getTime()
        ? todayAt
        : addLocalDays(tz, now, 1, spec.clockTime);
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

export function resolveNaiveIsoInTimeZone(iso: string, tz: string): Date {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(
      iso.trim(),
    );
  if (!m) {
    throw new RelativeTimeResolutionError(
      `Not a valid offset-less ISO datetime: ${iso}`,
    );
  }
  return localDateTimeToUtc(
    tz,
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
}

export function hasUtcOffset(iso: string): boolean {
  return UTC_OFFSET_RE.test(iso.trim());
}
