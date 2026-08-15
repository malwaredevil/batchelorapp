/**
 * EbayPricePanel — label-wording tests.
 *
 * WHY: The pottery detail page can display eBay market data from two different
 * sources:
 *   - Apify sold-listing actor  → sourceType "sold"
 *   - eBay Browse API fallback  → sourceType "active_listing"
 *
 * Users interpreting the price numbers need to know which kind of data they're
 * looking at. "Sold prices" and "asking prices" are materially different market
 * signals, and showing the wrong label silently misleads users.
 *
 * These tests assert that the heading and footer text change correctly for each
 * sourceType value so a future refactor can't regress the label wording without
 * a failing test.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { EbayPricePanel } from "./EbayPricePanel";

// lucide-react icons don't render meaningful text in jsdom — stub them out.
vi.mock("lucide-react", () => ({
  TrendingUp: () => null,
}));

const BASE_PROPS = {
  priceMinUsd: 25,
  priceMedianUsd: 40,
  priceMaxUsd: 60,
  listingCount: 7,
  searchQuery: "Roseville Pottery Pinecone",
  onDismiss: vi.fn(),
};

describe("EbayPricePanel — sourceType label wording", () => {
  it('shows "eBay — Sold Prices" heading when sourceType is "sold"', () => {
    render(<EbayPricePanel {...BASE_PROPS} sourceType="sold" />);
    expect(screen.getByText("eBay — Sold Prices")).toBeInTheDocument();
    expect(screen.queryByText("eBay — Asking Prices")).not.toBeInTheDocument();
  });

  it('shows "eBay — Asking Prices" heading when sourceType is "active_listing"', () => {
    render(<EbayPricePanel {...BASE_PROPS} sourceType="active_listing" />);
    expect(screen.getByText("eBay — Asking Prices")).toBeInTheDocument();
    expect(screen.queryByText("eBay — Sold Prices")).not.toBeInTheDocument();
  });

  it('shows "sales found" footer text when sourceType is "sold"', () => {
    render(
      <EbayPricePanel {...BASE_PROPS} listingCount={3} sourceType="sold" />,
    );
    expect(screen.getByText(/3 sales found/)).toBeInTheDocument();
    expect(screen.queryByText(/for sale/)).not.toBeInTheDocument();
  });

  it('shows "listings for sale" footer text when sourceType is "active_listing"', () => {
    render(
      <EbayPricePanel
        {...BASE_PROPS}
        listingCount={5}
        sourceType="active_listing"
      />,
    );
    expect(screen.getByText(/5 listings for sale/)).toBeInTheDocument();
    expect(screen.queryByText(/sales found/)).not.toBeInTheDocument();
  });

  it("pluralises correctly for a single sold listing", () => {
    render(
      <EbayPricePanel {...BASE_PROPS} listingCount={1} sourceType="sold" />,
    );
    expect(screen.getByText(/1 sale found/)).toBeInTheDocument();
  });

  it("pluralises correctly for a single asking-price listing", () => {
    render(
      <EbayPricePanel
        {...BASE_PROPS}
        listingCount={1}
        sourceType="active_listing"
      />,
    );
    expect(screen.getByText(/1 listing for sale/)).toBeInTheDocument();
  });

  it("renders the price values in all cases", () => {
    render(<EbayPricePanel {...BASE_PROPS} sourceType="sold" />);
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("$40")).toBeInTheDocument();
    expect(screen.getByText("$60")).toBeInTheDocument();
  });

  it("includes the search query in the footer", () => {
    render(
      <EbayPricePanel
        {...BASE_PROPS}
        searchQuery="Roseville Pottery"
        sourceType="active_listing"
      />,
    );
    expect(screen.getByText(/Roseville Pottery/)).toBeInTheDocument();
  });
});
