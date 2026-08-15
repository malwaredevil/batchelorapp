/**
 * GET /api/admin/integrations/health
 *
 * Runs lightweight health checks against every connected external API in
 * parallel and returns a status summary. Results are cached in-process for
 * CACHE_TTL_MS to avoid burning rate limits on repeated panel refreshes.
 *
 * Three statuses:
 *   "ok"          — key present and the API responded successfully
 *   "missing_key" — the required env var / secret is not set
 *   "error"       — key is present but the API returned an error (detail included)
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireOwner } from "../../middleware/owner";
import { adminLimiter } from "../../middleware/rateLimit";
import { env } from "../../lib/env";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();
router.use(adminLimiter, requireAuth, requireOwner);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceCheckStatus = "ok" | "missing_key" | "error";

export interface ServiceCheckResult {
  service: string;
  status: ServiceCheckStatus;
  latencyMs?: number;
  detail?: string;
}

interface CachedResult {
  checks: ServiceCheckResult[];
  cachedAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Timeout raised from 5 s to 15 s: production logs show OpenAI Responses
// latencies of 2.8–6 s, so the old 5 s threshold caused false "down" alerts
// for normal-latency calls. 15 s gives plenty of headroom while still catching
// genuinely unresponsive services.
const CHECK_TIMEOUT_MS = 15_000; // 15 seconds per service

// Two attempts (one retry) for transient failures before a service is marked
// "error". Retryable failures include: network timeouts, DNS errors, and HTTP
// 429/5xx responses (temporary rate-limit or upstream overload). Permanent
// credential/config errors (4xx except 429) are never retried.
const CHECK_MAX_ATTEMPTS = 2;
const CHECK_RETRY_DELAY_MS = 2_000; // 2-second pause between attempts

/** HTTP status codes that warrant a retry (temporary upstream failure). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

let _cache: { data: CachedResult; expiresAt: number } | null = null;

// ---------------------------------------------------------------------------
// Per-service check helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a fetch-based check: records latency, catches errors, handles missing keys.
 *
 * Retried once (CHECK_MAX_ATTEMPTS total) for:
 *   • Thrown exceptions — timeouts, DNS/network errors (transient infrastructure).
 *   • HTTP 429 and 5xx responses — temporary rate-limit or upstream overload.
 *
 * NOT retried for permanent credential/config errors:
 *   • HTTP 4xx (except 429) — 401/403/400 indicate a real key/scope problem.
 *
 * The `fn` callback signals retryability via the `retryable` field on its result
 * when it receives a non-ok HTTP response.
 *
 * Exported for unit testing (`_runCheckForTest`).
 */
export async function runCheck(
  service: string,
  key: string | undefined,
  fn: (
    key: string,
  ) => Promise<{ ok: boolean; retryable?: boolean; detail?: string }>,
): Promise<ServiceCheckResult> {
  if (!key) {
    return { service, status: "missing_key" };
  }
  const start = Date.now();
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= CHECK_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await Promise.race([
        fn(key),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout after ${CHECK_TIMEOUT_MS}ms`)),
            CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
      const latencyMs = Date.now() - start;
      if (result.ok) {
        return { service, status: "ok", latencyMs };
      }
      // Non-ok HTTP response — retry only if the service itself says it's transient.
      if (result.retryable && attempt < CHECK_MAX_ATTEMPTS) {
        lastDetail = result.detail;
        await new Promise<void>((r) => setTimeout(r, CHECK_RETRY_DELAY_MS));
        continue;
      }
      return { service, status: "error", latencyMs, detail: result.detail };
    } catch (err) {
      // Thrown exception (timeout, DNS, network) — always retryable.
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < CHECK_MAX_ATTEMPTS) {
        await new Promise<void>((r) => setTimeout(r, CHECK_RETRY_DELAY_MS));
      }
    }
  }

  const latencyMs = Date.now() - start;
  return {
    service,
    status: "error",
    latencyMs,
    detail: lastDetail ?? "unknown error",
  };
}

/** @internal Exported alias for unit tests. */
export { runCheck as _runCheckForTest };

/** Config-only check: just verify the key(s) are present and optionally well-formed. */
function configCheck(
  service: string,
  keys: (string | undefined)[],
  validate?: () => { ok: boolean; detail?: string },
): ServiceCheckResult {
  const allPresent = keys.every((k) => !!k);
  if (!allPresent) {
    return { service, status: "missing_key" };
  }
  if (validate) {
    try {
      const result = validate();
      return result.ok
        ? { service, status: "ok" }
        : { service, status: "error", detail: result.detail };
    } catch (err) {
      return {
        service,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { service, status: "ok" };
}

// ---------------------------------------------------------------------------
// Individual service checks
// ---------------------------------------------------------------------------

async function checkSupabase(): Promise<ServiceCheckResult> {
  // Uses the same retry/timeout pattern as runCheck: one retry for transient
  // network or pool-exhaustion errors before marking Supabase as "down".
  const start = Date.now();
  let lastDetail: string | undefined;

  for (let attempt = 1; attempt <= CHECK_MAX_ATTEMPTS; attempt++) {
    try {
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout after ${CHECK_TIMEOUT_MS}ms`)),
            CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
      return {
        service: "Supabase",
        status: "ok",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < CHECK_MAX_ATTEMPTS) {
        await new Promise<void>((r) => setTimeout(r, CHECK_RETRY_DELAY_MS));
      }
    }
  }

  return {
    service: "Supabase",
    status: "error",
    latencyMs: Date.now() - start,
    detail: lastDetail ?? "unknown error",
  };
}

async function checkOpenRouter(): Promise<ServiceCheckResult> {
  return runCheck("OpenRouter", env.openrouterApiKey, async (key) => {
    const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.error?.message ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkOpenAI(): Promise<ServiceCheckResult> {
  return runCheck("OpenAI", env.openaiApiKey, async (key) => {
    const resp = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.error?.message ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkJinaAI(): Promise<ServiceCheckResult> {
  return runCheck("Jina AI", env.jinaApiKey, async (key) => {
    // Use the embeddings endpoint with a single minimal input — the lightest
    // authenticated call Jina offers.
    const resp = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "jina-clip-v2",
        input: [{ text: "health" }],
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { detail?: string };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.detail ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkVoyageAI(): Promise<ServiceCheckResult> {
  return runCheck("Voyage AI", env.voyageApiKey, async (key) => {
    const resp = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "rerank-2.5",
        query: "health",
        documents: ["check"],
        top_k: 1,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { detail?: string };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.detail ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkResend(): Promise<ServiceCheckResult> {
  return runCheck("Resend", env.resendApiKey, async (key) => {
    const resp = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        message?: string;
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.message ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkAgentPhone(): Promise<ServiceCheckResult> {
  const key = process.env["AGENTPHONE_API_KEY"];
  return runCheck("AgentPhone", key, async (apiKey) => {
    const resp = await fetch("https://api.agentphone.ai/v1/numbers", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.message ?? body?.error ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkApify(): Promise<ServiceCheckResult> {
  return runCheck("Apify", env.apifyApiToken, async (token) => {
    const resp = await fetch(
      `https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`,
      {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      },
    );
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.error?.message ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

async function checkSlack(): Promise<ServiceCheckResult> {
  return runCheck("Slack", env.slackBotToken, async (token) => {
    const resp = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${resp.statusText}`,
      };
    }
    const body = (await resp.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      return { ok: false, detail: body.error ?? "auth.test returned ok:false" };
    }
    return { ok: true };
  });
}

/** Google OAuth: config-only check (no live call — per-user tokens needed for full auth). */
function checkGoogleOAuth(): ServiceCheckResult {
  return configCheck("Google OAuth", [
    env.googleClientId,
    env.googleClientSecret,
  ]);
}

async function checkGoogleMaps(): Promise<ServiceCheckResult> {
  return runCheck("Google Maps", env.googleMapsApiKey, async (key) => {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=health&key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    );
    if (!resp.ok) {
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${resp.statusText}`,
      };
    }
    const body = (await resp.json()) as {
      status: string;
      error_message?: string;
    };
    // "ZERO_RESULTS" means the API is working — we just searched for "health" with no result.
    if (body.status === "OK" || body.status === "ZERO_RESULTS")
      return { ok: true };
    return {
      ok: false,
      detail: `${body.status}: ${body.error_message ?? "unknown error"}`,
    };
  });
}

/** Google Wallet: config-only check — validate JSON parse of service account. */
function checkGoogleWallet(): ServiceCheckResult {
  return configCheck(
    "Google Wallet",
    [env.googleWalletIssuerId, env.googleWalletServiceAccountJson],
    () => {
      try {
        JSON.parse(env.googleWalletServiceAccountJson!);
        return { ok: true };
      } catch {
        return {
          ok: false,
          detail: "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is not valid JSON",
        };
      }
    },
  );
}

async function checkReplicate(): Promise<ServiceCheckResult> {
  const key = process.env["REPLICATE_API_TOKEN"];
  return runCheck("Replicate", key, async (token) => {
    const resp = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { detail?: string };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.detail ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

/**
 * eBay OAuth check — verifies EBAY_APP_ID + EBAY_CERT_ID can obtain an
 * application access token from the eBay identity service.
 */
async function checkEbayOAuth(): Promise<ServiceCheckResult> {
  const { ebayAppId, ebayCertId } = env;
  if (!ebayAppId || !ebayCertId) {
    return { service: "eBay OAuth", status: "missing_key" };
  }
  // Pass the base64-encoded credentials as the "key" so runCheck handles
  // the missing-key guard, retry, timeout, and latency tracking uniformly.
  const credentials = Buffer.from(`${ebayAppId}:${ebayCertId}`).toString(
    "base64",
  );
  return runCheck("eBay OAuth", credentials, async (creds) => {
    const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as {
        error_description?: string;
      };
      return {
        ok: false,
        retryable: isRetryableStatus(resp.status),
        detail: `HTTP ${resp.status}: ${body?.error_description ?? resp.statusText}`,
      };
    }
    return { ok: true };
  });
}

// Note: the old "eBay Finding API" check (probing the legacy svcs.ebay.com
// sold-listings endpoint) was removed 2026-08-15. That endpoint is
// permanently blocked by eBay's own WAF (418 "I'm a teapot" on every
// request, reproducible from multiple networks) and the app no longer calls
// it — lib/pottery/ebay-market-value.ts now uses only the Browse API. See
// lib/ebay/finding.ts for the retired client if eBay ever un-blocks it.

/** Sentry: config-only — validate DSN format. */
function checkSentry(): ServiceCheckResult {
  return configCheck("Sentry", [env.sentryDsn], () => {
    // DSN should look like https://<key>@<host>/<project-id>
    const dsn = env.sentryDsn!;
    const ok = /^https:\/\/.+@.+\/.+$/.test(dsn);
    return ok
      ? { ok: true }
      : { ok: false, detail: "SENTRY_DSN does not match expected format" };
  });
}

/** VAPID: config-only — verify both public and private keys are set. */
function checkVapid(): ServiceCheckResult {
  const pub = process.env["VAPID_PUBLIC_KEY"];
  const priv = process.env["VAPID_PRIVATE_KEY"];
  return configCheck("VAPID (Push)", [pub, priv]);
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

export async function runAllChecks(): Promise<CachedResult> {
  const results = await Promise.all([
    checkSupabase(),
    checkOpenRouter(),
    checkOpenAI(),
    checkJinaAI(),
    checkVoyageAI(),
    checkResend(),
    checkAgentPhone(),
    checkApify(),
    checkSlack(),
    Promise.resolve(checkGoogleOAuth()),
    checkGoogleMaps(),
    Promise.resolve(checkGoogleWallet()),
    checkReplicate(),
    checkEbayOAuth(),
    Promise.resolve(checkSentry()),
    Promise.resolve(checkVapid()),
  ]);

  return {
    checks: results,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Public cache-aware accessor used by both the HTTP route and the Elaine
 * tool executor. Both paths share the same in-process cache so an Elaine
 * health query never burns extra rate-limited external API calls when a
 * fresh result is already sitting in memory.
 */
export async function getCachedHealthChecks(): Promise<
  CachedResult & { fromCache: boolean }
> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return { ..._cache.data, fromCache: true };
  }
  const data = await runAllChecks();
  _cache = { data, expiresAt: now + CACHE_TTL_MS };
  return { ...data, fromCache: false };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/", async (_req, res) => {
  res.json(await getCachedHealthChecks());
});

/**
 * GET /cached
 *
 * Read-only: returns the in-process cached result if one exists and has not
 * expired. Returns 204 No Content when no valid cache is available.
 *
 * This endpoint NEVER triggers a fresh health-check run — it is safe to call
 * from any read-only view (e.g. the Services Catalog) without incurring
 * external API calls.
 */
router.get("/cached", (_req, res) => {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    res.json({ ..._cache.data, fromCache: true });
    return;
  }
  res.status(204).end();
});

// Explicit bust — POST to force a fresh check even within the cache window.
router.post("/bust", (_req, res) => {
  _cache = null;
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Test helpers (not exported to production callers — only used in test files)
// ---------------------------------------------------------------------------

/** @internal Inject a cache entry for unit tests without running real checks. */
export function _setTestCache(
  entry: { data: CachedResult; expiresAt: number } | null,
): void {
  _cache = entry;
}

/**
 * Synchronous read of the last-known health status for a named service.
 * Uses the in-process cache — no HTTP call is made. Returns `true` when no
 * cached data is available (fail-open: attempt the channel and handle errors
 * naturally rather than refusing before we have any evidence of failure).
 *
 * serviceName must match the `service` field returned by the check function
 * for that service (e.g. "AgentPhone", "Resend", "Slack").
 */
export function isServiceHealthy(serviceName: string): boolean {
  if (!_cache) return true; // no data yet — assume healthy (fail-open)
  const now = Date.now();
  if (_cache.expiresAt <= now) return true; // cache expired — assume healthy
  const check = _cache.data.checks.find((c) => c.service === serviceName);
  return !check || check.status === "ok";
}

export default router;
