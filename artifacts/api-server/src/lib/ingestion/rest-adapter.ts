/**
 * REST API ingestion adapter (#230).
 *
 * Fetches items from a paginated REST endpoint. Used for UPCitemdb and
 * similar public/private REST APIs. Uses ssrfSafeFetch so destinations are
 * validated against the internal-IP blocklist.
 */

import { fetchJsonSafe } from "../ssrf-safe-fetch";
import type {
  IngestionAdapter,
  IngestionAdapterConfig,
  IngestionContext,
  IngestionItem,
} from "./types";

export interface RestAdapterConfig extends IngestionAdapterConfig {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  itemsPath?: string;
  sourceKeyPath?: string;
  paginationStyle?: "none" | "offset" | "cursor";
  pageSize?: number;
  maxItems?: number;
  timeoutMs?: number;
}

function extractPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const parts = path.split(".");
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

export class RestAdapter implements IngestionAdapter {
  readonly adapterType = "rest";

  async *fetchItems(
    config: IngestionAdapterConfig,
    _context: IngestionContext,
  ): AsyncGenerator<IngestionItem> {
    const cfg = config as RestAdapterConfig;
    const maxItems = cfg.maxItems ?? 500;
    const pageSize = cfg.pageSize ?? 50;
    const timeoutMs = cfg.timeoutMs ?? 10_000;
    const sourceKeyPath = cfg.sourceKeyPath ?? "id";

    let offset = 0;
    let fetched = 0;

    while (fetched < maxItems) {
      const url = new URL(cfg.url);
      if (cfg.params) {
        for (const [k, v] of Object.entries(cfg.params)) {
          url.searchParams.set(k, v);
        }
      }
      if (cfg.paginationStyle === "offset") {
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(pageSize));
      }

      let data: unknown;
      try {
        data = await fetchJsonSafe(url.toString(), {
          headers: cfg.headers,
          timeoutMs,
        });
      } catch {
        break;
      }
      const items = cfg.itemsPath ? extractPath(data, cfg.itemsPath) : data;

      if (!Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        const sourceKey = String(
          extractPath(item, sourceKeyPath) ?? `item-${fetched}`,
        );
        yield {
          sourceKey,
          normalizedData: item as Record<string, unknown>,
        };
        fetched++;
        if (fetched >= maxItems) break;
      }

      if (items.length < pageSize || cfg.paginationStyle === "none") break;
      offset += pageSize;
    }
  }
}
