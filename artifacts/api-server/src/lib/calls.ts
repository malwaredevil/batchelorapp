import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

interface AgentPhoneNumber {
  id: string;
  phoneNumber: string;
}

interface AgentPhoneAgent {
  id: string;
  numbers?: AgentPhoneNumber[];
}

interface AgentPhoneListAgentsResponse {
  data: AgentPhoneAgent[];
}

interface AgentCredentials {
  agentId: string;
  /** ID of the phone number currently attached to this agent. Passed as
   *  `fromNumberId` on outbound calls so AgentPhone uses the right number
   *  as caller ID rather than whichever number it otherwise treats as the
   *  agent's "first assigned" number (which can be a stale/released one). */
  phoneNumberId: string | null;
}

interface CachedCredentials {
  credentials: AgentCredentials;
  /** Unix timestamp (ms) after which the cache entry is considered stale. */
  expiresAt: number;
}

/** TTL for the agent-credentials cache: 10 minutes. */
const CREDENTIALS_TTL_MS = 10 * 60 * 1_000;

let cachedCredentials: CachedCredentials | null = null;

// Lazily fetches and caches the AgentPhone agent ID and its current phone
// number for this workspace. The cache has a 10-minute TTL so that number
// changes (e.g. after an account upgrade) are picked up automatically without
// requiring a server restart.
async function getAgentCredentials(): Promise<AgentCredentials> {
  if (cachedCredentials && Date.now() < cachedCredentials.expiresAt) {
    return cachedCredentials.credentials;
  }
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
  const agent = data.data?.[0];
  if (!agent?.id) {
    throw new Error("AgentPhone: no agent found in account");
  }
  cachedCredentials = {
    credentials: {
      agentId: agent.id,
      phoneNumberId: agent.numbers?.[0]?.id ?? null,
    },
    expiresAt: Date.now() + CREDENTIALS_TTL_MS,
  };
  return cachedCredentials.credentials;
}

/**
 * Clears the cached agent credentials so the next call to
 * {@link getAgentCredentials} refetches from the AgentPhone API. Call this
 * when a call outcome suggests the cached number may be stale (e.g. 0-duration
 * "completed" that was likely screened due to a wrong caller-ID).
 */
export function clearAgentCredentialsCache(): void {
  cachedCredentials = null;
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
  const { agentId, phoneNumberId } = await getAgentCredentials();

  const body: Record<string, string> = { agentId, toNumber: opts.toNumber };
  // Explicitly pin the caller-ID number so AgentPhone uses the number
  // currently attached to the agent, not whatever it otherwise treats as
  // the agent's "first assigned" number (which can be a stale/released
  // one). Per AgentPhone's POST /v1/calls docs, the writable selector field
  // is `fromNumberId` — NOT `phoneNumberId` (that name only appears in
  // *responses*, e.g. from GET /v1/calls/:id). Sending `phoneNumberId` in
  // the request body is silently ignored by the API.
  if (phoneNumberId) body.fromNumberId = phoneNumberId;
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
      // actually had voice time. On a 0-duration completion the cached phoneNumberId
      // may be stale (old number still in cache after a plan upgrade), so
      // invalidate it so the next call refetches the current number.
      if (status === "completed") {
        if (duration === 0) {
          clearAgentCredentialsCache();
          return "no-answer";
        }
        return "answered";
      }
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
