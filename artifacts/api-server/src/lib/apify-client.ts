/**
 * Thin Apify API client for running actors synchronously.
 *
 * Starts an actor run, polls until SUCCEEDED (or deadline), and returns the
 * dataset items. Uses `env.apifyApiToken` which is sourced from the Apify
 * integration connection already configured in this workspace.
 */

import { logger } from "./logger";

const APIFY_BASE = "https://api.apify.com/v2";

export interface ApifyRunOptions {
  /** Maximum wait time in ms (default: 120_000). */
  timeoutMs?: number;
  /** Poll interval in ms (default: 3_000). */
  pollIntervalMs?: number;
  /** Maximum items to fetch from the dataset (default: 50). */
  maxItems?: number;
  /** Memory (MB) to allocate for the run (default: 256). */
  memoryMbytes?: number;
}

/**
 * Run an Apify actor synchronously and return its dataset items.
 *
 * @param actorId  Actor ID in "owner/name" or "owner~name" form.
 * @param input    Input object passed verbatim to the actor.
 * @param apiToken Apify API token (pass `env.apifyApiToken`).
 * @param options  Optional tuning parameters.
 */
export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  apiToken: string,
  options: ApifyRunOptions = {},
): Promise<Record<string, unknown>[]> {
  const {
    timeoutMs = 120_000,
    pollIntervalMs = 3_000,
    maxItems = 50,
    memoryMbytes = 256,
  } = options;

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  // Start run
  const runResp = await fetch(
    `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, __memoryMbytes: undefined }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!runResp.ok) {
    const text = await runResp.text();
    throw new Error(
      `Apify actor start failed (${runResp.status}): ${text.slice(0, 300)}`,
    );
  }

  const runData = (await runResp.json()) as {
    data: { id: string; status: string; defaultDatasetId: string };
  };
  const { id: runId, defaultDatasetId } = runData.data;

  logger.info({ actorId, runId }, "apify: actor run started");

  // Poll for completion
  const deadline = Date.now() + timeoutMs;
  let status = "RUNNING";

  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Apify actor run timed out after ${timeoutMs}ms (run ${runId})`,
      );
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const statusResp = await fetch(
      `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs/${runId}`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );

    if (!statusResp.ok) {
      logger.warn(
        { runId, status: statusResp.status },
        "apify: status poll failed, retrying",
      );
      continue;
    }

    const statusData = (await statusResp.json()) as {
      data: { status: string };
    };
    status = statusData.data.status;
  }

  if (status !== "SUCCEEDED") {
    throw new Error(
      `Apify actor run ended with status "${status}" (run ${runId})`,
    );
  }

  // Fetch dataset
  const itemsResp = await fetch(
    `${APIFY_BASE}/datasets/${defaultDatasetId}/items?limit=${maxItems}&format=json`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );

  if (!itemsResp.ok) {
    throw new Error(`Apify dataset fetch failed: ${itemsResp.status}`);
  }

  const items = (await itemsResp.json()) as Record<string, unknown>[];
  logger.info(
    { actorId, runId, count: items.length },
    "apify: actor run completed",
  );
  return items;
}
