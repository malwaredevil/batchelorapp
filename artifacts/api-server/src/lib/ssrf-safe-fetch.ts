import * as http from "http";
import * as https from "https";
import * as net from "net";
import { lookup as dnsLookup } from "dns";
import { isIP } from "net";

/**
 * Shared SSRF-safe outbound page fetcher, used for any server-side fetch of
 * an externally-supplied or hardcoded third-party URL (quilting pattern
 * import, ornaments book-value lookup). Blocks private/reserved address
 * ranges, well-known internal hostnames, and redirects; enforces both a
 * per-socket inactivity timeout and an absolute wall-clock deadline.
 */

const ipv4Blocked = new net.BlockList();
ipv4Blocked.addSubnet("0.0.0.0", 8, "ipv4"); // this network
ipv4Blocked.addSubnet("10.0.0.0", 8, "ipv4"); // private
ipv4Blocked.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
ipv4Blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
ipv4Blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local / cloud metadata
ipv4Blocked.addSubnet("172.16.0.0", 12, "ipv4"); // private
ipv4Blocked.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
ipv4Blocked.addSubnet("192.168.0.0", 16, "ipv4"); // private
ipv4Blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
ipv4Blocked.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
ipv4Blocked.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
ipv4Blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
ipv4Blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast

const ipv6Blocked = new net.BlockList();
ipv6Blocked.addAddress("::", "ipv6"); // unspecified
ipv6Blocked.addSubnet("::1", 128, "ipv6"); // loopback (catches all expanded forms)
ipv6Blocked.addSubnet("::ffff:0:0", 96, "ipv6"); // IPv4-mapped
ipv6Blocked.addSubnet("fc00::", 7, "ipv6"); // unique-local
ipv6Blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
ipv6Blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

function isPrivateAddress(address: string, family: 4 | 6): boolean {
  try {
    if (family === 4) return ipv4Blocked.check(address, "ipv4");
    return ipv6Blocked.check(address, "ipv6");
  } catch {
    return true; // malformed address — block
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

type LookupAddress = { address: string; family: number };

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

type LookupAllCallback = (
  err: NodeJS.ErrnoException | null,
  addresses: LookupAddress[],
) => void;

/**
 * Custom DNS lookup that checks all resolved addresses against the SSRF
 * block-list before allowing the connection to proceed.
 *
 * Node.js passes options.all = true when it calls a custom lookup function so
 * that it can try each resolved address in sequence (connection-fallback). In
 * that case the callback must be called with the array form
 * (null, [{address, family}]).  When options.all is falsy, it expects the
 * single-address form (null, address, family).  Mixing the two forms causes
 * Node.js to silently receive `undefined` as the IP, producing an
 * ERR_INVALID_IP_ADDRESS error.
 */
function safeLookup(
  hostname: string,
  options: {
    family?: number;
    hints?: number;
    all?: boolean;
    verbatim?: boolean;
  },
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }

    const list = Array.isArray(addresses)
      ? (addresses as LookupAddress[])
      : ([addresses] as unknown as LookupAddress[]);

    for (const { address, family } of list) {
      if (isPrivateAddress(address, family as 4 | 6)) {
        callback(
          new Error(`Blocked: ${address} is in a private/reserved range`),
          "",
          4,
        );
        return;
      }
    }

    if (options.all) {
      // Node.js expects the array form when it passed all:true
      (callback as unknown as LookupAllCallback)(null, list);
    } else {
      const first = list[0];
      callback(null, first.address, first.family);
    }
  });
}

/** Validate a URL's hostname/IP against SSRF rules. Throws on block. */
export function assertSsrfSafe(url: URL): void {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local")) {
    throw new Error("URL hostname is not allowed");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateAddress(hostname, 4)) {
    throw new Error("URL resolves to a private address");
  }
  if (ipVersion === 6 && isPrivateAddress(hostname, 6)) {
    throw new Error("URL resolves to a private address");
  }
}

/**
 * Full DNS-resolving SSRF validation for a hostname.
 *
 * `assertSsrfSafe` only blocks literal private IPs and a fixed hostname
 * blocklist. This function additionally resolves the hostname via DNS and
 * verifies that every returned address falls outside all private/reserved
 * ranges — preventing SSRF via a hostname that ultimately points inward.
 *
 * Use this before forwarding a user-supplied URL to any third-party proxy,
 * so the proxy cannot be used as an amplifier to probe internal services.
 *
 * Throws if the hostname is blocked by the static rules, if DNS resolution
 * fails (fail-closed), or if any resolved address is private/reserved.
 */
export async function assertSsrfSafeDns(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith(".local")) {
    throw new Error("URL hostname is not allowed");
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    if (isPrivateAddress(normalized, 4))
      throw new Error("URL resolves to a private address");
    return;
  }
  if (ipVersion === 6) {
    if (isPrivateAddress(normalized, 6))
      throw new Error("URL resolves to a private address");
    return;
  }

  const DNS_TIMEOUT_MS = 2000;

  const dnsPromise = new Promise<void>((resolve, reject) => {
    dnsLookup(normalized, { all: true }, (err, addresses) => {
      if (err) {
        reject(
          new Error(
            `DNS lookup failed for ${normalized}: ${err.message} — blocked`,
          ),
        );
        return;
      }
      const list: LookupAddress[] = Array.isArray(addresses)
        ? (addresses as LookupAddress[])
        : [];
      for (const { address, family } of list) {
        if (isPrivateAddress(address, family as 4 | 6)) {
          reject(
            new Error(
              `Blocked: ${normalized} resolves to ${address} (private/reserved range)`,
            ),
          );
          return;
        }
      }
      resolve();
    });
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(new Error(`DNS lookup timed out for ${normalized} — blocked`)),
      DNS_TIMEOUT_MS,
    );
  });

  await Promise.race([dnsPromise, timeoutPromise]);
}

const FETCH_ABSOLUTE_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 200_000;
const MAX_TEXT_LENGTH = 6_000;

export interface SafeFetchOptions {
  userAgent?: string;
  accept?: string;
  maxTextLength?: number;
}

/**
 * Fetches a page and returns whitespace-collapsed, tag-stripped plain text
 * (not raw HTML) — suitable for AI extraction or lightweight text scraping.
 * Throws on any SSRF-blocked, redirect, non-2xx, or timed-out response.
 */
export async function fetchPageText(
  url: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const parsed = new URL(url);
  assertSsrfSafe(parsed);

  let destroyReq: (() => void) | null = null;

  const fetchPromise = new Promise<string>((resolve, reject) => {
    const mod = parsed.protocol === "https:" ? https : http;
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent":
          options.userAgent ??
          "Mozilla/5.0 (compatible; BatchelorApp/1.0; +https://app.batchelor.app)",
        Accept: options.accept ?? "text/html,application/xhtml+xml",
      },
      lookup: safeLookup,
      timeout: 10000,
    };

    const req = mod.request(reqOptions, (res) => {
      if (
        res.statusCode !== undefined &&
        res.statusCode >= 300 &&
        res.statusCode < 400
      ) {
        res.destroy();
        reject(new Error(`Redirect not followed (${res.statusCode})`));
        return;
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
        return;
      }

      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) res.destroy();
      });
      res.on("end", () => {
        const text = body
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, options.maxTextLength ?? MAX_TEXT_LENGTH);
        resolve(text);
      });
      res.on("error", reject);
    });

    destroyReq = () => req.destroy();

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const deadlinePromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      destroyReq?.();
      reject(new Error("Request timed out"));
    }, FETCH_ABSOLUTE_TIMEOUT_MS);
  });

  return Promise.race([fetchPromise, deadlinePromise]);
}

/**
 * Fetches a URL and returns the parsed JSON body. Uses the same SSRF-safe
 * DNS resolver and IP-block-list as fetchPageText, making it safe to call
 * with any URL — including hardcoded ones — so internal network destinations
 * are consistently rejected regardless of the call site.
 * Throws on any SSRF-blocked, redirect, non-2xx, timed-out, or invalid-JSON response.
 */
export async function fetchJsonSafe<T = unknown>(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const parsed = new URL(url);
  assertSsrfSafe(parsed);

  let destroyReq: (() => void) | null = null;
  const absoluteTimeoutMs = options.timeoutMs ?? FETCH_ABSOLUTE_TIMEOUT_MS;

  const fetchPromise = new Promise<T>((resolve, reject) => {
    const mod = parsed.protocol === "https:" ? https : http;
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BatchelorApp/1.0; +https://app.batchelor.app)",
        Accept: "application/json",
        ...options.headers,
      },
      lookup: safeLookup,
      timeout: 10000,
    };

    const req = mod.request(reqOptions, (res) => {
      if (
        res.statusCode !== undefined &&
        res.statusCode >= 300 &&
        res.statusCode < 400
      ) {
        res.destroy();
        reject(new Error(`Redirect not followed (${res.statusCode})`));
        return;
      }

      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
        return;
      }

      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) res.destroy();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      });
      res.on("error", reject);
    });

    destroyReq = () => req.destroy();
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const deadlinePromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      destroyReq?.();
      reject(new Error("Request timed out"));
    }, absoluteTimeoutMs);
  });

  return Promise.race([fetchPromise, deadlinePromise]);
}

/** True if an error thrown by fetchPageText represents an SSRF/policy block. */
export function isSafeFetchBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("private") ||
    msg.includes("hostname is not allowed") ||
    msg.includes("Blocked:")
  );
}

/**
 * Makes a single SSRF-safe HTTP/HTTPS request and returns the response
 * metadata (statusCode, location header, content-type) and body. Used
 * internally by fetchHtmlSafe to support redirect following.
 */
async function fetchHtmlOnce(
  parsed: URL,
  timeoutMs: number,
): Promise<{
  statusCode: number;
  location: string | null;
  ct: string;
  body: string;
}> {
  let destroyReq: (() => void) | null = null;

  const fetchPromise = new Promise<{
    statusCode: number;
    location: string | null;
    ct: string;
    body: string;
  }>((resolve, reject) => {
    const mod = parsed.protocol === "https:" ? https : http;
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BatchelorApp/1.0; +https://app.batchelor.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      lookup: safeLookup,
      timeout: 10000,
    };

    const req = mod.request(reqOptions, (res) => {
      const statusCode = res.statusCode ?? 0;
      const location =
        typeof res.headers.location === "string" ? res.headers.location : null;
      const ct = res.headers["content-type"] ?? "";

      if (statusCode >= 300 && statusCode < 400) {
        res.destroy();
        resolve({ statusCode, location, ct, body: "" });
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.destroy();
        resolve({ statusCode, location, ct, body: "" });
        return;
      }

      if (!ct.includes("text/html")) {
        res.destroy();
        resolve({ statusCode, location, ct, body: "" });
        return;
      }

      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) res.destroy();
      });
      res.on("end", () => resolve({ statusCode, location, ct, body }));
      res.on("error", reject);
    });

    destroyReq = () => req.destroy();

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  const deadlinePromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      destroyReq?.();
      reject(new Error("Request timed out"));
    }, timeoutMs);
  });

  return Promise.race([fetchPromise, deadlinePromise]);
}

/**
 * Fetches a URL and returns the raw HTML body — suitable for og:meta tag
 * extraction. Uses the same SSRF-safe DNS resolver and IP-block-list as
 * fetchPageText so no private/reserved destinations can be reached.
 *
 * Follows up to MAX_REDIRECTS redirects, re-validating each destination URL
 * through the SSRF block-list before connecting. Only http: and https: redirect
 * targets are followed; anything else is treated as an error.
 *
 * Returns an empty string if the response Content-Type is not text/html or
 * if the request fails for any reason (caller handles null/empty gracefully).
 */
const MAX_REDIRECTS = 5;

export async function fetchHtmlSafe(
  url: string,
  timeoutMs?: number,
): Promise<string> {
  const totalMs = timeoutMs ?? FETCH_ABSOLUTE_TIMEOUT_MS;
  const deadlineTs = Date.now() + totalMs;

  let currentUrl = url;
  let redirectsFollowed = 0;

  while (true) {
    const parsed = new URL(currentUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("URL protocol is not allowed");
    }

    assertSsrfSafe(parsed);

    const remainingMs = deadlineTs - Date.now();
    if (remainingMs <= 0) return "";

    const result = await fetchHtmlOnce(parsed, remainingMs);

    if (result.statusCode >= 300 && result.statusCode < 400) {
      if (!result.location) {
        return "";
      }
      if (redirectsFollowed >= MAX_REDIRECTS) {
        return "";
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(result.location, currentUrl);
      } catch {
        return "";
      }
      if (!["http:", "https:"].includes(nextUrl.protocol)) {
        return "";
      }
      redirectsFollowed++;
      currentUrl = nextUrl.toString();
      continue;
    }

    return result.body;
  }
}

/** True if an error thrown by fetchHtmlSafe represents an SSRF/policy block. */
export function isSafeFetchHtmlError(err: unknown): boolean {
  return isSafeFetchBlockedError(err);
}
