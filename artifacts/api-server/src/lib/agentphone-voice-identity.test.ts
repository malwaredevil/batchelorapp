import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutboundRecipientVerifier } from "./agentphone-voice-identity";

const request = vi.hoisted(() => vi.fn());
vi.mock("./agentphone-http", () => ({ agentphoneRequest: request }));
vi.mock("./env", () => ({
  env: {
    agentphoneOutboundCorrelationWindowMs: 50,
    agentphoneVoiceIdentityCacheTtlMs: 1_000,
    agentphoneVoiceIdentityCacheMaxEntries: 2,
  },
}));

describe("verified outbound voice recipient", () => {
  let verifier: ReturnType<typeof createOutboundRecipientVerifier>;
  let getVerifiedOutboundRecipient: typeof verifier.get;

  function providerCall(id = "call-1", toNumber = "+10000000001") {
    return {
      ok: true,
      json: async () => ({ id, direction: "outbound", toNumber }),
    };
  }

  beforeEach(() => {
    request.mockReset();
    verifier = createOutboundRecipientVerifier({ ttlMs: 1_000, maxEntries: 2 });
    getVerifiedOutboundRecipient = verifier.get;
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the recipient, not the agent's originating number, for the exact outbound call", async () => {
    request.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "call-1",
        direction: "outbound",
        fromNumber: "+10000000002",
        toNumber: "+10000000001",
      }),
    });
    expect(await getVerifiedOutboundRecipient("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledWith("/v1/calls/call-1", {
      method: "GET",
      retry: false,
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    null,
    {},
    { id: "different-call", direction: "outbound", toNumber: "+10000000001" },
    { id: "call-1", direction: "inbound", toNumber: "+10000000001" },
    { id: "call-1", toNumber: "+10000000001" },
    { id: "call-1", direction: "outbound", toNumber: "not-a-phone-number" },
  ])("rejects unverified or malformed call metadata: %j", async (metadata) => {
    request.mockResolvedValue({ ok: true, json: async () => metadata });
    expect(await getVerifiedOutboundRecipient("call-1")).toBeNull();
    request.mockResolvedValue(providerCall());
    expect(await getVerifiedOutboundRecipient("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["../agents", "call/1", "", "a".repeat(129)])(
    "does not request an invalid call ID: %s",
    async (id) => {
      expect(await getVerifiedOutboundRecipient(id)).toBeNull();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects a call not found in this provider account", async () => {
    request.mockResolvedValue({ ok: false, status: 404 });
    expect(await getVerifiedOutboundRecipient("call-1")).toBeNull();
    request.mockResolvedValue(providerCall());
    expect(await getVerifiedOutboundRecipient("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports provider failures instead of guessing the caller's identity", async () => {
    request.mockResolvedValue({ ok: false, status: 503 });
    await expect(getVerifiedOutboundRecipient("call-1")).rejects.toThrow(
      "verification unavailable",
    );
    request.mockResolvedValue(providerCall());
    expect(await getVerifiedOutboundRecipient("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("propagates network timeouts for a safe spoken failure", async () => {
    request.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    await expect(getVerifiedOutboundRecipient("call-1")).rejects.toThrow(
      "Timed out",
    );
    request.mockResolvedValue(providerCall());
    expect(await getVerifiedOutboundRecipient("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reuses verified identity across turns even if the provider becomes unavailable", async () => {
    request.mockResolvedValue(providerCall());
    expect(await verifier.get("call-1")).toBe("+10000000001");
    request.mockRejectedValue(new Error("Unavailable"));
    expect(await verifier.get("call-1")).toBe("+10000000001");
    expect(await verifier.get("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("expires at the absolute lifetime without extending it on repeated turns", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    request.mockResolvedValue(providerCall());
    await verifier.get("call-1");
    now.mockReturnValue(10_999);
    await verifier.get("call-1");
    expect(request).toHaveBeenCalledTimes(1);
    now.mockReturnValue(11_000);
    request.mockRejectedValue(new Error("Unavailable"));
    await expect(verifier.get("call-1")).rejects.toThrow("Unavailable");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used identity when the size limit is reached", async () => {
    request.mockImplementation(async (path: string) =>
      providerCall(path.split("/").at(-1)),
    );
    await verifier.get("call-1");
    await verifier.get("call-2");
    await verifier.get("call-1");
    await verifier.get("call-3");
    await verifier.get("call-1");
    expect(request).toHaveBeenCalledTimes(3);
    await verifier.get("call-2");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("keeps concurrent calls separate even when their recipient is the same", async () => {
    request.mockImplementation(async (path: string) =>
      providerCall(path.split("/").at(-1)),
    );
    expect(
      await Promise.all([verifier.get("call-1"), verifier.get("call-2")]),
    ).toEqual(["+10000000001", "+10000000001"]);
    await Promise.all([verifier.get("call-1"), verifier.get("call-2")]);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValue({ ok: false, status: 404 });
    expect(await verifier.get("stale-call")).toBeNull();
    expect(await verifier.get(" call-1")).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("shares an in-flight lookup only for the same exact call", async () => {
    request.mockResolvedValue(providerCall());
    expect(
      await Promise.all([verifier.get("call-1"), verifier.get("call-1")]),
    ).toEqual(["+10000000001", "+10000000001"]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not cross identities for overlapping calls to different recipients", async () => {
    request.mockImplementation(async (path: string) =>
      providerCall(
        path.split("/").at(-1),
        path.endsWith("call-1") ? "+10000000001" : "+10000000003",
      ),
    );
    expect(
      await Promise.all([verifier.get("call-1"), verifier.get("call-2")]),
    ).toEqual(["+10000000001", "+10000000003"]);
    expect(await verifier.get("call-2")).toBe("+10000000003");
    expect(await verifier.get("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retain malformed provider JSON", async () => {
    request.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    });
    await expect(verifier.get("call-1")).rejects.toThrow("Invalid JSON");
    request.mockResolvedValue(providerCall());
    expect(await verifier.get("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the ended call and verifies it afresh on the next turn", async () => {
    request.mockImplementation(async (path: string) =>
      providerCall(path.split("/").at(-1)),
    );
    await Promise.all([verifier.get("call-1"), verifier.get("call-2")]);
    verifier.invalidate("call-1");
    await verifier.get("call-2");
    await verifier.get("call-1");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not restore identity when a provider lookup finishes after call-ended", async () => {
    let resolve!: (value: ReturnType<typeof providerCall>) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const result = verifier.get("call-1");
    verifier.invalidate("call-1");
    resolve(providerCall());
    expect(await result).toBeNull();
    request.mockResolvedValue({ ok: false, status: 404 });
    expect(await verifier.get("call-1")).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds outstanding lookups and does not cache an evicted lookup's late result", async () => {
    let resolve!: (value: ReturnType<typeof providerCall>) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = verifier.get("call-1");
    request.mockImplementation(async (path: string) =>
      providerCall(path.split("/").at(-1)),
    );
    const second = verifier.get("call-2");
    const third = verifier.get("call-3");
    await Promise.all([second, third]);
    resolve(providerCall());
    expect(await first).toBeNull();
    await verifier.get("call-1");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("does not cache a provider response arriving after its verification lifetime", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    let resolve!: (value: ReturnType<typeof providerCall>) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const result = verifier.get("call-1");
    now.mockReturnValue(11_000);
    resolve(providerCall());
    expect(await result).toBeNull();
    request.mockResolvedValue(providerCall());
    expect(await verifier.get("call-1")).toBe("+10000000001");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
