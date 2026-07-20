/**
 * eBay OAuth 2.0 Client Credentials Grant.
 *
 * Exchanges EBAY_APP_ID + EBAY_CERT_ID for an application access token that
 * authorises calls to the Browse API (and other REST APIs that require OAuth).
 * The token is cached in memory and auto-refreshed 60s before expiry.
 */

import { env } from "../env";
import { logger } from "../logger";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getEbayAppToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const appId = env.ebayAppId;
  const certId = env.ebayCertId;

  if (!appId || !certId) {
    throw new Error(
      "eBay API credentials not configured (EBAY_APP_ID, EBAY_CERT_ID)",
    );
  }

  const credentials = Buffer.from(`${appId}:${certId}`).toString("base64");

  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `eBay OAuth token request failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  logger.info({ expiresIn: data.expires_in }, "ebay: refreshed app token");
  return tokenCache.accessToken;
}
