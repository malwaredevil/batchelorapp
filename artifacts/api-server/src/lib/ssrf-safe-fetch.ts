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
  address: string | { address: string; family: number }[],
  family?: number,
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

    if (list.length === 0) {
      callback(new Error("DNS resolution returned no addresses"), "", 4);
      return;
    }

    if (options.all) {
      callback(
        null,
        list.map(({ address, family }) => ({ address, family })),
      );
      return;
    }

    const first = list[0];
    callback(null, first.address, first.family);
  });
}

const FETCH_ABSOLUTE_TIMEOUT_MS = 12_000;
const FETCH_SOCKET_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 200_000;
const MAX_REDIRECTS = 5;
const MAX_TEXT_LENGTH = 6_000;

export interface SafeFetchOptions {
  userAgent?: string;
  accept?: string;
  maxTextLength?: number;
}

function assertSafeUrl(parsed: URL): void {
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }

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
}

function headersFromInit(
  headers: RequestInit["headers"] | undefined,
): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  if (!headers) return result;

  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

function requestBodyFromInit(
  body: RequestInit["body"] | undefined,
): string | Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  throw new Error("Unsupported request body type for ssrfSafeFetch");
}

function redirectInit(init: RequestInit, statusCode: number): RequestInit {
  const method = init.method?.toUpperCase();
  if (
    statusCode === 303 ||
    ((statusCode === 301 || statusCode === 302) && method === "POST")
  ) {
    return {
      ...init,
      body: undefined,
      method: "GET",
    };
  }

  return init;
}

async function ssrfSafeFetchInternal(
  parsed: URL,
  init: RequestInit,
  redirectCount: number,
): Promise<Response> {
  assertSafeUrl(parsed);

  return new Promise<Response>((resolve, reject) => {
    const mod = parsed.protocol === "https:" ? https : http;
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;
    const body = requestBodyFromInit(init.body);
    const headers = headersFromInit(init.headers);
    const method = init.method ?? "GET";

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      lookup: safeLookup,
      timeout: FETCH_SOCKET_TIMEOUT_MS,
    };

    let settled = false;
    let req: http.ClientRequest;

    const cleanup = () => {
      clearTimeout(deadline);
      init.signal?.removeEventListener("abort", abort);
    };
    const succeed = (response: Response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const abort = () => {
      req.destroy();
      fail(new Error("Request aborted"));
    };
    const deadline = setTimeout(() => {
      req.destroy();
      fail(new Error("Request timed out"));
    }, FETCH_ABSOLUTE_TIMEOUT_MS);

    if (init.signal?.aborted) {
      clearTimeout(deadline);
      reject(new Error("Request aborted"));
      return;
    }

    req = mod.request(reqOptions, (res) => {
      const status = res.statusCode ?? 0;
      const isRedirect = [301, 302, 303, 307, 308].includes(status);

      if (isRedirect) {
        res.resume();
        const location = res.headers.location;
        if (!location) {
          fail(new Error(`Redirect without location (${status})`));
          return;
        }
        if (redirectCount >= MAX_REDIRECTS) {
          fail(new Error("Too many redirects"));
          return;
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(
            Array.isArray(location) ? location[0] : location,
            parsed,
          );
        } catch {
          fail(new Error("Invalid redirect target"));
          return;
        }

        void ssrfSafeFetchInternal(
          nextUrl,
          redirectInit(init, status),
          redirectCount + 1,
        ).then(succeed, fail);
        return;
      }

      const chunks: Buffer[] = [];
      let bodyBytes = 0;

      res.on("data", (chunk: Buffer) => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY_BYTES) {
          req.destroy();
          fail(new Error("Response body too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(key, item);
          } else {
            responseHeaders.set(key, value);
          }
        }

        const responseBody =
          status === 204 || status === 304 ? null : Buffer.concat(chunks);
        succeed(
          new Response(responseBody, {
            headers: responseHeaders,
            status,
            statusText: res.statusMessage,
          }),
        );
      });
      res.on("error", fail);
    });

    init.signal?.addEventListener("abort", abort, { once: true });
    req.on("timeout", () => {
      req.destroy();
      fail(new Error("Request timed out"));
    });
    req.on("error", fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function ssrfSafeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return ssrfSafeFetchInternal(new URL(url), init, 0);
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
  assertSafeUrl(parsed);

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
