import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentphoneRequest = vi.hoisted(() => vi.fn());
const mockSeedOutboundCallContext = vi.hoisted(() => vi.fn());
const mockClearPendingOutboundCallContext = vi.hoisted(() => vi.fn());
const mockAttachPendingOutboundCallId = vi.hoisted(() => vi.fn());
const mockClearPendingOutboundCallContextByCallId = vi.hoisted(() => vi.fn());

vi.mock("./agentphone-http", () => ({
  agentphoneRequest: mockAgentphoneRequest,
}));
vi.mock("./agentphone-conversation", () => ({
  seedOutboundCallContext: mockSeedOutboundCallContext,
  clearPendingOutboundCallContext: mockClearPendingOutboundCallContext,
  attachPendingOutboundCallId: mockAttachPendingOutboundCallId,
  clearPendingOutboundCallContextByCallId:
    mockClearPendingOutboundCallContextByCallId,
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  clearAgentCredentialsCache,
  initiateOutboundCall,
  OutboundCallIndeterminateError,
  waitForCallOutcome,
} from "./calls";

describe("initiateOutboundCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgentCredentialsCache();
    // Reset queued provider responses as well as call history. A test that
    // fails before creating the call intentionally leaves its second queued
    // response unused; carrying that response into the next test makes the
    // credential lookup read a call payload and report "no agent found".
    mockAgentphoneRequest.mockReset();
    mockSeedOutboundCallContext.mockReset();
    mockClearPendingOutboundCallContext.mockReset();
    mockAttachPendingOutboundCallId.mockReset();
    mockClearPendingOutboundCallContextByCallId.mockReset();
    mockSeedOutboundCallContext.mockResolvedValue("pending-1");
    mockClearPendingOutboundCallContext.mockResolvedValue(undefined);
    mockAttachPendingOutboundCallId.mockResolvedValue(undefined);
    mockClearPendingOutboundCallContextByCallId.mockResolvedValue(undefined);
    mockAgentphoneRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "call-1" }),
      });
  });

  it("omits an immediate greeting and seeds the purpose before placing the call", async () => {
    const result = await initiateOutboundCall({
      toNumber: "+12105550123",
      userId: 42,
      openingMessage: "I am calling with your reminder.",
      privateContextNote: "Read the details if asked.",
      callScreeningIdentity: "Elaine from Batchelor App",
      callScreeningPurpose: "daily reminder",
    });

    expect(result).toEqual({ callId: "call-1", contextAttached: true });
    expect(mockAttachPendingOutboundCallId).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
      "call-1",
    );
    expect(mockSeedOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      42,
      "I am calling with your reminder.",
      "Read the details if asked.",
    );
    expect(mockAgentphoneRequest).toHaveBeenNthCalledWith(
      2,
      "/v1/calls",
      {
        method: "POST",
        body: {
          agentId: "agent-1",
          toNumber: "+12105550123",
          fromNumberId: "number-1",
          callScreeningIdentity: "Elaine from Batchelor App",
          callScreeningPurpose: "daily reminder",
        },
      },
      { op: "create-call" },
    );
  });

  it("clears only its pending purpose when call creation fails", async () => {
    mockAgentphoneRequest.mockReset();
    mockAgentphoneRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "unavailable",
      });

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "This should not remain pending.",
      }),
    ).rejects.toThrow(/status 503/);

    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
  });

  it("fails before placing the provider call when seeding context fails", async () => {
    mockSeedOutboundCallContext.mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Place this call anyway.",
      }),
    ).rejects.toThrow("db unavailable");

    expect(mockAgentphoneRequest).toHaveBeenCalledTimes(1);
    expect(mockAttachPendingOutboundCallId).not.toHaveBeenCalled();
  });

  it("retains context and reports indeterminate acceptance on create-call network failure", async () => {
    mockAgentphoneRequest.mockReset();
    mockAgentphoneRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
      }),
    });
    mockAgentphoneRequest.mockRejectedValueOnce(new Error("socket timeout"));

    const error = await initiateOutboundCall({
      toNumber: "+12105550123",
      userId: 42,
      openingMessage: "Do not duplicate this call.",
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OutboundCallIndeterminateError);
    expect(mockClearPendingOutboundCallContext).not.toHaveBeenCalled();
    expect(
      (error as OutboundCallIndeterminateError).pendingOutboundContext,
    ).toEqual({
      phoneNumber: "+12105550123",
      pendingId: "pending-1",
    });
  });

  it("returns accepted success for attach failure so webhook recovery can self-attach", async () => {
    vi.useFakeTimers();
    try {
      mockAttachPendingOutboundCallId
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"));

      await expect(
        initiateOutboundCall({
          toNumber: "+12105550123",
          userId: 42,
          openingMessage: "The call was accepted.",
        }),
      ).resolves.toEqual({
        callId: "call-1",
        contextAttached: false,
        pendingOutboundContext: {
          phoneNumber: "+12105550123",
          pendingId: "pending-1",
        },
      });

      expect(mockClearPendingOutboundCallContext).not.toHaveBeenCalled();
      expect(mockAttachPendingOutboundCallId).toHaveBeenCalledTimes(2);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries exact-token attachment in the background after accepted success", async () => {
    vi.useFakeTimers();
    try {
      mockAttachPendingOutboundCallId
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockResolvedValueOnce(undefined);

      await expect(
        initiateOutboundCall({
          toNumber: "+12105550123",
          userId: 42,
          openingMessage: "Recover this exact call context.",
        }),
      ).resolves.toMatchObject({
        callId: "call-1",
        contextAttached: false,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockAttachPendingOutboundCallId).toHaveBeenCalledTimes(3);
      expect(mockAttachPendingOutboundCallId).toHaveBeenLastCalledWith(
        "+12105550123",
        "pending-1",
        "call-1",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves provider failure when stale-context cleanup also fails", async () => {
    mockAgentphoneRequest.mockReset();
    mockAgentphoneRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "unavailable",
      });
    mockClearPendingOutboundCallContext
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockRejectedValueOnce(new Error("db still unavailable"));

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Provider failure must remain the outcome.",
      }),
    ).rejects.toThrow(/status 503/);
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledTimes(2);
  });

  it("retains context when an accepted response has malformed JSON", async () => {
    mockAgentphoneRequest.mockReset();
    mockAgentphoneRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("unexpected end of JSON input");
        },
      });

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "This call has no usable response.",
      }),
    ).rejects.toBeInstanceOf(OutboundCallIndeterminateError);
    expect(mockClearPendingOutboundCallContext).not.toHaveBeenCalled();
    expect(mockAttachPendingOutboundCallId).not.toHaveBeenCalled();
  });

  it("retains context when an accepted response omits the call id", async () => {
    mockAgentphoneRequest.mockReset();
    mockAgentphoneRequest
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "agent-1", numbers: [{ id: "number-1" }] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "   " }),
      });

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "This call has no id.",
      }),
    ).rejects.toBeInstanceOf(OutboundCallIndeterminateError);
    expect(mockClearPendingOutboundCallContext).not.toHaveBeenCalled();
    expect(mockAttachPendingOutboundCallId).not.toHaveBeenCalled();
  });

  it("clears the correlated purpose when the accepted call is not answered", async () => {
    vi.useFakeTimers();
    try {
      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "no-answer", durationSeconds: 0 }),
      });

      const outcomePromise = waitForCallOutcome("call-missed", 5_000);
      await vi.runAllTimersAsync();

      await expect(outcomePromise).resolves.toBe("no-answer");
      expect(mockClearPendingOutboundCallContextByCallId).toHaveBeenCalledWith(
        "call-missed",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the exact pending token when an unattached call is not answered", async () => {
    vi.useFakeTimers();
    try {
      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "no-answer", durationSeconds: 0 }),
      });

      const outcomePromise = waitForCallOutcome("call-unattached", 5_000, {
        phoneNumber: "+12105550123",
        pendingId: "pending-exact",
      });
      await vi.runAllTimersAsync();

      await expect(outcomePromise).resolves.toBe("no-answer");
      expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
        "+12105550123",
        "pending-exact",
      );
      expect(
        mockClearPendingOutboundCallContextByCallId,
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the correlated purpose when the accepted call reaches voicemail", async () => {
    vi.useFakeTimers();
    try {
      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "voicemail", durationSeconds: 0 }),
      });

      const outcomePromise = waitForCallOutcome("call-voicemail", 5_000);
      await vi.runAllTimersAsync();

      await expect(outcomePromise).resolves.toBe("voicemail");
      expect(mockClearPendingOutboundCallContextByCallId).toHaveBeenCalledWith(
        "call-voicemail",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps terminal outcome when clearing correlated context fails", async () => {
    vi.useFakeTimers();
    try {
      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "failed", durationSeconds: 0 }),
      });
      mockClearPendingOutboundCallContextByCallId.mockRejectedValueOnce(
        new Error("db unavailable"),
      );

      const outcomePromise = waitForCallOutcome("call-clear-failed", 5_000);
      await vi.runAllTimersAsync();

      await expect(outcomePromise).resolves.toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
