import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getElaineCommunicationReceipts,
  streamElaineMessage,
  type ElaineRuntimeTrace,
} from "./elaine";

const TRACE: ElaineRuntimeTrace = {
  version: 1,
  traceId: "trace-test",
  requestClass: {
    kind: "research",
    complexity: "multi_step",
    requiresFreshData: true,
    hasAttachment: false,
  },
  goal: "Answer with current evidence",
  plan: {
    version: 1,
    goal: "Answer with current evidence",
    assumptions: [],
    completionCriteria: ["The answer is grounded"],
    steps: [
      {
        id: "search",
        label: "Check the source",
        kind: "research",
        toolName: "web_search",
        dependsOn: [],
        expectedEvidence: "A current source",
        required: true,
        riskClass: "read_only",
        confirmation: "none",
        retryLimit: 1,
        status: "active",
        attempts: 1,
      },
    ],
  },
  events: [],
  verification: null,
  status: "running",
  traceAvailable: true,
  startedAt: "2026-07-30T12:00:00.000Z",
  completedAt: null,
  usage: { modelRounds: 1, toolCalls: 1, replans: 0, elapsedMs: 10 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamElaineMessage runtime SSE", () => {
  it("preserves event order and clears provisional text before the final answer", async () => {
    const finalResponse = {
      role: "assistant",
      content: "Grounded final answer",
      navigate: null,
      actions: [],
      executedActions: [],
      actionConfirmationMode: "one_by_one",
      messages: [
        {
          role: "assistant",
          content: "Grounded final answer",
          runtimeTrace: { ...TRACE, status: "completed" },
        },
      ],
      runtimeTrace: { ...TRACE, status: "completed" },
    };
    const sse = [
      `event: runtime\ndata: ${JSON.stringify({ trace: TRACE })}\n\n`,
      'event: delta\ndata: {"text":"Provisional"}\n\n',
      "event: response_reset\ndata: {}\n\n",
      'event: delta\ndata: {"text":"Grounded final answer"}\n\n',
      `event: done\ndata: ${JSON.stringify(finalResponse)}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(sse, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
      ),
    );
    const observed: string[] = [];

    const result = await streamElaineMessage(
      { message: "Invented request", appId: "elaine" },
      {
        onRuntime: () => observed.push("runtime"),
        onDelta: (text) => observed.push(`delta:${text}`),
        onResponseReset: () => observed.push("reset"),
        onDone: () => observed.push("done"),
      },
    );

    expect(observed).toEqual([
      "runtime",
      "delta:Provisional",
      "reset",
      "delta:Grounded final answer",
      "done",
    ]);
    expect(result.content).toBe("Grounded final answer");
  });
});

describe("streamElaineMessage communication progress", () => {
  it("dispatches an executing receipt before the terminal response", async () => {
    const progress = {
      id: "receipt-1",
      actionType: "call_contact",
      channel: "voice",
      status: "executing",
      conversationId: 12,
    };
    const finalResponse = {
      content: "The call was initiated.",
      actions: [],
      executedActions: [],
      actionConfirmationMode: "auto",
      messages: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `event: communication_progress\ndata: ${JSON.stringify(progress)}\n\n` +
            `event: done\ndata: ${JSON.stringify(finalResponse)}\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    );
    const observed: string[] = [];
    await streamElaineMessage(
      { message: "Call my contact", appId: "elaine" },
      {
        onCommunicationProgress: (event) =>
          observed.push(`${event.actionType}:${event.status}`),
        onDone: () => observed.push("done"),
      },
    );
    expect(observed).toEqual(["call_contact:executing", "done"]);
  });
});

describe("getElaineCommunicationReceipts", () => {
  it("reads persisted receipts scoped to the requested conversation", async () => {
    const receipts = [
      {
        id: "receipt-1",
        actionType: "message_contact",
        channel: "sms",
        status: "pending",
        createdAt: "2026-09-25T12:00:00.000Z",
        updatedAt: "2026-09-25T12:00:01.000Z",
        conversationId: 12,
        recipientUserId: 9,
      },
    ];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ receipts }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getElaineCommunicationReceipts(12)).resolves.toEqual(receipts);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/elaine/communication-receipts?conversationId=12",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
