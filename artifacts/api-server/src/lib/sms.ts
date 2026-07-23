import { ReplitConnectors } from "@replit/connectors-sdk";
import { eq } from "drizzle-orm";
import { db, appUsers } from "@workspace/db";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

let cachedFromNumber: string | null = null;

interface AgentPhoneNumber {
  phoneNumber: string;
}

interface AgentPhoneListResponse {
  data: AgentPhoneNumber[];
}

// AgentPhone has exactly one provisioned number for this workspace.
// We look it up lazily (and cache it) rather than hardcoding it, so a
// future re-provision doesn't require a code change.
async function getFromNumber(): Promise<string> {
  if (cachedFromNumber) {
    return cachedFromNumber;
  }
  const response = await connectors.proxy("agentphone", "/v1/numbers", {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
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
  cachedFromNumber = number;
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
export async function sendSms(
  toNumber: string,
  body: string,
  options?: { bypassOptOutCheck?: boolean },
): Promise<void> {
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
      logger.info(
        { toNumber },
        "agentphone: skipping send to opted-out number",
      );
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
  const response = await connectors.proxy("agentphone", "/v1/messages", {
    method: "POST",
    body: {
      to_number: toNumber,
      from_number: from,
      body: messageBody,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
      "agentphone: failed to send sms",
    );
    if (response.status === 403 && text.includes("10DLC")) {
      throw new SmsRegistrationPendingError();
    }
    throw new Error(`Failed to send SMS (status ${response.status})`);
  }

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
          { err, toNumber },
          "agentphone: failed to record first outbound SMS timestamp",
        ),
      );
  }
}
