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
