/**
 * Cheapest round-trip flight lookup for travels wishlist destinations (#216).
 *
 * Uses the `elis/skyscanner-api` Apify actor — a well-maintained Skyscanner
 * scraper. Falls back to returning null (no throw) so the wishlist UI
 * gracefully shows "no results found" rather than an error state.
 */

import { runApifyActor } from "../apify-client";
import { logger } from "../logger";

export interface FlightOption {
  price: number;
  currency: string;
  airline: string | null;
  departureDate: string | null;
  returnDate: string | null;
  durationMinutes: number | null;
  stops: number | null;
  deepLink: string | null;
}

export interface FlightPriceResult {
  originIata: string;
  destinationQuery: string;
  priceMinUsd: number;
  currency: string;
  options: FlightOption[];
  cachedAt: string;
}

const ACTOR_ID = "elis/skyscanner-api";

function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function parseDuration(raw: unknown): number | null {
  if (typeof raw === "number" && raw > 0) return raw;
  if (typeof raw === "string") {
    // "2h 30m" or "150 min" or "150"
    const hm = raw.match(/(\d+)h\s*(\d+)?m?/);
    if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2] ?? "0");
    const mins = parseFloat(raw);
    if (Number.isFinite(mins)) return mins;
  }
  return null;
}

export async function lookupFlightPrices(
  originIata: string,
  destination: string,
  apiToken: string,
): Promise<FlightPriceResult | null> {
  // Build a flexible date range: next 30–60 days, 7-day trip
  const today = new Date();
  const departDate = new Date(today);
  departDate.setDate(today.getDate() + 30);
  const returnDate = new Date(departDate);
  returnDate.setDate(departDate.getDate() + 7);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let items: Record<string, unknown>[];
  try {
    items = await runApifyActor(
      ACTOR_ID,
      {
        origin: originIata.toUpperCase(),
        destination,
        departDate: fmt(departDate),
        returnDate: fmt(returnDate),
        adults: 1,
        currency: "USD",
        maxResults: 10,
      },
      apiToken,
      { timeoutMs: 90_000, maxItems: 10 },
    );
  } catch (err) {
    logger.warn({ err, originIata, destination }, "flights: actor run failed");
    return null;
  }

  const options: FlightOption[] = [];

  for (const item of items) {
    const price = parsePrice(item.price ?? item.totalPrice ?? item.amount);
    if (price === null) continue;

    options.push({
      price,
      currency: String(item.currency ?? "USD"),
      airline:
        (item.airline ?? item.carrier)
          ? String(item.airline ?? item.carrier)
          : null,
      departureDate: item.departureDate
        ? String(item.departureDate)
        : fmt(departDate),
      returnDate: item.returnDate ? String(item.returnDate) : fmt(returnDate),
      durationMinutes: parseDuration(item.duration ?? item.durationMinutes),
      stops:
        typeof item.stops === "number"
          ? item.stops
          : item.stops != null
            ? parseInt(String(item.stops))
            : null,
      deepLink:
        (item.deepLink ?? item.url) ? String(item.deepLink ?? item.url) : null,
    });
  }

  if (options.length === 0) return null;

  options.sort((a, b) => a.price - b.price);

  return {
    originIata: originIata.toUpperCase(),
    destinationQuery: destination,
    priceMinUsd: options[0].price,
    currency: options[0].currency,
    options: options.slice(0, 5),
    cachedAt: new Date().toISOString(),
  };
}
