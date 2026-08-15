/**
 * OrnamentEbayPriceSection — label-wording tests.
 *
 * WHY: The ornament detail page stores eBay data in two separate fields:
 *   - ebayLastSoldPriceUsd  → "eBay — Last Sold"   (a completed sale)
 *   - ebayPriceMinUsd/Max   → "eBay — For Sale Now" (an active listing / asking price)
 *
 * These two signals are materially different. If the rendered label
 * silently swaps — e.g. a future refactor shows "Last Sold" data under
 * "For Sale Now" — users make incorrect valuation decisions.
 *
 * These tests assert:
 *   1. "eBay — Last Sold" appears only when ebayLastSoldPriceUsd is present.
 *   2. "eBay — For Sale Now" appears only when the price range is present.
 *   3. Neither label silently replaces the other.
 *   4. Both sections can coexist when both fields are present.
 *   5. A "no listings" fallback appears when ebayPriceCachedAt is set but
 *      neither price field is populated.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { OrnamentEbayPriceSection } from "./OrnamentEbayPriceSection";

// lucide-react icons don't render meaningful text in jsdom — stub them out.
vi.mock("lucide-react", () => ({
  Lock: () => null,
  Unlock: () => null,
  RefreshCcw: () => null,
}));

// @workspace/collection-ui pulls in Tailwind-dependent CSS utilities. The
// only piece used here is CollectionDetailField which renders a <p> label
// — no special mocking required; jsdom handles plain HTML fine.

describe("OrnamentEbayPriceSection — label wording", () => {
  it('shows "eBay — Last Sold" when ebayLastSoldPriceUsd is present', () => {
    render(<OrnamentEbayPriceSection ebayLastSoldPriceUsd={45.0} />);
    expect(screen.getByText("eBay — Last Sold")).toBeInTheDocument();
  });

  it('does NOT show "eBay — Last Sold" when ebayLastSoldPriceUsd is absent', () => {
    render(
      <OrnamentEbayPriceSection
        ebayPriceMinUsd={20}
        ebayPriceMaxUsd={50}
        ebayLastSoldPriceUsd={null}
      />,
    );
    expect(screen.queryByText("eBay — Last Sold")).not.toBeInTheDocument();
  });

  it('shows "eBay — For Sale Now" when the price range is present', () => {
    render(
      <OrnamentEbayPriceSection ebayPriceMinUsd={20} ebayPriceMaxUsd={50} />,
    );
    expect(screen.getByText("eBay — For Sale Now")).toBeInTheDocument();
  });

  it('does NOT show "eBay — For Sale Now" when the price range is absent', () => {
    render(<OrnamentEbayPriceSection ebayLastSoldPriceUsd={45.0} />);
    expect(screen.queryByText("eBay — For Sale Now")).not.toBeInTheDocument();
  });

  it("labels do not swap — last-sold data never appears under the for-sale label", () => {
    // Only last-sold data is present; the for-sale label must be absent.
    render(<OrnamentEbayPriceSection ebayLastSoldPriceUsd={99.99} />);
    expect(screen.getByText("eBay — Last Sold")).toBeInTheDocument();
    expect(screen.queryByText("eBay — For Sale Now")).not.toBeInTheDocument();
  });

  it("labels do not swap — for-sale data never appears under the last-sold label", () => {
    // Only for-sale data is present; the last-sold label must be absent.
    render(
      <OrnamentEbayPriceSection ebayPriceMinUsd={10} ebayPriceMaxUsd={30} />,
    );
    expect(screen.getByText("eBay — For Sale Now")).toBeInTheDocument();
    expect(screen.queryByText("eBay — Last Sold")).not.toBeInTheDocument();
  });

  it("renders both sections when both fields are populated", () => {
    render(
      <OrnamentEbayPriceSection
        ebayPriceMinUsd={20}
        ebayPriceMaxUsd={50}
        ebayLastSoldPriceUsd={35.0}
      />,
    );
    expect(screen.getByText("eBay — For Sale Now")).toBeInTheDocument();
    expect(screen.getByText("eBay — Last Sold")).toBeInTheDocument();
  });

  it("renders the formatted price range in the for-sale section", () => {
    render(
      <OrnamentEbayPriceSection ebayPriceMinUsd={20} ebayPriceMaxUsd={50} />,
    );
    expect(screen.getByText(/\$20\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
  });

  it("renders the formatted last-sold price in the last-sold section", () => {
    render(<OrnamentEbayPriceSection ebayLastSoldPriceUsd={45.5} />);
    expect(screen.getByText(/\$45\.50/)).toBeInTheDocument();
  });

  it('shows "eBay Market / No active listings found" fallback when cache timestamp is set but no price data', () => {
    render(
      <OrnamentEbayPriceSection
        ebayPriceCachedAt="2024-01-01"
        ebayPriceMinUsd={null}
        ebayPriceMaxUsd={null}
        ebayLastSoldPriceUsd={null}
      />,
    );
    expect(screen.getByText("eBay Market")).toBeInTheDocument();
    expect(screen.getByText("No active listings found")).toBeInTheDocument();
  });

  it("renders nothing when all eBay fields are absent", () => {
    const { container } = render(<OrnamentEbayPriceSection />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the Force refresh button on last-sold-only rows when onForceRefresh is provided", () => {
    // An item with only ebayLastSoldPriceUsd (no for-sale price range) still has
    // cached data that the route will serve from cache for 7 days. The user must
    // be able to bypass that cache from whichever eBay row is visible.
    const onForceRefresh = vi.fn();
    render(
      <OrnamentEbayPriceSection
        ebayLastSoldPriceUsd={45.0}
        onForceRefresh={onForceRefresh}
      />,
    );
    expect(screen.getByTitle(/Force refresh/i)).toBeInTheDocument();
  });

  it("shows the Force refresh button on the for-sale row when onForceRefresh is provided", () => {
    const onForceRefresh = vi.fn();
    render(
      <OrnamentEbayPriceSection
        ebayPriceMinUsd={20}
        ebayPriceMaxUsd={50}
        onForceRefresh={onForceRefresh}
      />,
    );
    expect(screen.getByTitle(/Force refresh/i)).toBeInTheDocument();
  });

  it("does NOT show the Force refresh button when onForceRefresh is absent", () => {
    render(<OrnamentEbayPriceSection ebayLastSoldPriceUsd={45.0} />);
    expect(screen.queryByTitle(/Force refresh/i)).not.toBeInTheDocument();
  });

  it("calls onForceRefresh when the button is clicked on a last-sold-only row", async () => {
    const onForceRefresh = vi.fn();
    render(
      <OrnamentEbayPriceSection
        ebayLastSoldPriceUsd={45.0}
        onForceRefresh={onForceRefresh}
      />,
    );
    screen.getByTitle(/Force refresh/i).click();
    expect(onForceRefresh).toHaveBeenCalledOnce();
  });
});
