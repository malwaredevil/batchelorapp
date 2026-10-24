import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { logger } from "./logger";
import { agentphoneRequest } from "./agentphone-http";

interface AgentPhoneNumber {
  id?: string;
  phoneNumber: string;
}

interface AgentPhoneListResponse {
  data: AgentPhoneNumber[];
}

interface CachedFromNumber {
  number: string;
  id?: string;
  /** Unix timestamp (ms) after which the cache entry is considered stale. */
  expiresAt: number;
}

/** TTL for the cached sending number: 10 minutes. Mirrors the TTL used for
 *  voice caller-ID credentials in calls.ts, so a number rotation (release +
 *  re-provision) is picked up without requiring a server restart. */
const FROM_NUMBER_TTL_MS = 10 * 60 * 1_000;

let cachedFromNumber: CachedFromNumber | null = null;

// AgentPhone has exactly one provisioned number for this workspace.
// We look it up lazily (and cache it with a TTL) rather than hardcoding it,
// so a future re-provision doesn't require a code change or restart.
async function getFromNumber(signal?: AbortSignal): Promise<string> {
  if (cachedFromNumber && Date.now() < cachedFromNumber.expiresAt) {
    return cachedFromNumber.number;
  }
  const response = await agentphoneRequest(
    "/v1/numbers",
    { method: "GET", ...(signal ? { signal, retry: false } : {}) },
    { op: "list-numbers" },
  );
  if (!response.ok) {
    logger.error(
      { status: response.status },
      "agentphone: failed to list phone numbers",
    );
    throw new Error(
      `AgentPhone: failed to list phone numbers (status ${response.status})`,
    );
  }
  const data = (await response.json()) as AgentPhoneListResponse;
  const number = data.data?.[0]?.phoneNumber;
  if (!number) {
    throw new Error("AgentPhone: no provisioned phone number found");
  }
  const id = data.data?.[0]?.id;
  cachedFromNumber = {
    number,
    ...(typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id)
      ? { id }
      : {}),
    expiresAt: Date.now() + FROM_NUMBER_TTL_MS,
  };
  return number;
}

// AgentPhone is available whenever the connector proxy can resolve — there is
// no separate API key secret to check for (unlike Resend), so this always
// returns true in this environment. Kept as a named export to mirror
// resendConfigured() and give callers/UI a single place to gate on.
export function smsConfigured(): boolean {
  return true;
}

export async function sendReminderAlertSms(
  toNumber: string,
  reminderTitle: string,
  tripTitle: string,
  tripDestination: string,
  label: string,
  formattedDueDate: string,
): Promise<void> {
  await sendSms(
    toNumber,
    `Batchelor Travels: "${reminderTitle}" is due in ${label} (${formattedDueDate}) — trip "${tripTitle}" to ${tripDestination}.`,
  );
}

// Entity-agnostic version of sendReminderAlertSms, used by the generic
// cross-app reminders-scheduler. `contextLabel` is an optional short suffix
// describing what the reminder is attached to (e.g. `trip "Paris"`); omit it
// for reminders with no parent entity. `calendarEventUrl` (issue #519) is the
// linked Google Calendar event's own link, included as a plain-text URL when
// present — SMS has no rich-text option.
export async function sendGenericReminderAlertSms(
  toNumber: string,
  reminderTitle: string,
  label: string,
  formattedDueDate: string,
  contextLabel?: string,
  calendarEventUrl?: string | null,
): Promise<void> {
  await sendSms(
    toNumber,
    `Reminder: "${reminderTitle}" is due in ${label} (${formattedDueDate})${contextLabel ? ` — ${contextLabel}` : ""}.${calendarEventUrl ? ` Calendar event: ${calendarEventUrl}` : ""}`,
  );
}

// Thrown when AgentPhone rejects a send because the workspace's A2P 10DLC
// campaign registration is still pending. Distinguishing this from other
// failures lets route handlers surface a clear, actionable message instead
// of a generic "something went wrong".
export class SmsRegistrationPendingError extends Error {
  constructor() {
    super("AgentPhone: outbound SMS is not enabled pending 10DLC registration");
    this.name = "SmsRegistrationPendingError";
  }
}

// Thrown when the recipient number has opted out via STOP/STOPALL/
// UNSUBSCRIBE/CANCEL/END/QUIT (see routes/agentphone.ts) and hasn't since
// re-opted-in with START/UNSTOP/YES. A2P 10DLC compliance requires we send
// nothing further to that number until they text back in.
export class SmsOptedOutError extends Error {
  constructor() {
    super("This phone number has opted out of SMS messages");
    this.name = "SmsOptedOutError";
  }
}

// Single choke point for opted-out enforcement and A2P 10DLC first-message
// compliance. Every existing send path (verification code, test SMS, reminder
// alerts, Elaine responses) goes through sendSms.
//
// `bypassOptOutCheck` is ONLY for carrier-mandated STOP/HELP/START compliance
// responses — those must go out regardless of opt-out state and already
// contain brand name + STOP instructions, so they also bypass the first-
// message compliance header. Never pass it from any other call site.
export interface SmsSendResult {
  messageId?: string;
}

export async function sendSms(
  toNumber: string,
  body: string,
  options?: { bypassOptOutCheck?: boolean },
): Promise<SmsSendResult> {
  const isComplianceReply = options?.bypassOptOutCheck === true;

  let isFirstMessage = false;
  if (!isComplianceReply) {
    const [recipient] = await db
      .select({
        smsOptedOutAt: appUsers.smsOptedOutAt,
        smsFirstOutboundSentAt: appUsers.smsFirstOutboundSentAt,
      })
      .from(appUsers)
      .where(eq(appUsers.phoneNumber, toNumber))
      .limit(1);

    if (recipient?.smsOptedOutAt) {
      logger.info({}, "agentphone: skipping send to opted-out number");
      throw new SmsOptedOutError();
    }

    isFirstMessage = !recipient?.smsFirstOutboundSentAt;
  }

  // A2P 10DLC first-message requirement: the very first outbound SMS to any
  // contact must include (1) brand name, (2) opt-in confirmation, and
  // (3) opt-out instructions. Prepend a short compliance banner so the
  // required elements are always present regardless of the message content.
  const messageBody = isFirstMessage
    ? `Batchelor App: You're opted in to receive household notifications. Msg & data rates may apply. Reply STOP to unsubscribe, HELP for info.\n\n${body}`
    : body;

  const from = await getFromNumber();
  const response = await agentphoneRequest(
    "/v1/messages",
    {
      method: "POST",
      retry: false,
      body: {
        to_number: toNumber,
        from_number: from,
        body: messageBody,
      },
    },
    { op: "send-message" },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error({ status: response.status }, "agentphone: failed to send sms");
    if (response.status === 403 && text.includes("10DLC")) {
      throw new SmsRegistrationPendingError();
    }
    throw new Error(`Failed to send SMS (status ${response.status})`);
  }
  // A successful HTTP response is already an outbound attempt. Missing or
  // malformed metadata must not throw and encourage an accidental resend.
  const result: unknown = await response.json().catch(() => null);
  const id =
    result && typeof result === "object" && "id" in result
      ? result.id
      : undefined;
  const messageId =
    typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id)
      ? id
      : undefined;

  // Record the first outbound timestamp so subsequent messages skip the
  // compliance header. Fire-and-forget: a failure here is non-critical
  // (the worst case is we prepend the header again on the next send).
  if (isFirstMessage) {
    await db
      .update(appUsers)
      .set({ smsFirstOutboundSentAt: new Date() })
      .where(eq(appUsers.phoneNumber, toNumber))
      .catch((err) =>
        logger.error(
          { errorType: err instanceof Error ? err.name : "UnknownError" },
          "agentphone: failed to record first outbound SMS timestamp",
        ),
      );
  }
  return messageId ? { messageId } : {};
}

const SMS_STATUS_CACHE_MS = 30_000;
let statusCache:
  | { expiresAt: number; statuses: Map<string, string> }
  | undefined;
const SMS_PROVIDER_STATUSES = new Set([
  "accepted",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "undelivered",
]);

/** Read-only, bounded lookup. A missing record never means "not sent". */
export async function getSmsMessageStatuses(): Promise<Map<string, string>> {
  if (statusCache && statusCache.expiresAt > Date.now())
    return statusCache.statuses;
  await getFromNumber(AbortSignal.timeout(5_000));
  if (!cachedFromNumber?.id) return new Map();
  const response = await agentphoneRequest(
    `/v1/numbers/${encodeURIComponent(cachedFromNumber.id)}/messages?limit=200`,
    { method: "GET", retry: false, signal: AbortSignal.timeout(5_000) },
    { op: "message-status" },
  );
  if (!response.ok) throw new Error("SMS status lookup unavailable");
  const result: unknown = await response.json();
  const statuses = new Map<string, string>();
  if (
    result &&
    typeof result === "object" &&
    "data" in result &&
    Array.isArray(result.data)
  ) {
    for (const message of result.data.slice(0, 200)) {
      if (!message || typeof message !== "object") continue;
      if (
        message.direction === "outbound" &&
        message.channel === "sms" &&
        typeof message.id === "string" &&
        typeof message.status === "string" &&
        SMS_PROVIDER_STATUSES.has(message.status)
      ) {
        statuses.set(message.id, message.status);
      }
    }
  }
  // Cache only opaque identifiers and allowlisted statuses, never message
  // bodies or phone numbers. Chat receipt polling shares this short cache.
  statusCache = { expiresAt: Date.now() + SMS_STATUS_CACHE_MS, statuses };
  return statuses;
}
