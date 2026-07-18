/**
 * Apify ingestion adapter (#230).
 *
 * Triggers an Apify actor run and streams results from its dataset.
 * Uses the Apify integration connection (already configured in this workspace).
 */

import { logger } from "../logger";
import type {
  IngestionAdapter,
  IngestionAdapterConfig,
  IngestionContext,
  IngestionItem,
} from "./types";

export interface ApifyAdapterConfig extends IngestionAdapterConfig {
  actorId: string;
  actorInput: Record<string, unknown>;
  apiToken: string;
  maxItems?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sourceKeyField?: string;
}

const APIFY_BASE = "https://api.apify.com/v2";

export class ApifyAdapter implements IngestionAdapter {
  readonly adapterType = "apify";

  async fetchItems(
    config: IngestionAdapterConfig,
    context: IngestionContext,
  ): Promise<IngestionItem[]> {
    const cfg = config as ApifyAdapterConfig;
    const timeoutMs = cfg.timeoutMs ?? 300_000;
    const maxItems = cfg.maxItems ?? 1_000;
    const pollIntervalMs = cfg.pollIntervalMs ?? 5_000;
    const sourceKeyField = cfg.sourceKeyField ?? "id";

    const headers = {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json",
    };

    const runResp = await fetch(
      `${APIFY_BASE}/acts/${encodeURIComponent(cfg.actorId)}/runs`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ...cfg.actorInput }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!runResp.ok) {
      const text = await runResp.text();
      throw new Error(
        `Apify actor start failed: ${runResp.status} ${text.slice(0, 200)}`,
      );
    }

    const runData = (await runResp.json()) as {
      data: { id: string; status: string; defaultDatasetId: string };
    };
    const { id: runId, defaultDatasetId } = runData.data;

    logger.info(
      { actorId: cfg.actorId, runId, module: context.module },
      "ingestion: apify actor started",
    );

    const deadline = Date.now() + timeoutMs;
    let status = "RUNNING";

    while (["RUNNING", "READY"].includes(status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const statusResp = await fetch(
        `${APIFY_BASE}/acts/${encodeURIComponent(cfg.actorId)}/runs/${runId}`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!statusResp.ok) break;

      const statusData = (await statusResp.json()) as {
        data: { status: string };
      };
      status = statusData.data.status;
    }

    if (status !== "SUCCEEDED") {
      throw new Error(`Apify actor run ended with status: ${status}`);
    }

    const itemsResp = await fetch(
      `${APIFY_BASE}/datasets/${defaultDatasetId}/items?limit=${maxItems}&format=json`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );

    if (!itemsResp.ok) {
      throw new Error(`Apify dataset fetch failed: ${itemsResp.status}`);
    }

    const rawItems = (await itemsResp.json()) as Record<string, unknown>[];

    return rawItems.map((item, i) => ({
      sourceKey: String(item[sourceKeyField] ?? `${runId}-${i}`),
      normalizedData: item,
    }));
  }
}
