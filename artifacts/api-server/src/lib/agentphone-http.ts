import { env } from "./env";
import { logger } from "./logger";

// Direct AgentPhone API client, authenticated with AGENTPHONE_API_KEY.
//
// This intentionally does NOT go through @replit/connectors-sdk's
// connectors.proxy("agentphone", ...). That path resolves credentials via a
// separate Replit-managed connection that is NOT the same secret as
// AGENTPHONE_API_KEY and does not track rotations made on AgentPhone's own
// dashboard — rotating the key there and updating AGENTPHONE_API_KEY here
// left connectors.proxy silently authenticating with the old, now-invalid
// key (401 "failed to list agents"), even immediately after a restart.
// Calling api.agentphone.ai directly with AGENTPHONE_API_KEY (the same
// pattern already used by the admin integrations-health check) means there
// is exactly one place to update on a key rotation.
const BASE_URL = "https://api.agentphone.ai";

// Per AgentPhone's error-handling / best-practices docs, transient errors
// (429, 500, 502, 503, 504) should be retried with exponential backoff; a
// 429 should additionally honor the `Retry-After` header when present.
// Their own TypeScript SDK does this automatically (2 retries by default) —
// this mirrors the same policy for our direct fetch calls.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

export interface AgentphoneRequestInit {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * Calls `https://api.agentphone.ai<path>` with the workspace's
 * AGENTPHONE_API_KEY as a bearer token, retrying transient failures
 * (429/500/502/503/504) with exponential backoff (capped at MAX_RETRIES
 * attempts beyond the first). Non-retryable statuses (4xx other than 429)
 * are returned immediately for the caller to handle. Throws if
 * AGENTPHONE_API_KEY is not configured.
 */
export async function agentphoneRequest(
  path: string,
  init: AgentphoneRequestInit,
  logContext: Record<string, unknown> = {},
): Promise<Response> {
  if (!env.agentphoneApiKey) {
    throw new Error("AgentPhone: AGENTPHONE_API_KEY is not configured");
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${BASE_URL}${normalizedPath}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.agentphoneApiKey}`,
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
      return response;
    }
    lastResponse = response;
    if (attempt === MAX_RETRIES) break;

    const retryAfterMs = parseRetryAfterMs(response);
    const backoffMs = retryAfterMs ?? BASE_DELAY_MS * 2 ** attempt;
    logger.warn(
      { ...logContext, path, status: response.status, attempt, backoffMs },
      "agentphone: retrying after transient error",
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  return lastResponse as Response;
}
