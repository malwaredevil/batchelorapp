import { Router, type IRouter } from "express";
import { z } from "zod";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import { lookup as dnsLookup } from "dns";
import { isIP } from "net";
import { requireAuth } from "../../middleware/auth";
import { aiLimiter } from "../../middleware/rateLimit";
import { logger } from "../../lib/logger";
import { callModel, getModels } from "../../lib/ai-client";

const router: IRouter = Router();
router.use(requireAuth);

const ImportUrlSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
      message: "URL must be http or https",
    }),
});

// ---------------------------------------------------------------------------
// SSRF guard — built once at module load, reused for every request.
// net.BlockList performs proper CIDR/address matching and handles all
// normalised forms (e.g. "0:0:0:0:0:0:0:1" === "::1").
// ---------------------------------------------------------------------------

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
ipv6Blocked.addSubnet("::ffff:0:0", 96, "ipv6"); // IPv4-mapped (::ffff:x.x.x.x AND ::ffff:xxxx:xxxx)
ipv6Blocked.addSubnet("fc00::", 7, "ipv6"); // unique-local (fc00::/7 covers fc and fd)
ipv6Blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
ipv6Blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/**
 * Returns true if the address is in a private / reserved range.
 * Throws → caller treats as blocked.
 */
function isPrivateAddress(address: string, family: 4 | 6): boolean {
  try {
    if (family === 4) return ipv4Blocked.check(address, "ipv4");
    return ipv6Blocked.check(address, "ipv6");
  } catch {
    return true; // malformed address — block
  }
}

/**
 * Well-known internal hostnames that must always be rejected before any
 * DNS activity.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254", // cloud IMDS as literal IP in URL
]);

// ---------------------------------------------------------------------------
// Custom DNS lookup callback — called by Node right before the TCP socket
// is opened.  The address returned here is the EXACT address connected to,
// so there is no TOCTOU gap between validation and connection.
// ---------------------------------------------------------------------------

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

    // All addresses are safe — return the first one for the connection.
    const first = list[0];
    callback(null, first.address, first.family);
  });
}

// ---------------------------------------------------------------------------
// HTTP fetcher — uses Node http/https (not global fetch) so we can supply
// safeLookup as the lookup option.  Node's http.request does not follow
// redirects automatically; 3xx responses are explicitly rejected below.
// ---------------------------------------------------------------------------

// Absolute wall-clock budget for the entire outbound fetch, including DNS,
// TCP handshake, TLS, and response streaming.  The per-request socket
// inactivity timeout (reqOptions.timeout below) only fires when no bytes
// arrive for N ms, so a slow-drip server can keep a connection open
// indefinitely without it.  This deadline races the inner Promise and
// destroys the request regardless of how slowly the remote sends bytes.
const FETCH_ABSOLUTE_TIMEOUT_MS = 12_000;

async function fetchPageText(url: string): Promise<string> {
  const parsed = new URL(url);
  // hostname includes brackets for IPv6, e.g. "[::1]" — strip them.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Reject well-known internal names before any network activity.
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local")) {
    throw new Error("URL hostname is not allowed");
  }

  // If the hostname is already a raw IP literal, Node will skip the lookup
  // callback, so we must validate it here before the request is made.
  const ipVersion = isIP(hostname); // 4, 6, or 0
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
          "Mozilla/5.0 (compatible; QuiltingApp/1.0; +https://quilting.batchelor.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      // safeLookup is invoked by Node immediately before opening the socket.
      // The IP it validates and returns is the exact IP that gets connected to.
      lookup: safeLookup,
      timeout: 10000,
    };

    const req = mod.request(reqOptions, (res) => {
      // Node's http.request does not follow redirects; explicitly reject them
      // anyway so any future behavioural change is caught here too.
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
        // Bail early once we have enough raw HTML to work with.
        if (body.length > 200_000) res.destroy();
      });
      res.on("end", () => {
        const text = body
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        resolve(text);
      });
      res.on("error", reject);
    });

    // Expose destroy so the absolute-deadline race can kill the socket.
    destroyReq = () => req.destroy();

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });

  // Race the fetch against a hard wall-clock deadline.  The socket inactivity
  // timeout above fires only when *no bytes arrive* for 10 s; a slow-drip
  // server that trickles one byte every ~9 s can hold the connection open
  // indefinitely.  This outer deadline kills the request unconditionally after
  // FETCH_ABSOLUTE_TIMEOUT_MS regardless of byte-delivery rate.
  const deadlinePromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      destroyReq?.();
      reject(new Error("Request timed out"));
    }, FETCH_ABSOLUTE_TIMEOUT_MS);
  });

  return Promise.race([fetchPromise, deadlinePromise]);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const IMPORT_PROMPT = `You are a quilting expert. Extract quilt pattern information from the following webpage text.

Respond with STRICT JSON only:
{
  "name": "pattern name (required, never null)",
  "designer": "designer or brand name, or null",
  "difficulty": "beginner|intermediate|advanced or null",
  "blockSizeInches": number or null,
  "numPieces": integer or null,
  "style": "e.g. Log Cabin, Flying Geese, HST, etc. or null",
  "notes": "any other useful info (max 200 chars) or null"
}

If you cannot find a pattern name, use the page title or domain as the name. Never return anything outside the JSON object.`;

router.post("/patterns/import-url", aiLimiter, async (req, res) => {
  const { url } = ImportUrlSchema.parse(req.body);

  let pageText: string;
  try {
    pageText = await fetchPageText(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isBlocked =
      msg.includes("private") ||
      msg.includes("hostname is not allowed") ||
      msg.includes("Blocked:");
    req.log.warn({ err, url }, "Failed to fetch pattern URL");
    res.status(422).json({
      error: isBlocked
        ? "That URL is not allowed."
        : "Could not fetch that URL. Check it is publicly accessible.",
    });
    return;
  }

  if (!pageText || pageText.length < 20) {
    res.status(422).json({ error: "Page had no readable content." });
    return;
  }

  const models = await getModels();
  const completion = await callModel(models.fastVision, (client, model) =>
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: IMPORT_PROMPT },
        { role: "user", content: `URL: ${url}\n\nPage text:\n${pageText}` },
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  );

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw }, "Failed to parse pattern import AI response");
    res
      .status(422)
      .json({ error: "Could not extract pattern info from this page." });
    return;
  }

  const name =
    typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : null;
  if (!name) {
    res
      .status(422)
      .json({ error: "Could not determine a pattern name from this page." });
    return;
  }

  function asStr(v: unknown) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  function asNum(v: unknown) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  res.json({
    name,
    designer: asStr(parsed.designer),
    difficulty: ["beginner", "intermediate", "advanced"].includes(
      parsed.difficulty as string,
    )
      ? (parsed.difficulty as string)
      : null,
    blockSizeInches: asNum(parsed.blockSizeInches),
    numPieces:
      typeof parsed.numPieces === "number"
        ? Math.round(parsed.numPieces)
        : null,
    style: asStr(parsed.style),
    notes: asStr(parsed.notes),
  });
});

export default router;
