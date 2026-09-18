import { logger } from "./logger";
import { agentphoneRequest } from "./agentphone-http";
import {
  attachPendingOutboundCallId,
  clearPendingOutboundCallContext,
  clearPendingOutboundCallContextByCallId,
  seedOutboundCallContext,
} from "./agentphone-conversation";

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
  const response = await agentphoneRequest(
    "/v1/agents",
    { method: "GET" },
    { op: "list-agents" },
  );
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

async function clearPendingOutboundCallContextBestEffort(
  toNumber: string,
  pendingId: string,
): Promise<void> {
  // A provider failure must not be replaced by a cleanup DB failure. Retry
  // once to close the common transient-DB window; if both attempts fail, log
  // loudly and let the next seed's expiry guard prevent stale reuse.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await clearPendingOutboundCallContext(toNumber, pendingId);
      return;
    } catch (err) {
      if (attempt === 1) {
        logger.error(
          { err, toNumber, pendingId },
          "agentphone: failed to clear outbound call context after provider failure",
        );
      }
    }
  }
}

export interface OutboundCallOptions {
  /** E.164 destination number */
  toNumber: string;
  /**
   * User whose AgentPhone conversation should receive the pending call purpose.
   */
  userId: number;
  /**
   * What Elaine should say after the recipient first speaks. Write in first
   * person — Elaine speaks directly, never attributes the message to anyone else.
   */
  openingMessage: string;
  /** Additional private context Elaine may need after delivering the opening. */
  privateContextNote?: string;
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

export interface PendingOutboundContext {
  phoneNumber: string;
  pendingId: string;
}

export interface OutboundCallResult {
  callId: string;
  contextAttached: boolean;
  pendingOutboundContext?: PendingOutboundContext;
}

/**
 * Initiates an outbound phone call via AgentPhone POST /v1/calls.
 *
 * The call runs in webhook mode — our existing /api/agentphone/webhook handles
 * it, so if the recipient speaks back Elaine continues the conversation
 * naturally using the same engine as inbound calls.
 *
 * Outbound calls deliberately omit AgentPhone's initialGreeting so the line
 * stays silent until the recipient speaks. The intended opening is seeded into
 * the recipient's conversation before the call is placed.
 *
 * Docs: https://docs.agentphone.ai/api-reference/calls/create-outbound-call-v-1-calls-post
 */
export async function initiateOutboundCall(
  opts: OutboundCallOptions,
): Promise<OutboundCallResult> {
  const { agentId, phoneNumberId } = await getAgentCredentials();

  let pendingId: string | null = null;
  try {
    pendingId = await seedOutboundCallContext(
      opts.toNumber,
      opts.userId,
      opts.openingMessage,
      opts.privateContextNote,
    );
  } catch (err) {
    // Never place a call without its correlated purpose. The scheduler can
    // retry through its normal fallback path.
    logger.error({ err }, "agentphone: failed to seed outbound call context");
    throw err;
  }

  const body: Record<string, string> = { agentId, toNumber: opts.toNumber };
  // Explicitly pin the caller-ID number so AgentPhone uses the number
  // currently attached to the agent, not whatever it otherwise treats as
  // the agent's "first assigned" number (which can be a stale/released
  // one). Per AgentPhone's POST /v1/calls docs, the writable selector field
  // is `fromNumberId` — NOT `phoneNumberId` (that name only appears in
  // *responses*, e.g. from GET /v1/calls/:id). Sending `phoneNumberId` in
  // the request body is silently ignored by the API.
  if (phoneNumberId) body.fromNumberId = phoneNumberId;
  body.callScreeningIdentity = opts.callScreeningIdentity ?? "Elaine";
  if (opts.callScreeningPurpose)
    body.callScreeningPurpose = opts.callScreeningPurpose;

  let response: Awaited<ReturnType<typeof agentphoneRequest>>;
  try {
    response = await agentphoneRequest(
      "/v1/calls",
      { method: "POST", body },
      { op: "create-call" },
    );
  } catch (err) {
    if (pendingId)
      await clearPendingOutboundCallContextBestEffort(opts.toNumber, pendingId);
    throw err;
  }
  if (!response.ok) {
    if (pendingId)
      await clearPendingOutboundCallContextBestEffort(opts.toNumber, pendingId);
    const text = await response.text().catch(() => "");
    logger.error(
      { status: response.status, text },
      "agentphone: failed to initiate outbound call",
    );
    throw new Error(
      `AgentPhone: failed to initiate outbound call (status ${response.status})`,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    if (pendingId)
      await clearPendingOutboundCallContextBestEffort(opts.toNumber, pendingId);
    throw new Error("AgentPhone: outbound call returned invalid JSON", {
      cause: err,
    });
  }
  const callId =
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string"
      ? data.id.trim()
      : "";
  if (!callId) {
    if (pendingId)
      await clearPendingOutboundCallContextBestEffort(opts.toNumber, pendingId);
    throw new Error(
      "AgentPhone: outbound call response did not include a call id",
    );
  }
  let contextAttached = false;
  if (pendingId) {
    let attachError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await attachPendingOutboundCallId(opts.toNumber, pendingId, callId);
        contextAttached = true;
        break;
      } catch (err) {
        attachError = err;
      }
    }
    if (!contextAttached) {
      // The provider accepted the call. Leave the single pending purpose in
      // place so the first outbound webhook can atomically self-attach it;
      // there is no assumed cancellation endpoint.
      logger.warn(
        { err: attachError, callId },
        "agentphone: failed to attach outbound call context; webhook recovery will retry",
      );
      return {
        callId,
        contextAttached: false,
        pendingOutboundContext: {
          phoneNumber: opts.toNumber,
          pendingId,
        },
      };
    }
  }
  return { callId, contextAttached };
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

/**
 * Entity-agnostic version of buildReminderCallScript, used by the generic
 * cross-app reminders-scheduler. `contextPhrase` is an optional clause
 * describing what the reminder is attached to (e.g. `, for your trip "Paris"`
 * — include any leading punctuation/wording); omit it for reminders with no
 * parent entity.
 *
 * `hasCalendarEvent` (issue #519): when the reminder is linked to a Google
 * Calendar event, the script mentions that fact so the listener knows to
 * check their calendar — it must NEVER speak the raw URL itself, since a
 * spoken link is useless and TTS engines mangle long tokenized strings.
 *
 * `hasDescription` (issue #521): when the reminder has a description, the
 * script asks whether the caller wants to hear it, rather than reading it
 * unprompted — descriptions can be long, and most callers just want the
 * title and due date. See `richTextToSpeech` for how the description
 * itself gets converted to speech-safe text if they say yes.
 */
export function buildGenericReminderCallScript(
  reminderTitle: string,
  label: string,
  formattedDueDate: string,
  contextPhrase?: string,
  hasCalendarEvent?: boolean,
  hasDescription?: boolean,
): string {
  const calendarPhrase = hasCalendarEvent
    ? " This is linked to an event on your calendar."
    : "";
  const descriptionOffer = hasDescription
    ? " Would you like me to read you the full description?"
    : "";
  return `Hi! I'm calling with a Batchelor reminder. Your reminder "${reminderTitle}" is due in ${label} on ${formattedDueDate}${contextPhrase ?? ""}.${calendarPhrase}${descriptionOffer} Have a great day!`;
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
  pendingContext?: PendingOutboundContext,
): Promise<CallOutcome> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1_000;
  const clearPendingContextBestEffort = async (): Promise<void> => {
    try {
      if (pendingContext) {
        await clearPendingOutboundCallContext(
          pendingContext.phoneNumber,
          pendingContext.pendingId,
        );
      } else {
        await clearPendingOutboundCallContextByCallId(callId);
      }
    } catch (err) {
      logger.warn(
        { err, callId },
        "agentphone: failed to clear terminal outbound call context",
      );
    }
  };

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.6), 4_000);

    try {
      const response = await agentphoneRequest(
        `/v1/calls/${callId}`,
        { method: "GET" },
        { op: "poll-call-outcome", callId },
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
          await clearPendingContextBestEffort();
          return "no-answer";
        }
        return "answered";
      }
      if (status === "no-answer" || status === "busy") {
        await clearPendingContextBestEffort();
        return "no-answer";
      }
      if (status === "failed") {
        await clearPendingContextBestEffort();
        return "error";
      }
      if (status === "voicemail") {
        await clearPendingContextBestEffort();
        return "voicemail";
      }
      // "ringing" / "in-progress" — still live, keep polling
    } catch {
      break; // network error — give up, report "pending"
    }
  }

  return "pending";
}
