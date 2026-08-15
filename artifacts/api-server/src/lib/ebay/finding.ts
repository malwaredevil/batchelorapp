/**
 * eBay Finding API client.
 *
 * Uses the official Finding API (v1.13) to search completed/sold listings and
 * look up items by UPC/product ID. No OAuth required — the App ID is passed
 * directly as the SECURITY-APPNAME header.
 *
 * Docs: https://developer.ebay.com/devzone/finding/callref/index.html
 *
 * Troubleshooting 418 / empty-body errors from svcs.ebay.com
 * -----------------------------------------------------------
 * eBay's WAF blocks headless fetch calls that lack a User-Agent header. All
 * requests here set `User-Agent: Batchelor-App/1.0` to avoid bot-detection
 * rejections. If you still see 418 or 403 responses:
 *   1. Verify EBAY_APP_ID is current and active in the eBay Developer Portal.
 *   2. Check the eBay Developer site for Finding API deprecation notices.
 *   3. Use the /api/admin/integrations/health endpoint to run a live probe.
 */

import { env } from "../env";
import { logger } from "../logger";

const FINDING_BASE = "https://svcs.ebay.com/services/search/FindingService/v1";

/**
 * User-Agent sent with every Finding API request.
 * eBay's WAF rejects requests without a recognisable User-Agent, returning
 * 418 or 403 with an empty body. A fixed string is sufficient to pass the
 * check — we do not need to impersonate a browser.
 */
const FINDING_USER_AGENT = "Batchelor-App/1.0";

/** eBay Finding API arrays always wrap a single value — unwrap it. */
function first<T>(arr: T[] | undefined): T | undefined {
  return arr?.[0];
}

/** Parse eBay's `currentPrice` object: `{ "__value__": "12.50", "@currencyId": "USD" }` */
function parseEbayPrice(
  priceObj: Record<string, string> | undefined,
): number | null {
  if (!priceObj) return null;
  const raw = priceObj["__value__"];
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface FindingListing {
  itemId: string;
  title: string;
  soldPrice: number;
  currency: string;
  soldDate: string | null;
  condition: string | null;
  imageUrl: string | null;
  itemUrl: string | null;
}

export interface FindingActiveListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string | null;
  imageUrl: string | null;
  itemUrl: string | null;
}

type FindingItem = Record<string, unknown[]>;

function parseListing(item: FindingItem): FindingListing | null {
  const selling = first(
    item["sellingStatus"] as Record<string, unknown[]>[] | undefined,
  );
  const priceRaw = first(
    selling?.["currentPrice"] as Record<string, string>[] | undefined,
  );
  const price = parseEbayPrice(priceRaw);
  if (!price) return null;

  const currency = priceRaw?.["@currencyId"] ?? "USD";
  const listingInfo = first(
    item["listingInfo"] as Record<string, unknown[]>[] | undefined,
  );
  const endTime = first(listingInfo?.["endTime"] as string[] | undefined);
  const conditionObj = first(
    item["condition"] as Record<string, string[]>[] | undefined,
  );
  const condition = first(conditionObj?.["conditionDisplayName"]) ?? null;

  return {
    itemId: String(first(item["itemId"] as string[] | undefined) ?? ""),
    title: String(first(item["title"] as string[] | undefined) ?? ""),
    soldPrice: price,
    currency: String(currency),
    soldDate: endTime ?? null,
    condition,
    imageUrl: first(item["galleryURL"] as string[] | undefined) ?? null,
    itemUrl: first(item["viewItemURL"] as string[] | undefined) ?? null,
  };
}

function parseActiveListing(item: FindingItem): FindingActiveListing | null {
  const selling = first(
    item["sellingStatus"] as Record<string, unknown[]>[] | undefined,
  );
  const priceRaw = first(
    selling?.["currentPrice"] as Record<string, string>[] | undefined,
  );
  const price = parseEbayPrice(priceRaw);
  if (!price) return null;

  const currency = priceRaw?.["@currencyId"] ?? "USD";
  const conditionObj = first(
    item["condition"] as Record<string, string[]>[] | undefined,
  );
  const condition = first(conditionObj?.["conditionDisplayName"]) ?? null;

  return {
    itemId: String(first(item["itemId"] as string[] | undefined) ?? ""),
    title: String(first(item["title"] as string[] | undefined) ?? ""),
    price,
    currency: String(currency),
    condition,
    imageUrl: first(item["galleryURL"] as string[] | undefined) ?? null,
    itemUrl: first(item["viewItemURL"] as string[] | undefined) ?? null,
  };
}

/**
 * Search eBay completed/sold listings by keyword query.
 * Returns up to `maxItems` sold listings sorted by most-recently-ended.
 *
 * @param daysBack  When provided, restricts results to listings that ended
 *   within the past N days (e.g. 730 = 2 years). Omit for all-time results.
 */
export async function findCompletedItems(
  query: string,
  maxItems = 20,
  daysBack?: number,
): Promise<FindingListing[]> {
  const appId = env.ebayAppId;
  if (!appId) throw new Error("EBAY_APP_ID not configured");

  const endTimeFrom = daysBack
    ? new Date(Date.now() - daysBack * 86_400_000).toISOString()
    : null;

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    keywords: query,
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    sortOrder: "EndTimeSoonest",
    "paginationInput.entriesPerPage": String(Math.min(maxItems, 100)),
  });
  if (endTimeFrom) {
    params.set("itemFilter(1).name", "EndTimeFrom");
    params.set("itemFilter(1).value", endTimeFrom);
  }

  const url = `${FINDING_BASE}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      "X-EBAY-SOA-SECURITY-APPNAME": appId,
      // eBay's WAF rejects headless requests without a User-Agent, returning
      // 418 with an empty body. Providing a fixed string bypasses the block.
      "User-Agent": FINDING_USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error(
      {
        status: resp.status,
        statusText: resp.statusText,
        query,
        // Avoid leaking the full app ID in logs; show only the prefix
        appIdPrefix: appId.slice(0, 8) + "…",
        responseBody: text.slice(0, 500),
        hint:
          resp.status === 418 || resp.status === 403
            ? "WAF/bot-detection block — verify EBAY_APP_ID in the Developer Portal and check the integrations health panel"
            : undefined,
      },
      "ebay finding: non-ok response from findCompletedItems",
    );
    throw new Error(
      `eBay Finding API error (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const response = first(
    data["findCompletedItemsResponse"] as
      | Record<string, unknown[]>[]
      | undefined,
  );

  const ack = first(response?.["ack"] as string[] | undefined);
  if (ack !== "Success" && ack !== "Warning") {
    const errMsg = first(
      (
        first(
          response?.["errorMessage"] as Record<string, unknown[]>[] | undefined,
        ) as Record<string, unknown[]> | undefined
      )?.["error"] as string[] | undefined,
    );
    logger.warn({ ack, errMsg, query }, "ebay finding: non-success ack");
    return [];
  }

  const searchResult = first(
    response?.["searchResult"] as Record<string, unknown[]>[] | undefined,
  );
  const items = (searchResult?.["item"] as FindingItem[] | undefined) ?? [];

  const listings: FindingListing[] = [];
  for (const item of items) {
    const parsed = parseListing(item);
    if (parsed) listings.push(parsed);
  }

  logger.info(
    { query, found: listings.length },
    "ebay finding: findCompletedItems",
  );
  return listings;
}

/**
 * Search eBay active listings by UPC/EAN product ID.
 * Returns matching active listings with current prices.
 */
export async function findItemsByUpc(
  upc: string,
  maxItems = 10,
): Promise<FindingActiveListing[]> {
  const appId = env.ebayAppId;
  if (!appId) throw new Error("EBAY_APP_ID not configured");

  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsByProduct",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "productId.@type": "UPC",
    productId: upc,
    "paginationInput.entriesPerPage": String(Math.min(maxItems, 100)),
  });

  const url = `${FINDING_BASE}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      "X-EBAY-SOA-SECURITY-APPNAME": appId,
      "User-Agent": FINDING_USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error(
      {
        status: resp.status,
        statusText: resp.statusText,
        upc,
        appIdPrefix: appId.slice(0, 8) + "…",
        responseBody: text.slice(0, 500),
        hint:
          resp.status === 418 || resp.status === 403
            ? "WAF/bot-detection block — verify EBAY_APP_ID in the Developer Portal and check the integrations health panel"
            : undefined,
      },
      "ebay finding: non-ok response from findItemsByProduct",
    );
    throw new Error(
      `eBay Finding API (findItemsByProduct) error (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const response = first(
    data["findItemsByProductResponse"] as
      | Record<string, unknown[]>[]
      | undefined,
  );

  const ack = first(response?.["ack"] as string[] | undefined);
  if (ack !== "Success" && ack !== "Warning") {
    return [];
  }

  const searchResult = first(
    response?.["searchResult"] as Record<string, unknown[]>[] | undefined,
  );
  const items = (searchResult?.["item"] as FindingItem[] | undefined) ?? [];

  const listings: FindingActiveListing[] = [];
  for (const item of items) {
    const parsed = parseActiveListing(item);
    if (parsed) listings.push(parsed);
  }

  logger.info({ upc, found: listings.length }, "ebay finding: findItemsByUpc");
  return listings;
}

/**
 * Lightweight probe for the Finding API health check.
 *
 * Sends a minimal `findCompletedItems` request (1 result, simple keyword) and
 * returns `{ ok, status, detail }`. Never throws — designed to be called from
 * the integrations-health endpoint without disrupting other checks.
 *
 * This exercises the actual Finding API endpoint end-to-end, not just OAuth,
 * so it catches WAF blocks and quota exhaustion that the OAuth check misses.
 */
export async function probeFindingApi(appId: string): Promise<{
  ok: boolean;
  status?: number;
  detail?: string;
}> {
  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    keywords: "Hallmark ornament",
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "paginationInput.entriesPerPage": "1",
  });

  try {
    const resp = await fetch(`${FINDING_BASE}?${params.toString()}`, {
      headers: {
        "X-EBAY-SOA-SECURITY-APPNAME": appId,
        "User-Agent": FINDING_USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return {
        ok: false,
        status: resp.status,
        detail: `HTTP ${resp.status}: ${text.slice(0, 200) || resp.statusText}`,
      };
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const response = first(
      data["findCompletedItemsResponse"] as
        | Record<string, unknown[]>[]
        | undefined,
    );
    const ack = first(response?.["ack"] as string[] | undefined);
    if (ack === "Success" || ack === "Warning") {
      return { ok: true, status: resp.status };
    }
    return {
      ok: false,
      status: resp.status,
      detail: `ack=${ack ?? "missing"} — app ID may be invalid or quota exceeded`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
