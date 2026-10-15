import { agentphoneRequest } from "./agentphone-http";
import { env } from "./env";

/**
 * An outbound webhook's `from` can be the agent's own number. When the signed
 * webhook cannot identify the household recipient, verify the exact call with
 * the provider rather than trusting a destination on an ambiguous event.
 */
async function verifyOutboundRecipient(callId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callId)) return null;
  const response = await agentphoneRequest(
    `/v1/calls/${encodeURIComponent(callId)}`,
    {
      method: "GET",
      retry: false,
      signal: AbortSignal.timeout(env.agentphoneOutboundCorrelationWindowMs),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("AgentPhone call verification unavailable");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) return null;
  const call = value as Record<string, unknown>;
  if (
    call.id !== callId ||
    call.direction !== "outbound" ||
    typeof call.toNumber !== "string" ||
    !/^\+[1-9]\d{1,14}$/.test(call.toNumber)
  ) {
    return null;
  }
  return call.toNumber;
}

/**
 * Process-local, exact-call identity only: callers must still authorize the
 * recipient against current household membership on every turn.
 */
export function createOutboundRecipientVerifier(options: {
  ttlMs: number;
  maxEntries: number;
}) {
  const verified = new Map<string, { recipient: string; expiresAt: number }>();
  const pending = new Map<
    string,
    { promise: Promise<string | null>; expiresAt: number }
  >();

  function prune() {
    const now = Date.now();
    for (const entries of [verified, pending]) {
      for (const [id, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(id);
      }
    }
  }

  function invalidate(callId: string) {
    verified.delete(callId);
    // A late provider response must not restore an ended call's identity.
    pending.delete(callId);
  }

  async function get(callId: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callId)) return null;
    prune();
    const cached = verified.get(callId);
    if (cached) {
      // LRU eviction, but never extend the absolute verification lifetime.
      verified.delete(callId);
      verified.set(callId, cached);
      return cached.recipient;
    }
    const active = pending.get(callId);
    if (active) return active.promise;

    const entry = {
      expiresAt: Date.now() + options.ttlMs,
      promise: Promise.resolve<string | null>(null),
    };
    pending.set(callId, entry);
    if (pending.size > options.maxEntries) {
      pending.delete(pending.keys().next().value!);
    }
    entry.promise = (async () => {
      try {
        const recipient = await verifyOutboundRecipient(callId);
        if (pending.get(callId) !== entry || entry.expiresAt <= Date.now()) {
          return null;
        }
        if (recipient) {
          prune();
          verified.set(callId, { recipient, expiresAt: entry.expiresAt });
          if (verified.size > options.maxEntries) {
            verified.delete(verified.keys().next().value!);
          }
        }
        return recipient;
      } finally {
        if (pending.get(callId) === entry) pending.delete(callId);
      }
    })();
    return entry.promise;
  }

  return { get, invalidate };
}

const outboundRecipientVerifier = createOutboundRecipientVerifier({
  ttlMs: env.agentphoneVoiceIdentityCacheTtlMs,
  maxEntries: env.agentphoneVoiceIdentityCacheMaxEntries,
});

export const getVerifiedOutboundRecipient = outboundRecipientVerifier.get;
export const invalidateVerifiedOutboundRecipient =
  outboundRecipientVerifier.invalidate;
