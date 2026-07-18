/**
 * Jina Reader ingestion adapter (#230).
 *
 * Fetches clean text from any URL using Jina AI's Reader API
 * (r.jina.ai/{url}). Useful for ingesting product pages, web articles,
 * and other structured text content without running a full browser.
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

export interface JinaReaderAdapterConfig extends IngestionAdapterConfig {
  url: string;
  timeoutMs?: number;
  returnFormat?: "markdown" | "html" | "text";
  targetSelector?: string;
  waitForSelector?: string;
}

const JINA_READER_BASE = "https://r.jina.ai";

export class JinaReaderAdapter implements IngestionAdapter {
  readonly adapterType = "jina_reader";

  async fetchItems(
    config: IngestionAdapterConfig,
    context: IngestionContext,
  ): Promise<IngestionItem[]> {
    const cfg = config as JinaReaderAdapterConfig;
    const timeoutMs = cfg.timeoutMs ?? 30_000;
    const apiKey = env.jinaApiKey;

    if (!apiKey) {
      throw new Error("JINA_API_KEY is required for the jina_reader adapter");
    }

    const readerUrl = `${JINA_READER_BASE}/${encodeURIComponent(cfg.url)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "X-Return-Format": cfg.returnFormat ?? "markdown",
    };
    if (cfg.targetSelector) {
      headers["X-Target-Selector"] = cfg.targetSelector;
    }
    if (cfg.waitForSelector) {
      headers["X-Wait-For-Selector"] = cfg.waitForSelector;
    }

    logger.info(
      { url: cfg.url, module: context.module, runId: context.runId },
      "ingestion: jina reader fetch started",
    );

    const resp = await fetch(readerUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Jina Reader fetch failed: ${resp.status} ${text.slice(0, 200)}`,
      );
    }

    const data = (await resp.json()) as {
      code?: number;
      status?: number;
      data?: {
        title?: string;
        url?: string;
        content?: string;
        description?: string;
        links?: Record<string, string>;
        images?: Record<string, string>;
      };
    };

    const payload = data.data ?? {};
    const sourceKey = payload.url ?? cfg.url;

    return [
      {
        sourceKey,
        normalizedData: {
          title: payload.title ?? null,
          url: payload.url ?? cfg.url,
          content: payload.content ?? null,
          description: payload.description ?? null,
          links: payload.links ?? {},
          images: payload.images ?? {},
        },
        confidenceScore: 1.0,
      },
    ];
  }
}
