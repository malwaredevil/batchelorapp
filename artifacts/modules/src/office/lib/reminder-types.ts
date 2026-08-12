// Shared wire types for the central Reminders page (issue #524). Mirrors the
// generic `reminders` table (lib/db/src/schema/reminders.ts) plus the
// derived fields routes/reminders.ts adds to every row it returns
// (entityLink/channels/isRecurring). Hand-maintained, not codegen'd — same
// convention as AssistantActionType in api-client-react (see
// travels-itinerary-assistant-actions memory).

export type ReminderLeadTimeUnit = "minutes" | "hours" | "days" | "weeks";

export interface ReminderLeadTime {
  value: number;
  unit: ReminderLeadTimeUnit;
}

export type ReminderRecurrenceIntervalUnit =
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

export type ReminderStatus = "active" | "done" | "cancelled";

export type ReminderChannel = "email" | "sms" | "call" | "slack" | "messenger";

export interface ReminderEntityLink {
  type: string;
  id: number;
  url: string;
  label: string;
}

export interface Reminder {
  id: number;
  entityType: string | null;
  entityId: number | null;
  createdByUserId: number;
  title: string;
  description: string | null;
  dueAt: string | null;
  leadTimes: ReminderLeadTime[];
  recurrenceIntervalValue: number | null;
  recurrenceIntervalUnit: ReminderRecurrenceIntervalUnit | null;
  recurrenceWeekday: number | null;
  recurrenceDayOfMonth: number | null;
  recurrenceEndDate: string | null;
  recurrenceMaxOccurrences: number | null;
  recurrenceFiredCount: number;
  calendarConnectionId: number | null;
  googleEventId: string | null;
  googleEventHtmlLink: string | null;
  emailRecipients: string[];
  smsRecipientUserIds: number[];
  callRecipientUserIds: number[];
  slackRecipientUserIds: number[];
  messengerRecipientUserIds: number[];
  status: ReminderStatus;
  elaineActionType: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  entityLink: ReminderEntityLink | null;
  channels: ReminderChannel[];
  isRecurring: boolean;
}

export type RecurrenceMode = "none" | "interval" | "weekday" | "monthly";

export function recurrenceModeOf(r: {
  recurrenceIntervalValue: number | null;
  recurrenceWeekday: number | null;
  recurrenceDayOfMonth: number | null;
}): RecurrenceMode {
  if (r.recurrenceIntervalValue != null) return "interval";
  if (r.recurrenceWeekday != null) return "weekday";
  if (r.recurrenceDayOfMonth != null) return "monthly";
  return "none";
}

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
