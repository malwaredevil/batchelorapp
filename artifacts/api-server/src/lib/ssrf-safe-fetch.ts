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

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

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
      ? (addresses as { address: string; family: number }[])
      : ([addresses] as unknown as { address: string; family: number }[]);

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

    const first = list[0];
    callback(null, first.address, first.family);
  });
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
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

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

/** True if an error thrown by fetchPageText represents an SSRF/policy block. */
export function isSafeFetchBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("private") ||
    msg.includes("hostname is not allowed") ||
    msg.includes("Blocked:")
  );
}
