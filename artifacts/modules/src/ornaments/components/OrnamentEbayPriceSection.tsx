/**
 * OrnamentEbayPriceSection
 *
 * Renders the eBay market-data rows on the ornament detail page.
 * Extracted from detail.tsx so the label wording ("eBay — For Sale Now"
 * vs "eBay — Last Sold") can be unit-tested independently of the full page.
 *
 * When `onForceRefresh` is provided, a "Force refresh" button appears
 * whenever any cached eBay data is displayed — for-sale, last-sold, or the
 * empty fallback — so the user can always bypass the 7-day cache and trigger
 * a fresh Apify run regardless of which data branch is rendered.
 */

import { RefreshCcw } from "lucide-react";
import { CollectionDetailField } from "@workspace/collection-ui";

interface OrnamentEbayPriceSectionProps {
  ebayPriceMinUsd?: number | string | null;
  ebayPriceMaxUsd?: number | string | null;
  ebayLastSoldPriceUsd?: number | string | null;
  ebayPriceCachedAt?: string | Date | null;
  ebayLastSoldDate?: string | Date | null;
  /** Called when the user clicks the force-refresh button. */
  onForceRefresh?: () => void;
  /** True while a force-refresh Apify run is in flight. */
  forceRefreshing?: boolean;
}

function formatCurrency(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString();
}

export function OrnamentEbayPriceSection({
  ebayPriceMinUsd,
  ebayPriceMaxUsd,
  ebayLastSoldPriceUsd,
  ebayPriceCachedAt,
  ebayLastSoldDate,
  onForceRefresh,
  forceRefreshing,
}: OrnamentEbayPriceSectionProps) {
  const hasEbayForSale = ebayPriceMinUsd != null && ebayPriceMaxUsd != null;
  const hasEbayLastSold = ebayLastSoldPriceUsd != null;
  const hasEbayData = ebayPriceCachedAt != null || ebayLastSoldPriceUsd != null;

  if (!hasEbayForSale && !hasEbayLastSold && !hasEbayData) return null;

  /** Force-refresh button, shown on every cached-data branch. */
  const forceRefreshButton = onForceRefresh ? (
    <button
      onClick={onForceRefresh}
      disabled={forceRefreshing}
      title="Force refresh — bypass cache and run a fresh eBay lookup"
      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
    >
      <RefreshCcw
        className={`h-3 w-3 ${forceRefreshing ? "animate-spin" : ""}`}
      />
      Force refresh
    </button>
  ) : null;

  return (
    <>
      {hasEbayForSale && (
        <CollectionDetailField
          label="eBay — For Sale Now"
          tooltip="The price range of active eBay listings found for this ornament — what sellers are currently asking, not a confirmed sale price."
          value={
            <span className="flex items-center gap-2 flex-wrap">
              <span>
                {formatCurrency(ebayPriceMinUsd)} –{" "}
                {formatCurrency(ebayPriceMaxUsd)}
                {ebayPriceCachedAt && (
                  <span className="text-xs text-muted-foreground font-normal ml-1.5">
                    · updated {formatDate(ebayPriceCachedAt)}
                  </span>
                )}
              </span>
              {forceRefreshButton}
            </span>
          }
        />
      )}

      {hasEbayLastSold && (
        <CollectionDetailField
          label="eBay — Last Sold"
          tooltip="The price of the most recent completed eBay sale found for this ornament."
          value={
            <span className="flex items-center gap-2 flex-wrap">
              <span>
                {formatCurrency(ebayLastSoldPriceUsd)}
                {ebayLastSoldDate && (
                  <span className="text-xs text-muted-foreground font-normal ml-1.5">
                    · {formatDate(ebayLastSoldDate)}
                  </span>
                )}
              </span>
              {/* Show force-refresh on last-sold-only rows (no for-sale data) so
                  users can always bypass the cache regardless of which branch
                  the item's data falls into. */}
              {!hasEbayForSale && forceRefreshButton}
            </span>
          }
        />
      )}

      {hasEbayData && !hasEbayForSale && !hasEbayLastSold && (
        <CollectionDetailField
          label="eBay Market"
          value={
            <span className="flex items-center gap-2 flex-wrap">
              <span>No active listings found</span>
              {forceRefreshButton}
            </span>
          }
          empty
        />
      )}
    </>
  );
}
