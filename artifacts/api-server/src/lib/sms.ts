import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

let cachedFromNumber: string | null = null;

interface AgentPhoneNumber {
  phoneNumber: string;
}

interface AgentPhoneListResponse {
  data: AgentPhoneNumber[];
}

// AgentPhone has exactly one provisioned number for this workspace
// (+14785518975 at time of writing). We look it up lazily (and cache it)
// rather than hardcoding it, so a future re-provision doesn't require a
// code change.
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

export async function sendSms(toNumber: string, body: string): Promise<void> {
  const from = await getFromNumber();
  const response = await connectors.proxy("agentphone", "/v1/messages", {
    method: "POST",
    body: {
      to_number: toNumber,
      from_number: from,
      body,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
      "agentphone: failed to send sms",
    );
    throw new Error(`Failed to send SMS (status ${response.status})`);
  }
}
