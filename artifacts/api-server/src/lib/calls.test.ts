import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentphoneRequest = vi.hoisted(() => vi.fn());
const mockSeedOutboundCallContext = vi.hoisted(() => vi.fn());
const mockClearPendingOutboundCallContext = vi.hoisted(() => vi.fn());
const mockAttachPendingOutboundCallId = vi.hoisted(() => vi.fn());
const mockClearPendingOutboundCallContextByCallId = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./agentphone-http", () => ({
  agentphoneRequest: mockAgentphoneRequest,
}));
vi.mock("./agentphone-conversation", () => ({
  seedOutboundCallContext: mockSeedOutboundCallContext,
  clearPendingOutboundCallContext: mockClearPendingOutboundCallContext,
  attachPendingOutboundCallId: mockAttachPendingOutboundCallId,
  clearPendingOutboundCallContextByCallId:
    mockClearPendingOutboundCallContextByCallId,
  PendingOutboundContextChangedError: class PendingOutboundContextChangedError extends Error {},
}));
vi.mock("./logger", () => ({
  logger: mockLogger,
}));

import {
  clearAgentCredentialsCache,
  initiateOutboundCall,
  OutboundCallIndeterminateError,
  reconcileOutboundCallOutcome,
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

  it("omits an immediate greeting and returns pending context on accepted success", async () => {
    const result = await initiateOutboundCall({
      toNumber: "+12105550123",
      userId: 42,
      openingMessage: "I am calling with your reminder.",
      privateContextNote: "Read the details if asked.",
      callScreeningIdentity: "Elaine from Batchelor App",
      callScreeningPurpose: "daily reminder",
    });

    expect(result).toEqual({
      callId: "call-1",
      contextAttached: true,
      pendingOutboundContext: {
        phoneNumber: "+12105550123",
        pendingId: "pending-1",
      },
    });
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
        retry: false,
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

  it("classifies an ambiguous 503 create failure as indeterminate", async () => {
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
    ).rejects.toBeInstanceOf(OutboundCallIndeterminateError);

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
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
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
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockResolvedValueOnce(undefined);

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
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries exact-token attachment in the background after accepted success", async () => {
    try {
      mockAttachPendingOutboundCallId
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockRejectedValueOnce(new Error("db unavailable"))
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

      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(mockAttachPendingOutboundCallId.mock.calls.length).toBeGreaterThan(
        2,
      );
      expect(mockAttachPendingOutboundCallId).toHaveBeenLastCalledWith(
        "+12105550123",
        "pending-1",
        "call-1",
      );
    } finally {
    }
  }, 15_000);

  it("keeps 503 indeterminate when exact cleanup also fails", async () => {
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
    ).rejects.toBeInstanceOf(OutboundCallIndeterminateError);
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledTimes(2);
  });

  it("keeps deterministic 400 definite while clearing exact context", async () => {
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
        status: 400,
        text: async () => "bad request",
      });

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Definite provider rejection.",
      }),
    ).rejects.toThrow(/status 400/);
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
  });

  it("treats 429 as a definite rejection without retrying POST", async () => {
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
        status: 429,
        text: async () => "rate limited",
      });

    await expect(
      initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Rate limited call.",
      }),
    ).rejects.toThrow(/status 429/);
    expect(mockAgentphoneRequest).toHaveBeenCalledTimes(2);
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
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
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
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
    expect(mockClearPendingOutboundCallContext).toHaveBeenCalledWith(
      "+12105550123",
      "pending-1",
    );
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

  it("retries terminal cleanup with the exact accepted token after initial failures", async () => {
    vi.useFakeTimers();
    try {
      const accepted = await initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Reconcile this accepted call.",
      });
      expect(accepted.contextAttached).toBe(true);
      expect(accepted.pendingOutboundContext).toEqual({
        phoneNumber: "+12105550123",
        pendingId: "pending-1",
      });

      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "completed", durationSeconds: 12 }),
      });
      mockClearPendingOutboundCallContext
        .mockReset()
        .mockRejectedValueOnce(new Error("initial cleanup failure"))
        .mockRejectedValueOnce(new Error("immediate retry failure"))
        .mockResolvedValueOnce(undefined);

      const outcomePromise = reconcileOutboundCallOutcome(
        accepted.callId,
        accepted.pendingOutboundContext,
        { interactiveTimeoutMs: 5_000 },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(outcomePromise).resolves.toBe("answered");
      await vi.advanceTimersByTimeAsync(2_000);

      expect(mockClearPendingOutboundCallContext).toHaveBeenCalledTimes(3);
      expect(mockClearPendingOutboundCallContext.mock.calls).toEqual([
        ["+12105550123", "pending-1"],
        ["+12105550123", "pending-1"],
        ["+12105550123", "pending-1"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clear a newer pending row when the accepted token no longer matches", async () => {
    vi.useFakeTimers();
    try {
      const accepted = await initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Keep newer call context safe.",
      });
      const pendingContext = accepted.pendingOutboundContext;
      expect(pendingContext).toBeDefined();

      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "no-answer", durationSeconds: 0 }),
      });
      let currentPendingId = "pending-1";
      const newerPendingId = "newer-pending-token";
      mockClearPendingOutboundCallContext
        .mockReset()
        .mockImplementation(async (_phoneNumber: string, pendingId: string) => {
          // A newer outbound seed wins the row between the terminal outcome
          // and cleanup. The exact-token predicate must make both old-token
          // attempts harmless rather than clearing this newer row.
          if (pendingId === "pending-1") {
            currentPendingId = newerPendingId;
            throw new Error("old token no longer matches");
          }
          if (pendingId === currentPendingId) currentPendingId = "";
        });

      const outcomePromise = reconcileOutboundCallOutcome(
        accepted.callId,
        pendingContext,
        { interactiveTimeoutMs: 5_000 },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(outcomePromise).resolves.toBe("no-answer");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockClearPendingOutboundCallContext.mock.calls).toEqual([
        ["+12105550123", "pending-1"],
        ["+12105550123", "pending-1"],
      ]);
      expect(
        mockClearPendingOutboundCallContext.mock.calls.some(
          ([phoneNumber, pendingId]) =>
            phoneNumber === "+12105550123" && pendingId === newerPendingId,
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains and logs terminal cleanup retry exhaustion while returning the outcome", async () => {
    vi.useFakeTimers();
    try {
      const accepted = await initiateOutboundCall({
        toNumber: "+12105550123",
        userId: 42,
        openingMessage: "Return the terminal outcome safely.",
      });
      mockAgentphoneRequest.mockReset();
      mockAgentphoneRequest.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "failed", durationSeconds: 0 }),
      });
      mockClearPendingOutboundCallContext
        .mockReset()
        .mockRejectedValue(new Error("database remains unavailable"));

      const outcomePromise = reconcileOutboundCallOutcome(
        accepted.callId,
        accepted.pendingOutboundContext,
        { interactiveTimeoutMs: 5_000 },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(outcomePromise).resolves.toBe("error");

      // Move beyond the configured one-hour retry lifetime so the next retry
      // observes its deadline without scheduling thousands of fake timers.
      vi.setSystemTime(Date.now() + 60 * 60 * 1_000 + 1);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          toNumber: "+12105550123",
          pendingId: "pending-1",
        }),
        "agentphone: pending context cleanup retries exhausted",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
