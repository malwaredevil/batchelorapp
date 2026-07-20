/**
 * eBay Browse API client.
 *
 * Uses the RESTful Browse API to search active listings and retrieve
 * structured item attributes (itemSpecifics / aspect refinements).
 * Requires an OAuth application token — call getEbayAppToken() first.
 *
 * Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */

import { logger } from "../logger";
import { getEbayAppToken } from "./oauth";

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

export interface BrowseAspect {
  name: string;
  /** Top values by listing count, descending */
  values: Array<{ value: string; matchCount: number }>;
}

export interface BrowseSearchResult {
  /** Structured aspect refinements (year, artist, series, theme, etc.) */
  aspects: BrowseAspect[];
  /** Total estimated matching listings */
  total: number;
}

/**
 * Search active eBay listings and return aspect refinement data — the
 * structured attribute distribution across matching items (e.g. Year: 2003 ×5,
 * Artist: Kline-Gaughran ×3). Useful for auto-populating ornament fields from
 * a search query without parsing individual listing titles.
 *
 * Pass `categoryId` to constrain results (11116 = Collectibles > Christmas;
 * omit to search all categories).
 */
export async function searchItemAspects(
  query: string,
  opts: { categoryId?: string; limit?: number } = {},
): Promise<BrowseSearchResult> {
  const token = await getEbayAppToken();

  const params = new URLSearchParams({
    q: query,
    limit: String(opts.limit ?? 5),
    fieldgroups: "ASPECT_REFINEMENTS",
  });
  if (opts.categoryId) params.set("category_ids", opts.categoryId);

  const url = `${BROWSE_BASE}/item_summary/search?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `eBay Browse API error (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as {
    total?: number;
    refinement?: {
      aspectDistributions?: Array<{
        localizedAspectName: string;
        aspectValueDistributions: Array<{
          localizedAspectValue: string;
          matchCount: number;
        }>;
      }>;
    };
  };

  const aspects: BrowseAspect[] = (
    data.refinement?.aspectDistributions ?? []
  ).map((dist) => ({
    name: dist.localizedAspectName,
    values: (dist.aspectValueDistributions ?? [])
      .sort((a, b) => b.matchCount - a.matchCount)
      .slice(0, 5)
      .map((v) => ({
        value: v.localizedAspectValue,
        matchCount: v.matchCount,
      })),
  }));

  logger.info(
    { query, total: data.total ?? 0, aspectCount: aspects.length },
    "ebay browse: searchItemAspects",
  );

  return { aspects, total: data.total ?? 0 };
}

/**
 * Convert a BrowseSearchResult's aspects into a flat key→top-value map.
 * Useful for quick attribute extraction (e.g. { Year: "2003", Theme: "Angel" }).
 */
export function topAspectValues(
  result: BrowseSearchResult,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const aspect of result.aspects) {
    const top = aspect.values[0];
    if (top) out[aspect.name] = top.value;
  }
  return out;
}
