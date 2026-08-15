/**
 * EbayPricePanel — renders the inline eBay market-value result card after a
 * user triggers the "Look up eBay market value" button on the pottery detail
 * page.
 *
 * The `sourceType` field controls label wording so users are never misled
 * about whether the prices reflect completed sales or current asking prices:
 *   - "sold"           → "eBay — Sold Prices"   / "N sales found"
 *   - "active_listing" → "eBay — Asking Prices"  / "N listings for sale"
 *
 * When `fromCache` is true and `onForceRefresh` is provided, a small refresh
 * icon button appears next to the "cached" timestamp so the user can bypass
 * the 7-day cache and trigger a fresh Apify run immediately.
 */

import { RefreshCw, TrendingUp } from "lucide-react";

export interface EbayPricePanelProps {
  priceMinUsd: number;
  priceMedianUsd: number;
  priceMaxUsd: number;
  listingCount: number;
  searchQuery?: string;
  /** "sold" when data comes from Apify sold-listings; "active_listing" when
   *  it falls back to Browse API asking prices. */
  sourceType: "sold" | "active_listing";
  /** True when the result was served from the 7-day cache rather than a fresh run. */
  fromCache?: boolean;
  /** ISO timestamp of when the cached data was originally fetched. */
  cachedAt?: string;
  /** Called when the user clicks the force-refresh button (only shown when fromCache is true). */
  onForceRefresh?: () => void;
  /** True while a force-refresh is in flight. */
  forceRefreshing?: boolean;
  onDismiss: () => void;
}

export function EbayPricePanel({
  priceMinUsd,
  priceMedianUsd,
  priceMaxUsd,
  listingCount,
  searchQuery,
  sourceType,
  fromCache,
  cachedAt,
  onForceRefresh,
  forceRefreshing,
  onDismiss,
}: EbayPricePanelProps) {
  const isSold = sourceType === "sold";

  const heading = isSold ? "eBay — Sold Prices" : "eBay — Asking Prices";
  const listingLabel = isSold
    ? `${listingCount} sale${listingCount !== 1 ? "s" : ""} found`
    : `${listingCount} listing${listingCount !== 1 ? "s" : ""} for sale`;

  const cachedDateStr = cachedAt
    ? new Date(cachedAt).toLocaleDateString()
    : null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4" />
          {heading}
        </p>
        <button
          onClick={onDismiss}
          className="text-amber-500 hover:text-amber-700 text-xs"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-amber-800">
            ${priceMinUsd.toFixed(0)}
          </p>
          <p className="text-[10px] text-amber-600">Low</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-800">
            ${priceMedianUsd.toFixed(0)}
          </p>
          <p className="text-[10px] text-amber-600">Median</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-800">
            ${priceMaxUsd.toFixed(0)}
          </p>
          <p className="text-[10px] text-amber-600">High</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="text-[10px] text-amber-600">
          {listingLabel}
          {searchQuery ? ` · "${searchQuery}"` : ""}
          {fromCache && cachedDateStr ? ` · cached ${cachedDateStr}` : ""}
        </p>
        {fromCache && onForceRefresh && (
          <button
            onClick={onForceRefresh}
            disabled={forceRefreshing}
            title="Force refresh — bypass cache and run a fresh eBay lookup"
            className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-800 disabled:opacity-40"
          >
            <RefreshCw
              className={`h-3 w-3 ${forceRefreshing ? "animate-spin" : ""}`}
            />
            Force refresh
          </button>
        )}
      </div>
    </div>
  );
}
