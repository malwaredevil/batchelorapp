import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

interface AgentPhoneAgent {
  id: string;
}

interface AgentPhoneListAgentsResponse {
  data: AgentPhoneAgent[];
}

let cachedAgentId: string | null = null;

// Lazily fetches and caches the AgentPhone agent ID for this workspace.
// Mirrors the same pattern as getFromNumber() in sms.ts.
async function getAgentId(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;
  const response = await connectors.proxy("agentphone", "/v1/agents", {
    method: "GET",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
      "agentphone: failed to list agents",
    );
    throw new Error(
      `AgentPhone: failed to list agents (status ${response.status})`,
    );
  }
  const data = (await response.json()) as AgentPhoneListAgentsResponse;
  const agentId = data.data?.[0]?.id;
  if (!agentId) {
    throw new Error("AgentPhone: no agent found in account");
  }
  cachedAgentId = agentId;
  return agentId;
}

export interface OutboundCallOptions {
  /** E.164 destination number */
  toNumber: string;
  /**
   * What Elaine speaks the moment the call is answered. Write in first person —
   * Elaine speaks directly, never attributes the message to anyone else.
   */
  initialGreeting?: string;
  /**
   * What Elaine tells an iOS 26 / Android call-screener when asked who is
   * calling. Defaults to "Elaine" when omitted.
   */
  callScreeningIdentity?: string;
  /**
   * What Elaine tells a call-screener when asked why she is calling.
   */
  callScreeningPurpose?: string;
}

/**
 * Initiates an outbound phone call via AgentPhone POST /v1/calls.
 *
 * The call runs in webhook mode — our existing /api/agentphone/webhook handles
 * it, so if the recipient speaks back Elaine continues the conversation
 * naturally using the same engine as inbound calls.
 *
 * initialGreeting is spoken as soon as the recipient answers.
 *
 * Docs: https://docs.agentphone.ai/api-reference/calls/create-outbound-call-v-1-calls-post
 */
export async function initiateOutboundCall(
  opts: OutboundCallOptions,
): Promise<{ callId: string }> {
  const agentId = await getAgentId();

  const body: Record<string, string> = { agentId, toNumber: opts.toNumber };
  if (opts.initialGreeting) body.initialGreeting = opts.initialGreeting;
  body.callScreeningIdentity = opts.callScreeningIdentity ?? "Elaine";
  if (opts.callScreeningPurpose)
    body.callScreeningPurpose = opts.callScreeningPurpose;

  const response = await connectors.proxy("agentphone", "/v1/calls", {
    method: "POST",
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
      "agentphone: failed to initiate outbound call",
    );
    throw new Error(
      `AgentPhone: failed to initiate outbound call (status ${response.status})`,
    );
  }
  const data = (await response.json()) as { id?: string };
  return { callId: data.id ?? "unknown" };
}

/**
 * Compose a spoken reminder greeting for use with initiateOutboundCall.
 * Written in first person so Elaine speaks it naturally.
 */
export function buildReminderCallScript(
  reminderTitle: string,
  tripTitle: string,
  tripDestination: string,
  label: string,
  formattedDueDate: string,
): string {
  return `Hi! I'm calling with a Batchelor Travels reminder. Your reminder "${reminderTitle}" is due in ${label} on ${formattedDueDate}, for your trip "${tripTitle}" to ${tripDestination}. Have a great trip!`;
}

// AgentPhone outbound calls are available whenever the connector proxy can
// resolve. Kept as a named export to mirror smsConfigured() and give
// callers/UI a single place to gate on.
export function callsConfigured(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Outcome polling — optional best-effort status check after initiateOutboundCall.
// Poll-based because AgentPhone delivers status via the call lifecycle, not a
// synchronous create-call response. Resolves as soon as we see a terminal
// status, or returns "pending" when the timeout expires.
// ---------------------------------------------------------------------------

export type CallOutcome =
  | "answered"
  | "voicemail"
  | "no-answer"
  | "error"
  | "pending";

/**
 * Poll AgentPhone GET /v1/calls/{callId} until a terminal status is reached
 * or timeoutMs elapses. Uses short exponential backoff (1 s → 2 s → 3 s …).
 *
 * Terminal statuses (AgentPhone lifecycle):
 *   completed  → answered (recipient or voicemail engaged Elaine)
 *   no-answer  → no-answer
 *   busy       → no-answer (treated as "not reached")
 *   failed     → error
 *
 * Returns "pending" when the timeout fires before a terminal status appears.
 * All network errors are swallowed — callers should treat "pending" gracefully.
 */
export async function waitForCallOutcome(
  callId: string,
  timeoutMs = 12_000,
): Promise<CallOutcome> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.6), 4_000);

    try {
      const response = await connectors.proxy(
        "agentphone",
        `/v1/calls/${callId}`,
        { method: "GET" },
      );
      if (!response.ok) break; // unexpected error — stop polling
      const data = (await response.json()) as {
        status?: string;
        durationSeconds?: number;
      };
      const status = (data.status ?? "").toLowerCase().replace(/_/g, "-");
      const duration = data.durationSeconds ?? 0;
      // AgentPhone marks immediately-ended calls as "completed" with 0 duration
      // (e.g. call blocked by screening). Only treat it as answered if the call
      // actually had voice time.
      if (status === "completed")
        return duration > 0 ? "answered" : "no-answer";
      if (status === "no-answer" || status === "busy") return "no-answer";
      if (status === "failed") return "error";
      if (status === "voicemail") return "voicemail";
      // "ringing" / "in-progress" — still live, keep polling
    } catch {
      break; // network error — give up, report "pending"
    }
  }

  return "pending";
}
