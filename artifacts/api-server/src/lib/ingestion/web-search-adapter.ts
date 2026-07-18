/**
 * Web search ingestion adapter (#230).
 *
 * Runs a web search using Jina AI's Search API (s.jina.ai) and returns the
 * result pages as IngestionItems. Each result becomes one candidate with
 * title, url, description, and extracted text content.
 *
 * Requires JINA_API_KEY in env (JINA_API_KEY).
 */

import { logger } from "../logger";
import { env } from "../env";
import type {
  IngestionAdapter,
  IngestionAdapterConfig,
  IngestionContext,
  IngestionItem,
} from "./types";

export interface WebSearchAdapterConfig extends IngestionAdapterConfig {
  query: string;
  maxResults?: number;
  site?: string;
  timeoutMs?: number;
  returnFormat?: "markdown" | "html" | "text";
}

const JINA_SEARCH_BASE = "https://s.jina.ai";

export class WebSearchAdapter implements IngestionAdapter {
  readonly adapterType = "web_search";

  async fetchItems(
    config: IngestionAdapterConfig,
    context: IngestionContext,
  ): Promise<IngestionItem[]> {
    const cfg = config as WebSearchAdapterConfig;
    const timeoutMs = cfg.timeoutMs ?? 30_000;
    const maxResults = Math.min(cfg.maxResults ?? 10, 20);
    const apiKey = env.jinaApiKey;

    if (!apiKey) {
      throw new Error("JINA_API_KEY is required for the web_search adapter");
    }

    const query = cfg.site ? `site:${cfg.site} ${cfg.query}` : cfg.query;

    const searchUrl = `${JINA_SEARCH_BASE}/?q=${encodeURIComponent(query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "X-Return-Format": cfg.returnFormat ?? "markdown",
    };

    logger.info(
      { query, module: context.module, runId: context.runId },
      "ingestion: web search started",
    );

    const resp = await fetch(searchUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Jina Search failed: ${resp.status} ${text.slice(0, 200)}`,
      );
    }

    const data = (await resp.json()) as {
      code?: number;
      status?: number;
      data?: Array<{
        title?: string;
        url?: string;
        description?: string;
        content?: string;
      }>;
    };

    const results = (data.data ?? []).slice(0, maxResults);

    logger.info(
      { count: results.length, module: context.module, runId: context.runId },
      "ingestion: web search completed",
    );

    return results.map((r, i) => ({
      sourceKey: r.url ?? `search-result-${i}`,
      normalizedData: {
        title: r.title ?? null,
        url: r.url ?? null,
        description: r.description ?? null,
        content: r.content ?? null,
        query,
        resultIndex: i,
      },
      confidenceScore: Math.max(0.1, 1.0 - i * 0.08),
    }));
  }
}
